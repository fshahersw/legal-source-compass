"""Supreme Court opinions for the semantic index, read from the case-law reading store.

The opinion text lives in private object storage (bucket corpus-originals, keys caselaw/read/2026-09-30/...), one gzip member per
opinion, addressed by (key, offset, length) in the local index files private/build/caselaw_read/read/index/t1__scotus__*.tsv.gz
(the same pointers the case pages use through src/lib/external/caselaw.server.ts `readRange`). Reading needs the service
credential, so this module takes it from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the process environment (the loader
commands in the handoff source them); it never reads credential files and never prints them.

Selection: one opinion per case, the majority or lead opinion (type 010combined, 015unamimous, 020lead or 025plurality, in that
order of preference) with at least MIN_CHARS characters of text, so order-list entries and one-line dispositions are left out.
Cases are taken most-cited first (the citation count the case pages show), so a token budget leaves out the least cited cases
rather than an arbitrary slice. Text is checked against the index's text_sha256 before it is chunked; an opinion that does not
verify is skipped and counted, never embedded.
"""
from __future__ import annotations

import concurrent.futures as cf
import glob
import gzip
import hashlib
import json
import os
from collections.abc import Callable, Iterator

from chunking import Doc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
READ_DIR = os.path.join(ROOT, "private", "build", "caselaw_read")
BUCKET = "corpus-originals"
MIN_CHARS = 3000
TYPE_ORDER = ["010combined", "015unamimous", "020lead", "025plurality"]
KEY_PATTERN = "caselaw/read/"


def type_rank(t: str) -> int:
    return TYPE_ORDER.index(t) if t in TYPE_ORDER else len(TYPE_ORDER)


def load_index(index_dir: str | None = None, min_chars: int = MIN_CHARS) -> dict[str, dict]:
    """cluster_id -> the index row of its preferred majority/lead opinion (with enough text)."""
    best: dict[str, dict] = {}
    pattern = os.path.join(index_dir or os.path.join(READ_DIR, "read", "index"), "t1__scotus__*.tsv.gz")
    for path in sorted(glob.glob(pattern)):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            header = handle.readline().rstrip("\n").split("\t")
            ix = {h: i for i, h in enumerate(header)}
            for line in handle:
                f = line.rstrip("\n").split("\t")
                t = f[ix["type"]]
                if t not in TYPE_ORDER or int(f[ix["text_chars"]] or 0) < min_chars or not f[ix["key"]].startswith(KEY_PATTERN):
                    continue
                row = {k: f[i] for k, i in ix.items() if k in ("opinion_id", "cluster_id", "key", "offset", "length", "text_sha256", "text_chars", "type")}
                cur = best.get(row["cluster_id"])
                if cur is None or (type_rank(t), int(row["opinion_id"])) < (type_rank(cur["type"]), int(cur["opinion_id"])):
                    best[row["cluster_id"]] = row
    return best


def load_case_meta(clusters: set[str], meta_dir: str | None = None) -> dict[str, dict]:
    """Case name, date, citations and cited-by count of the selected Supreme Court cases (reads the case metadata parts)."""
    out: dict[str, dict] = {}
    for path in sorted(glob.glob(os.path.join(meta_dir or os.path.join(READ_DIR, "meta"), "cases-p*.jsonl.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if '"court_id":"scotus"' not in line:
                    continue
                r = json.loads(line)
                cid = str(r.get("cluster_id"))
                if cid in clusters:
                    out[cid] = {
                        "case_name": r.get("case_name") or "",
                        "date_filed": r.get("date_filed"),
                        "citations": r.get("citations") or [],
                        "cited_by": int(r.get("cited_by") or 0),
                    }
    return out


def selection(index_dir: str | None = None, meta_dir: str | None = None, min_chars: int = MIN_CHARS) -> list[dict]:
    idx = load_index(index_dir, min_chars)
    meta = load_case_meta(set(idx), meta_dir)
    rows = []
    for cid, row in idx.items():
        m = meta.get(cid)
        if not m or not m["case_name"]:
            continue  # a case without a recorded name cannot be titled; it is left out, not guessed
        rows.append({**row, **m})
    rows.sort(key=lambda r: (-r["cited_by"], int(r["cluster_id"])))
    return rows


class StorageReader:
    """One ranged read per opinion from the private bucket (HTTP 206 with the exact bytes), service credential from the environment."""

    def __init__(self, url: str | None = None, key: str | None = None):
        import requests

        self.url = (url or os.environ.get("EXTERNAL_SUPABASE_URL", "")).rstrip("/")
        self._key = key or os.environ.get("EXTERNAL_SUPABASE_KEY", "")
        if not self.url or not self._key:
            raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set in the environment for the opinion reader")
        self.session = requests.Session()

    def __call__(self, key: str, offset: int, length: int) -> bytes:
        import time

        headers = {"apikey": self._key, "Range": f"bytes={offset}-{offset + length - 1}"}
        if not self._key.startswith("sb_"):
            headers["Authorization"] = "Bearer " + self._key
        path = "/".join(requests_quote(p) for p in key.split("/"))
        delay = 1.0
        for attempt in range(5):
            try:
                r = self.session.get(f"{self.url}/storage/v1/object/{BUCKET}/{path}", headers=headers, timeout=60)
            except Exception as exc:  # noqa: BLE001 - network errors are retried
                if attempt == 4:
                    raise RuntimeError(f"opinion read failed ({type(exc).__name__})") from None
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 206 and len(r.content) == length:
                return r.content
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(delay)
                delay *= 2
                continue
            raise RuntimeError(f"opinion read failed (HTTP {r.status_code})")
        raise RuntimeError("opinion read failed")


def requests_quote(part: str) -> str:
    from urllib.parse import quote

    return quote(part, safe="")


def opinion_text(member: bytes, expected_sha256: str) -> str | None:
    """Decode one reading-store gzip member and return its text only when it matches the index's hash."""
    try:
        rec = json.loads(gzip.decompress(member).decode("utf-8"))
    except (OSError, ValueError, EOFError):
        return None
    text = rec.get("text")
    if not isinstance(text, str) or hashlib.sha256(text.encode("utf-8")).hexdigest() != expected_sha256:
        return None
    return text


def scotus_doc(row: dict, text: str) -> Doc:
    year = (row.get("date_filed") or "")[:4]
    cites = [c for c in row.get("citations") or [] if isinstance(c, str)]
    cite = next((c for c in cites if " U.S. " in c), cites[0] if cites else "")
    label = " ".join(x for x in (row["case_name"], f"({year})" if year else "") if x)
    heading = " > ".join(x for x in ("Supreme Court of the United States", label, cite) if x)
    return Doc(
        dataset="caselaw_scotus",
        record_id=str(row["cluster_id"]),
        title=" ".join(x for x in (row["case_name"], f"({year})" if year else "") if x),
        heading=heading,
        text=text,
        href=f"/cases/{row['cluster_id']}",
        source_url=None,
        max_chunks=60,
    )


def iter_scotus_opinions(
    reader: Callable[[str, int, int], bytes] | None = None,
    rows: list[dict] | None = None,
    workers: int = 8,
    lookahead: int = 64,
    skipped: dict | None = None,
) -> Iterator[Doc]:
    reader = reader or StorageReader()
    rows = rows if rows is not None else selection()
    skipped = skipped if skipped is not None else {}

    def load(row: dict) -> Doc | None:
        try:
            text = opinion_text(reader(row["key"], int(row["offset"]), int(row["length"])), row["text_sha256"])
        except RuntimeError:
            skipped["unreadable"] = skipped.get("unreadable", 0) + 1
            return None
        if text is None:
            skipped["hash_mismatch"] = skipped.get("hash_mismatch", 0) + 1
            return None
        return scotus_doc(row, text)

    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for start in range(0, len(rows), lookahead):
            for doc in pool.map(load, rows[start : start + lookahead]):
                if doc is not None:
                    yield doc
