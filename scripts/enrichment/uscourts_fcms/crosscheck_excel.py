"""Independent check of the PDF extraction against the publisher's own Excel editions (.xlsx only; .xls needs xlrd, which is not installed).

For each edition that has an .xlsx next to its PDF, every court's printed rows are read from the workbook without any of the
layout or label logic used for the PDFs, and compared with the values extracted from the PDF:

  * the workbook is cut into court blocks at the rows that carry the period header; the court name is the capital-letter text above it;
  * every workbook row becomes one or more numeric series, one value per period column, left to right (a cell such as "63,671\\n10.8" or
    "11 /\\n 3.7" yields two series; "-" or blank is an absent value);
  * each extracted measure of the same court (matched by the printed court name, equal strings) must equal one of the workbook's series,
    column by column, to within half a unit of the precision printed in the PDF (workbook cells hold unrounded numbers; fractions such as
    0.859 are also compared as percent); a column the PDF leaves empty is not compared; a value present in the PDF where the workbook has
    none (or the reverse) is a mismatch.

Rows are matched by their numbers, not their labels, so the check does not depend on how rows were named; label placement is checked
separately (unit tests and the displayed-figure spot checks).

Every mismatch is then adjudicated against the PDF itself with a second, independent reader: `pdftotext -layout` of the cited page must
print the extracted tokens in order on one line ("pdf_text_confirms"). A mismatch the PDF text confirms is a disagreement between the
publisher's workbook and the publisher's PDF (the extraction read the PDF as printed); one it does not confirm is an extraction problem.
Output: private/build/uscourts_fcms/crosscheck_excel.json
"""
import json
import re
import subprocess
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jsonio  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_fcms"
OUT = ROOT / "private" / "build" / "uscourts_fcms" / "crosscheck_excel.json"
YEAR = re.compile(r"^(?:(?:Mar|Jun|Sep|Dec)[a-z]*\.?\s*\d{1,2}\s*)?\n?\s*(\d{4})\s*$|^(\d{1,2}-(?:Mar|Jun|Sep|Dec)[a-z]*)\s*\n?\s*(\d{4})$", re.I)
NUMBER = re.compile(r"-?\d[\d,]*\.?\d*|-?\.\d+")
PAGE_TEXT = {}


def norm_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def cell_numbers(value):
    """Cell -> list of numbers (None for a dash). Numbers stay as they are; strings may carry several numbers ('11 /\\n 3.7')."""
    if value is None or isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    text = str(value).strip()
    if text in ("", "-", "–", "—"):
        return [None] if text else []
    out = []
    for token in NUMBER.findall(text.replace("−", "-").replace("‐", "-").replace("‑", "-")):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:
            return []
    return out


def blocks_of(ws):
    """Yield (court_name, panels); panels is a list (one per table) of (excel_row, label, [series]) with one value per period column."""
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    headers = []
    for i, row in enumerate(rows):
        cols = [j for j, v in enumerate(row) if isinstance(v, str) and YEAR.match(v.strip())]
        if len(cols) < 4:
            # numeric year headers (2007, 2008, ...): integers 1995-2100 spanning at most six years, so a row of data values is never taken for one
            ycols = [j for j, v in enumerate(row) if isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() and 1995 <= v <= 2100]
            if len(ycols) >= 4 and max(row[j] for j in ycols) - min(row[j] for j in ycols) <= 6 and len(ycols) == sum(1 for v in row if isinstance(v, (int, float)) and v is not None):
                cols = ycols
        if len(cols) >= 4:
            groups, cur = [], [cols[0]]
            for j in cols[1:]:
                if j - cur[-1] > 2:
                    groups.append(cur)
                    cur = [j]
                else:
                    cur.append(j)
            groups.append(cur)
            groups = [g for g in groups if len(g) >= 4]
            if groups:
                headers.append((i, groups))
    # some workbooks print the left and right tables' period headers on adjacent rows: they are one block
    joined = []
    for i, groups in headers:
        if joined and i - joined[-1][1] <= 2:
            joined[-1][1] = i
            joined[-1][2].extend(groups)
        else:
            joined.append([i, i, list(groups)])
    for n, (i, _last, groups) in enumerate(joined):
        end = joined[n + 1][0] if n + 1 < len(joined) else len(rows)  # rows of the next block above its header carry text only
        name = ""
        for k in range(max(0, i - 3), i + 1):
            for v in rows[k]:
                if isinstance(v, str) and v.strip() and v.strip() == v.strip().upper() and not re.search(r"JUDICIAL|CASELOAD|PERIOD|PROFILE|\d", v.upper()) and len(v.strip()) > 3 and "\n" not in v.strip():
                    name = norm_text(v)
                    break
            if name:
                break
        panels = []
        for g in groups:
            plist = []
            for r in range(i + 1, end):
                vals = [rows[r][j] if j < len(rows[r]) else None for j in g]
                vals = [None if (isinstance(v, str) and YEAR.match(v.strip())) else v for v in vals]  # the other table's header cells
                parts = [cell_numbers(v) for v in vals]
                if not any(parts):
                    continue
                k = max(len(p) for p in parts)
                series = [[p[t] if len(p) > t else None for p in parts] for t in range(k)]
                label = norm_text(" ".join(v for v in rows[r][:g[0]] if isinstance(v, str) and v.strip() and not YEAR.match(v.strip())))[:70]
                plist.append((r + 1, label, series))
            panels.append(plist)
        yield name, panels


def decimals_of(token):
    token = (token or "").replace("%", "")
    return len(token.split(".")[1]) if "." in token else 0


def same(excel_val, pdf_val, token):
    if pdf_val is None and excel_val is None:
        return True
    if pdf_val is None or excel_val is None:
        return False
    d = decimals_of(token)
    tol = 0.5 * 10 ** -d + 1e-6
    if abs(excel_val - pdf_val) <= tol:
        return True
    # percent stored as a fraction; a printed "77.20%" carries one significant decimal
    ptol = 0.5 * 10 ** -(d - 1 if (token or "").endswith("0%") and d >= 2 else d) + 1e-6
    return abs(excel_val * 100 - pdf_val) <= ptol


def series_equal(excel_series, pdf_series, tokens):
    n_cmp = 0
    for e, p, t in zip(excel_series, pdf_series, tokens):
        if p is None:
            continue  # dash or blank in the PDF
        n_cmp += 1
        if not same(e, p, t):
            return False
    return n_cmp > 0


def closeness(excel_series, pdf_series, tokens):
    return sum(1 for e, p, t in zip(excel_series, pdf_series, tokens) if p is not None and same(e, p, t))


def extracted_cells(parsed):
    """{printed name: {measure: (values in column order, tokens in column order, page)}} (pages of one court merged)."""
    out = defaultdict(dict)
    for p in parsed["pages"]:
        name = norm_text(p["name"])
        cols = p["years"]
        for m, vals in p["values"].items():
            tokens = p["raw"].get(m, {}).get("tokens", {})
            out[name][m] = ([vals.get(c) for c in cols], [tokens.get(c) for c in cols], p["page"])
    return out


def page_lines(pdf, page):
    key = (str(pdf), page)
    if key not in PAGE_TEXT:
        text = subprocess.run(["pdftotext", "-layout", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True).stdout.decode("utf-8", "replace")
        PAGE_TEXT[key] = [ln.replace("‐", "-").replace("‑", "-").replace("−", "-") for ln in text.splitlines()]
    return PAGE_TEXT[key]


def pdf_text_confirms(pdf, page, tokens):
    """True when one line of the page's text prints every printed token (dashes skipped) in order, each as a whole number token."""
    toks = [t.replace("‐", "-").replace("‑", "-") for t in tokens if t is not None]
    if not toks:
        return False
    for line in page_lines(pdf, page):
        pos, ok = 0, True
        for t in toks:
            m = re.compile(r"(?<![\d.,])" + re.escape(t) + r"(?![\d])").search(line, pos)
            if not m:
                ok = False
                break
            pos = m.end()
        if ok:
            return True
    return False


def check_edition(slug, kind, xlsx, parsed, pdf):
    ex = extracted_cells(parsed)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            book = openpyxl.load_workbook(xlsx, data_only=True)
        except Exception as error:  # noqa: BLE001 - a file named .xlsx that is not an OOXML workbook (the publisher's old binary format)
            return {"edition": slug, "kind": kind, "workbook": str(xlsx.relative_to(ROOT)), "unreadable": f"{type(error).__name__}: {error}", "mismatches": []}
    merged = {}
    for ws in book.worksheets:
        for name, panels in blocks_of(ws):
            # workbooks that print a court's two tables in separate blocks repeat its name: the blocks are one court
            merged.setdefault(name, []).extend(panels)
    stats = Counter()
    mismatches, not_found = [], []
    unextracted = Counter()
    seen = set()
    for name, panels in merged.items():
        key, cells = name, (ex.get(name) if name else None)
        if not name:  # the workbook's National sheet carries no court name: the PDF's first (national) page
            for national in ("ALL DISTRICT COURTS", "ALL CIRCUITS", "NATIONAL TOTALS", "UNITED STATES", "NATIONAL"):
                if national in ex:
                    key, cells = national, ex[national]
                    break
        if cells is None:
            if name:
                not_found.append(name)
            continue
        seen.add(key)
        stats["courts_compared"] += 1
        excel_rows = [(label, s) for plist in panels for _, label, ser in plist for s in ser]
        used = set()
        for m, (vals, tokens, page) in cells.items():
            if not any(v is not None for v in vals):
                continue
            stats["series_extracted"] += 1
            hit = next((idx for idx, (_, s) in enumerate(excel_rows) if len(s) == len(vals) and series_equal(s, vals, tokens)), None)
            if hit is None:
                stats["series_mismatch"] += 1
                best = max(excel_rows, key=lambda r: closeness(r[1], vals, tokens), default=None)
                confirm = pdf_text_confirms(pdf, page, tokens)
                stats["mismatch_pdf_text_confirms" if confirm else "mismatch_unconfirmed"] += 1
                printed = sum(1 for v in vals if v is not None)
                near = best is not None and closeness(best[1], vals, tokens) >= max(3, printed - 2)
                diffs = [{"column": c, "pdf": tokens[c], "workbook": best[1][c]} for c in range(len(vals)) if vals[c] is not None and not same(best[1][c], vals[c], tokens[c])] if near else []
                if not near:
                    category = "workbook_table_absent_or_displaced"  # no workbook row resembles the series: the workbook lacks or misplaces this table
                elif all(d["workbook"] is None for d in diffs):
                    category = "workbook_cell_blank"
                else:
                    category = "workbook_value_differs"
                stats["mismatch_" + category] += 1
                mismatches.append({"court": key, "measure": m, "page": page, "pdf": vals, "tokens": tokens, "pdf_text_confirms": confirm, "category": category,
                                   "differing_columns": diffs,
                                   "closest_workbook_row": {"label": best[0], "series": best[1], "columns_equal": closeness(best[1], vals, tokens)} if best else None})
            else:
                stats["series_matched"] += 1
                used.add(hit)
        for idx, (label, s) in enumerate(excel_rows):
            if idx not in used and sum(1 for v in s if v is not None) >= 3:
                unextracted[label or "(no label)"] += 1
    stats["pdf_courts_without_workbook_block"] = len(set(ex) - seen)
    return {"edition": slug, "kind": kind, "workbook": str(xlsx.relative_to(ROOT)), **stats, "workbook_blocks_not_in_pdf": sorted(set(not_found))[:5],
            "workbook_series_not_extracted": sum(unextracted.values()), "workbook_unextracted_labels": dict(unextracted.most_common(12)), "mismatches": mismatches}


def main():
    index = jsonio.load(ACQ / "parsed" / "_index.json")
    results = []
    totals, labels = Counter(), Counter()
    for key, meta in sorted(index.items()):
        if meta["status"] != "parsed":
            continue
        slug, kind = key.rsplit("__", 1)
        folder = ACQ / "files" / slug
        files = sorted(p for p in folder.iterdir() if p.suffix.lower() == ".xlsx")
        want = [p for p in files if (("dis" in p.name.lower()) == (kind == "district"))]
        if not want:
            continue
        parsed = jsonio.load(ACQ / "parsed" / f"{key}.json.gz")
        if parsed["ocr_text_layer"]:
            continue
        r = check_edition(slug, kind, want[0], parsed, ROOT / parsed["file"])
        results.append(r)
        if r.get("unreadable"):
            print(json.dumps({"edition": slug, "kind": kind, "unreadable": r["unreadable"]}), flush=True)
            continue
        for k in ("courts_compared", "series_extracted", "series_matched", "series_mismatch", "mismatch_pdf_text_confirms", "mismatch_unconfirmed", "workbook_series_not_extracted",
                  "mismatch_workbook_cell_blank", "mismatch_workbook_value_differs", "mismatch_workbook_table_absent_or_displaced"):
            totals[k] += r.get(k, 0)
        labels.update(r["workbook_unextracted_labels"])
        print(json.dumps({k: v for k, v in r.items() if k not in ("mismatches", "workbook", "workbook_unextracted_labels")}), flush=True)
    summary = dict(totals)
    summary["editions_checked"] = len(results)
    summary["unreadable_workbooks"] = [r["edition"] + ":" + r["kind"] for r in results if r.get("unreadable")]
    summary["top_workbook_labels_not_extracted"] = dict(labels.most_common(25))
    OUT.write_text(json.dumps({"summary": summary, "editions": results}, indent=1))
    print("SUMMARY", json.dumps(summary))


if __name__ == "__main__":
    main()
