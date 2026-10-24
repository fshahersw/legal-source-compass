"""Read the owner's court-buildings workbook into plain dict rows.

Each data sheet carries a title block above its header row; the header row is the first row whose first cell equals the
sheet's known first column name. Values are returned as stripped strings; empty cells are omitted.
"""
import openpyxl

# First header cell of each data sheet the builder reads.
HEADER_FIRST = {
    "Buildings": "Building / site",
    "Court Directory": "Court / adjudicative organization",
    "Top Courts": "Court",
    "Federal Offices": "Office / court location",
    "County Photos": "County / equivalent",
}


def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    return text


def sheet_rows(ws, first):
    """Yield (row_number, {header: value}) for every data row under the header row whose first cell is `first`."""
    header = None
    for number, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if header is None:
            if row and clean(row[0]) == first:
                header = [clean(c) for c in row]
            continue
        values = {}
        for key, cell in zip(header, row):
            text = clean(cell)
            if key and text:
                values[key] = text
        if values:
            yield number, values
    if header is None:
        raise ValueError(f"{ws.title}: header row starting {first!r} not found")


def read_workbook(path, sheets=None):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    try:
        for name, first in HEADER_FIRST.items():
            if sheets and name not in sheets:
                continue
            out[name] = list(sheet_rows(wb[name], first))
    finally:
        wb.close()
    return out


def split_ids(value):
    """Linked court IDs are separated by '|', ';' or ','; each id is kept exactly as written (no case folding)."""
    if not value:
        return []
    parts = value.replace(";", "|").replace(",", "|").split("|")
    return [p.strip() for p in parts if p.strip()]
