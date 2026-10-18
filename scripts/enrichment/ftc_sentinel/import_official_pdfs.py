"""Copy the official FTC PDFs into private/acq/ftc_sentinel/pdf/ byte-identical and register them in the manifest.

ftc.gov answers this stream's requests with a bot wall (404), so the official PDFs are taken from the independent
verifier's polite download (private/scratch/enrich/verify_jpml_ftc/ftc_raw/, read only). Each copy is accepted only when
its sha256 equals the one in the verifier's download log, and is registered with that provenance. Idempotent.

Usage: python3 -I -B import_official_pdfs.py
"""
import hashlib
import json
import os
import shutil
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(ROOT, "private", "scratch", "enrich", "verify_jpml_ftc", "ftc_raw")
DST = os.path.join(ROOT, "private", "acq", "ftc_sentinel", "pdf")
MANIFEST = os.path.join(ROOT, "private", "acq", "ftc_sentinel", "_manifest.jsonl")
METHOD = ("official PDF downloaded 2026-10-18 by the independent verifier (direct HTTPS GET from ftc.gov) and copied byte-identical; "
          "sha256 equals the verifier's download log (private/scratch/enrich/verify_jpml_ftc/ftc_raw/_download_log.json)")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    with open(os.path.join(SRC, "_download_log.json")) as handle:
        log = json.load(handle)
    known = set()
    with open(MANIFEST) as handle:
        for line in handle:
            if line.strip():
                known.add(json.loads(line)["path"])
    os.makedirs(DST, exist_ok=True)
    added = 0
    for url, status, size, digest, when in log:
        name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        if not name.lower().endswith(".pdf"):
            continue
        if not os.path.exists(os.path.join(SRC, name)):
            name = name.replace(" ", "_")  # the verifier saved 'CSN Annual Data Book 2021 Final PDF.pdf' with underscores
        src = os.path.join(SRC, name)
        if not os.path.exists(src):
            sys.exit(f"missing {src}")
        if sha256(src) != digest or os.path.getsize(src) != size:
            sys.exit(f"{name}: file differs from the verifier's download log")
        dst = os.path.join(DST, name)
        if not os.path.exists(dst):
            shutil.copyfile(src, dst)
        if sha256(dst) != digest:
            sys.exit(f"{name}: copy differs")
        rel = os.path.relpath(dst, ROOT)
        if rel in known:
            continue
        entry = {"url": url, "final_url": url, "path": rel, "sha256": digest, "bytes": size, "retrieved_at": when, "status": status,
                 "method": METHOD, "content_type": "application/pdf"}
        with open(MANIFEST, "a") as handle:
            handle.write(json.dumps(entry) + "\n")
        added += 1
    print(f"registered {added} official PDFs")


if __name__ == "__main__":
    main()
