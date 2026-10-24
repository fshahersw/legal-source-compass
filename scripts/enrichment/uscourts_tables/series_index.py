"""Build uscourts_series_index: one record per published table series, one per publication, and coverage summaries.

A series is one table (a table key: the listing's table number, plus "-s<n>" for a further sheet of the same workbook) in one
geography (district courts, bankruptcy courts, courts of appeals, counties, or a national table with category rows), with every
period the stream publishes for it. The index says, for each series, which periods exist and from which publication, which
columns (under their published headings, with units), which rows or courts, where the figures are stored (dataset and record ids),
how the table reconciles with its own printed totals, which periods are held, and how many listing rows of that table number were
listed, acquired, parsed and published (coverage.py). The UI lists and opens series from it; nothing here is a new figure.

Called by build_uscourts_tables.py after the other datasets are built (pure function of what was built).
"""
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # corpus_writer lives in scripts/enrichment
import build_tables as B  # noqa: E402
import corpus_writer as cw  # noqa: E402
import coverage as CV  # noqa: E402

DATASET = "uscourts_series_index"
LABEL = "U.S. Courts statistical tables - index of every published table series, its periods, coverage and reconciliation (U.S. Courts statistical publications)"
LISTING_URL = "https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables"
GEO = {"district": "U.S. district courts", "bankruptcy": "U.S. bankruptcy courts", "appeals": "U.S. courts of appeals", "county": "Counties (bankruptcy filings)",
       "category": "National (category rows)"}
COURT_DATASET_KIND = {"district": "district", "bankruptcy": "bankruptcy", "appeals": "circuit", "county": "county"}
# one-letter codes for the per-period coverage arrays of a publication record
ACQ_CODE = {"acquired": "a", "acquired_by_other_stream": "o", "not_acquired": "-"}
PARSE_CODE = {"parsed": "p", "read_by_other_stream": "o", "not_parsed": "-"}
PUB_CODE = {"published": "p", "held": "h", "duplicate": "d", "published_by_other_stream": "o", "not_published": "-"}
CIRCUITS = {"cadc", "cafc"} | {f"ca{n}" for n in range(1, 12)}


def _rows_of(build, suffix):
    return [r for r in build["rows"] if r["id"].endswith(suffix)] if build else []


def series_payload(info, builds, dsid, coverage_by_table):
    chosen = info["chosen"]
    last = chosen[-1]["norm"]
    tkey, scope, family = info["tableKey"], info["scope"], info["family"]
    national_ds = dsid("national", family)
    national = next((r for r in builds.get(national_ds, {"rows": []})["rows"] if r["id"] == tkey), None)
    ust = (national or {}).get("item", {}).get("ust", {})
    cols = B.collect_columns(chosen)
    payload = {
        "v": 1, "tableKey": tkey, "table": last["table"], "title": last.get("title") or last.get("title_listing") or "", "scope": scope, "geography": GEO.get(scope, scope), "family": family,
        "periods": [{"end": d["norm"]["period_end"], "months": d["norm"].get("months"), "pub": d["norm"]["pub"], "fmt": d["source"].get("format"),
                     **({"phrase": p["phrase"]} if p.get("phrase") else {})} for d, p in zip(chosen, B.periods_block(chosen)[0])],
        "pubs": sorted({d["norm"]["pub"] for d in chosen}),
        "cols": [{"k": c["k"], "label": c["label"], "unit": c["unit"], "dec": c["dec"]} for c in cols.values()],
        "national": {"dataset": national_ds, "id": tkey} if national else None,
        "rec": info["rec"],
        "duplicates": [{"end": x["end"], "pub": x["pub"], "kept": x["kept"]} for x in info["dropped"]],
        "page": chosen[-1]["source"].get("page") or LISTING_URL,
    }
    if scope == "category":
        payload["rows"] = [{"k": r["k"], "label": r["label"], "depth": r.get("depth", 0)} for r in ust.get("rows", [])][:600]
    else:
        kind = COURT_DATASET_KIND[scope]
        ds = dsid(kind, family) if kind != "county" else dsid("county")
        ids = [r["id"].split(":")[0] for r in _rows_of(builds.get(ds), f":{tkey}") if not r["id"].startswith(("latest:", "table:"))]
        courts = sorted(i for i in ids if (i in CIRCUITS) == (kind == "circuit"))
        payload["courts"] = {"dataset": ds, "ids": courts if kind != "county" else [], "count": len(courts)}
        if kind in ("district", "bankruptcy"):
            cds = dsid("circuit", family)
            payload["circuits"] = {"dataset": cds, "ids": sorted(i for i in (r["id"].split(":")[0] for r in _rows_of(builds.get(cds), f":{tkey}")) if i in CIRCUITS)}
        latest_id = f"latest:{tkey}"
        latest_ds = dsid(kind, family) if kind != "county" else None
        has_latest = bool(latest_ds) and any(r["id"] == latest_id for r in builds.get(latest_ds, {"rows": []})["rows"])
        payload["latest"] = {"dataset": latest_ds, "id": latest_id} if has_latest else None
    # listing coverage of this table number, over every publication that lists it (the same table under JB, STFJ, FJCS, BF)
    cov = defaultdict(int)
    for (pub, table), counts in coverage_by_table.items():
        if table == last["table"]:
            for k, v in counts.items():
                if isinstance(v, int):
                    cov[k] += v
    payload["coverage"] = dict(cov)
    return payload


def series_record(payload):
    first, last = payload["periods"][0]["end"], payload["periods"][-1]["end"]
    pubs = ", ".join(payload["pubs"])
    held = len(payload["rec"].get("held", [])) if payload.get("rec") else 0
    cells = {"table": payload["table"], "title": payload["title"], "scope": payload["geography"], "pubs": pubs, "first": first, "last": last, "periods": len(payload["periods"])}
    facts = [["Table", f"{payload['table']} - {payload['title']}"], ["Geography", payload["geography"]], ["Publications", pubs],
             ["Periods", f"{len(payload['periods'])}, ending {first} to {last}"], ["Columns", str(len(payload["cols"]))],
             ["Reconciliation", (payload.get("rec") or {}).get("status", "not recorded")], ["Held periods", str(held)]]
    links = [{"url": payload["page"], "label": "U.S. Courts table page (latest period)"}]
    if payload.get("national"):
        links.append({"url": f"/records/{payload['national']['dataset']}/{payload['national']['id']}", "label": "National table"})
    return cw.record(DATASET, f"series:{payload['tableKey']}", f"Table {payload['table']}: {payload['title']}", source_url=payload["page"], cells=cells, facts=facts,
                     text=f"{payload['table']} {payload['title']} {payload['geography']} {pubs}",
                     filters={"pub": payload["pubs"], "scope": [payload["scope"]], "family": [payload["family"]], "kind": ["series"]},
                     subtitle=f"{payload['geography']} · {len(payload['periods'])} periods ending {first} to {last}", links=links, extra={"series": payload})


def publication_record(p):
    tables = []
    for t in sorted(p["tables"].values(), key=lambda t: CV.natural(t["table"])):
        tables.append({"table": t["table"], "title": t["title"], "series": t["series"], "counts": t["counts"],
                       "periods": [[x["end"], ACQ_CODE[x["acq"]], PARSE_CODE[x["parse"]], PUB_CODE[x["pub"]]] for x in t["periods"]],
                       "gaps": [[why, n] for why, n in CV.reasons_of(t["periods"]).most_common(4)]})
    c = p["counts"]
    cells = {"table": p["code"], "title": p["title"], "scope": "Publication", "pubs": p["code"], "first": c.get("first_published") or "", "last": c.get("last_listed") or "",
             "periods": c.get("listed", 0)}
    facts = [["Publication", p["title"]], ["Listed table-periods", str(c.get("listed", 0))], ["Acquired", str(c.get("acquired", 0))], ["Parsed", str(c.get("parsed", 0))],
             ["Published here", str(c.get("published", 0))], ["Held", str(c.get("held", 0))], ["Published by another dataset", str(c.get("other_stream", 0))]]
    return cw.record(DATASET, f"pub:{p['code']}", f"Coverage: {p['title']}", source_url=p["page"], cells=cells, facts=facts, text=f"coverage {p['title']}",
                     filters={"pub": [p["code"]], "kind": ["publication"]}, subtitle=f"{c.get('listed', 0)} listed table-periods, {c.get('published', 0)} published here",
                     links=[{"url": p["page"], "label": "Publication page"}],
                     extra={"publication": {"v": 1, "code": p["code"], "title": p["title"], "page": p["page"], "counts": c, "series": p["series"], "tables": tables,
                                            "codes": {"acq": ACQ_CODE, "parse": PARSE_CODE, "pub": PUB_CODE}}})


def build_index(series_info, builds, report, verification):
    from build_uscourts_tables import dsid  # the dataset-id rule lives with the datasets
    cov = CV.compute(builds, report)
    coverage_by_table = {}
    for p in cov["publications"]:
        for t in p["tables"].values():
            coverage_by_table[(p["code"], t["table"])] = t["counts"]
    rows = []
    for info in sorted(series_info, key=lambda i: CV.natural(i["tableKey"])):
        rows.append(series_record(series_payload(info, builds, dsid, coverage_by_table)))
    for p in cov["publications"]:
        if p["counts"].get("listed"):
            rows.append(publication_record(p))
    totals = cov["totals"]
    rows.append(cw.record(DATASET, "summary:coverage", "Coverage of the U.S. Courts statistical publications", source_url=LISTING_URL,
                          cells={"table": "Coverage", "title": "All publications", "scope": "Summary", "pubs": ", ".join(p["code"] for p in cov["publications"] if p["counts"].get("listed")),
                                 "first": "", "last": "", "periods": totals.get("listed", 0)},
                          facts=[["Listed table-periods", str(totals.get("listed", 0))], ["Acquired", str(totals.get("acquired", 0))], ["Parsed", str(totals.get("parsed", 0))],
                                 ["Published here", str(totals.get("published", 0))], ["Held", str(totals.get("held", 0))]],
                          text="coverage summary", filters={"kind": ["summary"]}, subtitle="Listed, acquired, parsed and published, by publication",
                          links=[{"url": LISTING_URL, "label": "U.S. Courts caseload statistics data tables"}],
                          extra={"coverage": {"v": 1, "generated_at": cov["generated_at"], "totals": totals,
                                              "publications": [{"code": p["code"], "title": p["title"], "page": p["page"], "counts": p["counts"]} for p in cov["publications"] if p["counts"].get("listed")],
                                              "series": len(series_info), "verification": verification}}))
    rows.append(cw.record(DATASET, "summary:held", "Held table-periods: editions that fail their own printed totals", source_url=LISTING_URL,
                          cells={"table": "Held", "title": f"{len(report.get('held', []))} table-periods", "scope": "Summary", "pubs": "", "first": "", "last": "", "periods": len(report.get("held", []))},
                          facts=[["Held table-periods", str(len(report.get("held", [])))]], text="held tables failing totals", filters={"kind": ["summary"]},
                          subtitle="Not published; the failing figures are listed", links=[{"url": LISTING_URL, "label": "U.S. Courts caseload statistics data tables"}],
                          extra={"held": {"v": 1, "items": report.get("held", [])}}))
    rows = sorted(rows, key=lambda r: r["id"])
    columns = [("table", "Table"), ("title", "Title"), ("scope", "Geography"), ("pubs", "Publications"), ("first", "First period ends"), ("last", "Last period ends"), ("periods", "Periods")]
    pubs = sorted({p for r in rows for p in r["filters"].get("pub", [])})
    listing = cw.listing(columns, filters=[("pub", "Publication", {p: p for p in pubs}), ("kind", "Record", {"series": "Series", "publication": "Publication coverage", "summary": "Summary"})])
    summary = {
        "source": "U.S. Courts, Administrative Office: statistical tables at https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables",
        "records": len(rows), "series": len(series_info),
        "what": "An index, not new figures: every series published in the uscourts_tables_* and uscourts_* datasets, its periods and publications, columns and units, "
                "where its records are, its reconciliation with its own printed totals and held periods; plus listing coverage per publication (listed, acquired, parsed, published).",
        "codes": {"acq": ACQ_CODE, "parse": PARSE_CODE, "pub": PUB_CODE},
        "published_by": "enrich/publish_build",
        "verification": verification,
    }
    inputs = sorted({(i["url"], i["path"], i["sha256"]) for b in builds.values() for i in b.get("inputs", [])})
    return {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary, "rows": rows,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inputs": [{"url": u, "path": p, "sha256": s} for u, p, s in inputs]}
