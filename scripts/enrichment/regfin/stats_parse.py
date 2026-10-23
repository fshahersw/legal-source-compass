"""Parse the SEC Division of Investment Management "Investment Adviser Statistics" supporting-data workbook.

One sheet per table ("Tab.1.1" ...) plus a Notes sheet that names each table and says which Form ADV items it relies on.
Cells are kept exactly as published: year columns are the header cells that are four-digit years, the label columns are the
columns before them, and every year cell is a number or None (blank = not recorded). Nothing is filled or interpolated.
"""
import re

import openpyxl

YEAR = re.compile(r"^(19|20)\d{2}$")


def read_workbook(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    notes = {}
    tables = {}
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        if ws.title == "Notes":
            for r in rows:
                if len(r) >= 2 and r[0] and r[1] and str(r[0]).startswith("Tab."):
                    notes[str(r[0]).strip()] = str(r[1]).strip()
            continue
        if ws.title.startswith("Tab."):
            tables[ws.title] = rows
    return notes, tables


def parse_table(tab, rows, note):
    """Structured table: {tab, title, method_note, label_columns, years, rows:[{labels:[...], values:[num|None...]}]}"""
    header = [("" if c is None else str(c).strip()) for c in rows[0]]
    year_idx = [i for i, h in enumerate(header) if YEAR.match(h)]
    if not year_idx:
        raise ValueError(f"{tab}: no year columns in header {header!r}")
    first = year_idx[0]
    label_cols = header[:first]
    out_rows = []
    for r in rows[1:]:
        cells = list(r) + [None] * (len(header) - len(r))
        labels = [("" if c is None else str(c).strip()) for c in cells[:first]]
        if not any(labels) and all(c is None for c in cells):
            continue
        if labels and labels[0].startswith("Return to Notes"):
            continue
        values = []
        for i in year_idx:
            v = cells[i]
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                values.append(None)
            else:
                values.append(v)
        out_rows.append({"labels": labels, "values": values})
    title, _, method = (note or "").partition("\n")
    return {
        "tab": tab,
        "title": title.strip() or None,
        "method_note": " ".join(method.split()) or None,
        "label_columns": label_cols,
        "years": [int(header[i]) for i in year_idx],
        "rows": out_rows,
    }
