"""Write docs/class-action-reports-2026-10-24.md from the build outputs: terms of use per publisher, the owner decision,
the report inventory (title, publisher, date, URL, pages, sha256), facts per report, held tables, restatements and the
cross-publisher comparison.

    python3 -I -B scripts/enrichment/cra/write_inventory_doc.py <repo root to write into>
"""
from __future__ import annotations

import collections
import gzip
import json
import os
import sys

BUILD = "/home/user/legal-source-compass/private/build/cra"

TERMS = [
    ("Cornerstone Research", "https://www.cornerstone.com/conditions-terms-of-use/", "As of January 14, 2022", [
        "you agree that you will not (and not allow any third party to) ... (ii) use any robot, spider, site search/retrieval "
        "application, or other device to access, retrieve, screen scrape, screen surf, or employ any other data scraping method, or "
        "index any portion of this website or the content on the website (collectively, “Content”) for any purpose; ... or (v) use "
        "data or other Content from this website to create or compile a collection, compilation, database, or directory.",
        "Cornerstone Research grants you a nonexclusive, nontransferable license to view, copy, download, and print Cornerstone "
        "Research Content on this website, subject to the following conditions: The Content may be used solely for personal, "
        "noncommercial, and information purposes; The Content may not be modified, reproduced, or distributed; and You retain all "
        "copyright and other proprietary notices displayed on this website.",
        "If you would like to use documents on this website for commercial purposes, you must get advance written permission from "
        "Cornerstone Research by sending an email to questions@cornerstone.com.",
    ]),
    ("NERA Economic Consulting", "https://www.nera.com/terms-of-use.html", "Page retrieved 2026-10-24", [
        "NERA hereby grants you a non-exclusive, not-transferable license to access and download, display, and print the content on "
        "this site on any single computer solely for your internal, business use, provided that you do not modify such content in "
        "any way and that you retain all copyright and other proprietary notices displayed on such content. You may not otherwise "
        "reproduce, modify, distribute, transmit, post or disclose the content on this site without NERA’s prior written consent.",
        "robots.txt (www.nera.com): “Disallow: /content/dam/nera” and “Allow: /content/dam/nera/*.pdf”. The report PDFs are listed in "
        "NERA's public sitemap.xml. NERA's current publication pages also offer the download through a form; the PDFs themselves are "
        "served at public URLs without it.",
    ]),
    ("Stanford Securities Class Action Clearinghouse (SCAC)", "https://securities.stanford.edu/about-the-scac.html", "Terms of Service", [
        "Subject to the terms of this Terms of Service, with proper attribution, you may use the SCAC for your personal, "
        "non-commercial research or analysis.",
        "Not to reproduce, publish, distribute, sell, or modify the content of the SCAC for use on another website, app, blog, product, "
        "extension, publication, or service, except with the prior express written consent of Stanford University and applicable "
        "rights holders of the Third-Party Materials.",
        "Not to scrape the content of the SCAC or use web crawlers, spidering or other automated means to access, copy, index, "
        "process, and/or store any content made available on or through the SCAC.",
        "The SCAC does not own any of the intellectual property associated with the Third-Party Materials. Accordingly, Stanford "
        "University cannot grant or deny permission to use such materials ...",
    ]),
]

NOT_ACQUIRED = [
    ("Accounting Class Action Filings and Settlements—2016 Review and Analysis",
     "https://securities.stanford.edu/research-reports/1996-2016/Accounting-Class-Action-Filings-and-Settlements-2016-Review.pdf",
     "HTTP 404 at the Clearinghouse archive; no copy found on cornerstone.com."),
    ("Accounting Class Action Filings and Settlements, 2010 and 2012 editions", "",
     "No posted copy found on cornerstone.com, in the Clearinghouse archive or by site search."),
    ("Tech Company Securities Class Action Filings—H1 2020 Update",
     "https://www.cornerstone.com/insights/reports/tech-company-securities-class-action-filings-h1-2020-update/",
     "The publisher's page links no PDF; the 2015–Q1 2020 edition is included."),
    ("NERA, Trends in Canadian Securities Class Actions (annual, 2009–2025)", "https://www.nera.com/sitemap.xml",
     "Canadian series; outside the U.S. scope of the securities class action page. Not fetched; listed in NERA's sitemap."),
    ("NERA, Trends in Consumer Class Action Settlements (2014); Trends in Wage and Hour Settlements (2011)",
     "https://www.nera.com/content/dam/nera/publications/archive2/PUB_Consumer_Class_Action_Settlements_0614.pdf",
     "Other class action areas; not fetched in this build."),
]


def main(repo: str) -> None:
    reps = json.load(gzip.open(os.path.join(BUILD, "cra_reports.json.gz"), "rt"))["rows"]
    facts = json.load(gzip.open(os.path.join(BUILD, "cra_facts.json.gz"), "rt"))
    tables = json.load(open(os.path.join(BUILD, "tables.json")))
    ck = json.load(open(os.path.join(BUILD, "checks.json")))
    summary = facts["summary"]
    n_by = collections.Counter(r["item"]["profile"]["report_id"] for r in facts["rows"])
    L = ["# Class action research reports: inventory, terms and extracted facts (2026-10-24)", "",
         "Stream CRA, wave 1026. Datasets built: `cra_reports` (one row per report) and `cra_facts` (one row per fact). "
         "Publishing is done by the lead.", "",
         "## Permission", "",
         "Owner decision 2026-10-24: the owner states written permission was obtained from the publishers for this use.", "",
         "Use made: facts only (counts, dollar totals, medians, averages, percentages), each with publisher, report title, date, page and "
         "link to the publisher's PDF. The reports are linked, not rehosted; their charts, images and prose are not reproduced; no value "
         "is read off a chart.", "",
         "## Terms of use (quoted)", ""]
    for name, url, asof, quotes in TERMS:
        L += [f"### {name}", "", f"Source: {url} ({asof})", ""]
        L += [f"> {q}" for q in quotes for _ in [0]][:0]
        for q in quotes:
            L += [f"> {q}", ""]
    L += ["The Stanford Clearinghouse's own public statistics pages were read under the owner's Stanford consent recorded on 2026-10-19 "
          "(dataset `scac_statistics`). A re-read of https://securities.stanford.edu/stats.html on 2026-10-24 found its text unchanged "
          "(the Clearinghouse is restructuring; its data run through 28 July 2025), so `scac_statistics` is current and was not rebuilt.", "",
          "## How facts were extracted", "", summary["method"], "",
          f"Counts: {json.dumps(summary['counts'])}", "",
          "## Report inventory", "",
          "| Report | Publisher | Date | Pages | Facts | PDF | sha256 |", "|---|---|---|---|---|---|---|"]
    for r in reps:
        p = r["item"]["profile"]
        date = p["date"] + (f" ({p['date_basis']})" if p["date_basis"] else "")
        L.append(f"| {p['title']} ({p['edition']}) | {p['publisher']} | {date} | {p['pages']} | {n_by.get(p['id'], 0)} | "
                 f"[PDF]({p['pdf_url']}) | `{p['sha256'][:16]}…` |")
    L += ["", "Full sha256 values, retrieval times and other copies of each file are in the `cra_reports` rows.", "",
          "## Not acquired or not extracted", "", "| Item | URL | Why |", "|---|---|---|"]
    for t, u, why in NOT_ACQUIRED:
        L.append(f"| {t} | {u or 'Not recorded'} | {why} |")
    no_facts = [r["item"]["profile"] for r in reps if not n_by.get(r["item"]["profile"]["id"])]
    for p in no_facts:
        L.append(f"| {p['title']} ({p['edition']}) | {p['pdf_url']} | {p['status']} |")
    L += ["", "## Tables held (not published) and values left out", "", "| Report | Table | Page | Reason |", "|---|---|---|---|"]
    for t in tables["tables"]:
        if t["status"] == "held":
            L.append(f"| {t['report']} | {t['table']} | {t['page']} | {t['reason']} |")
    for i in tables["issues"]:
        if "Total row" not in i["reason"] and "column periods" not in i["reason"]:
            L.append(f"| {i['report_id']} | {i['table']} | {i['page']} | {i['reason']} |")
    L += ["", "## Restated values across report vintages", "",
          f"{len(ck['restated'])} measures are printed with a different value in a later report of the same series (same unit, dollar "
          "basis and population). Each vintage is kept as its own fact. Examples (class action filings per year, Cornerstone Research "
          "and the Stanford Clearinghouse; NERA filings):", "", "| Measure | Period | Values by report |", "|---|---|---|"]
    for r in ck["restated"]:
        if r["series"] in ("filings.class_action_filings", "nera.filings", "settlements.count") and not r["dimension"] and len(L) < 2000:
            vals = "; ".join(f"{v['report']}: {v['value']}" for v in r["vintages"])
            L.append(f"| {r['series']} | {r['period']} | {vals} |")
    L += ["", "## Filings per year by publisher (definitions differ; not reconciled)", "",
          "| Year | Cornerstone Research / Stanford Clearinghouse (latest report) | NERA (latest report stating it) |", "|---|---|---|"]
    for r in ck["cross_publisher_filings"]:
        L.append(f"| {r['year']} | {r['cornerstone']} ({r['cornerstone_report']}) | {r['nera']} ({r['nera_report']}) |")
    L += ["", "Each publisher defines its own sample in its report (for example, Cornerstone Research's filings sample excludes IPO "
          "allocation, analyst and mutual fund filings; NERA's early-2000s counts include IPO laddering cases, which it reports "
          "separately). The values are shown side by side, not reconciled.", ""]
    path = os.path.join(repo, "docs", "class-action-reports-2026-10-24.md")
    with open(path, "w") as h:
        h.write("\n".join(L) + "\n")
    print(path, len(L), "lines")


if __name__ == "__main__":
    main(sys.argv[1])
