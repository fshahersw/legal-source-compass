"""Parse FSIS recall listing pages (https://www.fsis.usda.gov/recalls) into recall / public-health-alert items.

Every value comes from the listing card exactly as FSIS renders it (tags, title, establishment, status, date range,
states, summary excerpt, impacted products, quantity recovered). Pounds recalled are taken only from the card's own
text when it says "recalling approximately N pounds" (the matched sentence fragment is kept as evidence); otherwise
the value is not recorded.
"""
from __future__ import annotations

import datetime as dt
import html
import re

_TEASER = re.compile(r'<section class="recall-teaser">(.*?)</section>', re.S)
_TAGS = re.compile(r'<div class="recall-teaser__tags">(.*?)</div>', re.S)
_ACTIVE_TAG = re.compile(r'<span class="tag tag--[^"]*">\s*(.*?)\s*</span>', re.S)
_LINK_TAG = re.compile(r'<a class="tag tag--([^"]*)" href="([^"]*)">(.*?)</a>', re.S)
_TITLE = re.compile(r'<h3 class="recall-teaser__title"><a href="([^"]+)">(.*?)</a></h3>', re.S)
_EST = re.compile(r'<span class="recall-teaser__establishment">(.*?)</span>', re.S)
_STATUS = re.compile(r'<div class="recall-teaser__status">(.*?)</div>', re.S)
_DATE = re.compile(r'<div class="recall-teaser__date">(.*?)</div>', re.S)
_STATES = re.compile(r'<div class="recall-teaser__states">(.*?)</div>', re.S)
_SUMMARY = re.compile(r'<div class="recall-teaser__summary">(.*?)</div>', re.S)
_PRODUCTS = re.compile(r'<div class="recall-teaser__products">\s*<h5>(.*?)</h5>(.*?)</div>', re.S)
_HREF = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_POUNDS = re.compile(r"recalling (?:approximately |about |more than |nearly |roughly )?([\d,]+(?:\.\d+)?) (?:pounds|lbs?\.?)\b", re.I)
_US_DATE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")
RECALL_NUMBER = re.compile(r"^(\d{3}(?:-\d{3})*-\d{4}|PHA-\d{8}-\d{2})$")
BASE = "https://www.fsis.usda.gov"


def text(fragment: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", fragment or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def us_date(s: str) -> str | None:
    m = _US_DATE.search(s or "")
    if not m:
        return None
    mm, dd, yyyy = (int(g) for g in m.groups())
    try:
        return dt.date(yyyy, mm, dd).isoformat()
    except ValueError:
        return None


def parse_dates(fragment: str) -> tuple[str | None, str | None, bool]:
    """'Mon, 08/17/2026 - Fri, 09/11/2026' -> (start, end, current); 'Sat, 08/08/2026 - Current' -> (start, None, True)."""
    t = text(fragment)
    parts = [p.strip() for p in t.split(" - ")]
    start = us_date(parts[0]) if parts else None
    end = us_date(parts[1]) if len(parts) > 1 else None
    current = len(parts) > 1 and parts[1].lower() == "current"
    return start, end, current


def pounds_from(summary: str) -> tuple[float | None, str | None]:
    m = _POUNDS.search(summary or "")
    if not m:
        return None, None
    try:
        return float(m.group(1).replace(",", "")), m.group(0)
    except ValueError:
        return None, None


def parse_teaser(block: str) -> dict | None:
    tags = _TAGS.search(block)
    title = _TITLE.search(block)
    if not tags or not title:
        return None
    first = _ACTIVE_TAG.search(tags.group(1))
    number = text(first.group(1)) if first else ""
    links = [(cls.strip(), href, text(label)) for cls, href, label in _LINK_TAG.findall(tags.group(1))]
    risk = next((label for cls, href, label in links if cls != "reason"), None)
    reasons = [label for cls, href, label in links if cls == "reason"]
    est_html = _EST.search(block)
    establishments = []
    if est_html:
        for href, label in _HREF.findall(est_html.group(1)):
            establishments.append({"name": text(label).rstrip("/").strip(), "url": href})
        if not establishments and text(est_html.group(1)):
            establishments.append({"name": text(est_html.group(1)), "url": None})
    status = text(_STATUS.search(block).group(1)) if _STATUS.search(block) else ""
    start, end, current = parse_dates(_DATE.search(block).group(1)) if _DATE.search(block) else (None, None, False)
    states_raw = text(_STATES.search(block).group(1)) if _STATES.search(block) else ""
    summary = text(_SUMMARY.search(block).group(1)) if _SUMMARY.search(block) else ""
    products, recovered = [], None
    for heading, body in _PRODUCTS.findall(block):
        h = text(heading).lower()
        if h.startswith("impacted products"):
            spans = re.findall(r"<span>(.*?)</span>", body, re.S)
            products = [text(s) for s in spans if text(s)] or ([text(body)] if text(body) else [])
        elif h.startswith("quantity recovered"):
            recovered = text(body) or None
    url = title.group(1) if title.group(1).startswith("http") else BASE + title.group(1)
    lbs, evidence = pounds_from(summary)
    states = [] if not states_raw else [s.strip() for s in states_raw.split(",") if s.strip()]
    return {
        "number": number,
        "number_valid": bool(RECALL_NUMBER.match(number)),
        "kind": "Public health alert" if (risk or "").lower() == "public health alert" or number.startswith("PHA-") else "Recall",
        "risk": risk,
        "reasons": reasons,
        "title": text(title.group(2)),
        "url": url,
        "establishments": establishments,
        "status": status or None,
        "start": start,
        "end": end,
        "current": current,
        "states_raw": states_raw or None,
        "states": states,
        "summary": summary or None,
        "products": products,
        "recovered": recovered,
        "pounds": lbs,
        "pounds_evidence": evidence,
    }


def parse_listing(page_html: str) -> list[dict]:
    out = []
    for block in _TEASER.findall(page_html):
        item = parse_teaser(block)
        if item:
            out.append(item)
    return out


STATE_USPS = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY",
    "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
    "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Puerto Rico": "PR", "Guam": "GU", "American Samoa": "AS", "U.S. Virgin Islands": "VI", "Virgin Islands": "VI",
    "Northern Mariana Islands": "MP",
}


def usps_codes(states: list[str]) -> list[str]:
    """Exact state-name matches only; 'Nationwide' and anything else stay as published text."""
    out = []
    for s in states:
        code = STATE_USPS.get(s)
        if code and code not in out:
            out.append(code)
    return out
