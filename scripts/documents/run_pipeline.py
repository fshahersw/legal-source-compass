"""documents/1 pipeline runner (the lead runs it; workers never write to the corpus).

Steps (each calls a service-role RPC of database/contracts/documents-v1.sql through PostgREST):
  refresh  <build>                 documents_refresh_v1: eligible documents and their published metadata
  index    <build> [--batch N]     documents_build_pages_v1 until nothing is pending (display rule, tsvector, ECF header)
  extract  <build> [--limit-shas N]  documents_export_pages_v1 -> extract.py -> private/build/documents/<build>/ files
  extract-file <build> --pages F   the same from a local JSONL of {sha256, page, text} (offline; used for samples)
  load     <build>                 documents_load_extractions_v1 in batches; writes a load receipt
  resolve  [--batch N]             documents_resolve_v1 until nothing is pending
  link                             documents_link_v1
  status                           documents_status_v1

Credentials come only from the environment (EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY, or
EXTERNAL_SUPABASE_KEY); they are never printed, logged or written. Run from the repository root:
  python3 -I -B scripts/documents/run_pipeline.py <step> ...
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract import EXTRACTOR_VERSION, KINDS, extract_document_pages  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BUILD_ROOT = ROOT / "private" / "build" / "documents"
BUILD_RE = re.compile(r"^[a-z0-9_.-]{1,40}$")
LOAD_BATCH = 2000


class ConfigError(RuntimeError):
    pass


def creds() -> tuple[str, str]:
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").strip()
    key = (os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("EXTERNAL_SUPABASE_KEY") or "").strip()
    if not url or not key:
        raise ConfigError("EXTERNAL_SUPABASE_URL and a service-role key must be set in the environment")
    return url.rstrip("/"), key


def rpc(fn: str, body: dict, attempts: int = 4) -> object:
    url, key = creds()
    headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode("utf-8")
    for attempt in range(attempts):
        req = urllib.request.Request(f"{url}/rest/v1/rpc/{fn}", data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 502, 503, 504) and attempt + 1 < attempts:
                time.sleep(2 ** attempt * 5)
                continue
            raise RuntimeError(f"{fn} failed ({e.code}): {detail}") from None
        except urllib.error.URLError as e:
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt * 5)
                continue
            raise RuntimeError(f"{fn} unreachable: {e.reason}") from None
    raise RuntimeError(f"{fn} failed")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_dir(build: str, root: Path = BUILD_ROOT) -> Path:
    if not BUILD_RE.match(build):
        raise SystemExit("build must match ^[a-z0-9_.-]{1,40}$")
    d = root / build
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_extractions(build: str, page_batches, root: Path = BUILD_ROOT) -> dict:
    """Extracts every page batch and writes extractions.jsonl.gz plus manifest.json; returns the manifest."""
    out_dir = build_dir(build, root)
    path = out_dir / "extractions.jsonl.gz"
    by_kind = {k: 0 for k in KINDS}
    pages = shas = rows = 0
    seen = set()
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
        for batch in page_batches:
            pages += len(batch)
            for p in batch:
                if p["sha256"] not in seen:
                    seen.add(p["sha256"])
                    shas += 1
            for r in extract_document_pages(batch):
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
                by_kind[r["kind"]] += 1
                rows += 1
    manifest = {
        "build": build,
        "extractor_version": EXTRACTOR_VERSION,
        "parity_fixture_sha256": sha256_file(Path(__file__).resolve().parent / "fixtures" / "citation_parity.json"),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "byte_sets": shas,
        "pages": pages,
        "rows": rows,
        "rows_by_kind": by_kind,
        "files": [{"path": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)}],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    return manifest


def exported_batches(limit_shas: int | None, per_call: int = 25):
    after, done = "", 0
    while True:
        res = rpc("documents_export_pages_v1", {"p_after": after, "p_limit": per_call})
        pages = res.get("pages") or []
        if not pages:
            return
        yield pages
        done += len({p["sha256"] for p in pages})
        after = res["last"]
        if limit_shas is not None and done >= limit_shas:
            return


def file_batches(path: Path, size: int = 500):
    batch = []
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                p = json.loads(line)
                batch.append({"sha256": p["sha256"], "page": int(p["page"]), "text": p["text"]})
                if len(batch) >= size:
                    yield batch
                    batch = []
    if batch:
        yield batch


def iter_rows(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def load(build: str, root: Path = BUILD_ROOT, send=None) -> dict:
    """Posts extractions.jsonl.gz in batches; the database re-checks every row against the stored page."""
    send = send or (lambda rows: rpc("documents_load_extractions_v1", {"p_build": build, "p_rows": rows}))
    path = build_dir(build, root) / "extractions.jsonl.gz"
    receipt = {"build": build, "file_sha256": sha256_file(path), "batches": 0, "accepted": 0, "rejected": {}, "rejected_sample": []}
    batch: list[dict] = []

    def flush():
        res = send(batch)
        receipt["batches"] += 1
        receipt["accepted"] += int(res.get("accepted", 0))
        for k, v in (res.get("rejected") or {}).items():
            receipt["rejected"][k] = receipt["rejected"].get(k, 0) + int(v)
        receipt["rejected_sample"] = (receipt["rejected_sample"] + list(res.get("rejected_sample") or []))[:20]

    for r in iter_rows(path):
        batch.append(r)
        if len(batch) >= LOAD_BATCH:
            flush()
            batch = []
    if batch:
        flush()
    (path.parent / "load-receipt.json").write_text(json.dumps(receipt, indent=1) + "\n", encoding="utf-8")
    return receipt


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="step", required=True)
    for name in ("refresh", "index", "extract", "extract-file", "load"):
        s = sub.add_parser(name)
        s.add_argument("build")
        if name == "index":
            s.add_argument("--batch", type=int, default=100)
        if name == "extract":
            s.add_argument("--limit-shas", type=int, default=None)
        if name == "extract-file":
            s.add_argument("--pages", required=True)
    r = sub.add_parser("resolve")
    r.add_argument("--batch", type=int, default=50000)
    sub.add_parser("link")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    try:
        if a.step == "refresh":
            print(json.dumps(rpc("documents_refresh_v1", {"p_build": a.build}), indent=1))
        elif a.step == "index":
            while True:
                res = rpc("documents_build_pages_v1", {"p_build": a.build, "p_limit": a.batch})
                print(json.dumps(res))
                if not res.get("remaining"):
                    break
        elif a.step == "extract":
            print(json.dumps(write_extractions(a.build, exported_batches(a.limit_shas)), indent=1))
        elif a.step == "extract-file":
            print(json.dumps(write_extractions(a.build, file_batches(Path(a.pages))), indent=1))
        elif a.step == "load":
            print(json.dumps(load(a.build), indent=1))
        elif a.step == "resolve":
            while True:
                res = rpc("documents_resolve_v1", {"p_limit": a.batch})
                print(json.dumps(res))
                if not res.get("pending"):
                    break
        elif a.step == "link":
            print(json.dumps(rpc("documents_link_v1", {}), indent=1))
        elif a.step == "status":
            print(json.dumps(rpc("documents_status_v1", {}), indent=1))
    except ConfigError as e:
        print(f"configuration: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
