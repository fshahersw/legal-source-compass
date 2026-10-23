"""Parser for the Oversight.gov report listing (https://www.oversight.gov/reports/federal).

Each report is three table rows: the listing row (date, agency reviewed, title, type, location, report link), an
accordion toggle, and a "highlights" row that carries the submitting OIG (with its page), the report description,
the number of recommendations and the report number. Fields the publisher leaves empty are None; nothing is
inferred. Values are returned as written (whitespace collapsed, entities unescaped).
"""
import html
import re
from datetime import datetime

BASE = "https://www.oversight.gov"
_WS = re.compile(r"\s+")
_ROW = re.compile(r'<tr class="listing-table__row table-row">(.*?)</tr>(.*?)(?=<tr class="listing-table__row table-row">|</tbody>|\Z)', re.S)
_CELL = re.compile(r'<td[^>]*?data-label="([^"]+)"[^>]*>(.*?)</td>', re.S)


def clean(fragment):
    if fragment is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", fragment)
    return _WS.sub(" ", html.unescape(text)).strip()


def field(block, name):
    """Inner HTML of the first `field--name-<name>` item in block, or None."""
    m = re.search(r'field--name-' + re.escape(name) + r' field--type-[a-z_-]+ field--label-[a-z]+[^"]*">(.*?)</div>\s*(?=<div class="field |</div>\s*</div>\s*</div>|\Z)', block, re.S)
    if not m:
        return None
    item = re.search(r'<div class="field__item[^"]*">(.*?)</div>', m.group(1), re.S)
    return item.group(1) if item else None


def parse_row(cells_html, rest_html):
    cells = {label: inner for label, inner in _CELL.findall(cells_html)}
    date = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})', cells.get("Report Date", ""))
    link = re.search(r'<a href="(/(?:reports|node)/[^"]+)"', cells.get("action-cell-report-link", ""))
    if not link:
        return None
    oig_link = re.search(r'<h2><a href="(/inspectors-general/[^"]+)">(.*?)</a>', rest_html, re.S)
    submitting = re.search(r'field--name-field-report-submitting-oig[^>]*>.*?<div class="field__item[^"]*">(.*?)</div>', rest_html, re.S)
    recs = re.search(r'field--name-field-report-number-of-recs[^>]*>.*?<div class="field__item[^"]*">(.*?)</div>', rest_html, re.S)
    number = re.search(r'field--name-field-report-number field[^>]*>.*?<div class="field__item[^"]*">(.*?)</div>', rest_html, re.S)
    desc = re.search(r'field--name-body field[^>]*>.*?<div class="field__item[^"]*">(.*?)</div>\s*</div>', rest_html, re.S)
    recs_text = clean(recs.group(1)) if recs else ""
    return {
        "path": link.group(1),
        "date": date.group(1) if date else None,
        "agency_reviewed": clean(cells.get("Agency Reviewed / Investigated")) or None,
        "title": clean(cells.get("Report Title")) or None,
        "type": clean(cells.get("Type")) or None,
        "location": clean(cells.get("Location")) or None,
        "oig": clean(submitting.group(1)) if submitting and clean(submitting.group(1)) else None,
        "oig_path": oig_link.group(1) if oig_link else None,
        "report_number": clean(number.group(1)) if number and clean(number.group(1)) else None,
        "recommendations": int(recs_text) if recs_text.isdigit() else None,
        "description": clean(desc.group(1)) if desc and clean(desc.group(1)) else None,
    }


def parse_listing(page_html):
    """All reports on one listing page, in page order."""
    out = []
    for cells_html, rest_html in _ROW.findall(page_html):
        row = parse_row(cells_html, rest_html)
        if row:
            out.append(row)
    return out


def total_pages(page_html, per_page=100):
    """Highest page number linked from the pager (0-based), or None."""
    pages = [int(n) for n in re.findall(r"page=(\d+)", page_html)]
    return max(pages) if pages else None


def parse_money(text):
    """'$1,234,567' -> 1234567.0; None when the text is not a plain dollar amount."""
    if text is None:
        return None
    m = re.fullmatch(r"\$\s*([\d,]+(?:\.\d+)?)", text.strip())
    return float(m.group(1).replace(",", "")) if m else None


def _field(page_html, name):
    """(inner html, machine value) of the first `field--name-<name>` item on a report page, or (None, None)."""
    start = page_html.find("field--name-" + name + " ")
    if start < 0:
        return None, None
    nxt = page_html.find('<div class="field field--name-', start + 20)
    block = page_html[start: nxt if nxt > 0 else start + 3000]
    m = re.search(r'<div([^>]*)class="[^"]*field__item[^"]*"([^>]*)>(.*?)</div>', block, re.S)
    if not m:
        return None, None
    content = re.search(r'content="([^"]*)"', m.group(1) + m.group(2))
    return m.group(3), content.group(1) if content else None


def _issued(text):
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_report_page(page_html):
    """Detail fields of one Oversight.gov report page, as printed: date, number, recommendations, the money fields
    (printed text and the machine value the page carries), the OIG's external link and the hosted report file."""
    out = {}
    issued, _ = _field(page_html, "field-report-date-issued")
    stamp = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})', issued or "")
    out["date"] = stamp.group(1) if stamp else _issued(clean(issued)) if issued else None
    number, _ = _field(page_html, "field-report-number")
    out["report_number"] = clean(number) or None if number else None
    recs, _ = _field(page_html, "field-report-number-of-recs")
    out["recommendations"] = int(clean(recs)) if recs and clean(recs).isdigit() else None
    for key, name in (("questioned_costs", "field-net-questioned-costs"), ("funds_better_use", "field-net-funds-for-better-use")):
        item, content = _field(page_html, name)
        text = clean(item) if item else ""
        value = float(content) if content is not None and re.fullmatch(r"\d+(?:\.\d+)?", content) else parse_money(text)
        out[key] = {"text": text, "value": value} if text else None
    link, _ = _field(page_html, "field-report-link")
    href = re.search(r'href="([^"]+)"', link or "")
    out["external_url"] = html.unescape(href.group(1)) if href else None
    start = page_html.find("field--name-field-report-file ")
    m = re.search(r'report-download-button[^>]*href="([^"]+)"|href="([^"]+)"[^>]*report-download-button', page_html[start: start + 2500]) if start >= 0 else None
    href = (m.group(1) or m.group(2)) if m else None
    out["file_url"] = (BASE + href if href.startswith("/") else href) if href else None
    return out
