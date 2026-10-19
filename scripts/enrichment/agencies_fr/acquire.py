"""Acquire official agency and Federal Register sources for the agencies_fr stream (raw bytes unchanged + manifest).

Usage: python3 -I -B scripts/enrichment/agencies_fr/acquire.py <stage> [<stage> ...] [--as-of=YYYY-MM-DD]
Stages:
  fr          federalregister.gov API v1: agency directory, agency facets by year/type, administration windows and
              recent months, FR-wide yearly facets, presidential documents, significant-document listings, open
              comment periods
  ecfr        ecfr.gov admin API: agencies with CFR title/chapter references; versioner titles
  usaspending api.usaspending.gov: toptier agencies, agency overview, budgetary resources, sub-agency obligations
              (FY2025) and award obligations by state (FY2024, FY2025)
  census      Census Bureau Vintage 2025 state population estimates (NST-EST2025-ALLDATA.csv)
  reginfo     reginfo.gov Unified Agenda XML (latest edition)
  govman      GovInfo U.S. Government Manual 2025 edition (bulk XML zip)
Re-running a stage reuses files already stored (no re-download).
"""
import datetime as dt
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import fetch, fetch_json  # noqa: E402

FR = "https://www.federalregister.gov/api/v1/"
FR_METHOD = "federalregister.gov API v1 (documented, keyless), direct HTTPS"
YEARS = list(range(1994, 2027))
TYPES = ["RULE", "PRORULE", "NOTICE", "PRESDOCU"]
# Presidential terms begin and end at noon on January 20 (U.S. Constitution, 20th Amendment). Windows are by
# Federal Register publication date. The API's coverage starts 1994-01-01, but it types most 1994 documents as
# uncategorized (128 rules in 1994 against ~4,700 a year from 1995), so the first window starts 1995-01-01.
ADMINS = [
    ("clinton", "1995-01-01", "2001-01-19"),
    ("bush", "2001-01-20", "2009-01-19"),
    ("obama", "2009-01-20", "2017-01-19"),
    ("trump1", "2017-01-20", "2021-01-19"),
    ("biden", "2021-01-20", "2025-01-19"),
    ("trump2", "2025-01-20", None),
]
PRES_TYPES = ["executive_order", "proclamation", "memorandum", "notice", "determination", "presidential_order", "other"]
SIG_FIELDS = ["document_number", "publication_date", "title", "type", "agencies", "html_url", "citation",
              "cfr_references", "regulation_id_numbers", "effective_on", "abstract", "significant", "docket_ids",
              "comments_close_on"]
COMMENT_FIELDS = ["document_number", "publication_date", "title", "type", "agencies", "html_url", "citation",
                  "comments_close_on", "comment_url", "docket_ids", "regulation_id_numbers", "significant",
                  "cfr_references"]
EO_FIELDS = ["document_number", "executive_order_number", "signing_date", "publication_date", "president", "title",
             "html_url", "citation"]


def fr_url(path, params):
    return FR + path + "?" + urllib.parse.urlencode(params, doseq=True)


def fr_pages(first_url, rel_prefix):
    """Follow next_page_url; returns the list of page bodies."""
    pages, url, n = [], first_url, 1
    while url:
        body = fetch_json(url, f"{rel_prefix}_p{n}.json", FR_METHOD)
        pages.append(body)
        url = body.get("next_page_url")
        n += 1
        if n > 60:
            raise RuntimeError(f"too many pages for {first_url}")
    return pages


def month_windows(as_of, count=37):
    year, month = as_of.year, as_of.month
    out = []
    for _ in range(count):
        first = dt.date(year, month, 1)
        nxt = dt.date(year + (month == 12), month % 12 + 1, 1)
        out.append((first.strftime("%Y-%m"), first.isoformat(), (nxt - dt.timedelta(days=1)).isoformat()))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(out))


def stage_fr(as_of):
    fetch(FR + "agencies", "fr/agencies.json", FR_METHOD)
    fetch(fr_url("documents/facets/type", {}), "fr/facets/type_all.json", FR_METHOD)
    for year in YEARS:
        for t in [None] + TYPES:
            params = {"conditions[publication_date][year]": str(year)}
            if t:
                params["conditions[type][]"] = t
            fetch(fr_url("documents/facets/agency", params), f"fr/facets/agency_year/{t or 'ALL'}_{year}.json", FR_METHOD)
    for key, start, end in ADMINS:
        for t in [None, "RULE", "PRORULE", "NOTICE"]:
            params = {"conditions[publication_date][gte]": start, "conditions[publication_date][lte]": end or as_of.isoformat()}
            if t:
                params["conditions[type][]"] = t
            fetch(fr_url("documents/facets/agency", params), f"fr/facets/agency_admin/{t or 'ALL'}_{key}_{start}.json", FR_METHOD)
    for key, start, end in month_windows(as_of):
        for t in ["RULE", "PRORULE", "NOTICE"]:
            params = {"conditions[publication_date][gte]": start, "conditions[publication_date][lte]": end,
                      "conditions[type][]": t}
            fetch(fr_url("documents/facets/agency", params), f"fr/facets/agency_month/{t}_{key}.json", FR_METHOD)
    for t in [None] + TYPES:
        params = {"conditions[type][]": t} if t else {}
        fetch(fr_url("documents/facets/yearly", params), f"fr/facets/yearly/{t or 'ALL'}.json", FR_METHOD)
    for key, start, end in ADMINS:
        params = {"conditions[publication_date][gte]": start, "conditions[publication_date][lte]": end or as_of.isoformat()}
        fetch(fr_url("documents/facets/type", params), f"fr/facets/type_admin/{key}_{start}.json", FR_METHOD)
    first_month = month_windows(as_of)[0][1]
    for t in ["RULE", "PRORULE", "NOTICE"]:
        params = {"conditions[type][]": t, "conditions[publication_date][gte]": first_month,
                  "conditions[publication_date][lte]": as_of.isoformat()}
        fetch(fr_url("documents/facets/monthly", params), f"fr/facets/monthly/{t}.json", FR_METHOD)
    for p in PRES_TYPES:
        params = {"conditions[type][]": "PRESDOCU", "conditions[presidential_document_type][]": p}
        fetch(fr_url("documents/facets/yearly", params), f"fr/facets/presidential_yearly/{p}.json", FR_METHOD)
    eo = {"conditions[type][]": "PRESDOCU", "conditions[presidential_document_type][]": "executive_order",
          "per_page": "1000", "order": "oldest", "fields[]": EO_FIELDS}
    fr_pages(fr_url("documents.json", eo), "fr/eo/executive_orders")
    for year in YEARS:
        for t in ["RULE", "PRORULE"]:
            params = {"conditions[significant]": "1", "conditions[type][]": t,
                      "conditions[publication_date][year]": str(year), "per_page": "1000", "order": "newest",
                      "fields[]": SIG_FIELDS}
            fr_pages(fr_url("documents.json", params), f"fr/significant/{t}_{year}")
    params = {"conditions[comment_date][gte]": as_of.isoformat(), "per_page": "1000", "order": "oldest",
              "fields[]": COMMENT_FIELDS}
    fr_pages(fr_url("documents.json", params), f"fr/comments/open_{as_of.isoformat()}")


def stage_ecfr():
    method = "ecfr.gov admin/versioner API (documented, keyless), direct HTTPS"
    fetch("https://www.ecfr.gov/api/admin/v1/agencies.json", "ecfr/agencies.json", method)
    fetch("https://www.ecfr.gov/api/versioner/v1/titles.json", "ecfr/titles.json", method)


USA = "https://api.usaspending.gov/api/v2/"
USA_METHOD = "api.usaspending.gov v2 (documented, keyless), direct HTTPS"
FY_DATES = {2024: ("2023-10-01", "2024-09-30"), 2025: ("2024-10-01", "2025-09-30")}


def stage_usaspending():
    """Per-agency failures (the API answers some small agencies with persistent 5xx) are recorded, not fatal."""
    top = fetch_json(USA + "references/toptier_agencies/", "usaspending/toptier_agencies.json", USA_METHOD)
    failures = []

    def attempt(label, fn):
        try:
            return fn()
        except RuntimeError as error:
            failures.append({"request": label, "error": str(error)})
            return None

    for agency in top.get("results", []):
        code = agency["toptier_code"]
        attempt(f"agency {code}", lambda: fetch(USA + f"agency/{code}/", f"usaspending/agency/{code}.json", USA_METHOD))
        attempt(f"budget {code}", lambda: fetch(USA + f"agency/{code}/budgetary_resources/",
                                                f"usaspending/budget/{code}.json", USA_METHOD))
        page = 1
        while True:
            body = attempt(f"sub_agency {code} p{page}", lambda: fetch_json(
                USA + f"agency/{code}/sub_agency/?fiscal_year=2025&limit=100&page={page}",
                f"usaspending/sub_agency/{code}_fy2025_p{page}.json", USA_METHOD))
            if not body or not (body.get("page_metadata") or {}).get("hasNext"):
                break
            page += 1
        for fy, (start, end) in FY_DATES.items():
            body = {"scope": "place_of_performance", "geo_layer": "state", "spending_level": "transactions",
                    "filters": {"agencies": [{"type": "awarding", "tier": "toptier", "name": agency["agency_name"]}],
                                "time_period": [{"start_date": start, "end_date": end}]}}
            attempt(f"geo {code} FY{fy}", lambda: fetch(USA + "search/spending_by_geography/",
                                                       f"usaspending/geo/{code}_fy{fy}.json", USA_METHOD, body=body))
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "private", "acq", "agencies_fr",
                        "usaspending", "_failures.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(failures, fh, indent=1)
    print(json.dumps({"usaspending_failures": len(failures)}))


def stage_census():
    fetch("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
          "census/NST-EST2025-ALLDATA.csv", "census.gov official bulk file, direct HTTPS", accept="text/csv,*/*")


def stage_reginfo(edition="202510"):
    url = f"https://www.reginfo.gov/public/do/XMLViewFileAction?f=REGINFO_RIN_DATA_{edition}.xml"
    fetch(url, f"reginfo/REGINFO_RIN_DATA_{edition}.xml.gz", "reginfo.gov Unified Agenda XML download, direct HTTPS",
          store_gzip=True, timeout=600, accept="application/xml,*/*")
    fetch("https://www.reginfo.gov/public/do/eAgendaXmlReport", "reginfo/eAgendaXmlReport.html",
          "reginfo.gov XML report index page, direct HTTPS", accept="text/html,*/*")


def stage_govman():
    fetch("https://www.govinfo.gov/bulkdata/GOVMAN/2025/GOVMAN-2025-12-31.zip", "govman/GOVMAN-2025-12-31.zip",
          "govinfo.gov bulk data (U.S. Government Manual), direct HTTPS", accept="application/zip,*/*", reuse=False)


def main(argv):
    as_of = dt.date.fromisoformat(next((a.split("=", 1)[1] for a in argv if a.startswith("--as-of=")), "2026-10-19"))
    stages = [a for a in argv if not a.startswith("--")]
    for stage in stages:
        if stage == "fr":
            stage_fr(as_of)
        elif stage == "ecfr":
            stage_ecfr()
        elif stage == "usaspending":
            stage_usaspending()
        elif stage == "census":
            stage_census()
        elif stage == "reginfo":
            stage_reginfo()
        elif stage == "govman":
            stage_govman()
        else:
            raise SystemExit(f"unknown stage {stage}")
        print(json.dumps({"stage": stage, "done": True}))


if __name__ == "__main__":
    main(sys.argv[1:])
