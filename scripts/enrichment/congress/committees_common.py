"""Pure helpers for `congress_committees` (no I/O, no network): what the Congress.gov API publishes about committees and
subcommittees, normalised for the corpus pages.

The committee endpoints publish the committee itself (name, type, chamber, parent, subcommittees, official website, current or
historical flag, name history with establishing authority) and counts of related material (reports, bills, communications,
nominations). They publish no list of members: the Congress.gov API has no committee-membership endpoint, so no membership is
stored or shown, and no other source is used for it (PUBLISHES_MEMBERSHIP records that decision for the dataset summary).
"""
from __future__ import annotations

import re

import members_common as mc

SYSTEM_CODE = re.compile(r"^[hsj][a-z0-9]{3}\d{2}$")
# Older committees carry a Library of Congress authority-style id instead of a system code (n79043123, no94026591, n2005025889).
COMMITTEE_ID = re.compile(r"^(?:[hsj][a-z0-9]{3}\d{2}|no?\d{6,10})$")
CHAMBER_PATH = {"House": "house", "Senate": "senate", "Joint": "joint"}
PUBLISHES_MEMBERSHIP = False
COUNT_KEYS = ("reports", "bills", "communications", "nominations")


def chamber_path(chamber: str | None) -> str | None:
    return CHAMBER_PATH.get(chamber or "")


def is_subcommittee(code: str, parent: dict | None = None) -> bool:
    """A committee the API gives a parent is a subcommittee. Otherwise the API's own rule for system codes: a full committee's
    code ends in 00, a subcommittee's in other digits. An authority-style id (n79043123) says nothing, so it is a committee."""
    if isinstance(parent, dict) and parent.get("systemCode"):
        return True
    return bool(SYSTEM_CODE.match(code)) and not code.endswith("00")


def parent_code(code: str) -> str | None:
    return code[:-2] + "00" if bool(SYSTEM_CODE.match(code)) and not code.endswith("00") else None


def day(v) -> str | None:
    s = mc.text(v)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s or "")
    return m.group(1) if m else None


def history(detail: dict | None) -> list[dict]:
    """The committee's name history as published (official name, short name, dates, type, establishing authority, linked ids).
    A date the API does not give is absent: an open end date is not 'present' unless the committee is flagged current."""
    out = []
    for h in (detail or {}).get("history") or []:
        if not isinstance(h, dict):
            continue
        row = {"officialName": mc.text(h.get("officialName")), "libraryOfCongressName": mc.text(h.get("libraryOfCongressName")),
               "startDate": day(h.get("startDate")), "endDate": day(h.get("endDate")),
               "committeeTypeCode": mc.text(h.get("committeeTypeCode")), "establishingAuthority": mc.text(h.get("establishingAuthority")),
               "locLinkedDataId": mc.text(h.get("locLinkedDataId")), "superintendentDocumentNumber": mc.text(h.get("superintendentDocumentNumber")),
               "naraId": mc.text(h.get("naraId"))}
        row = {k: v for k, v in row.items() if v}
        if row:
            out.append(row)
    out.sort(key=lambda r: r.get("startDate") or "")
    return out


def api_counts(detail: dict | None) -> dict[str, int]:
    """Counts of related material the API reports for the committee; a block the API omits has no entry (not zero)."""
    out: dict[str, int] = {}
    for k in COUNT_KEYS:
        n = mc.count_of((detail or {}).get(k))
        if n is not None:
            out[k] = n
    return out


def subcommittees(detail: dict | None) -> list[dict]:
    out, seen = [], set()
    for s in (detail or {}).get("subcommittees") or []:
        code = mc.text((s or {}).get("systemCode")) if isinstance(s, dict) else None
        if code and COMMITTEE_ID.match(code) and code not in seen:
            seen.add(code)
            out.append({"systemCode": code, "name": mc.text(s.get("name"))})
    return out


def parent_of(detail: dict | None, known: set[str]) -> dict | None:
    """The parent the API names. `listed` says whether that code is itself a committee in the list (a link is offered only then)."""
    p = (detail or {}).get("parent")
    code = mc.text(p.get("systemCode")) if isinstance(p, dict) else None
    if not code or not COMMITTEE_ID.match(code):
        return None
    return {"systemCode": code, "name": mc.text(p.get("name")), "listed": code in known}


def congresses_listed(code: str, by_congress: dict[str, list[str]]) -> list[int]:
    """The Congresses whose /committee/{congress} list names this system code (a Congress that does not list it is a gap)."""
    return sorted(int(c) for c, codes in by_congress.items() if code in codes)


def congress_ranges(numbers: list[int]) -> str | None:
    """'117th–119th' for consecutive Congresses, comma-separated runs otherwise ('117th, 119th'); None when empty."""
    ns = sorted(set(numbers))
    if not ns:
        return None
    runs, start, prev = [], ns[0], ns[0]
    for n in ns[1:]:
        if n == prev + 1:
            prev = n
            continue
        runs.append((start, prev))
        start = prev = n
    runs.append((start, prev))
    return ", ".join(mc.ordinal(a) if a == b else f"{mc.ordinal(a)}–{mc.ordinal(b)}" for a, b in runs)
