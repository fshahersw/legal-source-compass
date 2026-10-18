"""Catalog spot checks: a fixed-seed random sample of enforcement_data_sources_catalog entries checked by hand.

Sample: random.Random(20261018): 6 federal + 16 state/local entries from the catalog build (22 entries).
For each entry the script verifies mechanically that the listed line appears verbatim on the saved Good Jobs First page, then
records the reviewer's reading of the agency page (title / heading from the saved bytes of the catalog URL check, or a Firecrawl
read for pages the sandbox could not load) against the coverage the list claims.

Results:  confirmed        the agency's own page loads and its title/heading matches the listed coverage
          partly_confirmed the page loads and is the agency's own, but the listed coverage is not visible on the page that was read
          flagged          the listed URL does not land where the listing says (redirect elsewhere) or the page is stale
          listing_only     no URL (open-records request) or robots.txt forbids fetching: only the listing's fidelity was checked

Usage: python3 -I -B write_catalog_spot_checks.py   (needs private/build/third_party_data/enforcement_data_sources_catalog.json from a first build)

NOTE (2026-10-18, owner decision): the sample below was drawn on the first, held build. It is not redrawn after the neutral rebuild; the builder keys
the saved results by the legacy ids ('vt-src:...' == 'src:...') and the published rows carry them without any reference to the listing's publisher.
"""
import collections
import datetime
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vt_parse as vp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")

READINGS = {
    "vt-src:us:federal-aviation-administration:2": ("confirmed", "Page title 'Enforcement Reports | Federal Aviation Administration' at the FAA Chief Counsel enforcement/reports path; the 'quarterly' cadence was not read."),
    "vt-src:us:health-and-human-services-department-office-of-inspector-gen": ("confirmed", "Page title 'Enforcement Actions | Office of Inspector General' at /fraud/enforcement/cmp/ (civil monetary penalties); the 'since 2001' span was not read."),
    "vt-src:us:commodity-futures-trading-commission": ("confirmed", "Page title 'Press Releases | CFTC'; the list calls this 'resolved case announcements', i.e. the press-release index."),
    "vt-src:us:justice-department-national-security-division": ("confirmed", "Page title 'National Security Division | NSD News | United States Department of Justice'."),
    "vt-src:us:labor-department-wage-and-hour-division": ("flagged", "The listed enforcedata.dol.gov/views/data_summary.php page redirects to https://data.dol.gov/ (title 'Open Data Portal | United States Department of Labor'); the Wage and Hour compliance-action dataset page itself was not reached from the landing page, so the 'dataset download' coverage is unconfirmed."),
    "vt-src:us:national-highway-traffic-safety-administration": ("confirmed", "The sandbox gets HTTP 403. A Firecrawl read redirected the listed path to /laws-regulations/civil-penalty-settlements, titled 'Civil Penalty Settlements | NHTSA', which describes civil penalty settlement amounts for FY 2013-2020 (so the page is real but covers a fixed span)."),
    "vt-src:wi:wisconsin-department-of-health-services": ("partly_confirmed", "Page title 'DQA Provider Search' on forwardhealth.wi.gov loads; it is a provider search tool, and the 'enforcement actions' content is inside searches that were not run."),
    "vt-src:ca:santa-barbara-county-district-attorney": ("confirmed", "Page title 'Press Releases | Santa Barbara County DA'."),
    "vt-src:hi:hawaii-department-of-health": ("listing_only", "List entry is an open-records request with no public URL; nothing to load."),
    "vt-src:ca:california-air-resources-board": ("confirmed", "Page title 'Enforcement Case Settlements | California Air Resources Board' matches the listed 'settlements'."),
    "vt-src:or:oregon-attorney-general": ("confirmed", "Page title 'Media Releases - Oregon Department of Justice : Media' (the AG's media releases)."),
    "vt-src:il:illinois-department-of-public-health": ("confirmed", "Page title 'Quarterly Reports of Nursing Home Violators' under dph.illinois.gov health-care regulation; the list calls these enforcement actions."),
    "vt-src:il:chicago-commission-on-human-relations": ("confirmed", "Page title 'City of Chicago :: Decisions & Precedents in Discrimination Cases'. The agency is a City of Chicago office listed under Illinois (the first build mis-levelled it as state; vt_parse.level_of now returns local)."),
    "vt-src:ny:new-york-public-service-commission": ("confirmed", "Page title 'Press Releases | Department of Public Service' on dps.ny.gov."),
    "vt-src:de:delaware-attorney-general": ("confirmed", "Page title 'Department of Justice Press Releases Archives - State of Delaware News'."),
    "vt-src:va:virginia-board-of-pharmacy": ("partly_confirmed", "Page is the Department of Health Professions 'License Lookup' (Current as of 10/18/2026); the lookup landing page does not itself show cannabis enforcement actions."),
    "vt-src:nv:nevada-public-utilities-commission": ("partly_confirmed", "pucweb1.state.nv.us press-release list loads ('Commission News Releases'; the newest saved entry is dated 09/11/2023, so it is stale). The docket URL puc.nv.gov/Dockets/ is disallowed by robots.txt and was not fetched."),
    "vt-src:nj:new-jersey-department-of-labor-and-workforce-development": ("confirmed", "Page title 'Division of Employer Accounts | The WALL (Workplace Accountability in Labor List)'."),
    "vt-src:az:maricopa-county-attorney": ("confirmed", "Page title 'News Flash - Maricopa County Attorney's Office, AZ' (county attorney news releases)."),
    "vt-src:ia:iowa-racing-and-gaming-commission": ("listing_only", "List entry is an open-records request with no public URL; nothing to load."),
    "vt-src:wi:wisconsin-office-of-the-commissioner-of-insurance": ("listing_only", "ociaccess.oci.wi.gov is disallowed by robots.txt, so the order search page was not fetched; only the listing's fidelity was checked."),
    "vt-src:ca:ventura-county-district-attorney": ("confirmed", "Page title 'News Releases - Ventura County District Attorney'."),
}


def main():
    if "--redraw-sample" not in sys.argv:
        print("HISTORICAL: this sample was drawn and hand-read on the first build (514 entries, ids 'vt-src:...'). The 2026-10-18 neutral rebuild "
              "(ids 'src:...', 463 entries) reads the saved file private/acq/third_party_data/verification/catalog_spot_checks.json through the legacy "
              "ids and does NOT redraw it, because the hand readings belong to those entries. Pass --redraw-sample only to start a new sample "
              "(it needs new READINGS and the legacy-id mapping removed).")
        return
    d = json.load(open(os.path.join(BUILD, "enforcement_data_sources_catalog.json"), encoding="utf-8"))
    rows = {r["id"]: r for r in sorted(d["rows"], key=lambda r: r["id"])}
    ordered = list(rows.values())
    rng = random.Random(20261018)
    fed = [r for r in ordered if r["item"]["entry"]["jurisdiction"] == "Federal"]
    st = [r for r in ordered if r["item"]["entry"]["jurisdiction"] != "Federal"]
    sample = rng.sample(fed, 6) + rng.sample(st, 16)
    fed_blocks = {b["text"] for b in vp.blocks(open(os.path.join(ACQ, "violationtracker", "violation-tracker-data-sources.html"), encoding="utf-8").read())}
    st_blocks = {b["text"] for b in vp.blocks(open(os.path.join(ACQ, "violationtracker", "local-state-data-sources.html"), encoding="utf-8").read())}
    out = []
    for row in sample:
        entry = row["item"]["entry"]
        blocks = fed_blocks if entry["jurisdiction"] == "Federal" else st_blocks
        verbatim = entry["listed_line"] in blocks
        result, note = READINGS[row["id"]]
        out.append({"entry_id": row["id"], "agency": entry["agency"], "jurisdiction": entry["jurisdiction"], "listed_coverage": entry["coverage"],
                    "listing_verbatim_on_page": verbatim, "url_checks": [{"url": c["url"], "state": c["state"], "note": c["note"]} for c in row["item"]["url_checks"]],
                    "result": result, "note": note})
    assert len(out) == len(READINGS) and all(o["entry_id"] in READINGS for o in out)
    counts = collections.Counter(o["result"] for o in out)
    report = {"seed": 20261018, "sampled": len(out), "federal": 6, "state_local": 16, "checked_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
              "listing_verbatim": sum(1 for o in out if o["listing_verbatim_on_page"]), "result_counts": dict(counts), "rows": out}
    with open(os.path.join(ACQ, "verification", "catalog_spot_checks.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
    print(json.dumps({k: report[k] for k in ("sampled", "listing_verbatim", "result_counts")}))


if __name__ == "__main__":
    main()
