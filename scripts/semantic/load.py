"""Load the semantic index shards (private/build/semantic/<dataset>/) into Postgres (schema semantic, database/contracts/semantic-v1.sql).

Run by whoever holds the service credential, after the contract's PART 1 and PART 2 are applied (the vector extension enabled):

    cd <repo>
    . private/scratch/env.sh && python3 -I -B scripts/semantic/load.py load --corpus us_code_sections [--workers 3] [--prune]
    . private/scratch/env.sh && python3 -I -B scripts/semantic/load.py status
    python3 -I -B scripts/semantic/load.py export-copy --corpus us_code_sections --out /path/us_code_sections.tsv.gz   # no credential

`load` verifies each shard's sha256 against the manifest, registers the corpus (semantic_load_corpus_v1) and sends the shard rows
in batches to semantic_load_v1, which upserts by (dataset, record_id, chunk_no) and leaves identical rows alone, so every step can
be rerun; progress is kept in <dataset>/load_progress.json. `--prune` also removes passages a record no longer has (a reload that
kept fewer). Afterwards run PART 3 of the contract (the HNSW index) and `status`.

`export-copy` writes PostgreSQL COPY text format (tab separated, \\N for null) for an initial bulk load with psql, to a gzip file or, with
`--out -`, to standard output so it can be piped without storing it (the text is about 7 KB per passage):
    python3 -I -B scripts/semantic/load.py export-copy --corpus us_code_sections --out - | psql "$DATABASE_URL" -c "\\copy semantic.chunks (dataset, record_id, chunk_no, chunk_total, char_start, char_end, text_sha256, title, href, source_url, snippet, embedding) from stdin"
(register the corpus row first with `load --corpus X --corpus-only`; COPY has no upsert, so use it only into an empty dataset).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import gzip
import json
import os
import sys
import time
from collections.abc import Callable, Iterator

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import embed as em  # noqa: E402
import sources as src  # noqa: E402

DIMENSIONS = 1024
COPY_COLUMNS = ["dataset", "record_id", "chunk_no", "chunk_total", "char_start", "char_end", "text_sha256", "title", "href", "source_url", "snippet"]


def vector_text(vec: np.ndarray) -> str:
    """pgvector text form of one float16 vector. Five significant digits identify every 16-bit value, so the database stores
    exactly the shard's vector."""
    if vec.shape != (DIMENSIONS,):
        raise ValueError("wrong vector length")
    return "[" + ",".join(format(float(x), ".5g") for x in vec.astype(np.float32)) + "]"


def iter_shard(directory: str, shard: dict, verify: bool = True) -> Iterator[tuple[dict, np.ndarray]]:
    vec_path, meta_path = em.shard_paths(directory, int(shard["name"].split("-")[1]))
    if verify and (em.file_sha256(vec_path) != shard["vec_sha256"] or em.file_sha256(meta_path) != shard["meta_sha256"]):
        raise SystemExit(f"{shard['name']}: file hashes differ from the manifest; rebuild the shard")
    metas = em.read_meta(meta_path)
    matrix = np.memmap(vec_path, dtype="<f2", mode="r").reshape(-1, DIMENSIONS)
    if len(metas) != len(matrix):
        raise SystemExit(f"{shard['name']}: {len(metas)} metadata rows but {len(matrix)} vectors")
    for i, m in enumerate(metas):
        yield m, matrix[i]


def load_row(m: dict, vec: np.ndarray) -> dict:
    return {
        "record_id": m["record_id"],
        "chunk_no": m["chunk_no"],
        "chunk_total": m["chunk_total"],
        "char_start": m["char_start"],
        "char_end": m["char_end"],
        "text_sha256": m["text_sha256"],
        "title": m["title"],
        "href": src.encode_href(m["href"]),
        "source_url": m["source_url"] or "",
        "snippet": m["snippet"],
        "embedding": vector_text(vec),
    }


def copy_escape(value: object) -> str:
    if value is None:
        return "\\N"
    return str(value).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def copy_line(m: dict, vec: np.ndarray) -> str:
    values = [
        src.encode_href(m["href"]) if c == "href" else (m[c] if c != "source_url" else (m["source_url"] or None))
        for c in COPY_COLUMNS
    ]
    return "\t".join([*map(copy_escape, values), vector_text(vec)]) + "\n"


def corpus_row(dataset: str, manifest: dict) -> dict:
    t = manifest["totals"]
    return {
        "dataset": dataset,
        "label": src.LABELS.get(dataset, dataset),
        "index_version": manifest["index_version"],
        "composed": bool(manifest["params"]["composed"]),
        "records": t["records"],
        "chunks": t["chunks"],
        "capped_records": t["capped_records"],
        "built_at": manifest.get("updated_at"),
        "source_digest": (manifest.get("source") or {}).get("sha256"),
    }


class Rpc:
    def __init__(self):
        import requests

        self.url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
        if not self.url or not key:
            raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (source private/scratch/env.sh in the command)")
        self.h = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
        if not key.startswith("sb_"):
            self.h["Authorization"] = "Bearer " + key
        self.s = requests.Session()

    def call(self, fn: str, body: dict, attempts: int = 5):
        delay = 2.0
        for attempt in range(attempts):
            try:
                r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self.h, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), timeout=300)
            except Exception as exc:  # noqa: BLE001 - network errors are retried
                if attempt + 1 == attempts:
                    raise RuntimeError(f"{fn}: network error {type(exc).__name__}") from None
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code in (408, 429, 500, 502, 503, 504, 520, 522, 524) and attempt + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"{fn} -> HTTP {r.status_code}: {r.text[:300]}")


def load_dataset(
    dataset: str,
    rpc,
    *,
    directory: str | None = None,
    batch_rows: int = 300,
    workers: int = 3,
    prune: bool = False,
    corpus_only: bool = False,
    log: Callable[[str], None] = print,
) -> dict:
    directory = directory or os.path.join(em.OUT, dataset)
    manifest = em.read_json(os.path.join(directory, "manifest.json"))
    if manifest["status"] not in ("complete", "stopped_total_budget", "stopped_run_token_limit", "stopped_run_chunk_limit", "stopped_disk_floor"):
        log(f"{dataset}: manifest status is {manifest['status']}; loading the shards that are complete")
    rpc.call("semantic_load_corpus_v1", {"p_row": corpus_row(dataset, manifest)})
    if corpus_only:
        return {"corpus": dataset, "shards": 0, "rows": 0}
    progress_path = os.path.join(directory, "load_progress.json")
    done: dict[str, str] = em.read_json(progress_path) if os.path.exists(progress_path) else {}
    totals = {"rows": 0, "written": 0, "unchanged": 0, "pruned": 0, "shards": 0}
    for shard in manifest["shards"]:
        if done.get(shard["name"]) == shard["vec_sha256"]:
            continue
        rows, counts = [], {}
        for m, vec in iter_shard(directory, shard):
            rows.append(load_row(m, vec))
            counts[m["record_id"]] = counts.get(m["record_id"], 0) + 1
        batches = [rows[i : i + batch_rows] for i in range(0, len(rows), batch_rows)]
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            for res in pool.map(lambda b: rpc.call("semantic_load_v1", {"p_dataset": dataset, "p_rows": b}), batches):
                totals["rows"] += res["rows"]
                totals["written"] += res["written"]
                totals["unchanged"] += res["unchanged"]
        if prune:
            items = list(counts.items())
            for i in range(0, len(items), 1000):
                totals["pruned"] += int(rpc.call("semantic_prune_v1", {"p_dataset": dataset, "p_counts": dict(items[i : i + 1000])}))
        done[shard["name"]] = shard["vec_sha256"]
        em.atomic_write(progress_path, json.dumps(done, indent=1, sort_keys=True).encode())
        totals["shards"] += 1
        log(f"{dataset}: {shard['name']} loaded ({totals['rows']:,} rows so far)")
    return totals


def export_copy(dataset: str, out_path: str, directory: str | None = None) -> int:
    directory = directory or os.path.join(em.OUT, dataset)
    manifest = em.read_json(os.path.join(directory, "manifest.json"))
    n = 0

    def write_all(out) -> None:
        nonlocal n
        for shard in manifest["shards"]:
            for m, vec in iter_shard(directory, shard):
                out.write(copy_line(m, vec))
                n += 1

    if out_path == "-":
        write_all(sys.stdout)
    else:
        with gzip.open(out_path, "wt", encoding="utf-8", compresslevel=3) as out:
            write_all(out)
    return n


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("load")
    a.add_argument("--corpus", required=True)
    a.add_argument("--workers", type=int, default=3)
    a.add_argument("--batch-rows", type=int, default=300)
    a.add_argument("--prune", action="store_true")
    a.add_argument("--corpus-only", action="store_true")
    sub.add_parser("status")
    c = sub.add_parser("export-copy")
    c.add_argument("--corpus", required=True)
    c.add_argument("--out", required=True)
    args = p.parse_args(argv)
    if args.cmd == "export-copy":
        n = export_copy(args.corpus, args.out)
        print(f"{n:,} rows written", file=sys.stderr if args.out == "-" else sys.stdout)
        return 0
    rpc = Rpc()
    if args.cmd == "status":
        print(json.dumps(rpc.call("semantic_status_v1", {}), indent=1))
        return 0
    totals = load_dataset(args.corpus, rpc, batch_rows=args.batch_rows, workers=args.workers, prune=args.prune, corpus_only=args.corpus_only)
    print(json.dumps(totals))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
