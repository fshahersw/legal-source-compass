"""Parsers for osc.gov: resource list pages (reports, testimonies, Hatch Act advisory opinions) and the site's own
search-index fragments (whistleblower public files and press releases).

Values are returned as published (whitespace collapsed, entities unescaped). A date is read only from a field that is
a date (the fragment's date-iso, or a full 'Month D, YYYY' that ends a testimony title); nothing is inferred.
"""
import html
import json
import re
from datetime import datetime

BASE = "https://www.osc.gov"
_WS = re.compile(r"\s+")
_ITEM = re.compile(r'<li class="usa-icon-list__item resource-item[^"]*"([^>]*)>\s*<a href="([^"]+)"[^>]*>(.*?)</a>\s*</li>', re.S)
_ATTR = re.compile(r'data-resource-(parent|topic)="([^"]*)"')
_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_TRAILING_DATE = re.compile(r"(?:,|\()?\s*((?:%s) \d{1,2}, \d{4})\)?\s*$" % _MONTHS)
_FY = re.compile(r"\bFY\s?(\d{4})\b")


from textclean import clean  # noqa: E402,F401  (shared visible-text rule)


def absolute(href):
    if href.startswith("//"):
        return "https:" + href
    return href if href.startswith("http") else BASE + (href if href.startswith("/") else "/" + href)


def parse_resources(page_html):
    """[{href, url, title, parent, topic, file_type}] for every resource item on a list page, in page order."""
    out = []
    for attrs, href, inner in _ITEM.findall(page_html):
        found = dict(_ATTR.findall(attrs))
        title = clean(inner)
        if not title:
            continue
        url = absolute(href)
        out.append({"href": href, "url": url, "title": title, "parent": found.get("parent") or None, "topic": found.get("topic") or None,
                    "file_type": "PDF" if re.search(r"\.pdf(?:$|\?)", href, re.I) else "Web page"})
    return out


def iso_from_long(text):
    try:
        return datetime.strptime(text, "%B %d, %Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def trailing_date(title):
    """The 'Month D, YYYY' that ends a title (testimony titles), as ISO, else None."""
    m = _TRAILING_DATE.search(title or "")
    return iso_from_long(m.group(1)) if m else None


def fiscal_year(title):
    """The fiscal year a report title names ('FY 2025 Annual Report ...'), else None."""
    m = _FY.search(title or "")
    return int(m.group(1)) if m else None


def parse_case(fragment):
    """One whistleblower public file from a `content-type: case` fragment, or None if it lacks a case number."""
    meta = fragment.get("meta") or {}
    number = (meta.get("case-number") or "").strip()
    if not number:
        return None
    try:
        results = [clean(x) for x in json.loads(meta.get("case-results-json") or "[]")]
    except ValueError:
        results = []
    try:
        files = [{"label": clean(f.get("label")), "url": absolute(f["href"])} for f in json.loads(meta.get("case-files-json") or "[]") if f.get("href")]
    except (ValueError, AttributeError):
        files = []
    location = clean(meta.get("case-location") or "")
    if location.lower().startswith("location:"):
        location = location[len("location:"):].strip()
    date = meta.get("date-iso") or None
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = None
    url = absolute(fragment.get("url") or "")
    return {
        "number": number, "numbers": [n for n in re.split(r"\s*\|\s*", number) if n], "slug": url.rstrip("/").rsplit("/", 1)[-1],
        "agency": clean(meta.get("agency") or "") or None, "location": location or None,
        "date_closed": date, "date_text": clean(meta.get("date") or "") or None, "results": [r for r in results if r], "files": files,
        "url": url, "filters": fragment.get("filters") or {},
    }


def parse_press(fragment):
    """One press release from a `content-type: press-release` fragment, or None if it has no title."""
    meta = fragment.get("meta") or {}
    title = clean(meta.get("title") or "")
    if not title:
        return None
    date = meta.get("date-iso") or None
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = None
    tags = (fragment.get("filters") or {}).get("tag") or []
    return {"title": title, "date": date, "date_text": clean(meta.get("date") or "") or None, "tags": [clean(t) for t in tags if clean(t)],
            "url": absolute(fragment.get("url") or ""), "excerpt": clean(fragment.get("content") or "")}
