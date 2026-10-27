"""Pure parsing for the FDA warning-letter table (no I/O). Tested by test_warning_letters.py."""
import html
import json
import re
from html.parser import HTMLParser

FDA = "https://www.fda.gov"
FDA_WARNINGS = (
    "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/"
    "compliance-actions-and-activities/warning-letters"
)
LETTER_PREFIX = "/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/"
VIEW_NAME = "warning_letter_solr_index"
HEADERS = ["Posted Date", "Letter Issue Date", "Company Name", "Issuing Office", "Subject",
           "Response Letter", "Closeout Letter", "Excerpt"]
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,250}$")


class _Cell(HTMLParser):
    """Visible text of one table cell (<br> as a separator) plus its anchors."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.anchors, self._href, self._label = [], [], None, []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")
        elif tag == "a":
            self._href = dict(attrs).get("href")
            self._label = []

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.anchors.append((self._href, clean("".join(self._label))))
            self._href = None

    def handle_data(self, data):
        self.parts.append(data)
        if self._href is not None:
            self._label.append(data)


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def cell(raw):
    parser = _Cell()
    parser.feed(raw or "")
    parser.close()
    lines = [clean(p) for p in "".join(parser.parts).split("\n")]
    return " / ".join(p for p in lines if p), parser.anchors


def us_date(text):
    """'10/05/2026' -> '2026-10-05'; anything else -> None (never guessed)."""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (text or "").strip())
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= month <= 12 and 1 <= day <= 31 and 1990 <= year <= 2100):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def absolute(href):
    if not href:
        return None
    if href.startswith("/"):
        return FDA + href
    if href.startswith("https://www.fda.gov/"):
        return href
    return None


def table_settings(page_html):
    """The AJAX config and total row count of the warning-letter table, read from the page's Drupal settings."""
    m = re.search(r'<script\b[^>]*data-drupal-selector="drupal-settings-json"[^>]*>(.*?)</script>', page_html, re.S)
    if not m:
        raise ValueError("FDA page has no Drupal settings")
    settings = json.loads(m.group(1))
    for table in (settings.get("datatables") or {}).values():
        ajax = table.get("ajax") or {}
        if (ajax.get("data") or {}).get("view_name") == VIEW_NAME:
            headers = [h.get("content") for h in table.get("aoColumnHeaders") or []]
            if headers != HEADERS or ajax.get("url") != "/datatables/views/ajax" or not table.get("serverSide"):
                raise ValueError(f"FDA warning-letter table schema changed: {headers}")
            total = int(ajax["data"].get("total_items") or table.get("deferLoading"))
            return ajax, total
    raise ValueError("FDA warning-letter table not found on the page")


def parse_row(cells):
    """One table row (8 HTML cells) -> a dict of the published values. Raises on an unexpected shape."""
    if not isinstance(cells, list) or len(cells) != 8:
        raise ValueError("unexpected row shape")
    texts, anchors = zip(*(cell(c) for c in cells))
    company_links = [a for a in anchors[2] if a[0] and a[0].startswith(LETTER_PREFIX)]
    if len(company_links) != 1:
        raise ValueError(f"row has no single letter link: {cells[2][:120]}")
    path = company_links[0][0].split("?")[0].split("#")[0]
    slug = path[len(LETTER_PREFIX):]
    if not SLUG.match(slug):
        raise ValueError(f"unexpected letter path: {path}")

    def linked(index):
        return sorted({absolute(href) for href, _ in anchors[index] if absolute(href)})

    return {
        "slug": slug,
        "path": path,
        "url": FDA + path,
        "posted_date": us_date(texts[0]),
        "posted_date_raw": texts[0] or None,
        "letter_issue_date": us_date(texts[1]),
        "letter_issue_date_raw": texts[1] or None,
        "company_name": texts[2] or None,
        "issuing_office": texts[3] or None,
        "subject": texts[4] or None,
        "response_letter": texts[5] or None,
        "response_letter_urls": linked(5),
        "closeout_letter": texts[6] or None,
        "closeout_letter_urls": linked(6),
    }


def parse_rows(doc):
    data = doc.get("data")
    if not isinstance(data, list):
        raise ValueError("unexpected FDA page shape")
    return [parse_row(cells) for cells in data]


URL_LISTS = ("response_letter_urls", "closeout_letter_urls")


def union(passes):
    """Rows from one or more reads of the table, keyed by letter path.

    A path read more than once must carry identical published values, except the response/closeout link lists: FDA
    has served a different link for the same dated closeout cell on different reads, so every link observed is kept
    (sorted) rather than one chosen.
    """
    out = {}
    for rows in passes:
        for row in rows:
            prior = out.get(row["path"])
            if prior is None:
                out[row["path"]] = {**row, **{k: list(row[k]) for k in URL_LISTS}}
                continue
            if {k: v for k, v in prior.items() if k not in URL_LISTS} != {k: v for k, v in row.items() if k not in URL_LISTS}:
                raise ValueError(f"letter {row['path']} changed between reads")
            for key in URL_LISTS:
                prior[key] = sorted(set(prior[key]) | set(row[key]))
    return out
