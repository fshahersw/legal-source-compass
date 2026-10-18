"""Reader for "Sherman Act Violations Resulting in Criminal Fines & Penalties of $10 Million or More" (DOJ Antitrust Division).

Three published renderings of one list: the web page table (primary reading), the Excel workbook (Sheet1, second reading,
parsed from the xlsx XML with the standard library) and the PDF (third reading: one line per row by regular expression).
Every row keeps the defendant, fiscal year, product, fine ($ millions), geographic scope and country exactly as printed
(whitespace collapsed) plus its position in each rendering.
"""
import os
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

import workload_html

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
FY_RE = re.compile(r"\((\d{4})\)\s*$")
FINE_RE = re.compile(r"^\$?\s*([\d,]+(?:\.\d+)?)$")


def squash(text):
    return re.sub(r"\s+", " ", (text or "").replace(" ", " ")).strip()


def read_html(path):
    with open(path, "rb") as handle:
        tables = workload_html.parse_tables(handle.read())
    rows = None
    for t in tables:
        if t["rows"] and [c["text"] for c in t["rows"][0]][:2] == ["Defendant (FY)", "Product"]:
            rows = t["rows"]
            break
    if rows is None:
        raise ValueError("fines table not found")
    out = []
    for position, row in enumerate(rows[1:], 1):
        cells = [squash(c["text"]) for c in row]
        if len(cells) != 5:
            raise ValueError(f"unexpected row width {len(cells)} at {position}")
        m = FY_RE.search(cells[0])
        if not m:
            raise ValueError(f"no fiscal year in {cells[0]!r}")
        fine = FINE_RE.match(cells[2])
        if not fine:
            raise ValueError(f"unreadable fine {cells[2]!r}")
        out.append({"position": position, "defendant": squash(cells[0][: m.start()]), "fy": int(m.group(1)), "product": cells[1], "fine_text": cells[2],
                    "fine_millions": float(fine.group(1).replace(",", "")), "scope": cells[3], "country": cells[4]})
    return out


def read_xlsx(path):
    """Rows of Sheet1: [{position, defendant, fy, product, fine_millions, scope, country}] straight from the workbook XML."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    grid = []
    for row in sheet.find("m:sheetData", NS).findall("m:row", NS):
        cells = {}
        for c in row.findall("m:c", NS):
            ref = re.match(r"([A-Z]+)", c.get("r")).group(1)
            v = c.find("m:v", NS)
            if v is None:
                continue
            cells[ref] = shared[int(v.text)] if c.get("t") == "s" else v.text
        grid.append(cells)
    out, notes = [], []
    for position, cells in enumerate(grid[1:], 1):
        if not cells:
            continue
        if "B" not in cells or "D" not in cells:
            notes.append(squash(cells.get("A")))  # e.g. the footer "159 (fines & penalties) as of 9/13/23"
            continue
        out.append({"position": position, "defendant": squash(cells.get("A")), "fy": int(float(cells["B"])), "product": squash(cells.get("C")), "fine_millions": float(cells["D"]),
                    "scope": squash(cells.get("E")), "country": squash(cells.get("F"))})
    return out, notes


LINE_RE = re.compile(r"^(?P<lead>.*?)\s{2,}(?P<fy>(?:19|20)\d\d)\s{2,}(?P<mid>.*?)\s+\$(?P<fine>[\d,]+(?:\.\d+)?)\s+(?P<scope>International|Domestic)\s+(?P<tail>.*)$")


def read_pdf(path):
    """Third reading: (fiscal year, fine, scope) per printed row, found by line pattern in `pdftotext -layout` output."""
    text = subprocess.run(["/usr/bin/pdftotext", "-layout", path, "-"], check=True, capture_output=True).stdout.decode("utf-8")
    out = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if m:
            out.append({"fy": int(m.group("fy")), "fine_millions": float(m.group("fine").replace(",", "")), "scope": m.group("scope")})
    return out


def compare(html_rows, xlsx_rows, pdf_rows):
    """Differences between the readings (position by position for the first two; multiset for the PDF)."""
    diffs = []
    if len(html_rows) != len(xlsx_rows):
        diffs.append({"kind": "row_count", "html": len(html_rows), "xlsx": len(xlsx_rows)})
    for a, b in zip(html_rows, xlsx_rows):
        for field in ("defendant", "fy", "product", "fine_millions", "scope", "country"):
            if squash(str(a[field])).lower() != squash(str(b[field])).lower():
                diffs.append({"kind": "field", "position": a["position"], "field": field, "html": a[field], "xlsx": b[field]})
    pdf_counts, html_counts = {}, {}
    for r in pdf_rows:
        k = (r["fy"], r["fine_millions"], r["scope"])
        pdf_counts[k] = pdf_counts.get(k, 0) + 1
    for r in html_rows:
        k = (r["fy"], r["fine_millions"], r["scope"])
        html_counts[k] = html_counts.get(k, 0) + 1
    only_pdf = {k: n - html_counts.get(k, 0) for k, n in pdf_counts.items() if n > html_counts.get(k, 0)}
    only_html = {k: n - pdf_counts.get(k, 0) for k, n in html_counts.items() if n > pdf_counts.get(k, 0)}
    return {"differences": diffs, "pdf_rows": len(pdf_rows), "pdf_only": [list(k) for k in only_pdf], "html_only_vs_pdf": [list(k) for k in only_html]}
