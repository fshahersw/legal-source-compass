"""Build the agencies_fr datasets from official sources stored unchanged under private/acq/agencies_fr/.

Inputs (see private/acq/agencies_fr/_manifest.jsonl for URL, sha256 and retrieval time of every file):
  fr/            federalregister.gov API v1: agency directory, agency facets (by year and type, administration windows,
                 recent months), FR-wide yearly/monthly/type facets, presidential-document facets, executive orders,
                 significant rule and proposed-rule listings by year, documents with open comment periods
  ecfr/          ecfr.gov admin API agencies (CFR title/chapter references) and versioner titles
  usaspending/   api.usaspending.gov: toptier agencies, agency overviews, budgetary resources, FY2025 sub-agency
                 obligations, FY2024/FY2025 award obligations by state (place of performance)
  census/        Census Bureau Vintage 2025 state population estimates (per-resident denominator)
  reginfo/       reginfo.gov Unified Agenda XML, publication 202510
  govman/        GovInfo U.S. Government Manual, 2025 edition (GOVMAN-2025-12-31)
  private/build/agencies_fr/lookups/  read-only corpus lookups (CFR parts cited per agency in federal_register_history;
                 enforcement datasets already in the corpus; corpus date range)

Writes private/build/agencies_fr/<dataset>.json for: fr_agency_profiles, fr_agency_trends, unified_agenda_pipeline,
agency_budget_trends, agency_spending_by_state (shape: CONTRACT.md "Output").

Usage: python3 -I -B scripts/enrichment/agencies_fr/build_agencies_fr.py [--as-of=2026-10-19]
"""
import collections
import csv
import datetime as dt
import glob
import gzip
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import parsers as P  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "agencies_fr")
OUT = os.path.join(ROOT, "private", "build", "agencies_fr")
LOOKUPS = os.path.join(OUT, "lookups")

FR_API = "https://www.federalregister.gov/api/v1/"
FR_DOCS = "https://www.federalregister.gov/developers/documentation/api/v1"
ECFR_AGENCIES = "https://www.ecfr.gov/api/admin/v1/agencies.json"
USA_DOCS = "https://api.usaspending.gov/docs/endpoints"
CENSUS_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
CENSUS_PAGE = "https://www.census.gov/data/tables/time-series/demo/popest/2020s-state-total.html"
UA_EDITION = "202510"
UA_URL = f"https://www.reginfo.gov/public/do/XMLViewFileAction?f=REGINFO_RIN_DATA_{UA_EDITION}.xml"
UA_INDEX = "https://www.reginfo.gov/public/do/eAgendaXmlReport"
UA_RULE = "https://www.reginfo.gov/public/do/eAgendaViewRule?pubId={}&RIN={}"
GOVMAN_URL = "https://www.govinfo.gov/bulkdata/GOVMAN/2025/GOVMAN-2025-12-31.zip"
GOVMAN_PAGE = "https://www.govinfo.gov/app/details/GOVMAN-2025-12-31"
AMENDMENT_XX = "https://www.archives.gov/founding-docs/amendments-11-27#toc-amendment-xx"
YEARS = [str(y) for y in range(1994, 2027)]
TYPES = ["RULE", "PRORULE", "NOTICE", "PRESDOCU"]
FY_LATEST = 2025

ADMINS = [
    # The API types most 1994 documents as uncategorized (128 rules in 1994 vs ~4,700 a year from 1995), so type
    # counts by administration start 1995-01-01 (the term began 1993-01-20).
    {"key": "clinton", "label": "Clinton", "president": "William J. Clinton", "start": "1995-01-01", "end": "2001-01-19"},
    {"key": "bush", "label": "G. W. Bush", "president": "George W. Bush", "start": "2001-01-20", "end": "2009-01-19"},
    {"key": "obama", "label": "Obama", "president": "Barack Obama", "start": "2009-01-20", "end": "2017-01-19"},
    {"key": "trump1", "label": "Trump (1st term)", "president": "Donald Trump", "start": "2017-01-20", "end": "2021-01-19"},
    {"key": "biden", "label": "Biden", "president": "Joseph R. Biden Jr.", "start": "2021-01-20", "end": "2025-01-19"},
    {"key": "trump2", "label": "Trump (2nd term)", "president": "Donald Trump", "start": "2025-01-20", "end": None},
]

# Unified Agenda agency names that an official act assigns to an agency the Federal Register lists by another name.
UA_ALIASES = {
    # Executive Order 14347 (90 FR 43893, 2025-09-10) authorizes "Department of War" as a secondary title of the
    # Department of Defense; the Federal Register agency list still names it "Defense Department".
    "Department of War": ("Defense Department",
                          "https://www.federalregister.gov/documents/2025/09/10/2025-17508/restoring-the-united-states-department-of-war"),
}

# Corpus datasets built from an agency's own published data, keyed by Federal Register agency id. The agency is
# the publisher named in each dataset's label/source; no dataset is attributed by topic.
ENFORCEMENT = {
    199: {"label": "Food and Drug Administration", "page": {"to": "/safety", "search": {"agency": "FDA"}},
          "datasets": ["agency_safety_openfda_drug_enforcement", "agency_safety_openfda_device_enforcement",
                       "agency_safety_openfda_food_enforcement", "agency_safety_fda_warning_letters",
                       "agency_safety_fda_press_recalls", "agency_safety_openfda_crl", "agency_safety_openfda_drugsfda",
                       "agency_safety_openfda_device_pma", "agency_safety_openfda_drug_shortages",
                       "agency_safety_openfda_device_classification_20261002", "fda_faers_national_series",
                       "fda_faers_product_series", "fda_device_event_series", "fda_caers_series"]},
    84: {"label": "Consumer Product Safety Commission", "page": {"to": "/law/enforcement", "search": {"tab": "cpsc"}},
         "datasets": ["agency_safety_cpsc_recalls_api", "agency_safety_cpsc_recalls_local", "regulatory_cpsc_aggregates"]},
    345: {"label": "National Highway Traffic Safety Administration", "page": {"to": "/safety", "search": {"agency": "NHTSA"}},
          "datasets": ["agency_safety_nhtsa_recalls", "agency_safety_nhtsa_investigations",
                       "agency_safety_nhtsa_complaint_trends"]},
    145: {"label": "Environmental Protection Agency", "page": {"to": "/law/enforcement", "search": {}},
          "datasets": ["regulatory_epa_cases", "epa_echo_case_series", "epa_echo_defendants", "epa_echo_state_programs",
                       "regulatory_epa_state_profiles"]},
    386: {"label": "Occupational Safety and Health Administration", "page": {"to": "/law/enforcement", "search": {"tab": "osha"}},
          "datasets": ["osha_inspections_national", "osha_inspections_states", "osha_employers", "osha_severe_injuries"]},
    192: {"label": "Federal Trade Commission", "page": None,
          "datasets": ["ftc_sentinel_national", "ftc_sentinel_states", "ftc_dnc_states", "ftc_refunds", "ftc_refund_programs"]},
    573: {"label": "Consumer Financial Protection Bureau", "page": {"to": "/law/enforcement", "search": {"tab": "cfpb"}},
          "datasets": ["cfpb_complaints_national", "cfpb_complaints_states", "cfpb_complaints_companies", "cfpb_research_reports"]},
    466: {"label": "Securities and Exchange Commission", "page": {"to": "/companies", "search": {}},
          "datasets": ["company_sec_profiles", "company_sec_statements", "company_sec_financials", "company_sec_segments",
                       "company_sec_ir_documents", "company_sec_mdl_links"]},
}


# ---------------------------------------------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------------------------------------------
_used = {}


def manifest():
    entries = {}
    with open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                e = json.loads(line)
                entries[e["path"]] = e
    return entries


MANIFEST = {}


def raw_path(rel):
    return os.path.join(ACQ, rel)


def note_input(rel):
    key = os.path.relpath(raw_path(rel), ROOT)
    entry = MANIFEST.get(key)
    if entry is None:
        raise SystemExit(f"{rel} is not in the manifest")
    _used[key] = {"url": entry["url"], "path": key, "sha256": entry["sha256"]}
    return entry


def load_json(rel):
    note_input(rel)
    with open(raw_path(rel), "rb") as fh:
        return json.loads(fh.read())


def load_lookup(name):
    with open(os.path.join(LOOKUPS, name), encoding="utf-8") as fh:
        return json.load(fh)


def inputs_for(prefixes):
    return [v for k, v in sorted(_used.items()) if any(k.startswith(p) for p in prefixes)]


# ---------------------------------------------------------------------------------------------------------------
# Federal Register
# ---------------------------------------------------------------------------------------------------------------
def fr_directory():
    rows = load_json("fr/agencies.json")
    by_id = {}
    for r in rows:
        if isinstance(r.get("id"), int) and r.get("name") and r.get("slug"):
            by_id[r["id"]] = r
    by_slug = {r["slug"]: r["id"] for r in by_id.values()}
    return by_id, by_slug


def slug_counts(body, by_slug, unmapped):
    out = {}
    for slug, count in P.facet_counts(body).items():
        fid = by_slug.get(slug)
        if fid is None:
            unmapped[slug] += count
            continue
        out[fid] = count
    return out


def fr_facets(by_slug, as_of):
    unmapped = collections.Counter()
    yearly = collections.defaultdict(lambda: {t: {} for t in ["ALL"] + TYPES})
    for year in YEARS:
        for t in ["ALL"] + TYPES:
            for fid, n in slug_counts(load_json(f"fr/facets/agency_year/{t}_{year}.json"), by_slug, unmapped).items():
                yearly[fid][t][year] = n
    admin = collections.defaultdict(lambda: {t: {} for t in ["ALL", "RULE", "PRORULE", "NOTICE"]})
    for a in ADMINS:
        for t in ["ALL", "RULE", "PRORULE", "NOTICE"]:
            for fid, n in slug_counts(load_json(f"fr/facets/agency_admin/{t}_{a['key']}_{a['start']}.json"), by_slug, unmapped).items():
                admin[fid][t][a["key"]] = n
    monthly = collections.defaultdict(lambda: {t: {} for t in ["RULE", "PRORULE", "NOTICE"]})
    months = sorted({os.path.basename(p)[-12:-5] for p in glob.glob(raw_path("fr/facets/agency_month/RULE_*.json"))})
    for ym in months:
        for t in ["RULE", "PRORULE", "NOTICE"]:
            for fid, n in slug_counts(load_json(f"fr/facets/agency_month/{t}_{ym}.json"), by_slug, unmapped).items():
                monthly[fid][t][ym] = n
    return yearly, admin, monthly, months, unmapped


def admin_windows(as_of):
    out = []
    for a in ADMINS:
        end = a["end"] or as_of
        out.append({**a, "end": end, "days": P.window_days(a["start"], end), "current": a["end"] is None})
    return out


def significant_docs():
    """All significant RULE/PRORULE documents by year; the listing total must equal the documents returned."""
    docs, problems = [], []
    for year in YEARS:
        for t in ["RULE", "PRORULE"]:
            pages = sorted(glob.glob(raw_path(f"fr/significant/{t}_{year}_p*.json")))
            seen = set()
            total = None
            for p in pages:
                body = load_json(os.path.relpath(p, ACQ))
                total = body.get("count") if total is None else total
                for d in body.get("results") or []:
                    if P.doc_key(d) in seen:
                        continue
                    seen.add(P.doc_key(d))
                    d["_type"] = t
                    docs.append(d)
            if total is not None and total != len(seen):
                problems.append(f"{t} {year}: {len(seen)} of {total}")
    return docs, problems


def open_comment_docs(as_of):
    docs, total, seen = [], None, set()
    for p in sorted(glob.glob(raw_path(f"fr/comments/open_{as_of}_p*.json"))):
        body = load_json(os.path.relpath(p, ACQ))
        total = body.get("count") if total is None else total
        for d in body.get("results") or []:
            if P.doc_key(d) in seen:
                continue
            seen.add(P.doc_key(d))
            docs.append(d)
    if total is not None and total != len(docs):
        raise SystemExit(f"open comment listing returned {len(docs)} of {total}")
    return docs


def per_agency_docs(docs):
    out = collections.defaultdict(list)
    for d in docs:
        for fid in P.doc_agency_ids(d):
            out[fid].append(d)
    return out


def latest(docs, n):
    ordered = sorted(docs, key=lambda d: (d.get("publication_date") or "", d.get("document_number") or ""), reverse=True)
    out = []
    for d in ordered:
        c = P.compact_doc(d)
        if c:
            out.append(c)
        if len(out) >= n:
            break
    return out


def comment_items(docs, as_of, n):
    ordered = sorted(docs, key=lambda d: (d.get("comments_close_on") or "9999", d.get("document_number") or ""))
    out = []
    for d in ordered:
        c = P.compact_doc(d, abstract_chars=0)
        if not c:
            continue
        c.pop("abstract", None)
        c["significant"] = bool(d.get("significant"))
        out.append(c)
        if len(out) >= n:
            break
    return out


def days_between(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def comment_summary(docs, as_of, n):
    closing30 = sum(1 for d in docs if d.get("comments_close_on") and 0 <= days_between(as_of, d["comments_close_on"]) <= 30)
    by_type = collections.Counter(d.get("type") or P.NOT_RECORDED for d in docs)
    return {"asOf": as_of, "count": len(docs), "closingWithin30Days": closing30, "byType": dict(sorted(by_type.items())),
            "items": comment_items(docs, as_of, n)}


def significant_series(docs, windows):
    yearly = {"RULE": {}, "PRORULE": {}}
    by_admin = {"RULE": {}, "PRORULE": {}}
    for d in docs:
        t = d["_type"]
        y = (d.get("publication_date") or "")[:4]
        if y.isdigit():
            yearly[t][y] = yearly[t].get(y, 0) + 1
        key = P.admin_for_date(d.get("publication_date"), windows)
        if key:
            by_admin[t][key] = by_admin[t].get(key, 0) + 1
    return {t: dict(sorted(v.items())) for t, v in yearly.items()}, by_admin


# ---------------------------------------------------------------------------------------------------------------
# Unified Agenda
# ---------------------------------------------------------------------------------------------------------------
def unified_agenda(by_id, as_of):
    note_input(f"reginfo/REGINFO_RIN_DATA_{UA_EDITION}.xml.gz")
    with open(raw_path(f"reginfo/REGINFO_RIN_DATA_{UA_EDITION}.xml.gz"), "rb") as fh:
        root = ET.fromstring(gzip.decompress(fh.read()))
    run_date = root.get("RUN_DATE")
    entries = [P.parse_ua_rin(el, as_of[:7]) for el in root.findall("RIN_INFO")]
    fr_index, fr_dupes = P.unique_index(list(by_id.values()), lambda a: P.name_key(a["name"]))
    # Documented aliases only: a name an official act gives an agency the Federal Register lists under another name.
    for alias, (fr_name, _source) in UA_ALIASES.items():
        target = fr_index.get(P.name_key(fr_name))
        if target and P.name_key(alias) not in fr_index:
            fr_index[P.name_key(alias)] = target
    stats = collections.Counter()
    unmatched = collections.Counter()
    for e in entries:
        own = fr_index.get(P.name_key(e["agency"]["name"]))
        parent = fr_index.get(P.name_key(e["parent"]["name"])) if e["parent"] else None
        ids = []
        if own:
            ids.append(own["id"])
            e["agencyMatch"] = "normalized_name"
        elif parent:
            e["agencyMatch"] = ("parent_documented_alias" if e["parent"]["name"] in UA_ALIASES
                                else "parent_normalized_name")
        else:
            e["agencyMatch"] = None
            unmatched[e["agency"]["name"] + (" / " + e["parent"]["name"] if e["parent"] else "")] += 1
        if parent and parent["id"] not in ids:
            ids.append(parent["id"])
        e["frAgencyIds"] = ids
        e["frAgencyId"] = own["id"] if own else (parent["id"] if parent else None)
        stats[e["agencyMatch"] or "unmatched"] += 1
    return entries, run_date, stats, unmatched


# ---------------------------------------------------------------------------------------------------------------
# eCFR, Government Manual, USAspending, Census
# ---------------------------------------------------------------------------------------------------------------
def ecfr_refs(by_slug):
    body = load_json("ecfr/agencies.json")
    titles = {t["number"]: t["name"] for t in load_json("ecfr/titles.json").get("titles", [])}
    out, total = {}, 0

    def visit(agency, parent_slug):
        nonlocal total
        total += 1
        fid = by_slug.get(agency.get("slug"))
        refs = []
        for ref in agency.get("cfr_references") or []:
            title, chapter = ref.get("title"), ref.get("chapter")
            subtitle = ref.get("subtitle")
            if not isinstance(title, int):
                continue
            if chapter:
                url = f"https://www.ecfr.gov/current/title-{title}/chapter-{chapter}"
            elif subtitle:
                url = f"https://www.ecfr.gov/current/title-{title}/subtitle-{subtitle}"
            else:
                url = f"https://www.ecfr.gov/current/title-{title}"
            refs.append({"title": title, "titleName": titles.get(title), "chapter": chapter, "subtitle": subtitle,
                         "url": url})
        if fid is not None:
            out[fid] = {"ecfrName": agency.get("name"), "ecfrSlug": agency.get("slug"), "refs": refs}
        for child in agency.get("children") or []:
            visit(child, agency.get("slug"))

    for agency in body.get("agencies", []):
        visit(agency, None)
    return out, titles, total


def cfr_parts(titles):
    rows = load_lookup("fr_cfr_pairs_by_agency.json")["rows"]
    out = {}
    for row in rows:
        try:
            fid = int(row["agency"])
        except (TypeError, ValueError):
            continue
        parts, title_docs = [], collections.Counter()
        for chunk in (row.get("pairs") or "").split(";"):
            bits = chunk.split(",")
            if len(bits) != 5 or ":" not in bits[0]:
                continue
            title, part = bits[0].split(":", 1)
            if not title.isdigit() or not bits[1].isdigit() or not bits[2].isdigit():
                continue
            n, rules = int(bits[1]), int(bits[2])
            parts.append({"title": int(title), "part": part, "docs": n, "rules": rules, "first": bits[3], "last": bits[4],
                          "url": f"https://www.ecfr.gov/current/title-{int(title)}/part-{part}"})
            title_docs[int(title)] += n
        parts.sort(key=lambda p: (-p["docs"], p["title"], p["part"]))
        out[fid] = {
            "distinctParts": len(parts),
            "distinctTitles": len(title_docs),
            "top": parts[:25],
            "titles": [{"title": t, "titleName": titles.get(t), "partCitations": n}
                       for t, n in sorted(title_docs.items(), key=lambda x: (-x[1], x[0]))[:12]],
        }
    return out


def govman(by_id):
    note_input("govman/GOVMAN-2025-12-31.zip")
    with zipfile.ZipFile(raw_path("govman/GOVMAN-2025-12-31.zip")) as z:
        root = ET.fromstring(z.read(z.namelist()[0]))
    entities = P.govman_entities(root)
    children = collections.defaultdict(list)
    for e in entities:
        if e["parentEntityId"]:
            children[e["parentEntityId"]].append(e["name"])
    pairs, stats = P.match_names(list(by_id.values()), entities, lambda a: a["name"], lambda e: e["name"])
    out = {}
    for fr, ent in pairs:
        record = P.govman_record(ent, children.get(ent["entityId"], []))
        # Leadership tables are withheld: the 2025 edition (dated 2025-12-31) still prints officials who had left
        # office before 2025 (e.g. the FDA Commissioner and EPA Deputy Administrator listed), so its names cannot be
        # presented as of any date. Mission, components, legal authority and website are kept.
        stats_leaders = len(record.pop("leadership"))
        record["leadershipTablesWithheld"] = stats_leaders
        out[fr["id"]] = record
    stats["pairs"] = [[fr["name"], ent["name"]] for fr, ent in pairs]
    return out, stats, len(entities)


def usaspending(by_id):
    top = load_json("usaspending/toptier_agencies.json").get("results", [])
    pairs, stats = P.match_names(list(by_id.values()), top, lambda a: a["name"], lambda t: t["agency_name"])
    fr_by_code = {t["toptier_code"]: fr["id"] for fr, t in pairs}
    stats["pairs"] = [[fr["name"], t["agency_name"]] for fr, t in pairs]
    return top, fr_by_code, stats


def maybe_json(rel):
    if not os.path.exists(raw_path(rel)):
        return None
    return load_json(rel)


def budget_row(agency, fr_id, by_id):
    code = agency["toptier_code"]
    overview = maybe_json(f"usaspending/agency/{code}.json") or {}
    budget = maybe_json(f"usaspending/budget/{code}.json") or {}
    years = []
    for y in budget.get("agency_data_by_year") or []:
        fy = y.get("fiscal_year")
        if not isinstance(fy, int):
            continue
        resources, obligated = y.get("agency_budgetary_resources"), y.get("agency_total_obligated")
        if resources is None and obligated is None:
            continue
        periods = [p.get("period") for p in y.get("agency_obligation_by_period") or [] if isinstance(p.get("period"), int)]
        latest_period = max(periods) if periods else None
        years.append({
            "fy": fy,
            "budgetaryResources": resources,
            "obligated": obligated,
            "outlayed": y.get("agency_total_outlayed"),
            "governmentBudgetaryResources": y.get("total_budgetary_resources"),
            "sharePct": P.share_pct(resources, y.get("total_budgetary_resources")),
            "latestPeriod": latest_period,
            "partial": fy > FY_LATEST,
        })
    years.sort(key=lambda y: y["fy"])
    for i, y in enumerate(years):
        prev = years[i - 1] if i else None
        y["obligatedChangePct"] = P.pct_change(y["obligated"], prev["obligated"]) if prev and prev["fy"] == y["fy"] - 1 else None
    subs = []
    page = 1
    while True:
        body = maybe_json(f"usaspending/sub_agency/{code}_fy2025_p{page}.json")
        if not body:
            break
        for s in body.get("results") or []:
            if not s.get("name"):
                continue
            subs.append({"name": s["name"], "abbreviation": s.get("abbreviation") or None,
                         "obligations": s.get("total_obligations"), "transactions": s.get("transaction_count"),
                         "newAwards": s.get("new_award_count"),
                         "offices": len(s.get("children") or [])})
        if not (body.get("page_metadata") or {}).get("hasNext"):
            break
        page += 1
    subs.sort(key=lambda s: -(s["obligations"] or 0))
    # Sub-agency -> Federal Register component: unique normalized name among FR agencies under the matched parent.
    sub_matches = {}
    if fr_id is not None:
        components = [a for a in by_id.values() if a.get("parent_id") == fr_id]
        index, _ = P.unique_index(components, lambda a: P.name_key(a["name"]))
        for s in subs:
            fr = index.get(P.name_key(s["name"]))
            if fr:
                s["frAgencyId"] = fr["id"]
                sub_matches[fr["id"]] = {"name": s["name"], "obligations": s["obligations"], "fy": FY_LATEST,
                                         "parentToptierCode": code}
    return {
        "toptierCode": code,
        "name": agency["agency_name"],
        "abbreviation": agency.get("abbreviation"),
        "slug": agency.get("agency_slug"),
        "frAgencyId": fr_id,
        "frAgencyName": by_id[fr_id]["name"] if fr_id in by_id else None,
        "mission": (overview.get("mission") or "").strip() or None,
        "website": overview.get("website") if re.match(r"^https?://", overview.get("website") or "") else None,
        "congressionalJustificationUrl": agency.get("congressional_justification_url"),
        "usaspendingUrl": f"https://www.usaspending.gov/agency/{agency.get('agency_slug')}" if agency.get("agency_slug") else None,
        "years": years,
        "subAgencies": subs[:40],
        "subAgencyCount": len(subs),
    }, sub_matches


def population():
    note_input("census/NST-EST2025-ALLDATA.csv")
    with open(raw_path("census/NST-EST2025-ALLDATA.csv"), encoding="latin-1", newline="") as fh:
        rows = list(csv.DictReader(fh))
    names = {}
    for row in rows:
        usps = P.STATE_FIPS.get((row.get("STATE") or "").zfill(2))
        if usps and row.get("SUMLEV") == "040":
            names[usps] = row["NAME"]
    return P.census_population(rows), names


def geo_rows(code):
    """{fy: {USPS: amount}} plus {fy: amount whose place-of-performance state is blank in the response}."""
    out, blank = {}, {}
    for fy in (2024, 2025):
        body = maybe_json(f"usaspending/geo/{code}_fy{fy}.json")
        if body is None:
            out[fy] = None
            continue
        rows = body.get("results") or []
        out[fy] = {r["shape_code"]: r.get("aggregated_amount") for r in rows
                   if isinstance(r.get("shape_code"), str) and re.fullmatch(r"[A-Z]{2}", r["shape_code"])}
        blank[fy] = sum(r["aggregated_amount"] for r in rows if isinstance(r.get("aggregated_amount"), (int, float))
                        and not (isinstance(r.get("shape_code"), str) and re.fullmatch(r"[A-Z]{2}", r["shape_code"])))
    return out, blank


def spending_row(agency, fr_id, pop, names):
    code = agency["toptier_code"]
    geo, blank = geo_rows(code)
    if not geo.get(2025):
        return None
    states = []
    cur, prev = geo[2025], geo.get(2024) or {}
    state_total = sum(v for v in cur.values() if isinstance(v, (int, float)))
    total = state_total + blank.get(2025, 0)
    for usps, amount in cur.items():
        if not isinstance(amount, (int, float)):
            continue
        people = pop.get(usps)
        states.append({
            "code": usps,
            "name": names.get(usps) or usps,
            "fy2025": round(amount, 2),
            "fy2024": round(prev[usps], 2) if isinstance(prev.get(usps), (int, float)) else None,
            "changePct": P.pct_change(amount, prev.get(usps)),
            "population2025": people,
            "perResident": round(amount / people, 2) if people else None,
            "sharePct": P.share_pct(amount, total),
        })
    ranks = P.rank_desc({s["code"]: s["perResident"] for s in states})
    for s in states:
        s["perResidentRank"] = ranks.get(s["code"])
    states.sort(key=lambda s: -s["fy2025"])
    per = [s["perResident"] for s in states if s["perResident"] is not None and s["code"] not in ("DC", "PR")]
    return {
        "toptierCode": code,
        "name": agency["agency_name"],
        "abbreviation": agency.get("abbreviation"),
        "frAgencyId": fr_id,
        "fiscalYear": FY_LATEST,
        "total": round(total, 2),
        "stateNotRecorded": round(blank.get(2025, 0), 2),
        "total2024": round(sum(v for v in prev.values() if isinstance(v, (int, float))) + blank.get(2024, 0), 2) if prev else None,
        "statesWithSpending": sum(1 for s in states if s["fy2025"] > 0),
        "medianPerResidentStates": round(P.median(per), 2) if per else None,
        "states": states,
    }


# ---------------------------------------------------------------------------------------------------------------
# Assembly helpers
# ---------------------------------------------------------------------------------------------------------------
def kind_of(agency):
    if agency.get("parent_id"):
        return "component"
    return "department" if re.search(r"\bDepartment$", agency["name"].strip()) else "independent"


KIND_LABEL = {"department": "Department", "component": "Component agency", "independent": "Independent or other"}


def last_active_year(yearly):
    years = [y for y, n in (yearly.get("ALL") or {}).items() if n > 0]
    return max(years) if years else None


def fmt_int(v):
    return f"{v:,}" if isinstance(v, int) else P.NOT_RECORDED


def fmt_usd(v):
    if not isinstance(v, (int, float)):
        return P.NOT_RECORDED
    if abs(v) >= 1e9:
        return f"${v / 1e9:,.2f}B"
    if abs(v) >= 1e6:
        return f"${v / 1e6:,.1f}M"
    return f"${v:,.0f}"


def write_build(dataset, label, rows, listing_block, summary, prefixes):
    build = {
        "dataset": dataset,
        "label": label,
        "listing_block": listing_block,
        "summary": summary,
        "rows": rows,
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": inputs_for(prefixes),
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{dataset}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(build, fh, ensure_ascii=False, sort_keys=True)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "bytes": os.path.getsize(path)}))
    return path


# ---------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------
def main(argv):
    as_of = next((a.split("=", 1)[1] for a in argv if a.startswith("--as-of=")), "2026-10-19")
    MANIFEST.update(manifest())
    corpus_range = load_lookup("fr_corpus_range.json")["rows"][0]
    stats = {"as_of": as_of}

    by_id, by_slug = fr_directory()
    windows = admin_windows(as_of)
    yearly, admin, monthly, months, unmapped = fr_facets(by_slug, as_of)
    stats["facet_unmapped_slugs"] = dict(unmapped.most_common(20))
    sig_docs, sig_problems = significant_docs()
    if sig_problems:
        raise SystemExit("significant listings incomplete: " + "; ".join(sig_problems))
    sig_by_agency = per_agency_docs(sig_docs)
    comments = open_comment_docs(as_of)
    comments_by_agency = per_agency_docs(comments)
    partial_year = as_of[:4]
    partial_month = as_of[:7]
    last_full_year = str(int(partial_year) - 1)

    ecfr, titles, ecfr_total = ecfr_refs(by_slug)
    stats["ecfr"] = {"agencies_in_ecfr": ecfr_total, "matched_by_slug": len(ecfr)}
    parts = cfr_parts(titles)
    gm, gm_stats, gm_total = govman(by_id)
    stats["govman"] = {"entities": gm_total, "matched": gm_stats["matched"], "ambiguous_keys": gm_stats["right_ambiguous_keys"],
                       "unmatched": gm_stats["right_unmatched"], "pairs": gm_stats["pairs"]}
    top, fr_by_code, usa_stats = usaspending(by_id)
    stats["usaspending"] = {"toptier": len(top), "matched": usa_stats["matched"], "unmatched": usa_stats["right_unmatched"],
                            "pairs": usa_stats["pairs"]}
    pop, state_names = population()
    agenda, run_date, ua_stats, ua_unmatched = unified_agenda(by_id, as_of)
    stats["unified_agenda"] = {"rins": len(agenda), "run_date": run_date, "match": dict(ua_stats),
                               "unmatched_agencies": dict(ua_unmatched.most_common())}
    enforcement_lookup = {r["id"]: r for r in load_lookup("enforcement_datasets.json")["rows"]}

    # ---- budget and spending ------------------------------------------------------------------------------------
    budget_rows, spending_rows, budget_by_fr, spending_by_fr, sub_by_fr = [], [], {}, {}, {}
    for agency in top:
        fr_id = fr_by_code.get(agency["toptier_code"])
        b, subs = budget_row(agency, fr_id, by_id)
        if b["years"]:
            budget_rows.append(b)
            if fr_id is not None:
                budget_by_fr[fr_id] = b
        for k, v in subs.items():
            sub_by_fr.setdefault(k, v)
        s = spending_row(agency, fr_id, pop, state_names)
        if s:
            spending_rows.append(s)
            if fr_id is not None:
                spending_by_fr[fr_id] = s

    # ---- agenda aggregates ---------------------------------------------------------------------------------------
    agenda_by_fr = collections.defaultdict(list)
    for e in agenda:
        for fid in e["frAgencyIds"]:
            agenda_by_fr[fid].append(e)

    # ---- FR-wide totals ------------------------------------------------------------------------------------------
    fr_yearly = {t: P.year_series(load_json(f"fr/facets/yearly/{t}.json")) for t in ["ALL"] + TYPES}
    rule_totals = {y: fr_yearly["RULE"].get(y) for y in YEARS}

    # ---- trends rows ----------------------------------------------------------------------------------------------
    trend_rows, trend_by_fr = [], {}
    agency_ids = sorted(set(yearly) | set(sig_by_agency) | set(comments_by_agency))
    for fid in agency_ids:
        a = by_id.get(fid)
        if not a:
            continue
        sig_yearly, sig_admin = significant_series(sig_by_agency.get(fid, []), windows)
        y = yearly.get(fid) or {t: {} for t in ["ALL"] + TYPES}
        adm = admin.get(fid) or {t: {} for t in ["ALL", "RULE", "PRORULE", "NOTICE"]}
        by_admin = []
        for w in windows:
            row = {"key": w["key"], "label": w["label"], "president": w["president"], "start": w["start"], "end": w["end"],
                   "days": w["days"], "current": w["current"]}
            for t in ["ALL", "RULE", "PRORULE", "NOTICE"]:
                row[t] = adm[t].get(w["key"], 0)
            row["significantRules"] = sig_admin["RULE"].get(w["key"], 0)
            row["significantProposed"] = sig_admin["PRORULE"].get(w["key"], 0)
            row["rulesPerYear"] = P.per_year(row["RULE"], w["days"])
            row["significantRulesPerYear"] = P.per_year(row["significantRules"], w["days"])
            by_admin.append(row)
        rule_docs = [d for d in sig_by_agency.get(fid, []) if d["_type"] == "RULE"]
        pro_docs = [d for d in sig_by_agency.get(fid, []) if d["_type"] == "PRORULE"]
        mon = monthly.get(fid) or {t: {} for t in ["RULE", "PRORULE", "NOTICE"]}
        trends = {
            "agencyId": fid,
            "asOf": as_of,
            "partialYear": partial_year,
            "partialMonth": partial_month,
            "yearly": {t: {yr: n for yr, n in sorted(y[t].items())} for t in ["ALL"] + TYPES},
            "monthly": {t: {m: mon[t].get(m, 0) for m in months} for t in ["RULE", "PRORULE", "NOTICE"]},
            "byAdministration": by_admin,
            "significantYearly": sig_yearly,
            "significantTotals": {"RULE": len(rule_docs), "PRORULE": len(pro_docs)},
            "latestSignificantRules": latest(rule_docs, 10),
            "latestSignificantProposed": latest(pro_docs, 5),
            "openComments": comment_summary(comments_by_agency.get(fid, []), as_of, 25),
            "shareOfFinalRules": {yr: P.share_pct(y["RULE"].get(yr), rule_totals.get(yr)) for yr in (last_full_year,)},
        }
        trend_by_fr[fid] = trends
        total_docs = sum(y["ALL"].values())
        cells = {
            "documents_since_1994": fmt_int(total_docs),
            f"rules_{last_full_year}": fmt_int(y["RULE"].get(last_full_year, 0)),
            f"proposed_{last_full_year}": fmt_int(y["PRORULE"].get(last_full_year, 0)),
            "significant_rules": fmt_int(len(rule_docs)),
            "open_comments": fmt_int(trends["openComments"]["count"]),
            "as_of": as_of,
        }
        facts = [
            ["Federal Register agency", f"{a['name']} (id {fid})"],
            ["Documents published since 1994 (all types)", fmt_int(total_docs)],
            [f"Final rules published in {last_full_year}", fmt_int(y["RULE"].get(last_full_year, 0))],
            [f"Proposed rules published in {last_full_year}", fmt_int(y["PRORULE"].get(last_full_year, 0))],
            ["Significant final rules (1994 to date)", fmt_int(len(rule_docs))],
            ["Documents with a comment period open on or after the as-of date", fmt_int(trends["openComments"]["count"])],
            ["Counted by", "Federal Register API facet counts by publication date; significant = Unified Agenda entry deemed significant under EO 12866 (API filter)"],
            ["As of", as_of],
        ]
        links = [{"url": f"/agencies/{fid}", "label": "Agency profile"},
                 {"url": a["url"], "label": "Agency page on federalregister.gov"}]
        trend_rows.append(writer.record(
            "fr_agency_trends", str(fid), a["name"],
            source_url=f"{FR_API}documents/facets/agency",
            cells=cells, facts=facts, text=" ".join([a["name"], a.get("short_name") or ""]),
            filters={"kind": [kind_of(a)], "has_open_comments": ["yes" if trends["openComments"]["count"] else "no"]},
            subtitle=a.get("short_name") or "", links=links, extra={"trends": trends}))

    # FR-wide row
    eo_docs = []
    for p in sorted(glob.glob(raw_path("fr/eo/executive_orders_p*.json"))):
        eo_docs.extend(load_json(os.path.relpath(p, ACQ)).get("results") or [])
    eo_by_admin = collections.Counter()
    eo_yearly = collections.Counter()
    for d in eo_docs:
        key = P.admin_for_date(d.get("signing_date"), windows)
        if key:
            eo_by_admin[key] += 1
        if (d.get("signing_date") or "")[:4].isdigit():
            eo_yearly[d["signing_date"][:4]] += 1
    pres_yearly = {}
    for p in sorted(glob.glob(raw_path("fr/facets/presidential_yearly/*.json"))):
        key = os.path.basename(p)[:-5]
        series = P.year_series(load_json(os.path.relpath(p, ACQ)))
        if series:
            pres_yearly[key] = series
    type_admin = {}
    for w in windows:
        counts = P.facet_counts(load_json(f"fr/facets/type_admin/{w['key']}_{w['start']}.json"))
        sig_rules = sum(1 for d in sig_docs if d["_type"] == "RULE" and P.admin_for_date(d.get("publication_date"), windows) == w["key"])
        type_admin[w["key"]] = {
            "key": w["key"], "label": w["label"], "president": w["president"], "start": w["start"], "end": w["end"],
            "days": w["days"], "current": w["current"],
            "RULE": counts.get("RULE", 0), "PRORULE": counts.get("PRORULE", 0), "NOTICE": counts.get("NOTICE", 0),
            "PRESDOCU": counts.get("PRESDOCU", 0), "executiveOrders": eo_by_admin.get(w["key"], 0),
            "significantRules": sig_rules,
            "rulesPerYear": P.per_year(counts.get("RULE", 0), w["days"]),
            "significantRulesPerYear": P.per_year(sig_rules, w["days"]),
            "executiveOrdersPerYear": P.per_year(eo_by_admin.get(w["key"], 0), w["days"]),
        }
    fr_monthly = {t: P.month_series(load_json(f"fr/facets/monthly/{t}.json")) for t in ["RULE", "PRORULE", "NOTICE"]}
    sig_all_yearly, _ = significant_series(sig_docs, windows)
    top_rules = sorted(((fid, (yearly[fid]["RULE"] or {}).get(last_full_year, 0)) for fid in yearly), key=lambda x: -x[1])
    top_rules = [{"agencyId": fid, "name": by_id[fid]["name"], "kind": kind_of(by_id[fid]), "rules": n}
                 for fid, n in top_rules if n > 0 and fid in by_id][:40]
    sig_unique = {P.doc_key(d): d for d in sig_docs if d["_type"] == "RULE"}
    overview = {
        "agencyId": None,
        "asOf": as_of,
        "partialYear": partial_year,
        "partialMonth": partial_month,
        "yearly": {t: fr_yearly[t] for t in ["ALL"] + TYPES},
        "monthly": {t: {m: fr_monthly[t].get(m, 0) for m in months} for t in ["RULE", "PRORULE", "NOTICE"]},
        "byAdministration": [type_admin[w["key"]] for w in windows],
        "significantYearly": sig_all_yearly,
        "significantTotals": {"RULE": len(sig_unique), "PRORULE": len({P.doc_key(d) for d in sig_docs if d["_type"] == "PRORULE"})},
        "latestSignificantRules": latest(list(sig_unique.values()), 12),
        "latestSignificantProposed": latest([d for d in sig_docs if d["_type"] == "PRORULE"], 6),
        "openComments": comment_summary(comments, as_of, 40),
        "presidentialYearly": pres_yearly,
        "executiveOrders": {
            "total": len(eo_docs),
            "yearly": dict(sorted(eo_yearly.items())),
            "latest": [{"number": d.get("executive_order_number"), "title": d.get("title"), "signed": d.get("signing_date"),
                        "published": d.get("publication_date"), "president": (d.get("president") or {}).get("name"),
                        "citation": d.get("citation"), "url": d.get("html_url")}
                       for d in sorted(eo_docs, key=lambda d: (d.get("signing_date") or "", d.get("executive_order_number") or ""), reverse=True)[:8]
                       if re.match(r"^https://www\.federalregister\.gov/", d.get("html_url") or "")],
        },
        "topAgenciesByRules": {"year": last_full_year, "rows": top_rules},
        "agenda": {**P.agenda_summary(agenda), "edition": UA_EDITION, "runDate": run_date},
    }
    trend_rows.insert(0, writer.record(
        "fr_agency_trends", "federal-register", "Federal Register — all agencies",
        source_url=f"{FR_API}documents/facets/yearly",
        cells={"documents_since_1994": fmt_int(sum(fr_yearly["ALL"].values())),
               f"rules_{last_full_year}": fmt_int(fr_yearly["RULE"].get(last_full_year)),
               f"proposed_{last_full_year}": fmt_int(fr_yearly["PRORULE"].get(last_full_year)),
               "significant_rules": fmt_int(len(sig_unique)),
               "open_comments": fmt_int(len(comments)), "as_of": as_of},
        facts=[["Scope", "Every document the Federal Register API lists, all agencies"],
               ["Documents published since 1994", fmt_int(sum(fr_yearly["ALL"].values()))],
               ["Executive orders signed and published since 1994", fmt_int(len(eo_docs))],
               ["Administration windows", "Terms begin and end on January 20 (U.S. Constitution, Amendment XX); counted by publication date (executive orders by signing date)"],
               ["As of", as_of]],
        text="Federal Register all agencies overview executive orders presidential documents",
        filters={"kind": ["all"], "has_open_comments": ["yes"]},
        subtitle="All agencies", links=[{"url": "/agencies", "label": "Agency directory"},
                                         {"url": AMENDMENT_XX, "label": "U.S. Constitution, Amendment XX (National Archives)"}],
        extra={"trends": overview}))

    # ---- agenda rows ----------------------------------------------------------------------------------------------
    agenda_rows = []
    for e in sorted(agenda, key=lambda e: e["rin"]):
        if not re.fullmatch(r"\d{4}-[A-Z]{2}\d{2}", e["rin"]):
            stats.setdefault("agenda_bad_rin", []).append(e["rin"])
            continue
        nxt = e["nextAction"]
        fr_agency = by_id.get(e["frAgencyId"]) if e["frAgencyId"] else None
        cells = {
            "agency": e["agency"]["name"] + (f" ({e['parent']['acronym']})" if e["parent"] and e["parent"]["acronym"] else ""),
            "stage": e["stage"], "priority": e["priority"], "major": e["major"],
            "next_action": f"{nxt['action']} · {nxt['date']}" + (" (projected month passed)" if nxt['passed'] else "") if nxt else P.NOT_RECORDED,
        }
        facts = [["RIN", e["rin"]], ["Agency (as printed)", e["agency"]["name"]],
                 ["Parent agency (as printed)", e["parent"]["name"] if e["parent"] else P.NOT_RECORDED],
                 ["Stage", e["stage"]], ["Priority", e["priority"]], ["Major (Congressional Review Act)", e["major"]],
                 ["Agenda status", e["status"]], ["In the Regulatory Plan", "Yes" if e["regulatoryPlan"] else "No"],
                 ["CFR citation", "; ".join(e["cfr"]) or P.NOT_RECORDED],
                 ["Legal authority", "; ".join(e["legalAuthority"][:6]) or P.NOT_RECORDED],
                 ["Unified Agenda publication", f"{UA_EDITION} (XML run date {run_date})"]]
        links = [{"url": UA_RULE.format(UA_EDITION, e["rin"]), "label": "Agenda entry on reginfo.gov"}]
        if fr_agency:
            links.append({"url": f"/agencies/{fr_agency['id']}", "label": f"{fr_agency['name']} profile"})
        item = {k: v for k, v in e.items() if k not in ("frAgencyIds",)}
        item["frAgencyIds"] = e["frAgencyIds"]
        item["edition"] = UA_EDITION
        item["runDate"] = run_date
        agenda_rows.append(writer.record(
            "unified_agenda_pipeline", e["rin"], e["title"] or e["rin"],
            source_url=UA_RULE.format(UA_EDITION, e["rin"]), cells=cells, facts=facts,
            text=" ".join([e["rin"], e["title"], e["agency"]["name"], e["parent"]["name"] if e["parent"] else "",
                           e["abstract"][:600]]),
            filters={"agency": [str(i) for i in e["frAgencyIds"]], "stage": [e["stage"]], "priority": [e["priority"]],
                     "major": [e["major"]]},
            subtitle=e["agency"]["name"], badges=[e["stage"], e["priority"]], links=links, extra={"agenda": item}))

    # ---- profile rows ---------------------------------------------------------------------------------------------
    profile_rows = []
    for fid in sorted(by_id):
        a = by_id[fid]
        t = trend_by_fr.get(fid)
        ua = agenda_by_fr.get(fid, [])
        ua_summary = P.agenda_summary(ua)
        ua_items = sorted(ua, key=lambda e: (e["stage"] == "Completed Actions",
                                             P.PRIORITIES.index(e["priority"]) if e["priority"] in P.PRIORITIES else 9,
                                             (e["nextAction"] or {}).get("month") or "9999", e["rin"]))
        b = budget_by_fr.get(fid)
        s = spending_by_fr.get(fid)
        fy25 = next((y for y in (b or {}).get("years", []) if y["fy"] == FY_LATEST), None)
        ycur = (t or {}).get("yearly", {})
        enforcement = None
        if fid in ENFORCEMENT:
            spec = ENFORCEMENT[fid]
            enforcement = {"page": spec["page"], "datasets": [
                {"id": d, "label": enforcement_lookup[d]["label"], "records": enforcement_lookup[d]["imported_records"]}
                for d in spec["datasets"] if d in enforcement_lookup and enforcement_lookup[d]["ready"]]}
        parent = by_id.get(a.get("parent_id")) if a.get("parent_id") else None
        kids = [by_id[c] for c in a.get("child_ids") or [] if c in by_id]
        stats_block = {
            "kind": kind_of(a),
            "parentId": a.get("parent_id"),
            "childCount": len(kids),
            "documentsSince1994": sum((ycur.get("ALL") or {}).values()) if t else 0,
            "rulesLastYear": (ycur.get("RULE") or {}).get(last_full_year, 0) if t else 0,
            "proposedLastYear": (ycur.get("PRORULE") or {}).get(last_full_year, 0) if t else 0,
            "noticesLastYear": (ycur.get("NOTICE") or {}).get(last_full_year, 0) if t else 0,
            "rulesThisYear": (ycur.get("RULE") or {}).get(partial_year, 0) if t else 0,
            "significantRules": t["significantTotals"]["RULE"] if t else 0,
            "openComments": t["openComments"]["count"] if t else 0,
            "agendaActions": ua_summary["total"],
            "agendaEconomicallySignificant": ua_summary["byPriority"]["Economically Significant"],
            "obligationsLatestFy": fy25["obligated"] if fy25 else None,
            "budgetaryResourcesLatestFy": fy25["budgetaryResources"] if fy25 else None,
            "lastActiveYear": last_active_year(ycur) if t else None,
            "lastFullYear": last_full_year,
            "latestFy": FY_LATEST,
        }
        profile = {
            "id": fid,
            "name": a["name"],
            "shortName": a.get("short_name") or None,
            "slug": a["slug"],
            "kind": kind_of(a),
            "parent": {"id": parent["id"], "name": parent["name"]} if parent else None,
            "children": sorted([{"id": c["id"], "name": c["name"]} for c in kids], key=lambda c: c["name"]),
            "description": re.sub(r"\s+", " ", a.get("description") or "").strip() or None,
            "frUrl": a["url"],
            "frJsonUrl": a.get("json_url"),
            "agencyUrl": a.get("agency_url") if re.match(r"^https?://", a.get("agency_url") or "") else None,
            "ecfr": ecfr.get(fid),
            "cfrParts": {**parts[fid], "corpusRange": [corpus_range["min_published"], corpus_range["max_published"]]} if fid in parts else None,
            "govman": {**gm[fid], "edition": "2025-12-31", "sourceUrl": GOVMAN_URL, "pageUrl": GOVMAN_PAGE,
                       "matchMethod": "normalized_name"} if fid in gm else None,
            "usaspending": ({"toptierCode": b["toptierCode"], "name": b["name"], "abbreviation": b["abbreviation"],
                             "mission": b["mission"], "website": b["website"],
                             "congressionalJustificationUrl": b["congressionalJustificationUrl"],
                             "usaspendingUrl": b["usaspendingUrl"], "matchMethod": "normalized_name"} if b else None),
            "subtierObligations": sub_by_fr.get(fid),
            "agenda": {**ua_summary, "edition": UA_EDITION, "runDate": run_date,
                       "items": [{"rin": e["rin"], "title": e["title"], "stage": e["stage"], "priority": e["priority"],
                                  "major": e["major"], "agency": e["agency"]["name"],
                                  "nextAction": e["nextAction"], "regulatoryPlan": e["regulatoryPlan"],
                                  "url": UA_RULE.format(UA_EDITION, e["rin"])} for e in ua_items[:12]]} if ua else None,
            "enforcement": enforcement,
            "stats": stats_block,
        }
        cells = {
            "kind": KIND_LABEL[kind_of(a)],
            "parent": parent["name"] if parent else "—",
            f"rules_{last_full_year}": fmt_int(stats_block["rulesLastYear"]),
            "significant_rules": fmt_int(stats_block["significantRules"]),
            "open_comments": fmt_int(stats_block["openComments"]),
            "agenda_actions": fmt_int(stats_block["agendaActions"]),
            f"obligations_fy{FY_LATEST}": fmt_usd(stats_block["obligationsLatestFy"]),
        }
        facts = [["Federal Register agency id", str(fid)], ["Kind", KIND_LABEL[kind_of(a)]],
                 ["Parent", parent["name"] if parent else "None"],
                 ["Components listed by the Federal Register", fmt_int(len(kids))],
                 ["Official website (Federal Register record)", profile["agencyUrl"] or P.NOT_RECORDED],
                 ["CFR chapters (eCFR)", ", ".join(f"{r['title']} CFR ch. {r['chapter']}" for r in (profile["ecfr"] or {}).get("refs", []) if r["chapter"]) or P.NOT_RECORDED],
                 ["Unified Agenda actions (publication 202510)", fmt_int(stats_block["agendaActions"])],
                 [f"Award obligations FY{FY_LATEST} (USAspending)", fmt_usd(stats_block["obligationsLatestFy"])]]
        links = [{"url": f"/agencies/{fid}", "label": "Agency profile"}, {"url": a["url"], "label": "federalregister.gov"}]
        if profile["agencyUrl"]:
            links.append({"url": profile["agencyUrl"], "label": "Official website"})
        profile_rows.append(writer.record(
            "fr_agency_profiles", str(fid), a["name"], source_url=a.get("json_url") or a["url"],
            cells=cells, facts=facts,
            text=" ".join(filter(None, [a["name"], a.get("short_name"), parent["name"] if parent else "",
                                        (profile["description"] or "")[:400]])),
            filters={"kind": [kind_of(a)], "parent": [str(parent["id"])] if parent else [],
                     "has_agenda": ["yes" if ua else "no"],
                     "active": ["yes" if (stats_block["lastActiveYear"] or "0") >= str(int(partial_year) - 1) else "no"]},
            subtitle=a.get("short_name") or "", badges=[KIND_LABEL[kind_of(a)]], links=links,
            extra={"profile": profile, "stats": stats_block}))

    # ---- budget/spending rows -----------------------------------------------------------------------------------
    b_rows = []
    for b in sorted(budget_rows, key=lambda b: b["toptierCode"]):
        fy = next((y for y in b["years"] if y["fy"] == FY_LATEST), None)
        cells = {"abbreviation": b["abbreviation"] or "—",
                 f"budgetary_resources_fy{FY_LATEST}": fmt_usd(fy["budgetaryResources"] if fy else None),
                 f"obligated_fy{FY_LATEST}": fmt_usd(fy["obligated"] if fy else None),
                 f"outlayed_fy{FY_LATEST}": fmt_usd(fy["outlayed"] if fy else None),
                 "share_of_government": (f"{fy['sharePct']:.3f}%" if fy and fy["sharePct"] is not None else P.NOT_RECORDED)}
        facts = [["USAspending toptier code", b["toptierCode"]],
                 ["Fiscal years recorded", ", ".join(str(y["fy"]) for y in b["years"])],
                 ["Measures", "Agency budgetary resources, total obligations and outlays as reported to USAspending (DATA Act File A/B), by fiscal year"],
                 ["Partial year", "Fiscal years after FY2025 are reported through the latest period shown (period 12 = September)"]]
        links = [{"url": b["usaspendingUrl"], "label": "Agency page on USAspending.gov"}] if b["usaspendingUrl"] else []
        if b["frAgencyId"]:
            links.append({"url": f"/agencies/{b['frAgencyId']}", "label": "Agency profile"})
        b_rows.append(writer.record(
            "agency_budget_trends", b["toptierCode"], b["name"],
            source_url=f"https://api.usaspending.gov/api/v2/agency/{b['toptierCode']}/budgetary_resources/",
            cells=cells, facts=facts, text=" ".join(filter(None, [b["name"], b["abbreviation"], b["mission"] or ""])),
            filters={"matched": ["yes" if b["frAgencyId"] else "no"]}, subtitle=b["abbreviation"] or "", links=links,
            extra={"budget": b}))
    s_rows = []
    for s in sorted(spending_rows, key=lambda s: s["toptierCode"]):
        top_state = max((x for x in s["states"] if x["perResident"] is not None and x["code"] not in ("DC",)),
                        key=lambda x: x["perResident"], default=None)
        cells = {"abbreviation": s["abbreviation"] or "—", f"obligations_fy{FY_LATEST}": fmt_usd(s["total"]),
                 "states_with_spending": fmt_int(s["statesWithSpending"]),
                 "median_per_resident": fmt_usd(s["medianPerResidentStates"]) if s["medianPerResidentStates"] is not None else P.NOT_RECORDED,
                 "highest_per_resident": f"{top_state['code']} {fmt_usd(top_state['perResident'])}" if top_state else P.NOT_RECORDED}
        facts = [["Measure", "Sum of prime award transaction obligations with action dates in the fiscal year, by place of performance state (USAspending spending_by_geography, spending_level=transactions)"],
                 ["Fiscal years", "FY2025 (2024-10-01 to 2025-09-30); FY2024 for change"],
                 ["Per-resident denominator", "Census Bureau Vintage 2025 resident population estimate for July 1, 2025 (POPESTIMATE2025)"],
                 ["Denominator source", CENSUS_URL]]
        links = []
        if s["frAgencyId"]:
            links.append({"url": f"/agencies/{s['frAgencyId']}", "label": "Agency profile"})
        s_rows.append(writer.record(
            "agency_spending_by_state", s["toptierCode"], s["name"],
            source_url="https://api.usaspending.gov/api/v2/search/spending_by_geography/",
            cells=cells, facts=facts, text=" ".join(filter(None, [s["name"], s["abbreviation"]])),
            filters={"matched": ["yes" if s["frAgencyId"] else "no"]}, subtitle=s["abbreviation"] or "", links=links,
            extra={"spending": {**s, "denominator": {"measure": "Resident population, July 1, 2025 (Vintage 2025)",
                                                     "source": CENSUS_URL, "page": CENSUS_PAGE, "year": 2025}}}))

    # ---- write ----------------------------------------------------------------------------------------------------
    write_build(
        "fr_agency_profiles", "Federal agency profiles: directory, structure, CFR footprint, agenda and spending links",
        profile_rows,
        writer.listing([("kind", "Kind"), ("parent", "Parent"), (f"rules_{last_full_year}", f"Final rules {last_full_year}"),
                        ("significant_rules", "Significant final rules"), ("open_comments", "Open comment periods"),
                        ("agenda_actions", "Agenda actions"), (f"obligations_fy{FY_LATEST}", f"Obligations FY{FY_LATEST}")],
                       [("kind", "Kind", {k: v for k, v in KIND_LABEL.items()}),
                        ("has_agenda", "In the Unified Agenda", {"yes": "Yes", "no": "No"}),
                        ("active", f"Published since {int(partial_year) - 1}", {"yes": "Yes", "no": "No"})]),
        {"as_of": as_of, "agencies": len(profile_rows), "sources": [FR_API + "agencies", ECFR_AGENCIES, GOVMAN_URL, UA_URL,
                                                                    "https://api.usaspending.gov/api/v2/references/toptier_agencies/"],
         "method": "One row per Federal Register agency. Structure (parent/components) is the Federal Register's. eCFR chapters match by identical agency slug. Government Manual (2025 edition) and USAspending records match by a normalized name key (case, punctuation, connective words and word order ignored) that must be unique on both sides. CFR parts are counted from the corpus federal_register_history index (rules and proposed rules citing each part).",
         "matching": {"ecfr": stats["ecfr"], "govman": {k: v for k, v in stats["govman"].items() if k != "pairs"},
                      "usaspending": {k: v for k, v in stats["usaspending"].items() if k != "pairs"}},
         "corpus_range": [corpus_range["min_published"], corpus_range["max_published"]]},
        ["private/acq/agencies_fr/fr/agencies.json", "private/acq/agencies_fr/ecfr", "private/acq/agencies_fr/govman",
         "private/acq/agencies_fr/usaspending/toptier", "private/acq/agencies_fr/reginfo"])
    write_build(
        "fr_agency_trends", "Federal Register documents by agency: yearly, monthly, by administration, significant rules and open comment periods",
        trend_rows,
        writer.listing([("documents_since_1994", "Documents since 1994"), (f"rules_{last_full_year}", f"Final rules {last_full_year}"),
                        (f"proposed_{last_full_year}", f"Proposed rules {last_full_year}"),
                        ("significant_rules", "Significant final rules"), ("open_comments", "Open comment periods"),
                        ("as_of", "As of")],
                       [("kind", "Kind", {"all": "All agencies", **KIND_LABEL}),
                        ("has_open_comments", "Open comment periods", {"yes": "Yes", "no": "No"})]),
        {"as_of": as_of, "agencies": len(trend_rows) - 1, "source": FR_DOCS,
         "method": "Agency facet counts from the Federal Register API by publication year, by administration window and by month (a document listing several agencies counts once for each, so a department includes documents its components file with it). Significant documents are tallied from complete API listings filtered conditions[significant]=1 (Unified Agenda entry deemed significant under EO 12866). Administration windows run January 20 to January 19 (Amendment XX); the first window starts 1995-01-01 because the API types most 1994 documents as uncategorized (type counts for 1994 are kept in the yearly series but are not comparable); executive orders are assigned by signing date. Rates per year = count × 365.25 ÷ days in window.",
         "partial_year": partial_year, "unmapped_facet_slugs": stats["facet_unmapped_slugs"]},
        ["private/acq/agencies_fr/fr/"])
    write_build(
        "unified_agenda_pipeline", f"Unified Agenda of Regulatory and Deregulatory Actions, publication {UA_EDITION} (one row per RIN)",
        agenda_rows,
        writer.listing([("agency", "Agency"), ("stage", "Stage"), ("priority", "Priority"), ("major", "Major"),
                        ("next_action", "Next scheduled action")],
                       [("stage", "Stage", {s: s for s in P.STAGES}), ("priority", "Priority", {p: p for p in P.PRIORITIES}),
                        ("major", "Major", {"Yes": "Yes", "No": "No", "Undetermined": "Undetermined"})]),
        {"edition": UA_EDITION, "xml_run_date": run_date, "rins": len(agenda_rows), "source": UA_URL, "index": UA_INDEX,
         "method": "Every RIN_INFO entry in the reginfo.gov XML for this publication. Agency links: the entry's agency name, else its parent agency's name, matched to a Federal Register agency by a normalized name key unique on both sides; one documented alias ('Department of War' = Federal Register 'Defense Department', Executive Order 14347, 90 FR 43893). Next scheduled action = the first timetable step without a Federal Register citation that the agency dated by month only (MM/00/YYYY, a projection) or 'To Be Determined'; fully dated steps are events (effective dates, comment-period ends); a projected month before the as-of month is marked passed.",
         "agency_match": stats["unified_agenda"]["match"], "unmatched_agencies": stats["unified_agenda"]["unmatched_agencies"],
         "label_note": "reginfo.gov lists this file as \"2026 Data\"; its publication id is 202510."},
        ["private/acq/agencies_fr/reginfo/"])
    write_build(
        "agency_budget_trends", "Agency budgetary resources, obligations and outlays by fiscal year (USAspending)",
        b_rows,
        writer.listing([("abbreviation", "Abbreviation"), (f"budgetary_resources_fy{FY_LATEST}", f"Budgetary resources FY{FY_LATEST}"),
                        (f"obligated_fy{FY_LATEST}", f"Obligated FY{FY_LATEST}"), (f"outlayed_fy{FY_LATEST}", f"Outlayed FY{FY_LATEST}"),
                        ("share_of_government", "Share of government budgetary resources")],
                       [("matched", "Linked to a Federal Register agency", {"yes": "Yes", "no": "No"})]),
        {"as_of": as_of, "agencies": len(b_rows), "source": USA_DOCS, "latest_complete_fy": FY_LATEST,
         "method": "GET /api/v2/agency/<toptier_code>/budgetary_resources/ per toptier agency; share = agency budgetary resources ÷ government-wide total budgetary resources for the same fiscal year; change = year-over-year change in obligations. FY2026+ are partial (latest reporting period shown).",
         "failures": json.load(open(raw_path("usaspending/_failures.json"))) if os.path.exists(raw_path("usaspending/_failures.json")) else []},
        ["private/acq/agencies_fr/usaspending/toptier", "private/acq/agencies_fr/usaspending/agency/",
         "private/acq/agencies_fr/usaspending/budget/", "private/acq/agencies_fr/usaspending/sub_agency/"])
    write_build(
        "agency_spending_by_state", f"Federal award obligations by state and agency, FY{FY_LATEST} with per-resident amounts (USAspending, Census)",
        s_rows,
        writer.listing([("abbreviation", "Abbreviation"), (f"obligations_fy{FY_LATEST}", f"Obligations FY{FY_LATEST}"),
                        ("states_with_spending", "States and territories"), ("median_per_resident", "Median per resident (50 states)"),
                        ("highest_per_resident", "Highest per resident (excl. DC)")],
                       [("matched", "Linked to a Federal Register agency", {"yes": "Yes", "no": "No"})]),
        {"as_of": as_of, "agencies": len(s_rows), "source": USA_DOCS, "fiscal_year": FY_LATEST,
         "denominator": {"measure": "Resident population July 1, 2025 (Census Vintage 2025, POPESTIMATE2025)", "source": CENSUS_URL, "year": 2025},
         "method": "POST /api/v2/search/spending_by_geography/ (scope place_of_performance, geo_layer state, spending_level transactions, awarding toptier agency, FY time period). Per resident = FY2025 obligations ÷ July 1, 2025 population (50 states, DC, Puerto Rico; other territories have no Vintage 2025 state estimate: Not recorded). Median excludes DC and Puerto Rico. Obligations can be negative (de-obligations)."},
        ["private/acq/agencies_fr/usaspending/geo/", "private/acq/agencies_fr/census/", "private/acq/agencies_fr/usaspending/toptier"])

    with open(os.path.join(OUT, "build_stats.json"), "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=1, ensure_ascii=False, sort_keys=True)
    print(json.dumps({k: v for k, v in stats.items() if k in ("ecfr",)}))
    print(json.dumps({"govman_matched": stats["govman"]["matched"], "usaspending_matched": stats["usaspending"]["matched"],
                      "ua": stats["unified_agenda"]["match"]}))


if __name__ == "__main__":
    main(sys.argv[1:])
