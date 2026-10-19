"""Court-name resolution and address extraction for the court_locations dataset.

Addresses are read only from text a court publishes on its own website. A location needs a street line (or P.O. box) followed by a
"City, ST 12345" line, or both on one line; anything less is not an address. Nothing is completed or corrected.
"""
from __future__ import annotations

import html
import re

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT",
    "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Guam": "GU", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
    "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Northern Mariana Islands": "MP", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Puerto Rico": "PR", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virgin Islands": "VI", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
CODES = set(STATES.values())
DIRECTIONS = {"Northern": "N.D.", "Southern": "S.D.", "Eastern": "E.D.", "Western": "W.D.", "Middle": "M.D.", "Central": "C.D."}

_STATE_ALT = "|".join(sorted((re.escape(s) for s in list(STATES) + sorted(CODES)), key=len, reverse=True))
_CITY = r"(?P<city>[A-Z][A-Za-z.' -]{1,40}?)"
CITY_LINE = re.compile(rf"^{_CITY},?\s+(?P<state>{_STATE_ALT})\.?,?\s+(?P<zip>\d{{5}})(?:-\d{{4}})?\b")
ONE_LINE = re.compile(rf"^(?P<street>(?:\d+[A-Za-z]?|One|Two|P\.?\s?O\.?\s+Box)\b[^,]{{2,80}}),\s*(?:(?P<suite>(?:Suite|Room|Ste\.?|Floor|Rm\.?)[^,]{{1,30}}),\s*)?"
                      rf"{_CITY},?\s+(?P<state>{_STATE_ALT})\.?,?\s+(?P<zip>\d{{5}})(?:-\d{{4}})?\b")
NAMED_ONE_LINE = re.compile(r"^(?P<name>[A-Z][^,|]{3,80}?(?:court\s?house|building|center|plaza|tower)),\s*(?P<rest>(?:\d+[A-Za-z]?|One|Two)\b.*)$", re.I)
STREET = re.compile(r"^(?:\d+[A-Za-z]?(?:-\d+)?\s+\S|One\s+\S|Two\s+\S|P\.?\s?O\.?\s+Box\b)", re.I)
SUITE = re.compile(r"^(?:Suite|Room|Ste\.?|Floor|\d+(?:st|nd|rd|th) Floor|Rm\.?|Mail Stop)\b", re.I)
BUILDING = re.compile(r"court\s?house|courthouse|federal|building|center|plaza|tower|u\.\s?s\.|united states|bankruptcy court|district court|court of appeals|clerk", re.I)
NOT_COURT = re.compile(r"pacer service center|probation|pretrial services|u\.?s\.? attorney|\bu\.?s\.? marshals?\b|marshals service|federal defender|public defender|\bu\.?s\.? trustee", re.I)
_LABEL = re.compile(r"^(?:(?:mailing|physical|street|delivery|courthouse|office|clerk'?s office) )?address:\s*", re.I)
_MAP = re.compile(r"\(\s*(?:map|directions|view map|google map)\s*\)", re.I)
_BLOCK = re.compile(r"(?i)<br\s*/?>|</?(p|div|li|tr|td|th|h\d|address|section|footer|span class=\"address[^\"]*\")[^>]*>")


def label_short_names(label: str) -> list[str]:
    """Court short names a uscourts.gov link label can stand for ("Alabama Middle" -> "M.D. Alabama", "Idaho" -> "D. Idaho")."""
    label = " ".join(label.split())
    m = re.match(r"^(.*?) ((?:Northern|Southern|Eastern|Western|Middle|Central)(?: (?:&|and) (?:Northern|Southern|Eastern|Western|Middle|Central))?)$", label)
    if m:
        state = m.group(1)
        return [f"{DIRECTIONS[d]} {state}" for d in re.split(r" (?:&|and) ", m.group(2))]
    return [f"D. {label}", label]


def page_lines(page: str) -> list[str]:
    page = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?s)<!--.*?-->", " ", page)
    page = _BLOCK.sub("\n", page)
    text = html.unescape(re.sub(r"<[^>]+>", " ", page)).replace("\xa0", " ")
    lines = [_LABEL.sub("", " ".join(_MAP.sub(" ", seg).split())) for l in text.split("\n") for seg in l.split(" | ")]
    lines = [l for l in lines if l]
    # rejoin a city, state and ZIP split across elements ("San Jose," / "CA" / "95113")
    out, i = [], 0
    while i < len(lines):
        if i + 2 < len(lines) and re.fullmatch(r"[A-Z][A-Za-z.' -]{1,40},?", lines[i]) and lines[i + 1] in CODES | set(STATES) \
                and re.fullmatch(r"\d{5}(-\d{4})?", lines[i + 2]):
            out.append(f"{lines[i].rstrip(',')}, {lines[i + 1]} {lines[i + 2]}")
            i += 3
        elif i + 1 < len(lines) and re.fullmatch(r"[A-Z][A-Za-z.' -]{1,40},?", lines[i]) and re.fullmatch(rf"(?:{_STATE_ALT})\.?,?\s+\d{{5}}(-\d{{4}})?", lines[i + 1]):
            out.append(f"{lines[i].rstrip(',')}, {lines[i + 1]}")
            i += 2
        else:
            out.append(lines[i])
            i += 1
    return out


def _state(s: str) -> str:
    return STATES.get(s, s)


_NOT_NAME = re.compile(r"^[(&\-–—]|\b(closed|please|hours|holiday|open|mail|visit|parking|directions|phone|fax|email|weekdays?|a\.m\.|p\.m\.)\b|:", re.I)


def building_name(line: str | None) -> str | None:
    """The line before a street is kept as the building name only when it reads as one."""
    if not line or len(line) > 120 or CITY_LINE.match(line) or _NOT_NAME.search(line) or not BUILDING.search(line):
        return None
    return line


def find_addresses(lines: list[str]) -> list[dict]:
    out = []
    for i, line in enumerate(lines):
        named = NAMED_ONE_LINE.match(line)
        m = ONE_LINE.match(named.group("rest")) if named else None
        if m:
            out.append({"name": named.group("name").strip(), "street": m.group("street").strip(), "street2": (m.group("suite") or "").strip() or None,
                        "city": m.group("city").strip(), "state": _state(m.group("state")), "zip": m.group("zip"), "line": i})
            continue
        m = ONE_LINE.match(line)
        if m:
            name = building_name(lines[i - 1]) if i > 0 else None
            out.append({"name": name, "street": m.group("street").strip(), "street2": (m.group("suite") or "").strip() or None, "city": m.group("city").strip(),
                        "state": _state(m.group("state")), "zip": m.group("zip"), "line": i})
            continue
        m = CITY_LINE.match(line)
        if not m or i == 0:
            continue
        j = i - 1
        street2 = None
        if SUITE.match(lines[j]) and j > 0:
            street2, j = lines[j], j - 1
        if not STREET.match(lines[j]) or len(lines[j]) > 90:
            continue
        street = lines[j]
        name = building_name(lines[j - 1]) if j > 0 else None
        out.append({"name": name, "street": street.rstrip(","), "street2": street2, "city": m.group("city").strip(), "state": _state(m.group("state")),
                    "zip": m.group("zip"), "line": i})
    return out


def keep(addr: dict, allowed_states: set[str] | None) -> str | None:
    """Reason to drop an address, or None to keep it."""
    joined = " ".join(x for x in (addr["name"], addr["street"], addr["street2"]) if x)
    if NOT_COURT.search(joined):
        return "names another office (PACER, probation, U.S. attorney, marshal, defender, trustee)"
    if addr["state"] not in CODES:
        return "state not recognised"
    if allowed_states is not None and addr["state"] not in allowed_states:
        return "outside the court's states"
    return None


def norm_street(s: str) -> str:
    s = s.lower().replace(".", "").replace(",", "")
    for a, b in ((" street", " st"), (" avenue", " ave"), (" boulevard", " blvd"), (" road", " rd"), (" drive", " dr"), (" place", " pl"),
                 (" north ", " n "), (" south ", " s "), (" east ", " e "), (" west ", " w ")):
        s = s.replace(a, b)
    return " ".join(s.split())
