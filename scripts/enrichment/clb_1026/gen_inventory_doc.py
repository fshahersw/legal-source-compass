"""Write docs/courtlistener-bulk-inventory-2026-10-24.md from the complete bucket listing (list_bucket.py) and the
table -> dataset map below (checked against the builders that read each file; see the handoff).

    python3 -I -B gen_inventory_doc.py <inventory.json> <out.md>
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/"
LIST_URL = BASE + "?list-type=2&prefix=bulk-data/"
KEY = re.compile(r"^bulk-data/(?P<dir>(?:[^/]+/)*)(?P<table>.+?)[-_](?P<date>\d{4}-\d{2}-\d{2})(?P<ext>\..+)$")

# table -> (status, what uses it). status: used | new (first used in wave 1026) | partly (some columns or rows used, rest open)
# | empty (no data rows) | not used (with the reason).
USE = {
    "courts": ("used", "every clb_* dataset (court names, levels, parents); clb_court_profiles; case-law search pipeline (court levels)"),
    "courthouses": ("used", "judge_cl_crosswalk builder (court seats); case-law search pipeline (court locations)"),
    "dockets": ("used", "clb_court_profiles, clb_docket_master, clb_judge_dockets, clb_court_flows (appeal edges), clb_oral_arguments and clb_bankruptcy_courts (docket joins), matter cross-analysis; 25 of 54 columns read (text fields reduced to lengths)"),
    "opinion-clusters": ("used", "clb_court_profiles, clb_top_cited, clb_court_flows, clb_docket_master; case-law search pipeline"),
    "opinions": ("used", "clb_judge_dockets (authorship), clb_court_flows and clb_top_cited (opinion to cluster); case-law search pipeline (text)"),
    "citation-map": ("used", "clb_court_flows, clb_top_cited; case-law search pipeline (cited-by)"),
    "citations": ("used", "clb_court_profiles (reporters), clb_unmatched_citations; case-law search pipeline"),
    "parentheticals": ("partly", "clb_top_cited_parentheticals (the 1,000 most-cited clusters only) and clb_court_profiles (counts); parentheticals of all other opinions are not published"),
    "unmatched-citations": ("used", "clb_unmatched_citations"),
    "oral-arguments": ("partly", "clb_oral_arguments and clb_court_profiles (counts, durations, named judges); recording-level metadata and transcripts are not published"),
    "originating-court-information": ("partly", "clb_appellate_timing (appellate courts with 100+ appeals); lower-court-level views need the full docket table"),
    "fjc-integrated-database": ("used", "clb_court_profiles, clb_docket_master, clb_district_crossview, clb_judge_dockets, clb_court_flows (FJC IDB fields via CourtListener; the FJC files themselves feed fjc_idb_*)"),
    "people-db-people": ("used", "clb_court_benches, clb_bench_cohorts, clb_judge_dockets, judge_cl_crosswalk; new: clb_judge_people"),
    "people-db-positions": ("used", "clb_court_benches, clb_bench_cohorts, clb_judge_dockets, clb_judge_disclosures (court), judge_cl_crosswalk; new: clb_judge_people (every position with nomination, hearing, confirmation, votes, selection, termination)"),
    "people-db-educations": ("new", "clb_bench_cohorts (law-school cohorts); new: clb_judge_people (every degree per judge)"),
    "people-db-schools": ("new", "clb_bench_cohorts; new: clb_judge_people (school names and aliases)"),
    "people-db-political-affiliations": ("new", "clb_bench_cohorts (counts); new: clb_judge_people (each affiliation with its recorded source and dates)"),
    "people-db-races": ("used", "clb_bench_cohorts (counts only; not published per person)"),
    "people_db_race": ("used", "clb_bench_cohorts (the race code table)"),
    "people-db-retention-events": ("empty", "header only: CourtListener records no retention events (the REST endpoint also reported a count of 0 on 2026-10-24)"),
    "court-appeals-to": ("new", "new: clb_court_appeals_to (all 8 rows)"),
    "search_opinioncluster_panel": ("used", "clb_appellate_panels; case-law search pipeline"),
    "search_opinion_joined_by": ("used", "clb_appellate_panels, clb_court_profiles"),
    "search_opinioncluster_non_participating_judges": ("empty", "header only: no rows in any snapshot listed"),
    "financial-disclosures": ("used", "clb_disclosure_coverage, clb_judge_disclosures; new: clb_judge_disclosure_items (report types decoded)"),
    "financial-disclosure-investments": ("new", "counted before (clb_disclosure_coverage, clb_judge_disclosures); new: clb_judge_disclosure_items (per judge and year by printed value, income and transaction codes)"),
    "financial-disclosures-debts": ("new", "counted before; new: clb_judge_disclosure_items (by printed value code, listed as filed)"),
    "financial-disclosures-non-investment-income": ("new", "counted before; new: clb_judge_disclosure_items (listed with the amount as filed)"),
    "financial-disclosures-positions": ("new", "counted before; new: clb_judge_disclosure_items (outside positions listed as filed)"),
    "financial-disclosures-spousal-income": ("new", "counted before; new: clb_judge_disclosure_items (listed as filed)"),
    "financial-disclosures-gifts": ("used", "clb_judge_disclosures (listed), clb_disclosure_coverage"),
    "financial-disclosures-reimbursements": ("used", "clb_judge_disclosures (listed), clb_disclosure_coverage"),
    "financial-disclosures-agreements": ("used", "clb_judge_disclosures (listed), clb_disclosure_coverage"),
    "randoms/bankruptcy-dockets": ("used", "clb_bankruptcy_courts"),
    "schema": ("used", "clb_bulk_schema (138 tables)"),
    "load-bulk-data": ("used", "clb_bulk_schema (which tables have a bulk file)"),
}
OTHER = {
    "bulk-data/eyecite/tests/one-percent.csv.bz2": "not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source)",
    "bulk-data/eyecite/tests/ten-percent.csv.bz2": "not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source)",
    "bulk-data/eyecite/tests/one-percent-1975-2023.csv.bz2": "not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source)",
    "bulk-data/eyecite/tests/one-percent-1975-2023-random-order.csv.bz2": "not used: a test sample of opinion texts for the citation extractor (the full opinions table is the source)",
    "bulk-data/randoms/all-csv.zip": "not used: nine bankruptcy courts' creditor mailing matrices (names and addresses of private debtors' creditors), personal data",
    "bulk-data/randoms/all-csv-pull-3.zip": "not used: a later pull of the nine bankruptcy courts' creditor mailing matrices, personal data",
    "bulk-data/randoms/nywb-petitions.zip": "not used: 968 individual bankruptcy petitions (PDFs) of private persons, personal financial documents",
    "bulk-data/randoms/nywb-petitions-2.zip": "not used: 1,029 more individual bankruptcy petitions (PDFs) of private persons, personal financial documents",
    "bulk-data/randoms/scotus_caption_data.csv": "not used: an older Supreme Court opinion/cluster/docket extract; the 2026-09-30 tables supersede it",
    "bulk-data/randoms/scotus_network.csv": "not used: an older Supreme Court citation extract; the 2026-09-30 citation map supersedes it",
}


def mb(n: int) -> str:
    if n < 1_000:
        return f"{n:,} B"
    if n < 1_000_000:
        return f"{n / 1e3:,.1f} KB"
    return f"{n / 1e6:,.1f} MB" if n < 1e9 else f"{n / 1e9:,.2f} GB"


def main() -> None:
    inv = json.load(open(sys.argv[1]))
    groups = defaultdict(list)
    other = []
    for o in inv["items"]:
        m = KEY.match(o["key"])
        if not m:
            other.append(o)
            continue
        groups[m["dir"] + m["table"]].append({**o, "date": m["date"], "ext": m["ext"]})
    snaps = defaultdict(list)
    for t, objs in groups.items():
        for o in objs:
            snaps[o["date"]].append(t)
    latest = max(snaps)
    lines = []
    w = lines.append
    w("# CourtListener bulk-data inventory — October 24, 2026")
    w("")
    w(f"Complete listing of the public bucket [bulk-data/]({BASE}list.html?prefix=bulk-data/) through the S3 ListObjectsV2 API "
      f"(`{LIST_URL}`), paginated until `IsTruncated=false`: **{inv['objects']:,} objects** in {inv['pages']} pages, listed {inv['listed_at']}. "
      "The raw XML pages are kept unchanged (gzip, sha256 in `private/acq/clb_1026/listing/_manifest.jsonl`).")
    w("")
    tot = sum(o["size"] for o in inv["items"])
    lat_objs = [o for v in groups.values() for o in v if o["date"] == latest]
    w(f"Total listed size: {mb(tot)} across {len(snaps)} snapshot dates (first {min(snaps)}, latest {latest}). "
      f"The latest snapshot ({latest}) has {len(lat_objs)} objects, {mb(sum(o['size'] for o in lat_objs))}. "
      "Sizes are compressed object sizes from the listing, not row counts.")
    w("")
    w("Status: **used** = read by a published dataset; **new** = first read into a dataset in wave 1026 (or read in full for the first time); "
      "**partly** = some columns or rows read, the rest open; **empty** = no data rows; **not used** = with the reason.")
    w("")
    w("## Tables (latest snapshot)")
    w("")
    w("| Table | Status | Latest size | Snapshots | First | Total, all snapshots | Read by |")
    w("|---|---|---:|---:|---|---:|---|")
    sums = defaultdict(int)
    for t in sorted(groups, key=lambda t: -max(o["size"] for o in groups[t] if o["date"] == max(x["date"] for x in groups[t]))):
        objs = sorted(groups[t], key=lambda o: o["date"])
        last = objs[-1]
        status, use = USE.get(t, ("not used", "not mapped"))
        sums[status] += last["size"] if last["date"] == latest else 0
        url = BASE + last["key"]
        w(f"| [{t}]({url}) | {status} | {mb(last['size'])} | {len(objs)} | {objs[0]['date']} | {mb(sum(o['size'] for o in objs))} | {use} |")
    w("")
    w("Latest-snapshot bytes by status: " + "; ".join(f"{k} {mb(v)}" for k, v in sorted(sums.items())) + ".")
    w("")
    w("## Other objects")
    w("")
    w("| Object | Size | Last modified | Decision |")
    w("|---|---:|---|---|")
    for o in sorted(other, key=lambda o: o["key"]):
        w(f"| [{o['key'][len('bulk-data/'):]}]({BASE + o['key']}) | {mb(o['size'])} | {o['last_modified'][:10]} | {OTHER.get(o['key'], 'not mapped')} |")
    w("")
    w("## Snapshots")
    w("")
    w("Older snapshots are earlier full copies of the same tables. Only the latest is read; the earlier ones are listed so a "
      "change between snapshots can be measured later. Snapshot dates and object counts:")
    w("")
    w("| Snapshot | Objects | Size |")
    w("|---|---:|---:|")
    for d in sorted(snaps, reverse=True):
        objs = [o for v in groups.values() for o in v if o["date"] == d]
        w(f"| {d} | {len(objs)} | {mb(sum(o['size'] for o in objs))} |")
    w("")
    w("## Datasets built in wave 1026")
    w("")
    w("| Dataset | Records | Reads |")
    w("|---|---:|---|")
    build_dir = os.path.join(ROOT, "private", "build", "clb_1026")
    reads = {"clb_judge_people": "people-db people, positions, educations, schools, political affiliations, retention events; courts; originating-court information; aba-ratings API",
             "clb_judge_disclosure_items": "financial-disclosures and its eight line-item files; people-db people",
             "clb_court_appeals_to": "court-appeals-to; courts",
             "clb_search_counts": "search API counts (642 exact queries)"}
    for ds, what in reads.items():
        f = os.path.join(build_dir, ds + ".json")
        n = len(json.load(open(f))["rows"]) if os.path.exists(f) else None
        w(f"| {ds} | {'not built' if n is None else f'{n:,}'} | {what} |")
    w("")
    w("## Data that has no bulk file")
    w("")
    w("- ABA ratings (2,426 rows) and person source notes (20,430 rows) are tables of the people database without a bulk file. "
      "ABA ratings were read through the REST API (`/api/rest/v4/aba-ratings/`, 122 pages of 20 rows) into clb_judge_people. "
      "Source notes were not read: 1,022 requests at 20 rows per page exceed this stream's request budget.")
    w("- Retention events: the bulk file has a header and no rows, and the API count is 0; CourtListener records none.")
    w("- Parties, attorneys, docket entries and RECAP documents have no bulk file (see docs/courtlistener-bulk-acquisition-gaps-2026-10-02.md).")
    w("")
    w("## Search-count statistics (REST search API)")
    w("")
    w("clb_search_counts records result counts of CourtListener's search engine for exact advanced queries (phrases, a boolean group, "
      "a proximity search, fielded court and date-range filters): counts the bulk files cannot give without reading the 55 GB opinions "
      "table. Every row carries its query, request URL and retrieval time. See the dataset summary for the full query list. "
      "Counts above 2,000 are the engine's estimates and are marked approximate: published plus unpublished differed from the "
      "combined count by -1.2% to +0.9% for yearly totals, while counts of 137 to 4,143 added up exactly, and the Ninth Circuit's "
      "2020 count (4,143) equals the bulk snapshot's cluster count.")
    w("")
    w("Generated by `scripts/enrichment/clb_1026/gen_inventory_doc.py` from the listing file named above.")
    with open(sys.argv[2], "w") as h:
        h.write("\n".join(lines) + "\n")
    print("wrote", sys.argv[2], len(lines), "lines")


if __name__ == "__main__":
    main()
