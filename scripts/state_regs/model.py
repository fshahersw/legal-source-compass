"""Normalized model of state administrative codes (state-regs/1).

Field names follow the state-statutes model where the two overlap (src/lib/law/stateCodeContract.ts and
scripts/enrichment/state_statutes/codebuild.py: citation, heading, text, history, edition, currency, source_url, status);
regulations add agency, rule number, register citation, effective/adopted dates and the emergency flag.

Node (one heading of the official table of contents: title, agency, chapter, subchapter, part, division, rule set):
  id            "<st>:<key>"  key unique within the state, built from the official numbering
  state         USPS code
  parent_id     id of the enclosing node or None (top level)
  level         the publisher's own word for the level ("title", "agency", "chapter", "subchapter", "division", ...)
  num           number as printed ("3745-31", "173-400", "7011")
  heading       caption as printed (None when the publisher prints none)
  agency        issuing agency as printed on the page (None when the page names none)
  citation      the unit's citation as the code prints it ("Chapter 173-400 WAC")
  source_url    official address of the unit
  ordinal       position in the publisher's order (0-based, within the state)
  rule_count    rules listed under the node on the publisher's page (None when not listed)

Rule (one rule / section / part of the code, the unit a citation points at):
  id            "<st>:<cite_key>"
  state, node_id (the enclosing node), number (as printed), citation (official form), cite_key (cite.cite_key)
  heading, agency, text (the published body; paragraphs joined by "\\n"), history (source note as printed),
  authority (statutory authority as printed), status ("active" or the publisher's word: "repealed", "reserved",
  "expired", "transferred"), emergency (True only when the publisher marks the rule as emergency/temporary; False when it
  marks it permanent; None when it says neither), effective_date / adopted_date (ISO date only when printed as a date for
  the current version), register_citation (the latest register entry the publisher prints for the rule, as printed),
  source_url, edition / currency (statements as printed), retrieved_at, raw_sha256 (sha256 of the unchanged response
  bytes the rule was cut from), text_sha256, text_check (exact-text check against an independent rendering).

Register issue (corpus dataset state_register_issues; built by the edge adapter src/lib/ingest/sources/stateRegisters.ts):
  state, publication, volume, issue, issue_date, url, title.

Unknown values are None (shown as "Not recorded"); nothing is inferred.
"""
from __future__ import annotations

import hashlib
import re

from cite import cite_key  # noqa: F401  (re-exported)

NODE_KEYS = ("id", "state", "parent_id", "level", "num", "heading", "agency", "citation", "source_url", "ordinal", "rule_count")
RULE_KEYS = ("id", "state", "node_id", "number", "citation", "cite_key", "heading", "agency", "text", "history", "authority",
             "status", "emergency", "effective_date", "adopted_date", "register_citation", "source_url", "edition", "currency",
             "retrieved_at", "raw_sha256", "text_sha256", "text_check")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID = re.compile(r"^[a-z]{2}:[A-Za-z0-9][A-Za-z0-9.:_()/-]{0,120}$")


def node(state: str, key: str, *, level: str, num: str | None, heading: str | None, source_url: str,
         parent_id: str | None = None, agency: str | None = None, citation: str | None = None, ordinal: int = 0,
         rule_count: int | None = None) -> dict:
    n = {"id": f"{state.lower()}:{key}", "state": state, "parent_id": parent_id, "level": level, "num": num,
         "heading": clean(heading), "agency": clean(agency), "citation": clean(citation), "source_url": source_url,
         "ordinal": ordinal, "rule_count": rule_count}
    check_node(n)
    return n


def rule(state: str, *, number: str, citation: str, node_id: str | None, heading: str | None, text: str | None,
         source_url: str, raw_sha256: str, retrieved_at: str, agency: str | None = None, history: str | None = None,
         authority: str | None = None, status: str = "active", emergency: bool | None = None,
         effective_date: str | None = None, adopted_date: str | None = None, register_citation: str | None = None,
         edition: str | None = None, currency: str | None = None, key: str | None = None) -> dict:
    ck = key or cite_key(state, citation)
    if not ck:
        raise ValueError(f"{state}: no citation key for {citation!r}")
    body = text if text and text.strip() else None
    r = {"id": f"{state.lower()}:{ck}", "state": state, "node_id": node_id, "number": number, "citation": citation,
         "cite_key": ck, "heading": clean(heading), "agency": clean(agency), "text": body, "history": clean_lines(history),
         "authority": clean_lines(authority), "status": status, "emergency": emergency, "effective_date": effective_date,
         "adopted_date": adopted_date, "register_citation": clean(register_citation), "source_url": source_url,
         "edition": edition, "currency": currency, "retrieved_at": retrieved_at, "raw_sha256": raw_sha256,
         "text_sha256": hashlib.sha256(body.encode()).hexdigest() if body else None, "text_check": None}
    check_rule(r)
    return r


def clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = " ".join(s.replace("\xa0", " ").split())
    return s or None


def clean_lines(s: str | None) -> str | None:
    """Whitespace collapsed within lines; line breaks (the publisher's entries) kept; empty lines dropped."""
    if s is None:
        return None
    lines = [" ".join(x.replace("\xa0", " ").split()) for x in s.split("\n")]
    out = "\n".join(x for x in lines if x)
    return out or None


def check_node(n: dict) -> None:
    assert set(n) == set(NODE_KEYS), sorted(set(n) ^ set(NODE_KEYS))
    assert ID.match(n["id"]), n["id"]
    assert n["source_url"].startswith(("https://", "http://")), n["source_url"]
    assert n["level"] and n["level"] == n["level"].lower(), n["level"]


def check_rule(r: dict) -> None:
    assert set(r) == set(RULE_KEYS), sorted(set(r) ^ set(RULE_KEYS))
    assert ID.match(r["id"]), r["id"]
    assert r["source_url"].startswith(("https://", "http://")), r["source_url"]
    for k in ("effective_date", "adopted_date"):
        assert r[k] is None or ISO.match(r[k]), (k, r[k])
    assert r["emergency"] in (None, True, False)
    assert r["status"] and r["status"] == r["status"].lower(), r["status"]
    assert re.fullmatch(r"[0-9a-f]{64}", r["raw_sha256"]), r["raw_sha256"]


MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                       "october", "november", "december"], 1)}


def us_date(s: str | None) -> str | None:
    """ISO date from 'August 14, 2025', '8/14/2025', '8/14/25' or '2025-08-14' as printed; None otherwise."""
    if not s:
        return None
    s = s.strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return s
    m = re.fullmatch(r"([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})", s)
    if m and m.group(1).lower() in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})", s)
    if m:
        y = int(m.group(3))
        if y < 100:
            y += 2000 if y < 70 else 1900
        mo, d = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None
