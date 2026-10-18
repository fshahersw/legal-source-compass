"""Read FCMS district and court-of-appeals caseload profile pages into raw labelled rows (see layout.py)."""
from pathlib import Path

import layout


def _standing_cols_district(page_words, last_year_right):
    cols = []
    for w in page_words:
        if w[0] > last_year_right + 10 and w[4] in ("U.S.", "U.S", "Circuit", "CIRCUIT"):
            name = "us" if w[4].startswith("U.S") else "circuit"
            if name not in [c[0] for c in cols]:
                cols.append((name, (w[0] + w[2]) / 2))
    return cols


def _standing_cols_circuit(page_words, last_year_right):
    for w in page_words:
        if w[0] > last_year_right + 10 and w[4] in ("Standing", "STANDING", "Numerical", "NUMERICAL"):
            return [("us", (w[0] + w[2]) / 2)]
    return []


def read_page(page, kind, tol=3.0):
    lines = layout.group_lines(page["words"], tol)
    idx, years = layout.year_header(lines)
    if idx is None:
        return None
    panels = layout.panels_from_years(years)
    out = {"years": [], "panels": [], "name": ""}
    months = []
    for line in lines[:idx + 1]:
        for w in line["words"]:
            t = w[4][:3].title()
            if t in ("Mar", "Jun", "Sep", "Dec") and w[4][:3].isalpha() and t not in months:
                months.append(t)
    out["months"] = months
    first_x = min(w[0] for w in panels[0])
    out["name"] = layout.header_text(lines, idx, first_x - 20)
    if kind == "district":
        ys = panels[0]
        last_right = max(w[2] for w in ys)
        cols = _standing_cols_district(page["words"], last_right)
        rows = layout.read_panel(lines, idx + 1, ys, 0, 1e9, standing_cols=cols)
        out["years"] = [[w[4] for w in ys]]
        out["panels"] = [rows]
        out["standing_cols"] = [c[0] for c in cols]
    else:
        # two panels side by side: the left panel ends where the right panel's labels begin
        if len(panels) < 2:
            # single-panel editions (per-panel measures only, roughly 2011-2017)
            ys = panels[0]
            cols = _standing_cols_circuit(page["words"], max(w[2] for w in ys))
            rows = layout.read_panel(lines, idx + 1, ys, 0, 1e9, standing_cols=cols)
            out["years"] = [[w[4] for w in ys]]
            out["panels"] = [rows]
            out["standing_cols"] = [c[0] for c in cols]
            return out
        left, right = panels[0], panels[1]
        left_right_edge = max(w[2] for w in left)
        spacing_left = (left[-1][0] - left[0][0]) / max(1, len(left) - 1)
        boundary = left_right_edge + 0.6 * spacing_left
        last_right = max(w[2] for w in right)
        cols = _standing_cols_circuit(page["words"], last_right)
        rows_left = layout.read_panel(lines, idx + 1, left, 0, 1e9, right_limit=boundary)
        rows_right = layout.read_panel(lines, idx + 1, right, boundary, 1e9, standing_cols=cols)
        out["years"] = [[w[4] for w in left], [w[4] for w in right]]
        out["panels"] = [rows_left, rows_right]
        out["standing_cols"] = [c[0] for c in cols]
    return out


def read_pdf(path, kind, pages=None, tol=3.0):
    result = []
    for number, page in enumerate(layout.pdf_words(Path(path)), 1):
        if pages and number not in pages:
            continue
        parsed = read_page(page, kind, tol)
        if parsed is None:
            result.append({"page": number, "name": None, "years": [], "panels": [], "empty": True})
            continue
        parsed["page"] = number
        result.append(parsed)
    if pages:
        for r in result:
            r["rows"] = [row for panel in r.get("panels", []) for row in panel]
    return result
