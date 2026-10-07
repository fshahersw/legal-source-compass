#!/usr/bin/env python3
"""Capture California Legislature pubinfo bulk export (official code tables + section LOBs)."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

DOWNLOADS = "https://downloads.leginfo.legislature.ca.gov"
ZIP_RE = re.compile(r'href="(pubinfo_(\d{4})\.zip)"')


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def fetch(url: str, timeout: int = 600) -> tuple[bytes, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "LegalSourceAtlas-statecodes/1 (official-source acquisition)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        headers = {k.lower(): v for k, v in resp.headers.items()}
    return body, headers


def stream_fetch(url: str, dest: str, timeout: int = 7200) -> dict:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "LegalSourceAtlas-statecodes/1 (official-source acquisition)"})
    h = hashlib.sha256()
    nbytes = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        headers = {k.lower(): v for k, v in resp.headers.items()}
        with open(dest, "wb") as out:
            while True:
                chunk = resp.read(8 * 1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                out.write(chunk)
                nbytes += len(chunk)
    return {"http_status": status, "bytes": nbytes, "sha256": h.hexdigest(), "headers": headers}


def discover_year_zip(index_html: str) -> tuple[str, str]:
    years = [(int(y), name) for name, y in ZIP_RE.findall(index_html)]
    if not years:
        raise SystemExit("No pubinfo_YYYY.zip links on publisher downloads index")
    year, name = max(years, key=lambda x: x[0])
    return name, str(year)


def immutable(path: str, body: bytes) -> None:
    if os.path.exists(path):
        if open(path, "rb").read() != body:
            raise SystemExit(f"Existing file differs: {path}")
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default="/tmp/sc4/ca")
    ap.add_argument("--zip-name", help="e.g. pubinfo_2025.zip (default: newest YYYY on index)")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    os.makedirs(os.path.join(root, "raw"), exist_ok=True)
    os.makedirs(os.path.join(root, "receipts"), exist_ok=True)

    index_url = f"{DOWNLOADS}/"
    index_body, index_headers = fetch(index_url)
    index_sha = sha256_hex(index_body)
    index_receipt = {
        "schema_version": "california-pubinfo-index/1",
        "source_url": index_url,
        "retrieved_at": utc_now(),
        "http_status": 200,
        "bytes": len(index_body),
        "sha256": index_sha,
        "content_type": index_headers.get("content-type"),
    }
    immutable(os.path.join(root, "receipts", "downloads-index.json"), json.dumps(index_receipt, indent=2).encode() + b"\n")

    zip_name = a.zip_name
    if not zip_name:
        zip_name, export_year = discover_year_zip(index_body.decode("utf-8", "replace"))
    else:
        m = re.match(r"pubinfo_(\d{4})\.zip$", zip_name)
        export_year = m.group(1) if m else None
    zip_url = f"{DOWNLOADS}/{zip_name}"
    zip_path = os.path.join(root, "raw", zip_name)
    receipt_path = os.path.join(root, "receipts", zip_name + ".json")

    if os.path.isfile(receipt_path):
        receipt = json.load(open(receipt_path, encoding="utf-8"))
        if receipt["source_url"] != zip_url:
            raise SystemExit("Receipt URL mismatch")
        on_disk = open(zip_path, "rb").read()
        if sha256_hex(on_disk) != receipt["sha256"] or len(on_disk) != receipt["bytes"]:
            raise SystemExit("Archive bytes do not match receipt")
    else:
        meta = stream_fetch(zip_url, zip_path)
        if meta["http_status"] != 200:
            raise SystemExit(f"Archive HTTP {meta['http_status']}")
        if meta["bytes"] < 1_000_000_000:
            raise SystemExit(f"Archive suspiciously small: {meta['bytes']} bytes")
        receipt = {
            "schema_version": "california-pubinfo-archive/1",
            "jurisdiction": "CA",
            "source_url": zip_url,
            "retrieved_at": utc_now(),
            "http_status": meta["http_status"],
            "bytes": meta["bytes"],
            "sha256": meta["sha256"],
            "raw_file": os.path.relpath(zip_path, root),
            "content_type": meta["headers"].get("content-type"),
            "etag": meta["headers"].get("etag"),
            "last_modified": meta["headers"].get("last-modified"),
            "export_label": zip_name.replace(".zip", ""),
            "export_year": export_year,
            "downloads_index_sha256": index_sha,
            "publication_allowed": False,
            "calculation_activation_allowed": False,
        }
        immutable(receipt_path, json.dumps(receipt, indent=2).encode() + b"\n")

    readme_url = f"{DOWNLOADS}/pubinfo_Readme.pdf"
    readme_path = os.path.join(root, "raw", "pubinfo_Readme.pdf")
    if not os.path.isfile(readme_path):
        body, hdrs = fetch(readme_url)
        immutable(readme_path, body)
        json.dump(
            {
                "source_url": readme_url,
                "retrieved_at": utc_now(),
                "http_status": 200,
                "bytes": len(body),
                "sha256": sha256_hex(body),
            },
            open(os.path.join(root, "receipts", "pubinfo_Readme.pdf.json"), "w"),
            indent=2,
        )

    load_url = f"{DOWNLOADS}/pubinfo_load.zip"
    load_path = os.path.join(root, "raw", "pubinfo_load.zip")
    if not os.path.isfile(load_path):
        body, _ = fetch(load_url)
        immutable(load_path, body)
        json.dump(
            {
                "source_url": load_url,
                "retrieved_at": utc_now(),
                "http_status": 200,
                "bytes": len(body),
                "sha256": sha256_hex(body),
            },
            open(os.path.join(root, "receipts", "pubinfo_load.zip.json"), "w"),
            indent=2,
        )

    receipt = json.load(open(receipt_path, encoding="utf-8"))
    summary = {
        "schema_version": "california-pubinfo-acquisition-summary/1",
        "observed_at": utc_now(),
        "archive": zip_name,
        "archive_sha256": receipt["sha256"],
        "archive_bytes": receipt["bytes"],
        "archive_download_complete": True,
        "parsed": False,
    }
    out = os.path.join(root, "acquisition-summary.json")
    json.dump(summary, open(out, "w"), indent=2)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
