"""Extract the id sets the cross-links resolve against, from the build files of the datasets already published.

  python3 -I -B make_lookups.py

Reads (all produced by the uscode, ecfr_full and agencies_fr streams and published unchanged):
  private/build/uscode/us_code_sections.json.gz               -> lookups/us_code_section_ids.json
  private/build/ecfr_full/ecfr_sections_full.rows.jsonl.gz    -> lookups/ecfr_part_ids.json   (rows with kind "part")
  private/build/agencies_fr/fr_agency_profiles.json.gz        -> lookups/fr_agency_slugs.json (federalregister.gov slug -> id)
Each lookup file records its source file, that file's sha256 and the row count, so the counts can be compared with the
live corpus (done with read-only SELECT counts in verify_ecfr_authorities.py's report).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build")
OUT = os.path.join(BUILD, "ecfr_authorities", "lookups")
FR_SLUG = re.compile(r"^https://www\.federalregister\.gov/agencies/([a-z0-9-]+)$")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write(name: str, payload: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, sort_keys=True)


def main() -> None:
    src = os.path.join(BUILD, "uscode", "us_code_sections.json.gz")
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    ids = {r["id"]: ((r.get("filters") or {}).get("status") or [""])[0] for r in rows}
    write("us_code_section_ids.json", {"source_file": os.path.relpath(src, ROOT), "sha256": sha256_file(src), "count": len(ids), "made_at": stamp(), "status_by_id": ids})
    print("us_code_sections", len(ids))

    src = os.path.join(BUILD, "ecfr_full", "ecfr_sections_full.rows.jsonl.gz")
    parts: dict[str, dict] = {}
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            f = r.get("filters") or {}
            if f.get("kind") == ["part"]:
                parts[r["id"]] = {"title": f["title"][0], "part": f["part"][0], "heading": r["title"]}
    write("ecfr_part_ids.json", {"source_file": os.path.relpath(src, ROOT), "sha256": sha256_file(src), "count": len(parts), "made_at": stamp(), "parts": parts})
    print("ecfr parts", len(parts))

    src = os.path.join(BUILD, "agencies_fr", "fr_agency_profiles.json.gz")
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        doc = json.load(fh)
    rows = doc["rows"] if isinstance(doc, dict) else doc
    write("fr_agency_rows.json", {"source_file": os.path.relpath(src, ROOT), "sha256": sha256_file(src), "count": len(rows), "made_at": stamp(), "rows": [{"id": r["id"], "item": {"links": (r.get("item") or {}).get("links", [])}} for r in rows]})
    print("fr agencies", len(rows))


if __name__ == "__main__":
    main()
