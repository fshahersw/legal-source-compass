"""Parse FTC Legal Library HTML (Cases and Proceedings listing and case pages) and the FTC enforcement CSV/XLSX files.

Pure functions, no network. Field names follow the Drupal field classes on ftc.gov (field--name-field-*), so a value
is taken only from its labelled field; anything absent stays None ("Not recorded").
"""
import csv
import html
import io
import re
from datetime import datetime

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean(fragment):
    """HTML fragment -> plain text (entities decoded, whitespace collapsed)."""
    if fragment is None:
        return None
    text = _TAG.sub(" ", fragment)
    text = html.unescape(text).replace("\xa0", " ")
    text = _WS.sub(" ", text).strip()
    return text or None


def _field_block(block, name):
    """Inner HTML of the first `field--name-<name>` div in block (balanced div matching)."""
    m = re.search(r'<div class="field field--name-' + re.escape(name) + r'[ "]', block)
    if not m:
        return None
    start = m.start()
    depth = 0
    for tag in re.finditer(r"<(/?)div\b[^>]*>", block[start:]):
        depth += -1 if tag.group(1) else 1
        if depth == 0:
            return block[start:start + tag.end()]
    return block[start:]


def field_items(block, name):
    """Plain-text values of a labelled Drupal field (labels removed)."""
    inner = _field_block(block, name)
    if inner is None:
        return []
    inner = re.sub(r'<div class="field__label[^"]*">.*?</div>', "", inner, flags=re.S)
    inner = re.sub(r"<h2[^>]*>.*?</h2>", "", inner, flags=re.S)
    items = re.findall(r'<div class="field__item[^"]*">(.*?)</div>\s*(?=<div class="field__item|</div>)', inner, flags=re.S)
    if not items:
        value = clean(inner)
        return [value] if value else []
    return [v for v in (clean(item) for item in items) if v]


def field_time(block, name):
    inner = _field_block(block, name)
    if inner is None:
        return None
    m = re.search(r'<time datetime="([0-9T:\-Z+]+)"', inner)
    return m.group(1)[:10] if m else None


def _articles(text, node_type, view_mode=None):
    pattern = r'<article about="([^"]+)" class="node node--type-' + re.escape(node_type) + r'(?: |")[^>]*>'
    for m in re.finditer(pattern, text):
        if view_mode and f"node--view-mode-{view_mode}" not in m.group(0):
            continue
        end = text.find("</article>", m.end())
        yield m.group(1), text[m.start():end + 10]


def parse_listing(text):
    """Case rows on a Cases and Proceedings listing page."""
    rows = []
    for about, block in _articles(text, "case", "search-result"):
        title = re.search(r'<h3 class="node-title"><a href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        rows.append({
            "url": about,
            "name": clean(title.group(2)) if title else None,
            "summary": (field_items(block, "body") or [None])[0],
            "action_type": (field_items(block, "field-case-action-type") or [None])[0],
            "last_updated": field_time(block, "field-date"),
            "matter_number": (field_items(block, "field-matter-number") or [None])[0],
            "status": (field_items(block, "field-case-status") or [None])[0],
        })
    return rows


def parse_case(text, url):
    """Facts on one case page. Returns None when the page holds no case article."""
    found = None
    for about, block in _articles(text, "case", "full"):
        found = (about, block)
        break
    if not found:
        return None
    about, block = found
    title = re.search(r'<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>(.*?)</h1>', text, re.S) or re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S)
    tags = [clean(t) for t in re.findall(r'<span class="field-content"><a href="[^"]*"[^>]*>(.*?)</a></span>', _field_block(block, "field-tags-view") or "", re.S)]
    case = {
        "url": url,
        "about": about,
        "name": clean(title.group(1)) if title else None,
        "long_title": (field_items(block, "field-long-title") or [None])[0],
        "tags": [t for t in tags if t],
        "last_updated": field_time(block, "field-date"),
        "status": (field_items(block, "field-case-status") or [None])[0],
        "matter_numbers": field_items(block, "field-matter-number"),
        "civil_action_numbers": field_items(block, "field-civil-action-number"),
        "docket_numbers": field_items(block, "field-docket-number"),
        "federal_court": field_items(block, "field-federal-court"),
        "action_type": (field_items(block, "field-case-action-type") or [None])[0],
        "enforcement_type": field_items(block, "field-enforcement-type"),
        "mission": field_items(block, "field-mission"),
        "summary": (field_items(block, "body") or [None])[0],
    }
    case["timeline"] = parse_timeline(text)
    case["documents"] = [doc for item in case["timeline"] for doc in item["documents"]]
    return case


def parse_timeline(text):
    """Case timeline items: date and the documents (title, href, file size) attached to each."""
    out = []
    for about, block in _articles(text, "case-timeline-item"):
        date = field_time(block, "field-date")
        docs = []
        for m in re.finditer(r'<a href="([^"]+)"(?: type="([^"]*)")?[^>]*>(.*?)</a>\s*(?:<span class="file-size">\(([^)]*)\)</span>)?', block, re.S):
            href, mime, label, size = m.group(1), m.group(2), clean(m.group(3)), m.group(4)
            if not label or href.startswith("#"):
                continue
            docs.append({"title": label, "href": href, "mime": mime, "size": size, "date": date})
        title = (field_items(block, "field-title") or [None])[0]
        out.append({"date": date, "title": title, "documents": docs})
    return out


# ------------------------------------------------------------------ CSV / XLSX

def decode_csv_bytes(raw: bytes) -> str:
    """FTC CSVs are Windows-1252 (en dashes as 0x96); fall back from UTF-8 only when it is not valid UTF-8."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


def strip_hash_link(value):
    """'#https://...#' (the CSV's hyperlink encoding) -> 'https://...'; anything not http(s) -> None."""
    value = (value or "").strip().strip("#").strip()
    return value if value.startswith(("https://", "http://")) else None


def parse_us_date(value):
    """'6/18/2026 0:00:00' -> '2026-06-18'; unparseable -> None."""
    value = (value or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", value)
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def read_csv_rows(raw: bytes):
    rows = list(csv.DictReader(io.StringIO(decode_csv_bytes(raw))))
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in rows]


def pick(row, *names):
    lowered = {k.lower().replace(" ", ""): v for k, v in row.items()}
    for name in names:
        value = lowered.get(name.lower().replace(" ", ""))
        if value not in (None, ""):
            return value
    return None
