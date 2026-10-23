"""Upload acquired documents unchanged to the private bucket corpus-originals under judge_practices/<retrieval date>/ with a whole-object
SHA-256 readback, following scripts/enrichment/caselaw/store.py (credentials from the environment only; never printed or written).

Keys are content addressed: judge_practices/<YYYY-MM-DD>/<sha256>.<ext>. The object holds the exact response bytes; the content type is the
document's own (store.py's default of application/gzip is for its shards). put() returns the receipt (bucket, key, sha256, bytes, readback
sha256 and size, state) that the document record carries; the caller deletes the local copy only after a receipt with readback_ok.
"""
from __future__ import annotations

import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "caselaw"))

import store as caselaw_store  # noqa: E402  (scripts/enrichment/caselaw/store.py)

_lock = threading.Lock()

CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "rtf": "application/rtf",
    "wpd": "application/vnd.wordperfect",
    "odt": "application/vnd.oasis.opendocument.text",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt": "application/vnd.ms-powerpoint",
    "html": "text/html",
    "txt": "text/plain",
    "zip": "application/zip",
    "bin": "application/octet-stream",
}


class DocStore:
    def __init__(self):
        self.storage = caselaw_store.Storage()

    @staticmethod
    def key_for(date: str, sha256: str, ext: str) -> str:
        return f"judge_practices/{date}/{sha256}.{ext}"

    def put(self, path: str, date: str, sha256: str, nbytes: int, ext: str) -> dict:
        key = self.key_for(date, sha256, ext)
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with _lock:  # store.py reads its module-level CONTENT_TYPE when it uploads
            previous = caselaw_store.CONTENT_TYPE
            caselaw_store.CONTENT_TYPE = ctype
            try:
                receipt = self.storage.put_verified(key, path, sha256, nbytes, may_replace=None)
            finally:
                caselaw_store.CONTENT_TYPE = previous
        receipt["content_type"] = ctype
        return receipt

    def readback(self, key: str) -> tuple[int, str | None, int]:
        return self.storage.readback(key)
