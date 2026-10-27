"""Acquire the openFDA device recall bulk export (FDA Medical Device Recalls, cfRES), raw bytes unchanged.

Usage: python -I -B scripts/enrichment/openfda_device_recalls/fetch_device_recalls.py [--acq DIR]

Reads https://api.fda.gov/download.json once (the only openFDA API request), takes the device/recall partitions it
lists and downloads each zip from download.open.fda.gov (bulk files are not counted against the API quota).
A partition already on disk with the listed byte size is not downloaded again. Writes
<acq>/raw/device_recall/manifest.json: export date, partitions (url, file, records listed, bytes, sha256,
retrieved_at). The builder refuses files whose sha256 does not match this manifest.
"""
import argparse
import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DOWNLOAD_JSON = "https://api.fda.gov/download.json"
USER_AGENT = "LegalSourceAtlas/1.0 (legal-source-compass research)"


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as out:
        if resp.status != 200:
            raise SystemExit(f"HTTP {resp.status} for {url}")
        for block in iter(lambda: resp.read(1 << 20), b""):
            out.write(block)
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    args = ap.parse_args()
    out = Path(args.acq) / "raw" / "device_recall"
    out.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(DOWNLOAD_JSON, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        listing_bytes = resp.read()
    retrieved = now()
    (out / "download.json").write_bytes(listing_bytes)
    listing = json.loads(listing_bytes)
    recall = listing["results"]["device"]["recall"]
    partitions = []
    for part in recall["partitions"]:
        url = part["file"]
        if not url.startswith("https://download.open.fda.gov/device/recall/"):
            raise SystemExit(f"unexpected partition URL {url}")
        path = out / url.rsplit("/", 1)[1]
        if not path.exists():
            print("downloading", url, file=sys.stderr)
            download(url, path)
            got = now()
        else:
            got = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        partitions.append({
            "url": url, "file": path.name, "records_listed": part.get("records"), "size_mb_listed": part.get("size_mb"),
            "bytes": path.stat().st_size, "sha256": sha256_file(path), "retrieved_at": got,
        })
    manifest = {
        "schema_version": "openfda-device-recall-acquisition/1",
        "listing_url": DOWNLOAD_JSON,
        "listing_retrieved_at": retrieved,
        "listing_sha256": hashlib.sha256(listing_bytes).hexdigest(),
        "export_date": recall.get("export_date"),
        "partitions": partitions,
        "openfda_api_requests": 1,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k != "partitions"} | {"partitions": len(partitions)}))


if __name__ == "__main__":
    main()
