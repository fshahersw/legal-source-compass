"""Build the FTC Consumer Sentinel, refunds and Do Not Call datasets from the stored FTC captures.

Inputs (unchanged): private/acq/ftc_sentinel/_manifest.jsonl and the Firecrawl captures it lists (ftc.gov blocks this
sandbox, so the official PDFs and pages were read through the Firecrawl MCP scrape tool; see REPORT.md).
Read-only lookup: private/build/ftc_sentinel/lookups/company_sec_profiles.json (company_sec_profiles titles).

Writes (one file per dataset, the shape corpus_writer.publish receives):
  private/build/ftc_sentinel/ftc_sentinel_states.json    per state/territory and Data Book year 2017-2024
  private/build/ftc_sentinel/ftc_sentinel_national.json  per Data Book year 2017-2024 plus the 2001-2024 series row
  private/build/ftc_sentinel/ftc_refunds.json            per case table row 2022-2024, per state/year, per year summary
  private/build/ftc_sentinel/ftc_refund_programs.json    active refund programs listed on ftc.gov/enforcement/refunds
  private/build/ftc_sentinel/ftc_dnc_states.json         per state and fiscal year 2021-2025 (Do Not Call Data Books)
  private/build/ftc_sentinel/build_log.json              every validation outcome the REPORT quotes

Nothing is published here; the lead runs private/scratch/enrich/publish_build.py on the files.
Usage: python3 -I -B scripts/enrichment/ftc_sentinel/build_ftc_sentinel.py
"""
import datetime as dt
import json
import os
import re
import sys

HERE =os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import ftc_common as C  # noqa: E402
import ftc_common as A  # noqa: E402  (analytics formulas live beside the display helpers)
import ftc_dnc as D  # noqa: E402
import ftc_dnc_pdf as F  # noqa: E402
import ftc_national as N  # noqa: E402
import ftc_parse as P  # noqa: E402
import ftc_refunds as R  # noqa: E402
import ftc_states as S  # noqa: E402
import ftc_supplement as X  # noqa: E402
from ftc_common import NOT_RECORDED, fmt_int, fmt_pct, fmt_rank, fmt_signed_int, fmt_signed_pct, fmt_usd  # noqa: E402

DATABOOK_YEARS = list(range(2017, 2025))
DNC_YEARS = list(range(2021, 2026))
DNC_PDFS = {2021: "dnc_data_book_2021.pdf", 2022: "DNC-Data-Book-2022.pdf", 2023: "Do-Not-Call-Data-Book-2023.pdf", 2024: "DNC-Data-Book-2024.pdf", 2025: "DNC-Data-Book-2025.pdf"}
# independent Tavily readings of Do Not Call ranking tables (private/acq/ftc_sentinel/verify/): cross-check only
DNC_INDEPENDENT_READS = {
    2022: ["read06_tavily_dnc2022_complaints_registrations.txt"],
    2023: ["read08_tavily_dnc2023_complaints_ranking.txt"],
    2024: ["read09_tavily_dnc2024_registrations_ranking.txt", "read11_tavily_dnc2024_complaints_ranking.txt"],
    2025: ["read05_tavily_dnc2025_complaints_ranking.txt", "read10_tavily_dnc2025_registrations_ranking.txt"],
}
REFUND_YEARS = [2022, 2023, 2024]
FIRECRAWL_METHOD = "Firecrawl MCP firecrawl_scrape of the official ftc.gov PDF/page (ftc.gov answers this sandbox with an Akamai bot wall); tool-result JSON stored unchanged"
GOV_TERMS = "Public domain: FTC Website Policy (https://www.ftc.gov/policy-notices/website-policy, Copyright Permission, last updated August 2023) says most material on the FTC website is a work of the United States Government in the public domain and not subject to copyright restrictions (17 U.S.C. 105); attribution requested where feasible (\"Source: United States Federal Trade Commission, www.ftc.gov\"); no FTC endorsement may be implied."


_ROUTABLE = C.routable_places()


def PLACES(usps, name):
    """/places/<USPS> link only for jurisdictions the app resolves (src/lib/corpus/geo.ts: 50 states and DC); none for Puerto Rico."""
    return C.places_links(usps, name, _ROUTABLE)


def record(*args, facts, **kwargs):
    """corpus_writer.record with facts as (label, value) pairs; the entity view reads [label, value] string pairs."""
    if kwargs.get("extra") is not None:
        kwargs["extra"] = json.loads(json.dumps(kwargs["extra"]))  # int keys become strings exactly as storage will return them
    return writer.record(*args, facts=[[label, NOT_RECORDED if value is None else str(value)] for label, value in facts], **kwargs)


def read_capture(manifest, name):
    entry = manifest[name]
    return entry, P.load_capture_markdown(os.path.join(C.ROOT, entry["path"]))


# ====================================================================================================================
# Consumer Sentinel Data Books

def load_databooks(manifest, log):
    books = {}
    for year in DATABOOK_YEARS:
        entry, md = read_capture(manifest, f"csn_databook_{year}_pdf.json")
        states, book, sprobs = S.parse_states(md, year)
        nat, nprobs = N.parse_national_book(md, year)
        if sprobs or nprobs:
            raise SystemExit(f"{year}: Data Book failed validation: {sprobs + nprobs}")
        summary = nat["fraud_summary"]
        sums = book["state_sums"]
        if sums["total_loss_usd"] > summary["total_loss_usd"] or sums["fraud_reports"] > summary["fraud_reports"]:
            raise SystemExit(f"{year}: state sums exceed national totals")
        pdf = C.official_pdf(manifest, entry)
        # these percentages are printed as whole numbers; display with 0 decimals is then exact, never a second rounding
        if not all(float(r["fraud"]["pct_reporting_loss"]).is_integer() for r in states.values() if r["fraud"]) or not float(summary["pct_reporting_loss"]).is_integer():
            raise SystemExit(f"{year}: a printed percentage is not a whole number; display code assumes whole numbers")
        log["databooks"][str(year)] = {
            "url": entry["url"], "capture_sha256": entry["sha256"], "official_pdf_sha256": pdf["sha256"], "chunks": book["chunks"],
            "population_basis_year": book["population_basis_year"],
            "state_sums": sums,
            "national_total_loss_usd": summary["total_loss_usd"],
            "state_loss_share_of_national_pct": A.share_pct(sums["total_loss_usd"], summary["total_loss_usd"]),
            "state_fraud_reports_share_of_national_pct": A.share_pct(sums["fraud_reports"], summary["fraud_reports"]),
            "state_pages_withheld": {u: r["withheld"] for u, r in states.items() if r["withheld"]},
        }
        books[year] = {"entry": entry, "pdf": pdf, "states": states, "book": book, "national": nat}
    return books


def state_kind(usps):
    return "district" if usps == "DC" else "territory" if usps == "PR" else "state"


def build_states(books, log):
    ranks_loss = {}
    for year, b in books.items():
        ordered = sorted((r["fraud"]["total_loss_usd"], u) for u, r in b["states"].items() if r["fraud"])
        ranks_loss[year] = {u: len(ordered) - i for i, (_, u) in enumerate(ordered)}
    rows = []
    for year in sorted(books, reverse=True):
        b = books[year]
        prev = books.get(year - 1)
        first = books[min(books)]
        url = b["entry"]["url"]
        for usps in sorted(P.STATES, key=lambda u: P.STATES[u]):
            name = P.STATES[usps]
            s = b["states"][usps]
            fo, it, fr = s["fraud_other"], s["identity_theft"], s["fraud"]
            ps = prev["states"][usps] if prev else None
            pfo = ps["fraud_other"] if ps else None
            pit = ps["identity_theft"] if ps else None
            pfr = ps["fraud"] if ps else None
            ffr = first["states"][usps]["fraud"]
            span = year - min(books)
            an = {
                "fraud_other_reports_yoy_pct": A.yoy_pct(fo and fo["reports"], pfo and pfo["reports"]),
                "fraud_other_per100k_yoy_pct": A.yoy_pct(fo and fo["per100k"], pfo and pfo["per100k"]),
                "fraud_other_rank_change": A.rank_change(pfo and pfo["rank"], fo and fo["rank"]),
                "identity_theft_reports_yoy_pct": A.yoy_pct(it and it["reports"], pit and pit["reports"]),
                "identity_theft_per100k_yoy_pct": A.yoy_pct(it and it["per100k"], pit and pit["per100k"]),
                "identity_theft_rank_change": A.rank_change(pit and pit["rank"], it and it["rank"]),
                "fraud_reports_yoy_pct": A.yoy_pct(fr and fr["reports"], pfr and pfr["reports"]),
                "total_loss_yoy_pct": A.yoy_pct(fr and fr["total_loss_usd"], pfr and pfr["total_loss_usd"]),
                "median_loss_yoy_pct": A.yoy_pct(fr and fr["median_loss_usd"], pfr and pfr["median_loss_usd"]),
                f"total_loss_cagr_pct_since_{min(books)}": A.cagr_pct(ffr and ffr["total_loss_usd"], fr and fr["total_loss_usd"], span),
                "loss_share_of_state_sum_pct": A.share_pct(fr and fr["total_loss_usd"], b["book"]["state_sums"]["total_loss_usd"]),
                "avg_loss_per_fraud_report_usd": A.ratio(fr and fr["total_loss_usd"], fr and fr["reports"]),
                "total_loss_rank_derived": ranks_loss[year].get(usps) if fr else None,
            }
            caveats = []
            if prev and b["book"]["population_basis_year"] != prev["book"]["population_basis_year"]:
                caveats.append(f"Per-100K figures use {b['book']['population_basis_year']} Census estimates this year and {prev['book']['population_basis_year']} the year before, so per-100K and rank changes mix two population vintages.")
            if usps in P.UNRANKED:
                caveats.append("The FTC lists the District of Columbia and Puerto Rico in the table but does not rank them; rank changes are Not recorded.")
            caveats.append("Report counts exclude reports from state-specific data contributors (FTC footnote) and reports with no state; the FTC revises category definitions between editions (Data Book 'Inside the Numbers'), so year-over-year change compares figures as published in two editions.")
            cats = s["top_categories"]
            thefts = s["id_theft_types"]
            ordinal_note = {"fraud_other_rank_printed_on_state_page": s["checks"].get("page_prints_fraud_other_rank")}
            metrics = {
                "fraud_other_reports": fo and fo["reports"], "fraud_other_per100k": fo and fo["per100k"], "fraud_other_rank": fo and fo["rank"],
                "identity_theft_reports": it and it["reports"], "identity_theft_per100k": it and it["per100k"], "identity_theft_rank": it and it["rank"],
                "fraud_reports": fr and fr["reports"], "pct_reporting_loss": fr and fr["pct_reporting_loss"],
                "total_loss_usd": fr and fr["total_loss_usd"], "median_loss_usd": fr and fr["median_loss_usd"],
            }
            facts = [
                ("State", f"{name} ({usps})"),
                ("Period", f"Calendar year {year} (Consumer Sentinel Network Data Book {year})"),
                ("Fraud and other reports", fmt_int(fo and fo["reports"]) + " reports (FTC 'Fraud and Other Reports', identity theft excluded)"),
                ("Fraud and other reports per 100K population", fmt_int(fo and fo["per100k"]) + f" per 100,000 residents; denominator: FTC's {b['book']['population_basis_year']} U.S. Census population estimates (population not published separately by the FTC)"),
                ("State rank, fraud and other reports (per 100K)", (fmt_rank(fo and fo["rank"]) + " of 50 states") if fo and fo["rank"] else "Not ranked by the FTC (District of Columbia and Puerto Rico are listed but unranked)"),
                ("Identity theft reports", fmt_int(it and it["reports"])),
                ("Identity theft reports per 100K population", fmt_int(it and it["per100k"])),
                ("State rank, identity theft reports (per 100K)", (fmt_rank(it and it["rank"]) + " of 50 states") if it and it["rank"] else "Not ranked by the FTC"),
                ("Fraud reports (Appendix C)", fmt_int(fr and fr["reports"])),
                ("Share of fraud reports with a loss", fmt_pct(fr and fr["pct_reporting_loss"], 0)),
                ("Total reported fraud loss", fmt_usd(fr and fr["total_loss_usd"]) + " (reports with a loss of $1 to $999,999)"),
                ("Median reported fraud loss", fmt_usd(fr and fr["median_loss_usd"])),
                ("Top ten report categories (share of the state's reports)", "; ".join(f"{i}. {c['category']} {c['share_pct']:g}%" for i, c in enumerate(cats, 1)) if cats else NOT_RECORDED),
                ("Top identity theft types (share)", "; ".join(f"{c['type']} {c['share_pct']:g}%" for c in thefts) if thefts else NOT_RECORDED),
                ("Fraud and other reports, change vs prior year", fmt_signed_pct(an["fraud_other_reports_yoy_pct"]) + " (derived: current / prior - 1)"),
                ("Rank change vs prior year, fraud and other (per 100K)", fmt_signed_int(an["fraud_other_rank_change"]) + " places (derived: prior rank - current rank; positive = higher per-capita reporting)"),
                ("Total fraud loss, change vs prior year", fmt_signed_pct(an["total_loss_yoy_pct"]) + " (derived)"),
                ("Source", f"Consumer Sentinel Network Data Book {year}, state ranking tables, Appendix C and the {name} state page (capture chunks {b['book']['chunks']['fraud_other_ranking']}, {b['book']['chunks']['identity_theft_ranking']}, {b['book']['chunks']['appendix_c']}, {s['page_chunk']})"),
                ("Not recorded because", "; ".join(s["withheld"]) if s["withheld"] else "nothing withheld"),
            ]
            cells = {
                "state": name, "year": str(year),
                "fraud_other_reports": fmt_int(fo and fo["reports"]), "fraud_other_per100k": fmt_int(fo and fo["per100k"]),
                "fraud_other_rank": fmt_rank(fo and fo["rank"]) if fo and fo["rank"] else "Unranked",
                "identity_theft_reports": fmt_int(it and it["reports"]), "identity_theft_rank": fmt_rank(it and it["rank"]) if it and it["rank"] else "Unranked",
                "fraud_reports": fmt_int(fr and fr["reports"]), "total_loss": fmt_usd(fr and fr["total_loss_usd"]), "median_loss": fmt_usd(fr and fr["median_loss_usd"]),
            }
            rows.append(record(
                "ftc_sentinel_states", f"{usps}-{year}", f"{name} {year}",
                source_url=url, cells=cells, facts=facts, state=usps,
                subtitle=f"Consumer Sentinel Network Data Book {year} · {fmt_int(fo and fo['reports'])} fraud and other reports",
                text=" ".join(["Consumer Sentinel FTC fraud identity theft reports consumer complaints", name, usps, str(year)] + [c["category"] for c in (cats or [])]),
                filters={"year": [str(year)], "kind": [state_kind(usps)], "ranked": ["yes" if fo and fo["rank"] else "no"]},
                links=[*PLACES(usps, name), {"url": url, "label": f"Consumer Sentinel Network Data Book {year} (FTC PDF)"}],
                extra={
                    "metrics": metrics, "analytics": an, "top_categories": cats, "identity_theft_types": thefts,
                    "population_basis_year": b["book"]["population_basis_year"], "caveats": caveats,
                    "provenance": C.provenance(b["entry"], b["pdf"], chunks={**b["book"]["chunks"], "state_page": s["page_chunk"]}, state_page_identified_by=s["page_identified_by"], checks={**s["checks"], **ordinal_note}, withheld=s["withheld"]),
                },
            ))
    log["counts"]["ftc_sentinel_states"] = len(rows)
    sources = {str(y): C.source_record(b["entry"], b["pdf"], file=os.path.basename(b["entry"]["path"]), name=f"Consumer Sentinel Network Data Book {y}", publisher="Federal Trade Commission", population_basis_year=b["book"]["population_basis_year"]) for y, b in books.items()}
    summary = {
        "label": "FTC Consumer Sentinel reports by state and year",
        "rows": len(rows), "years": DATABOOK_YEARS, "jurisdictions": 52,
        "method": FIRECRAWL_METHOD, "terms": GOV_TERMS,
        "sources": sources,
        "definitions": {
            "fraud_other_reports": "Number of Fraud and Other reports (identity theft excluded) the FTC attributes to the state's consumers in the calendar year, as printed in 'State Rankings: Fraud and Other Reports'.",
            "per100k": "Reports per 100,000 residents exactly as printed; the FTC's denominator is its stated Census population estimate (year in population_basis_year); the population itself is not published by the FTC and is not reconstructed here.",
            "rank": "The FTC's state rank by reports per 100K (1 = most reports per capita). District of Columbia and Puerto Rico are listed but not ranked.",
            "fraud_loss": "Appendix C: fraud reports, share reporting a loss, total and median loss for reports with a loss between $1 and $999,999.",
        },
        "formulas": {
            "yoy_pct": "(value in year t / value in year t-1 - 1) * 100, using the two editions' printed values",
            "rank_change": "rank in year t-1 minus rank in year t (positive = moved toward rank 1); Not recorded for unranked entries or a missing year",
            "cagr_pct": "((value in year t / value in 2017) ** (1 / (t - 2017)) - 1) * 100",
            "loss_share_of_state_sum_pct": "state total loss / sum of the 52 jurisdictions' total losses in the same edition * 100",
            "avg_loss_per_fraud_report_usd": "total loss / fraud reports (all fraud reports, including those with no loss)",
            "total_loss_rank_derived": "rank of total fraud loss among the 52 jurisdictions in the edition (1 = largest); derived, not published by the FTC",
        },
        "validation": "Every ranking table is checked for 52 jurisdictions, ranks 1-50 contiguous, per-100K non-increasing by rank; Appendix C for 52 jurisdictions and fraud reports <= fraud and other reports; each state page is identified by its own footnote and kept only when it prints the ranking-table report total; top-ten tables need exactly ten known categories in descending order with shares <= 100.",
        "caveats": [
            "Figures are as printed in each edition. The FTC says (Data Book 'Inside the Numbers'): 'Some data contributors transfer their complaints to Sentinel after the end of the calendar year, and new data providers often contribute reports from prior years ... totals from previous years may differ from prior Consumer Sentinel Network Data Books.' National counts for earlier years do differ in later editions (see ftc_sentinel_national revision_vs_latest_edition).",
            "FTC-documented category changes in 2020, 2023 and 2024 (see ftc_sentinel_national definition notices) can move reports between categories; top-category comparisons across those editions are not like-for-like.",
            "State totals exclude reports from state-specific data contributors and reports without a state; they add to 62%-78% of the national fraud loss in each edition.",
            "Top-category tables withheld where the PDF text extraction damaged a category name (listed in provenance.withheld).",
        ],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return rows, summary


STATE_COLUMNS = [("state", "State"), ("year", "Year"), ("fraud_other_reports", "Fraud and other reports"), ("fraud_other_per100k", "Per 100K"), ("fraud_other_rank", "Rank"), ("identity_theft_reports", "Identity theft reports"), ("total_loss", "Total fraud loss"), ("median_loss", "Median loss")]


def states_listing():
    return writer.listing(STATE_COLUMNS, [
        ("year", "Year", {str(y): str(y) for y in sorted(DATABOOK_YEARS, reverse=True)}),
        ("kind", "Jurisdiction", {"state": "State", "district": "District of Columbia", "territory": "Territory"}),
        ("ranked", "Ranked by the FTC", {"yes": "Ranked", "no": "Unranked"}),
    ])


# ====================================================================================================================
# National records

# Editions in which the FTC itself says categories (or how reports are sorted) changed. A comparison across one of these
# years can reflect the FTC's re-sorting of reports rather than a change in consumer experience, so it carries the notice.
DEFINITION_NOTICES = {
    2020: "ReportFraud.ftc.gov launched in 2020; a Privacy, Data Security, and Cyber Threats category was created and Internet Auctions retired on October 22, 2020 (Data Book 2020-2022 'Inside the Numbers').",
    2023: "In 2023 some categories were renamed, retired or consolidated; subcategory merges from May 2023 (Data Book 2023 'Inside the Numbers', Appendix B3).",
    2024: "In 2024 some categories were renamed, retired or consolidated (Data Book 2024 'Inside the Numbers', Appendix B3).",
}


def notices_between(older_year, newer_year):
    """FTC-documented definition changes in the editions after older_year up to and including newer_year."""
    return [f"{y}: {text}" for y, text in sorted(DEFINITION_NOTICES.items()) if older_year < y <= newer_year]


def comparable_changes(older, newer, key, value_key, extra_keys=()):
    """Rows present under the same printed name in both lists, with the change in value_key. Others are not compared."""
    old = {r[key]: r for r in older or []}
    out, skipped = [], []
    for r in newer or []:
        if r[key] in old:
            row = {"name": r[key], "from": old[r[key]][value_key], "to": r[value_key], "change_pct": A.yoy_pct(r[value_key], old[r[key]][value_key]), "change_abs": None if r[value_key] is None or old[r[key]][value_key] is None else r[value_key] - old[r[key]][value_key]}
            for k in extra_keys:
                row[k] = r.get(k)
            out.append(row)
        else:
            skipped.append(r[key])
    out.sort(key=lambda x: (x["change_pct"] is None, -(x["change_pct"] or 0)))
    return out, skipped


def build_national(books, log):
    rows = []
    last = max(books)
    hist_last = books[last]["national"]
    series_type = hist_last["reports_by_type_by_year"]
    series_total = hist_last["reports_by_year"]
    for year in sorted(books, reverse=True):
        b = books[year]
        n = b["national"]
        fs = n["fraud_summary"]
        types = n["report_types"]
        prev = books.get(year - 1)
        pn = prev["national"] if prev else None
        pfs = pn["fraud_summary"] if pn else None
        own = {"total": n["reports_by_year"][year], **n["reports_by_type_by_year"][year]}
        later = {"total": series_total.get(year), **(series_type.get(year) or {})}
        revision = {k: {"as_published_that_year": own.get(k), f"as_shown_in_{last}_edition": later.get(k), "difference": None if later.get(k) is None else later[k] - own[k]} for k in ("total", "fraud", "identity_theft", "other")}
        top_changes, top_skipped = comparable_changes(pn and pn["top_fraud_categories"], n["top_fraud_categories"], "category", "total_loss_usd", ("reports", "median_loss_usd"))
        pay_changes, _ = comparable_changes(pn and pn["payment_methods"], n["payment_methods"], "method", "total_loss_usd", ("reports",))
        contact_changes, _ = comparable_changes(pn and pn["contact_methods"], n["contact_methods"], "method", "total_loss_usd", ("reports", "median_loss_usd"))
        same_edition_prev = n["reports_by_type_by_year"].get(year - 1)
        an = {
            # report counts: both years from THIS edition's history table (one vintage)
            "total_reports_yoy_pct": A.yoy_pct(own["total"], n["reports_by_year"].get(year - 1)),
            "fraud_reports_yoy_pct": A.yoy_pct(own["fraud"], same_edition_prev and same_edition_prev["fraud"]),
            "identity_theft_reports_yoy_pct": A.yoy_pct(own["identity_theft"], same_edition_prev and same_edition_prev["identity_theft"]),
            "other_reports_yoy_pct": A.yoy_pct(own["other"], same_edition_prev and same_edition_prev["other"]),
            # losses exist only for the edition's own year: each year's printed total from its own edition (cross-edition)
            "total_loss_yoy_pct_cross_edition": A.yoy_pct(fs["total_loss_usd"], pfs and pfs["total_loss_usd"]),
            "median_loss_yoy_pct_cross_edition": A.yoy_pct(fs["median_loss_usd"], pfs and pfs["median_loss_usd"]),
            "pct_reporting_loss_change_points": None if not pfs else fs["pct_reporting_loss"] - pfs["pct_reporting_loss"],
            "avg_loss_per_loss_report_usd": A.ratio(fs["total_loss_usd"], fs["reports_with_loss"]),
            "fraud_share_of_reports_pct": A.share_pct(own["fraud"], own["total"]),
            "top_fraud_category_loss_changes": top_changes, "top_fraud_categories_not_comparable": top_skipped,
            "payment_method_loss_changes": pay_changes, "contact_method_loss_changes": contact_changes,
            "definition_notices_vs_prior_edition": notices_between(year - 1, year),
        }
        facts = [
            ("Scope", "United States, all Consumer Sentinel reports received in the calendar year"),
            ("Period", f"Calendar year {year} (Consumer Sentinel Network Data Book {year})"),
            ("Total reports", fmt_int(own["total"]) + " (fraud, identity theft and other reports; Do Not Call Registry complaints excluded)"),
            ("Fraud reports", fmt_int(own["fraud"])),
            ("Identity theft reports", fmt_int(own["identity_theft"])),
            ("Other reports", fmt_int(own["other"]) + " (some subcategories count as both fraud and other, so the three types can add to slightly more than the total)"),
            ("Fraud reports with a dollar loss", f"{fmt_int(fs['reports_with_loss'])} ({fs['pct_reporting_loss']}%)"),
            ("Total reported fraud loss", fmt_usd(fs["total_loss_usd"]) + " (losses of $1 to $999,999)"),
            ("Median reported fraud loss", fmt_usd(fs["median_loss_usd"])),
            ("Top fraud category by reports", f"{n['top_fraud_categories'][0]['category']}: {fmt_int(n['top_fraud_categories'][0]['reports'])} reports, {fmt_usd(n['top_fraud_categories'][0]['total_loss_usd'])} lost"),
            ("Top report category", f"{n['report_categories'][0]['category']}: {fmt_int(n['report_categories'][0]['reports'])} reports ({n['report_categories'][0]['share_pct']:g}%)"),
            ("Fraud loss, change vs prior year", fmt_signed_pct(an["total_loss_yoy_pct_cross_edition"]) + " (derived from the two editions' printed totals; each edition's loss figure is for its own year only)"),
            ("Total reports, change vs prior year", fmt_signed_pct(an["total_reports_yoy_pct"]) + " (derived; both years from this edition's history table)"),
            ("Later revision of this year's counts", f"{last} edition shows {fmt_int(later['total'])} total reports vs {fmt_int(own['total'])} printed here" if year != last else "latest edition"),
            ("Source", f"Consumer Sentinel Network Data Book {year}: Number of Reports by Year, Report Categories, Report Types, Fraud Reports by Amount Lost, Payment Method, Contact Method and Age tables"),
        ]
        cells = {
            "year": str(year), "total_reports": fmt_int(own["total"]), "fraud_reports": fmt_int(own["fraud"]),
            "identity_theft_reports": fmt_int(own["identity_theft"]), "other_reports": fmt_int(own["other"]),
            "total_loss": fmt_usd(fs["total_loss_usd"]), "median_loss": fmt_usd(fs["median_loss_usd"]),
            "pct_reporting_loss": fmt_pct(fs["pct_reporting_loss"], 0),
        }
        rows.append(record(
            "ftc_sentinel_national", f"US-{year}", f"United States {year}",
            source_url=b["entry"]["url"], cells=cells, facts=facts, state="",
            subtitle=f"Consumer Sentinel Network Data Book {year} · {fmt_usd(fs['total_loss_usd'])} reported fraud losses",
            text=" ".join(["Consumer Sentinel FTC national fraud identity theft losses reports", str(year)] + [c["category"] for c in n["report_categories"]]),
            filters={"year": [str(year)], "kind": ["year"]},
            links=[{"url": b["entry"]["url"], "label": f"Consumer Sentinel Network Data Book {year} (FTC PDF)"}],
            extra={
                "reports": own, "fraud_summary": fs, "report_types": types, "report_categories": n["report_categories"],
                "top_fraud_categories": n["top_fraud_categories"], "identity_theft_types": n["identity_theft_types"],
                "top_other_categories": n["top_other_categories"], "loss_ranges": n["loss_ranges"], "payment_methods": n["payment_methods"],
                "contact_methods": n["contact_methods"], "contact_method_shares": n["contact_method_shares"], "age_groups": n["age_groups"],
                "identity_theft_subtypes": n["identity_theft_subtypes"], "military": n["military"],
                "analytics": an, "revision_vs_latest_edition": revision,
                "provenance": C.provenance(b["entry"], b["pdf"]),
            },
        ))
    # --- series row: 2001-latest counts by type (latest edition's revised history) and 2017-latest loss series
    loss_series = {y: {"fraud_reports": books[y]["national"]["fraud_summary"]["fraud_reports"], "total_loss_usd": books[y]["national"]["fraud_summary"]["total_loss_usd"], "median_loss_usd": books[y]["national"]["fraud_summary"]["median_loss_usd"], "pct_reporting_loss": books[y]["national"]["fraud_summary"]["pct_reporting_loss"], "reports_with_loss": books[y]["national"]["fraud_summary"]["reports_with_loss"]} for y in sorted(books)}
    years = sorted(series_total)
    counts_yoy = {y: A.yoy_pct(series_total[y], series_total.get(y - 1)) for y in years if series_total.get(y - 1)}
    type_yoy = {t: {y: A.yoy_pct(series_type[y][t], (series_type.get(y - 1) or {}).get(t)) for y in years if series_type.get(y - 1)} for t in ("fraud", "identity_theft", "other")}
    first_loss, last_loss = loss_series[min(loss_series)], loss_series[max(loss_series)]
    loss_yoy = {y: A.yoy_pct(loss_series[y]["total_loss_usd"], loss_series.get(y - 1, {}).get("total_loss_usd")) for y in loss_series if y - 1 in loss_series}
    windows = {}
    for label, a_year in (("1_year", last - 1), ("3_years", last - 3), ("5_years", last - 5)):
        if a_year in books:
            ch, skipped = comparable_changes(books[a_year]["national"]["top_fraud_categories"], books[last]["national"]["top_fraud_categories"], "category", "total_loss_usd", ("reports",))
            windows[f"{a_year}_to_{last}"] = {"rising": [c for c in ch if c["change_pct"] is not None], "not_comparable_not_in_older_top_10": skipped, "definition_notices": notices_between(a_year, last)}
    pay_windows, contact_windows = {}, {}
    for a_year in (last - 1, last - 3):
        if a_year in books:
            ch, _ = comparable_changes(books[a_year]["national"]["payment_methods"], books[last]["national"]["payment_methods"], "method", "total_loss_usd", ("reports",))
            pay_windows[f"{a_year}_to_{last}"] = {"changes": ch, "definition_notices": notices_between(a_year, last)}
            ch, _ = comparable_changes(books[a_year]["national"]["contact_methods"], books[last]["national"]["contact_methods"], "method", "total_loss_usd", ("reports",))
            contact_windows[f"{a_year}_to_{last}"] = {"changes": ch, "definition_notices": notices_between(a_year, last)}
    peak_year = max(series_total, key=lambda y: series_total[y])
    series_an = {
        "total_reports_yoy_pct": counts_yoy, "reports_by_type_yoy_pct": type_yoy, "fraud_loss_yoy_pct": loss_yoy,
        f"total_reports_cagr_pct_{years[0]}_to_{years[-1]}": A.cagr_pct(series_total[years[0]], series_total[years[-1]], years[-1] - years[0]),
        f"total_reports_cagr_pct_2019_to_{last}": A.cagr_pct(series_total.get(2019), series_total.get(last), last - 2019),
        f"fraud_loss_cagr_pct_{min(loss_series)}_to_{max(loss_series)}": A.cagr_pct(first_loss["total_loss_usd"], last_loss["total_loss_usd"], max(loss_series) - min(loss_series)),
        f"median_loss_change_{min(loss_series)}_to_{max(loss_series)}_pct": A.yoy_pct(last_loss["median_loss_usd"], first_loss["median_loss_usd"]),
        "peak_year_total_reports": peak_year,
        "fastest_rising_fraud_category_loss": windows,
        "payment_method_loss_changes": pay_windows, "contact_method_loss_changes": contact_windows,
    }
    facts = [
        ("Scope", f"United States, 2001-{last} series of Consumer Sentinel reports and 2017-{last} fraud loss series"),
        ("Report counts 2001-" + str(last), f"{fmt_int(series_total[years[0]])} in {years[0]} to {fmt_int(series_total[last])} in {last} (history table of the {last} edition)"),
        (f"Total reports CAGR 2019-{last}", fmt_signed_pct(series_an[f"total_reports_cagr_pct_2019_to_{last}"]) + " per year (derived)"),
        (f"Reported fraud loss {min(loss_series)} to {max(loss_series)}", f"{fmt_usd(first_loss['total_loss_usd'])} to {fmt_usd(last_loss['total_loss_usd'])}, CAGR {fmt_signed_pct(series_an[f'fraud_loss_cagr_pct_{min(loss_series)}_to_{max(loss_series)}'])} per year (derived, each year from its own edition)"),
        ("Fastest-rising fraud categories by loss", "; ".join(f"{c['name']} {fmt_signed_pct(c['change_pct'])}" for c in (windows.get(f"{last - 3}_to_{last}", {}).get("rising", [])[:3])) + f" ({last - 3} to {last}; categories in the top ten of both editions under the same printed name)"),
        ("Source", f"Consumer Sentinel Network Data Book editions {min(books)}-{last}"),
    ]
    rows.append(record(
        "ftc_sentinel_national", "US-series", f"United States {years[0]}-{last} series",
        source_url=books[last]["entry"]["url"], cells={"year": f"{years[0]}-{last}", "total_reports": fmt_int(series_total[last]), "fraud_reports": fmt_int(series_type[last]["fraud"]), "identity_theft_reports": fmt_int(series_type[last]["identity_theft"]), "other_reports": fmt_int(series_type[last]["other"]), "total_loss": fmt_usd(last_loss["total_loss_usd"]), "median_loss": fmt_usd(last_loss["median_loss_usd"]), "pct_reporting_loss": fmt_pct(last_loss["pct_reporting_loss"], 0)},
        facts=facts, state="", subtitle=f"Reports by type {years[0]}-{last} and fraud losses {min(loss_series)}-{last}",
        text="Consumer Sentinel FTC national series fraud identity theft reports growth rate fastest rising loss categories",
        filters={"year": ["series"], "kind": ["series"]},
        links=[{"url": books[last]["entry"]["url"], "label": f"Consumer Sentinel Network Data Book {last} (FTC PDF)"}],
        extra={"reports_by_year": {str(y): v for y, v in series_total.items()}, "reports_by_type_by_year": {str(y): v for y, v in series_type.items()}, "fraud_loss_by_year": {str(y): v for y, v in loss_series.items()}, "analytics": series_an, "series_vintage": f"counts: {last} edition history table (revised); losses: each year's own edition"},
    ))
    log["counts"]["ftc_sentinel_national"] = len(rows)
    revisions = {}
    for year in sorted(books):
        own = {"total": books[year]["national"]["reports_by_year"][year], **books[year]["national"]["reports_by_type_by_year"][year]}
        later = {"total": series_total.get(year), **(series_type.get(year) or {})}
        revisions[str(year)] = {k: (own[k], later.get(k)) for k in own}
    log["national_revisions_as_printed_vs_latest_edition"] = revisions
    sources = {str(y): C.source_record(b["entry"], b["pdf"], name=f"Consumer Sentinel Network Data Book {y}", publisher="Federal Trade Commission") for y, b in books.items()}
    summary = {
        "label": "FTC Consumer Sentinel national statistics by year",
        "rows": len(rows), "years": DATABOOK_YEARS, "method": FIRECRAWL_METHOD, "terms": GOV_TERMS, "sources": sources,
        "formulas": {
            "yoy_pct": "(value in year t / value in year t-1 - 1) * 100",
            "cagr_pct": "((last / first) ** (1 / years) - 1) * 100",
            "fastest_rising_fraud_category_loss": "Among the ten fraud categories ranked by the FTC in both editions under exactly the same printed name: (total $ loss in the later edition / total $ loss in the earlier edition - 1) * 100, sorted descending. Categories in only one top ten are listed as not comparable.",
            "payment_method_loss_changes": "Same rule over payment methods named identically in both editions",
            "avg_loss_per_loss_report_usd": "total fraud loss / fraud reports with a loss",
            "fraud_share_of_reports_pct": "fraud reports / total reports * 100",
        },
        "caveats": [
            "Each edition revises earlier years (the revision_vs_latest_edition block shows the size; the FTC: 'totals from previous years may differ from prior Consumer Sentinel Network Data Books'). Report-count growth uses one edition's history table (one vintage); loss growth compares each edition's own printed total for its own year.",
            "The FTC renames, retires and consolidates categories between editions (2020, 2023, 2024; Data Book 'Inside the Numbers' and Appendix B3). Only identically named categories are compared and every comparison lists the FTC-documented definition notices for the window (definition_notices); a large jump in a small category across such a year can be the FTC's re-sorting, not consumer experience.",
            "Contact and payment method names changed between editions (for example 'Phone' became 'Phone call'); only identical names are compared.",
            "Losses are reports with a loss of $1 to $999,999; the Data Book is based on unverified consumer reports, not a survey.",
        ],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return rows, summary


NATIONAL_COLUMNS = [("year", "Year"), ("total_reports", "Total reports"), ("fraud_reports", "Fraud"), ("identity_theft_reports", "Identity theft"), ("other_reports", "Other"), ("total_loss", "Reported fraud loss"), ("median_loss", "Median loss")]


def national_listing():
    return writer.listing(NATIONAL_COLUMNS, [("year", "Year", {**{str(y): str(y) for y in sorted(DATABOOK_YEARS, reverse=True)}, "series": "Series"})])


# ====================================================================================================================
# Refunds

STAGE_ORDER = ["first_distribution", "additional_distribution", "closed"]
FIELD_LABELS = {
    "sent_usd": "Dollars sent", "eligible_consumers": "Eligible consumers", "consumers_cashed": "Consumers who cashed a payment", "pct_cashed": "Percent who cashed a payment",
    "sent_recent_usd": "Dollars sent in most recent distribution", "returned_previous_usd": "Dollars returned in previous distributions",
    "consumers_in_recent_distribution": "Consumers/payments in most recent distribution", "total_fund_usd": "Total fund", "returned_usd": "Dollars returned to consumers",
    "admin_usd": "Administrative costs", "left_over_usd": "Left over funds", "education_campaigns_usd": "Spent on consumer education campaigns",
    "consumers_sent_payment": "Consumers sent a payment", "date_sent": "Date sent", "date_recent": "Date of most recent distribution", "date_closed": "Closing date",
}
MONEY_FIELDS = {"sent_usd", "sent_recent_usd", "returned_previous_usd", "total_fund_usd", "returned_usd", "admin_usd", "left_over_usd", "education_campaigns_usd"}
COUNT_FIELDS = {"eligible_consumers", "consumers_cashed", "consumers_in_recent_distribution", "consumers_sent_payment"}


def refund_display(field, value):
    if isinstance(value, dict):
        return value["published"]
    if field in MONEY_FIELDS:
        return fmt_usd(value)
    if field == "pct_cashed":
        return C.fmt_pct_exact(value)
    return fmt_int(value)


def headline(kind, case):
    """(amount_label, amount, consumers_label, consumers) for the common listing columns."""
    if kind == "first_distribution":
        return "Dollars sent", case["sent_usd"], "Eligible consumers", case["eligible_consumers"]
    if kind == "additional_distribution":
        return "Dollars sent in most recent distribution", case["sent_recent_usd"], "Consumers/payments in most recent distribution", case["consumers_in_recent_distribution"]
    return "Dollars returned to consumers", case["returned_usd"], "Consumers sent a payment" if "consumers_sent_payment" in case else "Eligible consumers", case.get("consumers_sent_payment", case.get("eligible_consumers"))


def load_company_lookup():
    path = os.path.join(C.BUILD, "lookups", "company_sec_profiles.json")
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return {cik: title for cik, title in data["rows"]}, data


def build_refunds(manifest, log):
    reports = {}
    for year in REFUND_YEARS:
        entry, md = read_capture(manifest, {2022: "ftc_refunds_report_2022_pdf.json", 2023: "ftc_refunds_report_2023_pdf.json", 2024: "ftc_refunds_report_2024_pdf.json"}[year])
        cases, cprobs = R.parse_report_cases(md, year)
        snap, sprobs = R.parse_snapshot(md, year)
        states, extras, stprobs = R.parse_state_mailed(md, year)
        if cprobs or sprobs:
            raise SystemExit(f"{year} refunds report failed: {cprobs + sprobs}")
        corrections = R.apply_name_corrections(year, cases)
        flat = R.official_pdf_flat_text(os.path.join(C.ROOT, C.official_pdf(manifest, entry)["path"]))
        missing_names = R.names_missing_from_pdf(cases, flat)
        if missing_names:
            raise SystemExit(f"{year}: case names not found in the official PDF text: {missing_names}")
        log.setdefault("refund_name_checks", {})[str(year)] = {"checked_against_official_pdf": flat is not None, "corrections": [list(c) for c in corrections]}
        reports[year] = {"entry": entry, "pdf": C.official_pdf(manifest, entry), "cases": cases, "snapshot": snap, "states": states, "extras": extras, "state_problems": stprobs}
    data_entry, data_md = read_capture(manifest, "ftc_refunds_data_page.json")
    idx_entry, idx_md = read_capture(manifest, "ftc_refund_programs_index.json")
    data_snapshot = R.parse_data_page_snapshot(data_md)
    programs, pprobs = R.parse_refund_programs(idx_md)
    if pprobs or data_snapshot is None:
        raise SystemExit(f"refund pages failed: {pprobs} {data_snapshot}")
    program_ids = {p["url"].rsplit("/", 1)[-1]: p for p in programs}
    program_keys = {slug_id: R.program_match_key(p["title"]) for slug_id, p in program_ids.items()}
    companies, company_src = load_company_lookup()

    # exact-name matching of case names (documented normalisation: C.name_key; program titles lose one trailing Refunds/Settlement)
    case_names = {}
    for year, rep in reports.items():
        for kind, entry in rep["cases"].items():
            for c in entry["cases"]:
                case_names[(year, kind, c["case"])] = c["case"]
    unique_names = {n: n for n in sorted(set(case_names.values()))}  # sorted: the build log must not depend on set iteration order
    prog_targets = {sid: p["title"] for sid, p in program_ids.items()}
    # build target list by program key so the trailing word is dropped on the program side only
    key_targets = {sid: key for sid, key in program_keys.items()}
    by_key = {}
    for sid, key in key_targets.items():
        by_key.setdefault(key, []).append(sid)
    program_match, program_ambiguous, program_unmatched = {}, {}, []
    for n in unique_names:
        hits = by_key.get(R.case_key(n), [])
        if len(hits) == 1:
            program_match[n] = hits[0]
        elif len(hits) > 1:
            program_ambiguous[n] = sorted(hits)
        else:
            program_unmatched.append(n)
    company_match, company_ambiguous, company_unmatched = C.unique_exact_matches(unique_names, companies)
    # near misses: the case name equals a program key only after dropping a corporate-form word (LLC, Inc., Corp.). Not linked:
    # the documented rule is exact equality of the normalised names, and a corporate-form word is part of the published name.
    corp_word = re.compile(r"\b(llc|inc|incorporated|corp|corporation|co|company|ltd)\b\.?", re.I)
    near_misses = []
    for n in program_unmatched:
        stripped = R.case_key(corp_word.sub(" ", n))
        hits = by_key.get(stripped, [])
        if stripped != R.case_key(n) and len(hits) == 1:
            near_misses.append({"case_name": n, "program_title": program_ids[hits[0]]["title"], "program_url": program_ids[hits[0]]["url"], "differs_by": "corporate-form word only; left unlinked"})

    rows = []
    used = set()

    def rid(base):
        n, out = 1, base
        while out in used:
            n += 1
            out = f"{base}-{n}"
        used.add(out)
        return out

    stage_label = {"first_distribution": "First distribution", "additional_distribution": "Additional distribution", "closed": "Case closed"}
    case_ids = {}
    for year in sorted(reports, reverse=True):
        rep = reports[year]
        for kind in STAGE_ORDER:
            entry = rep["cases"][kind]
            for c in entry["cases"]:
                name = c["case"]
                record_id = rid(f"{year}-{kind}-{C.slug(name)}")
                case_ids.setdefault(name, []).append(record_id)
                amount_label, amount, consumers_label, consumers = headline(kind, c)
                links = [{"url": rep["entry"]["url"], "label": f"{year} FTC Annual Report on Refunds to Consumers (PDF)"}]
                if name in program_match:
                    p = program_ids[program_match[name]]
                    links.insert(0, {"url": p["url"], "label": f"FTC refund program page: {p['title']}"})
                if name in company_match:
                    links.insert(0, {"url": f"/companies/{company_match[name]}", "label": f"Company profile: {companies[company_match[name]]}"})
                fields = [(f, v) for f, v in c.items() if f not in ("case", "notes", "chunk", "name_corrected_from") and not f.endswith("_printed")]
                facts = [("Case name (as published)", name), ("Report", f"{year} FTC Annual Report on Refunds to Consumers, 'Cases {'with First Distributions' if kind == 'first_distribution' else 'with Additional Distributions' if kind == 'additional_distribution' else 'Closed'} in {year}'"), ("Stage", stage_label[kind])]
                facts += [(FIELD_LABELS[f], c.get(f + "_printed") if f + "_printed" in c else refund_display(f, v)) for f, v in fields]
                if c["notes"]:
                    facts.append(("Note on the published cell", "; ".join(c["notes"]) + " in the report"))
                if c.get("name_corrected_from"):
                    facts.append(("Note on the case name", f"The official PDF prints '{name}'; the Firecrawl text extraction had read it as '{c['name_corrected_from']}'. Checked on the rendered PDF page."))
                if entry["total_differences"]:
                    facts.append(("Note on the published table", "The report's printed Totals row differs from the sum of its case rows in: " + "; ".join(f"{d['column']} (rows {d['rows_sum']:,}, printed {d['printed_total']:,})" for d in entry["total_differences"] if d.get("column"))))
                facts.append(("Linked FTC program page", program_ids[program_match[name]]["url"] if name in program_match else "None: no refund program page title equals this case name exactly"))
                facts.append(("Linked company profile", companies[company_match[name]] if name in company_match else "None: no exact unique match to a company_sec_profiles title"))
                cells = {"case": name, "report_year": str(year), "stage": stage_label[kind], "amount": fmt_usd(amount), "amount_label": amount_label, "consumers": fmt_int(consumers), "consumers_label": consumers_label, "pct_cashed": c.get("pct_cashed_printed") or C.fmt_pct_exact(c.get("pct_cashed"))}
                date_field = next((f for f in ("date_sent", "date_recent", "date_closed") if f in c), None)
                cells["date"] = c[date_field]["published"] if date_field else NOT_RECORDED
                rows.append(record(
                    "ftc_refunds", record_id, name, source_url=rep["entry"]["url"], cells=cells, facts=facts, state="",
                    subtitle=f"{stage_label[kind]} · {year} report", text=" ".join(["FTC refunds consumers redress", name, stage_label[kind], str(year)]),
                    filters={"report_year": [str(year)], "kind": ["case"], "stage": [kind]}, links=links,
                    extra={"values": {f: (v["iso"] if isinstance(v, dict) else v) for f, v in fields}, "published_dates": {f: v["published"] for f, v in fields if isinstance(v, dict)}, "case_key": R.case_key(name), "name_corrected_from": c.get("name_corrected_from"), "provenance": C.provenance(rep["entry"], rep["pdf"], chunk=c["chunk"], table_total_differences=entry["total_differences"])},
                ))
    # state rows
    state_rows = 0
    for year in sorted(reports, reverse=True):
        rep = reports[year]
        total_states = sum(rep["states"].values())
        for usps in sorted(rep["states"], key=lambda u: P.STATES[u]):
            amount = rep["states"][usps]
            name = P.STATES[usps]
            facts = [("State", f"{name} ({usps})"), ("Period", f"Calendar year {year}"), ("Refund dollars mailed to the state", fmt_usd(amount) + f" ('$$ Mailed in {year}')"), ("Share of dollars mailed to the 52 listed states and territories", fmt_pct(A.share_pct(amount, total_states), 2) + " (derived: state / sum of listed states)"), ("Source", f"{year} FTC Annual Report on Refunds to Consumers, 'FTC Refunds Mailed to States in {year}'")]
            rows.append(record(
                "ftc_refunds", f"{year}-state-{usps}", f"{name} refunds mailed {year}", source_url=rep["entry"]["url"],
                cells={"case": f"{name} (state total)", "report_year": str(year), "stage": "Mailed to state", "amount": fmt_usd(amount), "amount_label": f"$$ Mailed in {year}", "consumers": NOT_RECORDED, "consumers_label": "Not published by state", "pct_cashed": NOT_RECORDED, "date": f"Calendar year {year}"},
                facts=facts, state=usps, subtitle=f"FTC refunds mailed to {name} in {year}", text=" ".join(["FTC refunds mailed state", name, usps, str(year)]),
                filters={"report_year": [str(year)], "kind": ["state"], "stage": ["state_mailed"]},
                links=[*PLACES(usps, name), {"url": rep["entry"]["url"], "label": f"{year} FTC Annual Report on Refunds to Consumers (PDF)"}],
                extra={"values": {"mailed_usd": amount}, "analytics": {"share_of_listed_states_pct": A.share_pct(amount, total_states), "yoy_pct": A.yoy_pct(amount, reports.get(year - 1, {}).get("states", {}).get(usps))}, "provenance": C.provenance(rep["entry"], rep["pdf"])},
            ))
            state_rows += 1
    # annual summary rows (share of funds 2018-2024 from the latest report showing the year)
    snapshots = {}
    for year in sorted(reports):
        for y, v in reports[year]["snapshot"].items():
            snapshots.setdefault(y, {})[year] = v
    summary_years = sorted(snapshots, reverse=True)
    for y in summary_years:
        latest_report = max(snapshots[y])
        v = snapshots[y][latest_report]
        others = {str(r): snapshots[y][r] for r in snapshots[y] if r != latest_report}
        nums = lambda d: (d["returned_pct"], d["treasury_pct"], d["admin_pct"])  # noqa: E731  (printed spelling may differ, e.g. 93 vs 93.0)
        differs = [r for r in snapshots[y] if r != latest_report and nums(snapshots[y][r]) != nums(v)]
        rep = reports[latest_report]
        facts = [("Period", f"Calendar year {y}"), ("Returned to consumers (share of funds)", v["printed"][0] + "%"), ("Sent to U.S. Treasury (share of funds)", v["printed"][1] + "%"), ("Administrative costs (share of funds)", v["printed"][2] + "%"), ("Shown in report(s)", ", ".join(str(r) for r in sorted(snapshots[y]))), ("Reports that disagree on this year", ", ".join(str(r) for r in differs) if differs else "none")]
        extras_ = {"values": {"returned_pct": v["returned_pct"], "treasury_pct": v["treasury_pct"], "admin_pct": v["admin_pct"]}, "also_shown_in": others, "provenance": C.provenance(rep["entry"], rep["pdf"], shown_in_report=latest_report)}
        source = rep["entry"]["url"]
        links = [{"url": rep["entry"]["url"], "label": f"{latest_report} FTC Annual Report on Refunds to Consumers (PDF)"}]
        if y in reports:
            ex = reports[y]["extras"]
            st_total = sum(reports[y]["states"].values())
            facts += [("Dollars mailed to the listed states and territories", fmt_usd(st_total) + " (derived: sum of the state table)")]
            for key, label in (("military_bases_usd", "Mailed to military bases"), ("virgin_islands_usd", "Mailed to the U.S. Virgin Islands (a row in this year's table only)"), ("international_usd", "International payments"), ("electronic_no_geography_usd", "Electronic payments (no geographic data)"), ("electronic_and_international_usd", "Electronic and international payments"), ("total_sent_usd", "Total sent (as printed)")):
                if key in ex:
                    facts.append((label, fmt_usd(ex[key])))
            if "parts_sum_usd" in ex:
                gap = ex["total_sent_usd"] - ex["parts_sum_usd"]
                facts.append(("Sum of the listed parts (derived)", fmt_usd(ex["parts_sum_usd"]) + " (states + military bases + Virgin Islands where listed + electronic and international payments)"))
                facts.append(("Printed total against the listed parts", "equal" if gap == 0 else f"the report's printed Total Sent differs from the sum of its listed parts by {fmt_usd(abs(gap))} ({'printed total higher' if gap > 0 else 'printed total lower'}); both are shown as printed"))
            extras_["values"].update({"states_sum_usd": st_total, **{k: ex[k] for k in ex}})
            counts = {k: len(reports[y]["cases"][k]["cases"]) for k in STAGE_ORDER}
            tot_text = {k: reports[y]["cases"][k]["totals_printed"] for k in STAGE_ORDER}
            facts.append(("Case rows published in the report's tables", f"{counts['first_distribution']} first distributions, {counts['additional_distribution']} additional distributions, {counts['closed']} closed cases"))
            extras_["values"]["case_rows"] = counts
            extras_["totals_printed"] = tot_text
            if y == 2024:
                facts.append(("All FTC cases incl. refunds run by defendants and other agencies (data page graphic)", f"${data_snapshot['total_returned_usd_m']} million returned to consumers; ${data_snapshot['returned_directly_by_ftc_usd_m']} million directly by the FTC to {data_snapshot['people_millions']} million people; ${data_snapshot['treasury_usd_m']} million to the U.S. Treasury; ${data_snapshot['admin_usd_m']} million administrative costs"))
                extras_["data_page_snapshot"] = data_snapshot
                links.append({"url": data_entry["url"], "label": "FTC Data on Refunds to Consumers (snapshot graphic)"})
        else:
            facts.append(("Per-case and per-state tables", "Not recorded: the case and state tables exist only in the 2022-2024 report PDFs captured for this build; earlier reports were not captured and carry summaries only"))
        facts.append(("Source", f"FTC Annual Report on Refunds to Consumers {latest_report}, 'Snapshot' table"))
        rows.append(record(
            "ftc_refunds", f"{y}-summary", f"FTC refunds {y} summary", source_url=source,
            cells={"case": f"All FTC refund programs {y}", "report_year": str(y), "stage": "Annual summary", "amount": fmt_usd(extras_["values"].get("total_sent_usd")) if "total_sent_usd" in extras_["values"] else NOT_RECORDED, "amount_label": "Total sent (as printed)", "consumers": NOT_RECORDED, "consumers_label": "Not published", "pct_cashed": NOT_RECORDED, "date": f"Calendar year {y}"},
            facts=facts, state="", subtitle=f"Returned {v['printed'][0]}% · Treasury {v['printed'][1]}% · Admin {v['printed'][2]}%",
            text=f"FTC refunds to consumers annual summary {y} treasury administrative costs", filters={"report_year": [str(y)], "kind": ["summary"], "stage": ["annual_summary"]},
            links=links, extra=extras_,
        ))
    # cross-record links: other rows with the identical published case name (exact string), by record id
    by_name = {}
    for r in rows:
        if r["filters"]["kind"] == ["case"]:
            by_name.setdefault(r["item"]["title"], []).append(r["id"])
    for r in rows:
        if r["filters"]["kind"] == ["case"]:
            others = [i for i in by_name[r["item"]["title"]] if i != r["id"]]
            if others:
                label = "Same case name in another table/year: "
                extra_links = [{"url": f"/records/ftc_refunds/{i}", "label": label + i} for i in others]
                r["item"]["links"].extend(extra_links)
                r["detail"]["links"].extend(extra_links)
                r["detail"]["facts"].append(["Rows with the identical case name", ", ".join(others)])
    n_cases = sum(1 for r in rows if r["filters"]["kind"] == ["case"])
    log["counts"]["ftc_refunds"] = {"total": len(rows), "case_rows": n_cases, "state_rows": state_rows, "summary_rows": len(summary_years)}
    log["refund_tables"] = {str(y): {k: {"rows": len(reports[y]["cases"][k]["cases"]), "excluded": reports[y]["cases"][k]["excluded"], "total_differences": reports[y]["cases"][k]["total_differences"]} for k in STAGE_ORDER} for y in reports}
    log["refund_state_checks"] = {str(y): {"states": len(reports[y]["states"]), "extras": reports[y]["extras"], "problems": reports[y]["state_problems"]} for y in reports}
    log["refund_cross_references"] = {
        "distinct_case_names": len(unique_names),
        "refund_program_pages": {"near_misses_not_linked": near_misses, "matched": len(program_match), "ambiguous": len(program_ambiguous), "unmatched": len(program_unmatched), "matched_names": {n: program_ids[s]["url"] for n, s in sorted(program_match.items())}, "ambiguous_names": program_ambiguous},
        "company_profiles": {"matched": len(company_match), "ambiguous": len(company_ambiguous), "unmatched": len(company_unmatched), "matched_names": {n: companies[c] for n, c in company_match.items()}, "company_titles_in_lookup": len(companies)},
        "rule": "case name and program title compared with lower-case letters and digits only; one trailing 'Refunds'/'Refund'/'Settlement' word removed from the program title only; link only when exactly one target matches",
    }
    # --- programs dataset
    prog_rows = []
    reverse_cases = {}
    for n, sid in program_match.items():
        reverse_cases.setdefault(sid, []).append(n)
    for p in programs:
        sid = p["url"].rsplit("/", 1)[-1]
        cases_for = sorted(reverse_cases.get(sid, []))
        links = [{"url": p["url"], "label": "FTC refund program page"}]
        for n in cases_for:
            for rid_ in case_ids.get(n, []):
                links.append({"url": f"/records/ftc_refunds/{rid_}", "label": f"Annual report row: {rid_}"})
        facts = [("Program", p["title"]), ("Date (as published in the list)", p["date"]), ("Claims administrator", p["administrator"] or NOT_RECORDED), ("Program hotline (as published)", p["phone"] or NOT_RECORDED), ("Products (as published)", p["products"] or NOT_RECORDED), ("List", "FTC Refund Programs: 'The chart below includes all active refund programs managed by the FTC.'"), ("Retrieved", idx_entry["retrieved_at"]), ("Annual report rows with the identical case name", ", ".join(c for c in cases_for) if cases_for else "None found by exact name")]
        prog_rows.append(record(
            "ftc_refund_programs", sid, p["title"], source_url=idx_entry["url"],
            cells={"program": p["title"], "date": p["date"], "administrator": p["administrator"] or NOT_RECORDED, "hotline": p["phone"] or NOT_RECORDED},
            facts=facts, state="", subtitle=f"{p['date']} · {p['administrator'] or 'administrator not listed'}",
            text=" ".join(["FTC active refund program claims", p["title"], p["administrator"] or "", p["products"] or ""]),
            filters={"date": [p["date"]], "administrator": [p["administrator"] or "Not recorded"]}, links=links,
            extra={"program_url": p["url"], "case_names_matched_exactly": cases_for, "provenance": C.provenance(idx_entry)},
        ))
    log["counts"]["ftc_refund_programs"] = len(prog_rows)
    sources = {
        **{f"report_{y}": C.source_record(r["entry"], r["pdf"], name=f"{y} FTC Annual Report on Refunds to Consumers", publisher="Federal Trade Commission, Bureau of Consumer Protection, Office of Claims and Refunds") for y, r in reports.items()},
        "data_page": C.source_record(data_entry, name="Data on Refunds to Consumers"),
        "programs_page": C.source_record(idx_entry, name="FTC Refund Programs (active programs)"),
    }
    refunds_summary = {
        "label": "FTC refunds to consumers by case and year", "rows": len(rows), "case_rows": n_cases, "state_rows": state_rows, "summary_rows": len(summary_years),
        "years": {"case_and_state_tables": REFUND_YEARS, "share_of_funds_summaries": summary_years},
        "method": FIRECRAWL_METHOD, "terms": GOV_TERMS, "sources": sources,
        "coverage_statement": "Per-case tables (first distributions, additional distributions, closed cases) and per-state mailed dollars exist only in the 2022, 2023 and 2024 report PDFs; the 2020 and 2021 reports and earlier carry summaries only and were not loaded. Share-of-funds summaries cover 2018-2024 from the snapshot tables of the 2022-2024 reports.",
        "validation": "Case cells are read by value type; closed-case rows must satisfy returned + admin + left over (+ education) = total fund (+-$2) and cashed <= base, first-distribution rows percent = cashed / eligible (+-1 point). The printed Totals row is compared with the column sums and any difference is shown beside the rows (it is a property of the printed report).",
        "formulas": {"share_of_listed_states_pct": "state dollars mailed / sum of the state table * 100", "yoy_pct": "(mailed in year t / mailed in year t-1 - 1) * 100"},
        "cross_references": log["refund_cross_references"],
        "caveats": ["Case names are exactly as printed (HTML entities decoded); the same case can appear in several tables and years under slightly different names, and rows are linked only when the published name is identical.", "Amounts in the three tables mean different things (dollars sent in a distribution, dollars sent in the most recent distribution, dollars returned when closed) and are not additive.", "State rows cover the 50 states, DC and Puerto Rico. The 2022 state table also lists the U.S. Virgin Islands ($1,833), and every year lists military bases, international and electronic payments; these stay on the year's summary row (values and facts) and are not state rows. A year's printed Total Sent can differ from the sum of its listed parts (2023 by $7, 2024 by $3); both are shown as printed."],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    programs_summary = {
        "label": "FTC active refund programs", "rows": len(prog_rows), "method": FIRECRAWL_METHOD, "terms": GOV_TERMS,
        "sources": {"programs_page": sources["programs_page"]},
        "caveats": ["A snapshot of the FTC list on the retrieval date; programs leave the list when they close.", "The 'Date' column is printed without a header definition and is shown exactly as published."],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    inputs = [C.input_ref(reports[y]["entry"]) for y in reports] + [C.input_ref(reports[y]["pdf"]) for y in reports] + [C.input_ref(data_entry), C.input_ref(idx_entry)]
    return rows, refunds_summary, prog_rows, programs_summary, inputs, [C.input_ref(idx_entry)], company_src


REFUND_COLUMNS = [("case", "Case"), ("report_year", "Report year"), ("stage", "Stage"), ("date", "Date (as published)"), ("amount", "Amount"), ("amount_label", "Amount is"), ("consumers", "Consumers"), ("pct_cashed", "Cashed")]
PROGRAM_COLUMNS = [("program", "Refund program"), ("date", "Date"), ("administrator", "Administrator"), ("hotline", "Hotline")]


def refunds_listing():
    return writer.listing(REFUND_COLUMNS, [
        ("report_year", "Report year", {str(y): str(y) for y in sorted(set(REFUND_YEARS) | set(range(2018, 2025)), reverse=True)}),
        ("kind", "Record kind", {"case": "Case row", "state": "State mailed", "summary": "Annual summary"}),
        ("stage", "Stage", {"first_distribution": "First distribution", "additional_distribution": "Additional distribution", "closed": "Case closed", "state_mailed": "Mailed to state", "annual_summary": "Annual summary"}),
    ])


def programs_listing():
    return writer.listing(PROGRAM_COLUMNS, [])


# ====================================================================================================================
# Do Not Call

def build_dnc(manifest, log):
    books, entries, pdf_entries = {}, {}, {}
    names = {2021: "dnc_databook_fy2021_pdf.json", 2022: "dnc_databook_fy2022_pdf.json", 2023: "dnc_databook_fy2023_pdf.json", 2024: "dnc_databook_fy2024_pdf.json", 2025: "dnc_databook_fy2025_pdf.json"}
    bases = {}
    firecrawl_tables = {}
    for fy, name in names.items():
        entry, md = read_capture(manifest, name)
        pdf_entry = manifest[DNC_PDFS[fy]]
        pages = P.split_pages(md)
        # reading of record for the ranking tables: the official PDF's own word layer
        pdf_tables, pdf_problems = F.read_book(os.path.join(C.ROOT, pdf_entry["path"]), f"FY{fy}")
        rankings = {kind: {usps: {**row, "chunk": f"PDF page {F.REGISTRATIONS_PAGE if kind == 'registrations' else F.COMPLAINTS_PAGE}"} for usps, row in table.items()} for kind, table in pdf_tables.items()}
        fc_rankings, fprobs = D.parse_dnc_rankings(pages)  # Firecrawl text of the same tables: cross-check only
        totals = D.parse_dnc_state_pages(pages)
        by_state, aprobs = D.assign_pages(totals, rankings, fy)
        if pdf_problems or aprobs:
            raise SystemExit(f"FY{fy} Do Not Call Data Book failed: {pdf_problems + aprobs}")
        books[fy] = {"rankings": rankings, "pages": by_state}
        firecrawl_tables[fy] = fc_rankings
        entries[fy], pdf_entries[fy] = entry, pdf_entry
        bases[fy] = D.dnc_population_basis(md)
    # cross-check the two machine readings (Firecrawl text, Tavily text) against the PDF word layer
    independent = {}
    for fy, names_ in DNC_INDEPENDENT_READS.items():
        independent[fy] = X.load_supplements([os.path.join(C.ROOT, manifest[n]["path"]) for n in names_])
    crosscheck = {"firecrawl_text_vs_pdf": {"agree": 0, "differ": [], "missing_in_firecrawl": 0}, "tavily_text_vs_pdf": {"agree": 0, "differ": []}}
    for fy in books:
        for kind in ("registrations", "complaints"):
            for usps, prow in books[fy]["rankings"][kind].items():
                frow = firecrawl_tables[fy][kind].get(usps)
                if frow is None:
                    crosscheck["firecrawl_text_vs_pdf"]["missing_in_firecrawl"] += 1
                elif (frow["count"], frow["per100k"]) == (prow["count"], prow["per100k"]):
                    crosscheck["firecrawl_text_vs_pdf"]["agree"] += 1
                else:
                    crosscheck["firecrawl_text_vs_pdf"]["differ"].append(f"{usps}-FY{fy} {kind}: Firecrawl {frow['count']}/{frow['per100k']} vs PDF {prow['count']}/{prow['per100k']}")
                trow = independent.get(fy, {}).get(kind, {}).get(usps)
                if trow:
                    if (trow["count"], trow["per100k"]) == (prow["count"], prow["per100k"]):
                        crosscheck["tavily_text_vs_pdf"]["agree"] += 1
                    else:
                        crosscheck["tavily_text_vs_pdf"]["differ"].append(f"{usps}-FY{fy} {kind}: Tavily {trow['count']}/{trow['per100k']} vs PDF {prow['count']}/{prow['per100k']}")
    log["dnc_crosscheck_vs_pdf"] = crosscheck
    recs = D.consolidate(books)
    supplement_entries = {n: manifest[n] for names_ in DNC_INDEPENDENT_READS.values() for n in names_}
    rows = []
    withheld_log = {}
    for fy in sorted(books, reverse=True):
        for usps in sorted(P.STATES, key=lambda u: P.STATES[u]):
            r = recs[(usps, fy)]
            prev = recs.get((usps, fy - 1))
            reg, cmp_ = r["registrations"], r["complaints"]
            preg = prev and prev["registrations"]
            pcmp = prev and prev["complaints"]
            an = {
                "complaints_yoy_pct": A.yoy_pct(cmp_ and cmp_["count"], pcmp and pcmp["count"]),
                "complaints_per100k_yoy_pct": A.yoy_pct(cmp_ and cmp_["per100k"], pcmp and pcmp["per100k"]),
                "complaints_rank_change": A.rank_change(pcmp and pcmp["rank"], cmp_ and cmp_["rank"]),
                "registrations_yoy_pct": A.yoy_pct(reg and reg["count"], preg and preg["count"]),
                "registrations_rank_change": A.rank_change(preg and preg["rank"], reg and reg["rank"]),
            }
            name = P.STATES[usps]
            if r["withheld"]:
                withheld_log[f"{usps}-FY{fy}"] = r["withheld"]
            if not reg and not cmp_:
                withheld_log[f"{usps}-FY{fy}"] = withheld_log.get(f"{usps}-FY{fy}", []) + ["no figure readable"]
                continue
            facts = [
                ("State", f"{name} ({usps})"), ("Period", f"Federal fiscal year {fy} (October {fy - 1} to September {fy}); registrations as of September 30, {fy}"),
                ("DNC complaints", fmt_int(cmp_ and cmp_["count"]) + (f" ({cmp_['count_check']})" if cmp_ and cmp_["count"] is not None else "")),
                ("DNC complaints per 100K population", fmt_int(cmp_ and cmp_["per100k"]) + f"; denominator: FTC's {bases[fy]} U.S. Census population estimates" if cmp_ and cmp_["per100k"] is not None else NOT_RECORDED),
                ("State rank, complaints per 100K", (fmt_rank(cmp_["rank"]) + " of 50 states") if cmp_ and cmp_["rank"] else "Not recorded (unranked or not readable)"),
                ("Active registrations", fmt_int(reg and reg["count"]) + (f" ({reg['count_check']})" if reg and reg["count"] is not None else "")),
                ("Active registrations per 100K population", fmt_int(reg and reg["per100k"]) if reg and reg["per100k"] is not None else NOT_RECORDED),
                ("State rank, registrations per 100K", (fmt_rank(reg["rank"]) + " of 50 states") if reg and reg["rank"] else "Not recorded (unranked or not readable)"),
                ("Complaints, change vs prior fiscal year", fmt_signed_pct(an["complaints_yoy_pct"]) + " (derived)"),
                ("Source", f"National Do Not Call Registry Data Book FY {fy}: ranking tables read from the official PDF word layer (page {F.REGISTRATIONS_PAGE} registrations, page {F.COMPLAINTS_PAGE} complaints) and the {name} state page totals (Firecrawl capture chunk {(r['chunks'].get('complaints') or r['chunks'].get('registrations') or {}).get('page')})"),
                ("Other readings that disagreed", "; ".join(r["notes"]) if r["notes"] else "none"),
                ("Not recorded because", "; ".join(r["withheld"]) if r["withheld"] else "nothing withheld"),
            ]
            cells = {"state": name, "fiscal_year": f"FY{fy}", "complaints": fmt_int(cmp_ and cmp_["count"]), "complaints_per100k": fmt_int(cmp_ and cmp_["per100k"]), "complaints_rank": fmt_rank(cmp_ and cmp_["rank"]) if cmp_ and cmp_["rank"] else NOT_RECORDED, "registrations": fmt_int(reg and reg["count"]), "registrations_per100k": fmt_int(reg and reg["per100k"])}
            rows.append(record(
                "ftc_dnc_states", f"{usps}-FY{fy}", f"{name} FY{fy}", source_url=entries[fy]["url"], cells=cells, facts=facts, state=usps,
                subtitle=f"National Do Not Call Registry Data Book FY {fy}", text=" ".join(["FTC National Do Not Call Registry complaints registrations telemarketing robocalls", name, usps, f"FY{fy}"]),
                filters={"fiscal_year": [f"FY{fy}"], "kind": [state_kind(usps)]},
                links=[*PLACES(usps, name), {"url": entries[fy]["url"], "label": f"National Do Not Call Registry Data Book FY {fy} (FTC PDF)"}],
                extra={"metrics": {"complaints": cmp_ and cmp_["count"], "complaints_per100k": cmp_ and cmp_["per100k"], "complaints_rank": cmp_ and cmp_["rank"], "registrations": reg and reg["count"], "registrations_per100k": reg and reg["per100k"], "registrations_rank": reg and reg["rank"]}, "analytics": an, "population_basis_year": bases[fy], "provenance": C.provenance(entries[fy], pdf_entries[fy], ranking_tables_from="official PDF, pdfplumber words at y_tolerance 0.3, overlay header tokens dropped", chunks=r["chunks"], notes=r["notes"], withheld=r["withheld"])},
            ))
    log["counts"]["ftc_dnc_states"] = len(rows)
    log["dnc_population_basis"] = bases
    log["dnc_withheld"] = withheld_log
    cov = {}
    for fy in sorted(books):
        sub = [recs[(u, fy)] for u in P.STATES]
        cov[f"FY{fy}"] = {"complaints_count": sum(1 for r in sub if r["complaints"] and r["complaints"]["count"] is not None), "complaints_per100k": sum(1 for r in sub if r["complaints"] and r["complaints"]["per100k"] is not None), "complaints_rank": sum(1 for r in sub if r["complaints"] and r["complaints"]["rank"] is not None), "registrations_count": sum(1 for r in sub if r["registrations"] and r["registrations"]["count"] is not None), "registrations_per100k": sum(1 for r in sub if r["registrations"] and r["registrations"]["per100k"] is not None), "registrations_rank": sum(1 for r in sub if r["registrations"] and r["registrations"]["rank"] is not None), "of_jurisdictions": 52}
    log["dnc_coverage"] = cov
    summary = {
        "label": "FTC National Do Not Call Registry complaints and registrations by state", "rows": len(rows), "fiscal_years": [f"FY{y}" for y in DNC_YEARS], "method": FIRECRAWL_METHOD, "terms": GOV_TERMS,
        "sources": {f"FY{fy}": C.source_record(entries[fy], pdf_entries[fy], name=f"National Do Not Call Registry Data Book FY {fy}", publisher="Federal Trade Commission", population_basis_year=bases[fy]) for fy in sorted(entries)},
        "coverage": cov,
        "cross_checks": log["dnc_crosscheck_vs_pdf"],
        "independent_readings": {n: {"url": e["url"], "path": e["path"], "sha256": e["sha256"], "method": e["method"]} for n, e in sorted(supplement_entries.items())},
        "validation": "Ranking tables are read from the official PDF's word layer (pdfplumber, y_tolerance 0.3, hidden overlay header tokens dropped), which returns all 52 rows of both tables in every edition; each table must have ranks 1-50 contiguous, DC and PR unranked and per-100K non-increasing. A count is published when the PDF table and the Firecrawl state page agree, or when the per-100K figure and the implied population (count / per-100K) confirm the PDF count; a per-100K figure only when its implied population matches the state's registrations-table population to rounding (same edition) and the state's median over all editions within 20%. The Firecrawl text and the Tavily text of the same tables are cross-checks only (see cross_checks), never a source.",
        "formulas": {"complaints_yoy_pct": "(complaints in FY t / complaints in FY t-1 - 1) * 100, both readable", "rank_change": "rank in FY t-1 minus rank in FY t (positive = higher complaints per capita)", "implied_population": "count / per-100K * 100,000 (used only as a validity check)"},
        "caveats": ["Complaints are consumer reports to the FTC about calls allegedly violating the Do Not Call rules, not findings of violations.", "State comes from the state the consumer reported or else from the phone's area code (Data Book 'Inside the numbers').", "Per-100K figures use different Census vintages in different editions (see population_basis_year)."],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return rows, summary, [C.input_ref(entries[fy]) for fy in sorted(entries)] + [C.input_ref(pdf_entries[fy]) for fy in sorted(pdf_entries)]


DNC_COLUMNS = [("state", "State"), ("fiscal_year", "Fiscal year"), ("complaints", "Complaints"), ("complaints_per100k", "Per 100K"), ("complaints_rank", "Rank"), ("registrations", "Active registrations"), ("registrations_per100k", "Per 100K")]


def dnc_listing():
    return writer.listing(DNC_COLUMNS, [("fiscal_year", "Fiscal year", {f"FY{y}": f"FY{y}" for y in sorted(DNC_YEARS, reverse=True)}), ("kind", "Jurisdiction", {"state": "State", "district": "District of Columbia", "territory": "Territory"})])


# ====================================================================================================================

def write_build(dataset, label, listing_block, summary, rows, inputs):
    path = os.path.join(C.BUILD, f"{dataset}.json")
    payload = {
        "dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "inputs": inputs,
    }
    assert json.loads(json.dumps(payload["rows"])) == payload["rows"]
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=False)
    return path


def main():
    manifest = C.load_manifest()
    log = {"counts": {}, "databooks": {}, "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    os.makedirs(C.BUILD, exist_ok=True)
    books = load_databooks(manifest, log)
    terms_ref = C.input_ref(manifest["ftc_website_policy_copyright_excerpt.txt"])  # terms of reuse, listed with every dataset's inputs
    book_inputs = [C.input_ref(books[y]["entry"]) for y in sorted(books)] + [C.input_ref(books[y]["pdf"]) for y in sorted(books)] + [terms_ref]
    rows, summary = build_states(books, log)
    write_build("ftc_sentinel_states", "FTC Consumer Sentinel reports by state and year", states_listing(), summary, rows, book_inputs)
    rows, summary = build_national(books, log)
    write_build("ftc_sentinel_national", "FTC Consumer Sentinel national statistics by year", national_listing(), summary, rows, book_inputs)
    r_rows, r_summary, p_rows, p_summary, r_inputs, p_inputs, company_src = build_refunds(manifest, log)
    write_build("ftc_refunds", "FTC refunds to consumers by case and year", refunds_listing(), r_summary, r_rows, r_inputs + [terms_ref])
    write_build("ftc_refund_programs", "FTC active refund programs", programs_listing(), p_summary, p_rows, p_inputs + [terms_ref])
    d_rows, d_summary, d_inputs = build_dnc(manifest, log)
    write_build("ftc_dnc_states", "FTC Do Not Call complaints and registrations by state", dnc_listing(), d_summary, d_rows, d_inputs + [terms_ref])
    log["company_lookup_source"] = {"source": company_src["source"], "retrieved_at": company_src["retrieved_at"], "titles": len(company_src["rows"])}
    with open(os.path.join(C.BUILD, "build_log.json"), "w", encoding="utf-8") as handle:
        json.dump(log, handle, indent=1, ensure_ascii=False)
    print(json.dumps(log["counts"]))


if __name__ == "__main__":
    main()
