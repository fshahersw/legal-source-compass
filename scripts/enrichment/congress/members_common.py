"""Pure helpers for `congress_members` and `congress_committees` (no I/O, no network): normalising what the Congress.gov API
publishes about members and committees into the record shape the corpus pages read.

Rules (also written in the dataset summaries): every value is exactly what the API publishes; nothing is inferred. A value the
API omits is None here and "Not recorded" on a page. The party shown beside a name is the latest entry of the API's own
`partyHistory`; the end of an earlier party is never guessed from the start of the next (the API gives start years only).
Bill counts are taken from the stored `congress_bills` records and are labelled with what they cover.
"""
from __future__ import annotations

import re
from collections import defaultdict

CHAMBER_SHORT = {"House of Representatives": "house", "Senate": "senate"}
BIOGUIDE = re.compile(r"^[A-Z]\d{6}$")
HREF = re.compile(r"""<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", re.I | re.S)
TAG = re.compile(r"<[^>]+>")
FIRST_BILL_CONGRESS = 108
LAST_BILL_CONGRESS = 119
BILL_TYPES = ("hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres")


def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{({1: 'st', 2: 'nd', 3: 'rd'}).get(n % 10, 'th')}"


def norm(s: str | None) -> str:
    """Case- and whitespace-normalised form used for exact name keys (no other folding: never a fuzzy match)."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def text(v) -> str | None:
    if not isinstance(v, str):
        return None
    t = re.sub(r"\s+", " ", v).strip()
    return t or None


def year(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and re.fullmatch(r"\d{4}", v.strip()):
        return int(v.strip())
    return None


def https_url(v, hosts: tuple[str, ...] | None = None) -> str | None:
    """An http(s) URL as published, optionally limited to the given host names; anything else is None."""
    s = text(v)
    if not s or not re.match(r"^https?://[^\s<>\"']+$", s):
        return None
    if hosts:
        host = re.sub(r"^https?://([^/:?#]+).*$", r"\1", s).lower()
        if host not in hosts:
            return None
    return s


def attribution(v) -> dict | None:
    """The portrait credit as the API gives it. It may carry an HTML anchor; the text and the link are separated here so a
    page never renders markup. {"raw": as published, "text": readable credit, "url": link or None}."""
    raw = text(v) if isinstance(v, str) else None
    if not raw:
        return None
    m = HREF.search(raw)
    url = https_url(m.group(1)) if m else None
    plain = text(TAG.sub("", raw).replace("&amp;", "&"))
    return {"raw": raw, "text": plain, "url": url} if plain else None


def depiction(v) -> dict | None:
    if not isinstance(v, dict):
        return None
    img = https_url(v.get("imageUrl"), ("www.congress.gov",))
    if not img:
        return None
    return {"imageUrl": img, "attribution": attribution(v.get("attribution"))}


def terms(detail: dict | None, listed: dict | None) -> list[dict]:
    """Terms by Congress from the member detail (congress, chamber, member type, state, district, start/end year as
    published). Without a detail the list entry's chamber terms are kept (no Congress number, member type or state code)."""
    out: list[dict] = []
    if detail and isinstance(detail.get("terms"), list):
        for t in detail["terms"]:
            if not isinstance(t, dict):
                continue
            row = {"congress": t.get("congress") if isinstance(t.get("congress"), int) else None,
                   "chamber": text(t.get("chamber")), "memberType": text(t.get("memberType")),
                   "stateCode": text(t.get("stateCode")), "stateName": text(t.get("stateName")),
                   "district": t.get("district") if isinstance(t.get("district"), int) else None,
                   "startYear": year(t.get("startYear")), "endYear": year(t.get("endYear"))}
            out.append({k: v for k, v in row.items() if v is not None})
        out.sort(key=lambda r: (r.get("congress") or 0, r.get("startYear") or 0))
        return out
    items = ((listed or {}).get("terms") or {}).get("item") if isinstance((listed or {}).get("terms"), dict) else None
    for t in items or []:
        if isinstance(t, dict):
            row = {"chamber": text(t.get("chamber")), "startYear": year(t.get("startYear")), "endYear": year(t.get("endYear"))}
            out.append({k: v for k, v in row.items() if v is not None})
    out.sort(key=lambda r: r.get("startYear") or 0)
    return out


def party_history(detail: dict | None, listed: dict | None) -> list[dict]:
    """The API's partyHistory (name, abbreviation, start year). Without a detail the list's single current party name."""
    out: list[dict] = []
    if detail and isinstance(detail.get("partyHistory"), list):
        for p in detail["partyHistory"]:
            if isinstance(p, dict) and text(p.get("partyName")):
                row = {"party": text(p.get("partyName")), "abbreviation": text(p.get("partyAbbreviation")),
                       "startYear": year(p.get("startYear")), "endYear": year(p.get("endYear"))}
                out.append({k: v for k, v in row.items() if v is not None})
        out.sort(key=lambda r: r.get("startYear") or 0)  # stable: published order is kept for equal years
    elif listed and text(listed.get("partyName")):
        out.append({"party": text(listed["partyName"]), "listOnly": True})
    return out


def names(detail: dict | None, listed: dict | None) -> dict:
    """Name forms as published. `inverted` ("Aderholt, Robert B.") is the list/detail last-name-first form."""
    d = detail or {}
    inverted = text(d.get("invertedOrderName")) or text((listed or {}).get("name"))
    direct = text(d.get("directOrderName"))
    prev = []
    for p in d.get("previousNames") or []:
        if isinstance(p, dict):
            row = {"inverted": text(p.get("invertedOrderName")), "direct": text(p.get("directOrderName")),
                   "from": (text(p.get("startDate")) or "")[:10] or None, "to": (text(p.get("endDate")) or "")[:10] or None}
            prev.append({k: v for k, v in row.items() if v})
    return {"inverted": inverted, "direct": direct, "honorific": text(d.get("honorificName")), "first": text(d.get("firstName")),
            "middle": text(d.get("middleName")), "last": text(d.get("lastName")), "suffix": text(d.get("suffixName")),
            "nick": text(d.get("nickName")), "previous": prev}


def leadership(detail: dict | None) -> list[dict]:
    out = []
    for x in (detail or {}).get("leadership") or []:
        if isinstance(x, dict) and text(x.get("type")):
            row = {"type": text(x.get("type")), "congress": x.get("congress") if isinstance(x.get("congress"), int) else None,
                   "current": x.get("current") if isinstance(x.get("current"), bool) else None}
            out.append({k: v for k, v in row.items() if v is not None})
    return out


def count_of(v) -> int | None:
    """A legislation count block {"count": n, "url": ...} -> n, else None."""
    if isinstance(v, dict) and isinstance(v.get("count"), int) and not isinstance(v.get("count"), bool) and v["count"] >= 0:
        return v["count"]
    return None


def latest_term(ts: list[dict]) -> dict | None:
    return max(ts, key=lambda t: (t.get("congress") or 0, t.get("startYear") or 0)) if ts else None


def years_label(ts: list[dict], current: bool | None) -> str | None:
    """First start year to last end year of the terms as published; a last term without an end year reads 'present' only when
    the API says the member is current, otherwise the end is left open ('1997–')."""
    starts = [t["startYear"] for t in ts if t.get("startYear")]
    if not starts:
        return None
    first = min(starts)
    last_term = max(ts, key=lambda t: (t.get("congress") or 0, t.get("startYear") or 0))
    end = last_term.get("endYear")
    if end:
        return f"{first}–{end}" if end != first else str(first)
    return f"{first}–present" if current else f"{first}–"


def bio_url(bioguide: str) -> str:
    return f"https://bioguide.congress.gov/search/bio/{bioguide}"


def api_url(bioguide: str) -> str:
    return f"https://api.congress.gov/v3/member/{bioguide}"


class BillIndex:
    """Per-member counts and cosponsorship lists from the stored congress_bills records (108th-119th Congress).

    sponsored: only the first-listed sponsor of a measure counts (the same key the congress_bills `sponsor` filter holds).
    cosponsored: every cosponsorship that was not withdrawn; withdrawn ones are only counted. Numbers are kept per
    Congress and measure type so a page can rebuild /law/legislation/federal/{congress}/{type}/{number} without a second lookup."""

    def __init__(self) -> None:
        self.sponsored: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        self.cosponsored: dict[str, dict[int, dict[str, list[int]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        self.withdrawn: dict[str, int] = defaultdict(int)
        self.bills = 0
        self.no_sponsor = 0
        self.multi_sponsor = 0
        self.sponsor_without_id = 0
        self.cosponsor_without_id = 0

    def add(self, congress: int, btype: str, number: str, sponsors: list[dict], cosponsors: list[dict]) -> None:
        self.bills += 1
        if not sponsors:
            self.no_sponsor += 1
        else:
            if len(sponsors) > 1:
                self.multi_sponsor += 1
            first = (sponsors[0] or {}).get("bioguideId")
            if first:
                self.sponsored[first][congress] += 1
            else:
                self.sponsor_without_id += 1
        n = int(number)
        seen: set[str] = set()
        for c in cosponsors or []:
            b = (c or {}).get("bioguideId")
            if not b:
                self.cosponsor_without_id += 1
                continue
            if c.get("sponsorshipWithdrawnDate"):
                self.withdrawn[b] += 1
                continue
            if b in seen:  # a cosponsor listed twice on one measure counts once
                continue
            seen.add(b)
            self.cosponsored[b][congress][btype].append(n)

    def member(self, bioguide: str) -> dict:
        sp = {c: n for c, n in sorted(self.sponsored.get(bioguide, {}).items())}
        cos_raw = self.cosponsored.get(bioguide, {})
        cos = {c: {t: sorted(nums) for t, nums in sorted(by.items())} for c, by in sorted(cos_raw.items())}
        cos_counts = {c: sum(len(v) for v in by.values()) for c, by in cos.items()}
        return {"sponsoredByCongress": sp, "sponsoredTotal": sum(sp.values()),
                "cosponsoredByCongress": cos_counts, "cosponsoredTotal": sum(cos_counts.values()),
                "cosponsorshipsWithdrawn": self.withdrawn.get(bioguide, 0), "cosponsored": cos}


def fully_covered(ts: list[dict]) -> bool:
    """Every Congress the member served in lies inside the bill collection's 108th-119th range."""
    cs = [t.get("congress") for t in ts]
    return bool(cs) and all(isinstance(c, int) and FIRST_BILL_CONGRESS <= c <= LAST_BILL_CONGRESS for c in cs)


def covered_congresses(ts: list[dict]) -> list[int]:
    return sorted({t["congress"] for t in ts if isinstance(t.get("congress"), int)
                   and FIRST_BILL_CONGRESS <= t["congress"] <= LAST_BILL_CONGRESS})
