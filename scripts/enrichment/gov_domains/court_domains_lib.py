"""Court domains among the registered government domains, matched to the court directory only on an exact name.

Pure functions (the report script reads the files). A registry entry is a court-domain *candidate* when a name the publisher
gives for it (CISA organization or suborganization; GSA agency, maintaining office or note) contains the word Court, Courts,
Judicial or Judiciary, or when its domain text contains "court" or "judic". A candidate is *matched* to a court directory
entry only when one of the publisher's names equals the directory entry's title (case and spacing ignored, nothing else),
exactly one entry has that title, and the publisher's state does not contradict the entry's state. A name that equals a
title in another state, or equals only a short name, is listed apart and never matched.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

NAME_WORD = re.compile(r"\bcourts?\b|\bjudiciary\b|\bjudicial\b", re.I)
DOMAIN_WORD = re.compile(r"court|judic", re.I)
OFFICE_WORD = re.compile(
    r"\b(clerk|administrator|reporter|security|services|advocate|probation|marshal|bailiff|police|sheriff|commission|library|law enforcement|ems|board)\b",
    re.I,
)


def norm(name: str) -> str:
    """Case, spacing and Unicode composition only (a typographic apostrophe is the plain one)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", name).replace("’", "'")).strip().rstrip(".").casefold()


def publisher_names(gov: dict) -> list[tuple[str, str]]:
    """[(field, text)] for every name the publishers give an entry, in a fixed order."""
    out: list[tuple[str, str]] = []
    cisa = gov.get("cisa")
    if cisa:
        for field in ("organization", "suborganization"):
            if cisa.get(field):
                out.append((f"CISA {field}", cisa[field]))
    gsa = gov.get("gsa")
    if gsa:
        for row in gsa.get("rows", []):
            for field, label in (("agency", "GSA agency"), ("maintaining_office", "GSA maintaining office"), ("note", "GSA note")):
                if row.get(field):
                    out.append((label, row[field]))
    seen = set()
    unique = []
    for item in out:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def is_candidate(gov: dict) -> tuple[bool, str]:
    """(candidate?, why): the first publisher name with a court word, else a domain with court text, else not a candidate."""
    for field, text in publisher_names(gov):
        if NAME_WORD.search(text):
            return True, f"{field} names a court or judiciary"
    if DOMAIN_WORD.search(gov.get("host", "")):
        return True, "only the domain text contains court (no publisher name does)"
    return False, ""


def directory_index(spine: list[dict]) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    titles: dict[str, list[dict]] = defaultdict(list)
    shorts: dict[str, list[dict]] = defaultdict(list)
    for court in spine:
        titles[norm(court["title"])].append(court)
        if court.get("short_name"):
            shorts[norm(court["short_name"])].append(court)
    return titles, shorts


def match_court(gov: dict, titles: dict[str, list[dict]], shorts: dict[str, list[dict]]) -> dict:
    """Outcome for one candidate: status matched | state_differs | ambiguous | short_name_only | unmatched, with detail."""
    states = set(gov.get("states") or [])
    different_state = None
    ambiguous = None
    short_only = None
    for field, text in publisher_names(gov):
        key = norm(text)
        found = titles.get(key, [])
        if found:
            ok = [c for c in found if not (c.get("state") and states and c["state"] not in states)]
            if len(ok) == 1:
                c = ok[0]
                agree = "the directory entry gives no state" if not c.get("state") else f"state {c['state']} agrees with the publisher"
                return {"status": "matched", "field": field, "name": text, "court": c, "detail": f"{field} equals the directory title; {agree}"}
            if len(ok) > 1:
                ambiguous = ambiguous or {"status": "ambiguous", "field": field, "name": text, "courts": ok, "detail": f"{len(ok)} directory entries have this title"}
            else:
                different_state = different_state or {
                    "status": "state_differs",
                    "field": field,
                    "name": text,
                    "courts": found,
                    "detail": f"same name as {', '.join(c['id'] for c in found)} but the publisher's state ({', '.join(sorted(states)) or 'none'}) is not the directory's ({', '.join(c.get('state') or 'none' for c in found)})",
                }
        elif shorts.get(key):
            short_only = short_only or {"status": "short_name_only", "field": field, "name": text, "courts": shorts[key], "detail": f"equals the short name of {', '.join(c['id'] for c in shorts[key])}, not a title"}
    return ambiguous or different_state or short_only or {"status": "unmatched", "detail": "no directory entry has a title equal to any name the publisher gives"}


def classify_name(gov: dict) -> str:
    """Informational: does the court-word name look like a court itself or an office/body around one?"""
    for _, text in publisher_names(gov):
        if NAME_WORD.search(text):
            return "office or body around a court" if OFFICE_WORD.search(text) else "names a court"
    return "domain text only"
