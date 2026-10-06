"""Section-record schema, writer and validator shared by every state parser (staging format).

A staged state directory (kept on the VM until uploaded; never in git) is:
  raw/<aa>/<sha256>         content-addressed originals
  captures.jsonl            one line per request (see sc_capture.Capturer)
  source.json               publisher, edition, currency, base URLs, terms/gate notes
  parser-manifest.json      parser name/version/script sha256, inputs, outputs, counts
  sections.jsonl            one SectionRecord per line
  units.jsonl               title/chapter/article containers with capture hashes (optional)
  audit.json                reconciliation of parsed output against the publisher's own TOC/index
Values are exactly as published; unknown values are None, never guessed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

SECTION_FIELDS = (
    "state",              # two-letter USPS code
    "citation",           # official citation display, e.g. "Conn. Gen. Stat. § 52-577"
    "citation_key",       # publisher's section number as printed, e.g. "52-577"
    "citation_path",      # list of {"level","label","heading"} from code root down to the section
    "heading",            # section catchline as published
    "text",               # section body exactly as published (no paraphrase)
    "history",            # history / source / amendment notes as published, or None
    "effective",          # effective-date / currency statement attached to the section as published, or None
    "status",             # "active" | "repealed" | "reserved" | "transferred" | "expired" | "other" (as published)
    "version_label",      # edition label as published, e.g. "2025 Supplement"
    "currency_date",      # publisher's currency date string as published, or None
    "source_url",         # URL of the capture the section was parsed from
    "capture_sha256",     # sha256 of that capture's raw bytes
    "span",               # [start,end) Unicode code-point offsets of the section within the capture's decoded text, or None
    "text_sha256",        # sha256 of text (utf-8)
    "occurrence",         # 1 for the first occurrence of citation_key in the capture, then 2,3...
)
STATUSES = {"active", "repealed", "reserved", "transferred", "expired", "other"}


def make_record(**kw) -> dict:
    rec = {k: kw.pop(k, None) for k in SECTION_FIELDS}
    if kw:
        raise TypeError(f"unknown fields: {sorted(kw)}")
    if rec["text"] is not None and rec["text_sha256"] is None:
        rec["text_sha256"] = hashlib.sha256(rec["text"].encode("utf-8")).hexdigest()
    if rec["occurrence"] is None:
        rec["occurrence"] = 1
    return rec


def validate(rec: dict) -> list[str]:
    errs = []
    for k in ("state", "citation", "citation_key", "citation_path", "source_url", "capture_sha256", "status"):
        if not rec.get(k):
            errs.append(f"missing {k}")
    if rec.get("status") not in STATUSES:
        errs.append(f"bad status {rec.get('status')!r}")
    if rec.get("text") is None:
        errs.append("text is None (use '' only when the publisher prints no text)")
    elif hashlib.sha256(rec["text"].encode("utf-8")).hexdigest() != rec.get("text_sha256"):
        errs.append("text_sha256 mismatch")
    if set(rec) != set(SECTION_FIELDS):
        errs.append("field set differs from SECTION_FIELDS")
    return errs


def write_jsonl(path: Path, rows) -> dict:
    h = hashlib.sha256()
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            line = json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n"
            f.write(line)
            h.update(line.encode("utf-8"))
            n += 1
    return {"path": str(path), "records": n, "sha256": h.hexdigest()}
