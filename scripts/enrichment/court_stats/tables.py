"""Parsers for U.S. Courts Judicial Business data tables (Excel and PDF editions).

Every parser returns rows keyed by the row label exactly as published ("Total", "DC", "1st", "NY,N", ...),
plus the header path of each column so that columns are located by their published headings, never by guesswork.
Published dashes ("-") are kept as None; callers decide whether a dash is a count of zero or "not computed".
"""
import re
import unicodedata
from pathlib import Path

import openpyxl

ORDINAL = re.compile(r"^(\d{1,2})(ST|ND|RD|TH)$", re.I)
NUMBER = re.compile(r"^-?[\d,]*\.?\d+$")
SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹⁰"


def clean_label(value):
    """Strip footnote superscripts, trailing footnote digits after a district code, and whitespace."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value).replace("_x000D_", " ")).strip()
    text = "".join(ch for ch in text if ch not in SUPERSCRIPTS)
    text = re.sub(r"\s+", " ", text).strip()
    # "WV,S2" or "WV,S 2" (footnote marker) -> "WV,S"
    match = re.match(r"^([A-Z]{2},[A-Z])\s?\d$", text)
    if match:
        text = match.group(1)
    return text


def district_id(label):
    """Map a published district label to the CourtListener court id used in the app; None if not a district."""
    label = clean_label(label).upper()
    if label == "NMI":
        return "nmid"
    if label in ("GU", "GUAM"):
        return "gud"
    match = re.match(r"^([A-Z]{2}),([A-Z])$", label)
    if match:
        return (match.group(1) + match.group(2) + "d").lower()
    if re.match(r"^[A-Z]{2}$", label):
        return label.lower() + "d"
    return None


def circuit_id(label):
    """Map a published circuit label ("1st", "11TH", "DC") to the CourtListener appellate id."""
    label = clean_label(label).upper()
    match = ORDINAL.match(label)
    if match:
        return f"ca{int(match.group(1))}"
    if label == "DC":
        return "cadc"
    return None


DASH = "-"
DASHES = ("-", "--", "—", "–")


def is_dash(value):
    """True for a cell printed as a dash (the source's mark for zero, not applicable or not computed)."""
    return isinstance(value, str) and value.strip() in DASHES


def to_number(value):
    """Numbers stay numbers; published dashes, blanks and text become None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().replace(",", "")
    if text in ("", "-", "--", "—", "–", "N/A", "NA"):
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() and "." not in text else number


def xlsx_sheets(path):
    """Yield (sheet_title, header_paths, rows) for each sheet.

    header_paths[i] is the ' / '-joined heading text above column i (merged cells are filled across their span).
    rows is a list of (label, [values...]) for rows whose first cell is a non-empty label.
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        grid = [[cell for cell in row] for row in ws.iter_rows(values_only=True)]
        width = max((len(r) for r in grid), default=0)
        for merged in ws.merged_cells.ranges:
            value = ws.cell(merged.min_row, merged.min_col).value
            for r in range(merged.min_row, merged.max_row + 1):
                for c in range(merged.min_col, merged.max_col + 1):
                    if r - 1 < len(grid) and c - 1 < len(grid[r - 1]):
                        grid[r - 1][c - 1] = value
        first_data = next((i for i, row in enumerate(grid) if clean_label(row[0] if row else "").upper() in ("TOTAL",)), None)
        if first_data is None:
            continue
        header_rows = grid[1:first_data]
        paths = []
        for col in range(width):
            parts = []
            for row in header_rows:
                value = row[col] if col < len(row) else None
                text = clean_label(value)
                if text and len(text) < 120 and (not parts or parts[-1] != text):
                    parts.append(text)
            paths.append(" / ".join(parts))
        rows = []
        for row in grid[first_data:]:
            label = clean_label(row[0] if row else "")
            if not label or len(label) > 40:
                continue
            rows.append((label, list(row[1:])))
        yield ws.title, paths, rows


LABEL = r"(TOTAL|Total|DC|\d{1,2}(?:ST|ND|RD|TH|st|nd|rd|th)|[A-Z]{2},[A-Z]|NMI|GU|GUAM|[A-Z]{2})"
TOKEN = r"(-?[\d,]*\.?\d+|--?)"
SPLIT_THOUSANDS = re.compile(r"(?<=\d) ,(?=\d{3}\b)")


SPLIT_DECIMAL = re.compile(r"(?<=\d)(?:\. | \.)(?=\d)")


def repair_line(line):
    """Undo spaces the PDF text layer inserts inside a single printed number, where the split is unambiguous:
    "1 ,063" -> "1,063" (a token never starts with a comma), "14. 5" / "-4 .2" -> "14.5" / "-4.2" (a token never
    ends or starts with a decimal point), and the split row label "T otal" -> "Total". Splits between digits
    ("2 37,453") are ambiguous and are left alone, so such rows fail their width check and are not used."""
    line = line.strip()
    if line.startswith(("T otal", "T OTAL")):
        line = "Total" + line[6:]
    line = SPLIT_THOUSANDS.sub(",", line)
    return SPLIT_DECIMAL.sub(".", line)


def pdf_rows(path):
    """Rows (label, [values]) from the text layer of a published PDF table (all pages, in order)."""
    import pdfplumber

    pattern = re.compile(rf"^{LABEL}(?:\s?[¹²³\d](?=\s))?((?:\s+{TOKEN})+)\s*$")
    rows = []
    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages):
            for line in page_lines(page):
                line = line.strip()
                match = pattern.match(line)
                if not match:
                    continue
                values = match.group(2).split()
                rows.append((clean_label(match.group(1)), [None if v == "-" else to_number(v) for v in values], page_no))
    return rows


def char_lines(page, line_tolerance=2.0, gap=1.0):
    """Text lines rebuilt from character positions.

    Some editions' text layer (pdfplumber extract_text) splits printed numbers and labels ("2 0,565", "C T")
    although the glyphs are contiguous on the page. Here characters are clustered into lines by their top
    coordinate, ordered by x, and a space is inserted only where there is a visible gap of more than `gap`
    points between printed glyphs, so each printed number comes back as one token. Space glyphs are ignored:
    these editions carry stray padding spaces on a slightly offset baseline that fall inside printed numbers."""
    chars = sorted((c for c in page.chars if c.get("text") and not c["text"].isspace()), key=lambda c: (c["top"], c["x0"]))
    clusters = []
    for c in chars:
        if clusters and abs(c["top"] - clusters[-1]["top"]) <= line_tolerance:
            clusters[-1]["chars"].append(c)
        else:
            clusters.append({"top": c["top"], "chars": [c]})
    lines = []
    for cluster in clusters:
        parts, last_x1 = [], None
        for c in sorted(cluster["chars"], key=lambda c: c["x0"]):
            if last_x1 is not None and c["x0"] - last_x1 > gap:
                parts.append(" ")
            parts.append(c["text"])
            last_x1 = c["x1"]
        lines.append(re.sub(r"\s+", " ", "".join(parts)).strip())
    return [line for line in lines if line]


def page_lines(page):
    return char_lines(page)


def pdf_text(path):
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        return "\n".join("\n".join(page_lines(page)) for page in pdf.pages)


def find_file(folder: Path, table: str, ext: str):
    matches = sorted(folder.glob(f"{table}__*.{ext}"))
    return matches[0] if matches else None
