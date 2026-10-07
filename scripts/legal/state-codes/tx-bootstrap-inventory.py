#!/usr/bin/env python3
"""Fetch verified Texas publisher code inventory into a capture root."""
import argparse
import hashlib
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

INVENTORY_URL = "https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json"


def fetch(url: str) -> tuple[bytes, int]:
    req = urllib.request.Request(url, headers={"User-Agent": "LegalSourceAtlas/1.0 (corpus capture)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read(), resp.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", default="/tmp/sc4/tx")
    root = pathlib.Path(ap.parse_args().root)
    root.mkdir(parents=True, exist_ok=True)
    body, status = fetch(INVENTORY_URL)
    digest = hashlib.sha256(body).hexdigest()
    (root / "download-index.json").write_bytes(body)
    receipt = {
        "source_url": INVENTORY_URL,
        "sha256": digest,
        "bytes": len(body),
        "http_status": status,
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (root / "download-index.receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    codes = json.loads(body)["StatuteCode"]
    print(json.dumps({"codes": len(codes), "inventory_sha256": digest}, indent=2))


if __name__ == "__main__":
    main()
