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


def parse_report_page(page_html):
    """Detail fields of one Oversight.gov report page: dates, numbers, money as stated, file and external links."""
    labels = {}
    for title, rest in re.findall(r'<div class="title[^"]*">([^<]+)</div>\s*(.*?)(?=<div class="field field--name|</article>|\Z)', page_html, re.S):
        item = re.search(r'<div class="field__item[^"]*">(.*?)</div>', rest, re.S)
        labels[clean(title)] = item.group(1) if item else None
    ext = re.search(r'field--name-field-report-link.*?<a href="([^"]+)"', page_html, re.S)
    pdf = re.search(r'field--name-field-report-file.*?<a href="([^"]+)"', page_html, re.S)
    issued = labels.get("Date Issued")
    when = None
    if issued:
        for fmt in ("%A, %B %d, %Y", "%B %d, %Y"):
            try:
                when = datetime.strptime(clean(issued), fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                continue
    return {
        "date": when,
        "report_number": clean(labels.get("Report Number")) or None,
        "recommendations": int(clean(labels["Number of Recommendations"])) if clean(labels.get("Number of Recommendations")).isdigit() else None,
        "questioned_costs_text": clean(labels.get("Questioned Costs")) or None,
        "questioned_costs": parse_money(clean(labels.get("Questioned Costs"))),
        "funds_better_use_text": clean(labels.get("Funds for Better Use")) or None,
        "funds_better_use": parse_money(clean(labels.get("Funds for Better Use"))),
        "external_url": html.unescape(ext.group(1)) if ext else None,
        "file_url": (BASE + pdf.group(1) if pdf and pdf.group(1).startswith("/") else (pdf.group(1) if pdf else None)),
    }
