"""Build `oversight_reports` (one record per public OIG report on Oversight.gov) and `oversight_trends` (yearly counts).

  python3 -I -B scripts/enrichment/oversight/build_oversight.py

Reads only private/acq/oversight/ (raw listing pages, DOJ OIG pages) and private/build/oversight/lookups/. Writes
private/build/oversight/oversight_reports.json and oversight_trends.json for publish_build.py.

Every value is the publisher's: dates, titles, OIG and agency names, types, report numbers and recommendation counts
are copied from the listing; a field the listing leaves empty is Not recorded, never filled in. Matching to Federal
Register agency records is exact on a documented key (match.py) and only when one agency holds that key.
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import doj_oig as dj  # noqa: E402
import match  # noqa: E402
import parse_oversight as po  # noqa: E402
import rows as rw  # noqa: E402

REPORTS = "oversight_reports"
TRENDS = "oversight_trends"
SOURCE_PAGE = "https://www.oversight.gov/reports/federal"
DESC_LIMIT = 1200
TEXT_DESC_LIMIT = 600
DOJ_OIG = "Department of Justice OIG"


def oig_slug(path):
    return path.rstrip("/").split("/")[-1] if path else None


def load_pages(scope="federal"):
    """[(page file, parsed rows)] in page order, and a map page file -> retrieval time from the manifest."""
    folder = os.path.join(cm.ACQ, "oversight_gov", scope)
    retrieved = {e["path"]: e["retrieved_at"] for e in cm.load_jsonl(cm.MANIFEST) if e["path"].startswith(cm.rel(folder))}
    pages = []
    for f in sorted(glob.glob(os.path.join(folder, "p*.html.gz"))):
        pages.append((f, po.parse_listing(cm.read_gz(f).decode("utf-8")), retrieved.get(cm.rel(f))))
    return pages


def collect(scope="federal"):
    """Unique reports by path (first occurrence wins) with the retrieval time of their page, and stats."""
    pages = load_pages(scope)
    seen, out, dup = {}, [], 0
    for f, parsed, when in pages:
        for r in parsed:
            if r["path"] in seen:
                dup += 1
                continue
            seen[r["path"]] = r
            r["scope"] = scope
            r["retrieved_at"] = when
            out.append(r)
    return out, {"pages": len(pages), "rows_seen": sum(len(p[1]) for p in pages), "unique": len(out), "duplicates": dup}


def year_of(date):
    return int(date[:4]) if date else None


def build_record(r, agencies, doj_link=None):
    rid = rw.stable_id("ovr", r["path"])
    url = po.BASE + r["path"]
    year = year_of(r["date"])
    oig_match = agencies.match(r["oig"]) if r["oig"] else None
    rev_match = agencies.match(r["agency_reviewed"]) if r["agency_reviewed"] else None
    desc, clipped = rw.clip(r["description"], DESC_LIMIT)
    body = {
        "date": r["date"], "year": year, "oig": r["oig"], "oig_slug": oig_slug(r["oig_path"]),
        "oig_agency_id": oig_match["id"] if oig_match else None,
        "agency_reviewed": r["agency_reviewed"],
        "reviewed_agency_id": rev_match["id"] if rev_match else None,
        "type": r["type"], "location": r["location"], "report_number": r["report_number"],
        "recommendations": r["recommendations"], "description": desc, "description_clipped": clipped,
        "url": url, "doj_oig_id": doj_link,
    }
    links = [{"url": url, "label": "Oversight.gov report page"}]
    if oig_match:
        links.append({"url": f"/agencies/{oig_match['id']}", "label": f"Agency: {oig_match['title']}"})
    if doj_link:
        links.append({"url": f"/records/doj_oig_reports/{doj_link}", "label": "DOJ OIG report record"})
    recs = r["recommendations"]
    facts = [
        ("Report date", r["date"]), ("Submitting OIG", r["oig"]), ("Agency reviewed or investigated", r["agency_reviewed"]),
        ("Report type", r["type"]), ("Location", r["location"]), ("Report number", r["report_number"]),
        ("Number of recommendations", recs if recs is not None else None),
        ("Source", "Oversight.gov (Council of the Inspectors General on Integrity and Efficiency) report listing"),
        ("Listing page read", (r.get("retrieved_at") or "")[:10] or None),
    ]
    if oig_match:
        facts.append(("Agency record (exact name match)", oig_match["title"]))
    filters = {
        "oig": [r["oig"]] if r["oig"] else [], "agency": [r["agency_reviewed"]] if r["agency_reviewed"] else [],
        "type": [r["type"]] if r["type"] else [], "year": [str(year)] if year else [],
        "has_recommendations": ["yes" if recs else "no"] if recs is not None else ["not_recorded"],
    }
    if oig_match:
        filters["oig_agency"] = [oig_match["id"]]
    if rev_match:
        filters["reviewed_agency"] = [rev_match["id"]]
    text_desc, _ = rw.clip(r["description"], TEXT_DESC_LIMIT)
    return rw.record(
        REPORTS, rid, r["title"], source_url=url, subtitle=" · ".join(x for x in [r["oig"], r["type"], r["date"]] if x),
        cells={"date": r["date"] or rw.NOT_RECORDED, "oig": r["oig"] or rw.NOT_RECORDED, "agency": r["agency_reviewed"] or rw.NOT_RECORDED,
               "type": r["type"] or rw.NOT_RECORDED, "number": r["report_number"] or rw.NOT_RECORDED,
               "recs": str(recs) if recs is not None else rw.NOT_RECORDED},
        facts=facts, links=links, filters=filters, extra={"oversight": body},
        text=" ".join(x for x in [r["oig"], r["agency_reviewed"], r["type"], r["report_number"], text_desc] if x),
    )


def series(items):
    """Per-year counts from parsed reports. Recommendation totals sum only the reports that state a count."""
    years = {}
    for r in items:
        y = year_of(r["date"])
        if y is None:
            continue
        s = years.setdefault(y, {"year": y, "reports": 0, "types": Counter(), "recs": 0, "recs_reports": 0})
        s["reports"] += 1
        s["types"][r["type"] or rw.NOT_RECORDED] += 1
        if r["recommendations"] is not None:
            s["recs"] += r["recommendations"]
            s["recs_reports"] += 1
    return [{**s, "types": dict(sorted(s["types"].items()))} for _, s in sorted(years.items())]


def totals(items):
    dated = [r for r in items if r["date"]]
    types = Counter(r["type"] or rw.NOT_RECORDED for r in items)
    recs = [r["recommendations"] for r in items if r["recommendations"] is not None]
    return {
        "reports": len(items), "dated": len(dated), "undated": len(items) - len(dated),
        "first_date": min((r["date"] for r in dated), default=None), "last_date": max((r["date"] for r in dated), default=None),
        "recs": sum(recs), "recs_reports": len(recs), "types": dict(sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))),
    }


def money_by_year(items):
    """Yearly money fields exactly as an OIG states them, for reports that are not period aggregates.

    items: dicts with date, type, questioned (float|None), better_use (float|None). A year's totals are meaningful
    only next to its counts, so each year carries how many reports it covers and how many state an amount."""
    years = {}
    for r in items:
        y = year_of(r["date"])
        if y is None or r["type"] in dj.AGGREGATE_TYPES:
            continue
        s = years.setdefault(y, {"year": y, "reports": 0, "questioned_reports": 0, "questioned_costs": 0.0, "better_use_reports": 0, "funds_better_use": 0.0})
        s["reports"] += 1
        if r["questioned"] is not None:
            s["questioned_reports"] += 1
            s["questioned_costs"] += r["questioned"]
        if r["better_use"] is not None:
            s["better_use_reports"] += 1
            s["funds_better_use"] += r["better_use"]
    return [years[y] for y in sorted(years)]


def doj_money(doj_rows):
    return money_by_year([{"date": r["date"], "type": r["type"],
                           "questioned": (r["questioned_costs"] or {}).get("value"),
                           "better_use": (r["funds_better_use"] or {}).get("value")} for r in doj_rows])


def build_trends(items, agencies, as_of, doj_rows=None):
    out = []
    national = {"scope": "national", "name": "All Offices of Inspector General on Oversight.gov", "as_of": as_of,
                "totals": totals(items), "years": series(items)}
    by_oig = defaultdict(list)
    for r in items:
        by_oig[(r["oig"], r["oig_path"])].append(r)
    names = [k[0] for k in by_oig if k[0]]
    if len(names) != len(set(names)):
        raise SystemExit("an OIG name appears with more than one OIG page; trends would split it")
    ranking = sorted(((k[0], len(v)) for k, v in by_oig.items() if k[0]), key=lambda kv: (-kv[1], kv[0]))
    paths = {k[0]: k[1] for k in by_oig}
    national["oigs"] = [{"name": n, "slug": oig_slug(paths.get(n)),
                         "agency_id": (agencies.match(n) or {}).get("id"), "reports": c} for n, c in ranking]
    national["years_present"] = sorted({y for y in (year_of(r["date"]) for r in items) if y})
    national["types_present"] = sorted({r["type"] for r in items if r["type"]})
    out.append(("national", national["name"], national, {"scope": ["national"]}))
    for (name, path), group in sorted(by_oig.items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
        if not name:
            continue
        m = agencies.match(name)
        body = {"scope": "oig", "name": name, "oig_slug": oig_slug(path), "agency_id": m["id"] if m else None,
                "agency_title": m["title"] if m else None, "as_of": as_of, "totals": totals(group), "years": series(group)}
        if name == DOJ_OIG and doj_rows:
            body["money"] = {"source": "DOJ OIG report pages (oig.justice.gov), every report read",
                             "source_url": "https://oig.justice.gov/reports", "years": doj_money(doj_rows),
                             "excludes": sorted(dj.AGGREGATE_TYPES),
                             "note": "Amounts are as the Office of the Inspector General states them on each report page; they are not audited or recomputed here."}
        filters = {"scope": ["oig"], "oig": [name]}
        if m:
            filters["agency_id"] = [m["id"]]
        out.append((f"oig:{body['oig_slug']}", name, body, filters))
    rows = []
    for rid, title, body, filters in out:
        rows.append(rw.record(
            TRENDS, rid, title, source_url=SOURCE_PAGE,
            subtitle=f"{body['totals']['reports']:,} reports · {body['totals']['first_date'] or 'Not recorded'} to {body['totals']['last_date'] or 'Not recorded'}",
            cells={"reports": str(body["totals"]["reports"]), "first": body["totals"]["first_date"] or rw.NOT_RECORDED, "last": body["totals"]["last_date"] or rw.NOT_RECORDED},
            facts=[("Reports counted", body["totals"]["reports"]), ("Reports with a report date", body["totals"]["dated"]),
                   ("Reports without a report date", body["totals"]["undated"]), ("First report date", body["totals"]["first_date"]),
                   ("Last report date", body["totals"]["last_date"]), ("Source", "Oversight.gov report listing, counted by report date"),
                   ("Data as of", as_of)],
            text=title, filters=filters, extra={"trend": body}))
    return rows


def main():
    agencies = match.Agencies(json.load(open(os.path.join(cm.BUILD, "lookups", "fr_agency_titles.json"), encoding="utf-8"))["rows"])
    items, stats = collect("federal")
    if not items:
        raise SystemExit("no listing pages found; run fetch_oversight.py first")
    doj_rows, doj_stats = ([], {})
    try:
        doj_rows, doj_stats = dj.collect()
    except FileNotFoundError:
        pass
    links = dj.crosslink(doj_rows, items) if doj_rows else {}
    reverse = {v: k for k, v in links.items()}
    doj_ids = {r["path"]: "dojoig:" + dj.slug_of(r["path"]) for r in doj_rows}
    records = [build_record(r, agencies, doj_ids.get(reverse.get(r["path"]))) for r in items]
    records.sort(key=lambda row: (row["item"]["oversight"]["date"] or "", row["id"]), reverse=True)
    as_of = max((r["date"] for r in items if r["date"]), default=None)
    retrieved = sorted(r["retrieved_at"] for r in items if r["retrieved_at"])
    oig_names = sorted({r["oig"] for r in items if r["oig"]})
    types = sorted({r["type"] for r in items if r["type"]})
    years = sorted({str(year_of(r["date"])) for r in items if r["date"]}, reverse=True)
    inputs = rw.manifest_inputs([cm.rel(os.path.join(cm.ACQ, "oversight_gov", "federal"))])
    summary = {
        "source": "Oversight.gov, the Council of the Inspectors General on Integrity and Efficiency (CIGIE) site of public reports from federal Offices of Inspector General",
        "source_page": SOURCE_PAGE,
        "terms": "Oversight.gov offers no bulk download, API or feed; the public report listing is read as published. robots.txt allows /reports and asks for a 5-second crawl delay, which the acquisition honours. Reports are works of the U.S. Government; only the listing's own fields are kept.",
        "coverage": f"{len(records):,} reports; report dates {min((r['date'] for r in items if r['date']), default='Not recorded')} to {as_of}; listing read {retrieved[0][:10] if retrieved else 'Not recorded'} to {retrieved[-1][:10] if retrieved else 'Not recorded'}",
        "fields": "Report date, submitting OIG, agency reviewed or investigated, report type, location, report number, number of recommendations and report description are exactly as the listing shows them; an empty field is Not recorded. Descriptions longer than 1,200 characters are cut at a word boundary and marked.",
        "matching": "A report links to a Federal Register agency record only when the submitting OIG's name and the agency's name give the same key (match.agency_key) and one agency holds it; to a DOJ OIG report record only when report number and date are equal and unique on both sides.",
        "monetary_impact": "Not part of the listing. Dollar figures stated on report pages are in doj_oig_reports (every DOJ OIG report page read).",
        "stats": {**stats, "agency_match": agencies.stats, "doj_oig": doj_stats, "doj_crosslinks": len(links)},
        "as_of": as_of, "dated_reports": sum(1 for r in items if r["date"]), "undated_reports": sum(1 for r in items if not r["date"]),
    }
    lb = rw.listing(
        [("date", "Report date"), ("oig", "Submitting OIG"), ("agency", "Agency reviewed"), ("type", "Type"), ("number", "Report no."), ("recs", "Recommendations")],
        [("oig", "Submitting OIG", {n: n for n in oig_names}), ("type", "Report type", {t: t for t in types}), ("year", "Report year", {y: y for y in years}),
         ("has_recommendations", "Recommendations", {"yes": "One or more", "no": "Zero stated", "not_recorded": "Not recorded"})])
    rw.write_build(REPORTS, "Inspector General reports (Oversight.gov, CIGIE)", records, lb, summary, inputs)
    trend_rows = build_trends(items, agencies, as_of, doj_rows or None)
    tsummary = {
        "source": "Counted from oversight_reports (Oversight.gov report listing)", "source_page": SOURCE_PAGE,
        "formula": "reports = number of listed reports with that report date's calendar year; recs = sum of the 'Number of recommendations' stated by the OIG, over only the reports that state one (recs_reports says how many); reports without a date are counted in totals only. DOJ OIG money = sum of the amounts the OIG states on each report page, excluding semiannual reports (they total other reports).",
        "coverage": f"report dates up to {as_of}; the latest year is partial", "as_of": as_of, "records": len(trend_rows),
        "inputs_digest": rw.inputs_digest(inputs),
    }
    tl = rw.listing([("reports", "Reports"), ("first", "First report"), ("last", "Last report")], [("scope", "Scope", {"national": "All OIGs", "oig": "One OIG"})])
    rw.write_build(TRENDS, "Inspector General reports: yearly counts by OIG", trend_rows, tl, tsummary, inputs)
    print(json.dumps({"agency_match": agencies.stats, "stats": stats}))


if __name__ == "__main__":
    main()
