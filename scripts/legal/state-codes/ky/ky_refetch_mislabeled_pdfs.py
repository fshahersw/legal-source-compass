#!/usr/bin/env python3
"""Re-fetch section PDFs whose opening citation token disagrees with the inventory URL."""
from __future__ import annotations

import argparse
import pathlib
import sys

import pymupdf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))
from provenance_fetch import Fetcher  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse_stage as ps  # noqa: E402


def pdf_opens_with(body: bytes, citation_path: str) -> bool:
    with pymupdf.open(stream=body, filetype="pdf") as document:
        text = "".join(page.get_text("text") for page in document)
    normalized = ps.normalized_layout_text(text)
    try:
        ps.pdf_opening_citation_len(normalized, citation_path)
        return True
    except ValueError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/KY"))
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()
    _, successful = ps.receipt_index(args.root)
    _, _, plan = ps.build_plan(args.root, successful)
    bad = []
    for item in plan:
        receipt = successful[item["url"]]
        body = ps.raw_bytes(args.root, receipt)
        if not body.startswith(b"%PDF-"):
            continue
        if not pdf_opens_with(body, item["citation_path"]):
            bad.append(item)
    print({"mislabeled_pdfs": len(bad), "urls": [row["url"] for row in bad[:20]]})
    if not args.execute or not bad:
        return 0
    fetcher = Fetcher("KY", args.root, min_interval=1.0)
    for item in bad:
        result = fetcher.get(item["url"], label="section", force=True)
        if not result.get("ok"):
            raise SystemExit(f"refetch failed: {item['url']} {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
