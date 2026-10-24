"""Read the three U.S. Courts report publications acquired by acquire_reports.py (they are not in the caseload table listing).

  * Delayed-Notice Search Warrant report (DNSW), fiscal years ending September 30:
      Table 1, applications by district: 2017-2024 spreadsheets ("DNSW-1" / "DNSW Table 1"), 2007 and 2009-2016 PDF reports (the
      2007 report also prints Table 1a for the interim period March-September 2006); the 2008 report has no text layer and is not read.
      Table 2, applications by offense: the same editions.
  * Director's Report on the Foreign Intelligence Surveillance Courts' Activities (FISC), calendar years 2015-2025 (2015 covers
      June 8 to December 31): Table 1, applications or certifications by section of the statute and the Court's action.
  * Crime Victims' Rights Act report (CVRA), 2005-2024: the reports print no table. Each states, in its opening paragraph, how many
      mandamus actions and court cases it summarises; those counts are kept as one record per report with the sentence as printed.

Every table-period is written only when ALL of its own checks hold, exactly:
  DNSW 1  every row: applications = warrant applications + extension applications; warrant applications = granted + granted as
          modified + denied (each of the two kinds); the Total = the circuits; each circuit = its districts (reconcile.court_tests);
          every row label maps to one court id (a state name and district, "NEW YORK (EASTERN)" -> nyed; exact rules only).
  DNSW 2  every row: all applications = warrants + extensions (number columns); the Total = the sum of the offense rows.
  FISC 1  every column of the table adds up to the total the report's Summary of Findings states for it (applications received,
          orders granted, orders modified, orders denied in part, applications denied in full).
A table that fails is listed in reports_report.json with its reason and nothing of it is used.

Second path: every figure read from a PDF is looked for again with the other text extraction (DNSW from pdftotext -layout, checked
with pdfplumber words; FISC from pdfplumber words, checked with pdftotext -layout): the row's figures must appear, in the same order,
on the line that starts with the row's label. A spreadsheet figure is looked up again with openpyxl directly (row by its label,
column by its position), without utx_parse or normalize. A period whose second path disagrees is not written.

Writes parsed table files under private/build/uscourts_tables/parsed/{DNSW,FISC}/<period end>/ (read by build_uscourts_tables.py as
the uscourts_dnsw and uscourts_fisc datasets), the build file private/build/uscourts_tables/uscourts_cvra.json.gz and
private/build/uscourts_tables/reports_report.json. Usage: python3 -I -B reports.py
"""
import gzip
import io
import json
import re
import subprocess
import sys
import tempfile
import warnings
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import entities as E  # noqa: E402
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import reconcile as R  # noqa: E402
import utx_parse as P  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
REPORTS_VERSION = "reports-2026-10-25.1"
CVRA_DATASET = "uscourts_cvra"
PAGES = {
    "DNSW": "https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report",
    "FISC": "https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities",
    "CVRA": "https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report",
}
warnings.filterwarnings("ignore")
HELD = "fails its own printed totals: "  # the reason prefix of a table-period that breaks its own printed arithmetic

# ------------------------------------------------------------------------------------------------------------ numbers and text

NUMBER_WORDS = {"no": 0, "none": 0, "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
                "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
INTEGER = re.compile(r"^\d{1,3}(?:,\d{3})+$|^\d+$")


def count_of(token):
    """An integer printed as figures ("1,010") or in words ("seven", "Thirty-five", "no"); None otherwise."""
    t = token.strip().rstrip(".,;").lower()
    if INTEGER.match(t):
        return int(t.replace(",", ""))
    parts = t.split("-")
    if all(p in NUMBER_WORDS for p in parts) and 1 <= len(parts) <= 2:
        if len(parts) == 2 and not (NUMBER_WORDS[parts[0]] >= 20 and NUMBER_WORDS[parts[0]] % 10 == 0 and 0 < NUMBER_WORDS[parts[1]] < 10):
            return None
        return sum(NUMBER_WORDS[p] for p in parts)
    return None


def pdf_layout(data):
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(data)
        handle.flush()
        return subprocess.run(["pdftotext", "-layout", handle.name, "-"], capture_output=True, text=True, check=True).stdout


def pdf_word_lines(data):
    """[[line words]] per page from pdfplumber: words {text, x0, x1, top, size}, grouped into lines by their tops."""
    import pdfplumber

    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False, use_text_flow=False, extra_attrs=["size"])
            lines = []
            for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
                for line in lines[-3:]:
                    if abs(line[0]["top"] - w["top"]) <= 3.5:
                        line.append(w)
                        break
                else:
                    lines.append([w])
            pages.append([sorted(line, key=lambda w: w["x0"]) for line in lines])
    return pages


def label_key(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def line_figures(words_or_tokens, label):
    """The tokens printed after the label on a line (the label's letters and digits matched exactly), or None."""
    tokens = [w if isinstance(w, str) else w["text"] for w in words_or_tokens]
    want, acc, k = label_key(label), "", 0
    while k < len(tokens) and len(acc) < len(want):
        acc += label_key(tokens[k])
        k += 1
    return tokens[k:] if acc == want else None


# ------------------------------------------------------------------------------------------------------------ parsed documents

def make_norm(*, pub, table, period_end, title, title_listing, phrase, months, scope, columns, rows, notes, printed_id, sheet, warnings_=()):
    kinds = {"national": 0, "circuit": 0, "district": 0, "other": 0}
    for r in rows:
        kinds["national" if r["entity"] == "national" else r["entity"] if r["entity"] in kinds else "other"] += 1
    return {
        "pub": pub, "table": table, "table_key": N.table_slug(table), "title": title, "title_listing": title_listing, "period_end": period_end,
        "period_phrase": phrase, "months": months, "scope": scope, "printed_table_id": printed_id, "sheet": sheet, "sheet_index": 0,
        "columns": [{"index": i + 1, "key": key, "path": path, "label": " / ".join(path), "fmt": fmt, "marks": [], "prior": False}
                    for i, (key, path, fmt) in enumerate(columns)],
        "rows": rows, "notes": list(notes), "note_marks": {}, "problems": [], "hierarchy": "indent", "ambiguous_rows": [],
        "row_kinds": {"national": kinds["national"], "circuit": kinds["circuit"], "district": kinds["district"], "other": kinds["other"]},
        "label_header": [], "warnings": list(warnings_),
    }


def make_row(k, label, entity, entity_id, values, flags=None, marks=()):
    return {"row": k, "label": label, "label_raw": label, "entity": entity, "entity_id": entity_id, "values": list(values),
            "flags": list(flags) if flags is not None else [None] * len(values), "marks": list(marks), "cell_marks": {}, "path": [label],
            "indent": 0 if entity in ("national", "circuit") else 1, "section": False}


def source_of(entry, table, period_end):
    return {"pub": entry["pub"], "table": table, "period_end": period_end, "page": entry["page"], "url": entry["url"], "sha256": entry["sha256"],
            "bytes": entry["bytes"], "format": entry["format"]}


def write_doc(pub, period_end, table, entry, norm, reader):
    target = PARSED / pub / period_end / (N.table_slug(table) + ".json.gz")
    doc = {"parser_version": REPORTS_VERSION, "source": source_of(entry, table, period_end), "sheets": [norm], "rejected_sheets": [], "reader": reader}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
    return target


# ------------------------------------------------------------------------------------------------------------ DNSW

STATE_CODES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
    "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
    "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY", "PUERTO RICO": "PR",
    "GUAM": "GU", "VIRGIN ISLANDS": "VI", "NORTHERN MARIANA ISLANDS": "NMI", "NORTHERN MARIANAS": "NMI",
}
DIRECTIONS = {"EASTERN": "E", "WESTERN": "W", "NORTHERN": "N", "SOUTHERN": "S", "MIDDLE": "M", "CENTRAL": "C"}
CIRCUIT_WORDS = {"FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4, "FIFTH": 5, "SIXTH": 6, "SEVENTH": 7, "EIGHTH": 8, "NINTH": 9, "TENTH": 10,
                 "ELEVENTH": 11}
# the columns of DNSW Table 1 under the keys of the spreadsheet editions (2018-2024); the reports before 2017 also print the
# average period of delay, and the 2007 report prints no Denied columns (none was denied that year)
D1_COLUMNS = [("all_applications", ["All Applications"]), ("average_delay_in_days", ["Average Delay (in Days)"]), ("warrants/total", ["Warrants", "Total"]),
              ("warrants/granted", ["Warrants", "Granted"]), ("warrants/granted_as_modified", ["Warrants", "Granted as Modified"]),
              ("warrants/denied", ["Warrants", "Denied"]), ("extensions/total", ["Extensions", "Total"]), ("extensions/granted", ["Extensions", "Granted"]),
              ("extensions/granted_as_modified", ["Extensions", "Granted as Modified"]), ("extensions/denied", ["Extensions", "Denied"])]
D2_COLUMNS = [("all_applications/number", ["All Applications", "Number"]), ("all_applications/percent", ["All Applications", "Percent"]),
              ("warrants/number", ["Warrants", "Number"]), ("warrants/percent", ["Warrants", "Percent"]),
              ("extensions/number", ["Extensions", "Number"]), ("extensions/percent", ["Extensions", "Percent"])]
# the 2017 spreadsheets head the same columns "Total Requests" and "Requests"
D_RENAMED = {"total_requests": "all_applications", "warrants/requests": "warrants/total", "extensions/requests": "extensions/total",
             "total_requests/number": "all_applications/number", "total_requests/percent": "all_applications/percent"}
D_TITLES = {"DNSW 1": "U.S. District Courts - Applications for Delayed-Notice Search Warrants and Extensions, by Application Type and Judicial Action",
            "DNSW 2": "U.S. District Courts - Applications for Delayed-Notice Search Warrants and Extensions, by Offense and Application Type"}


def dnsw_entity(label):
    """(entity, id) for a row label of the PDF reports: "ALL CIRCUITS", "FIRST CIRCUIT", "DC CIRCUIT", "NEW YORK (EASTERN)", "MAINE"."""
    t = re.sub(r"\s+", " ", label.strip()).upper()
    if t in ("ALL CIRCUITS", "TOTAL"):
        return "national", "national"
    m = re.fullmatch(r"(\w+) CIRCUIT", t)
    if m:
        if m.group(1) == "DC":
            return "circuit", "cadc"
        if m.group(1) in CIRCUIT_WORDS:
            return "circuit", f"ca{CIRCUIT_WORDS[m.group(1)]}"
        return None
    m = re.fullmatch(r"([A-Z .]+?)(?: \((EASTERN|WESTERN|NORTHERN|SOUTHERN|MIDDLE|CENTRAL)\))?", t)
    if not m or m.group(1) not in STATE_CODES:
        return None
    code = STATE_CODES[m.group(1)]
    cid = E.district_id(f"{code},{DIRECTIONS[m.group(2)]}" if m.group(2) else code)
    return ("district", cid) if cid else None


def dnsw_year(entry):
    m = re.search(r"report-(\d{4})$", entry["page"]) or re.fullmatch(r"(\d{4})", entry["link_text"].strip())
    return int(m.group(1)) if m else None


def dnsw_xlsx_table(entry):
    m = re.search(r"dnsw[-_ ]?(?:table[-_ ]?)?([12])", entry["url"].rsplit("/", 1)[-1], re.I)
    return f"DNSW {m.group(1)}" if m else None


def distinct_labels(norm):
    """Offense rows whose printed labels differ only in letter case ("Fraud" and "fraud" in the 2024 table, with different figures)
    are different printed rows: the later one gets its own id ("fraud~2"), so neither is taken for the other. Rows printed with the
    same label twice are left as they are (the builder leaves such a row out of the period)."""
    seen = {}
    for r in norm["rows"]:
        if r["section"] or r["entity"] != "category":
            continue
        first = seen.setdefault(r["entity_id"], r["label_raw"])
        if first != r["label_raw"]:
            n = sum(1 for x in norm["rows"] if x.get("entity_id", "").split("~")[0] == r["entity_id"])
            r["entity_id"] = f"{r['entity_id']}~{n}"
            norm.setdefault("warnings", []).append(f"Two offense rows are printed as {first!r} and {r['label_raw']!r}; they are kept apart.")


def lift_title(sheet):
    """The 2018-2024 spreadsheets print the title in a merged cell over the column headings, so the parsed column paths start with
    it ("DNSW Table 1. U.S. District Courts ... September 30, 2018"); it is the table's title, not a heading."""
    heads = {c["path"][0] for c in sheet["columns"] if c["path"]}
    if sheet["title_raw"] or len(heads) != 1:
        return False
    head = next(iter(heads))
    if not re.match(r"DNSW Table \d\.", head):
        return False
    sheet["title_raw"] = head
    for c in sheet["columns"]:
        c["path"] = c["path"][1:]
    sheet["period_end_from_title"] = P.parse_period_phrase(head)[1]
    return True


def dnsw_identities(norm, table):
    """[] or failures: the arithmetic every DNSW table-period must satisfy (module docstring)."""
    pos = {c["key"]: i for i, c in enumerate(norm["columns"])}
    fails = []

    def val(r, key):
        if key not in pos:
            return None
        v, ok = R._num(r, pos[key])
        return v if ok else None

    rows = [r for r in norm["rows"] if not r["section"]]
    if table == "DNSW 1":
        parts = [("all_applications", ["warrants/total", "extensions/total"])]
        for kind in ("warrants", "extensions"):
            parts.append((f"{kind}/total", [f"{kind}/granted", f"{kind}/granted_as_modified"] + ([f"{kind}/denied"] if f"{kind}/denied" in pos else [])))
        for r in rows:
            for total, ps in parts:
                t, vs = val(r, total), [val(r, p) for p in ps]
                if t is None or any(v is None for v in vs):
                    fails.append(f"{r['label']}: {total} or its parts not printed")
                elif t != sum(vs):
                    fails.append(f"{r['label']}: {total} {t} != {' + '.join(ps)} {sum(vs)}")
        tests = []
        counts = [pos[k] for k, _ in D1_COLUMNS if k in pos and k != "average_delay_in_days"]
        R.court_tests(norm, counts, tests)
        state = [r for r in R.data_rows(norm) if r["entity"] == "other" and r["entity_id"] == "state"]
        if state:
            norm["total_includes"] = ["state"]  # read so by reconcile.court_tests in the build as well
            # the reports from 2012 print the applications state judges reported as a "STATE" group with one "STATE" row, counted
            # in the Total: the Total is the circuits plus that row
            groups = [r for r in R.data_rows(norm) if r["entity"] == "circuit"]
            total = next(r for r in rows if r["entity"] == "national")
            tests = [t for t in tests if t["kind"] != "national"]
            for i in counts:
                parts = R._sum(groups + state[:1], i)
                R._test(tests, "national", "national", norm["columns"][i]["key"], R._num(total, i)[0], parts)
            if len({tuple(r["values"]) for r in state}) != 1:
                fails.append("the STATE rows print different figures")
        fails += [f"{t['entity']} {t['col']}: printed {t['printed']}, courts add to {t['sum']}" for t in tests if not t["ok"]]
        if not any(t["kind"] == "national" for t in tests) or not any(t["kind"] == "circuit" for t in tests):
            fails.append("no Total or circuit roll-up to check")
        unmatched = [r["label"] for r in rows if r["entity"] not in ("national", "circuit", "district") and r["entity_id"] != "state"]
        if unmatched:
            fails.append(f"row labels that are not courts: {unmatched[:5]}")
    else:
        total = next((r for r in rows if r["entity"] == "national"), None)
        if total is None:
            return ["no Total row"]
        offenses = [r for r in rows if r is not total]
        for key in ("all_applications/number", "warrants/number", "extensions/number"):
            vs = [val(r, key) for r in offenses]
            if any(v is None for v in vs) or val(total, key) != sum(vs):
                fails.append(f"Total {key} {val(total, key)} != offense rows {None if any(v is None for v in vs) else sum(vs)}")
        for r in rows:
            a, w, x = val(r, "all_applications/number"), val(r, "warrants/number"), val(r, "extensions/number")
            if None in (a, w, x) or a != w + x:
                fails.append(f"{r['label']}: all applications {a} != warrants {w} + extensions {x}")
    return fails


def xlsx_second_path(data, norm):
    """[] or mismatches: every stored figure looked up again with openpyxl (row by label in column A, column by position)."""
    import openpyxl

    ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True).worksheets[0]
    by_label = {}
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if isinstance(a, str) and a.strip():
            by_label.setdefault(re.sub(r"\s+", " ", a.strip()), []).append(r)
    bad = []
    for row in norm["rows"]:
        hits = by_label.get(re.sub(r"\s+", " ", row["label_raw"].strip()), [])
        if not hits:
            bad.append(f"row {row['label_raw']!r} not found")
            continue
        for i, c in enumerate(norm["columns"]):
            v = row["values"][i]
            if v is None:
                continue
            cells = [ws.cell(r, c["index"] + 1).value for r in hits]  # utx_parse numbers the sheet's columns from 0
            if not any(isinstance(x, (int, float)) and abs(float(x) - float(v)) < 1e-9 for x in cells):
                bad.append(f"{row['label_raw']} / {c['label']}: stored {v}, sheet {cells}")
    return bad


def unlabelled_rows(data):
    """Sheet rows (1-based) below the first labelled figure row that print figures and no label (openpyxl, read directly)."""
    import openpyxl

    ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True).worksheets[0]
    out, started = [], False
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        figures = [ws.cell(r, c).value for c in range(2, ws.max_column + 1) if isinstance(ws.cell(r, c).value, (int, float))]
        if a not in (None, "") and len(figures) >= 2:
            started = True
        elif started and a in (None, "") and len(figures) >= 2:
            out.append(r)
    return out


def read_dnsw_xlsx(entry):
    """(table, period_end, norm) or (table, period_end, reasons)."""
    table, year = dnsw_xlsx_table(entry), dnsw_year(entry)
    if not table or not year:
        return table, None, ["table number or year not found in the link"]
    end = f"{year}-09-30"
    data = F.read_stored(F.ROOT / entry["path"])
    sheets, _ = P.parse_workbook(data)
    if not sheets:
        return table, end, ["no sheet with data rows"]
    sheet = sheets[0]
    lifted = lift_title(sheet)
    if sheet["period_end_from_title"] != end:
        return table, end, [f"period in title {sheet['period_end_from_title']} differs from the report year {end}"]
    norm = N.normalize(sheet, {"pub": "DNSW", "table": table, "period_end": end, "title": D_TITLES[table]}, hierarchy_mode="indent" if table == "DNSW 2" else None)
    if table == "DNSW 2":
        distinct_labels(norm)
    m = re.match(r"(?:Table )?DNSW[- ]?(?:Table )?(\d)\.?\s*", re.sub(r"^DNSW Table", "DNSW", sheet["title_raw"]))
    if not m or f"DNSW {m.group(1)}" != table:
        return table, end, [f"title does not name {table}: {sheet['title_raw'][:60]!r}"]
    title_text = re.sub(r"^(?:Table )?DNSW[- ]?(?:Table )?\d\.?\s*", "", re.sub(r"^DNSW Table", "DNSW", sheet["title_raw"]))
    phrase, _ = P.parse_period_phrase(title_text)
    norm["notes"] = [n for n in norm["notes"] if not re.fullmatch(r"Page \d+ of \d+", n.strip())]
    norm["printed_table_id"] = table
    norm["title"] = re.sub(r"\s+", " ", title_text.replace(phrase or "\0", "")).strip(" ,") if phrase else title_text
    norm["period_phrase"], norm["months"] = phrase, 12
    norm["title_listing"] = D_TITLES[table]
    renamed = []
    for c in norm["columns"]:
        if c["key"] in D_RENAMED:
            renamed.append(f"{c['label']} ({D_RENAMED[c['key']]})")
            c["key"] = D_RENAMED[c["key"]]
    expected = [k for k, _ in (D1_COLUMNS if table == "DNSW 1" else D2_COLUMNS) if k != "average_delay_in_days"]
    if [c["key"] for c in norm["columns"]] != expected:
        return table, end, [f"columns {[c['key'] for c in norm['columns']]} are not the DNSW columns {expected}"]
    if table == "DNSW 1" and norm["scope"] != "district":
        return table, end, [f"rows read as {norm['scope']}, not district courts"]
    if table == "DNSW 2":
        norm["scope"] = "category"
    unlabelled = unlabelled_rows(data)
    if unlabelled:
        return table, end, [f"figures printed in a row without a label (sheet row {', '.join(map(str, unlabelled))}); that row cannot be stored, "
                            "so the period's rows would not add up to its Total and the period is not used"]
    fails = dnsw_identities(norm, table)
    if fails:
        return table, end, [HELD + "; ".join(fails[:5])]
    second = xlsx_second_path(data, norm)
    if second:
        return table, end, ["second path: " + s for s in second[:5]]
    norm["warnings"] = norm.get("warnings", []) + (["The title is printed in a merged cell over the column headings; it is read as the title."] if lifted else []) + (
        [f"This edition heads these columns differently; they are the same columns as in the later editions: {'; '.join(renamed)}."] if renamed else [])
    return table, end, norm


PCT = re.compile(r"^(\d{1,3})%$")
DASH = {"-", "–", "—", "­"}


def dnsw_pdf_tables(text):
    """{(table, period_end, phrase, months): [lines]} for the Table 1 / 1a / 2 / 2a blocks of a report's pdftotext -layout text."""
    out, current = {}, None
    for line in text.splitlines():
        m = re.match(r"\s*Table (1a|1|2a|2)\.\s+(.*)$", line)
        if m:
            fy = re.search(r"fiscal year (\d{4})|Ending September 30, (\d{4})", m.group(2) + " ", re.I)
            title = m.group(2).strip()
            if not fy:
                current = ("pending", m.group(1), title)
                out[current] = []
                continue
            year = int(fy.group(1) or fy.group(2))
            interim = m.group(1).endswith("a")
            current = (f"DNSW {m.group(1)[0]}", f"{year}-09-30", title, None if interim else 12)
            out.setdefault(current, [])
            continue
        if current and current[0] == "pending":  # the period printed on the title's second line
            fy = re.match(r"\s*(?:.*Ending )?September 30, (\d{4})|.*fiscal year (\d{4})", line, re.I)
            if not fy and line.strip():
                del out[current]  # a title without a period: not one of the tables read here
                current = None
                continue
            if fy:
                _, num, title = current
                del out[current]
                year = int(fy.group(1) or fy.group(2))
                current = (f"DNSW {num[0]}", f"{year}-09-30", f"{title} {line.strip()}", None if num.endswith("a") else 12)
                out.setdefault(current, [])
            continue
        if current:
            if re.match(r"\s*(Graph \d|Table 3)", line):
                current = None
                continue
            out[current].append(line)
    return out


def split_label(line):
    """(label, tokens) of a data line: the label is the text before the first figure or percent or dash."""
    tokens = line.split()
    k = 0
    while k < len(tokens) and not (INTEGER.match(tokens[k]) or PCT.match(tokens[k]) or tokens[k] in DASH):
        k += 1
    return " ".join(tokens[:k]), tokens[k:]


def parse_dnsw1_lines(lines):
    """(columns, rows, header text) of a Table 1 block, or (None, reasons)."""
    header = " ".join(" ".join(l.split()) for l in lines[:12] if l.strip() and not re.match(r"\s*ALL CIRCUITS", l))
    header = header.split("ALL CIRCUITS")[0]
    has_delay = bool(re.search(r"\bdelay\b", header, re.I))
    denied = len(re.findall(r"\bDenied\b", header, re.I))
    if denied not in (0, 2) or not re.search(r"Warrant", header) or not re.search(r"Extension", header):
        return None, [f"Table 1 headings not recognised: {header[:120]!r}"]
    keys = [k for k, _ in D1_COLUMNS if (k != "average_delay_in_days" or has_delay) and (not k.endswith("/denied") or denied)]
    rows, k = [], 0
    for line in lines:
        if not line.strip():
            continue
        label, tokens = split_label(line)
        if not label or not tokens:
            continue
        ent = dnsw_entity(label) or (("other", "state") if " ".join(label.split()).upper() == "STATE" else None)
        if ent is None:
            if re.fullmatch(r"\d+", line.strip()) or "Granted" in line or "requests" in line.lower() or "Days)" in line or re.search(r"\bdelay\b|^\s*\(in\b", line, re.I):
                continue  # a page number or a heading line
            return None, [f"row label not a court: {label!r}"]
        if len(tokens) != len(keys) or not all(INTEGER.match(t) or t in DASH for t in tokens):
            return None, [f"{label}: {len(tokens)} figures where the headings name {len(keys)} columns"]
        k += 1
        rows.append(make_row(k, " ".join(label.split()), ent[0], ent[1], [None if t in DASH else int(t.replace(",", "")) for t in tokens],
                             ["dash" if t in DASH else None for t in tokens]))
    cols = [(key, path, "#,##0") for key, path in D1_COLUMNS if key in keys]
    return (cols, rows, header), None


def parse_dnsw2_lines(lines):
    """(columns, rows, notes) of a Table 2 block, or (None, reasons). A row label wrapped onto the next line ("Fugitive/Supervised" /
    "Release Violation") is joined; "-" in a percent column is printed (the table's note: not shown below 2 percent)."""
    rows, notes, k, pending = [], [], 0, None
    started = ended = False
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if started and (ended or re.match(r"^\*+(?:\s|[A-Z]|$)", s)):
            ended = True  # the notes under the table ("* Percentages not shown ...", "** International Emergency ...")
            if not re.fullmatch(r"\d+", s):
                notes.append(s)
            continue
        label, tokens = split_label(line)
        if not label and (len(tokens) == 1 or all(t in DASH for t in tokens)):
            continue  # a page number, or dashes the text layer sets on a line of their own (the 2007 report): see the note below
        if not started:
            if label.lower().startswith("total") and tokens:
                started = True
            else:
                continue
        if not tokens:
            if rows and pending is None and re.match(r"^\s{2,}\S", line) and not re.fullmatch(r"\d+", s):
                rows[-1]["label"] = rows[-1]["label_raw"] = rows[-1]["path"][0] = f"{rows[-1]['label']} {s}"  # a wrapped label
            continue
        nums, pcts, flags, nflags = [], [], [], []
        seq = list(tokens)
        i = 0
        while i < len(seq):
            t = seq[i]
            if not INTEGER.match(t) and t not in DASH:
                return None, [f"{label}: figure expected, read {t!r}"]
            nums.append(None if t in DASH else int(t.replace(",", "")))
            nflags.append("dash" if t in DASH else None)
            nxt = seq[i + 1] if i + 1 < len(seq) else None
            # after a number a percent or a dash is its percent; a dash is a percent only when the tokens after it still hold the numbers to come
            if nxt is not None and (PCT.match(nxt) or (nxt in DASH and 3 - len(nums) <= len(seq) - i - 2)):
                pcts.append(int(PCT.match(nxt).group(1)) if PCT.match(nxt) else None)
                flags.append("dash" if nxt in DASH else None)
                i += 2
            else:
                pcts.append(None)
                flags.append(None)  # not printed (the note: percentages under 2 percent are not shown)
                i += 1
        if len(nums) != 3:
            return None, [f"{label}: {len(nums)} number columns where the table prints 3"]
        clean = re.sub(r"\*+$", "", " ".join(label.split())).strip()
        marks = ["*" * (len(label.strip()) - len(label.strip().rstrip("*")))] if label.strip().endswith("*") else []
        values = [nums[0], pcts[0], nums[1], pcts[1], nums[2], pcts[2]]
        vflags = [nflags[0], flags[0], nflags[1], flags[1], nflags[2], flags[2]]
        k += 1
        ent = ("national", "national") if clean.lower() == "total" else ("category", None)
        rows.append(make_row(k, clean, ent[0], ent[1], values, vflags, marks))
    for r in rows:
        if r["entity"] == "category":
            r["entity_id"] = P.slug(r["label"])
            r["path"] = ["Total", r["label"]]
            r["indent"] = 1
        else:
            r["path"] = ["Total"]
    cols = [(key, path, "0%" if key.endswith("percent") else "#,##0") for key, path in D2_COLUMNS]
    return (cols, rows, notes), None


def pdf_second_path(data, rows):
    """[] or mismatches: each row's figures found again, in order, on a pdfplumber line that starts with the row's label (or with
    the first line of a label printed over two lines)."""
    lines = [line for page in pdf_word_lines(data) for line in page]
    bad = []
    for r in rows:
        want = [t for t, f in zip(r["values"], r["flags"]) if t is not None or f == "dash"]
        found = False
        for line in lines:
            k = 0
            while k < len(line) and not (INTEGER.match(line[k]["text"]) or PCT.match(line[k]["text"]) or line[k]["text"] in DASH):
                k += 1
            head = label_key(" ".join(w["text"] for w in line[:k]))
            whole = label_key(r["label"])
            if not head or not (head == whole or (whole.startswith(head) and len(head) >= 6)):
                continue
            figs = [w["text"] for w in line[k:]]
            got = []
            for t in figs:
                if INTEGER.match(t):
                    got.append(int(t.replace(",", "")))
                elif PCT.match(t):
                    got.append(int(PCT.match(t).group(1)))
                elif t in DASH:
                    got.append(None)
            if [v for v in got if v is not None] == [v for v in want if v is not None]:
                found = True
                break
        if not found:
            bad.append(f"{r['label']}: figures {want} not found on a line of the other text extraction")
    return bad


def read_dnsw_pdf(entry):
    """[(table, period_end, norm or reasons)] for one report PDF."""
    data = F.read_stored(F.ROOT / entry["path"])
    text = pdf_layout(data)
    if len(re.sub(r"\s+", "", text)) < 500:
        why = ["the PDF has no text layer (a scanned report); its figures cannot be read exactly"]
        return [("DNSW 1", f"{dnsw_year(entry)}-09-30", why), ("DNSW 2", f"{dnsw_year(entry)}-09-30", why)]
    out = []
    for (table, end, title, months), lines in dnsw_pdf_tables(text).items():
        if table == "pending":
            continue
        if table == "DNSW 1":
            parsed, why = parse_dnsw1_lines(lines)
        else:
            parsed, why = parse_dnsw2_lines(lines)
        if parsed is None:
            out.append((table, end, why))
            continue
        cols, rows, extra = parsed
        notes = extra if table == "DNSW 2" else []
        phrase = re.search(r"(fiscal year \d{4}|for 12-Month Period Ending September 30, \d{4}|12-Month Period Ending September 30, \d{4})", title, re.I)
        interim = months is None
        norm = make_norm(pub="DNSW", table=table, period_end=end, title=D_TITLES[table], title_listing=D_TITLES[table],
                         phrase=("Interim period (March 2006 through September 2006)" if interim else (phrase.group(1) if phrase else None)),
                         months=months, scope="district" if table == "DNSW 1" else "category", columns=cols, rows=rows, notes=notes,
                         printed_id=table + ("a" if interim else ""), sheet=f"PDF {title[:80]}",
                         warnings_=[f"Read from the report PDF (Table {table[-1]}{'a' if interim else ''}: {title}); column names follow the spreadsheet editions."] + (
                             ["Interim period: reports filed from March 2006, when the reporting requirement was enacted, through September 2006 "
                              "(printed in the fiscal year 2007 report); not a full fiscal year."] if interim else []) + (
                             ["This edition prints no Denied columns."] if table == "DNSW 1" and not any(c[0].endswith("/denied") for c in cols) else []))
        fails = dnsw_identities(norm, table)
        if fails:
            out.append((table, end, [HELD + "; ".join(fails[:5])]))
            continue
        second = pdf_second_path(data, rows)
        if second:
            out.append((table, end, ["second path: " + s for s in second[:5]]))
            continue
        out.append((table, end, norm))
    return out


# ------------------------------------------------------------------------------------------------------------ FISC

# the rows of Table 1, labelled as printed (sections of title 50 of the U.S. Code)
FISC_SECTIONS = ["1805 only", "1824 only", "1805 and 1824", "1842", "1861", "1881a", "1881b", "1881c"]
FISC_COLUMNS = [("applications_or_certifications", ["Applications or Certifications"]), ("orders_granted", ["Orders Granted"]),
                ("orders_modified", ["Orders Modified"]), ("orders_denied_in_part", ["Orders Denied in Part"]),
                ("applications_or_certifications_denied", ["Applications or Certifications Denied"])]
FISC_TITLE = "Foreign Intelligence Surveillance Court - Applications or Certifications and the Court's Orders, by Section of 50 U.S.C."
FISC_SUMMARY = {
    "applications_or_certifications": r"received ([\w,-]+) applications",
    "orders_granted": r"([\w,-]+) orders were granted",
    "orders_modified": r"([\w,-]+) orders were modified",
    "orders_denied_in_part": r"([\w,-]+) orders were denied in part",
    "applications_or_certifications_denied": r"([\w,-]+) applications? (?:was|were) denied",
}
MARK_CHARS = set("*†‡§")


def fisc_summary(flat):
    """{column key: total stated in the Summary of Findings}, the summary text, the period phrase."""
    m = re.search(r"Summary of Findings (.*?)(?:Explanation of Selected Terms|$)", flat)
    if not m:
        return None, None, None
    text = m.group(1)
    totals = {}
    for key, pat in FISC_SUMMARY.items():
        hit = re.search(pat, text, re.I)
        if hit:
            n = count_of(hit.group(1))
            if n is not None:
                totals[key] = n
    period = re.search(r"From (\w+ \d{1,2}, \d{4}), to (\w+ \d{1,2}, \d{4})", text)
    return totals, text.strip(), (period.group(0) if period else None)


def label_length(line):
    """How many words of a Table 1 line are its section label: "1842", "1805 only", "1805 and 1824" (and a mark glued to it)."""
    n = 1
    if len(line) > 1 and line[1]["text"] in ("only", "and"):
        n = 2
        if line[1]["text"] == "and" and len(line) > 2 and re.fullmatch(r"1824\S*", line[2]["text"]):
            n = 3
    return n


def fisc_table(data):
    """(columns present, {section: (values, marks)}, page words) read from the page that prints Table 1, or (None, reason)."""
    for page in pdf_word_lines(data):
        texts = [" ".join(w["text"] for w in line) for line in page]
        if not any(t.strip() == "Table 1" for t in texts) or not any(t.startswith("1842") for t in texts):
            continue
        body = [w for line in page for w in line]
        big = sorted({round(w["size"], 1) for w in body}, key=lambda s: -sum(1 for w in body if round(w["size"], 1) == s))[0]
        start = next(i for i, t in enumerate(texts) if t.strip() == "Table 1")
        head = " ".join(texts[start:start + 14])
        five = bool(re.search(r"Denied\s+in\s+Part|Denied in|in Part", head))
        rows, data_lines = {}, []
        # the table runs from the "1805 only" row to the "1881c" row (footnotes below it may start with a section number too)
        first_row = next((i for i in range(start, len(page)) if [w["text"] for w in page[i][:2]] == ["1805", "only"]), None)
        last_row = next((i for i in range(first_row or start, len(page)) if re.fullmatch(r"1881c\S*", page[i][0]["text"])), None)
        if first_row is None or last_row is None:
            return None, "the rows 1805 only ... 1881c are not printed"
        for i in range(first_row, last_row + 1):
            line = page[i]
            first = line[0]["text"]
            if re.fullmatch(r"18(05|24|42|61|81[abc])\S*", first) and line[0]["size"] >= big - 0.5:
                prev = [w["text"] for w in page[i - 1][:2]] if i else []
                if re.fullmatch(r"1824\S*", first) and prev == ["1805", "and"] and \
                        not any(re.fullmatch(r"[\d,]+", w["text"]) and w["size"] >= big - 0.5 for w in line[1:]):
                    continue  # "1824" of the label "1805 and 1824" printed on its own line
                data_lines.append(i)
        figures = []
        for i in data_lines:
            for w in page[i][label_length(page[i]):]:
                if re.fullmatch(r"[\d,]+[*†‡§]*", w["text"]) and w["size"] >= big - 0.5:
                    figures.append(w)
        ncols = 5 if five else 4
        centres = None
        for ref in ("x0", "x1", "mid"):
            xs = sorted((w[ref] if ref != "mid" else (w["x0"] + w["x1"]) / 2) for w in figures)
            groups = [[xs[0]]] if xs else []
            for x in xs[1:]:
                if x - groups[-1][-1] > 18:
                    groups.append([x])
                else:
                    groups[-1].append(x)
            if len(groups) == ncols and max(g[-1] - g[0] for g in groups) <= 6:
                centres = (ref, [sum(g) / len(g) for g in groups])
                break
        if centres is None:
            return None, f"the figures do not line up in {ncols} columns"
        ref, cs = centres
        for i in data_lines:
            line = page[i]
            label_words = [line[0]["text"]]
            rest = line[1:]
            if rest and rest[0]["text"] in ("only", "and"):
                label_words.append(rest[0]["text"])
                rest = rest[1:]
            label = " ".join(label_words)
            glued_mark = None
            m = re.fullmatch(r"(18(?:05|24|42|61|81[abc]))(\S*)", label_words[0])
            if m and m.group(2):
                glued_mark = m.group(2)
                label_words[0] = m.group(1)
                label = " ".join(label_words)
            if label == "1805 and":
                nxt = page[i + 1] if i + 1 < len(page) else []
                if nxt and re.fullmatch(r"1824\S*", nxt[0]["text"]):
                    label = "1805 and 1824"
                    if len(nxt[0]["text"]) > 4:
                        glued_mark = nxt[0]["text"][4:]
                    rest = rest + [w for w in nxt[1:]]
                elif rest and re.fullmatch(r"1824\S*", rest[0]["text"]):
                    label = "1805 and 1824"
                    if len(rest[0]["text"]) > 4:
                        glued_mark = rest[0]["text"][4:]
                    rest = rest[1:]
            if label not in FISC_SECTIONS:
                return None, f"row label not a section of the statute: {label!r}"
            values, marks, flags = [None] * ncols, [], [None] * ncols
            for w in rest:
                t = w["text"]
                x = w[ref] if ref != "mid" else (w["x0"] + w["x1"]) / 2
                if w["size"] < big - 0.5 or set(t) <= MARK_CHARS:
                    marks.append(t)
                    continue
                fig = re.fullmatch(r"([\d,]+)([*†‡§]*)", t)
                if fig:
                    j = min(range(ncols), key=lambda j: abs(cs[j] - x))
                    if abs(cs[j] - x) > 12 or values[j] is not None:
                        return None, f"{label}: figure {t} at x {x:.0f} is not under one column"
                    values[j] = int(fig.group(1).replace(",", ""))
                    if fig.group(2):
                        marks.append(fig.group(2))
                else:
                    j = min(range(ncols), key=lambda j: abs(cs[j] - x))
                    flags[j] = (flags[j] or "text:") + t + " "
            if glued_mark:
                marks.append(glued_mark)
            rows[label] = (values, [f.strip() if f else None for f in flags], marks)
        # the classified or pending cells the page leaves blank stay gaps; their notes are in the report text
        return (ncols, rows), None
    return None, "no page prints Table 1"


def poppler_lines(data):
    """[[(text, x0, height)]] lines of every page from pdftotext -bbox (poppler: a text extraction independent of pdfplumber)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(data)
        handle.flush()
        html = subprocess.run(["pdftotext", "-bbox", handle.name, "-"], capture_output=True, text=True, check=True).stdout
    out = []
    for page in html.split("<page ")[1:]:
        words = [(unescape(t), float(x0), float(y0), float(y1)) for x0, y0, x1, y1, t in
                 re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', page)]
        lines = []
        for w in sorted(words, key=lambda w: (w[3], w[1])):
            for line in lines[-3:]:
                if abs(line[0][3] - w[3]) <= 3.5:  # same baseline (yMax); a raised footnote mark sits higher and is shorter
                    line.append(w)
                    break
            else:
                lines.append([w])
        for line in lines:
            hs = sorted(w[3] - w[2] for w in line)
            h = hs[len(hs) // 2]
            out.append([(t, x0, (y1 - y0) / h if h else 1.0) for t, x0, y0, y1 in sorted(line, key=lambda w: w[1])])
    return out


def fisc_second_path(data, rows):
    """[] or mismatches: each section's figures found again with poppler's word boxes, in order, on the line that starts with the
    section's label (footnote marks, printed smaller, left out)."""
    lines = poppler_lines(data)
    bad = []
    for label, (values, flags, marks) in rows.items():
        want = [v for v in values if v is not None]
        head = label.split(" ")
        found = False
        for toks in lines:
            texts = [t for t, _, _ in toks]
            n = len(head) if label != "1805 and 1824" else 2
            if [re.sub(r"[*†‡§]+$", "", t) for t in texts[:n]] != head[:n] and not (len(head) == 1 and texts and re.fullmatch(re.escape(head[0]) + r"\d?[*†‡§]*", texts[0])):
                continue
            rest = toks[n:]
            if label == "1805 and 1824" and rest and re.fullmatch(r"1824\S*", rest[0][0]):
                rest = rest[1:]
            got = []
            for t, _, rel in rest:
                m = re.fullmatch(r"([\d,]+)[*†‡§]*", t)
                if m and rel >= 0.8:
                    got.append(int(m.group(1).replace(",", "")))
            if got == want:
                found = True
                break
        if not found:
            bad.append(f"{label}: {want} not found in the other text extraction")
    return bad


def fisc_notes(flat):
    """The table's footnotes as printed: the text between the last section row (1881c) and the next heading, split at its marks."""
    m = re.search(r"\b1881c\b(?: [\d,]+)*(.*?)(?:Amicus Curiae|Explanation of Selected Terms|$)", flat)
    if not m:
        return []
    segment = m.group(1).strip()
    parts = [p.strip() for p in re.split(r"\s(?=(?:[*†‡]|\d) +[A-Z])", " " + segment) if p.strip()]
    return [p[:600] for p in parts if re.match(r"(?:[*†‡]|\d) +[A-Z]", p)][:6]


def read_fisc(entry):
    data = F.read_stored(F.ROOT / entry["path"])
    text = pdf_layout(data)
    flat = " ".join(text.split())
    year_m = re.search(r"Courts for (\d{4})", entry["link_text"]) or re.search(r"Activities of the Foreign Intelligence Surveillance Courts? for (\d{4})", flat, re.I)
    if not year_m:
        return None, None, ["report year not found"]
    year = int(year_m.group(1))
    end = f"{year}-12-31"
    totals, summary, period = fisc_summary(flat)
    if not totals:
        return end, None, ["no Summary of Findings with totals"]
    table, why = fisc_table(data)
    if table is None:
        return end, None, [why]
    ncols, rows = table
    cols = FISC_COLUMNS if ncols == 5 else [c for c in FISC_COLUMNS if c[0] != "orders_denied_in_part"]
    keys = [k for k, _ in cols]
    fails = []
    for j, key in enumerate(keys):
        if key not in totals:
            fails.append(f"the Summary of Findings states no total for {key}")
            continue
        s = sum(v[j] for v, _, _ in rows.values() if v[j] is not None)
        if s != totals[key]:
            fails.append(f"{key}: the sections add to {s}, the Summary of Findings states {totals[key]}")
    if len(rows) != len(FISC_SECTIONS):
        fails.append(f"{len(rows)} sections read, the table prints {len(FISC_SECTIONS)}")
    if fails:
        return end, None, [HELD + "; ".join(fails)]
    second = fisc_second_path(data, rows)
    if second:
        return end, None, ["second path: " + s for s in second]
    out_rows = [make_row(0, "Total (Summary of Findings)", "national", "national", [totals[k] for k in keys])]
    out_rows[0]["path"] = ["Total"]
    for k, label in enumerate(FISC_SECTIONS, start=1):
        values, flags, marks = rows[label]
        r = make_row(k, label, "category", P.slug(label), values, flags, marks)
        r["path"], r["indent"] = ["Total", label], 1
        out_rows.append(r)
    notes = fisc_notes(flat)
    blanks = [f"{label}: {c[1][0]}" for label in FISC_SECTIONS for j, c in enumerate(cols) if rows[label][0][j] is None and not rows[label][1][j]]
    norm = make_norm(pub="FISC", table="FISC 1", period_end=end, title=FISC_TITLE, title_listing=FISC_TITLE,
                     phrase=period or f"Calendar year {year}", months=None if period else 12, scope="category",
                     columns=[(k, path, "#,##0") for k, path in cols], rows=out_rows, notes=notes[:6], printed_id="Table 1",
                     sheet=f"PDF Table 1 ({year})",
                     warnings_=["The Total row is the totals the report states in its Summary of Findings; the table itself prints no Total row. "
                                "Every column of the table adds up to it."] + (
                         [f"This report covers {period} (the first report after the USA FREEDOM Act), not a full calendar year."] if period else []) + (
                         [f"Cells the table leaves blank (a number the Department of Justice advised is classified, or not yet final): {'; '.join(blanks)}."] if blanks else []) + (
                         ["This report prints no Orders Denied in Part column (partial denials are reported separately from 2016)."] if ncols == 4 else []))
    norm["summary_text"] = summary[:1500]
    return end, norm, None


# ------------------------------------------------------------------------------------------------------------ CVRA

CVRA_PATTERNS = [
    # 2023-2024: "4 mandamus actions in appellate courts were identified ... and 10 district court cases were identified"
    (r"(\w+(?:-\w+)?) mandamus actions? in appellate courts (?:was|were) identified as brought per the provisions of the CVRA and (\w+(?:-\w+)?) district court cases? (?:was|were) identified",
     ("mandamus_actions", "district_court_cases")),
    # 2016-2022: "on four mandamus actions ... and identified one appellate court case and six district court cases"
    (r"on (\w+(?:-\w+)?) mandamus actions? brought per the provisions of the (?:CVRA|Act) and (?:has similarly )?identified (\w+(?:-\w+)?) appellate court cases? and (\w+(?:-\w+)?) district court cases?",
     ("mandamus_actions", "appellate_court_cases", "district_court_cases")),
    # 2007-2022: "on 10 mandamus actions ... and has similarly identified 12 district court cases"
    (r"on (\w+(?:-\w+)?) mandamus actions? brought per the provisions of the (?:CVRA|Act) and (?:has similarly )?identified (\w+(?:-\w+)?) district court cases?",
     ("mandamus_actions", "district_court_cases")),
    # 2006: "on seven mandamus actions brought per the provisions of the Act"
    (r"reports from the courts on (\w+(?:-\w+)?) mandamus actions? brought per the provisions of the Act", ("mandamus_actions",)),
    # 2005: "the denial of relief under the Act in one case and mandamus actions brought pursuant to the Act in two additional cases"
    (r"reported the denial of relief under the Act in (\w+) cases? and mandamus actions brought pursuant to the Act in (\w+) additional cases?",
     ("cases_with_relief_denied", "mandamus_actions")),
]
CVRA_FIELDS = {"mandamus_actions": "Mandamus actions", "appellate_court_cases": "Appellate court cases", "district_court_cases": "District court cases",
               "cases_with_relief_denied": "Cases in which relief was denied"}


def cvra_counts(flat):
    """(counts, sentence) from a report's opening paragraph; ({}, None) when no known sentence form is printed."""
    for pat, fields in CVRA_PATTERNS:
        m = re.search(pat, flat)
        if not m:
            continue
        counts = {f: count_of(m.group(i + 1)) for i, f in enumerate(fields)}
        if any(v is None for v in counts.values()):
            continue
        start = flat.rfind(". ", 0, m.start()) + 2
        end = flat.find(".", m.end())
        return counts, flat[max(0, start):end + 1].strip()
    return {}, None


def read_cvra(entry):
    data = F.read_stored(F.ROOT / entry["path"])
    flat = " ".join(pdf_layout(data).split())
    year = int(re.search(r"(\d{4})", entry["link_text"]).group(1))
    counts, sentence = cvra_counts(flat)
    period = re.search(r"During fiscal year \d{4}|In the past year|Last year", flat)
    return {"year": year, "counts": counts, "sentence": sentence, "period": period.group(0) if period else None,
            "title": f"Crime Victims' Rights Report {year}", "words": len(flat.split())}


def cvra_record(entry, info):
    year, counts = info["year"], info["counts"]
    cells = {"year": str(year), "title": info["title"], **{k: counts.get(k) for k in CVRA_FIELDS}}
    facts = [["Report", info["title"]], ["Publisher", "Administrative Office of the U.S. Courts"],
             ["Reporting period as printed", info["period"] or "Not stated"],
             ["Counts as printed", info["sentence"] or "The report states no count in a form this reader reads; see the report."]]
    facts += [[label, str(counts[k])] for k, label in CVRA_FIELDS.items() if counts.get(k) is not None]
    facts += [["File", entry["url"]], ["sha256", entry["sha256"]]]
    sub = ", ".join(f"{counts[k]} {CVRA_FIELDS[k].lower()}" for k in CVRA_FIELDS if counts.get(k) is not None) or "Counts not stated in a standard sentence"
    return cw.record(CVRA_DATASET, f"cvra:{year}", info["title"], source_url=entry["page"], cells=cells, facts=facts,
                     text=f"Crime Victims' Rights Act report {year} mandamus {info['sentence'] or ''}", filters={"year": [str(year)]}, subtitle=sub,
                     links=[{"url": entry["url"], "label": "Report (PDF)"}, {"url": entry["page"], "label": "U.S. Courts report page"}],
                     extra={"cvra": {"v": 1, "year": year, "counts": counts, "sentence": info["sentence"], "period": info["period"],
                                     "src": {"pub": "CVRA", "publisher": "Administrative Office of the U.S. Courts", "document": info["title"],
                                             "page": entry["page"], "url": entry["url"], "sha256": entry["sha256"], "retrieved": entry.get("retrieved_at")}}})


def cvra_build(records, inputs):
    rows = sorted(records, key=lambda r: r["id"])
    cols = [("year", "Year"), ("title", "Report"), ("mandamus_actions", "Mandamus actions"), ("appellate_court_cases", "Appellate court cases"),
            ("district_court_cases", "District court cases")]
    summary = {
        "source": f"Administrative Office of the U.S. Courts: Crime Victims' Rights reports to Congress ({PAGES['CVRA']})",
        "records": len(rows), "first_year": rows[0]["item"]["cells"]["year"] if rows else None, "last_year": rows[-1]["item"]["cells"]["year"] if rows else None,
        "rules": [
            "The reports print no tables. Each report's opening paragraph states how many mandamus actions (and, in some years, appellate and "
            "district court cases) it summarises; those counts are read from that sentence, which every record keeps as printed.",
            "Counts printed in words ('four', 'Twenty') are converted to numbers; a report whose sentence is in no known form keeps the "
            "sentence-less record and no counts (not zero).",
            "Different years count different things (the 2005 report counts cases with relief denied; from 2016 some reports also count "
            "appellate court cases): a count is only what that year's sentence states.",
        ],
        "published_by": "enrich/publish_build",
    }
    return {"dataset": CVRA_DATASET, "label": "Crime Victims' Rights Act reports - counts stated in each annual report to Congress (U.S. Courts)",
            "listing_block": cw.listing(cols, filters=[]), "summary": summary, "rows": rows,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inputs": inputs}


# ------------------------------------------------------------------------------------------------------------ main

def retrieved_at(index_entry):
    for e in reversed(F.manifest_entries()):
        if e.get("url") == index_entry["url"] and e.get("sha256") == index_entry.get("sha256"):
            return e.get("retrieved_at")
    return None


def main():
    index = json.loads((F.ACQ / "reports_index.json").read_text())
    report = {"version": REPORTS_VERSION, "written": [], "not_read": {}, "cvra": []}
    cvra_records, cvra_inputs = [], []
    for url, entry in sorted(index.items()):
        if entry.get("status") != 200 or not entry.get("path"):
            report["not_read"][url] = f"not acquired (HTTP {entry.get('status')})"
            continue
        entry = {**entry, "retrieved_at": retrieved_at(entry)}
        if entry["pub"] == "DNSW" and entry["format"] == "xlsx":
            table, end, result = read_dnsw_xlsx(entry)
            results = [(table, end, result)]
        elif entry["pub"] == "DNSW" and entry["format"] == "pdf":
            results = read_dnsw_pdf(entry)
        elif entry["pub"] == "FISC":
            end, norm, why = read_fisc(entry)
            results = [("FISC 1", end, norm if norm is not None else why)]
        elif entry["pub"] == "CVRA":
            info = read_cvra(entry)
            cvra_records.append(cvra_record(entry, info))
            cvra_inputs.append({"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]})
            report["cvra"].append({"year": info["year"], "counts": info["counts"], "sentence": info["sentence"], "url": url})
            continue
        else:
            report["not_read"][url] = f"format {entry['format']} is not read"
            continue
        for table, end, result in results:
            if isinstance(result, dict):
                target = PARSED / entry["pub"] / end / (N.table_slug(table) + ".json.gz")
                if target.exists():
                    have = json.loads(gzip.decompress(target.read_bytes()))
                    if have["source"]["sha256"] != entry["sha256"] and have.get("parser_version") == REPORTS_VERSION:
                        # two files print the same table and period (the spreadsheet and the report PDF): the spreadsheet is kept
                        if entry["format"] == "pdf":
                            report["not_read"][f"{url}#{table}"] = f"{table} {end} is also published as a spreadsheet; the spreadsheet is used"
                            continue
                write_doc(entry["pub"], end, table, entry, result, f"reports_{entry['pub'].lower()}")
                report["written"].append({"pub": entry["pub"], "table": table, "period_end": end, "url": url, "rows": len(result["rows"]),
                                          "format": entry["format"]})
            else:
                report["not_read"][f"{url}#{table}"] = "; ".join(result)
    builds = BUILD / f"{CVRA_DATASET}.json.gz"
    builds.write_bytes(gzip.compress(json.dumps(cvra_build(cvra_records, cvra_inputs), sort_keys=True).encode(), compresslevel=9, mtime=0))
    (BUILD / "reports_report.json").write_text(json.dumps(report, indent=1, sort_keys=True))
    print(json.dumps({"written": len(report["written"]), "not_read": len(report["not_read"]), "cvra": len(cvra_records)}))
    for k, v in sorted(report["not_read"].items()):
        print("  not read", k, "|", v[:220])


if __name__ == "__main__":
    main()
