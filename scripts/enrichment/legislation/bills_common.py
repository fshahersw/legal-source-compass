"""Pure helpers for federal bill records: citations, Congress.gov action-code rules, milestones and official links.

Every derived value has its rule written here. Milestones come only from published action codes (Congress.gov's own
"Action Codes" field-value list, https://www.congress.gov/help/field-values/action-codes, copied below) plus two published
text patterns; anything else is "not recorded".
"""
from __future__ import annotations

import re

TYPE_CITE = {"hr": "H.R.", "s": "S.", "hjres": "H.J.Res.", "sjres": "S.J.Res.", "hconres": "H.Con.Res.",
             "sconres": "S.Con.Res.", "hres": "H.Res.", "sres": "S.Res."}
TYPE_LABEL = {"hr": "House bill", "s": "Senate bill", "hjres": "House joint resolution", "sjres": "Senate joint resolution",
              "hconres": "House concurrent resolution", "sconres": "Senate concurrent resolution",
              "hres": "House simple resolution", "sres": "Senate simple resolution"}
RESOLUTION_TYPES = {"hres", "sres", "hconres", "sconres"}

# Congress.gov action codes (field-value list, read 2026-10-23). Description -> chamber: "House" or "Senate" when the
# description names exactly one chamber, otherwise none.
ACTION_CODES = {
    "1000": "Introduced in House", "1010": "Reported Original Measure", "1025": "Submitted in House",
    "2000": "Referred to House committee", "3000": "Referred to House subcommittee",
    "4000": "House committee/subcommittee actions", "4100": "House committee/subcommittee hearings",
    "4200": "House committee/subcommittee markups", "4900": "House committee time extension",
    "4950": "House discharge petition filed", "5000": "Reported to House", "5500": "House committee discharged",
    "7000": "House floor actions", "8000": "Passed/agreed to in House", "9000": "Failed of passage/not agreed to in House",
    "10000": "Introduced in Senate", "10010": "Reported Original Measure in Senate", "10025": "Submitted in Senate",
    "11000": "Referred to Senate committee", "12000": "Referred to Senate subcommittee",
    "13000": "Senate committee/subcommittee actions", "13100": "Senate committee/subcommittee hearings",
    "13200": "Senate committee/subcommittee markups", "13900": "Senate committee time extension",
    "14000": "Reported to Senate", "14500": "Senate committee discharged", "14900": "Senate committee report filed after reporting",
    "16000": "Senate floor actions", "17000": "Passed/agreed to in Senate", "18000": "Failed of passage/not agreed to in Senate",
    "19000": "Resolving differences -- House actions", "20000": "Resolving differences -- Senate actions",
    "20800": "Conference committee actions", "20900": "Conference report filed",
    "21000": "Conference report agreed to in House", "22000": "Conference report disagreed to in House",
    "23000": "Conference report agreed to in Senate", "24000": "Conference report disagreed to in Senate",
    "25000": "Roll call votes on measures in House", "26000": "Roll call votes on measures in Senate",
    "28000": "Presented to President", "29000": "Signed by President", "29100": "Sent to Archivist unsigned by President",
    "30000": "Pocket vetoed by President", "31000": "Vetoed by President", "32000": "Passed House over veto",
    "33000": "Failed of passage in House over veto", "34000": "Passed Senate over veto",
    "35000": "Failed of passage in Senate over veto", "36000": "Became Public Law", "37000": "Public Law signed by President",
    "38000": "Public Law unsigned by President", "39000": "Public Law enacted over veto", "40000": "Public Law by other means",
    "41000": "Became Private Law", "42000": "Private Law signed by President", "43000": "Private Law unsigned by President",
    "44000": "Private Law enacted over veto", "45000": "Private Law by other means", "46000": "Line item veto by President",
    "47000": "Disapproval bill in House", "48000": "Disapproval bill in Senate", "71000": "House amendment offered",
    "72000": "House amendment agreed to", "72500": "House amendment considered as adopted",
    "73000": "House amendment not agreed to", "74000": "Other House amendment actions",
    "75000": "Roll call votes on amendments in House", "91000": "Senate amendment submitted",
    "92000": "Senate amendment referred to committee", "93000": "Senate amendment proposed (on the floor)",
    "94000": "Senate amendment agreed to", "95000": "Senate amendment not agreed to", "96000": "Other Senate amendment actions",
    "97000": "Roll call votes on amendments in Senate",
}

MILESTONE_RULES = {
    "introduced": "the bill's published introducedDate",
    "reported": "earliest action with code 5000 (Reported to House), 14000 (Reported to Senate), 1010 or 10010 (Reported Original Measure)",
    "passed_house": "earliest action with code 8000 (Passed/agreed to in House) or 32000 (Passed House over veto), or text starting 'Passed/agreed to in House:'",
    "passed_senate": "earliest action with code 17000 (Passed/agreed to in Senate) or 34000 (Passed Senate over veto), or text starting 'Passed/agreed to in Senate:'",
    "to_president": "earliest action with code 28000 (Presented to President)",
    "became_law": "earliest action with code 36000-40000 (public law) or 41000-45000 (private law), or text starting 'Became Public Law No:' / 'Became Private Law No:'",
    "vetoed": "earliest action with code 31000 (Vetoed by President) or 30000 (Pocket vetoed by President)",
}
VITIATION_RULE = ("A chamber's passage does not count toward the status when an action of that chamber whose text says the "
                  "previous passage was vitiated is dated on or after the last passage action of that chamber.")
MILESTONE_ORDER = ["introduced", "reported", "passed_house", "passed_senate", "to_president", "vetoed", "became_law"]

CODES = {
    "reported": {"5000", "14000", "1010", "10010"},
    "passed_house": {"8000", "32000"},
    "passed_senate": {"17000", "34000"},
    "to_president": {"28000"},
    "became_law": {str(c) for c in (36000, 37000, 38000, 39000, 40000, 41000, 42000, 43000, 44000, 45000)},
    "vetoed": {"31000", "30000"},
}
TEXTS = {
    "passed_house": re.compile(r"^Passed/agreed to in House:"),
    "passed_senate": re.compile(r"^Passed/agreed to in Senate:"),
    "became_law": re.compile(r"^Became (Public|Private) Law No:"),
}
VITIATED = re.compile(r"vitiat\w*\s+(the\s+)?(previous\s+)?passage", re.I)
SOURCE_CHAMBER = {"House floor actions": "House", "House committee actions": "House", "Senate": "Senate"}


def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def citation(btype: str, number: str | int) -> str:
    return f"{TYPE_CITE[btype]} {number}"


def display_citation(btype: str, number: str | int, congress: int) -> str:
    return f"{citation(btype, number)}, {ordinal(congress)} Congress"


def bill_id(congress: int, btype: str, number: str | int) -> str:
    return f"{congress}-{btype}-{number}"


CONGRESS_GOV_SLUG = {"hr": "house-bill", "s": "senate-bill", "hjres": "house-joint-resolution", "sjres": "senate-joint-resolution",
                     "hconres": "house-concurrent-resolution", "sconres": "senate-concurrent-resolution",
                     "hres": "house-resolution", "sres": "senate-resolution"}


def congress_gov_url(congress: int, btype: str, number: str | int) -> str:
    """Congress.gov's bill page address, in the form the Bill Status files publish as legislationUrl
    (e.g. https://www.congress.gov/bill/118th-congress/house-bill/3935). Used when a file has no legislationUrl; the
    verify script checks that this form equals every published legislationUrl."""
    return f"https://www.congress.gov/bill/{ordinal(congress)}-congress/{CONGRESS_GOV_SLUG[btype]}/{number}"


def billstatus_xml_url(congress: int, btype: str, number: str | int) -> str:
    return f"https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{btype}/BILLSTATUS-{congress}{btype}{number}.xml"


def code_chamber(code: str | None) -> str | None:
    desc = ACTION_CODES.get(code or "")
    if not desc:
        return None
    house, senate = "House" in desc, "Senate" in desc
    return "House" if house and not senate else "Senate" if senate and not house else None


def action_chamber(action: dict) -> str | None:
    """Chamber from the published source system (House floor/committee actions, Senate), else from the code table."""
    by_source = SOURCE_CHAMBER.get(action.get("source") or "")
    return by_source or code_chamber(action.get("code"))


def dedupe_actions(actions: list[dict]) -> tuple[list[dict], int]:
    """Drop an action only when an earlier one has the identical date, text and code (a copy from another source system)."""
    seen, out, dropped = set(), [], 0
    for a in actions:
        key = (a.get("date"), a.get("text"), a.get("code"))
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        out.append(a)
    return out, dropped


def _hits(actions: list[dict], name: str) -> list[dict]:
    codes = CODES.get(name, set())
    pat = TEXTS.get(name)
    return [a for a in actions if a.get("date") and ((a.get("code") in codes) or (pat is not None and pat.match(a.get("text") or "")))]


def milestones(bill: dict, actions: list[dict]) -> dict:
    """{name: {"date", "evidence"} | None} plus vitiation notes; None means not recorded."""
    out: dict = {}
    intro = bill.get("introducedDate")
    out["introduced"] = {"date": intro, "evidence": "introducedDate"} if intro else None
    for name in ("reported", "passed_house", "passed_senate", "to_president", "became_law", "vetoed"):
        hits = _hits(actions, name)
        if not hits:
            out[name] = None
            continue
        first = min(hits, key=lambda a: a["date"])
        entry = {"date": first["date"], "evidence": (f"code {first['code']}" if first.get("code") in CODES.get(name, set())
                                                     else "action text")}
        if name in ("passed_house", "passed_senate"):
            chamber = "House" if name == "passed_house" else "Senate"
            last = max(a["date"] for a in hits)
            vit = [a["date"] for a in actions if a.get("date") and VITIATED.search(a.get("text") or "")
                   and action_chamber(a) == chamber]
            if vit and max(vit) >= last:
                entry["vitiated"] = max(vit)
        out[name] = entry
    return out


def status(btype: str, ms: dict) -> tuple[str, str]:
    """The furthest stage reached, from the milestones above (vitiated passages do not count)."""
    def ok(name: str) -> bool:
        m = ms.get(name)
        return bool(m) and not m.get("vitiated")

    res = btype in RESOLUTION_TYPES
    verb = "Agreed to" if res else "Passed"
    if ok("became_law"):
        return "became_law", "Became law"
    if ok("vetoed"):
        return "vetoed", "Vetoed"
    if ok("to_president"):
        return "to_president", "Presented to the President"
    if ok("passed_house") and ok("passed_senate"):
        return "passed_both", f"{verb} in House and Senate" if res else "Passed House and Senate"
    if ok("passed_house"):
        return "passed_house", f"{verb} in House" if res else "Passed House"
    if ok("passed_senate"):
        return "passed_senate", f"{verb} in Senate" if res else "Passed Senate"
    if ok("reported"):
        return "reported", "Reported by committee"
    if ok("introduced"):
        return "introduced", "Introduced"
    return "not_recorded", "Not recorded"


REPORT = re.compile(r"^(H|S)\.\s*Rept\.\s*(\d+)-(\d+)(?:\s*,\s*(.+))?$")


def committee_report(citation_: str) -> dict:
    """'H. Rept. 118-138' -> the GovInfo package page CRPT-118hrpt138 (and the Link Service URL for the same report number;
    the Link Service answers HTTP 400 for some reports GovInfo holds, so the package page is the primary link).
    Part/Book/Errata suffixes are kept as printed; GovInfo files the parts within the report's package."""
    m = REPORT.match(citation_.strip())
    if not m:
        return {"citation": citation_, "url": None}
    chamber = "hrpt" if m.group(1) == "H" else "srpt"
    c, n = int(m.group(2)), int(m.group(3))
    out = {"citation": citation_, "congress": c, "number": n, "doc": chamber,
           "url": f"https://www.govinfo.gov/app/details/CRPT-{c}{chamber}{n}",
           "linkService": f"https://www.govinfo.gov/link/crpt/{c}/{chamber}/{n}"}
    if m.group(4):
        out["suffix"] = m.group(4).strip()
    return out


LAW = re.compile(r"^(\d+)-(\d+)$")


def law_entry(law: dict, lookup: dict | None) -> dict:
    """A resulting law as published (type + number), its GovInfo Link Service URL and, for public laws, whether the
    number resolves to exactly one public_laws_enacted record (exact Congress + number; shared numbers never link)."""
    ltype, number = law.get("type"), law.get("number") or ""
    m = LAW.match(number)
    kind = "public" if ltype == "Public Law" else "private" if ltype == "Private Law" else None
    out = {"type": ltype, "number": number, "label": f"{ltype} {number}" if ltype else number}
    if not m or not kind:
        out["resolution"] = {"status": "not_checked", "reason": "number not in the form congress-number"}
        return out
    c, n = int(m.group(1)), int(m.group(2))
    out["govinfo"] = f"https://www.govinfo.gov/link/plaw/{c}/{kind}/{n}"
    if kind != "public":
        out["resolution"] = {"status": "not_checked", "reason": "private laws are not in public_laws_enacted"}
    elif lookup is None:
        out["resolution"] = {"status": "not_checked", "reason": "public_laws_enacted not available at build time"}
    else:
        hits = lookup.get(f"{c}-{n}", [])
        if len(hits) == 1 and not hits[0].get("shared"):
            out["resolution"] = {"status": "resolved", "dataset": "public_laws_enacted", "id": hits[0]["id"],
                                 "href": f"/records/public_laws_enacted/{hits[0]['id']}"}
        elif hits:
            out["resolution"] = {"status": "ambiguous", "dataset": "public_laws_enacted", "ids": [h["id"] for h in hits][:5],
                                 "reason": "the number appears on more than one record or is marked shared"}
        else:
            out["resolution"] = {"status": "not_found", "dataset": "public_laws_enacted"}
    return out


def text_version(tv: dict) -> dict:
    fmts = tv.get("formats") or []
    url = fmts[0]["url"] if fmts else None
    pkg = None
    if url:
        m = re.search(r"/content/pkg/([A-Z]+-[0-9A-Za-z]+)/", url)
        pkg = m.group(1) if m else None
    return {k: v for k, v in {"type": tv.get("type"), "date": tv.get("date"), "url": url, "package": pkg,
                              "details": f"https://www.govinfo.gov/app/details/{pkg}" if pkg else None,
                              "formats": [f for f in fmts if f.get("url") != url] or None}.items() if v}


def norm_number(s: str) -> str:
    return re.sub(r"\D", "", s or "")
