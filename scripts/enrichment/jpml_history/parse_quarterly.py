"""Parser for the JPML "MDL Statistics Report - Distribution of Pending MDL Dockets by Circuit" (the reports linked
from https://www.jpml.uscourts.gov/mdl-quarterly-caseload-summary, one per calendar quarter end).

The row layout is the one of the monthly pending reports (district, judge (title), MDL number, litigation, actions now
pending, total actions historical), so rows are read with parse_reports.parse_pending_report. This module adds the
circuit layer: each "<Name> Circuit" heading opens a section; each section ends with a printed
"Circuit Summary: Districts: d, MDLs: m   <pending>   <total>" line. Every number returned is printed in the report.
"""
import re

import parse_reports as pr

CIRCUITS = [
    "District of Columbia", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth",
    "Tenth", "Eleventh", "Federal",
]
RE_CIRCUIT_HEAD = re.compile(r"^\s*(" + "|".join(CIRCUITS) + r") Circuit\s*$")
RE_CIRCUIT_SUMMARY = re.compile(r"Circuit Summary:\s*Districts:\s*(\d+),\s*MDLs:\s*(\d+)\s+(\d[\d,]*)\s+(\d[\d,]*)\s*$")
CIRCUIT_SLUG = {
    "District of Columbia": "dc", "First": "1", "Second": "2", "Third": "3", "Fourth": "4", "Fifth": "5",
    "Sixth": "6", "Seventh": "7", "Eighth": "8", "Ninth": "9", "Tenth": "10", "Eleventh": "11", "Federal": "fed",
}


def circuit_label(name):
    return "D.C. Circuit" if name == "District of Columbia" else f"{name} Circuit"


def parse_circuit_report(text: str) -> dict:
    """{rows, unparsed, printed, circuits: [{name, slug, label, printed: {districts, mdls, pending, total}, lines}],
    report_date, title, filters}. Each row gains `circuit` (the heading it sits under, None when outside any)."""
    base = pr.parse_pending_report(text)
    lines = text.splitlines()
    circuits, current, by_line, unparsed = [], None, {}, list(base["unparsed"])
    for i, raw in enumerate(lines):
        if pr.RE_TOTALS.search(raw):
            break
        h = RE_CIRCUIT_HEAD.match(raw)
        if h:
            current = {"name": h.group(1), "slug": CIRCUIT_SLUG[h.group(1)], "label": circuit_label(h.group(1)), "printed": None, "line": i + 1}
            circuits.append(current)
            continue
        s = RE_CIRCUIT_SUMMARY.search(raw)
        if s:
            if current is None or current["printed"] is not None:
                unparsed.append({"line": i + 1, "text": "circuit summary without an open circuit section"})
                continue
            current["printed"] = {"districts": int(s.group(1)), "mdls": int(s.group(2)), "pending": pr.to_int(s.group(3)), "total": pr.to_int(s.group(4))}
            current["summary_line"] = i + 1
            continue
        if "Circuit Summary" in raw:
            unparsed.append({"line": i + 1, "text": " ".join(raw.split())[:240]})
        if current is not None:
            by_line[i + 1] = current["name"]
    for r in base["rows"]:
        r["circuit"] = by_line.get(r["line"])
    return {
        "rows": base["rows"], "unparsed": unparsed, "printed": base["printed"], "circuits": circuits,
        "report_date": pr.report_date(text), "title": pr.report_title(text), "filters": pr.report_filters(text),
    }


def validate_circuit_report(parsed: dict) -> dict:
    """Required checks: the monthly-report checks (row count, pending and total sums against the printed report totals,
    unique MDL numbers, no unparsed lines, first row has a district) plus, per circuit, row count = printed MDLs,
    distinct districts = printed Districts, pending and total sums = printed circuit figures; the circuit figures sum
    to the report totals; every row sits under a circuit; every circuit prints a summary; each district code sits in
    one circuit only; the first row of each circuit prints its district."""
    v = pr.validate_pending({"rows": parsed["rows"], "unparsed": parsed["unparsed"], "printed": parsed["printed"]})
    checks, warnings = list(v["checks"]), list(v["warnings"])

    def check(name, a, b):
        checks.append({"check": name, "parsed": a, "printed": b, "ok": b is not None and a == b})

    rows = parsed["rows"]
    check("every_row_under_a_circuit", sum(1 for r in rows if r["circuit"] is None), 0)
    check("every_circuit_prints_summary", sum(1 for c in parsed["circuits"] if c["printed"] is None), 0)
    names = [c["name"] for c in parsed["circuits"]]
    check("circuit_headings_unique", len(set(names)), len(names))
    for c in parsed["circuits"]:
        mine = [r for r in rows if r["circuit"] == c["name"]]
        p = c["printed"] or {}
        check(f"circuit:{c['slug']}:mdls", len(mine), p.get("mdls"))
        check(f"circuit:{c['slug']}:districts", len({r["district"] for r in mine}), p.get("districts"))
        check(f"circuit:{c['slug']}:pending", sum(r["pending"] for r in mine), p.get("pending"))
        check(f"circuit:{c['slug']}:total", sum(r["total"] for r in mine), p.get("total"))
        check(f"circuit:{c['slug']}:first_row_prints_district", bool(mine) and bool(mine[0]["district_printed"]), True)
    printed = [c["printed"] for c in parsed["circuits"] if c["printed"]]
    check("circuit_mdls_sum_to_report_dockets", sum(p["mdls"] for p in printed), parsed["printed"]["dockets"])
    check("circuit_pending_sum_to_report_totals", sum(p["pending"] for p in printed), parsed["printed"]["pending"])
    check("circuit_total_sum_to_report_totals", sum(p["total"] for p in printed), parsed["printed"]["total"])
    check("circuit_districts_sum_to_report_districts", sum(p["districts"] for p in printed), parsed["printed"]["districts"])
    seen = {}
    for r in rows:
        seen.setdefault(r["district"], set()).add(r["circuit"])
    check("each_district_in_one_circuit", sum(1 for s in seen.values() if len(s) > 1), 0)
    return {"valid": all(c["ok"] for c in checks), "checks": checks, "warnings": warnings, "warnings_checked": v["warnings_checked"]}
