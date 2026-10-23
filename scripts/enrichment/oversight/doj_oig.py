"""Collect the DOJ OIG reports from the raw pages in private/acq/oversight/doj_oig/ (listing + one page per report)."""
import glob
import os
import re

import common as cm
import parse_doj_oig as pj

ROOT = os.path.join(cm.ACQ, "doj_oig")
# Report types whose money fields total other reports (a semiannual report states the sums of its period): excluded
# from per-year money totals so nothing is counted twice.
AGGREGATE_TYPES = {"Semiannual Report"}


def slug_of(path):
    return re.sub(r"[^A-Za-z0-9._-]", "_", path.strip("/").split("/")[-1])[:150]


def tidy_place(text):
    """'Salem , OR United States' -> 'Salem, OR United States' (the page puts a space before the comma)."""
    return re.sub(r"\s+,", ",", text).strip() if text else None


def first(values):
    return values[0] if values else None


def merge(listing_row, detail):
    """One report: the listing's values and the report page's, kept apart where they could differ."""
    d = detail or {}
    money = d.get("money") or {}
    number = first(d.get("number")) if d.get("number") else None
    return {
        "path": listing_row["path"],
        "url": pj.BASE + listing_row["path"],
        "title": listing_row["title"],
        "date": listing_row["date"],
        "posted": pj.iso_date(first(d.get("posted")) or ""),
        "type": listing_row["type"] or (first(d.get("type")) if d.get("type") else None),
        "components": d.get("component") or listing_row["components"],
        "listing_components": listing_row["components"],
        "number": number,
        "entity": first(d.get("entity")) if d.get("entity") else None,
        "location": tidy_place(first(d.get("location")) if d.get("location") else listing_row["location"]),
        "recommendations": int(first(d["recs"])) if d.get("recs") and first(d["recs"]).isdigit() else None,
        "questioned_costs": money.get("questioned_costs"),
        "funds_better_use": money.get("funds_better_use"),
        "dollar_findings": money.get("dollar_findings") or money.get("monetary"),
        "description": " ".join(d["description"]) if d.get("description") else None,
        "participants": d.get("participants"),
        "projects": d.get("projects"),
        "pdf": d.get("pdf"),
        "has_detail": detail is not None,
        "other_labels": d.get("other") or {},
    }


def collect():
    """[(merged report)] in listing order plus stats; raises when a listing page or report page is missing."""
    rows, order = {}, []
    for f in sorted(glob.glob(os.path.join(ROOT, "list", "p*.html.gz"))):
        for row in pj.parse_listing(cm.read_gz(f).decode("utf-8")):
            if row["path"] not in rows:
                rows[row["path"]] = row
                order.append(row["path"])
    merged, missing = [], []
    for path in order:
        f = os.path.join(ROOT, "reports", f"{slug_of(path)}.html.gz")
        detail = pj.parse_report(cm.read_gz(f).decode("utf-8")) if os.path.exists(f) else None
        if detail is None:
            missing.append(path)
        merged.append(merge(rows[path], detail))
    return merged, {"listing_rows": len(order), "missing_report_pages": len(missing)}


def crosslink_key(number, date):
    return (number, date) if number and date else None


def crosslink(doj_rows, oversight_rows):
    """Exact (report number, date) pairs held by exactly one DOJ OIG report and one Oversight.gov DOJ OIG report.

    Returns {doj path: oversight path}; a pair that is missing a number or a date, or that more than one report on
    either side shares, is not linked."""
    left, right = {}, {}
    for r in doj_rows:
        k = crosslink_key(r["number"], r["date"])
        if k:
            left.setdefault(k, []).append(r["path"])
    for r in oversight_rows:
        if r.get("oig") != "Department of Justice OIG":
            continue
        k = crosslink_key(r["report_number"], r["date"])
        if k:
            right.setdefault(k, []).append(r["path"])
    return {a[0]: right[k][0] for k, a in left.items() if len(a) == 1 and len(right.get(k, [])) == 1}
