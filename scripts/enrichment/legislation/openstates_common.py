"""Pure helpers for state bill records built from the Open States public data dump."""
from __future__ import annotations

import re

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "PR": "Puerto Rico", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
JURIS = re.compile(r"^ocd-jurisdiction/country:us/(?:state|district|territory):([a-z]{2})/government$")
SPECIAL = re.compile(r"special|extraordinary|extra session|called session", re.I)
TODAY = "2026-10-23"

SELECTION_RULE = (
    "For each jurisdiction, the current session is the most recent regular session that has bills in the dump and has "
    "started (start date on or before the build date, or no start date); the preceding session is the regular session "
    "before it with bills. Sessions are ordered by the latest first-action date of their bills (then start date), because "
    "Open States' session start dates are occasionally wrong. A session is regular unless Open States classifies it "
    "'special' or its published name says special, extraordinary, extra or called session.")
MILESTONE_RULES = {
    "introduced": "earliest action classified 'introduction'",
    "passed_lower": "earliest action classified 'passage' by the lower chamber",
    "passed_upper": "earliest action classified 'passage' by the upper chamber",
    "passed_legislature": "earliest action classified 'passage' by a unicameral legislature or council",
    "executive_signature": "earliest action classified 'executive-signature'",
    "executive_veto": "earliest action classified 'executive-veto'",
    "became_law": "earliest action classified 'became-law'",
}
MILESTONE_ORDER = ["introduced", "passed_lower", "passed_upper", "passed_legislature", "executive_veto", "executive_signature",
                   "became_law"]
OFFICIAL_EXCLUDE = re.compile(r"(^|\.)(openstates\.org|pluralpolicy\.com|findlaw\.com|justia\.com|ballotpedia\.org|"
                              r"legiscan\.com|westlaw\.com|lexis\w*\.com|casetext\.com|govtrack\.us|fastdemocracy\.com)$", re.I)


def abbr(jurisdiction_id: str) -> str | None:
    m = JURIS.match(jurisdiction_id or "")
    return m.group(1).upper() if m else None


def is_regular(session: dict) -> bool:
    return session.get("classification") != "special" and not SPECIAL.search(session.get("name") or "")


def pg_array(value: str | None) -> list[str]:
    """Postgres text[] in COPY text form ('{a,b,"c d"}') -> list of strings."""
    if not value or value in ("{}", ""):
        return []
    inner = value.strip()
    if inner.startswith("{") and inner.endswith("}"):
        inner = inner[1:-1]
    out, buf, quoted, esc = [], [], False, False
    for ch in inner:
        if esc:
            buf.append(ch)
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [x for x in out if x != "" and x.upper() != "NULL"]


def day(ts: str | None) -> str | None:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", ts or "")
    return m.group(1) if m else None


def slug(s: str, keep_dash: bool = True) -> str:
    s = (s or "").lower()
    return re.sub(r"[^a-z0-9]+", "-" if keep_dash else "", s).strip("-")


def record_id(st: str, session_identifier: str, identifier: str) -> str:
    return f"{st.lower()}-{slug(session_identifier) or 'session'}-{slug(identifier, keep_dash=False) or 'bill'}"


def ident_key(identifier: str) -> str:
    """Identifier as a filter key: letters and digits only, upper case ('AB 1' -> 'AB1')."""
    return re.sub(r"[^A-Za-z0-9]", "", identifier or "").upper()


def openstates_url(st: str, session_identifier: str, identifier: str) -> str:
    """The Open States bill page (secondary link): https://openstates.org/{state}/bills/{session}/{identifier}/."""
    from urllib.parse import quote

    return f"https://openstates.org/{st.lower()}/bills/{quote(session_identifier, safe='')}/{quote(re.sub(r'\s+', '', identifier), safe='')}/"


def official_sources(sources: list[dict]) -> list[dict]:
    """Source URLs Open States recorded for the bill, http(s) only, excluding Open States itself and commercial hosts."""
    from urllib.parse import urlparse

    out, seen = [], set()
    for s in sources:
        url = (s.get("url") or "").strip()
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.netloc or OFFICIAL_EXCLUDE.search(p.hostname or ""):
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "note": s.get("note") or None})
    return out


def milestones(actions: list[dict], org_class: dict[str, str]) -> dict:
    """{name: {"date", "description"} | None} from Open States action classifications and the acting organization."""
    found: dict[str, dict | None] = {k: None for k in MILESTONE_RULES}
    for a in sorted(actions, key=lambda a: (a.get("date") or "", int(a.get("order") or 0))):
        d = day(a.get("date"))
        if not d:
            continue
        cls = set(a.get("classification") or [])
        org = org_class.get(a.get("organization_id") or "", "")
        names = []
        if "introduction" in cls:
            names.append("introduced")
        if "passage" in cls:
            names.append({"lower": "passed_lower", "upper": "passed_upper"}.get(org, "passed_legislature" if org == "legislature" else ""))
        if "executive-signature" in cls:
            names.append("executive_signature")
        if "executive-veto" in cls:
            names.append("executive_veto")
        if "became-law" in cls:
            names.append("became_law")
        for n in names:
            if n and found[n] is None:
                found[n] = {"date": d, "description": a.get("description")}
    return found


OUTCOME_RULE = ("'enacted' when Open States classifies an action 'became-law' or 'executive-signature'; 'vetoed' when an "
                "action is classified 'executive-veto' and neither of those; otherwise 'none' (no enactment recorded).")


def outcome(ms: dict) -> str:
    if ms.get("became_law") or ms.get("executive_signature"):
        return "enacted"
    if ms.get("executive_veto"):
        return "vetoed"
    return "none"


def status(ms: dict) -> tuple[str, str]:
    if ms.get("became_law"):
        return "became_law", "Became law"
    if ms.get("executive_signature"):
        return "signed", "Signed by the executive"
    if ms.get("executive_veto"):
        return "vetoed", "Vetoed"
    if ms.get("passed_lower") and ms.get("passed_upper"):
        return "passed_both", "Passed both chambers"
    if ms.get("passed_legislature"):
        return "passed_legislature", "Passed the legislature"
    if ms.get("passed_lower"):
        return "passed_lower", "Passed lower chamber"
    if ms.get("passed_upper"):
        return "passed_upper", "Passed upper chamber"
    if ms.get("introduced"):
        return "introduced", "Introduced"
    return "not_recorded", "Not recorded"
