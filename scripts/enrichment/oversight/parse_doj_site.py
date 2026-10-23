"""Parsers for the justice.gov pages behind the DOJ document indexes (all values as the pages print them)."""
import html
import re
from datetime import datetime

BASE = "https://www.justice.gov"
_WS = re.compile(r"\s+")


from textclean import clean  # noqa: E402,F401  (shared visible-text rule)


def absolute(href):
    href = html.unescape(href)
    return href if href.startswith("http") else BASE + (href if href.startswith("/") else "/" + href)


def body_block(page_html):
    """The page's main editorial block: from the `field_body` element to the end of <main>."""
    start = page_html.find('field_body">')
    if start < 0:
        return page_html
    end = page_html.find("</main>", start)
    return page_html[start: end if end > 0 else len(page_html)]


def resolution_date(text):
    """'3/17/2026' or '8/07/25' -> ISO. A two-digit year is read as 20YY: the Criminal Division's Corporate Enforcement
    Policy began in 2016, so every listed resolution is in the 2000s."""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})", text.strip())
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), m.group(3)
    year = int(year) + 2000 if len(m.group(3)) == 2 else int(year)
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_resolutions(page_html):
    """[{label, date_text, date, url}] from the ordered list of 'Company (date)' entries, newest first as printed."""
    out = []
    for item in re.findall(r"<li>(.*?)</li>", page_html, re.S):
        link = re.search(r'<a href="([^"]+)"[^>]*>(.*?)</a>', item, re.S)
        if not link:
            continue
        label = clean(link.group(2))
        rest = clean(item[link.end():])
        date_text = re.search(r"\((\d{1,2}/\d{1,2}/\d{2,4})\)", rest)
        if not label or not date_text:
            continue
        out.append({"label": label, "date_text": date_text.group(1), "date": resolution_date(date_text.group(1)), "url": absolute(link.group(1))})
    return out


_IN_RE = re.compile(r"^in\s+re:?\s+", re.I)


def company_name(label):
    """The company a resolution label names: the label without a leading 'In re:' (kept otherwise exactly as printed)."""
    return _IN_RE.sub("", label).strip()


def parse_budget_page(page_html):
    """[{group, label, title_attr, url}] for every link in the page's headed lists (h2/h3 heading, then its paragraphs)."""
    block = body_block(page_html)
    out, group = [], None
    for part in re.split(r"(?=<h[23][ >])", block):
        head = re.match(r"<h[23][^>]*>(.*?)</h[23]>", part, re.S)
        if head:
            group = clean(head.group(1))
            part = part[head.end():]
        for href, attrs, inner in re.findall(r'<a href="([^"]+)"([^>]*)>(.*?)</a>', part, re.S):
            label = clean(inner)
            if not label or not group or href.startswith(("mailto:", "#")):
                continue
            title = re.search(r'title="([^"]*)"', attrs)
            out.append({"group": group, "label": label, "title_attr": clean(title.group(1)) if title else None, "url": absolute(href)})
    return out


def parse_eeo_page(page_html):
    """[{group, entity, kind, url}] one per PDF/HTML link in the No FEAR Act data page, under its heading."""
    block = body_block(page_html)
    out, group = [], None
    for part in re.split(r"(?=<h2[ >])", block):
        head = re.match(r"<h2[^>]*>(.*?)</h2>", part, re.S)
        if head:
            group = clean(head.group(1))
            part = part[head.end():]
        for para in re.findall(r"<p>(.*?)</p>", part, re.S):
            links = re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', para, re.S)
            if not links:
                continue
            entity = clean(para[: para.find("<a")]).rstrip("-– ").strip()
            for href, inner in links:
                kind = clean(inner)
                if kind in ("PDF", "HTML"):
                    out.append({"group": group, "entity": entity, "kind": kind, "url": absolute(href)})
    return out


def parse_library_guides(page_html):
    """[{title, url}] research guides from the Library Staff sidebar (links under /jmd/ls/)."""
    out, seen = [], set()
    for href, inner in re.findall(r'<a href="(/jmd/ls/[^"]+)" class="usa-nav__link[^"]*">(.*?)</a>', page_html, re.S):
        title = clean(inner)
        if title and href not in seen:
            seen.add(href)
            out.append({"title": title, "url": absolute(href)})
    return out
