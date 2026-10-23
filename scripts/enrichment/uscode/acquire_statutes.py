"""Download GovInfo bulk data for enacted laws: Statutes at Large (USLM, volumes 1-138, 1789-2024) and public laws
(PLAW USLM, 113th Congress on), keyless from https://www.govinfo.gov/bulkdata.

  python3 -I -B scripts/enrichment/uscode/acquire_statutes.py [--statute] [--plaw] [--volumes 1-138]

STATUTE-<v>.xml is stored gzip-compressed (private/acq/uscode/statute/STATUTE-<v>.xml.gz); PLAW per-Congress public
zips are stored unchanged (private/acq/uscode/plaw/PLAW-<c>-public.zip). Graphics zips are not downloaded. Every file
has a manifest line (url, path, sha256 of the raw bytes, bytes, retrieved_at, status, Last-Modified).
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

MANIFEST = fetchlib.ACQ / "_manifest.jsonl"
BULK = "https://www.govinfo.gov/bulkdata/"
MIN_FREE = 3 * 1024 ** 3


def listing(path):
    status, body, _, _ = fetchlib.request(BULK + "json/" + path, headers={"Accept": "application/json"})
    if status != 200:
        raise RuntimeError(f"listing {path}: HTTP {status}")
    return json.loads(body)["files"]


def check_disk():
    free = shutil.disk_usage(fetchlib.ACQ).free
    if free < MIN_FREE:
        raise SystemExit(f"stopping: free disk {free / 1e9:.1f} GB is under 3 GB")


def statute(volumes):
    out_dir = fetchlib.ACQ / "statute"
    vols = sorted(int(f["name"]) for f in listing("STATUTE") if f["folder"] and f["name"].isdigit())
    got = []
    for v in vols:
        if volumes and v not in volumes:
            continue
        files = [f for f in listing(f"STATUTE/{v}") if f["name"] == f"STATUTE-{v}.xml"]
        if not files:
            print(json.dumps({"volume": v, "xml": None}), flush=True)
            continue
        check_disk()
        e = fetchlib.fetch_file(files[0]["link"], out_dir / f"STATUTE-{v}.xml.gz", MANIFEST, gzip_body=True)
        if e["bytes"] != files[0]["size"]:
            raise SystemExit(f"volume {v}: listing size {files[0]['size']} != downloaded {e['bytes']}")
        got.append({"volume": v, "bytes": e["bytes"], "stored": e["stored_bytes"]})
        print(json.dumps(got[-1]), flush=True)
    return got


def plaw(congresses):
    out_dir = fetchlib.ACQ / "plaw"
    got = []
    for c in congresses:
        files = [f for f in listing(f"PLAW/{c}/public") if f["name"] == f"PLAW-{c}-public.zip"]
        if not files:
            print(json.dumps({"congress": c, "zip": None}), flush=True)
            continue
        check_disk()
        e = fetchlib.fetch_file(files[0]["link"], out_dir / files[0]["name"], MANIFEST)
        got.append({"congress": c, "bytes": e["bytes"]})
        print(json.dumps(got[-1]), flush=True)
    return got


def parse_range(text):
    out = set()
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--statute", action="store_true")
    ap.add_argument("--plaw", action="store_true")
    ap.add_argument("--volumes")
    args = ap.parse_args()
    if args.plaw:
        plaw(range(113, 120))
    if args.statute:
        statute(parse_range(args.volumes) if args.volumes else None)
    print(json.dumps({"requests": fetchlib.COUNTS}))
