"""Reader for the DOJ Antitrust Division workload-statistics web pages (FY1970-1979 and FY1980-1989 .htm editions).

Those two editions exist both as PDF and as HTML tables; this reader gives an independent second reading of the same
published figures (used to cross-check the PDF reader, workload_pdf.py). Standard library only.

A page is a sequence of <table> elements. A table is a data table when one of its rows is a header: first cell is the
table heading, the other cells are fiscal years. Footnote marks are <sup> elements inside <a href="#N_n_"> links and are
kept apart from the printed value. A row with a single cell between data rows is a sub-heading for the rows below.
"""
import html
import re
from html.parser import HTMLParser

YEAR_RE = re.compile(r"^(19[5-9]\d|20[0-4]\d)$")


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._stack = []  # open tables (nested tables do not occur in these pages, but stay safe)
        self._row = None
        self._cell = None
        self._in_sup = False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._stack.append({"rows": []})
        elif tag == "tr" and self._stack:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = {"text": [], "marks": [], "th": tag == "th"}
        elif tag == "sup" and self._cell is not None:
            self._in_sup = True
            self._cell["marks"].append("")
        elif tag == "br" and self._cell is not None and not self._in_sup:
            self._cell["text"].append(" ")

    def handle_endtag(self, tag):
        if tag == "sup":
            self._in_sup = False
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            text = re.sub(r"\s+", " ", "".join(self._cell["text"]).replace("\xa0", " ")).strip()
            self._row.append({"text": text, "marks": [m.strip() for m in self._cell["marks"] if m.strip()], "th": self._cell["th"]})
            self._cell = None
        elif tag == "tr" and self._row is not None and self._stack:
            self._stack[-1]["rows"].append(self._row)
            self._row = None
        elif tag == "table" and self._stack:
            self.tables.append(self._stack.pop())

    def handle_data(self, data):
        if self._cell is None:
            return
        if self._in_sup:
            self._cell["marks"][-1] += data
        else:
            self._cell["text"].append(data)


def parse_tables(markup):
    parser = _Tables()
    parser.feed(markup if isinstance(markup, str) else markup.decode("utf-8", "replace"))
    return parser.tables


def read_html_tables(markup):
    """Return [{index, heading, heading_marks, years, rows:[{label, marks, values:[{as_published, marks}], row_index}], ...}]

    `index` is the 0-based position of the <table> in the page (the locator kept with every value). `years` is the header's
    list of fiscal years exactly as printed (a printed header can be shorter than the data rows: see `short_header`).
    """
    out = []
    for index, table in enumerate(parse_tables(markup)):
        rows = table["rows"]
        header_at = None
        for i, row in enumerate(rows):
            years = [c["text"] for c in row[1:] if YEAR_RE.match(c["text"])]
            if len(row) >= 6 and len(years) >= 5 and len(years) == len(row) - 1:
                header_at = i
                break
        if header_at is None:
            continue
        header = rows[header_at]
        item = {
            "index": index,
            "heading": header[0]["text"],
            "heading_marks": list(header[0]["marks"]),
            "years": [int(c["text"]) for c in header[1:]],
            "rows": [],
            "group": None,
        }
        group = None
        n_values = len(header) - 1
        for r, row in enumerate(rows[header_at + 1:], header_at + 1):
            if len(row) == 1:
                group = row[0]["text"].strip()
                continue
            label = row[0]["text"]
            label_marks = list(row[0]["marks"])
            # a footnote digit printed after the label text without <sup> markup is left in the label text (never guessed)
            values = []
            for cell in row[1:]:
                text, marks = cell["text"], list(cell["marks"])
                m = re.fullmatch(r"(\$?-?[\d,]+(?:\.\d+)?|-)\s+(\d{1,2})", text)
                if m and not cell["marks"]:
                    text, marks = m.group(1), [m.group(2)]  # "52 2": value 52 with footnote 2, printed as text
                values.append({"as_published": text, "marks": marks})
            item["rows"].append({"label": label, "label_marks": label_marks, "group": group, "values": values, "row_index": r})
        item["short_header"] = bool(item["rows"]) and n_values < max(len(rw["values"]) for rw in item["rows"])
        out.append(item)
    return out
