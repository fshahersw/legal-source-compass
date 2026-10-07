#!/usr/bin/env python3
"""Acquire New Jersey publisher statute archives from pub.njleg.gov (official).

Direct HTTPS only; writes hash-verified ZIPs plus receipt and member inventory JSON
expected by nj-parse-bulk.py.
"""
import argparse
import hashlib
import io
import json
import pathlib
import urllib.request
import zipfile
from datetime import datetime, timezone

BASE_URL = "https://pub.njleg.gov/statutes"
ARCHIVES = ("STATUTES", "NJCONST", "LCTOC")
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> tuple[bytes, int]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read(), resp.status


def member_inventory(archive_bytes: bytes, prefix: str) -> dict:
    entries = []
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        if set(names) != {f"{prefix}.TXT", f"{prefix}.RTF"}:
            raise ValueError(f"Unexpected members in {prefix} archive: {names}")
        for info in archive.infolist():
            if info.flag_bits & 1:
                raise ValueError(f"Encrypted member: {info.filename}")
            data = archive.read(info)
            entries.append({"name": info.filename, "bytes": len(data), "sha256": sha256(data)})
    return {"archive_sha256": sha256(archive_bytes), "entries": entries}


def capture_one(root: pathlib.Path, name: str) -> dict:
    raw_file = f"{name}-TEXT.zip"
    url = f"{BASE_URL}/{raw_file}"
    body, status = fetch(url)
    if status != 200:
        raise ValueError(f"HTTP {status} for {url}")
    digest = sha256(body)
    archive_path = root / raw_file
    archive_path.write_bytes(body)
    inventory = member_inventory(body, name)
    inventory_path = root / f"{raw_file}.receipt.json.inventory.json"
    inventory_path.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    finished = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    receipt = {
        "schema_version": "nj-publisher-archive-capture/1",
        "jurisdiction": "NJ",
        "archive": name,
        "source_url": url,
        "raw_file": raw_file,
        "http_status": status,
        "bytes": len(body),
        "sha256": digest,
        "finished_at": finished,
        "inventory_sha256": sha256(inventory_path.read_bytes()),
        "publication_allowed": False,
    }
    receipt_path = root / f"{raw_file}.receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/capture"))
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    receipts = []
    for name in ARCHIVES:
        receipts.append(capture_one(args.work, name))
    print(
        json.dumps(
            {
                "archives": len(receipts),
                "work": str(args.work),
                "statutes_bytes": next(r["bytes"] for r in receipts if r["archive"] == "STATUTES"),
                "statutes_sha256": next(r["sha256"] for r in receipts if r["archive"] == "STATUTES"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
