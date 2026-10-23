"""Build ftc_hsr_early_terminations (every notice the FTC API publishes) and ftc_hsr_filings (the FTC's HSR filing data sets).

Reads only private/acq/ftc_data/ (API pages, CSV downloads, manifest). Values are as published; derived values are the
tested formulas in hsr_parse.FORMULAS and in the dataset summaries.
"""
import glob
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bcommon as B  # noqa: E402
import hsr_parse as H  # noqa: E402

API_DOCS = "https://www.ftc.gov/developer/api/v0/endpoints/hsr-early-termination-notices"
API_BASE = "https://api.ftc.gov/v0/hsr-early-termination-notices"
NOTICE_PAGE = "https://www.ftc.gov/legal-library/browse/early-termination-notices/"
DATASETS_PAGE = "https://www.ftc.gov/policy-notices/open-government/data-sets"
MONTH_CSV = "https://www.ftc.gov/system/files/ftc_gov/data/HSR-Merger-Transactions-by-Month.csv"
FY_CSV = "https://www.ftc.gov/system/files/ftc_gov/data/HSR-Transactions-Filings-Second-Requests-by-FY.csv"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

NOTICE_COLUMNS = [("transaction_number", "Transaction"), ("date", "Granted"), ("acquiring_party", "Acquiring party"), ("acquired_party", "Acquired party"), ("fiscal_year", "Fiscal year")]
FILINGS_COLUMNS = [("period", "Period"), ("transactions_reported", "Transactions reported"), ("filings_received", "Filings received"), ("second_requests", "Second requests"), ("et_granted", "Early termination granted"), ("count", "Monthly count")]


def api_meta_count(path=None):
    """meta.count the API reported when the pages were read (from the fetch log), or None when there is no log."""
    path = path or os.path.join(B.ACQ, "hsr", "_pass_log.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle).get("meta_count")


def load_api_pages(directory=None):
    pages = []
    for path in sorted(glob.glob(os.path.join(directory or os.path.join(B.ACQ, "hsr", "pages"), "*.json.gz"))):
        with gzip.open(path, "rb") as handle:
            pages.append((path, json.loads(handle.read())))
    return pages


def api_url(api_id):
    """The FTC's documented single-notice request (no key): the id filter of the list endpoint."""
    return f"{API_BASE}?filter[id][value]={api_id}"


def build_notices(pages=None, entries=None, filing_fy_rows=None):
    pages = pages if pages is not None else load_api_pages()
    entries = entries if entries is not None else B.current_entries()
    merged, stats = H.merge_pages([doc for _, doc in pages])
    notices, empty = [], []
    for rid, rec in merged.items():
        n = H.normalize_notice(rec)
        if n is None:
            empty.append(rid)
        else:
            notices.append(n)
    ids = H.assign_ids(notices)
    cal, fy, undated = H.counts_by_year(notices)
    rows = []
    differs = []
    for n in sorted(notices, key=lambda x: (x["date"] or "", ids[x["api_id"]])):
        rid = ids[n["api_id"]]
        status = H.title_status(n)
        title = H.composed_title(n) or n["title_published"] or f"Transaction {n['transaction_number'] or 'not recorded'}"
        if status == "differs":
            differs.append(rid)
        f = H.fiscal_year(n["date"])
        year = n["date"][:4] if f else None
        facts = [
            ("Transaction number", n["transaction_number"]),
            ("Early termination granted", n["date"]),
            ("Acquiring party", n["acquiring_party"]),
            ("Acquired party", n["acquired_party"]),
            ("Acquired entities", "; ".join(n["acquired_entities"]) if n["acquired_entities"] else None),
            ("Federal fiscal year", f"FY{f} (derived from the date; October to September)" if f else None),
            ("Notice created / last updated", f"{n['created'] or 'Not recorded'} / {n['updated'] or 'Not recorded'}"),
        ]
        if status == "differs":
            facts.append(("Title as published", n["title_published"]))
        facts.append(("Source", f"FTC HSR Early Termination Notices API, record {n['api_id']} ({API_DOCS})"))
        links = []
        if n["transaction_number"] and H.TXN.match(n["transaction_number"]):
            links.append({"url": NOTICE_PAGE + n["transaction_number"], "label": "Notice on ftc.gov"})
        rows.append(
            B.record(
                "ftc_hsr_early_terminations", rid, title,
                source_url=api_url(n["api_id"]),
                subtitle=f"Early termination granted {n['date']}" if n["date"] else "Early termination notice (date not recorded)",
                cells={
                    "transaction_number": n["transaction_number"] or B.NOT_RECORDED,
                    "date": n["date"] or B.NOT_RECORDED,
                    "acquiring_party": n["acquiring_party"] or B.NOT_RECORDED,
                    "acquired_party": n["acquired_party"] or B.NOT_RECORDED,
                    "fiscal_year": f"FY{f}" if f else B.NOT_RECORDED,
                },
                facts=facts, links=links,
                text=" ".join([n["acquiring_party"] or "", n["acquired_party"] or "", *n["acquired_entities"]]),
                filters={"kind": ["notice"], "year": [year] if year else [], "fiscal_year": [f"FY{f}"] if f else []},
                extra={
                    "kind": "notice",
                    "notice": {
                        "transaction_number": n["transaction_number"], "date": n["date"], "fiscal_year": f, "acquiring_party": n["acquiring_party"],
                        "acquired_party": n["acquired_party"], "acquired_entities": n["acquired_entities"], "api_id": n["api_id"],
                        "title_published": n["title_published"], "title_status": status, "created": n["created"], "updated": n["updated"],
                    },
                },
            )
        )
    series = {"calendar_year": {str(k): v for k, v in cal.items()}, "fiscal_year": {str(k): v for k, v in fy.items()}, "undated": undated, "notices": len(notices)}
    first_date = min((n["date"] for n in notices if not H.date_problems(n)), default=None)
    last_date = max((n["date"] for n in notices if not H.date_problems(n)), default=None)
    crosscheck = []
    for r in filing_fy_rows or []:
        notices_fy = fy.get(r["fy"])
        crosscheck.append({"fiscal_year": r["fy"], "notices_in_api": notices_fy, "transactions_granted_in_ftc_table": r["et_granted"]})
    rows.append(
        B.record(
            "ftc_hsr_early_terminations", "series-by-year", "Early termination notices granted, by year",
            source_url=API_DOCS, subtitle=f"Counts of the notices in this dataset by the date early termination was granted ({first_date} to {last_date})",
            cells={"period": f"{first_date} to {last_date}", "notices": B.fmt_int(len(notices))},
            facts=[
                ("What is counted", "Notices the FTC API publishes, by the published date early termination was granted. Each notice names one transaction; one transaction can have more than one notice."),
                ("Period", f"{first_date} to {last_date}"),
                ("Notices", B.fmt_int(len(notices))),
                ("Notices without a usable date", B.fmt_int(undated)),
            ],
            text="early termination notices by year HSR Hart-Scott-Rodino series",
            filters={"_listing": ["no"], "kind": ["series"]},
            extra={"kind": "series", "series": series, "formulas": H.FORMULAS},
        )
    )
    summary = {
        "label": "FTC HSR early termination notices", "rows": len(rows), "notices": len(notices), "empty_records_excluded": len(empty), "terms": B.GOV_TERMS + " " + B.API_TERMS,
        "method": "FTC HSR Early Termination Notices API (https://api.ftc.gov/v0/hsr-early-termination-notices), read directly; every page stored unchanged; the key travels in a request header so no recorded URL contains it",
        "coverage": {"first_notice_date": first_date, "last_notice_date": last_date, "meta_count_reported_by_api": api_meta_count()},
        "passes": stats, "title_differs_from_fields": len(differs), "formulas": H.FORMULAS,
        "caveats": [
            "A notice records that the FTC and DOJ granted early termination of the HSR waiting period for one transaction. It does not say the transaction closed, or that no enforcement followed.",
            "Early termination was suspended in February 2021 and the notices resume only after the FTC reinstated it in 2025, so years in between are near-empty by rule, not by data loss. The FTC's HSR annual reports describe the suspension.",
            "Names are exactly as published; they are never merged with other companies.",
        ],
        "empty_records": empty,
        "built_at": B.now_utc(),
    }
    inputs = [B.input_ref(e) for u, e in sorted(entries.items()) if u.startswith(API_BASE)]
    return rows, summary, inputs, {"notices": notices, "calendar": cal, "fiscal": fy, "undated": undated, "crosscheck": crosscheck, "differs": differs}


def month_label(key):
    year, month = key.split("-")
    return f"{MONTHS[int(month) - 1]} {year}"


def build_filings(entries=None):
    entries = entries if entries is not None else B.current_entries()
    month_entry, fy_entry = entries[MONTH_CSV], entries[FY_CSV]
    with open(os.path.join(B.ROOT, month_entry["path"]), "rb") as handle:
        months, month_problems = H.parse_monthly_filings(handle.read().decode("utf-8"))
    with open(os.path.join(B.ROOT, fy_entry["path"]), "rb") as handle:
        fys = H.parse_fy_table(handle.read().decode("utf-8"))
    problems = H.fy_table_problems(fys)
    last_month = max(m["key"] for m in months)
    last_fy = max(r["fy"] for r in fys)
    per_fy = {}
    for m in months:
        per_fy[m["fy"]] = per_fy.get(m["fy"], 0) + 1
    # a fiscal year is partial when the monthly file holds fewer than its twelve months (the FTC's page says the files run
    # "through the third quarter of fiscal year 2025"; the downloaded files carry all twelve months of FY2025)
    partial_fy = last_fy if per_fy.get(last_fy, 0) < 12 else None
    basis = H.monthly_basis(months, fys)
    basis_by_group = {}
    for fy, (total, kind) in sorted(basis.items()):
        basis_by_group.setdefault(kind, []).append(fy)
    mismatches = [f"FY{fy}: the twelve monthly values add up to {total}, which equals neither the table's filings received nor its transactions reported" for fy, (total, kind) in sorted(basis.items()) if kind == "neither"]
    rows = []
    prev = {}
    for r in fys:
        rate = B.share_pct(r["second_requests_total"], r["adjusted_transactions"])
        yoy = B.yoy_pct(r["transactions_reported"], prev.get("transactions_reported"))
        grant_share = B.share_pct(r["et_granted"], r["et_requested"])
        partial = r["fy"] == partial_fy
        period = f"FY{r['fy']}" + (" (through " + month_label(last_month) + ")" if partial else "")
        facts = [
            ("Fiscal year", f"FY{r['fy']} (October {r['fy'] - 1} to September {r['fy']})" + (f"; the file runs only through {month_label(last_month)}" if partial else "")),
            ("Merger transactions reported", B.fmt_int(r["transactions_reported"])),
            ("Merger filings received", B.fmt_int(r["filings_received"])),
            ("Adjusted transactions (a second request could have been issued)", B.fmt_int(r["adjusted_transactions"])),
            ("Second requests issued (FTC and DOJ)", f"{B.fmt_int(r['second_requests_total'])} (FTC {B.fmt_int(r['second_requests_ftc'])}, DOJ {B.fmt_int(r['second_requests_doj'])})"),
            ("Transactions with an early termination request", B.fmt_int(r["et_requested"])),
            ("Early termination granted / not granted", f"{B.fmt_int(r['et_granted'])} / {B.fmt_int(r['et_not_granted'])}"),
            ("Second requests as a share of adjusted transactions (derived)", B.fmt_pct(rate, 2)),
            ("Source", f"FTC data set 'HSR Transactions Filings and Second Requests by Fiscal Year' ({FY_CSV})"),
        ]
        rows.append(
            B.record(
                "ftc_hsr_filings", f"fy-{r['fy']}", f"HSR filings, FY{r['fy']}" + ("*" if partial else ""),
                source_url=FY_CSV, subtitle=period,
                cells={"period": f"FY{r['fy']}" + ("*" if partial else ""), "transactions_reported": B.fmt_int(r["transactions_reported"]), "filings_received": B.fmt_int(r["filings_received"]),
                       "second_requests": B.fmt_int(r["second_requests_total"]), "et_granted": B.fmt_int(r["et_granted"])},
                facts=facts, links=[{"url": FY_CSV, "label": "FTC data set (CSV)"}],
                text="Hart-Scott-Rodino premerger notification filings second requests early termination fiscal year",
                filters={"kind": ["fiscal_year"], "period": [f"FY{r['fy']}"]},
                extra={"kind": "fiscal_year", "fy": r["fy"], "partial": partial, "metrics": {k: v for k, v in r.items() if k != "fy"},
                       "analytics": {"transactions_yoy_pct": yoy, "second_request_rate_pct": rate, "et_granted_share_of_requested_pct": grant_share}},
            )
        )
        prev = r
    for m in months:
        yoy = B.yoy_pct(m["transactions"], month_sum_lookup(months, m["year"] - 1, m["month"]))
        kind = basis[m["fy"]][1]
        what = {
            "filings": "merger filings (the fiscal year's monthly values add up to the FTC's 'filings received')",
            "transactions": "merger transactions (the fiscal year's monthly values add up to the FTC's 'transactions reported')",
            "neither": "a count the FTC's file does not tie to either fiscal-year column",
        }[kind]
        rows.append(
            B.record(
                "ftc_hsr_filings", f"month-{m['key']}", f"HSR merger count, {month_label(m['key'])}",
                source_url=MONTH_CSV, subtitle=f"FY{m['fy']}",
                cells={"period": month_label(m["key"]), "count": B.fmt_int(m["transactions"])},
                facts=[("Month", month_label(m["key"])), ("Fiscal year", f"FY{m['fy']}"), ("Count in the FTC's monthly file (column TransactionReceived)", B.fmt_int(m["transactions"])),
                       ("What the count is", f"In FY{m['fy']} it is {what}. The FTC's dictionary calls the column filings received; its fiscal-year totals show filings for FY1990 to FY1998 and transactions for FY1999 on, and the FTC does not explain the change."),
                       ("Source", f"FTC data set 'HSR Merger Filings by Month' ({MONTH_CSV})")],
                links=[{"url": MONTH_CSV, "label": "FTC data set (CSV)"}],
                text="Hart-Scott-Rodino premerger notification merger transactions filings month",
                filters={"kind": ["month"], "period": [m["key"][:4]]},
                extra={"kind": "month", "month": m["key"], "fy": m["fy"], "count": m["transactions"], "adds_up_to": kind, "analytics": {"yoy_pct": yoy}},
            )
        )
    summary = {
        "label": "FTC HSR merger filings, second requests and early terminations", "rows": len(rows), "terms": B.GOV_TERMS,
        "sources": {
            "fiscal_year_table": {"url": FY_CSV, "sha256": fy_entry["sha256"], "retrieved_at": fy_entry["retrieved_at"], "listed_on": DATASETS_PAGE},
            "monthly_table": {"url": MONTH_CSV, "sha256": month_entry["sha256"], "retrieved_at": month_entry["retrieved_at"], "listed_on": DATASETS_PAGE},
        },
        "coverage": {"fiscal_years": f"FY{min(r['fy'] for r in fys)} to FY{last_fy}", "months": f"{month_label(min(m['key'] for m in months))} to {month_label(last_month)}", "partial_fiscal_year": partial_fy},
        "consistency": {"fy_table_problems": problems, "monthly_file_problems": month_problems, "monthly_values_add_up_to": {k: v for k, v in basis_by_group.items()}, "monthly_sum_unexplained": mismatches},
        "formulas": {"second_request_rate_pct": "second requests (FTC and DOJ) / adjusted transactions * 100", "et_granted_share_of_requested_pct": "early termination granted / transactions with an early termination request * 100", "transactions_yoy_pct": "(transactions in FY t / transactions in FY t-1 - 1) * 100"},
        "caveats": [
            "The FTC's data-set page says both files run 'through the third quarter of fiscal year 2025'; the downloaded files carry all twelve months of FY2025, and they are shown as published.",
            "On February 4, 2021 the FTC, with the support of the DOJ, announced a temporary suspension of early termination grants (FTC press release, https://www.ftc.gov/news-events/news/press-releases/2021/02/ftc-doj-temporarily-suspend-discretionary-practice-early-termination). On October 10, 2024 the FTC said the suspension would be lifted once the final premerger-form rule is in full effect (https://www.ftc.gov/news-events/news/press-releases/2024/10/ftc-finalizes-changes-premerger-notification-form). The near-zero early terminations granted for FY2022 to FY2024 follow that.",
            "The monthly file's values are filings for FY1990 to FY1998 and transactions from FY1999 on (see consistency); a transaction normally involves two filings, so months before and after FY1999 are not comparable.",
        ],
        "built_at": B.now_utc(),
    }
    inputs = [B.input_ref(month_entry), B.input_ref(fy_entry)]
    return rows, summary, inputs, {"fys": fys, "months": months, "mismatches": mismatches, "problems": problems, "month_problems": month_problems, "basis": basis_by_group, "partial_fy": partial_fy}


def month_sum_lookup(months, year, month):
    for m in months:
        if m["year"] == year and m["month"] == month:
            return m["transactions"]
    return None


def notices_listing():
    return B.writer.listing(NOTICE_COLUMNS, [("fiscal_year", "Fiscal year", {f"FY{y}": f"FY{y}" for y in range(2026, 1998, -1)})])


def filings_listing():
    return B.writer.listing(FILINGS_COLUMNS, [("kind", "Rows", {"fiscal_year": "Fiscal years", "month": "Months"})])
