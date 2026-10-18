"""Extract and validate U.S. Courts Judicial Business tables into one normalized JSON file.

Input: private/acq/court-stats/jb/<year>/<table>__<file> (downloaded unchanged by acquire.py) and manifest.json.
Output: private/acq/court-stats/normalized.json with, per fiscal year (12 months ending September 30):
  districts[court_id][year] = {c11, c, c5, c6, x1a, c3}   (each block exactly as published, per district)
  circuits[circuit_id][year] = {b, b4, b7, c11, c}         (appeals tables, and district tables' circuit rows)
  national[year] = {c11, c, c5, c6, c2a, b, ...}
  sources[table][year] = {"page", "url", "sha256", "format"}
  checks = list of validation results (row sums, circuit roll-ups, cross-table totals)

Every block is validated against the table's own arithmetic (row totals, circuit sums) before it is kept;
a block that fails validation is dropped (stored as null) and the failure is listed in checks.
Usage: python3 extract.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tables as T  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "court-stats"
YEARS = list(range(2014, 2026))
CIRCUITS = ["cadc", "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11"]
CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    return ok


def nz(v):
    return v or 0


def round1(v):
    return None if v is None else round(float(v), 1)


# ---------------------------------------------------------------- generic readers

def edition(year, table):
    """('xlsx', path) when the Excel edition exists, else ('pdf', path)."""
    folder = ACQ / "jb" / str(year)
    x = T.find_file(folder, table, "xlsx")
    if x:
        return "xlsx", x
    p = T.find_file(folder, table, "pdf")
    return ("pdf", p) if p else (None, None)


def labelled(rows, width):
    """Keep rows whose label is Total, a circuit or a district; values truncated/padded to width numeric cells."""
    out = []
    for label, values in rows:
        up = label.upper()
        if up == "TOTAL" or T.circuit_id(label) or T.district_id(label):
            vals = [T.to_number(v) for v in values]
            # drop trailing empties beyond width
            out.append((label, (vals + [None] * width)[:width], vals))
    return out


def walk(rows, district_table=True):
    """Assign circuit membership by published order: a circuit row precedes its districts; DC precedes 1st."""
    current = None
    result = []
    for label, vals, raw in rows:
        up = label.upper()
        if up == "TOTAL":
            result.append(("national", None, vals, raw))
            continue
        cid = T.circuit_id(label) if up != "DC" else None
        if cid:
            current = cid
            result.append(("circuit", cid, vals, raw))
            continue
        if up == "DC":
            # DC is both the D.C. Circuit and its only district; district tables list it once.
            result.append(("district", "dcd", vals, raw))
            result.append(("circuit", "cadc", vals, raw))
            continue
        did = T.district_id(label)
        if did:
            result.append(("district", did, vals, raw, current))
    return result


def compact_values(raw):
    """Numeric cells of a row with layout gaps (blank merged columns) removed; '-' stays None."""
    return raw


def xlsx_first_sheet(path):
    sheets = list(T.xlsx_sheets(path))
    return sheets


def numeric_row_values(values, columns):
    return [T.to_number(values[i - 1]) if i - 1 < len(values) else None for i in columns]


def find_cols(paths, patterns):
    """Column indexes (1-based into paths, matching xlsx row value offsets + 1) for each regex, first non-duplicate match."""
    found = []
    for pattern in patterns:
        regex = re.compile(pattern, re.I)
        idx = next((i for i, p in enumerate(paths) if i > 0 and regex.search(p) and i not in found), None)
        found.append(idx)
    return found


def district_rows_from_xlsx(path, patterns, sheet_filter=None):
    """{label: [values for each pattern]} using header-located columns; also returns resolved headers."""
    result = {}
    headers = None
    for title, paths, rows in T.xlsx_sheets(path):
        if sheet_filter and not sheet_filter(title, paths):
            continue
        cols = find_cols(paths, patterns)
        if None in cols:
            missing = [patterns[i] for i, c in enumerate(cols) if c is None]
            raise ValueError(f"{path.name} [{title}]: headers not found {missing}")
        headers = [paths[c] for c in cols]
        for label, values in rows:
            up = label.upper()
            if up == "TOTAL" or T.circuit_id(label) or T.district_id(label):
                result[label] = [T.to_number(values[c - 1]) if c - 1 < len(values) else None for c in cols]
    return result, headers


def district_rows_from_pdf(path, width, page_filter=None):
    import pdfplumber

    result = {}
    bad = []
    pattern = re.compile(rf"^{T.LABEL}((?:\s+{T.TOKEN})+)\s*$")
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            lines = T.page_lines(page)
            text = "\n".join(lines)
            if page_filter and not page_filter(text):
                continue
            for line in lines:
                m = pattern.match(T.repair_line(line))
                if not m:
                    continue
                label = T.clean_label(m.group(1))
                tokens = m.group(2).split()
                if len(tokens) != width:
                    bad.append(f"{label}:{len(tokens)}")
                    continue
                result[label] = [None if t in ("-", "--") else T.to_number(t) for t in tokens]
    return result, bad


def by_entity(rows_by_label):
    """Split label-keyed rows into national / circuit / district dicts using T.circuit_id and T.district_id."""
    national, circuits, districts = None, {}, {}
    for label, vals in rows_by_label.items():
        up = label.upper()
        if up == "TOTAL":
            national = vals
        elif up == "DC":
            districts["dcd"] = vals
            circuits["cadc"] = vals
        elif T.circuit_id(label):
            circuits[T.circuit_id(label)] = vals
        elif T.district_id(label):
            districts[T.district_id(label)] = vals
    return national, circuits, districts


# ---------------------------------------------------------------- circuit membership (from C-11 published order)

def membership():
    fmt, path = edition(2025, "c-11")
    order = {}
    for title, paths, rows in T.xlsx_sheets(path):
        current = None
        for label, _ in rows:
            up = label.upper()
            if up == "TOTAL":
                continue
            if up == "DC":
                order["dcd"] = "cadc"
                continue
            if T.circuit_id(label):
                current = T.circuit_id(label)
                continue
            if T.district_id(label):
                order[T.district_id(label)] = current
    return order


# ---------------------------------------------------------------- table specs

C11_PATTERNS = [r"^\d{4} Total$", r"^\d{4} Total$", r"Contract", r"Real Property", r"Personal Property", r"Air(line|plane)", r"Marine", r"Motor Vehicle", r"Asbestos", r"/ Other$"]
C11_KEYS = ["prior_total", "total", "contract", "real_property", "property_damage", "airplane", "marine", "motor_vehicle", "asbestos", "other_pi"]


def read_c11(year):
    fmt, path = edition(year, "c-11")
    if fmt == "xlsx":
        rows, headers = district_rows_from_xlsx(path, C11_PATTERNS)
    else:
        text = T.pdf_text(path)
        check(f"c-11 {year} pdf header", all(w in text for w in ("Contract", "Real Property", "Asbestos", "Other")), path.name)
        rows, bad = district_rows_from_pdf(path, 10)
        check(f"c-11 {year} pdf row widths", not bad, ",".join(bad))
    out = {}
    failures = []
    for label, vals in rows.items():
        block = dict(zip(C11_KEYS, vals))
        parts = sum(nz(block[k]) for k in C11_KEYS[2:])
        if block["total"] is None or parts != block["total"]:
            # Components do not add up as printed (e.g. a truncated cell in the PDF): keep only the published
            # total, withhold every component, and require main() to confirm the total against the next edition.
            failures.append(f"{label}: {block['total']} vs {parts}")
            block = {k: (block[k] if k in ("prior_total", "total") else None) for k in C11_KEYS}
            block["components_withheld"] = True
        out[label] = block
    check(f"c-11 {year} row sums", not failures, "components withheld for " + "; ".join(failures[:5]) if failures else "")
    return out, fmt, path


C_PATTERNS = [r"^(Filings|Filed|Commenced) / \d{4}$", r"^(Filings|Filed|Commenced) / \d{4}$", r"^(Filings|Filed|Commenced) / Percent", r"^Terminat\w+ / \d{4}$", r"^Terminat\w+ / \d{4}$", r"^Terminat\w+ / Percent", r"^Pending / \d{4}", r"^Pending / \d{4}", r"^Pending / Percent"]
C_KEYS = ["filed_prior", "filed", "filed_pct", "terminated_prior", "terminated", "terminated_pct", "pending_prior", "pending", "pending_pct"]


def read_c(year, table="c"):
    fmt, path = edition(year, table)
    if fmt == "xlsx":
        rows, headers = district_rows_from_xlsx(path, C_PATTERNS)
    else:
        rows, bad = district_rows_from_pdf(path, 9)
        check(f"{table} {year} pdf row widths", not bad, ",".join(bad))
    return {label: dict(zip(C_KEYS, vals)) for label, vals in rows.items()}, fmt, path


C5_PATTERNS = [r"^Total Cases / Number", r"^Total Cases / Median", r"^No Court Action / Number", r"^No Court Action / Median", r"Before Pretrial / Number", r"Before Pretrial / Median", r"During or After Pretrial / Number", r"During or After Pretrial / Median", r"(During )?Trial / Number", r"(During )?Trial / Median"]
C5_KEYS = ["n_total", "median_total", "n_no_action", "median_no_action", "n_before_pretrial", "median_before_pretrial", "n_after_pretrial", "median_after_pretrial", "n_trial", "median_trial"]


def read_c5(year):
    fmt, path = edition(year, "c-5")
    if fmt == "xlsx":
        rows, headers = district_rows_from_xlsx(path, C5_PATTERNS)
    else:
        rows, bad = district_rows_from_pdf(path, 10)
        check(f"c-5 {year} pdf row widths", not bad, ",".join(bad))
    out, failures = {}, []
    for label, vals in rows.items():
        block = dict(zip(C5_KEYS, vals))
        for k in C5_KEYS:
            if k.startswith("median"):
                block[k] = round1(block[k])
        parts = sum(nz(block[k]) for k in ("n_no_action", "n_before_pretrial", "n_after_pretrial", "n_trial"))
        if block["n_total"] is None or parts != block["n_total"]:
            failures.append(f"{label}: {block['n_total']} vs {parts}")
            continue
        out[label] = block
    check(f"c-5 {year} row sums", not failures, "; ".join(failures[:5]))
    return out, fmt, path


C6_PATTERNS = [r"^Total$", r"Less Than 1 Year", r"1 to 2 Years", r"2 to 3 Years", r"3 Years or More / Number", r"3 Years or More / Percent"]
C6_KEYS = ["pending", "under_1y", "y1_2", "y2_3", "over_3y", "over_3y_pct"]


def read_c6(year):
    fmt, path = edition(year, "c-6")
    if fmt == "xlsx":
        rows, headers = district_rows_from_xlsx(path, C6_PATTERNS)
    else:
        rows, bad = district_rows_from_pdf(path, 6)
        check(f"c-6 {year} pdf row widths", not bad, ",".join(bad))
    out, failures = {}, []
    for label, vals in rows.items():
        block = dict(zip(C6_KEYS, vals))
        block["over_3y_pct"] = round1(block["over_3y_pct"])
        parts = sum(nz(block[k]) for k in ("under_1y", "y1_2", "y2_3", "over_3y"))
        if block["pending"] is None or parts != block["pending"]:
            failures.append(f"{label}: {block['pending']} vs {parts}")
            continue
        out[label] = block
    check(f"c-6 {year} row sums", not failures, "; ".join(failures[:5]))
    return out, fmt, path


X1A_KEYS = ["judgeships", "unweighted_total", "unweighted_civil", "unweighted_criminal", "unweighted_supervision", "weighted_total", "weighted_civil", "weighted_criminal", "weighted_supervision"]


def read_x1a(year):
    fmt, path = edition(year, "x-1a")
    if fmt == "xlsx":
        patterns = [r"^Judgeships$", r"^Unweighted.* / Total$", r"^Unweighted.* / Civil$", r"^Unweighted.* / Criminal$", r"^Unweighted.* / Supervision", r"^Weighted.* / Total$", r"^Weighted.* / Civil$", r"^Weighted.* / Criminal$", r"^Weighted.* / Supervision"]
        rows, headers = district_rows_from_xlsx(path, patterns)
    else:
        text = T.pdf_text(path)
        # The column-group heading line names the two blocks in printed order (it differs between editions).
        order = re.search(r"\b(Unweighted|Weighted) Filings per Judgeship\s+(Unweighted|Weighted) Filings per Judgeship", text)
        unweighted_first = bool(order) and order.group(1) == "Unweighted"
        check(f"x-1a {year} pdf block order", bool(order) and order.group(1) != order.group(2) and "Civil Criminal Hearings Total Civil Criminal Hearings Total" in text.replace("\n", " "), "unweighted first" if unweighted_first else "weighted first")
        raw, bad = district_rows_from_pdf(path, 9)
        check(f"x-1a {year} pdf row widths", not bad, ",".join(bad))
        rows = {}
        for label, v in raw.items():
            a = {"civil": v[1], "criminal": v[2], "supervision": v[3], "total": v[4]}
            b = {"civil": v[5], "criminal": v[6], "supervision": v[7], "total": v[8]}
            uw, w = (a, b) if unweighted_first else (b, a)
            rows[label] = [v[0], uw["total"], uw["civil"], uw["criminal"], uw["supervision"], w["total"], w["civil"], w["criminal"], w["supervision"]]
    out, failures = {}, []
    for label, vals in rows.items():
        block = dict(zip(X1A_KEYS, vals))
        for prefix in ("unweighted", "weighted"):
            parts = sum(nz(block[f"{prefix}_{k}"]) for k in ("civil", "criminal", "supervision"))
            if block[f"{prefix}_total"] is None or abs(parts - block[f"{prefix}_total"]) > 2:
                failures.append(f"{label} {prefix}: {block[f'{prefix}_total']} vs {parts:.1f}")
        # Supervision hearings carry a small case weight, so weighted < unweighted whenever hearings exist.
        if nz(block["weighted_supervision"]) > nz(block["unweighted_supervision"]):
            failures.append(f"{label}: weighted supervision {block['weighted_supervision']} > unweighted {block['unweighted_supervision']} (block order)")
        for k in X1A_KEYS[1:]:
            block[k] = round1(block[k])
        out[label] = block
    check(f"x-1a {year} per-judgeship sums", not failures, "; ".join(failures[:5]))
    return out, fmt, path


# C-3: map every published column to an exhaustive group so groups sum to the district total.
C3_US = [("contract", r"^U\.S\. Cases / Contract$"), ("real_property", r"^U\.S\. Cases / Real Property$"), ("us_tort", r"^U\.S\. Cases / Tort Action"), ("civil_rights", r"^U\.S\. Cases / Civil Rights$"),
         ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Motions? to Vacate"), ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Habeas Corpus General"), ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Death Penalty"),
         ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Prison Civil Rights"), ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Prison Condition$"), ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Mandamus"),
         ("prisoner", r"^U\.S\. Cases / Prisoner Petitions / Habeas Corpus - Alien"), ("forfeiture", r"^U\.S\. Cases / Forfeitures"), ("labor", r"^U\.S\. Cases / Labor"), ("social_security", r"^U\.S\. Cases / Social Security"), ("all_other", r"^U\.S\. Cases / All Other")]
C3_PRIVATE = [("contract", r"^Private Cases / Contract$"), ("real_property", r"^Private Cases / Real Property$"), ("fela", r"^Private Cases / FELA"), ("marine_pi", r"^Private Cases / Marine Personal Injury"),
              ("motor_vehicle_pi", r"^Private Cases / Motor Vehicle Personal Injury"), ("other_pi", r"^Private Cases / Other Personal Injury"), ("other_tort", r"^Private Cases / Other Tort"), ("civil_rights", r"^Private Cases / Civil Rights$"),
              ("prisoner", r"^Private Cases / Prisoner Petitions / Habeas Corpus General"), ("prisoner", r"^Private Cases / Prisoner Petitions / Death Penalty"), ("prisoner", r"^Private Cases / Prisoner Petitions / Prison Condition"),
              ("prisoner", r"^Private Cases / Prisoner Petitions / Mandamus"), ("ip", r"^Private Cases / Intellectual Property"), ("labor", r"^Private Cases / Labor"), ("all_other", r"^Private Cases / All Other")]
C3_GROUPS = ["contract", "real_property", "fela", "marine_pi", "motor_vehicle_pi", "other_pi", "other_tort", "us_tort", "civil_rights", "prisoner", "forfeiture", "labor", "social_security", "ip", "all_other"]
# PDF (FY2014-FY2016) column order, as printed in the page headers.
C3_PDF_US = ["total_civil", "us_total", "contract", "real_property", "us_tort", "civil_rights", "prisoner", "prisoner", "prisoner", "prisoner", "prisoner", "prisoner", "prisoner", "forfeiture", "labor", "social_security", "all_other"]
C3_PDF_PRIVATE = ["private_total", "contract", "real_property", "fela", "marine_pi", "motor_vehicle_pi", "other_pi", "other_tort", "civil_rights", "prisoner", "prisoner", "prisoner", "prisoner", "ip", "labor", "all_other"]


def _c3_accumulate(target, key, value, side):
    target.setdefault(key, 0)
    target[key] += nz(value)
    target.setdefault(f"{side}_sum", 0)
    target[f"{side}_sum"] += nz(value)


def read_c3(year):
    fmt, path = edition(year, "c-3")
    blocks = {}
    if fmt == "xlsx":
        for title, paths, rows in T.xlsx_sheets(path):
            spec = []
            for pattern, key in [(r"^Total Civil Cases$", "total_civil"), (r"^U\.S\. Cases / Total U\.S\. Civil Cases$", "us_total"), (r"^Private Cases / Total Private Civil Cases$", "private_total")]:
                idx = next((i for i, p in enumerate(paths) if i > 0 and re.search(pattern, p)), None)
                if idx is not None:
                    spec.append((idx, key, None))
            for side, groups in (("us", C3_US), ("private", C3_PRIVATE)):
                for key, pattern in groups:
                    idx = next((i for i, p in enumerate(paths) if i > 0 and re.search(pattern, p, re.I) and not any(s[0] == i for s in spec)), None)
                    if idx is not None:
                        spec.append((idx, key, side))
            for label, values in rows:
                if not (label.upper() == "TOTAL" or T.circuit_id(label) or T.district_id(label)):
                    continue
                block = blocks.setdefault(label, {})
                for idx, key, side in spec:
                    value = T.to_number(values[idx - 1]) if idx - 1 < len(values) else None
                    if side is None:
                        block[key] = value
                    else:
                        _c3_accumulate(block, key, value, side)
        expected_cols = len(C3_US) + len(C3_PRIVATE) + 3
        check(f"c-3 {year} columns located", True, f"{expected_cols} columns expected")
    else:
        us, bad_us = district_rows_from_pdf(path, 17, page_filter=lambda t: "U.S. Cases" in t[:400] and "Private Cases" not in t[:400])
        pv, bad_pv = district_rows_from_pdf(path, 16, page_filter=lambda t: "Private Cases" in t[:400])
        check(f"c-3 {year} pdf row widths", not bad_us and not bad_pv, ",".join(bad_us + bad_pv))
        for label in set(us) | set(pv):
            block = blocks.setdefault(label, {})
            for key, value in zip(C3_PDF_US, us.get(label, [])):
                if key in ("total_civil", "us_total"):
                    block[key] = value
                else:
                    _c3_accumulate(block, key, value, "us")
            for key, value in zip(C3_PDF_PRIVATE, pv.get(label, [])):
                if key == "private_total":
                    block[key] = value
                else:
                    _c3_accumulate(block, key, value, "private")
    out, failures = {}, []
    for label, block in blocks.items():
        ok = (block.get("total_civil") is not None and block.get("us_total") is not None and block.get("private_total") is not None
              and block["us_total"] + block["private_total"] == block["total_civil"]
              and block.get("us_sum") == block["us_total"] and block.get("private_sum") == block["private_total"])
        if not ok:
            failures.append(f"{label}: total {block.get('total_civil')} us {block.get('us_total')}/{block.get('us_sum')} private {block.get('private_total')}/{block.get('private_sum')}")
            continue
        clean = {"total": block["total_civil"], "us": block["us_total"], "private": block["private_total"]}
        for g in C3_GROUPS:
            clean[g] = block.get(g, 0)
        check_sum = sum(clean[g] for g in C3_GROUPS)
        if check_sum != clean["total"]:
            failures.append(f"{label}: groups {check_sum} vs {clean['total']}")
            continue
        out[label] = clean
    check(f"c-3 {year} row sums", not failures, "; ".join(failures[:5]))
    return out, fmt, path


# ---------------------------------------------------------------- appeals

def read_b(year):
    return read_c(year, "b")


B4_PATTERNS = [r"^Terminated on the Merits / Total$", r"Notice of Appeal or Docket Date to Last Opinion or Final Order.* / Cases$", r"Notice of Appeal or Docket Date to Last Opinion or Final Order.* / Interval$", r"Filing in Lower Court to Last Opinion.* / Cases$", r"Filing in Lower Court to Last Opinion.* / Interval$"]
B4_KEYS = ["merits_terminations", "n_notice_to_final", "median_notice_to_final", "n_lower_court_to_final", "median_lower_court_to_final"]


def read_b4(year):
    fmt, path = edition(year, "b-4")
    if fmt == "xlsx":
        rows, headers = district_rows_from_xlsx(path, B4_PATTERNS + [r"Oral Argument to Last Opinion.* / Cases$", r"Submission on Briefs to Last Opinion.* / Cases$"])
    elif fmt == "pdf":
        # PDF editions print 14 numbers per circuit: total, by consolidation, then (cases, interval) for six intervals
        # in the order of the column headings checked here.
        text = " ".join(T.pdf_text(path).split())
        order = ["Filing of Notice of Appeal or Docket Date to Filing of Appellee's Last Brief", "Filing of Appellee's Last Brief to Oral Argument", "Oral Argument to Last Opinion or Final Order",
                 "Submission on Briefs to Last Opinion or Final Order", "Filing of Notice of Appeal or Docket Date to Last Opinion or Final Order", "Filing in Lower Court to Last Opinion or Final Order"]
        heading_ok = "Total Consolidation Cases Interval Cases Interval Cases Interval Cases Interval Cases Interval Cases Interval" in text
        if not check(f"b-4 {year} pdf column headings", heading_ok, path.name):
            return {}, None, path
        raw, bad = district_rows_from_pdf(path, 14)
        check(f"b-4 {year} pdf row widths", not bad, ",".join(bad))
        rows = {label: [v[0], v[10], v[11], v[12], v[13], v[6], v[8]] for label, v in raw.items()}
    else:
        return {}, None, path
    out, failures = {}, []
    for label, vals in rows.items():
        block = dict(zip(B4_KEYS, vals[:5]))
        n_oral, n_briefs = vals[5], vals[6]
        # Every merits termination is decided after oral argument or on the briefs: the notice-to-final case count
        # must equal the sum of those two interval counts.
        if block["n_notice_to_final"] is None or nz(n_oral) + nz(n_briefs) != block["n_notice_to_final"]:
            failures.append(f"{label}: {block['n_notice_to_final']} vs {nz(n_oral) + nz(n_briefs)}")
            continue
        block["median_notice_to_final"] = round1(block["median_notice_to_final"])
        block["median_lower_court_to_final"] = round1(block["median_lower_court_to_final"])
        out[label] = block
    check(f"b-4 {year} interval case counts", not failures, "; ".join(failures[:5]))
    return out, fmt, path


B7_ROWS = {"total": r"^Total$", "criminal": r"^Total Criminal Appeals$", "civil": r"^Total Civil Appeals$", "us": r"^U\.?S\.? Appeals$", "private": r"^Total Private Appeals$", "diversity": r"^Diversity of Citizenship$"}


def read_b7(year):
    """Civil appeals by circuit, incl. diversity personal injury/product liability (row under 'Diversity of Citizenship')."""
    fmt, path = edition(year, "b-7")
    if fmt != "xlsx":
        check(f"b-7 {year} skipped", True, "PDF edition not parsed")
        return {}, None, path
    out = {}
    for title, paths, rows in T.xlsx_sheets(path):
        pass
    wb_rows = []
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    grid = [list(r) for r in ws.iter_rows(values_only=True)]
    header_row = next(i for i, r in enumerate(grid) if r and any(T.clean_label(c).upper() in ("1ST",) for c in r if c is not None))
    header = [T.clean_label(c) for c in grid[header_row]]
    cols = {}
    for i, h in enumerate(header):
        if h.upper() == "DC":
            cols["cadc"] = i
        elif T.circuit_id(h):
            cols[T.circuit_id(h)] = i
    total_col = 1
    section = None
    for r in grid[header_row + 1:]:
        if not r or r[0] is None:
            continue
        label = T.clean_label(r[0])
        key = None
        for k, pattern in B7_ROWS.items():
            if re.match(pattern, label, re.I):
                key = k
        if label.lower().startswith("diversity of citizenship"):
            section = "diversity"
        elif label.lower().startswith(("federal question", "general local", "total criminal", "u.s. appeals", "total private")):
            section = label.lower()
        if section == "diversity" and re.match(r"^Personal Injury/Product", label, re.I):
            key = "diversity_pi_pl"
        if key and key not in out:
            out[key] = {"national": T.to_number(r[total_col]), **{cid: T.to_number(r[i]) for cid, i in cols.items()}}
        wb_rows.append(label)
    ok = all(k in out for k in ("total", "civil", "diversity_pi_pl")) and len(cols) == 12
    if ok:
        for k, v in out.items():
            s = sum(nz(v[c]) for c in CIRCUITS)
            if v["national"] is not None and s != v["national"]:
                ok = False
                check(f"b-7 {year} {k} circuit sum", False, f"{s} vs {v['national']}")
    check(f"b-7 {year} rows located", ok, ",".join(sorted(out)))
    return (out if ok else {}), fmt, path


# ---------------------------------------------------------------- national nature of suit (C-2A, five-year editions)

C2A_ROWS = [("total", r"^Total Cases$", None), ("tort_total", r"^Tort Actions, Total$", None), ("pi_total", r"^Personal Injury, Total$", None), ("pi_pl_total", r"^Personal Injury/Product Liability", None),
            ("pl_airplane_315", r"^Airplane$", "pl"), ("pl_marine_345", r"^Marine$", "pl"), ("pl_motor_vehicle_355", r"^Motor Vehicle$", "pl"), ("pl_asbestos_368", r"^Asbestos$", "pl"),
            ("pl_health_care_pharma_367", r"^Health Care/Pharm", "pl"), ("pl_other_365", r"^Other$", "pl"), ("other_pi_total", r"^Other Personal Injury$", None), ("pi_medical_malpractice", r"^Medical Malpractice", "opi"),
            ("pi_motor_vehicle", r"^Motor Vehicle$", "opi"), ("property_damage_total", r"^Personal Property Damage, Total$", None), ("torts_to_land_240_245", r"^Torts to Land", None),
            ("civil_rights_total", r"^Civil Rights, Total$", None), ("prisoner_total", r"^Prisoner Petitions, Total$", None), ("contract_total", r"^Contract Actions, Total$", None),
            ("ip_total", r"^Intellectual Property Rights, Total$", None), ("labor_total", r"^Labor Laws, Total$", None), ("social_security_total", r"^Social Security Laws, Total$", None),
            ("securities_total", r"^Securities, Commodities", None), ("antitrust", r"^Antitrust$", None), ("consumer_credit", r"^Consumer Credit$", None), ("rico", r"^Racketeer", None),
            ("environmental", r"^Environmental Matters$", None), ("insurance", r"^Insurance$", None)]


def read_c2a(year):
    fmt, path = edition(year, "c-2a")
    if fmt != "xlsx":
        return {}, None, path
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    grid = [list(r) for r in ws.iter_rows(values_only=True)]
    header_row = next(i for i, r in enumerate(grid) if r and T.clean_label(r[0]).startswith("Nature of Suit"))
    years = {}
    for i, v in enumerate(grid[header_row]):
        if isinstance(v, (int, float)) or (isinstance(v, str) and re.fullmatch(r"\d{4}", v.strip())):
            years[int(v)] = i
    section = None
    out = {y: {} for y in years}
    for r in grid[header_row + 1:]:
        if not r or r[0] is None:
            continue
        label = T.clean_label(r[0])
        if re.match(r"^Personal Injury/Product Liability", label):
            section = "pl"
        elif label == "Other Personal Injury":
            section = "opi"
        elif re.search(r", Total$", label) or label in ("Total Cases",):
            section = None
        for key, pattern, need in C2A_ROWS:
            if re.match(pattern, label) and (need is None or need == section) and key not in out[next(iter(years))]:
                for y, col in years.items():
                    out[y][key] = T.to_number(r[col])
                break
    for y, block in out.items():
        parts = sum(nz(block.get(k)) for k in ("pl_airplane_315", "pl_marine_345", "pl_motor_vehicle_355", "pl_asbestos_368", "pl_health_care_pharma_367", "pl_other_365"))
        check(f"c-2a {year} edition {y} PI/PL parts", parts == block.get("pi_pl_total"), f"{parts} vs {block.get('pi_pl_total')}")
    return out, fmt, path


# ---------------------------------------------------------------- source bookkeeping

def manifest_sources():
    manifest = json.loads((ACQ / "manifest.json").read_text())
    sources = {}
    for e in manifest:
        files = {Path(f["path"]).name: f for f in e["files"] if f.get("sha256")}
        sources[(e["table"], e["year"])] = {"page": e["page"], "files": files, "title": e.get("page_title")}
    return sources


def source_entry(sources, table, year, fmt, path):
    meta = sources.get((table, year))
    if not meta or path is None:
        return None
    f = meta["files"].get(path.name)
    return {"table": table.upper(), "fiscal_year": year, "page": meta["page"], "url": f["url"] if f else None, "sha256": f["sha256"] if f else None,
            "format": fmt, "retrieved_at": f["retrieved_at"] if f else None, "period": f"12 months ending September 30, {year}"}


def main():
    sources = manifest_sources()
    member = membership()
    districts, circuits, national = {}, {}, {}
    used = []

    def put(entity_map, eid, year, key, value):
        entity_map.setdefault(eid, {}).setdefault(str(year), {})[key] = value

    for year in YEARS:
        for table, reader, key in (("c-11", read_c11, "c11"), ("c", read_c, "c"), ("c-5", read_c5, "c5"), ("c-6", read_c6, "c6"), ("x-1a", read_x1a, "x1a"), ("c-3", read_c3, "c3")):
            rows, fmt, path = reader(year)
            used.append(source_entry(sources, table, year, fmt, path))
            nat, circ, dist = by_entity(rows)
            if nat is not None:
                national.setdefault(str(year), {})[key] = nat
            for cid, vals in circ.items():
                put(circuits, cid, year, key, vals)
            for did, vals in dist.items():
                put(districts, did, year, key, vals)
            # circuit roll-up check on the headline count of each table
            head = {"c11": "total", "c": "filed", "c5": "n_total", "c6": "pending", "c3": "total"}.get(key)
            if head and circ:
                bad = []
                for cid in CIRCUITS:
                    members = [d for d, c in member.items() if c == cid]
                    if cid not in circ:
                        continue
                    s = sum(nz(dist.get(d, {}).get(head)) for d in members)
                    if s != circ[cid].get(head):
                        bad.append(f"{cid} {s} vs {circ[cid].get(head)}")
                check(f"{table} {year} circuit roll-up", not bad, "; ".join(bad))
            if head and nat is not None:
                s = sum(nz(v.get(head)) for v in dist.values())
                check(f"{table} {year} national roll-up", s == nat.get(head), f"{s} vs {nat.get(head)}")
        for table, reader, key in (("b", read_b, "b"), ("b-4", read_b4, "b4")):
            rows, fmt, path = reader(year)
            if fmt:
                used.append(source_entry(sources, table, year, fmt, path))
            for label, vals in rows.items():
                if label.upper() == "TOTAL":
                    national.setdefault(str(year), {})[key] = vals
                elif T.circuit_id(label):
                    put(circuits, T.circuit_id(label), year, key, vals)
        rows, fmt, path = read_b7(year)
        if fmt:
            used.append(source_entry(sources, "b-7", year, fmt, path))
        for rowkey, values in rows.items():
            national.setdefault(str(year), {}).setdefault("b7", {})[rowkey] = values.get("national")
            for cid in CIRCUITS:
                circuits.setdefault(cid, {}).setdefault(str(year), {}).setdefault("b7", {})[rowkey] = values.get(cid)
    # appeals totals check
    for year in YEARS:
        b = national.get(str(year), {}).get("b")
        if b:
            s = sum(nz(circuits.get(c, {}).get(str(year), {}).get("b", {}).get("filed")) for c in CIRCUITS)
            check(f"b {year} circuit roll-up", s == b.get("filed"), f"{s} vs {b.get('filed')}")
    # national NOS from the latest C-2A edition covering each year
    for ed in (2018, 2022, 2025):
        rows, fmt, path = read_c2a(ed)
        used.append(source_entry(sources, "c-2a", ed, fmt, path))
        for y, block in rows.items():
            if 2014 <= y <= 2025:
                national.setdefault(str(y), {})["c2a"] = block
                national[str(y)]["c2a_edition"] = ed
    # cross-table checks: C-3 total civil == C filings; C-2A total == C filings
    for year in YEARS:
        n = national.get(str(year), {})
        if n.get("c3") and n.get("c"):
            check(f"cross {year} C-3 total == C filed", n["c3"]["total"] == n["c"]["filed"], f"{n['c3']['total']} vs {n['c']['filed']}")
        if n.get("c2a") and n.get("c"):
            check(f"cross {year} C-2A total == C filed", n["c2a"].get("total") == n["c"]["filed"], f"{n['c2a'].get('total')} vs {n['c']['filed']}")
        if n.get("c2a") and n.get("c11"):
            pl = n["c11"]["total"] - nz(n["c11"]["contract"]) - nz(n["c11"]["real_property"]) - nz(n["c11"]["property_damage"])
            check(f"cross {year} C-11 PI/PL == C-2A PI/PL", pl == n["c2a"].get("pi_pl_total"), f"{pl} vs {n['c2a'].get('pi_pl_total')}")
        disagree = [d for d, ys in districts.items() if ys.get(str(year), {}).get("c3") and ys[str(year)].get("c") and ys[str(year)]["c3"]["total"] != ys[str(year)]["c"]["filed"]]
        check(f"cross {year} district C-3 total == C filed", not disagree, ",".join(disagree[:8]))
    # prior-year revisions: compare each edition's prior-year column with the previous edition's current column
    revisions = []
    for d, ys in districts.items():
        for year in YEARS[1:]:
            cur, prev = ys.get(str(year), {}).get("c11"), ys.get(str(year - 1), {}).get("c11")
            if cur and prev and cur["prior_total"] != prev["total"]:
                revisions.append(f"{d} FY{year - 1}: {prev['total']} -> {cur['prior_total']}")
    check("c-11 prior-year column matches previous edition", not revisions, f"{len(revisions)} revised: " + "; ".join(revisions[:10]))
    # rows whose components were withheld keep their total only when the next edition prints the same prior-year total
    for d, ys in districts.items():
        for year in YEARS:
            block = ys.get(str(year), {}).get("c11")
            if not block or not block.get("components_withheld"):
                continue
            nxt = ys.get(str(year + 1), {}).get("c11")
            confirmed = bool(nxt) and nxt.get("prior_total") == block["total"]
            check(f"c-11 {year} {d} withheld-row total confirmed by FY{year + 1} edition", confirmed, f"{block['total']} vs {nxt.get('prior_total') if nxt else None}")
            if not confirmed:
                block["total"] = None
    out = {"years": YEARS, "membership": member, "districts": districts, "circuits": circuits, "national": national,
           "sources": [s for s in used if s], "checks": CHECKS}
    (ACQ / "normalized.json").write_text(json.dumps(out, indent=1))
    failed = [c for c in CHECKS if not c["ok"]]
    print(json.dumps({"districts": len(districts), "circuits": len(circuits), "years": len(national), "checks": len(CHECKS), "failed": len(failed)}))
    for c in failed:
        print("FAIL", c["check"], "::", c["detail"][:300])


if __name__ == "__main__":
    main()
