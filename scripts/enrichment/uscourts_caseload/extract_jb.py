"""Parse every acquired Judicial Business table (F-2, C-4, C-4A, S-19, S-20, T-1) into a cache (offline).

Reads private/acq/uscourts_caseload/jb_index.json (table page -> files) and the manifest, checks each file's sha256 against the
manifest, parses it with uc_jb (the workbook when the page offers one, else the PDF) and writes
private/build/uscourts_caseload/extracted/jb_<table>_<year>.json with the parsed rows, the parser's checks and the source file.
The cache is derived data: delete the folder and run again to regenerate it.

Usage: python3 -I -B extract_jb.py [table ...]
"""
import hashlib
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import uc_jb  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_caseload"
CACHE = ROOT / "private" / "build" / "uscourts_caseload" / "extracted"
TABLES = ["F-2", "C-4", "C-4A", "S-19", "S-20", "T-1"]
VERSION = "extract_jb/1"


def manifest():
    out = {}
    for line in (ACQ / "_manifest.jsonl").read_text().splitlines():
        if line.strip():
            e = json.loads(line)
            if e.get("path") and e.get("status") == 200:
                out[e["path"]] = e
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_atomic(target, text, attempts=60):
    tmp = target.with_suffix(target.suffix + ".part")
    for attempt in range(attempts):
        try:
            tmp.write_text(text)
            tmp.replace(target)
            return
        except OSError as error:
            if error.errno != 28 or attempt == attempts - 1:
                raise
            time.sleep(20)


def cache_path(table, year):
    return CACHE / f"jb_{table.lower()}_{year}.json"


def parse_one(job):
    table, year = job
    idx = json.loads((ACQ / "jb_index.json").read_text())
    entry = next(e for e in idx if e["table"] == table.lower() and e["year"] == year)
    man = manifest()
    files = [f for f in entry["files"] if f.get("path")]
    xlsx = [f for f in files if f["path"].endswith(".xlsx")]
    use = (xlsx or [f for f in files if f["path"].endswith(".pdf")])[0]
    m = man.get(use["path"])
    actual = sha256(ROOT / use["path"])
    if not m or m["sha256"] != actual:
        raise SystemExit(f"{use['path']}: sha256 {actual} differs from the manifest")
    target = cache_path(table, year)
    if target.exists():
        try:
            have = json.loads(target.read_text())
            if have.get("sha256") == actual and have.get("version") == VERSION:
                return table, year, "cached"
        except ValueError:
            pass
    path = ROOT / use["path"]
    if table == "F-2":
        rows, checks = uc_jb.parse_f2(path, year)
    elif table == "C-4":
        rows, checks = uc_jb.parse_c4(path, year)
    elif table == "S-20":
        rows, checks = uc_jb.parse_s20(path, year)
    else:
        rows, checks = uc_jb.parse_simple_court_table(path, year, table)
    payload = {"table": table, "year": year, "version": VERSION, "path": use["path"], "url": use["url"], "sha256": actual, "retrieved_at": m.get("retrieved_at"),
               "page_url": entry["page"], "page_title": entry.get("page_title"), "format": path.suffix.lstrip("."), "checks": checks, "rows": rows}
    CACHE.mkdir(parents=True, exist_ok=True)
    write_atomic(target, json.dumps(payload, default=int, separators=(",", ":")))
    return table, year, "extracted"


def jobs(tables):
    idx = json.loads((ACQ / "jb_index.json").read_text())
    return sorted({(e["table"].upper(), e["year"]) for e in idx if e["table"].upper() in tables and any(f.get("path") for f in e["files"])})


if __name__ == "__main__":
    wanted = [t.upper() for t in sys.argv[1:]] or TABLES
    failed = []
    with ProcessPoolExecutor(max_workers=2) as pool:
        for job, fut in [(j, pool.submit(parse_one, j)) for j in jobs(wanted)]:
            try:
                print(*fut.result(), flush=True)
            except Exception as error:
                failed.append(job)
                print(*job, "FAILED", repr(error)[:300], flush=True)
    if failed:
        raise SystemExit(f"failed: {failed}")
