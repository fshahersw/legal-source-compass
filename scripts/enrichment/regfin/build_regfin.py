"""Build the regulatory-finance datasets from the unchanged raw files in private/acq/regfin/.

Datasets (build files in private/build/regfin/<dataset>.json):
  sec_broker_dealers        every broker-dealer CIK on the SEC's monthly "active broker-dealers" lists, March 2007 - latest
  sec_investment_advisers   SEC-registered investment advisers and exempt reporting advisers (Form ADV report, latest month)
  sec_adviser_statistics    SEC Division of Investment Management adviser statistics tables (2000 - latest year)
  frb_enforcement_actions   Federal Reserve Board enforcement actions (August 1989 - latest)

Cross-references: company_sec_profiles CIK only on an exact key - broker-dealer CIK, adviser CIK#, or an exact normalised
legal name that maps to exactly one profile (Federal Reserve names, adviser Legal Name). Counts of matched, ambiguous and
unmatched are written to the dataset summary and to private/build/regfin/stats.json.

Usage: python3 -I -B scripts/enrichment/regfin/build_regfin.py [bd|ia|stats|frb ...]   (no argument = all)
"""
import collections
import gzip
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bd_parse  # noqa: E402
import common as cm  # noqa: E402
import frb_parse  # noqa: E402
import ia_parse  # noqa: E402
import names  # noqa: E402
import stats_parse  # noqa: E402

ACQ = cm.ACQ
SECURL = cm.SEC
BD_PAGE = SECURL + "/foia/frequently-requested-documents/company-information-about-active-broker-dealers"
IA_PAGE = SECURL + "/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers"
IA_STATS_PAGE = SECURL + "/data-research/statistics-data-visualizations/investment-adviser-statistics"
IA_STATS_URL = SECURL + "/file/im-investment-adviser-statistics-support-data-20260805"
FRB_PAGE = cm.FRB + "/supervisionreg/enforcementactions.htm"
FRB_FILES = cm.FRB + "/supervisionreg/files/"
IA_ZIPS = {
    "Registered": ("ia/ia100226.zip", SECURL + "/files/investment/data/other/information-about-registered-investment-advisers-exempt-reporting-advisers/ia100226.zip"),
    "ERA": ("ia/ia100226-exempt.zip", SECURL + "/files/investment/data/other/information-about-registered-investment-advisers-exempt-reporting-advisers/ia100226-exempt.zip"),
}
IA_REPORT_MONTH = "2026-10"
TERMS_SEC = (
    "sec.gov: \"Information presented on sec.gov is considered public information and may be copied or further distributed by "
    "users of the web site without the SEC's permission.\" (https://www.sec.gov/about/privacy-information). Read with a declared "
    "User-Agent at no more than 4 requests per second (SEC fair access allows 10)."
)
TERMS_FRB = (
    "federalreserve.gov: \"Unless otherwise indicated, information on Board's website is in the public domain and may be copied and "
    "distributed without permission. Please cite to the Board as the source of the information.\" "
    "(https://www.federalreserve.gov/disclaimer.htm). Read at no more than 1 request per second."
)


def prune(value):
    """Drop None / empty values from nested dicts and lists (a missing key is read as Not recorded by the app)."""
    if isinstance(value, dict):
        out = {k: prune(v) for k, v in value.items()}
        return {k: v for k, v in out.items() if v is not None and v != {} and v != []}
    if isinstance(value, list):
        return [prune(v) for v in value]
    return value


def join_address(*parts):
    """Join address parts with ', ', trimming the trailing comma some published lines already end with."""
    return ", ".join(p.strip().rstrip(",") for p in parts if p and p.strip().rstrip(","))


def main_office_text(mo):
    """Main office line for the facts; the street address and phone of a private residence are never shown."""
    rest = join_address(mo.get("city"), mo.get("state"), mo.get("postal"), mo.get("country"))
    if mo.get("address_withheld"):
        return "Street address and telephone withheld (the SEC flags this office as a private residence)" + (f": {rest}" if rest else "")
    return join_address(mo.get("street1"), mo.get("street2"), rest) or None


def money_label(v):
    if v is None:
        return cm.NOT_RECORDED
    if v >= 1e12:
        return f"${v / 1e12:,.2f} trillion"
    if v >= 1e9:
        return f"${v / 1e9:,.2f} billion"
    if v >= 1e6:
        return f"${v / 1e6:,.2f} million"
    return f"${v:,.0f}"


# ---------------------------------------------------------------------------------------------------------- broker-dealers


def load_bd_months():
    index = json.loads((ACQ / "sec" / "bd_index.json").read_text())
    months = {}
    for item in index:
        month = bd_parse.month_from_label(item["month_label"])
        if not month or month in months:
            raise SystemExit(f"bad or duplicate month label {item['month_label']!r}")
        raw = gzip.open(ACQ / "sec" / "bd" / (item["file"] + ".gz"), "rb").read()
        rows, skipped = bd_parse.parse(raw)
        if skipped:
            raise SystemExit(f"{item['file']}: unparsed lines {skipped[:2]}")
        months[month] = {"file": item["file"], "url": SECURL + item["path"], "label": item["month_label"], "rows": rows}
    return months


def all_months_between(first, last):
    y, m = int(first[:4]), int(first[5:])
    out = []
    while (y, m) <= (int(last[:4]), int(last[5:])):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def build_bd(companies, months=None):
    months = months if months is not None else load_bd_months()
    order = sorted(months)
    latest = order[-1]
    per_cik = {}
    for month in order:
        seen_in_month = set()
        for r in months[month]["rows"]:
            if r["cik"] in seen_in_month:
                raise SystemExit(f"{months[month]['file']}: CIK {r['cik']} listed twice")
            seen_in_month.add(r["cik"])
            e = per_cik.setdefault(r["cik"], {"months": [], "last": None, "names": []})
            e["months"].append(month)
            e["last"] = (month, r)
            if not e["names"] or e["names"][-1]["name"] != r["name"]:
                e["names"].append({"name": r["name"], "first": month, "last": month})
            else:
                e["names"][-1]["last"] = month
    rows = []
    stats = collections.Counter()
    for cik, e in per_cik.items():
        month, r = e["last"]
        hist = e["names"] if len(e["names"]) > 1 else []
        in_latest = month == latest
        in_profiles = companies.by_cik(cik)
        stats["records"] += 1
        stats["in_latest_file"] += in_latest
        stats["cik_in_company_sec_profiles"] += bool(in_profiles)
        item = {
            "cik": cik, "name": r["name"], "file_number": r["file_number"] or None, "address1": r["address1"] or None,
            "address2": r["address2"] or None, "city": r["city"] or None, "state": r["state"] or None, "zip": r["zip"] or None,
            "first_listed": e["months"][0], "last_listed": e["months"][-1], "months_listed": len(e["months"]),
            "in_latest_file": in_latest, "latest_file_month": latest, "listing_url": months[month]["url"], "name_history": hist,
        }
        links = [{"url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}", "label": "SEC EDGAR filings for this CIK"}]
        if in_profiles:
            links.insert(0, {"url": f"/companies/{cik}", "label": f"SEC registrant: {companies.names[cik]} (exact CIK match)"})
        place = ", ".join(x for x in [r["city"], r["state"]] if x)
        rows.append(cm.record(
            "sec_broker_dealers", f"bd:{cik}", r["name"], source_url=months[month]["url"],
            subtitle=" · ".join(x for x in [f"CIK {cik}", f"File no. {r['file_number']}" if r["file_number"] else None, place or None] if x),
            cells={
                "name": r["name"], "cik": cik, "file_number": r["file_number"] or cm.NOT_RECORDED,
                "city": r["city"] or cm.NOT_RECORDED, "state": r["state"] or cm.NOT_RECORDED, "first_listed": e["months"][0],
                "last_listed": e["months"][-1], "status": "Listed in the latest file" if in_latest else "Not in the latest file",
            },
            facts=[
                ("Company name (as published)", r["name"]), ("CIK", cik), ("Reporting file number (as published)", r["file_number"]),
                ("Address (as published)", join_address(r["address1"], r["address2"], r["city"], r["state"], r["zip"])),
                ("First month listed", e["months"][0]), ("Last month listed", e["months"][-1]),
                ("Monthly files listing it", f"{len(e['months'])} of {len(order)} published files ({order[0]} to {latest})"),
                ("In the latest file", f"Yes ({latest})" if in_latest else f"No (last listed {e['months'][-1]})"),
                ("Names used on the lists", [f"{h['name']} ({h['first']} to {h['last']})" for h in hist]),
                ("Source", "SEC: Company Information About Active Broker-Dealers (monthly file)"),
            ],
            text=" ".join(filter(None, [r["name"], cik, r["file_number"], r["city"], r["state"], " ".join(h["name"] for h in hist)])),
            filters={"state": [r["state"]] if r["state"] else [], "listed": ["latest" if in_latest else "earlier"], "company": [cik],
                     "first_year": [e["months"][0][:4]], "last_year": [e["months"][-1][:4]]},
            links=links, extra={"broker_dealer": prune(item)},
        ))
    rows.sort(key=lambda r: (r["title"].casefold(), r["id"]))
    series = [{"month": m, "count": len(months[m]["rows"]), "file": months[m]["file"], "url": months[m]["url"]} for m in order]
    present = set(order)
    missing = [m for m in all_months_between(order[0], latest) if m not in present]
    by_state = collections.Counter(r["state"] or "" for r in months[latest]["rows"])
    overview = {
        "first_month": order[0], "latest_month": latest, "files": len(order), "missing_months": missing,
        "series": series, "latest_by_state": sorted(([k, v] for k, v in by_state.items() if k), key=lambda kv: (-kv[1], kv[0])),
        "unique_ciks": len(rows), "in_latest_file": stats["in_latest_file"],
        "count_definition": "Rows in the SEC's monthly 'Company Information About Active Broker-Dealers' file for that month (one row per CIK).",
    }
    rows.insert(0, cm.overview_record(
        "sec_broker_dealers", "SEC broker-dealer lists overview", source_url=BD_PAGE, overview=overview,
        subtitle=f"{len(order)} monthly files, {order[0]} to {latest}",
        facts=[("Monthly files", len(order)), ("First month", order[0]), ("Latest month", latest),
               ("Months with no published file", ", ".join(missing)), ("Broker-dealer CIKs ever listed", len(per_cik)),
               ("Listed in the latest file", stats["in_latest_file"])]))
    stats["files"] = len(order)
    stats["missing_months"] = len(missing)
    summary = {
        "source": "SEC Company Information About Active Broker-Dealers (monthly tab-delimited files)",
        "source_pages": [BD_PAGE], "terms": TERMS_SEC,
        "coverage": f"{len(order)} monthly files from {order[0]} to {latest}; the SEC page lists no file for: {', '.join(missing) or 'none'}",
        "extraction": "Fields are the SEC's: CIK, company name, reporting file number, address lines, city, state, ZIP. A record carries the fields of the last file in which the CIK appears; first/last month listed and name history come from comparing the monthly files.",
        "matching": "Broker-dealer CIK equals a company_sec_profiles CIK exactly (company filter holds the broker-dealer's own CIK; /companies links only when a profile exists).",
        "named_individuals": "No natural persons are listed by name except where a broker-dealer firm is named after one, exactly as the SEC lists it.",
        "stats": dict(stats),
    }
    columns = [("name", "Company"), ("cik", "CIK"), ("file_number", "File no."), ("city", "City"), ("state", "State"),
               ("first_listed", "First listed"), ("last_listed", "Last listed")]
    lst = cm.listing(columns, [
        ("listed", "On the latest list", {"latest": "Listed in the latest file", "earlier": "Not in the latest file"}),
    ])
    inputs = cm.manifest_inputs(["regfin/sec/bd/"])
    return rows, lst, summary, inputs, stats


# ------------------------------------------------------------------------------------------------------ investment advisers


def read_ia_sources():
    """[(firm_type, csv_name, header, rows, url)] for the registered and exempt reporting adviser zips."""
    out = []
    for firm_type, (rel, url) in IA_ZIPS.items():
        csv_name, header, data = ia_parse.read_zip(ACQ / "sec" / rel)
        out.append((firm_type, csv_name, header, data, url))
    return out


def ia_rows(companies, sources=None):
    rows = []
    stats = collections.Counter()
    crd_seen = {}
    ambiguous_examples = []
    for firm_type, csv_name, header, data, url in sources if sources is not None else read_ia_sources():
        stats[f"{firm_type}_rows"] = len(data)
        for raw in data:
            rec = ia_parse.record_from_row(header, raw)
            if not rec["crd"] or not rec["legal_name"]:
                raise SystemExit(f"{csv_name}: adviser row without CRD or legal name: {raw[:12]}")
            if rec["crd"] in crd_seen:
                raise SystemExit(f"CRD {rec['crd']} appears in both {crd_seen[rec['crd']]} and {csv_name}")
            crd_seen[rec["crd"]] = csv_name
            for office in ("main_office", "mail_office"):
                stats["private_residence_addresses_withheld"] += bool(rec[office].get("address_withheld"))
            cik = names.pad_cik(rec["cik_published"])
            by_cik = companies.by_cik(cik) if cik else None
            state, name_cik, key = companies.by_name(rec["legal_name"])
            stats["records"] += 1
            stats["with_cik_published"] += bool(cik)
            link_cik, method = None, None
            if by_cik:
                link_cik, method = by_cik, "exact CIK"
                stats["matched_by_cik"] += 1
            elif state == "matched":
                link_cik, method = name_cik, "exact normalised legal name (unique)"
                stats["matched_by_name"] += 1
            elif state == "ambiguous":
                stats["ambiguous_name"] += 1
                ambiguous_examples.append(rec["legal_name"])
            else:
                stats["unmatched"] += 1
            rec["firm_type_label"] = "SEC-registered investment adviser" if firm_type == "Registered" else "Exempt reporting adviser"
            rec["cik"] = cik
            rec["report_month"] = IA_REPORT_MONTH
            rec["report_url"] = url
            rec["report_file"] = csv_name
            rec["profile_match"] = {"cik": link_cik, "registrant": companies.names[link_cik], "method": method} if link_cik else None
            rows.append((firm_type, rec, url))
    return rows, stats, ambiguous_examples


def build_ia(companies, sources=None):
    parsed, stats, ambiguous = ia_rows(companies, sources)
    out = []
    state_counts = collections.Counter()
    disclosure = collections.Counter()
    for firm_type, rec, url in parsed:
        mo = rec["main_office"]
        place = ", ".join(x for x in [mo.get("city"), mo.get("state")] if x)
        yes = rec["disclosure_yes_items"]
        links = [{"url": f"https://adviserinfo.sec.gov/firm/summary/{rec['crd']}", "label": "Investment Adviser Public Disclosure page (SEC)"}]
        if rec["profile_match"]:
            pm = rec["profile_match"]
            links.insert(0, {"url": f"/companies/{pm['cik']}", "label": f"SEC registrant: {pm['registrant']} ({pm['method']})"})
        if rec["cik"]:
            links.append({"url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={rec['cik']}", "label": "SEC EDGAR filings for this CIK"})
        company = sorted({c for c in [rec["cik"], rec["profile_match"]["cik"] if rec["profile_match"] else None] if c})
        state_counts[(firm_type, mo.get("state") or "")] += 1
        disclosure[(firm_type, rec["disclosure_any"] or "")] += 1
        out.append(cm.record(
            "sec_investment_advisers", f"ia:{rec['crd']}", rec["legal_name"], source_url=url,
            subtitle=" · ".join(x for x in [rec["firm_type_label"], f"CRD {rec['crd']}", f"SEC# {rec['sec_number']}" if rec["sec_number"] else None, place or None] if x),
            cells={
                "name": rec["legal_name"], "business_name": rec["primary_business_name"] or cm.NOT_RECORDED, "type": rec["firm_type_label"],
                "crd": rec["crd"], "sec_number": rec["sec_number"] or cm.NOT_RECORDED, "city": mo.get("city") or cm.NOT_RECORDED,
                "state": mo.get("state") or cm.NOT_RECORDED,
                "raum": money_label(rec["raum_total_usd"]) if firm_type == "Registered" else "Not applicable (exempt reporting adviser)",
                "disclosure": {"Y": "Yes", "N": "No"}.get(rec["disclosure_any"] or "", cm.NOT_RECORDED),
            },
            facts=[
                ("Legal name (as published)", rec["legal_name"]), ("Primary business name (as published)", rec["primary_business_name"]),
                ("Firm type", rec["firm_type_label"]), ("Organization CRD#", rec["crd"]), ("SEC#", rec["sec_number"]),
                ("CIK# (as published)", rec["cik_published"]), ("Total number of CIK numbers (as published)", rec["cik_count_published"]),
                ("SEC current status", rec["status"]), ("SEC status effective date", rec["status_effective_date"]),
                ("Latest ADV filing date", rec["latest_adv_filing_date"]), ("Form version", rec["form_version"]),
                ("Main office", main_office_text(mo)),
                ("Website (as published)", rec["website"]), ("Form of organization (Item 3.A)", rec["organization_form"]),
                *([
                    ("Regulatory assets under management, total (Item 5.F.(2)(c))", money_label(rec["raum_total_usd"]) if rec["raum_total_usd"] is not None else None),
                    ("Accounts, total (Item 5.F.(2)(f))", rec["accounts_total"]),
                ] if firm_type == "Registered" else []),
                ("Private funds reported (Item 7.B.(1))", rec["private_funds_item_7b1"]),
                ("Any Item 11 disclosure answered Yes", {"Y": "Yes", "N": "No"}.get(rec["disclosure_any"] or "")),
                ("Item 11 questions answered Yes", [f"{y['item']} ({y['count']} disclosure{'s' if y['count'] != 1 else ''})" if y['count'] is not None else y['item'] for y in yes]),
                ("Report", f"SEC adviser report {IA_REPORT_MONTH} ({rec['report_file']})"),
            ],
            text=" ".join(filter(None, [rec["legal_name"], rec["primary_business_name"], rec["crd"], rec["sec_number"], rec["cik_published"], mo.get("city"), mo.get("state")])),
            filters={"firm_type": [firm_type], "state": [mo["state"]] if mo.get("state") else [], "disclosure": [rec["disclosure_any"]] if rec["disclosure_any"] else [],
                     "company": company},
            links=links, extra={"investment_adviser": prune({k: v for k, v in rec.items() if k not in ("firm_type_label", "report_url", "report_file", "report_month")})},
        ))
    out.sort(key=lambda r: (r["title"].casefold(), r["id"]))
    overview = {
        "report_month": IA_REPORT_MONTH,
        "registered": stats["Registered_rows"], "exempt_reporting": stats["ERA_rows"],
        "disclosure_answers": {f"{t}:{v or 'blank'}": n for (t, v), n in sorted(disclosure.items())},
        "top_states": {t: [[s, n] for (tt, s), n in sorted(state_counts.items(), key=lambda kv: -kv[1]) if tt == t and s][:15] for t in ("Registered", "ERA")},
    }
    out.insert(0, cm.overview_record(
        "sec_investment_advisers", "SEC adviser report overview", source_url=IA_PAGE, overview=overview,
        subtitle=f"{stats['Registered_rows']:,} registered and {stats['ERA_rows']:,} exempt reporting advisers, {IA_REPORT_MONTH}",
        facts=[("Registered advisers", stats["Registered_rows"]), ("Exempt reporting advisers", stats["ERA_rows"]), ("Report", IA_REPORT_MONTH)]))
    summary = {
        "source": "SEC Information About Registered Investment Advisers and Exempt Reporting Advisers (monthly Form ADV reports)",
        "source_pages": [IA_PAGE], "terms": TERMS_SEC,
        "coverage": f"The {IA_REPORT_MONTH} reports: {stats['Registered_rows']:,} SEC-registered advisers and {stats['ERA_rows']:,} exempt reporting advisers. Earlier months are on the SEC page and are not included.",
        "extraction": "A documented subset of the SEC's columns, under the SEC's own item numbers (identifying data, status and dates, Item 3.A, Item 5.F.(2) assets and accounts, Item 7.B.(1) private funds, Item 11 answers and counts). CSVs are Windows-1252 text. Dates become YYYY-MM-DD, dollar and count cells numbers, blanks Not recorded. Street address and telephone of an office the SEC flags as a private residence are withheld.",
        "matching": "company filter holds the adviser's published CIK# and any company_sec_profiles CIK matched on that CIK or on an exact normalised Legal Name that maps to exactly one profile; Primary Business Name is never used for matching.",
        "named_individuals": "Advisers that are sole proprietorships carry the name the SEC publishes, exactly as published.",
        "stats": dict(stats), "ambiguous_name_examples": ambiguous[:10],
    }
    columns = [("name", "Legal name"), ("type", "Type"), ("crd", "CRD#"), ("sec_number", "SEC#"), ("city", "City"), ("state", "State"),
               ("raum", "Regulatory AUM (Item 5.F.(2)(c))"), ("disclosure", "Item 11 disclosure")]
    lst = cm.listing(columns, [
        ("firm_type", "Firm type", {"Registered": "SEC-registered investment adviser", "ERA": "Exempt reporting adviser"}),
        ("disclosure", "Any Item 11 question answered Yes", {"Y": "Yes", "N": "No"}),
    ])
    return out, lst, summary, cm.manifest_inputs(["regfin/sec/ia/"]), stats


# ----------------------------------------------------------------------------------------------------- adviser statistics


def build_ia_stats():
    notes, tables = stats_parse.read_workbook(ACQ / "sec" / "stats" / "im-investment-adviser-statistics-support-data-20260805.xlsx")
    rows = []

    def tab_key(t):
        return [int(x) for x in t.replace("Tab.", "").split(".")]

    for tab in sorted(tables, key=tab_key):
        t = stats_parse.parse_table(tab, tables[tab], notes.get(tab))
        n_cells = sum(1 for r in t["rows"] for v in r["values"] if v is not None)
        rows.append(cm.record(
            "sec_adviser_statistics", f"iastat:{tab}", f"{tab} {t['title'] or ''}".strip(), source_url=IA_STATS_URL,
            subtitle=f"{t['years'][0]}-{t['years'][-1]} · {len(t['rows'])} rows",
            cells={"table": tab, "title": t["title"] or cm.NOT_RECORDED, "first_year": str(t["years"][0]), "last_year": str(t["years"][-1])},
            facts=[("Table", tab), ("Title", t["title"]), ("Method note (SEC)", t["method_note"]), ("Years", f"{t['years'][0]} to {t['years'][-1]}"),
                   ("Rows", len(t["rows"])), ("Values published", n_cells), ("Source", "SEC Division of Investment Management, Investment Adviser Statistics supporting data")],
            text=" ".join(filter(None, [tab, t["title"], t["method_note"], " ".join(" ".join(r["labels"]) for r in t["rows"])]))[:6000],
            filters={"_listing": ["yes"], "group": [tab.split(".")[1]]},
            links=[{"url": IA_STATS_PAGE, "label": "SEC Investment Adviser Statistics"}], extra={"adviser_table": t},
        ))
    summary = {
        "source": "SEC Division of Investment Management: Investment Adviser Statistics supporting data (Form ADV filings, December 2000 onward)",
        "source_pages": [IA_STATS_PAGE, SECURL + "/data-research/investment-management-data"], "terms": TERMS_SEC,
        "coverage": "Every table of the workbook dated 2026-08-05 (Tab.1.1-Tab.11.2), with the SEC's own title and method note for each",
        "extraction": "Cells are kept as published (numbers or Not recorded). Nothing is filled, interpolated or recomputed.",
        "matching": "Not applicable (aggregate statistics).",
        "named_individuals": "None.",
        "stats": {"tables": len(rows)},
    }
    lst = cm.listing([("table", "Table"), ("title", "Title"), ("first_year", "From"), ("last_year", "To")])
    return rows, lst, summary, cm.manifest_inputs(["regfin/sec/stats/"]), {"tables": len(rows)}


# ----------------------------------------------------------------------------------------------------------------- Fed


def build_frb(companies):
    base = ACQ / "frb" / "files"
    items = frb_parse.load_json(base / "ea-cms-recent.json") + frb_parse.load_json(base / "ea-old.json")
    actions = [frb_parse.action_from_item(i) for i in items]
    # second path: the Board's CSV must contain the same rows
    csv_sigs = collections.Counter(frb_parse.csv_signature(r) for r in frb_parse.csv_rows(base / "enforcementactions.csv"))
    json_sigs = collections.Counter(frb_parse.action_signature(a) for a in actions)
    differences = sum(((csv_sigs - json_sigs) + (json_sigs - csv_sigs)).values())
    return frb_build(actions, companies, differences)


def frb_build(actions, companies, csv_json_differences=0):
    stats = collections.Counter()
    stats["csv_json_row_differences"] = csv_json_differences
    ids = [a["id"] for a in actions]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate Board ids across recent and old lists")
    rows = []
    for a in actions:
        stats["records"] += 1
        stats[f"subject_{a['subject']}"] += 1
        link_ciks, links, match_notes = {}, [], []
        for field, segs, relation in (("banking_organization", a["organizations"], "subject"), ("individual_affiliation", a["affiliations"], "affiliation")):
            for seg in segs:
                state, cik, key = companies.by_name(seg["name"])
                seg["match"] = None
                if state == "matched":
                    seg["match"] = {"cik": cik, "registrant": companies.names[cik], "method": "exact normalised name (unique)"}
                    link_ciks.setdefault(relation, set()).add(cik)
                    stats[f"matched_{relation}"] += 1
                elif state == "ambiguous":
                    stats[f"ambiguous_{relation}"] += 1
                elif key:
                    stats[f"unmatched_{relation}"] += 1
        for relation, ciks in link_ciks.items():
            for cik in sorted(ciks):
                label = "named as the banking organization" if relation == "subject" else "named as the individual's affiliation"
                links.append({"url": f"/companies/{cik}", "label": f"SEC registrant: {companies.names[cik]} ({label}, exact name match)"})
        if a["url"]:
            links.insert(0, {"url": a["url"], "label": a["url_label"] or "Board document"})
        links += [{"url": l["url"], "label": l["label"]} for l in a["note_links"]]
        subject_name = a["individual"] or a["banking_organization"] or "Not recorded"
        affiliation = a["individual_affiliation"]
        source_url = a["url"] or FRB_PAGE
        company_filter = sorted({c for s in link_ciks.values() for c in s})
        name_keys = sorted({s["key"] for s in a["organizations"] if s["key"]})
        affil_keys = sorted({s["key"] for s in a["affiliations"] if s["key"]})
        rows.append(cm.record(
            "frb_enforcement_actions", f"frb:{a['id']}", subject_name, source_url=source_url,
            subtitle=" · ".join(x for x in [a["type"], a["effective_date"], affiliation] if x),
            cells={
                "subject": subject_name, "type": a["type"], "effective": a["effective_date"],
                "terminated": a["termination_date"] or "None published", "affiliation": affiliation or cm.NOT_RECORDED,
                "kind": "Individual" if a["individual"] else "Banking organization",
            },
            facts=[
                ("Banking organization (as published)", a["banking_organization"]), ("Individual (as published)", a["individual"]),
                ("Individual affiliation (as published)", a["individual_affiliation"]), ("Action (as published)", a["type"]),
                ("Effective date", a["effective_date"]), ("Termination date", a["termination_date"] or "None published"),
                ("Document", f"{a['url_label'] or 'Link'}: {a['url']}" if a["url"] else None),
                ("Document link as published (not usable as a link)", a["url_unresolved"]), ("Note (as published)", a["note"]),
                ("Type family (grouping used for counts)", a["type_family"]),
                ("Source", "Federal Reserve Board: Enforcement Actions search data (federalreserve.gov/supervisionreg/files)"),
            ],
            text=" ".join(filter(None, [a["banking_organization"], a["individual"], a["individual_affiliation"], a["type"], a["effective_date"], a["note"]])),
            filters={"year": [a["year"]], "type_family": [a["type_family"]], "subject": [a["subject"]], "company": company_filter,
                     "name_key": name_keys, "affiliation_key": affil_keys},
            links=links, extra={"frb_action": a},
        ))
    rows.sort(key=lambda r: (r["item"]["frb_action"]["effective_date"], r["id"]), reverse=True)
    by_year = collections.defaultdict(collections.Counter)
    for a in actions:
        by_year[a["year"]][a["type_family"]] += 1
    latest = max(a["effective_date"] for a in actions)
    overview = {
        "first_effective_date": min(a["effective_date"] for a in actions), "latest_effective_date": latest, "actions": len(actions),
        "by_year_family": {y: dict(c) for y, c in sorted(by_year.items())},
        "families": frb_parse.FAMILY_LABELS,
        "subjects": {"organization": stats["subject_organization"], "individual": stats["subject_individual"]},
        "count_definition": "Rows in the Board's enforcement-actions list, by the year of the effective date; one row per banking organization or individual named. Grouped by the first action name in the Board's type text.",
        "partial_year": latest[:4],
    }
    rows.insert(0, cm.overview_record(
        "frb_enforcement_actions", "Federal Reserve enforcement actions overview", source_url=FRB_PAGE, overview=overview,
        subtitle=f"{len(actions):,} actions, effective {overview['first_effective_date']} to {latest}",
        facts=[("Actions", len(actions)), ("First effective date", overview["first_effective_date"]), ("Latest effective date", latest),
               ("Organizations", stats["subject_organization"]), ("Individuals", stats["subject_individual"])]))
    summary = {
        "source": "Federal Reserve Board Enforcement Actions search data (ea-cms-recent.json, ea-old.json; checked against enforcementactions.csv)",
        "source_pages": [FRB_PAGE, FRB_FILES + "ea-cms-recent.json", FRB_FILES + "ea-old.json", FRB_FILES + "enforcementactions.csv"],
        "terms": TERMS_FRB,
        "coverage": f"Formal enforcement actions made public since August 1989 and Section 19 letters since 2008, as listed by the Board through {latest}. Actions before August 1989 are not public.",
        "extraction": "Board fields as published (Effective Date, Termination Date, Individual, Individual Affiliation, Banking Organization, Action, URL, Name, Note); the placeholder termination date 1950-01-01 is shown as 'None published'; Board-relative links become absolute https links; <a> tags in a Note become a plain-text note and separate links.",
        "matching": "Each ';'-separated banking organization or affiliation is split into legal name and 'City, State'. A name links to /companies/<CIK> only when its exact normalised name equals exactly one company_sec_profiles registrant name; shared keys are ambiguous and never linked. The Board publishes no CIK or RSSD ID in this list.",
        "named_individuals": "Individuals are shown exactly as the Board publishes them, with the Board's document link (owner decision 2026-10-22). Nothing is inferred about a person.",
        "stats": dict(stats),
    }
    columns = [("subject", "Named"), ("kind", "Kind"), ("type", "Action"), ("effective", "Effective"), ("terminated", "Terminated"), ("affiliation", "Individual's affiliation")]
    lst = cm.listing(columns, [
        ("year", "Effective year", {y: y for y in sorted(by_year, reverse=True)}),
        ("type_family", "Action family", {f: f for f in frb_parse.FAMILY_LABELS}),
        ("subject", "Named", {"organization": "Banking organization", "individual": "Individual"}),
    ])
    return rows, lst, summary, cm.manifest_inputs(["regfin/frb/files/"]), stats


BUILDERS = {
    "bd": ("sec_broker_dealers", "SEC broker-dealers: every CIK on the monthly active-broker-dealer lists, March 2007 to October 2026", build_bd, True),
    "ia": ("sec_investment_advisers", "SEC investment advisers: registered and exempt reporting advisers, Form ADV report of October 2026", build_ia, True),
    "stats": ("sec_adviser_statistics", "SEC investment adviser statistics: Division of Investment Management tables, 2000 to 2025", build_ia_stats, False),
    "frb": ("frb_enforcement_actions", "Federal Reserve Board enforcement actions, 1989 to October 2026", build_frb, True),
}


def main(argv):
    companies, lookup = cm.load_companies()
    wanted = argv or list(BUILDERS)
    all_stats = {}
    for key in wanted:
        dataset, label, fn, needs_companies = BUILDERS[key]
        rows, lst, summary, inputs, stats = fn(companies) if needs_companies else fn()
        cm.write_build(dataset, label, rows, lst, summary, inputs)
        all_stats[dataset] = dict(stats)
    stats_path = cm.BUILD / "stats.json"
    prior = json.loads(stats_path.read_text()) if stats_path.exists() else {}
    prior.update(all_stats)
    prior["_company_lookup"] = {"profiles": len(companies.names), "unique_keys": len(companies.unique), "ambiguous_keys": companies.ambiguous,
                                "retrieved_at": lookup.get("retrieved_at"), "source": lookup.get("source")}
    stats_path.write_text(json.dumps(prior, indent=1, sort_keys=True))
    print(json.dumps(all_stats, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1:])
