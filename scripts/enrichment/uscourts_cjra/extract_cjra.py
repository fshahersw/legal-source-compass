"""Extract the printed rows of every CJRA report's Appendix A to a cache (offline; reads private/acq/uscourts_cjra only).

For each report period the main PDF (hash-checked against the manifest) is read with cjra_extract.pdf_rows and written to
private/build/uscourts_cjra/extracted/<period>.rows.json together with the page geometry used. The cache is derived data:
delete the folder and run again to regenerate it. A cache file is reused only when it records the same PDF sha256.

Usage: python3 -I -B extract_cjra.py [period ...]
"""
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cjra_extract  # noqa: E402
import cjra_sources as S  # noqa: E402

CACHE = S.BUILD / "extracted"


def cache_path(period):
    return CACHE / f"{period}.rows.json"


def extract_period(period):
    entry = S.periods()[period]["main"]
    path = S.verified(entry)
    target = cache_path(period)
    if target.exists():
        try:
            have = json.loads(target.read_text())
        except ValueError:  # truncated by an earlier failed write
            have = {}
        if have.get("pdf_sha256") == entry["sha256"] and have.get("extractor") == EXTRACTOR_VERSION:
            return period, "cached", len(have["rows"])
    rows, geometry = cjra_extract.pdf_rows(path)
    CACHE.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"period": period, "pdf": entry["path"], "pdf_sha256": entry["sha256"], "extractor": EXTRACTOR_VERSION,
                          "geometry": geometry, "rows": rows}, separators=(",", ":"))
    write_atomic(target, payload)
    return period, "extracted", len(rows)


def write_atomic(target, text, attempts=60):
    """Write via a temporary file and rename; a full disk (ENOSPC) is retried every 20 s because other jobs share the volume."""
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


EXTRACTOR_VERSION = "cjra_extract/runs-v3"


def load_rows(period):
    """Cached rows of a period, extracting them first when the cache is missing or stale."""
    extract_period(period)
    return json.loads(cache_path(period).read_text())


if __name__ == "__main__":
    wanted = sys.argv[1:] or sorted(S.periods())
    failed = []
    with ProcessPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(extract_period, p): p for p in wanted}
        for future, period in futures.items():
            try:
                print(*future.result(), flush=True)
            except Exception as error:  # keep going: report every failed period at the end
                failed.append(period)
                print(period, "FAILED", repr(error)[:200], flush=True)
    if failed:
        raise SystemExit(f"failed: {failed}")
