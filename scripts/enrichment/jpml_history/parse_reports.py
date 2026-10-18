"""Parsers for the JPML CM/ECF "MDL Statistics Report" PDFs (monthly pending-MDL reports).

Text comes from `pdftotext -layout`. Every parser returns only values printed in the report; lines that look like
data rows but do not parse are returned in `unparsed` so validation can fail the report instead of guessing.

Report types (title line "MDL Statistics Report - ..."):
  actions_pending  Distribution of Pending MDL Dockets by Actions Pending
  district         Distribution of Pending MDL Dockets by District
  mdl_number       Distribution of Pending MDL Dockets by MDL Number (layout checked at parse time)
  mdl_type         Docket Type Summary / Distribution of Pending MDL Dockets by MDL Type
  terminated       Recently terminated MDLs (not parsed into the pending series)
"""
import re
import subprocess
from datetime import date
from pathlib import Path

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def pdftotext(path: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout


def to_int(token: str):
    t = token.strip()
    if re.fullmatch(r"\d{1,3}(?:,\d{3})+|\d+", t):
        return int(t.replace(",", ""))
    return None


# ---------------------------------------------------------------- report identity

RE_REPORT_DATE = re.compile(r"Report Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})")
RE_TITLE = re.compile(r"MDL Statistics Report\s*-\s*(.+?)\s*$", re.M)
RE_FILE_DATE = re.compile(r"-(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Febraury|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)-(\d{1,2})-(\d{4})(?:_\d+)?\.pdf$", re.I)


def report_date(text: str):
    m = RE_REPORT_DATE.search(text)
    return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat() if m else None


def report_title(text: str):
    m = RE_TITLE.search(text)
    return " ".join(m.group(1).split()) if m else None


def report_type_from_title(title: str | None):
    t = (title or "").lower()
    if "actions pending" in t:
        return "actions_pending"
    if "by district" in t:
        return "district"
    if "mdl number" in t or "by docket number" in t or "docket summary listing" in t:
        return "mdl_number"
    if "type" in t:
        return "mdl_type"
    if "terminat" in t:
        return "terminated"
    return None


def report_type_from_url(url: str):
    u = url.lower()
    if "terminated" in u:
        return "terminated"
    if "actions_pending" in u:
        return "actions_pending"
    if "by_district" in u:
        return "district"
    if "mdl_number" in u:
        return "mdl_number"
    if "type" in u:
        return "mdl_type"
    return None


def date_from_filename(name: str):
    m = RE_FILE_DATE.search(name)
    if not m:
        return None
    word = m.group(1).lower()
    fixes = {"febraury": "february", "sept": "september"}
    word = fixes.get(word, word)
    month = next((i for i, full in enumerate(MONTHS, 1) if full.startswith(word[:3])), None)
    return date(int(m.group(3)), month, int(m.group(2))).isoformat() if month else None


# ---------------------------------------------------------------- pending rows (actions pending / district / number)

# "NJ   Michael A. Shipp (U.S. District Judge)   MDL -2738 IN RE: ... Litigation   67,670   69,340"
# The judge cell may be empty on the MDL line when an MDL has an even number of judges (see parse_pending_report).
RE_ROW = re.compile(
    r"^(?P<lead>\s*)(?:(?P<district>[A-Z]{2,4})\s{2,})?(?:(?P<judge>[A-Z][^()]*?)\s+\((?P<jtitle>[^()]+)\)\s+)?"
    r"MDL\s*-\s*(?P<mdl>\d{1,5})\s+(?P<title>\S.*?)\s+(?P<pending>\d{1,3}(?:,\d{3})+|\d+)\s+(?P<total>\d{1,3}(?:,\d{3})+|\d+)\s*$"
)
# A line holding only a judge cell: "                  James V. Selna (Sr. District Judge)"
RE_JUDGE_ONLY = re.compile(r"^\s*(?:(?P<district>[A-Z]{2,4})\s{2,})?(?P<judge>[A-Z][^()]*?)\s+\((?P<jtitle>[^()]+)\)\s*$")
RE_MDL_TOKEN = re.compile(r"MDL\s*-\s*\d{1,5}\b")
RE_TOTALS = re.compile(r"Report Totals:\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d[\d,]*)")
RE_N_DOCKETS = re.compile(r"Total Number of MDL Dockets:\s*(\d[\d,]*)")
RE_N_DISTRICTS = re.compile(r"Total Number of Transferee Districts:\s*(\d[\d,]*)")
RE_N_JUDGES = re.compile(r"Total Number of Transferee Judges:\s*(\d[\d,]*)")
RE_JUDGE_TITLE_COUNT = re.compile(r"^\s*(\d+)\s+([A-Z][A-Za-z.,' ]+?)\s*$")
RE_BUCKET = re.compile(
    r"^\s*(\d[\d,]*)\s+MDLs with (?:between )?([\d,]+) (?:and|to) ([\d,]+) (Pending )?Actions\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s*$"
)
RE_BUCKET_TOP = re.compile(r"^\s*(\d[\d,]*)\s+MDLs with ([\d,]+) or more (Pending )?Actions\s+([\d.]+)%\s+([\d,]+)\s+([\d.]+)%\s*$")


def parse_pending_report(text: str) -> dict:
    """Rows plus printed totals for the three row-per-MDL report layouts.

    A blank district cell repeats the district of the row above (the report suppresses repeated values); the
    printed cell is kept as `district_printed` ('' when blank) beside the carried `district`.

    Several judges: the judge cell is vertically centred on the MDL line, so an MDL with k judges prints
    floor(k/2) judge-only lines above the MDL line, floor(k/2) below, and the middle judge on the MDL line when k
    is odd. Judge-only lines between two MDL lines are split accordingly (the rows above take as many lines below
    as they had above); any judge-only line that cannot be assigned this way is reported as unparsed.
    """
    rows, unparsed = [], []
    current_district = None
    lines = text.splitlines()
    totals_at = None
    seq = []  # ("J", judge dict, line no) | ("R", row dict, line no)
    for i, raw in enumerate(lines):
        if RE_TOTALS.search(raw):
            totals_at = i
            break
        m = RE_ROW.match(raw)
        if m:
            printed = m.group("district") or ""
            if printed:
                current_district = printed
            row = {
                "mdl": int(m.group("mdl")),
                "title": " ".join(m.group("title").split()),
                "judges": [],
                "district_printed": printed,
                "district": printed or current_district,
                "pending": to_int(m.group("pending")),
                "total": to_int(m.group("total")),
                "line": i + 1,
                "_inline": {"name": " ".join(m.group("judge").split()), "title": " ".join(m.group("jtitle").split())} if m.group("judge") else None,
            }
            rows.append(row)
            seq.append(("R", row, i + 1))
            continue
        j = RE_JUDGE_ONLY.match(raw)
        if j and "judge" not in j.group("jtitle").lower():
            j = None  # e.g. the wrapped column header "Pending (Historical)"; every printed judicial title has "Judge"
        if j and not j.group("district"):
            seq.append(("J", {"name": " ".join(j.group("judge").split()), "title": " ".join(j.group("jtitle").split())}, i + 1))
        elif RE_MDL_TOKEN.search(raw) or (j and j.group("district")):
            unparsed.append({"line": i + 1, "text": " ".join(raw.split())[:240]})
    # assign judge-only lines by the centring rule
    pending_above, prev_row, need_below = [], None, 0
    for kind, obj, line_no in seq:
        if kind == "J":
            if prev_row is not None and need_below > 0:
                prev_row["_below"].append(obj)
                need_below -= 1
            else:
                pending_above.append(obj)
            continue
        if prev_row is not None and need_below > 0:
            unparsed.append({"line": prev_row["line"], "text": f"MDL -{prev_row['mdl']}: {need_below} judge line(s) expected below were not found"})
        obj["_above"], obj["_below"] = pending_above, []
        need_below = len(pending_above)
        pending_above, prev_row = [], obj
    if prev_row is not None and need_below > 0:
        unparsed.append({"line": prev_row["line"], "text": f"MDL -{prev_row['mdl']}: {need_below} judge line(s) expected below were not found"})
    for orphan in pending_above:
        unparsed.append({"line": None, "text": f"judge line not attached to an MDL row: {orphan['name']}"})
    for r in rows:
        judges = list(r.pop("_above", [])) + ([r["_inline"]] if r["_inline"] else []) + list(r.pop("_below", []))
        r.pop("_inline")
        if not judges:
            unparsed.append({"line": r["line"], "text": f"MDL -{r['mdl']}: no judge printed"})
        r["judges"] = judges
        r["judge"] = " / ".join(x["name"] for x in judges) if judges else None
        r["judge_title"] = " / ".join(x["title"] for x in judges) if judges else None
    tail = "\n".join(lines[totals_at:]) if totals_at is not None else ""
    printed = {"dockets": None, "pending": None, "total": None, "districts": None, "judges": None, "judge_titles": {}, "buckets_pending": [], "buckets_total": []}
    t = RE_TOTALS.search(tail)
    if t:
        printed["dockets"], printed["pending"], printed["total"] = (to_int(x) for x in t.groups())
    for key, rx in (("dockets_line", RE_N_DOCKETS), ("districts", RE_N_DISTRICTS), ("judges", RE_N_JUDGES)):
        mm = rx.search(tail)
        printed[key] = to_int(mm.group(1)) if mm else None
    # judge-title breakdown: the lines after "Total Number of Transferee Judges" up to the "All Counts" note
    jm = RE_N_JUDGES.search(tail)
    if jm:
        for line in tail[jm.end():].splitlines():
            if "All Counts Are Based" in line or "Range of the Number" in line:
                break
            c = RE_JUDGE_TITLE_COUNT.match(line)
            if c and "Total" not in c.group(2):
                printed["judge_titles"][c.group(2).strip()] = int(c.group(1))
    section = None
    for line in tail.splitlines():
        if "Actions PENDING in a Docket" in line:
            section = "buckets_pending"
        elif "TOTAL Actions in a Docket" in line:
            section = "buckets_total"
        if not section:
            continue
        b = RE_BUCKET.match(line)
        if b:
            printed[section].append({"dockets": to_int(b.group(1)), "low": to_int(b.group(2)), "high": to_int(b.group(3)), "pct_dockets": float(b.group(5)), "actions": to_int(b.group(6)), "pct_actions": float(b.group(7))})
            continue
        b = RE_BUCKET_TOP.match(line)
        if b:
            printed[section].append({"dockets": to_int(b.group(1)), "low": to_int(b.group(2)), "high": None, "pct_dockets": float(b.group(4)), "actions": to_int(b.group(5)), "pct_actions": float(b.group(6))})
    return {"rows": rows, "unparsed": unparsed, "printed": printed}


# ---------------------------------------------------------------- docket type summary

KNOWN_TYPES = {
    "Air Disaster", "Antitrust", "Common Disaster", "Contract", "Employment Practices", "Intellectual Property",
    "Miscellaneous", "Products Liability", "Sales Practices", "Securities", "Data Breach and Consumer Privacy",
}
RE_TYPE_HEAD = re.compile(r"^\s{0,6}([A-Z][A-Za-z ]+?)\s*$")
RE_TYPE_COUNT = re.compile(r"Number of (.+?) Litigations Listed:\s*(\d+)")
RE_TYPE_TOTAL = re.compile(r"MDLs Listed on this Report:\s*(\d+)")
RE_TYPE_ROW = re.compile(
    r"^\s{0,8}(?P<mdl>\d{3,5})\s+(?P<rest>\S.*?)\s{2,}(?P<district>[A-Z]{2,4})\s+(?:(?P<master>(?!\d{2}/\d{2}/\d{4})\S+)\s+)?"
    r"(?P<filed>\d{2}/\d{2}/\d{4})\s+(?P<transferred>\d{2}/\d{2}/\d{4})\s*$"
)
RE_TYPE_ROW_ANY = re.compile(r"^\s{0,8}\d{3,5}\s+IN\s+RE", re.I)
# A docket printed with only its filing date (no judge, district, master docket or transfer date): reports run
# without the "Status: Transferred" filter list such not-yet-transferred dockets.
RE_TYPE_ROW_FILED_ONLY = re.compile(r"^\s{0,8}(?P<mdl>\d{3,5})\s+(?P<title>IN\s+RE.*?\S)\s{2,}(?P<filed>\d{2}/\d{2}/\d{4})\s*$", re.I)


def report_filters(text: str):
    """The printed 'MDL Filters:' lines, e.g. ['Status: Transferred', 'Limited to Active Litigations']."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        if raw.strip() == "MDL Filters:":
            out = []
            for nxt in lines[i + 1:i + 8]:
                s = nxt.strip()
                if not s or s.startswith("Grouped by") or s.startswith("District") or s.startswith("DOCKET"):
                    break
                out.append(" ".join(s.split()))
            return out
    return []
RE_JUDGE_TIGHT = re.compile(r"^(?P<title>.*\S)\s(?P<judge>[A-Z][A-Za-z'.\-]+(?:[ -][A-Z][A-Za-z'.\-]+)*,\s[A-Z][A-Za-z.' \-]*?)$")


def _us(d: str):
    mo, dy, yr = d.split("/")
    return f"{yr}-{mo}-{dy}"


def parse_type_report(text: str, listing: bool = False) -> dict:
    """Docket Type Summary: {rows: [{mdl, type, title, judge, district, master_docket, date_filed,
    date_transferred}], printed: {per_type: {type: n}, total: n}, unparsed: [...]}. The title/judge split is kept
    only when the printed columns separate them (two or more spaces) or the judge is a single 'Last, First' token
    pattern at the end; otherwise judge is None (the pending reports are the judge source).

    listing=True parses the "Docket Summary Listing" (Pending MDLs by MDL Number): same columns, no type sections;
    rows carry type None."""
    rows, unparsed, last = [], [], None
    current = "__listing__" if listing else None
    per_type, total = {}, None
    for i, raw in enumerate(text.splitlines()):
        c = RE_TYPE_COUNT.search(raw)
        if c:
            per_type[c.group(1).strip()] = int(c.group(2))
            current, last = None, None
            continue
        t = RE_TYPE_TOTAL.search(raw)
        if t:
            total = int(t.group(1))
            continue
        h = RE_TYPE_HEAD.match(raw)
        if h and h.group(1).strip() in KNOWN_TYPES and current is None:
            # a heading opens a section only after the previous section's count line closed it, so a wrapped
            # title line that happens to read "Products Liability" never switches the section
            current, last = h.group(1).strip(), None
            continue
        m = RE_TYPE_ROW.match(raw)
        if m and current:
            rest = m.group("rest")
            parts = re.split(r"\s{2,}", rest)
            if len(parts) >= 2:
                title, judge = " ".join(" ".join(parts[:-1]).split()), " ".join(parts[-1].split())
            else:
                tj = RE_JUDGE_TIGHT.match(rest)
                title, judge = (" ".join(tj.group("title").split()), " ".join(tj.group("judge").split())) if tj else (" ".join(rest.split()), None)
            last = {"mdl": int(m.group("mdl")), "type": None if listing else current, "title": title, "judge": judge, "district": m.group("district"),
                    "master_docket": m.group("master"), "date_filed": _us(m.group("filed")), "date_transferred": _us(m.group("transferred")), "transferred": True, "line": i + 1}
            rows.append(last)
            continue
        f = RE_TYPE_ROW_FILED_ONLY.match(raw)
        if f and current:
            last = {"mdl": int(f.group("mdl")), "type": None if listing else current, "title": " ".join(f.group("title").split()), "judge": None, "district": None,
                    "master_docket": None, "date_filed": _us(f.group("filed")), "date_transferred": None, "transferred": False, "line": i + 1}
            rows.append(last)
            continue
        if RE_TYPE_ROW_ANY.match(raw):
            unparsed.append({"line": i + 1, "text": " ".join(raw.split())[:240]})
            continue
        cont = raw.strip()
        if last and current and cont and not re.match(r"^(https?://|\d+/\d+/\d+|Number of|_+|MDLs Listed)", cont) and len(cont) < 110 and "CM/ECF" not in cont and "Report Date" not in cont:
            last["title"] = f"{last['title']} {' '.join(cont.split())}"
    return {"rows": rows, "printed": {"per_type": per_type, "total": total}, "unparsed": unparsed}


RE_TERM_ROW = re.compile(
    r"^\s{0,8}(?P<mdl>\d{3,5})\s+(?P<rest>\S.*?)\s{2,}(?P<district>[A-Z]{2,4})\s+(?:(?P<master>(?!\d{2}/\d{2}/\d{4})\S+)\s+)?"
    r"(?P<filed>\d{2}/\d{2}/\d{4})\s+(?P<transferred>\d{2}/\d{2}/\d{4})\s+(?P<closed>\d{2}/\d{2}/\d{4})\s*$"
)
RE_CLOSED_BETWEEN = re.compile(r"Closed Between:\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*-\s*(\d{1,2})/(\d{1,2})/(\d{4})")


def parse_terminated_report(text: str) -> dict:
    """Recently terminated MDLs ('Limited to Closed Litigations'): rows with the printed Date Closed."""
    rows, unparsed = [], []
    for i, raw in enumerate(text.splitlines()):
        m = RE_TERM_ROW.match(raw)
        if m:
            parts = re.split(r"\s{2,}", m.group("rest"))
            title, judge = (" ".join(" ".join(parts[:-1]).split()), " ".join(parts[-1].split())) if len(parts) >= 2 else (" ".join(m.group("rest").split()), None)
            if judge is None:
                tj = RE_JUDGE_TIGHT.match(m.group("rest"))
                if tj:
                    title, judge = " ".join(tj.group("title").split()), " ".join(tj.group("judge").split())
            rows.append({"mdl": int(m.group("mdl")), "title": title, "judge": judge, "district": m.group("district"), "master_docket": m.group("master"),
                         "date_filed": _us(m.group("filed")), "date_transferred": _us(m.group("transferred")), "date_closed": _us(m.group("closed")), "line": i + 1})
        elif RE_TYPE_ROW_ANY.match(raw):
            unparsed.append({"line": i + 1, "text": " ".join(raw.split())[:240]})
    t = RE_TYPE_TOTAL.search(text)
    cb = RE_CLOSED_BETWEEN.search(text)
    window = None
    if cb:
        g = [int(x) for x in cb.groups()]
        window = [date(g[2], g[0], g[1]).isoformat(), date(g[5], g[3], g[4]).isoformat()]
    return {"rows": rows, "unparsed": unparsed, "printed": {"total": int(t.group(1)) if t else None, "closed_between": window}}


def validate_terminated(parsed: dict) -> dict:
    rows, p = parsed["rows"], parsed["printed"]
    checks = [
        {"check": "row_count_vs_printed_total", "parsed": len(rows), "printed": p["total"], "ok": p["total"] is not None and len(rows) == p["total"]},
        {"check": "no_unparsed_rows", "parsed": len(parsed["unparsed"]), "printed": 0, "ok": not parsed["unparsed"]},
        {"check": "closed_dates_inside_printed_window", "parsed": None, "printed": p["closed_between"],
         "ok": p["closed_between"] is not None and all(p["closed_between"][0] <= r["date_closed"] <= p["closed_between"][1] for r in rows)},
    ]
    return {"valid": all(c["ok"] for c in checks), "checks": checks}


def validate_type(parsed: dict) -> dict:
    rows, p = parsed["rows"], parsed["printed"]
    checks = []

    def check(name, a, b):
        checks.append({"check": name, "parsed": a, "printed": b, "ok": b is not None and a == b})

    check("row_count_vs_printed_total", len(rows), p["total"])
    if any(r["type"] for r in rows) or p["per_type"]:
        check("per_type_sum_vs_printed_total", sum(p["per_type"].values()) if p["per_type"] else None, p["total"])
    for typ, n in sorted(p["per_type"].items()):
        check(f"type_count:{typ}", sum(1 for r in rows if r["type"] == typ), n)
    numbers = [r["mdl"] for r in rows]
    check("mdl_numbers_unique", len(set(numbers)), len(numbers))
    check("no_unparsed_rows", len(parsed["unparsed"]), 0)
    return {"valid": all(c["ok"] for c in checks), "checks": checks}


def validate_pending(parsed: dict) -> dict:
    """Required checks (row count, pending sum, total sum against printed totals) decide validity; the rest are
    recorded as warnings. Returns {'valid': bool, 'checks': [...], 'warnings': [...]}."""
    rows, p = parsed["rows"], parsed["printed"]
    checks, warnings = [], []

    def check(name, parsed_value, printed_value, required=True):
        ok = printed_value is not None and parsed_value == printed_value
        (checks if required else warnings).append({"check": name, "parsed": parsed_value, "printed": printed_value, "ok": ok})
        return ok

    check("row_count_vs_printed_dockets", len(rows), p["dockets"])
    check("sum_pending_vs_printed", sum(r["pending"] for r in rows), p["pending"])
    check("sum_total_vs_printed", sum(r["total"] for r in rows), p["total"])
    if p.get("dockets_line") is not None:
        check("printed_docket_lines_agree", p["dockets"], p["dockets_line"])
    numbers = [r["mdl"] for r in rows]
    check("mdl_numbers_unique", len(set(numbers)), len(numbers))
    check("no_unparsed_mdl_lines", len(parsed["unparsed"]), 0)
    check("first_row_has_district", bool(rows) and bool(rows[0]["district_printed"]), True)
    check("distinct_districts_vs_printed", len({r["district"] for r in rows}), p["districts"], required=False)
    check("distinct_judges_vs_printed", len({j["name"] for r in rows for j in r["judges"]}), p["judges"], required=False)
    if p["judge_titles"]:
        check("judge_title_breakdown_sums_to_judges", sum(p["judge_titles"].values()), p["judges"], required=False)
    for key, field in (("buckets_pending", "pending"), ("buckets_total", "total")):
        for b in p[key]:
            inside = [r[field] for r in rows if r[field] >= b["low"] and (b["high"] is None or r[field] <= b["high"])]
            check(f"{key}_{b['low']}_{b['high'] or 'plus'}_dockets", len(inside), b["dockets"], required=False)
            check(f"{key}_{b['low']}_{b['high'] or 'plus'}_actions", sum(inside), b["actions"], required=False)
    return {"valid": all(c["ok"] for c in checks), "checks": checks, "warnings": [w for w in warnings if not w["ok"]], "warnings_checked": len(warnings)}
