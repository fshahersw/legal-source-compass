"""Text layer of every fetched PDF: pdftotext -layout (pages split on form feed) and pdfinfo, keyed by the sha256 of the
original bytes. Output: private/acq/cra/text/<sha256>.layout.txt.gz and <sha256>.info.json.

    python3 -I -B scripts/enrichment/cra/cra_text.py
"""
from __future__ import annotations

import gzip
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402

TEXT = os.path.join(cra_fetch.ACQ, "text")
SCRATCH = "/home/user/legal-source-compass/private/scratch/enrich/cra/tmp"


def text_paths(sha: str) -> tuple[str, str]:
    return os.path.join(TEXT, f"{sha}.layout.txt.gz"), os.path.join(TEXT, f"{sha}.info.json")


def plain_path(sha: str) -> str:
    return os.path.join(TEXT, f"{sha}.plain.txt.gz")


def extract_plain(row: dict) -> None:
    """Reading-order text (pdftotext without -layout), pages split on form feed: prose in two-column pages stays whole."""
    out = plain_path(row["sha256"])
    if os.path.exists(out):
        return
    os.makedirs(SCRATCH, exist_ok=True)
    data = cra_fetch.read(row)
    with tempfile.NamedTemporaryFile(dir=SCRATCH, suffix=".pdf", delete=False) as h:
        h.write(data)
        tmp = h.name
    try:
        res = subprocess.run(["pdftotext", "-enc", "UTF-8", tmp, "-"], capture_output=True, timeout=300)
    finally:
        os.unlink(tmp)
    with gzip.open(out + ".tmp", "wt", encoding="utf-8") as h:
        h.write(res.stdout.decode("utf-8", "replace"))
    os.replace(out + ".tmp", out)


def plain_pages(sha: str) -> list[str]:
    return gzip.open(plain_path(sha), "rt", encoding="utf-8").read().split("\f")


def pdfinfo(path: str) -> dict:
    out = subprocess.run(["pdfinfo", "-isodates", path], capture_output=True, text=True, timeout=60).stdout
    info = {}
    for line in out.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            info[k.strip()] = v.strip()
    return info


def extract(row: dict) -> dict:
    """Write the layout text and info for one manifest row (a PDF) unless present; return the info."""
    txt, inf = text_paths(row["sha256"])
    if os.path.exists(txt) and os.path.exists(inf):
        return json.load(open(inf))
    os.makedirs(TEXT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
    data = cra_fetch.read(row)
    with tempfile.NamedTemporaryFile(dir=SCRATCH, suffix=".pdf", delete=False) as h:
        h.write(data)
        tmp = h.name
    try:
        info = pdfinfo(tmp)
        res = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", tmp, "-"], capture_output=True, timeout=300)
        layout = res.stdout.decode("utf-8", "replace")
    finally:
        os.unlink(tmp)
    pages = layout.split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    meta = {"sha256": row["sha256"], "url": row["url"], "final_url": row.get("final_url") or row["url"],
            "pages": int(info.get("Pages", "0") or 0), "text_pages": len(pages),
            "pdf_title": info.get("Title", ""), "pdf_created": info.get("CreationDate", ""),
            "pdf_modified": info.get("ModDate", ""), "chars": len(layout)}
    with gzip.open(txt + ".tmp", "wt", encoding="utf-8") as h:
        h.write("\f".join(pages))
    os.replace(txt + ".tmp", txt)
    with open(inf, "w") as h:
        json.dump(meta, h, sort_keys=True)
    return meta


def pages_of(sha: str) -> list[str]:
    txt, _ = text_paths(sha)
    return gzip.open(txt, "rt", encoding="utf-8").read().split("\f")


if __name__ == "__main__":
    man = cra_fetch.load_manifest()
    n = 0
    for row in man.values():
        if row.get("status") == 200 and "pdf" in (row.get("content_type") or "").lower():
            meta = extract(row)
            extract_plain(row)
            n += 1
            if meta["chars"] < 2000:
                print("LOW TEXT", meta["pages"], meta["chars"], row["url"])
    print(n, "pdfs")
