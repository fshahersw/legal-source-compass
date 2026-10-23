"""Independent check of the embedded shards against the source rows, by sampling.

    python3 -I -B scripts/semantic/verify_shards.py --corpus us_code_sections [--sample 40] [--embed]

For evenly spaced stored passages it re-reads the source document, re-chunks it and checks, for each sampled passage: the same
passage exists (chunk number, character offsets), the stored text_sha256 equals the sha256 of the source text at those offsets,
the embed key equals the key of the re-built embedded string, and the stored href and title equal the re-built ones. Also checks
every shard file's sha256 and size against the manifest and that no chunk number repeats or skips within a record. With --embed the
sampled passages are embedded again and each stored vector must have cosine >= 0.99 with the fresh one, which proves the vector rows
line up with their metadata rows. Prints the number of failures; exit code 1 when there is any.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import embed as em  # noqa: E402
import sources as src  # noqa: E402
import voyage as vg  # noqa: E402


def verify_dataset(dataset: str, docs: Iterable[ck.Doc], directory: str, sample: int = 40, client=None) -> dict:
    manifest = em.read_json(os.path.join(directory, "manifest.json"))
    failures: list[str] = []
    metas: list[dict] = []
    vec_files: list[tuple[str, int]] = []
    for s in manifest["shards"]:
        no = int(s["name"].split("-")[1])
        vec_path, meta_path = em.shard_paths(directory, no)
        if os.path.getsize(vec_path) != s["rows"] * vg.DIMENSIONS * 2:
            failures.append(f"{s['name']}: vector file size differs from rows x 2048")
        if em.file_sha256(vec_path) != s["vec_sha256"] or em.file_sha256(meta_path) != s["meta_sha256"]:
            failures.append(f"{s['name']}: file hash differs from the manifest")
        rows = em.read_meta(meta_path)
        if len(rows) != s["rows"]:
            failures.append(f"{s['name']}: {len(rows)} metadata rows, manifest says {s['rows']}")
        metas.extend(rows)
        vec_files.extend((vec_path, i) for i in range(len(rows)))
    if len(metas) != manifest["totals"]["chunks"]:
        failures.append(f"{len(metas)} stored passages, manifest total says {manifest['totals']['chunks']}")
    # chunk numbers run 0..k-1 inside each record, in order
    expect: dict[str, int] = {}
    for m in metas:
        n = expect.get(m["record_id"], 0)
        if m["chunk_no"] != n:
            failures.append(f"{m['record_id']}: chunk {m['chunk_no']} where {n} was expected")
        expect[m["record_id"]] = n + 1
        if m["dataset"] != dataset:
            failures.append(f"{m['record_id']}: stored under dataset {m['dataset']}")
    step = max(1, len(metas) // max(1, sample))
    picked = list(range(0, len(metas), step))[:sample]
    wanted = {metas[i]["record_id"] for i in picked}
    found: dict[str, ck.Doc] = {}
    for doc in docs:
        if doc.record_id in wanted:
            found[doc.record_id] = doc
            if len(found) == len(wanted):
                break
    checked_texts, rebuilt = [], []
    for i in picked:
        m = metas[i]
        doc = found.get(m["record_id"])
        if doc is None:
            failures.append(f"{m['record_id']}: source document not found")
            continue
        chunks = ck.chunk_doc(doc)
        if m["chunk_no"] >= len(chunks):
            failures.append(f"{m['record_id']}#{m['chunk_no']}: the source now has only {len(chunks)} passages")
            continue
        c = chunks[m["chunk_no"]]
        if (c.start, c.end) != (m["char_start"], m["char_end"]):
            failures.append(f"{m['record_id']}#{m['chunk_no']}: offsets differ")
        if c.text_sha256 != m["text_sha256"]:
            failures.append(f"{m['record_id']}#{m['chunk_no']}: text hash differs from the source text at the offsets")
        if em.embed_key(c.embed_text) != m["embed_sha256"]:
            failures.append(f"{m['record_id']}#{m['chunk_no']}: embed key differs from the re-built embedded string")
        if src.encode_href(m["href"]) != src.encode_href(c.href) or m["title"] != c.title:
            failures.append(f"{m['record_id']}#{m['chunk_no']}: title or link differs")
        if c.chunk_total != m["chunk_total"]:
            failures.append(f"{m['record_id']}#{m['chunk_no']}: chunk_total differs")
        checked_texts.append((i, c.embed_text))
        rebuilt.append(c)
    min_cos = None
    tokens = requests = 0
    if client is not None and checked_texts:
        for start in range(0, len(checked_texts), 32):
            batch = checked_texts[start : start + 32]
            fresh, used = client.embed([t for _, t in batch], "document")
            tokens += used
            requests += 1
            for (i, _), v in zip(batch, fresh):
                path, row = vec_files[i]
                stored = np.memmap(path, dtype="<f2", mode="r").reshape(-1, vg.DIMENSIONS)[row].astype(np.float32)
                cos = float(stored @ v.astype(np.float32) / (np.linalg.norm(stored) * np.linalg.norm(v.astype(np.float32))))
                min_cos = cos if min_cos is None else min(min_cos, cos)
                if cos < 0.99:
                    failures.append(f"{metas[i]['record_id']}#{metas[i]['chunk_no']}: stored vector does not match a fresh embedding (cosine {cos:.3f})")
    return {
        "dataset": dataset,
        "passages": len(metas),
        "records": len(expect),
        "sampled": len(rebuilt),
        "embedded_again": len(checked_texts) if client is not None else 0,
        "min_cosine": min_cos,
        "tokens": tokens,
        "requests": requests,
        "failures": failures,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--corpus", required=True, choices=list(src.ITERATORS))
    p.add_argument("--sample", type=int, default=40)
    p.add_argument("--embed", action="store_true")
    args = p.parse_args(argv)
    client = vg.VoyageClient() if args.embed else None
    res = verify_dataset(args.corpus, src.ITERATORS[args.corpus](), os.path.join(em.OUT, args.corpus), args.sample, client)
    if client is not None:
        usage = em.Usage(os.path.join(em.OUT, "usage.json"), em.TOTAL_BUDGET)
        usage.add("verification_resamples", res["tokens"], requests=res["requests"])
        usage.save()
    summary = {k: v for k, v in res.items() if k != "failures"}
    summary["failure_count"] = len(res["failures"])
    print(json.dumps(summary))
    for line in res["failures"][:30]:
        print("  FAIL", line)
    em.atomic_write(os.path.join(em.OUT, args.corpus, "verify_report.json"), json.dumps(res, indent=1).encode())
    return 1 if res["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
