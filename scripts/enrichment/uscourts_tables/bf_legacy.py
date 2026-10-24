"""Read the Bankruptcy Filings workbooks of 2001 to March 2009, which are mainframe printouts saved as spreadsheets.

These workbooks print their column headings as words stacked in separate cells (" TOTAL" over " FILINGS"; " CHAP." over " 7"),
row labels with dot leaders ("NY,N...."), a dash as text ("      -") and percent changes as text ("       .1"). The workbook parser
does not read them (utx_parse cannot tell from merged cells which columns a group heading covers). Here each layout is read
only when its stacked headings are exactly one of the two layouts below, and its own sums fix which columns form a group:

  F-2 (three months and twelve months), 14 columns:
    TOTAL FILINGS | CHAP. 7 | CHAP. 11 | CHAP. 12 | CHAP. 13 | TOTAL BUSINESS FILINGS | CHAP. 7 | 11 | 12 | 13 |
    TOTAL NON-BUSINESS FILINGS | CHAP. 7 | 11 | 13
    every row: total filings = business + nonbusiness; total chapter 7, 11 and 13 = the business plus the nonbusiness figure of that
    chapter; total chapter 12 = the business chapter 12 figure (no nonbusiness chapter 12 column is printed).
  F (twelve months), 9 columns: FILINGS, TERMINATIONS, PENDING, each as <previous year> | <year> | PERCENT CHANGE
    every row: the printed percent change equals (year - previous year) / previous year x 100 rounded to the printed decimal, or
    the publisher's dash where it computes none.

The columns then take the keys of the same table's later spreadsheet editions (Bankruptcy Filings, June 2009 on), so the series
continue. A workbook that does not match a layout exactly, or breaks one of these identities in any row, is not read.
Usage: python3 -I -B bf_legacy.py [--force]
"""
import gzip
import io
import json
import re
import sys
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import utx_parse as P  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
LEGACY_VERSION = "bf-legacy-2026-10-25.1"
warnings.filterwarnings("ignore")

F2_HEADINGS = ["TOTAL FILINGS", "CHAP. 7", "CHAP. 11", "CHAP. 12", "CHAP. 13", "TOTAL BUSINESS FILINGS", "CHAP. 7", "CHAP. 11", "CHAP. 12",
               "CHAP. 13", "TOTAL NON- BUSINESS FILINGS", "CHAP. 7", "CHAP. 11", "CHAP. 13"]
_D = "predominant_nature_of_debt"
F2_KEYS = ["total_filings", "total_chapter_7", "total_chapter_11", "total_chapter_12", "total_chapter_13",
           f"{_D}/business_filings/total", f"{_D}/business_filings/chapter_7", f"{_D}/business_filings/chapter_11", f"{_D}/business_filings/chapter_12",
           f"{_D}/business_filings/chapter_13", f"{_D}/nonbusiness_filings/total", f"{_D}/nonbusiness_filings/chapter_7",
           f"{_D}/nonbusiness_filings/chapter_11", f"{_D}/nonbusiness_filings/chapter_13"]
F2_PATHS = [["Total Filings"], ["Total Chapter 7"], ["Total Chapter 11"], ["Total Chapter 12"], ["Total Chapter 13"],
            ["Predominant Nature of Debt", "Business Filings", "Total"], ["Predominant Nature of Debt", "Business Filings", "Chapter 7"],
            ["Predominant Nature of Debt", "Business Filings", "Chapter 11"], ["Predominant Nature of Debt", "Business Filings", "Chapter 12"],
            ["Predominant Nature of Debt", "Business Filings", "Chapter 13"], ["Predominant Nature of Debt", "Nonbusiness Filings", "Total"],
            ["Predominant Nature of Debt", "Nonbusiness Filings", "Chapter 7"], ["Predominant Nature of Debt", "Nonbusiness Filings", "Chapter 11"],
            ["Predominant Nature of Debt", "Nonbusiness Filings", "Chapter 13"]]
# (total, [parts]) by position, in every row
F2_SUMS = [(0, [5, 10]), (1, [6, 11]), (2, [7, 12]), (4, [9, 13]), (3, [8])]
F_GROUPS = [("FILINGS", "filed", "Filings"), ("TERMINATIONS", "terminated", "Terminations"), ("PENDING", "pending", "Pending")]


def text(v):
    return re.sub(r"\s+", " ", str(v).strip().strip("'")).strip() if v is not None else ""


def cell_value(v):
    """(value, flag) of a printout cell: a number; a dash ('dash'); a number printed as text (".1", "-5.0")."""
    if v is None:
        return None, "blank"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return (int(v) if float(v).is_integer() else v), None
    t = text(v)
    if t in ("-", "--"):
        return None, "dash"
    if re.fullmatch(r"-?\d*\.\d+|-?\d+", t.replace(",", "")):
        x = float(t.replace(",", ""))
        return (int(x) if re.fullmatch(r"-?\d+", t.replace(",", "")) else x), "textnum"
    if t in ("NA", "N/A", "(NA)"):
        return None, "na"
    return None, "text:" + t[:30]


def grid_of(data):
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    ws = wb.worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def find_layout(grid):
    """(title text, first data row index, stacked heading per value column) or None."""
    first = None
    for i, row in enumerate(grid):
        if row and text(row[0]).rstrip(".").upper() == "TOTAL" and any(isinstance(v, (int, float)) for v in row[1:]):
            first = i
            break
    if first is None:
        return None
    title_rows, heading_rows = [], []
    for row in grid[:first]:
        cells = [text(v) for v in row]
        if not any(cells):
            continue
        if sum(1 for c in cells if c) == 1 and cells[0] and not heading_rows:
            title_rows.append(cells[0])
        else:
            heading_rows.append(cells)
    width = max(len(r) for r in grid)
    stacked = []
    for c in range(1, width):
        words = [r[c] for r in heading_rows if c < len(r) and r[c]]
        stacked.append(re.sub(r"\s*\*+$", "", re.sub(r"^\*\s*", "", " ".join(words))).strip())  # "*" footnote marks
    while stacked and not stacked[-1]:
        stacked.pop()
    return " ".join(title_rows), first, stacked


def label_of(v):
    return re.sub(r"\.{2,}$", "", text(v)).strip()


def read(entry, data):
    """(norm, reasons)."""
    grid = grid_of(data)
    found = find_layout(grid)
    if not found:
        return None, ["no TOTAL row"]
    title, first, stacked = found
    phrase, end = P.parse_period_phrase(title)
    reasons = []
    if end != entry["period_end"]:
        reasons.append(f"period in title {end} differs from listing {entry['period_end']}")
    m = re.search(r"TABLE\s+([A-Z]-?\d*)", title)
    printed = m.group(1) if m else None
    listed = re.sub(r"\s*\(.*\)$", "", entry["table"]).upper()
    if printed != listed:
        reasons.append(f"title table {printed} != listing {listed}")
    year = int(entry["period_end"][:4])
    if _f2_layout(stacked):
        keys, layout = F2_KEYS, "f2"
        # the column paths say what this edition prints: "Predominant Nature of Debt" only where it prints that group heading (the
        # keys are the later editions' keys either way, so the series continue)
        printed_group = "PREDOMI" in canon(" ".join(stacked))
        paths = [p if printed_group or len(p) < 3 else p[1:] for p in F2_PATHS]
        columns = [{"index": i + 1, "key": k, "path": p, "label": " / ".join(p), "fmt": "#,##0", "marks": [], "prior": False} for i, (k, p) in enumerate(zip(keys, paths))]
    elif _f_layout(stacked, year):
        layout = "f"
        columns = []
        for k, (g, key, lab) in enumerate(F_GROUPS):
            columns += [{"index": 3 * k + 1, "key": f"{key}/y-1", "path": [lab, str(year - 1)], "label": f"{lab} / {year - 1}", "fmt": "#,##0", "marks": [], "prior": True},
                        {"index": 3 * k + 2, "key": f"{key}/y0", "path": [lab, str(year)], "label": f"{lab} / {year}", "fmt": "#,##0", "marks": [], "prior": False},
                        {"index": 3 * k + 3, "key": f"{key}/percent_change", "path": [lab, "Percent Change"], "label": f"{lab} / Percent Change", "fmt": "0.0", "marks": [], "prior": False}]
    else:
        return None, reasons + [f"headings are not a known printout layout: {stacked[:6]}"]
    if reasons:
        return None, reasons
    rows, problems = [], []
    for i in range(first, len(grid)):
        row = grid[i]
        if not row or not text(row[0]):
            continue
        label = label_of(row[0])
        vals = [cell_value(row[c]) if c < len(row) else (None, "blank") for c in range(1, len(columns) + 1)]
        if all(f == "blank" for _, f in vals):
            break  # the notes under the table
        entity = N.classify_row("bankruptcy", label)
        if entity[0] == "other":
            break  # the notes under the table ("*PERCENT CHANGE NOT COMPUTED ...", "(1) PERCENT ...")
        values, flags = [v for v, _ in vals], [f if f not in ("textnum",) else None for _, f in vals]
        if any(f == "blank" or (f or "").startswith("text:") for f in flags):
            problems.append(f"row {label}: a cell that is not a figure or a dash")
            continue
        rows.append({"label_raw": text(row[0]), "label": label, "indent": 0, "section": False, "values": values, "flags": flags, "row": i + 1,
                     "marks": [], "cell_marks": {}, "entity": entity[0], "entity_id": entity[1], "path": [label]})
    if problems:
        return None, problems[:3]
    reasons = identities(layout, rows)
    if reasons:
        return None, reasons
    notes = [text(v) for r in grid[i:] for v in r if text(v)][:20]
    norm = {"pub": entry["pub"], "table": entry["table"], "table_key": N.table_slug(entry["table"]), "period_end": entry["period_end"],
            "months": N.months_of(phrase, None), "period_phrase": phrase, "title": entry["title"], "title_listing": entry["title"],
            "printed_table_id": printed, "scope": "bankruptcy", "row_kinds": {}, "label_header": ["Circuit and District"], "columns": columns, "rows": rows,
            "notes": notes, "note_marks": {}, "sheet": "Sheet1", "problems": [], "hierarchy": "indent", "ambiguous_rows": [], "sheet_index": 0,
            "warnings": ["This edition is a mainframe printout saved as a spreadsheet; its stacked column headings were read as one of two fixed "
                         "layouts and confirmed by the table's own sums in every row (bf_legacy.py)."]}
    return norm, []


def canon(t):
    """Letters and digits of a stacked heading, footnote marks such as "(1)" removed: the printouts split words over cells and pad
    them with stray dots ("CHAP 12", ". CHAP. 13", "TOTAL NON- . BUSINESS FILINGS")."""
    t = re.sub(r"\(\d\)?|\)", " ", t.upper())
    return re.sub(r"[^A-Z0-9]", "", t)


def _f2_layout(stacked):
    """The F-2 layout: every column's stacked heading ends with the expected heading; the words in front of a business or nonbusiness
    heading ("PREDOMI", "NANT NATU", "RE OF DE", "BT(1)") are pieces of the group heading "PREDOMINANT NATURE OF DEBT" printed across
    those columns, and are allowed only there."""
    if len(stacked) != len(F2_HEADINGS):
        return False
    group = ""
    for k, (s, want) in enumerate(zip(stacked, F2_HEADINGS)):
        c, w = canon(s), canon(want)
        if not c.endswith(w):
            return False
        prefix = c[: len(c) - len(w)]
        if prefix and k < 5:
            return False
        group += prefix
    return group in ("", "PREDOMINANTNATUREOFDEBTPREDOMINANTNATUREOFDEBT") or group.startswith("PREDOMINANTNATUREOFDEBT")


def _f_layout(stacked, year):
    """The F layout: FILINGS / TERMINATIONS / PENDING groups of <previous year> <year> PERCENT CHANGE; the group word may be printed
    over either year column or split over both ("TERM" / "INATIONS")."""
    if len(stacked) != 9:
        return False
    for k, (g, _, _) in enumerate(F_GROUPS):
        triple = stacked[3 * k: 3 * k + 3]
        clean = [re.sub(r"\(\d\)?|\)", " ", t) for t in triple]
        years = [re.findall(r"(?:19|20)\d{2}", t) for t in clean]
        if years != [[str(year - 1)], [str(year)], []]:
            return False
        if re.sub(r"[^A-Z]", "", "".join(clean).upper()) != g + "PERCENTCHANGE":
            return False
    return True


def identities(layout, rows):
    bad = []
    for r in rows:
        v = [0 if (x is None and f == "dash") else x for x, f in zip(r["values"], r["flags"])]
        if layout == "f2":
            for total, parts in F2_SUMS:
                if any(v[p] is None for p in parts) or v[total] is None:
                    continue
                if v[total] != sum(v[p] for p in parts):
                    bad.append(f"{r['label']}: column {total + 1} {v[total]} != {sum(v[p] for p in parts)}")
        else:
            for k in range(3):
                prev, cur, pct = r["values"][3 * k], r["values"][3 * k + 1], r["values"][3 * k + 2]
                if r["flags"][3 * k + 2] == "dash" or pct is None:
                    continue
                if prev in (None, 0) or cur is None:
                    bad.append(f"{r['label']}: a percent change printed where none can be computed")
                    continue
                computed = (cur - prev) / prev * 100
                # the printed change is rounded to one decimal; some editions compute it from the prior year's revised figure (their
                # note says so), so up to 0.15 percentage points from the printed figures is the same column; a column read in
                # the wrong place is off by far more
                if abs(computed - pct) > 0.15:
                    bad.append(f"{r['label']}: group {k + 1} percent change {pct} but the figures give {computed:.2f}")
    return [f"{len(bad)} rows break the table's own identities, first {bad[0]}"] if bad else []


def main():
    force = "--force" in sys.argv
    index = json.loads((F.ACQ / "files_index.json").read_text())
    ingest = json.loads((BUILD / "ingest_report.json").read_text())
    legacy = {r["key"] for r in ingest.get("rejected", []) if "legacy printout" in " ".join(r.get("reasons") or [])}
    report = {"accepted": [], "rejected": []}
    for key in sorted(legacy):
        entry = index[key]
        if entry["pub"] != "BF":
            continue
        target = PARSED / entry["pub"] / entry["period_end"] / (N.table_slug(entry["table"]) + ".json.gz")
        if target.exists() and not force:
            have = json.loads(gzip.decompress(target.read_bytes()))
            if have.get("parser_version") == LEGACY_VERSION and have["source"]["sha256"] == entry["sha256"]:
                report["accepted"].append(key)
                continue
        converted = BUILD / "xls_converted" / f"{entry['sha256']}.xlsx"
        if entry["format"] == "xls" and not converted.exists():
            report["rejected"].append({"key": key, "reasons": ["xls not converted"]})
            continue
        data = converted.read_bytes() if entry["format"] == "xls" else F.read_stored(F.ROOT / entry["path"])
        norm, reasons = read(entry, data)
        if norm is None:
            report["rejected"].append({"key": key, "reasons": reasons})
            continue
        doc = {"parser_version": LEGACY_VERSION, "reader": "bf_legacy",
               "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                          "sha256": entry["sha256"], "bytes": entry["bytes"], "format": entry["format"]},
               "sheets": [norm], "rejected_sheets": []}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
        report["accepted"].append(key)
    (BUILD / "bf_legacy_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({"accepted": len(report["accepted"]), "rejected": len(report["rejected"]), "first_rejections": report["rejected"][:3]}))


if __name__ == "__main__":
    main()
