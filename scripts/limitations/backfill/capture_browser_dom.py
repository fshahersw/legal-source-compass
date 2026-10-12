"""Adapt a reviewed publisher browser fragment receipt without inventing HTTP response evidence.

Usage: python capture_browser_dom.py RECEIPT STATE SECTION CAPTURE_ID
Writes new captures under LIM_WORK; refuses existing captures and mismatched/truncated text.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime
from urllib.parse import parse_qs, urlparse

from capture import html_to_text


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(text):
    # innerText joins adjacent breadcrumb spans that HTML block extraction separates.
    # Compare every non-whitespace character in order; no punctuation/word normalization.
    return re.sub(r"\s+", "", text)


def load_receipt(receipt_path, state, section, capture_id):
    path = Path(receipt_path)
    receipt = json.loads(path.read_bytes())
    if receipt.get("method") != "public-browser-rendered-dom-fragment" or receipt.get("selector") != "section.doc-content":
        raise ValueError("A complete section.doc-content fragment receipt is required")
    if receipt.get("http_status", "absent") is not None:
        raise ValueError("Browser adapter expects explicitly unrecorded HTTP status")
    if not re.fullmatch(r"[A-Z]{2}", state) or not receipt.get("id", "").startswith(state.lower() + "-"):
        raise ValueError("Receipt state mismatch")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,80}", capture_id):
        raise ValueError("Invalid capture identity")
    if not re.fullmatch(r"\d+(?:-\d+){2}", section):
        raise ValueError("Exact native section number required")
    url = urlparse(receipt.get("url", ""))
    query = parse_qs(url.query)
    if url.scheme != "https" or url.hostname != "advance.lexis.com" or url.username or url.password:
        raise ValueError("Expected the observed official-designated publisher host")
    # Publisher Previous/Next navigation omits title but retains the native document URN.
    if ("title" in query and section not in query["title"][0]) or not query.get("pddocfullpath", [""])[0].startswith("/shared/document/statutes-legislation/urn:contentItem:"):
        raise ValueError("Native section title and document locator must agree")
    stamp = receipt.get("retrieved_at", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", stamp):
        raise ValueError("UTC retrieval timestamp required")
    datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    data = {}
    for kind in ["raw", "text"]:
        name = receipt.get(kind + "_file", "")
        if not name or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Receipt filename must be a local basename")
        data[kind] = (path.parent / name).read_bytes()
        if digest(data[kind]) != receipt.get(kind + "_sha256") or len(data[kind]) != receipt.get(kind + "_bytes"):
            raise ValueError(kind + " receipt hash/length mismatch")
    raw = data["raw"].decode("utf-8")
    text = data["text"].decode("utf-8")
    if not re.match(r'\s*<section\b[^>]*class=["\'][^"\']*\bdoc-content\b', raw) or not raw.rstrip().endswith("</section>"):
        raise ValueError("Raw bytes are not a complete document section fragment")
    rendered = html_to_text(data["raw"], "utf-8")
    if normalize(rendered) != normalize(text):
        raise ValueError("Captured visible text does not exactly match the retained DOM text after whitespace-only removal")
    heading = r"(?m)^\s*(?:§\s*)?" + re.escape(section) + r"\.\s+\S"
    if not re.search(heading, rendered) or not re.search(r"Current (?:through|with legislation)", text):
        raise ValueError("Exact provision heading and displayed currency are required")
    meta = {
        "id": capture_id, "state": state, "url": receipt["url"], "finalUrl": receipt["url"],
        "status": None, "rendered": True, "representation": "browser_dom",
        "contentType": "text/html; charset=utf-8", "hostClass": "official_designated",
        "finalHostClass": "official_designated", "retrievedAt": stamp,
        "rawSha256": digest(data["raw"]), "rawBytes": len(data["raw"]),
        "textSha256": digest(data["text"]), "textBytes": len(data["text"]),
        "extraction": "Observed section.doc-content innerText with exact outerHTML fragment retained; not original HTTP response bytes",
        "browserReceipt": receipt, "textProof": "Complete DOM text equals observed text after whitespace-only removal; no non-whitespace character differs",
    }
    return meta, data


def ingest(receipt_path, output, state, section, capture_id):
    meta, data = load_receipt(receipt_path, state, section, capture_id)
    directory = Path(output) / "captures" / state
    files = {suffix: directory / (capture_id + suffix) for suffix in [".raw", ".txt", ".json"]}
    if any(path.exists() for path in files.values()):
        raise ValueError("Immutable capture already exists; use a new versioned identity")
    directory.mkdir(parents=True, exist_ok=True)
    files[".raw"].write_bytes(data["raw"])
    files[".txt"].write_bytes(data["text"])
    files[".json"].write_bytes((json.dumps(meta, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return meta


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    result = ingest(sys.argv[1], os.environ.get("LIM_WORK", "/tmp/lim/backfill"), sys.argv[2], sys.argv[3], sys.argv[4])
    print(json.dumps({"id": result["id"], "textBytes": result["textBytes"], "rawBytes": result["rawBytes"], "httpStatus": None, "textProof": result["textProof"]}))
