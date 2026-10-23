"""The pruned source rows the scheduled semantic refresh reads (pure functions, no I/O).

The refresh (supabase/functions/semantic-refresh/) rebuilds a record's passages from the fields sources.py reads, and only
from those. The database hands it a pruned copy of the corpus_records row (semantic.source_input in
database/contracts/semantic-refresh-v1.sql); its sha256 is the record's change fingerprint. This module is the Python mirror
of that projection: `prune(dataset, row)` keeps exactly the fields of SPECS, so

    sources builder(row) == sources builder(prune(dataset, row))

for every row (checked on the golden fixture by test_chunk_parity.py and on the full build files by refresh_parity.mjs), and
the database's projection of the same row equals `prune` (checked offline by semantic-refresh-sql.test.mjs).

U.S. Code sections also carry `_title_names`: [number, name] of every us_code_titles row whose number (as JSON text) equals
the section's title (as JSON text), in ordinal order, which is what sources._usc_title_names needs for that one title.
"""
from __future__ import annotations

import json
from typing import Any

# Leaf = True; a dict descends into an object (a non-object value is kept as it is, as the SQL projection does).
SPECS: dict[str, dict[str, Any]] = {
    "us_code_sections": {
        "id": True, "title": True, "source_url": True, "text": True,
        "detail": {"usc": {"title": True, "key": True, "citation": True, "heading": True, "path": True}},
    },
    "ecfr_sections_full": {
        "id": True, "title": True, "source_url": True, "text": True,
        "detail": {"reserved": True, "title_number": True, "identifier": True, "subtitle": True, "ecfr_url": True},
        "item": {"subtitle": True},
    },
    "crs_reports": {
        "id": True, "title": True, "source_url": True,
        "detail": {"crs": {"title": True, "topics": True, "contentType": True}},
        "item": {"cells": {"title": True}},
    },
    "congress_bills": {
        "id": True, "title": True, "source_url": True,
        "detail": {"bill": {
            "titles": {"display": True, "official": True}, "display": True, "subjects": True, "policyArea": True,
            "summary": True, "type": True, "number": True, "congress": True,
        }},
        "item": {"cells": {"citation": True}},
    },
    "oversight_reports": {
        "id": True, "title": True, "source_url": True,
        "item": {"oversight": {"description": True, "oig": True, "agency_reviewed": True, "type": True}},
    },
    "doj_oig_reports": {
        "id": True, "title": True, "source_url": True,
        "item": {"dojoig": {"components": True, "type": True, "entity": True, "location": True, "description": True}},
    },
    "ftc_publications_index": {
        "id": True, "title": True, "source_url": True,
        "item": {"summary": True, "page_url": True, "cells": {"series": True}},
    },
}


def _pick(spec: Any, value: Any) -> Any:
    if spec is True or not isinstance(value, dict):
        return value
    return {k: _pick(sub, value.get(k)) for k, sub in spec.items()}


def json_text(value: Any) -> str | None:
    """What Postgres `->>` returns for a JSON value (None for JSON null or a missing key)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def title_names(section_row: dict, title_rows: list[dict]) -> list[list[Any]]:
    """[number, name] of the us_code_titles rows (in their order) whose number matches the section's title number."""
    usc = (section_row.get("detail") or {}).get("usc")
    want = json_text(usc.get("title")) if isinstance(usc, dict) else None
    out = []
    for t in title_rows:
        ut = (t.get("detail") or {}).get("usc_title")
        if not isinstance(ut, dict):
            continue
        if want is not None and json_text(ut.get("number")) == want:
            out.append([ut.get("number"), ut.get("name")])
    return out


def prune(dataset: str, row: dict, title_rows: list[dict] | None = None) -> dict:
    out = {k: _pick(spec, row.get(k)) for k, spec in SPECS[dataset].items()}
    if dataset == "us_code_sections":
        out["_title_names"] = title_names(row, title_rows or [])
    return out


def titles_map(pairs: list[list[Any]]) -> dict[str, str]:
    """sources._usc_title_names restricted to the pairs a pruned section row carries."""
    import sources as src

    out: dict[str, str] = {}
    for number, name in pairs:
        if number is not None and name:
            out[str(number)] = src._one_line(name)
    return out
