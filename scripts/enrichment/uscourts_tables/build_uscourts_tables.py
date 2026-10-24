"""Build the uscourts_tables_* datasets from the parsed table files (ingest.py / pdf_ingest) -- build files only, nothing is published.

Datasets (one corpus record per court x table, or per national table):
  uscourts_tables_district     94 districts x district tables (civil, criminal, trials, magistrate, judges' work ...)
  uscourts_tables_bankruptcy   94 bankruptcy districts (keyed by the district id) x bankruptcy tables (F series)
  uscourts_tables_circuit      12 regional circuits + Federal Circuit x appeals tables (B series) and the circuit roll-up rows
                               the publisher prints in district / bankruptcy tables
  uscourts_tables_national     one record per table: its national "Total" row, or all category rows (nature of suit, offense,
                               action taken ...), plus summary:catalog and summary:method

Every figure is a cell the publisher printed; the only arithmetic is rounding floats to 6 decimals. Series are keyed by
the period end date; the publication and file of every period are in the record's `src` list.
Usage: python3 -I -B build_uscourts_tables.py [--tables c,d,...] [--out private/build/uscourts_tables/partial] [--county]
Build files are written as private/build/uscourts_tables/<dataset>.json.gz.
"""
import gzip
import hashlib
import json
import sys
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import build_tables as B  # noqa: E402
import checks as C  # noqa: E402
import corpus_writer as cw  # noqa: E402
import fetchlib as F  # noqa: E402
import reconcile as R  # noqa: E402
import save_lookups  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
TITLES = save_lookups.build()  # court ids and titles (pure data in save_lookups.py), so importing this module needs no private files
LISTING_URL = "https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables"
PUB_NAMES = {"JB": "Judicial Business of the United States Courts (12 months ending September 30)",
             "STFJ": "Statistical Tables for the Federal Judiciary (12 months ending June 30 and December 31)",
             "FJCS": "Federal Judicial Caseload Statistics (12 months ending March 31)",
             "BF": "Bankruptcy Filings statistics (quarterly)",
             "BAPCPA": "Bankruptcy Abuse Prevention and Consumer Protection Act report tables (12 months ending December 31)",
             "WIRETAP": "Wiretap report tables (calendar year, January 1 through December 31)"}
DATASETS = {
    "district": ("uscourts_tables_district", "U.S. district courts - published statistical tables by court and period (U.S. Courts: Judicial Business, Statistical Tables, Caseload Statistics)"),
    "bankruptcy": ("uscourts_tables_bankruptcy", "U.S. bankruptcy courts - published statistical tables by district and period (U.S. Courts: Judicial Business, Statistical Tables, Bankruptcy Filings)"),
    "circuit": ("uscourts_tables_circuit", "U.S. courts of appeals - published statistical tables by circuit and period (U.S. Courts: Judicial Business, Statistical Tables, Caseload Statistics)"),
    "county": ("uscourts_tables_bankruptcy_county", "U.S. bankruptcy courts - cases commenced by county and chapter, by FIPS code and period (U.S. Courts: Bankruptcy Filings, Table F-5A)"),
    "national": ("uscourts_tables_national", "Federal courts - national published statistical tables by period (U.S. Courts: Judicial Business, Statistical Tables, Caseload Statistics, Bankruptcy Filings)"),
}
# A publication whose tables are a family of their own is published as one dataset holding its court, circuit, national and
# latest-period records (the record ids are distinct: "<court>:<table>", "<table>", "latest:<table>").
FAMILIES = {
    "bapcpa": ("uscourts_bapcpa", "U.S. bankruptcy courts - BAPCPA report tables by district and period (U.S. Courts: Bankruptcy Abuse Prevention and Consumer Protection Act statistics)"),
    "wiretap": ("uscourts_wiretap", "Court-authorized intercepts - Wiretap report tables by jurisdiction and calendar year (U.S. Courts: Wiretap Reports)"),
}
FAMILY_OF_PUB = {"BAPCPA": "bapcpa", "WIRETAP": "wiretap"}


def dsid(kind, family="tables"):
    """Dataset id a record of this kind (district, bankruptcy, circuit, county, national) is published under."""
    return DATASETS[kind][0] if family == "tables" else FAMILIES[family][0]


def family_of(docs):
    fams = {FAMILY_OF_PUB.get(d["norm"]["pub"], "tables") for d in docs}
    return fams.pop() if len(fams) == 1 else "tables"
FIPS_STATE = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
}
LISTING_COLUMNS = [("court", "Court"), ("table", "Table"), ("title", "Table title"), ("first", "First period ends"), ("last", "Last period ends"), ("periods", "Periods")]
ARCOMB = "arcomb"
ARCOMB_TITLE = "U.S. Bankruptcy Court, Arkansas (Eastern and Western districts, reported as one court)"
NOT_DUPLICATED = {
    "court_stats_district_nos / _district_times / _circuits / _national": "Judicial Business C, C-2A, C-3, C-5, C-6, C-11, X-1A, B, B-4, B-7 for FY2014-FY2025 (product-liability orientation); the same tables here add the Statistical Tables and Caseload Statistics periods and every other column.",
    "court_jb_districts / _circuits / _civil_nos / _bankruptcy": "Judicial Business C-4, C-4A, F-2, S-19, S-20 and T-1 for FY2005-FY2025; not re-published here for the periods those datasets hold.",
    "fcms_court_profiles / fcms_circuit_rollups / fcms_analytics": "Federal Court Management Statistics profiles (weighted filings per judgeship, vacant judgeship months, median times, civil cases over three years old) 1999-2026; not re-acquired.",
    "court_cjra_*, court_jff_series, judicial_vacancies, fjc_*": "Civil Justice Reform Act reports, Judicial Facts and Figures (30 series), vacancies and the FJC Integrated Database; not re-acquired.",
}
METHOD_RULES = [
    "Every figure is the value of a cell in a table the U.S. Courts published; floats are rounded to 6 decimals, nothing else is computed, estimated or interpolated.",
    "A workbook cell formatted as a percentage holds a fraction that the table prints times 100 (0.901 is printed 90.1%); such cells are stored as the printed percentage, so every percent column is in percentage points in every period (figures read from PDFs are printed that way already). Until 2026-10-24 these cells were stored as fractions.",
    "A period is the publisher's own 'N-month period ending <date>': Judicial Business ends September 30, Statistical Tables for the Federal Judiciary June 30 and December 31, Federal Judicial Caseload Statistics March 31, Bankruptcy Filings every quarter end. Points from different month-ends are separate periods of overlapping 12-month windows and are never added together.",
    "A cell the publisher printed as a dash is kept as a dash position (value not recorded), never as zero; a court, column or period the table does not print is a gap.",
    "Columns that only repeat the previous year's figure beside the current year are not stored as series; the percent-change column the publisher prints is.",
    "A change of column set, table title or footnote wording between consecutive periods of the same publication is recorded as a break at that period (breaks[]), and footnotes attached to a court's row or column heading are kept with the periods they apply to (marks[]).",
    "Bankruptcy courts are keyed by the id of their district; the combined Arkansas court is the record arcomb. Circuit rows are the roll-ups the publisher prints (the D.C. Circuit is the D.C. district row).",
    "Where two publications print the same table for the same period end, the higher-priority one (Judicial Business, then Statistical Tables, Caseload Statistics, Bankruptcy Filings) that is not held is stored and the other is listed in the build report.",
    "Every table-period is reconciled against the totals it prints: the Total row over the circuit rows, each circuit over its districts, each district over its counties, each category row over the rows indented under it, and each Total column over the other columns of its heading group, on count columns only and with exact arithmetic (a printed dash counts as no cases). A relation counts as one of the table's printed totals when it holds in at least three of every four tests across the table's editions (for one column, and for one court or row when it has four tests or more).",
    "A table-period that breaks one of its printed totals is held: it is not published, and the period, its file and the failing figures are listed in the record (rec.held) and in the method record. A held period another publication prints for the same date is taken from that publication. Parts adding up to more than their total, and a court roll-up that differs in either direction, hold the period; a category or column total larger than its printed parts means the total also counts parts the table does not print, so it is counted (rec.exceedsParts) and does not hold the period; a failure the period's own footnote explains ('Totals include ...') is counted as explained.",
    "Editions published only as PDF (before 2017 and 2018) are read for court-by-court tables only, from the PDF text layer, and a period is kept only if the table id and period match the listing, the court set equals the spreadsheet edition that names the columns, every row carries the full figure count, the years printed over the columns are in the reference order and every roll-up sum holds; otherwise the period is a gap. These periods are marked fmt 'pdf' in the record's sources and by a 'source' break where spreadsheets begin; their footnotes are not transcribed.",
    "Bankruptcy Filings workbooks before 2009 are mainframe printouts whose column headings cannot be read without guessing; those periods are left out.",
    "Each period keeps the figure printed in its own edition. The next edition's prior-year column can show a revised figure (mostly for cases pending); it is not used to replace the earlier figure.",
    "A court the table prints twice with different figures in one period (a footnoted row and a plain row with the same label) is a gap for that period; neither row is chosen. Tables with sub-rows under each court (by nature of suit, by offense) keep the court rows only.",
]


def load_docs():
    docs = []
    for path in sorted(PARSED.glob("*/*/*.json.gz")):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        for norm in doc["sheets"]:
            docs.append({"norm": norm, "source": doc["source"], "path": str(path.relative_to(F.ROOT))})
    return docs


def group_docs(docs):
    groups = defaultdict(list)
    for d in docs:
        groups[(d["norm"]["table_key"], d["norm"]["scope"])].append(d)
    return groups


def title_of(norm):
    """The table title as printed; a workbook that prints only its table number (H-3A) takes the title the listing gives it."""
    return norm.get("title") or norm.get("title_listing") or ""


def latest_title(docs):
    return title_of(docs[-1]["norm"])


def table_info(docs):
    last = docs[-1]["norm"]
    return {"table": last["table"], "table_key": last["table_key"]}


def source_page(docs):
    return docs[-1]["source"].get("page") or LISTING_URL


def pub_text(code):
    return PUB_NAMES.get(code, code)


def facts_for(kind, court_title, label, table, title, payload):
    first, last = payload["periods"][0], payload["periods"][-1]
    pubs = sorted({p["pub"] for p in payload["periods"]})
    months = sorted({p["months"] for p in payload["periods"] if p["months"] is not None})
    facts = [
        [kind, court_title] if court_title else ["Scope", "National"],
        ["Table", f"{table} - {title}"],
        ["Periods", f"{len(payload['periods'])}, from the period ending {first['end']} to the period ending {last['end']}"],
        ["Period length", ", ".join("point in time (as of the date)" if m == 0 else f"{m} months" for m in months) if months else "As published"],
        ["Publications", "; ".join(pub_text(p) for p in pubs)],
    ]
    if label:
        facts.append(["Row label as published", label])
    if payload.get("breaks"):
        facts.append(["Breaks in the series", f"{len(payload['breaks'])} (a column set, footnote or title change; see the series notes)"])
    return facts


def make_record(dataset, rid, title, subtitle, search_text, cells, facts, links, payload, source_url, filters):
    return cw.record(dataset, rid, title, source_url=source_url, cells=cells, facts=facts, text=search_text, filters=filters, subtitle=subtitle, links=links,
                     extra={"ust": payload})


def court_record(dataset, court_id, court_title, payload, docs, bankruptcy_court=None, circuit_id=None, link_court=True):
    first, last = payload["periods"][0]["end"], payload["periods"][-1]["end"]
    table, tkey, title = payload["table"], payload["tableKey"], payload["title"]
    cells = {"court": court_title, "table": table, "title": title, "first": first, "last": last, "periods": len(payload["periods"])}
    subtitle = f"Table {table} · {len(payload['periods'])} periods ending {first} to {last}"
    links = ([{"url": f"/courts/{court_id}", "label": "Court profile"}] if link_court else []) + [{"url": source_page(docs), "label": "U.S. Courts table page (latest period)"}]
    facts = facts_for("Court", court_title, payload.get("courtLabel"), table, title, payload)
    if bankruptcy_court:
        facts.append(["Bankruptcy court id", bankruptcy_court])
    filters = {"table": [table], "court": [court_id], "scope": [payload["scope"]]}
    if circuit_id:
        filters["circuit"] = [circuit_id]
    return make_record(dataset, f"{court_id}:{tkey}", f"{court_title} - Table {table}: {title}", subtitle, f"{court_title} {table} {title}", cells, facts, links, payload,
                       source_page(docs), filters)


def national_payload(info, title, docs, cols, rows, totals, row_scope, rec=None):
    periods, sources = B.periods_block(docs)
    used = [c for c in cols.values() if any(any(v is not None for v in r["data"].get(c["k"], [])) for r in rows)]
    keys = {c["k"] for c in used}
    return {
        "v": 1, "scope": "national", "rowScope": row_scope, "table": info["table"], "tableKey": info["table_key"], "title": title,
        "periods": periods, "cols": [{k: c[k] for k in ("k", "label", "unit", "dec", "le")} for c in used],
        "rows": [{**r, "data": {k: v for k, v in r["data"].items() if k in keys}, "marks": [m for m in r.get("marks", []) if m["col"] is None or m["col"] in keys]} for r in rows],
        "totals": {k: v for k, v in totals.items() if k in keys and any(x is not None for x in v)},
        "notes": B.note_groups(docs), "breaks": B.find_breaks(docs), "src": sources, **({"rec": rec} if rec else {}),
    }


def national_record(payload, page, family="tables"):
    dataset = dsid("national", family)
    table, tkey, title = payload["table"], payload["tableKey"], payload["title"]
    first, last = payload["periods"][0]["end"], payload["periods"][-1]["end"]
    cells = {"court": "United States", "table": table, "title": title, "first": first, "last": last, "periods": len(payload["periods"])}
    facts = facts_for("Scope", None, None, table, title, payload) + [["Rows", f"{len(payload['rows'])} as published"]]
    return make_record(dataset, tkey, f"Table {table}: {title}", f"{len(payload['periods'])} periods ending {first} to {last}", f"United States national {table} {title}", cells, facts,
                       [{"url": page, "label": "U.S. Courts table page (latest period)"}], payload, page, {"table": [table], "scope": [payload.get("rowScope", "national")]})


def display_name(label):
    """The published county label (upper case) in readable case: 'PRINCE GEORGE'S' -> "Prince George's"; the published form is kept in the payload."""
    return " ".join(w[:1].upper() + w[1:].lower() if w[:1].isalpha() else (w[:2].upper() + w[2:].lower() if len(w) > 1 else w) for w in label.split())


def build_county_group(docs, out, report, rec=None):
    """County table (F-5A): one `table:<key>` record holding what every county shares (periods, columns, sources, footnotes, breaks,
    the national Total row and each district's own row), and one record per county FIPS code holding that county's series under each
    district whose bankruptcy court received its cases (a county's filers can file in another district: the `*` rows)."""
    docs = B.prepare(docs)
    cols = B.collect_columns(docs)
    info = table_info(docs)
    title = latest_title(docs)
    nat = B.series_for(docs, cols, ("national", "national"))
    periods, sources = B.periods_block(docs)
    present = OrderedDict()
    for d in docs:
        for key in d["rows_by_entity"]:
            present.setdefault(key, True)
    page = source_page(docs)
    dataset = DATASETS["county"][0]
    tkey = info["table_key"]
    by_fips = OrderedDict()
    for (kind, eid) in present:
        if kind == "county":
            fips, district = eid.split(":")
            by_fips.setdefault(fips, []).append(district)
    col_list = [{k: c[k] for k in ("k", "label", "unit", "dec", "le")} for c in cols.values()]
    district_rows = {}
    for district in sorted({dist for ds in by_fips.values() for dist in ds}):
        if ("district", district) in present:
            data, dash, _ = B.series_for(docs, cols, ("district", district))
            district_rows[district] = {"data": {k: v for k, v in data.items() if any(x is not None for x in v)}, "dash": dash}
    # footnotes on a column heading apply to every county: stored once here, not in each county record
    heading_marks = B.marks_block(docs, set(cols), ("county", "none"))
    heading_keys = {(m["col"], m["text"], tuple(m["at"])) for m in heading_marks}
    shared = {"v": 1, "kind": "county-table", "marks": heading_marks, "scope": "county", "table": info["table"], "tableKey": tkey, "title": title, "periods": periods, "cols": col_list,
              "nat": nat[0], "natDash": nat[1], "districtRows": district_rows, "notes": B.note_groups(docs), "breaks": B.find_breaks(docs), "src": sources,
              **({"rec": rec} if rec else {})}
    out[("tables", "county")].append(make_record(dataset, f"table:{tkey}", f"Table {info['table']}: {title} (shared periods, columns, sources and totals)",
                                     f"{len(periods)} periods ending {periods[0]['end']} to {periods[-1]['end']}", f"{info['table']} {title}",
                                     {"court": "All counties", "table": info["table"], "title": title, "first": periods[0]["end"], "last": periods[-1]["end"], "periods": len(periods), "fips": ""},
                                     [["Table", f"{info['table']} - {title}"], ["Counties", str(len(by_fips))]], [{"url": page, "label": "U.S. Courts table page (latest period)"}], shared, page,
                                     {"table": [info["table"]], "scope": ["county-table"]}))
    for fips, districts in by_fips.items():
        usps = FIPS_STATE.get(fips[:2])
        entries, label = [], None
        for district in districts:
            eid = f"{fips}:{district}"
            data, dash, lab = B.series_for(docs, cols, ("county", eid))
            kept = {k: v for k, v in data.items() if any(x is not None for x in v) or dash.get(k)}
            if not kept:
                continue
            label = label or lab
            entry = {"district": district, "label": lab, "data": kept, "dash": {k: v for k, v in dash.items() if k in kept},
                     "marks": [m for m in B.marks_block(docs, set(kept), ("county", eid)) if (m["col"] is None or m["col"] in kept) and (m["col"], m["text"], tuple(m["at"])) not in heading_keys]}
            outside = [i for i, d in enumerate(docs) if (d["rows_by_entity"].get(("county", eid)) or {}).get("outside_district")]
            if outside:
                entry["outsideAt"] = outside
            entries.append(entry)
        if not entries:
            continue
        payload = {"v": 1, "scope": "county", "fips": fips, "state": usps, "courtLabel": label, "table": info["table"], "tableKey": tkey, "ref": f"table:{tkey}", "districts": entries}
        name = display_name(label or fips)
        first, last = periods[0]["end"], periods[-1]["end"]
        district_names = [TITLES["district_titles"].get(e["district"], e["district"]).replace("U.S. District Court", "U.S. Bankruptcy Court") for e in entries]
        cells = {"court": f"{name} County, {usps or fips[:2]} (FIPS {fips})", "table": info["table"], "title": title, "first": first, "last": last, "periods": len(periods), "fips": fips}
        facts = [["County", f"{name} (FIPS {fips})"], ["State", usps or fips[:2]], ["Table", f"{info['table']} - {title}"],
                 ["Periods", f"{len(periods)}, from the period ending {first} to the period ending {last}"], ["Row label as published", label or ""],
                 ["Bankruptcy courts that received its cases", "; ".join(district_names)]]
        links = ([{"url": f"/places/{usps}", "label": f"{usps} state page"}] if usps else []) + [{"url": page, "label": "U.S. Courts table page (latest period)"}]
        rec = make_record(dataset, f"{fips}:{tkey}", f"{name} County, {usps or ''} - Table {info['table']}: {title}", f"FIPS {fips} · {len(entries)} reporting districts · {len(periods)} periods ending {first} to {last}",
                          f"{name} county {usps or ''} {fips} {info['table']} {title}", cells, facts, links, payload, page,
                          {"table": [info["table"]], "fips": [fips], "state": [usps] if usps else [], "district": sorted({e["district"] for e in entries})})
        rec["state"] = usps or ""
        out[("tables", "county")].append(rec)


def build_court_group(scope, docs, out, report, latest, family="tables", rec=None):
    """Records for a district / bankruptcy / appeals table: one per court, plus circuit roll-up records."""
    docs = B.prepare(docs)
    cols = B.collect_columns(docs)
    info = table_info(docs)
    title = latest_title(docs)
    nat = B.series_for(docs, cols, ("national", "national"))
    nat_pair = (nat[0], nat[1])
    mapping, conflicts = B.circuit_of_districts(docs)
    if conflicts:
        report["circuit_conflicts"].append({"table": info["table_key"], "conflicts": conflicts[:5]})
    present = OrderedDict()
    for d in docs:
        for key in d["rows_by_entity"]:
            present.setdefault(key, True)
    tkey = info["table_key"]
    nat_rows = [{"k": "total", "label": "Total", "path": ["Total"], "depth": 0, "data": {k: v for k, v in nat[0].items() if any(x is not None for x in v)}, "dash": nat[1],
                 "marks": B.marks_block(docs, set(cols), ("national", "national"))}]
    out[(family, "national")].append(national_record(national_payload(info, title, docs, cols, nat_rows, nat[0], scope, rec), source_page(docs), family))
    page = source_page(docs)
    lkey = (family, scope if scope != "appeals" else "circuit", tkey)

    def with_rec(payload):
        if payload is not None and rec:
            payload["rec"] = rec
        return payload

    if scope in ("district", "bankruptcy"):
        dataset = dsid(scope, family)
        for (kind, eid) in present:
            if kind == "district":
                if eid == "arcomb":
                    court_title = ARCOMB_TITLE
                else:
                    court_title = TITLES["district_titles"].get(eid)
                if not court_title:
                    report["unknown_courts"].add(eid)
                    continue
                if scope == "bankruptcy" and eid != "arcomb":
                    court_title = court_title.replace("U.S. District Court", "U.S. Bankruptcy Court")
                circuit_id = mapping.get(eid)
                circ = None
                if circuit_id and ("circuit", circuit_id) in present:
                    circ = B.series_for(docs, cols, ("circuit", circuit_id))[0]
                elif circuit_id == "cadc":
                    circ = B.series_for(docs, cols, ("district", "dcd"))[0]
                payload = with_rec(B.drop_empty(B.court_payload(scope, eid, docs, cols, info, title, nat_pair, circuit_id, circ, ("district", eid))))
                if not payload:
                    continue
                bk = TITLES["district_to_bankruptcy"].get(eid) if scope == "bankruptcy" else None
                out[(family, scope)].append(court_record(dataset, eid, court_title, payload, docs, bankruptcy_court=bk, circuit_id=circuit_id, link_court=eid != "arcomb"))
                latest[(family, scope, tkey)].setdefault("courts", {})[eid] = {k: v[-1] for k, v in payload["data"].items() if v and v[-1] is not None}
                latest[(family, scope, tkey)].update({"cols": cols, "end": docs[-1]["norm"]["period_end"], "title": title, "table": info["table"], "page": page})
        for (kind, eid) in present:  # circuit roll-up rows the publisher prints
            if kind == "circuit":
                circuit_title = TITLES["circuit_titles"].get(eid)
                if not circuit_title:
                    report["unknown_courts"].add(eid)
                    continue
                payload = with_rec(B.drop_empty(B.court_payload("circuit", eid, docs, cols, info, title, nat_pair, eid, None, ("circuit", eid), rollup_of=scope)))
                if payload:
                    out[(family, "circuit")].append(court_record(dsid("circuit", family), eid, circuit_title, payload, docs, circuit_id=eid))
        if ("district", "dcd") in present:  # the D.C. Circuit's row is the D.C. district row
            payload = with_rec(B.drop_empty(B.court_payload("circuit", "cadc", docs, cols, info, title, nat_pair, "cadc", None, ("district", "dcd"), rollup_of=scope)))
            if payload:
                out[(family, "circuit")].append(court_record(dsid("circuit", family), "cadc", TITLES["circuit_titles"]["cadc"], payload, docs, circuit_id="cadc"))
    else:  # appeals
        for (kind, eid) in present:
            if kind == "circuit":
                circuit_title = TITLES["circuit_titles"].get(eid)
                if not circuit_title:
                    report["unknown_courts"].add(eid)
                    continue
                payload = with_rec(B.drop_empty(B.court_payload("appeals", eid, docs, cols, info, title, nat_pair, eid, None, ("circuit", eid))))
                if payload:
                    out[(family, "circuit")].append(court_record(dsid("circuit", family), eid, circuit_title, payload, docs, circuit_id=eid))
                    latest[lkey].setdefault("courts", {})[eid] = {k: v[-1] for k, v in payload["data"].items() if v and v[-1] is not None}
                    latest[lkey].update({"cols": cols, "end": docs[-1]["norm"]["period_end"], "title": title, "table": info["table"], "page": page})


def latest_records(latest, out):
    """One record per court-level table with every court's value in the table's latest period, for rankings and maps."""
    for (family, scope, tkey), info in sorted(latest.items()):
        courts = info.get("courts")
        if not courts:
            continue
        cols = info["cols"]
        used = [c for c in cols.values() if any(c["k"] in v for v in courts.values())]
        payload = {"v": 1, "kind": "latest", "scope": scope, "table": info["table"], "tableKey": tkey, "title": info["title"], "end": info["end"],
                   "cols": [{k: c[k] for k in ("k", "label", "unit", "dec", "le")} for c in used], "courts": courts}
        dataset = dsid(scope, family)
        rec = make_record(dataset, f"latest:{tkey}", f"Latest period, all courts - Table {info['table']}: {info['title']}", f"Period ending {info['end']} · {len(courts)} courts",
                          f"latest {info['table']} {info['title']}", {"court": "All courts", "table": info["table"], "title": info["title"], "first": info["end"], "last": info["end"], "periods": 1},
                          [["Scope", "All courts, latest period"], ["Table", f"{info['table']} - {info['title']}"], ["Period ends", info["end"]], ["Courts", str(len(courts))]],
                          [{"url": info["page"], "label": "U.S. Courts table page (latest period)"}], payload, info["page"], {"table": [info["table"]], "scope": ["latest"]})
        out[(family, scope)].append(rec)


def catalog_of(chosen_by_group):
    cat = OrderedDict()
    for (tkey, scope), chosen in sorted(chosen_by_group.items()):
        if not chosen:
            continue
        e = cat.setdefault(tkey, {"tableKey": tkey, "table": chosen[-1]["norm"]["table"], "title": title_of(chosen[-1]["norm"]), "scopes": [], "ends": set(), "pubs": set()})
        if scope not in e["scopes"]:
            e["scopes"].append(scope)
        for d in chosen:
            e["ends"].add(d["norm"]["period_end"])
            e["pubs"].add(d["norm"]["pub"])
    return [{"tableKey": e["tableKey"], "table": e["table"], "title": e["title"], "scopes": e["scopes"], "firstEnd": min(e["ends"]), "lastEnd": max(e["ends"]), "periods": len(e["ends"]),
             "pubs": sorted(e["pubs"])} for e in cat.values()]


def listing_block(rows):
    tables = sorted({r["item"]["cells"]["table"] for r in rows if "table" in r["item"].get("cells", {})})
    return cw.listing(LISTING_COLUMNS, filters=[("table", "Table", {t: t for t in tables})])


def finish(dataset, label, rows, inputs, verification, publications=None):
    first = min((r["item"]["cells"]["first"] for r in rows if r["item"]["cells"].get("first")), default=None)
    last = max((r["item"]["cells"]["last"] for r in rows if r["item"]["cells"].get("last")), default=None)
    rows = sorted(rows, key=lambda r: r["id"])
    summary = {
        "source": "U.S. Courts, Administrative Office: statistical tables at https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables",
        "publications": [pub_text(p) for p in (publications or PUB_NAMES)],
        "records": len(rows), "first_period_end": first, "last_period_end": last,
        "rules": METHOD_RULES,
        "published_by": "enrich/publish_build",
        "verification": verification,
    }
    return {"dataset": dataset, "label": label, "listing_block": listing_block(rows), "summary": summary, "rows": rows,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inputs": inputs}


def held_entry(doc, period):
    return {"end": doc["norm"]["period_end"], "pub": doc["norm"]["pub"], "tableNumber": doc["norm"]["table"], "url": doc["source"]["url"], "page": doc["source"].get("page"),
            "sha256": doc["source"].get("sha256"), "failures": period["failures"][:5], "failureCount": period["failure_count"]}


def rec_summary(rec, chosen, held):
    """What the payload says about the table's own totals: the series status, the tests on the published periods and the held periods."""
    used = {(d["norm"]["pub"], d["norm"]["period_end"]) for d in chosen}
    pub_periods = [p for p in rec["periods"] if (p["pub"], p["end"]) in used]
    return {"status": rec["status"], "tests": sum(p["tests"] for p in pub_periods), "passed": sum(p["passed"] for p in pub_periods),
            "exceedsParts": sum(p["total_exceeds_parts"] for p in pub_periods), "explained": sum(p["explained"] for p in pub_periods),
            "noTotals": sum(1 for p in pub_periods if p["status"] in ("no_totals", "not_sums")), "held": held}


def main():
    out_dir, only = BUILD, None
    if "--out" in sys.argv:
        out_dir = F.ROOT / sys.argv[sys.argv.index("--out") + 1]
        out_dir.mkdir(parents=True, exist_ok=True)
    if "--tables" in sys.argv:
        only = {t.strip() for t in sys.argv[sys.argv.index("--tables") + 1].split(",")}
    docs = load_docs()
    groups = group_docs(docs)
    if only:
        groups = {k: v for k, v in groups.items() if k[0] in only}
    report = {"circuit_conflicts": [], "unknown_courts": set(), "duplicate_periods": [], "groups": {}, "rollup_failures": {}, "entity_conflicts": [], "dropped_groups": [],
              "held": [], "reconciliation": {}}
    # One table key is one table. If a workbook position ("-s5") holds a different kind of sheet in a few editions, the scope with the
    # most periods is the table and the stray sheets are reported, not published under the same key.
    by_key = defaultdict(list)
    for (tkey, scope), gdocs in groups.items():
        by_key[tkey].append((scope, len({d["norm"]["period_end"] for d in gdocs})))
    for tkey, items in by_key.items():
        if len(items) > 1:
            keep = max(items, key=lambda x: x[1])[0]
            for scope, n in items:
                if scope != keep:
                    report["dropped_groups"].append({"table": tkey, "scope": scope, "periods": n, "kept_scope": keep})
                    del groups[(tkey, scope)]
    out = defaultdict(list)
    latest = defaultdict(dict)
    used_sources = defaultdict(dict)
    chosen_by_group, series_info = {}, []
    for (tkey, scope), gdocs in sorted(groups.items()):
        family = family_of(gdocs)
        ordered = sorted(gdocs, key=lambda d: (d["norm"]["period_end"], B.PUB_PRIORITY.get(d["norm"]["pub"], 9)))
        rec = R.reconcile_series([d["norm"] for d in ordered])
        status = {(p["pub"], p["end"]): p for p in rec["periods"]}
        held_docs = [d for d in ordered if status[(d["norm"]["pub"], d["norm"]["period_end"])]["status"] == "held"]
        usable = [d for d in ordered if d not in held_docs]
        chosen, dropped = B.pick_docs(usable)
        # a held edition whose period another publication prints is replaced by that publication's figures; otherwise the period is a gap
        held = [held_entry(d, status[(d["norm"]["pub"], d["norm"]["period_end"])]) for d in held_docs]
        for h in held:
            h["replacedBy"] = next((d["norm"]["pub"] for d in chosen if d["norm"]["period_end"] == h["end"]), None)
            report["held"].append({"table": tkey, "scope": scope, **h})
        report["reconciliation"][f"{tkey}|{scope}"] = {"status": rec["status"], "identities": rec["identities"],
                                                       "periods": {f"{p['pub']} {p['end']}": p["status"] for p in rec["periods"]}}
        if dropped:
            report["duplicate_periods"].extend({"table": tkey, "tableNumber": ordered[-1]["norm"]["table"], **x} for x in dropped)
        if not chosen:
            report["dropped_groups"].append({"table": tkey, "scope": scope, "periods": 0, "reason": "every period held"})
            continue
        chosen_by_group[(tkey, scope)] = chosen
        rs = rec_summary(rec, chosen, held)
        for d in chosen:
            used_sources[family][d["source"]["sha256"]] = {"url": d["source"]["url"], "path": d["path"], "sha256": d["source"]["sha256"]}
        if scope == "county":
            if "--county" in sys.argv:  # the county dataset is large; it is rebuilt only on request
                build_county_group([dict(d) for d in chosen], out, report, rs)
        elif scope in ("district", "bankruptcy", "appeals"):
            fails = 0
            for d in chosen:
                fails += len(C.rollup_failures(d["norm"]))
            report["rollup_failures"][f"{tkey}|{scope}"] = fails
            build_court_group(scope, [dict(d) for d in chosen], out, report, latest, family, rs)
        else:
            docs_p = B.prepare([dict(d) for d in chosen])
            cols = B.collect_columns(docs_p)
            info = table_info(docs_p)
            rows = B.category_rows(docs_p, cols)
            if rows:
                totals = rows[0]["data"] if rows[0]["label"].lower().startswith("total") else {}
                out[(family, "national")].append(national_record(national_payload(info, latest_title(docs_p), docs_p, cols, rows, totals, scope, rs), source_page(docs_p), family))
        report["groups"][f"{tkey}|{scope}"] = {"periods": len(chosen), "first": chosen[0]["norm"]["period_end"], "last": chosen[-1]["norm"]["period_end"], "family": family}
        series_info.append({"tableKey": tkey, "scope": scope, "family": family, "chosen": chosen, "held": held, "dropped": dropped, "rec": rs})
        # rows a table prints twice with different figures are left out of that period; list them (court-level entities only)
        for d in chosen:
            _, dup = B.row_index(d["norm"])
            dup = [f"{k}:{i}" for k, i in dup if k != "other"]
            if dup:
                report["entity_conflicts"].append({"table": tkey, "scope": scope, "period": d["norm"]["period_end"], "pub": d["norm"]["pub"], "entities": dup})
    latest_records(latest, out)
    # one record per table in a national dataset: a district-table Total and a category table with the same key cannot coexist
    report["duplicate_national_ids"] = []
    for key in [k for k in out if k[1] == "national"]:
        ids = [r["id"] for r in out[key]]
        dup = sorted({i for i in ids if ids.count(i) > 1})
        report["duplicate_national_ids"].extend(dup)
        if dup:
            seen, keep = set(), []
            for r in out[key]:
                if r["id"] in seen:
                    continue
                seen.add(r["id"])
                keep.append(r)
            out[key] = keep
    verification_path = BUILD / "verification.json"
    verification = json.loads(verification_path.read_text()).get("summary") if verification_path.exists() else None
    for family in ["tables"] + sorted(FAMILIES):
        fam_groups = {k: v for k, v in chosen_by_group.items() if family_of(v) == family}
        if not fam_groups:
            continue
        catalog = catalog_of(fam_groups)
        target = (family, "national")
        out[target].append(cw.record(dsid("national", family), "summary:catalog", "Table catalog", source_url=LISTING_URL, cells={"court": "All", "table": "Catalog", "title": f"{len(catalog)} tables",
                                     "first": min(c["firstEnd"] for c in catalog), "last": max(c["lastEnd"] for c in catalog), "periods": len(catalog)},
                                     facts=[["Tables", str(len(catalog))]], text="catalog of tables", filters={"table": ["catalog"], "scope": ["summary"]}, subtitle=f"{len(catalog)} tables",
                                     links=[{"url": LISTING_URL, "label": "U.S. Courts caseload statistics data tables"}], extra={"catalog": {"tables": catalog}}))
        per_scope = defaultdict(lambda: {"tables": 0, "periods_first": None, "periods_last": None})
        for c in catalog:
            for sc in c["scopes"]:
                e = per_scope[sc]
                e["tables"] += 1
                e["periods_first"] = min(filter(None, [e["periods_first"], c["firstEnd"]]))
                e["periods_last"] = max(filter(None, [e["periods_last"], c["lastEnd"]]))
        held_here = [h for h in report["held"] if family_of(groups[(h["table"], h["scope"])]) == family]
        method = {
            "rules": METHOD_RULES, "publications": {k: v for k, v in PUB_NAMES.items() if (family == "tables") == (k not in FAMILY_OF_PUB)},
            "scopes": dict(per_scope), "verification": verification, "held": held_here,
        }
        if family == "tables":
            method["not_duplicated"] = NOT_DUPLICATED
        out[target].append(cw.record(dsid("national", family), "summary:method", "Method and coverage", source_url=LISTING_URL,
                                     cells={"court": "All", "table": "Method", "title": "How the tables are read", "first": min(c["firstEnd"] for c in catalog), "last": max(c["lastEnd"] for c in catalog), "periods": len(catalog)},
                                     facts=[["Rules", str(len(METHOD_RULES))], ["Tables", str(len(catalog))], ["Held table-periods", str(len(held_here))]], text="method coverage rules",
                                     filters={"table": ["method"], "scope": ["summary"]},
                                     subtitle="Rules, publications and coverage", links=[{"url": LISTING_URL, "label": "U.S. Courts caseload statistics data tables"}], extra={"method": method}))
    builds = {}
    for key in DATASETS:
        if key == "county" and "--county" not in sys.argv:
            continue
        rows = out[("tables", key)]
        if rows:
            builds[DATASETS[key][0]] = finish(DATASETS[key][0], DATASETS[key][1], rows, sorted(used_sources["tables"].values(), key=lambda x: x["url"]), verification,
                                              [p for p in PUB_NAMES if p not in FAMILY_OF_PUB])
    for family, (dataset, label) in FAMILIES.items():
        rows = [r for (fam, _), rs in out.items() if fam == family for r in rs]
        if rows:
            builds[dataset] = finish(dataset, label, rows, sorted(used_sources[family].values(), key=lambda x: x["url"]), verification,
                                     [p for p, f in FAMILY_OF_PUB.items() if f == family])
    try:
        import series_index as SI
    except ImportError:  # the index builder is optional for partial builds
        SI = None
    if SI is not None and not only:
        index_build = SI.build_index(series_info, builds, report, verification)
        if index_build:
            builds[index_build["dataset"]] = index_build
    for dataset, build in builds.items():
        # written gzip-compressed (the volume is nearly full); publish_tables.py reads .json.gz build files as they are
        path = out_dir / f"{dataset}.json.gz"
        path.write_bytes(gzip.compress(json.dumps(build, sort_keys=True).encode(), compresslevel=6, mtime=0))
        stale = out_dir / f"{dataset}.json"
        if stale.exists():
            stale.unlink()
        sizes = sorted((len(json.dumps(r)) for r in build["rows"]), reverse=True)
        print(f"{dataset}: {len(build['rows'])} rows, {path.stat().st_size / 1e6:.1f} MB, largest record {sizes[0] / 1e3:.0f} KB" if sizes else f"{dataset}: none")
    report["unknown_courts"] = sorted(report["unknown_courts"])
    (out_dir / "build_report.json").write_text(json.dumps(report, indent=1, sort_keys=True))
    print("groups", len(groups), "unknown courts", report["unknown_courts"], "circuit conflicts", len(report["circuit_conflicts"]), "duplicate periods", len(report["duplicate_periods"]),
          "held table-periods", len(report["held"]))


if __name__ == "__main__":
    main()
