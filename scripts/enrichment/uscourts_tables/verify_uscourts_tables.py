"""Independent verification of the uscourts_tables_* build files (second code path: no utx_parse, no normalize).

  1. cells:  N random stored values (court records and national Total rows) are looked up again in the source workbook that the
             record's `src` names (by sha256): the row is found by its published label, the column by its published heading
             path (merged headings resolved from the workbook's merge ranges), and the cell value is compared with the stored
             value (equal, or within 5e-7 where floats were rounded to 6 decimals; a stored null must be a dash, blank or text).
  2. sums:   for every district / bankruptcy table-period and every count column, the sum of the stored district values is
             compared with the national Total row the publisher printed (and the circuit values with the circuit rows).
             Cells with a missing district value are counted as 'incomplete', never as matches.
  4. pdf periods: every table-period that was READ FROM A PDF (no workbook exists for it) is compared, court by court and column by
             column, with the prior-year column of the spreadsheet edition one year later, where that edition prints one.
  3. pdf:    N random table-periods that have both a workbook and a PDF are fetched as PDF (1 request per second) and the PDF
             row of a random court is compared, figure by figure, with the stored workbook row (all printed columns).

Writes private/build/uscourts_tables/verification.json and prints a summary. Usage:
  python3 -I -B verify_uscourts_tables.py [--cells 40] [--pdf 10] [--seed 1023] [--no-pdf]
"""
import argparse
import io
import json
import random
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
COURT_DATASETS = ["uscourts_tables_district", "uscourts_tables_bankruptcy", "uscourts_tables_circuit", "uscourts_bapcpa", "uscourts_dnsw"]
CATEGORY_DATASETS = ["uscourts_tables_national", "uscourts_bapcpa", "uscourts_wiretap"]
# whole words, written independently of reconcile.py ("misdemeanor" is a count column)
NON_ADDITIVE = re.compile(r"\b(?:percent|percentage|median|means?|averages?|avg|per|rates?|weighted|ratios?|months?|days?|times?|length|intervals?|index|shares?|judges?|judgeships?|costs?|dollars?)\b|%|\$", re.I)
SUPER = "¹²³⁴⁵⁶⁷⁸⁹⁰"


_LOADED = {}


def load(dataset):
    """A build file, gzip-compressed (<dataset>.json.gz) or plain; an absent dataset is empty."""
    if dataset not in _LOADED:
        import gzip
        gz, plain = BUILD / f"{dataset}.json.gz", BUILD / f"{dataset}.json"
        if gz.exists():
            _LOADED[dataset] = json.loads(gzip.decompress(gz.read_bytes()))
        elif plain.exists():
            _LOADED[dataset] = json.loads(plain.read_text())
        else:
            _LOADED[dataset] = {"rows": []}
    return _LOADED[dataset]


def clean(text):
    text = "".join(ch for ch in unicodedata.normalize("NFKC", str(text).replace("_x000D_", " ")) if ch not in "¹²³⁴⁵⁶⁷⁸⁹⁰")
    text = "".join(ch for ch in str(text))
    return re.sub(r"\s+", " ", text).strip()


def clean_keep_super(text):
    t = str(text).replace("_x000D_", " ")
    t = "".join(ch for ch in t if ch not in SUPER)
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------------------------------------------------------------ source lookup
def index_by_sha():
    index = json.loads((F.ACQ / "files_index.json").read_text())
    reports = F.ACQ / "reports_index.json"  # the report publications outside the caseload listing (acquire_reports.py)
    if reports.exists():
        index = {**index, **{f"report|{k}": v for k, v in json.loads(reports.read_text()).items()}}
    return {e["sha256"]: e for e in index.values() if e.get("sha256")}


def workbook_bytes(entry):
    if entry["format"] == "xls":
        return (BUILD / "xls_converted" / f"{entry['sha256']}.xlsx").read_bytes()
    return F.read_stored(F.ROOT / entry["path"])


def header_paths(ws, first_data_row):
    """{column index (1-based): heading path} from the rows above the first data row, merged ranges resolved. Title cells (a
    merged range that starts in column A and spans three or more columns, or a cell that starts with "Table") are not headings."""
    top = {}
    skip_rows = set()
    for rng in ws.merged_cells.ranges:
        value = ws.cell(rng.min_row, rng.min_col).value
        if rng.min_col == 1 and rng.max_col - rng.min_col >= 2 and rng.min_row < first_data_row:
            skip_rows.add(rng.min_row)
            continue
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                top[(r, c)] = value
    for r in range(1, first_data_row):
        a = ws.cell(r, 1).value
        if isinstance(a, str) and a.strip().lower().startswith(("table", "\ntable")):
            skip_rows.add(r)
    paths = {}
    for c in range(1, ws.max_column + 1):
        parts = []
        for r in range(1, first_data_row):
            if r in skip_rows:
                continue
            v = top.get((r, c), ws.cell(r, c).value)
            t = clean_keep_super(v) if v is not None else ""
            if t and (not parts or parts[-1] != t):
                parts.append(t)
        paths[c] = parts
    return paths


def norm_heading(text, base_year):
    """Heading text with every 4-digit year replaced by its distance from the base year (the year of the edition the heading is
    from), so "Pending / 2025" in the 2025 edition and "Pending / 2026" in the 2026 edition compare equal while the prior-year
    column "Pending / 2024" does not."""
    text = re.sub(r"\b((?:19|20)\d{2})\b", lambda m: f"<{int(m.group(1)) - base_year}>", text)
    # footnote braces / parentheses and spacing differ between editions of the same heading ("HIA{1}" vs "HIA(1)")
    text = re.sub(r"[^a-z0-9/<>-]+", "", text.lower())
    # the publisher re-worded the top-level heading of the same count columns over time (the builder merges exactly these)
    for old_word, new_word in (("filings", "filed"), ("commenced", "filed"), ("terminations", "terminated")):
        if text.startswith(old_word + "/") or text == old_word:
            return new_word + text[len(old_word):]
    return text


def _label_form(text):
    return re.sub(r",\s+", ",", clean_keep_super(text)).lower()


def row_label_matches(cell_value, label):
    return cell_value is not None and _label_form(cell_value) == _label_form(label)


def first_numeric_row(ws):
    """The first row whose label cell is non-empty and that carries at least two numbers: the first data row."""
    for r in range(1, ws.max_row + 1):
        label = next((ws.cell(r, c).value for c in (1, 2) if ws.cell(r, c).value not in (None, "")), None)
        numbers = sum(1 for c in range(2, ws.max_column + 1) if as_number(ws.cell(r, c).value) is not None or (isinstance(ws.cell(r, c).value, str) and ws.cell(r, c).value.strip() in "-–—"))
        if label is not None and numbers >= 2 and not re.fullmatch(r"(19|20)\d{2}", str(label).strip()) and not all(1900 <= (as_number(ws.cell(r, c).value) or 0) <= 2100 for c in range(2, ws.max_column + 1) if as_number(ws.cell(r, c).value) is not None):
            return r
    return None


def lookup_cell(data, sheet, row_label, col_label, label_year, file_year, occurrence=0):
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    ws = wb[sheet] if sheet in wb.sheetnames else wb.worksheets[0]
    first_data = first_numeric_row(ws)
    if first_data is None:
        return None, "no data rows"
    rows = [r for r in range(first_data, ws.max_row + 1) if any(row_label_matches(ws.cell(r, c).value, row_label) for c in (1, 2))]
    if not rows:
        return None, "row not found"
    r = rows[min(occurrence, len(rows) - 1)]
    paths = header_paths(ws, first_data)
    want = clean_keep_super(col_label)
    cols = [c for c, p in paths.items() if c > 1 and norm_heading(" / ".join(p), file_year) == norm_heading(want, label_year)]
    if not cols:
        return None, f"column not found: {want}"
    holding = [c for c in cols if as_number(ws.cell(r, c).value) is not None or str(ws.cell(r, c).value).strip() in ("-", "–", "—")]
    cell = ws.cell(r, (holding or cols)[0])
    # a percent-formatted number is printed times 100 (0.9013 shows as 90.1%); the builder stores the printed percentage
    if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool) and "%" in (cell.number_format or ""):
        return cell.value * 100, None
    return cell.value, None


def as_number(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    if isinstance(v, str):
        t = v.replace(",", "").strip().rstrip("%")
        t = "".join(ch for ch in t if ch not in SUPER)
        if re.fullmatch(r"-?\d+(\.\d+)?", t):
            return float(t)
    return None


# ------------------------------------------------------------------------------------------------------------ 1. cells
def sample_cells(n, rng):
    pool = []
    for ds in COURT_DATASETS + ["uscourts_tables_national"]:
        for row in load(ds)["rows"]:
            ust = row["item"].get("ust")
            if not ust or ust.get("kind") == "latest":
                continue
            if ust["scope"] == "national":
                continue  # category rows have no unique court label; their Total row is covered through the court records' nat series
            from_pdf = {i for i, p in enumerate(ust["periods"]) if ust["src"][p["src"]].get("fmt") == "pdf"}  # checked by verify_pdf_periods
            for ck, values in ust["data"].items():
                for i, v in enumerate(values):
                    if v is not None and i not in from_pdf:
                        pool.append((ds, row["id"], ck, i, "court"))
            for ck, values in ust["nat"].items():
                for i, v in enumerate(values):
                    if v is not None and i not in from_pdf:
                        pool.append((ds, row["id"], ck, i, "national"))
    rng.shuffle(pool)
    return pool


def verify_cells(n, rng, by_sha):
    results, seen = [], set()
    datasets = {ds: {r["id"]: r for r in load(ds)["rows"]} for ds in COURT_DATASETS}
    pool = sample_cells(n * 6, rng)
    # spread over datasets: take round-robin from the shuffled pool by dataset
    by_ds = {}
    for item in pool:
        by_ds.setdefault(item[0], []).append(item)
    order = []
    while len(order) < n * 4 and any(by_ds.values()):
        for ds in list(by_ds):
            if by_ds[ds]:
                order.append(by_ds[ds].pop())
    for ds, rid, ck, i, which in order:
        if len(results) >= n:
            break
        ust = datasets[ds][rid]["item"]["ust"]
        src = ust["src"][ust["periods"][i]["src"]]
        key = (rid, ck, i, which)
        if key in seen:
            continue
        seen.add(key)
        entry = by_sha.get(src["sha256"])
        if not entry:
            results.append({"id": rid, "col": ck, "period": ust["periods"][i]["end"], "status": "source file not found by sha256"})
            continue
        col = next(c for c in ust["cols"] if c["k"] == ck)
        label, label_year = col["label"], int((col.get("le") or ust["periods"][-1]["end"])[:4])
        row_label = ust["courtLabel"] if which == "court" else "Total"
        if which == "court" and ust["scope"] == "circuit":
            row_label = ust["courtLabel"]
        stored = (ust["data"] if which == "court" else ust["nat"])[ck][i]
        got, err = lookup_cell(workbook_bytes(entry), src["sheet"], row_label, label, label_year, int(ust["periods"][i]["end"][:4]))
        num = as_number(got)
        if err:
            status = err
        elif num is None:
            status = f"source cell is not a number: {got!r}"
        elif abs(num - stored) <= 5e-7 * max(1.0, abs(stored)):
            status = "match"
        else:
            status = f"MISMATCH source {num} stored {stored}"
        results.append({"id": rid, "which": which, "col": ck, "col_label": label, "row_label": row_label, "period": ust["periods"][i]["end"], "pub": src["pub"],
                        "file": src["url"], "sha256": src["sha256"], "stored": stored, "source_cell": got if not err else None, "status": status})
    return results


# ------------------------------------------------------------------------------------------------------------ 2. sums
def tables_with_other_rows():
    """Table keys whose published rows include rows that are not courts (agencies, other sources ...): their Total is not the sum of the courts."""
    import gzip
    keys = set()
    for path in (BUILD / "parsed").glob("*/*/*.json.gz"):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        for sheet in doc["sheets"]:
            if sheet["scope"] in ("district", "bankruptcy") and any(r["entity"] == "other" and r["values"] and any(v is not None for v in r["values"]) for r in sheet["rows"] if not r["section"]):
                keys.add(sheet["table_key"])
    return keys


def verify_sums():
    out = {"cells": 0, "match": 0, "mismatch": [], "incomplete": 0, "tables": 0, "skipped_tables_with_non_court_rows": []}
    non_court = tables_with_other_rows()
    for ds in ("uscourts_tables_district", "uscourts_tables_bankruptcy", "uscourts_bapcpa", "uscourts_dnsw"):
        by_table = {}
        for row in load(ds)["rows"]:
            ust = row["item"].get("ust")
            if not ust or ust.get("kind") == "latest" or ust["scope"] not in ("district", "bankruptcy"):
                continue
            by_table.setdefault(ust["tableKey"], []).append(ust)
        for tkey, records in by_table.items():
            if tkey in non_court:
                out["skipped_tables_with_non_court_rows"].append(f"{ds}:{tkey}")
                continue
            out["tables"] += 1
            ref = records[0]
            for ci, c in enumerate(ref["cols"]):
                if c["unit"] != "count" or NON_ADDITIVE.search(c["label"]):
                    continue
                k = c["k"]
                for i, p in enumerate(ref["periods"]):
                    if p["months"] not in (12, 3, 1, 0):
                        continue
                    nat = ref["nat"].get(k, [None] * len(ref["periods"]))[i]
                    if nat is None:
                        continue
                    total, missing = 0, 0
                    for rec in records:
                        # records may start later than the reference; align by period end
                        idx = next((j for j, q in enumerate(rec["periods"]) if q["end"] == p["end"] and q["pub"] == p["pub"]), None)
                        if idx is None:
                            missing += 1
                            continue
                        v = rec["data"].get(k, [None] * len(rec["periods"]))[idx]
                        if v is None:
                            if idx in rec["dash"].get(k, []):
                                continue  # a printed dash: counted as no cases by the publisher's own total
                            missing += 1
                            continue
                        total += v
                    out["cells"] += 1
                    if missing:
                        out["incomplete"] += 1
                    elif abs(total - nat) < 1e-9:
                        out["match"] += 1
                    else:
                        out["mismatch"].append({"dataset": ds, "table": tkey, "col": k, "period": p["end"], "sum_of_courts": total, "published_total": nat})
    return out


# ------------------------------------------------------------------------------------------------------------ 2b. category cells
def label_count(data, sheet, label):
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    ws = wb[sheet] if sheet in wb.sheetnames else wb.worksheets[0]
    return sum(1 for r in range(1, ws.max_row + 1) if any(row_label_matches(ws.cell(r, c).value, label) for c in (1, 2)))


def verify_category_cells(n, rng, by_sha):
    """Stored values of category rows (national tables, BAPCPA national tables, Wiretap jurisdiction rows) looked up again in the
    source workbook by the row's published label and the column's published heading. Only labels printed exactly once in the sheet are
    sampled (a label printed twice, such as "Other" under two headings or a county name in two states, cannot be found by label alone)."""
    pool = []
    for ds in CATEGORY_DATASETS:
        for row in load(ds)["rows"]:
            ust = row["item"].get("ust")
            if not ust or ust.get("scope") != "national" or not ust.get("rows") or ust.get("rowScope") not in ("category", None):
                continue
            for r in ust["rows"]:
                for ck, values in r["data"].items():
                    for i, v in enumerate(values):
                        if v is not None and ust["src"][ust["periods"][i]["src"]].get("fmt") in ("xlsx", "xls"):
                            pool.append((ds, row["id"], r["k"], ck, i))
    rng.shuffle(pool)
    results, cache = [], {}
    for ds, rid, rk, ck, i in pool:
        if len(results) >= n:
            break
        rec = next(r for r in load(ds)["rows"] if r["id"] == rid)
        ust = rec["item"]["ust"]
        row = next(r for r in ust["rows"] if r["k"] == rk)
        src = ust["src"][ust["periods"][i]["src"]]
        entry = by_sha.get(src["sha256"])
        if not entry:
            continue
        data = cache.get(src["sha256"]) or workbook_bytes(entry)
        cache[src["sha256"]] = data
        if label_count(data, src["sheet"], row["label"]) != 1:
            continue
        col = next(c for c in ust["cols"] if c["k"] == ck)
        stored = row["data"][ck][i]
        got, err = lookup_cell(data, src["sheet"], row["label"], col["label"], int((col.get("le") or ust["periods"][-1]["end"])[:4]), int(ust["periods"][i]["end"][:4]))
        num = as_number(got)
        status = err or (f"source cell is not a number: {got!r}" if num is None else ("match" if abs(num - stored) <= 5e-7 * max(1.0, abs(stored)) else f"MISMATCH source {num} stored {stored}"))
        results.append({"dataset": ds, "id": rid, "row": row["label"], "col": ck, "col_label": col["label"], "period": ust["periods"][i]["end"], "pub": src["pub"], "file": src["url"],
                        "sha256": src["sha256"], "stored": stored, "source_cell": got if not err else None, "status": status})
    return results


def verify_wiretap_sums():
    """Second path over the stored Wiretap rows: Federal Total equals its federal rows, each state row its jurisdictions, and Federal Total
    plus the state rows (or, where an edition prints no state rows, plus the jurisdiction rows) equals Total, column by column (count
    columns, a blank counted as no orders)."""
    out = {"tests": 0, "match": 0, "mismatch": []}
    for row in load("uscourts_wiretap")["rows"]:
        ust = row["item"].get("ust")
        if not ust or ust.get("scope") != "national" or not ust.get("rows"):
            continue
        n = len(ust["periods"])
        rows = ust["rows"]
        for c in ust["cols"]:
            if c["unit"] != "count" or NON_ADDITIVE.search(c["label"]):
                continue
            k = c["k"]
            for i in range(n):
                def v(r):
                    return (r["data"].get(k) or [None] * n)[i]
                present = [r for r in rows if v(r) is not None or i in (r.get("dash") or {}).get(k, [])]
                if not present:
                    continue
                total = next((r for r in rows if r["k"] == "national"), None)
                # the federal row of this period: "Federal Total" in the workbooks (and 2015), "FEDERAL" in the PDF reports before
                fed = next((r for r in rows if r["path"] in (["Federal Total"], ["FEDERAL TOTAL"]) and v(r) is not None), None) or \
                    next((r for r in rows if r["path"] == ["FEDERAL"] and v(r) is not None), None)
                if total is None or fed is None or v(total) is None:
                    continue
                groups = {}
                for r in rows:
                    if len(r["path"]) == 2:
                        groups.setdefault(r["path"][0], []).append(r)
                tops = [r for r in rows if len(r["path"]) == 1 and r["k"] not in ("national",) and r["path"][0].upper() not in ("FEDERAL TOTAL", "FEDERAL")]
                checks = []
                if groups.get(fed["path"][0]):
                    checks.append((fed["label"], v(fed) or 0, sum(v(r) or 0 for r in groups[fed["path"][0]])))
                for t in tops:
                    if t["path"][0] in groups and v(t) is not None:
                        checks.append((t["label"], v(t) or 0, sum(v(r) or 0 for r in groups[t["path"][0]])))
                if any(v(t) is not None for t in tops):
                    checks.append(("Total", v(total), (v(fed) or 0) + sum(v(t) or 0 for t in tops)))
                else:  # an edition that prints its states as headings without figures: the Total is the federal row plus every jurisdiction
                    local = [r for r in rows if len(r["path"]) == 2 and r["path"][0] != fed["path"][0]]
                    checks.append(("Total", v(total), (v(fed) or 0) + sum(v(r) or 0 for r in local)))
                for name, printed, summed in checks:
                    out["tests"] += 1
                    if printed == summed:
                        out["match"] += 1
                    else:
                        out["mismatch"].append({"table": ust["tableKey"], "col": k, "period": ust["periods"][i]["end"], "row": name, "printed": printed, "sum": summed})
    return out


# ------------------------------------------------------------------------------------------------------------ 3. pdf
def same_figure(pdf_value, book_value):
    """A PDF prints a rounded figure: integers must be equal, a decimal figure may differ by the rounding the PDF applied."""
    if pdf_value is None and book_value is None:
        return True
    if pdf_value is None or book_value is None:
        return False
    if isinstance(pdf_value, int) and float(book_value).is_integer():
        return pdf_value == book_value
    if isinstance(pdf_value, int):  # the PDF prints a whole number where the workbook keeps decimals
        return abs(pdf_value - book_value) <= 0.5 + 1e-9
    return abs(pdf_value - book_value) <= 0.05 + 1e-9


def verify_pdf(n, rng, by_sha):
    index = json.loads((F.ACQ / "files_index.json").read_text())
    candidates = [e for e in index.values() if e.get("format") == "xlsx" and e.get("other_files") and any(f.lower().endswith(".pdf") for f in e["other_files"]) and e["pub"] in ("JB", "STFJ", "FJCS")]
    rng.shuffle(candidates)
    results = []
    sys.path.insert(0, str(HERE))
    import pdf_rows as R
    import utx_parse as P
    import normalize as N
    for e in candidates:
        if len(results) >= n:
            break
        pdf_url = next(f for f in e["other_files"] if f.lower().endswith(".pdf"))
        sheets, _ = P.parse_workbook(workbook_bytes(e))
        if not sheets:
            continue
        norm = N.normalize(sheets[0], e)
        if norm["scope"] not in ("district", "appeals", "bankruptcy"):
            continue
        status, data, path = F.fetch(pdf_url, subdir="verify_pdf")
        if status != 200:
            results.append({"table": e["table"], "period": e["period_end"], "pdf": pdf_url, "status": f"PDF HTTP {status}"})
            continue
        text = R.pdf_text(_write_tmp(data))
        width = len(norm["columns"])
        rows, rejected = R.rows_from_text(text, width)
        by_label = {}
        for label, tokens in rows:
            by_label.setdefault(N.E.clean_label(label).upper(), tokens)  # the first panel of a multi-panel PDF is the workbook's first sheet
        wb_rows = [r for r in norm["rows"] if not r["section"] and r["entity"] in ("district", "circuit", "national")]
        rng.shuffle(wb_rows)
        picked = None
        for r in wb_rows:
            if r["label"].upper() in by_label or ("TOTAL" if r["entity"] == "national" else r["label"].upper()) in by_label:
                picked = r
                break
        if not picked:
            results.append({"table": e["table"], "period": e["period_end"], "pdf": pdf_url, "status": "no comparable row found in the PDF text"})
            continue
        key = "TOTAL" if picked["entity"] == "national" else picked["label"].upper()
        tokens = by_label.get(key) or by_label.get(picked["label"].upper())
        diffs = []
        for j, (tok, v) in enumerate(zip(tokens, picked["values"])):
            pv, _ = R.to_number(tok)
            fmt = norm["columns"][j].get("fmt") if j < len(norm["columns"]) else None
            if isinstance(v, (int, float)) and fmt and "%" in fmt and (picked["flags"] or [None] * (j + 1))[j] is None:
                v = v * 100  # the PDF prints the percentage a percent-formatted cell displays
            if not same_figure(pv, v):
                diffs.append((tok, v))
        results.append({"table": e["table"], "pub": e["pub"], "period": e["period_end"], "row": picked["label"], "pdf": pdf_url, "figures": len(tokens),
                        "status": "match" if not diffs else f"{len(diffs)} differ: {diffs[:3]}", "workbook_sha256": e["sha256"]})
    return results


# ------------------------------------------------------------------------------------------------------------ 4. pdf periods
def shifted_key(key):
    """Column key of the current-year column that a prior-year column ('y-1' segment) repeats; None if the key has no prior-year segment."""
    parts = key.split("/")
    if "y-1" not in parts:
        return None
    return "/".join("y0" if p == "y-1" else p for p in parts)


def verify_pdf_periods():
    """Independent check of figures that were read from a PDF: the spreadsheet edition one year later prints the PDF's year in a
    prior-year column. Every court row of the PDF edition is compared, column by column, with that column (a revised prior-year
    figure is a difference the publisher itself made, so differences are listed, not hidden)."""
    import gzip
    parsed = F.ROOT / "private" / "build" / "uscourts_tables" / "parsed"
    docs = {}
    for path in sorted(parsed.glob("*/*/*.json.gz")):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        for sheet in doc["sheets"]:
            if sheet.get("sheet_index", 0) == 0:
                docs.setdefault(sheet["table_key"], []).append((doc["source"].get("format"), sheet))
    out = {"pdf_periods": 0, "with_prior_year_edition": 0, "cells": 0, "match": 0, "differ": [], "no_prior_year_column": 0}
    for tkey, items in docs.items():
        by_end = {}
        for fmt, sheet in items:
            by_end.setdefault(sheet["period_end"], []).append((fmt, sheet))
        for end, group in sorted(by_end.items()):
            for fmt, sheet in group:
                if fmt != "pdf":
                    continue
                out["pdf_periods"] += 1
                nxt = f"{int(end[:4]) + 1}{end[4:]}"
                later = [s for f, s in by_end.get(nxt, []) if f != "pdf"]
                if not later:
                    continue
                book = later[0]
                prior_cols = {shifted_key(c["key"]): i for i, c in enumerate(book["columns"]) if shifted_key(c["key"])}
                mine = {c["key"]: i for i, c in enumerate(sheet["columns"])}
                shared = [(mine[k], prior_cols[k]) for k in prior_cols if k in mine]
                if not shared:
                    out["no_prior_year_column"] += 1
                    continue
                out["with_prior_year_edition"] += 1
                book_rows = {(r["entity"], r["entity_id"]): r for r in book["rows"] if not r["section"]}
                for r in sheet["rows"]:
                    other = book_rows.get((r["entity"], r["entity_id"]))
                    if other is None:
                        continue
                    for mi, bi in shared:
                        a, b = r["values"][mi], other["values"][bi]
                        if a is None and b is None:
                            continue
                        out["cells"] += 1
                        if a is not None and b is not None and same_figure(a, b):
                            out["match"] += 1
                        else:
                            out["differ"].append({"table": tkey, "period": end, "row": r["label"], "col": sheet["columns"][mi]["key"], "pdf": a, "next_edition_prior_year": b, "next_edition": book["period_end"]})
    return out


def _write_tmp(data):
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.write(data)
    tmp.close()
    return tmp.name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", type=int, default=40)
    ap.add_argument("--pdf", type=int, default=10)
    ap.add_argument("--seed", type=int, default=1023)
    ap.add_argument("--no-pdf", action="store_true")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    by_sha = index_by_sha()
    cells = verify_cells(args.cells, rng, by_sha)
    cat_cells = verify_category_cells(args.cells, rng, by_sha)
    wire = verify_wiretap_sums()
    sums = verify_sums()
    pdf = [] if args.no_pdf else verify_pdf(args.pdf, rng, by_sha)
    pdf_periods = verify_pdf_periods()
    matched = sum(1 for c in cells if c["status"] == "match")
    summary = {
        "cells_checked": len(cells), "cells_match": matched, "cells_not_match": len(cells) - matched,
        "sum_cells": sums["cells"], "sum_match": sums["match"], "sum_mismatch": len(sums["mismatch"]), "sum_incomplete": sums["incomplete"], "sum_tables": sums["tables"],
        "sum_tables_skipped_non_court_rows": len(sums["skipped_tables_with_non_court_rows"]),
        "pdf_checked": len(pdf), "pdf_match": sum(1 for p in pdf if p["status"] == "match"),
        "pdf_periods": pdf_periods["pdf_periods"], "pdf_periods_with_next_edition": pdf_periods["with_prior_year_edition"],
        "pdf_period_cells": pdf_periods["cells"], "pdf_period_cells_match": pdf_periods["match"], "pdf_period_cells_differ": len(pdf_periods["differ"]),
        "category_cells_checked": len(cat_cells), "category_cells_match": sum(1 for c in cat_cells if c["status"] == "match"),
        "wiretap_sum_tests": wire["tests"], "wiretap_sum_match": wire["match"], "wiretap_sum_mismatch": len(wire["mismatch"]),
        "seed": args.seed,
    }
    (BUILD / "verification.json").write_text(json.dumps({"summary": summary, "cells": cells, "category_cells": cat_cells, "wiretap_sums": wire, "sums": sums, "pdf": pdf,
                                                        "pdf_periods": pdf_periods}, indent=1))
    print(json.dumps(summary, indent=1))
    for c in cells:
        if c["status"] != "match":
            print("  CELL", c["id"], c["col"], c["period"], c["status"])
    for c in cat_cells:
        if c["status"] != "match":
            print("  CATEGORY CELL", c["dataset"], c["id"], c["row"], c["col"], c["period"], c["status"])
    for m in wire["mismatch"][:10]:
        print("  WIRETAP SUM", m)
    for m in sums["mismatch"][:15]:
        print("  SUM", m)
    for p in pdf:
        if p["status"] != "match":
            print("  PDF", p)
    for d in pdf_periods["differ"][:15]:
        print("  PDF-PERIOD", d)


if __name__ == "__main__":
    main()
