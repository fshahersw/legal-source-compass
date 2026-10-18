"""Spot-check displayed figures of the five FTC build files against the OFFICIAL PDFs (pdftotext -layout), not the Firecrawl captures.

For each sampled row the displayed strings (e.g. '70,132', '$104,201,969', '39%') must appear on the PDF line that carries
the row's own label (state, category, case name); when the PDF prints a row across several lines the check falls back to the
page and says so. The sample is deterministic (seeded) and spans every dataset and edition.

Usage: python3 -I -B scripts/enrichment/ftc_sentinel/verify_ftc_sentinel.py
Writes private/build/ftc_sentinel/spot_checks.json and prints a summary.
"""
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ftc_common as C  # noqa: E402
import ftc_parse as P  # noqa: E402

PDF_DIR = os.path.join(C.ROOT, "private", "acq", "ftc_sentinel", "pdf")
CSN = {2017: "consumer_sentinel_data_book_2017.pdf", 2018: "consumer_sentinel_network_data_book_2018_0.pdf", 2019: "consumer_sentinel_network_data_book_2019.pdf", 2020: "csn_annual_data_book_2020.pdf", 2021: "CSN_Annual_Data_Book_2021_Final_PDF.pdf", 2022: "CSN-Data-Book-2022.pdf", 2023: "CSN-Annual-Data-Book-2023.pdf", 2024: "csn-annual-data-book-2024.pdf"}
DNC = {2021: "dnc_data_book_2021.pdf", 2022: "DNC-Data-Book-2022.pdf", 2023: "Do-Not-Call-Data-Book-2023.pdf", 2024: "DNC-Data-Book-2024.pdf", 2025: "DNC-Data-Book-2025.pdf"}
REF = {2022: "2022_FTC_REFUNDS_TO_CONSUMERS.pdf", 2023: "ftc-refunds-to-consumers-2023.pdf", 2024: "ftc-refunds-consumers-2024.pdf"}
_pdfs = {}
_rows = {}


def _open(name):
    if name not in _pdfs:
        import pdfplumber

        _pdfs[name] = pdfplumber.open(os.path.join(PDF_DIR, name))
    return _pdfs[name]


def n_pages(name):
    return len(_open(name).pages)


def rows(name, page_no):
    """Row strings of one PDF page from its own word positions (pdfplumber, 3 pt row tolerance, overlay header words kept out)."""
    key = (name, page_no)
    if key not in _rows:
        words = _open(name).pages[page_no - 1].extract_words(x_tolerance=1.5, y_tolerance=0.3)
        for w in words:
            for bad, good in {"(cid:415)": "ti", "(cid:425)": "tt", "(cid:332)": "ft"}.items():
                w["text"] = w["text"].replace(bad, good)
        words.sort(key=lambda w: (round(w["top"]), w["x0"]))
        grouped, cur, top = [], [], None
        for w in words:
            if top is None or abs(w["top"] - top) > 3.0:
                if cur:
                    grouped.append(cur)
                cur, top = [w], w["top"]
            else:
                cur.append(w)
        if cur:
            grouped.append(cur)
        _rows[key] = [" ".join(w["text"] for w in sorted(g, key=lambda w: w["x0"])) for g in grouped]
    return _rows[key]


def flat(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def find(pdf_name, label, strings, page_range):
    """(level, page_no, row). 'line': every string sits on the PDF row that also holds the label (state / case name).
    'wrapped-name': the strings share one row and every word of the name (long names wrap over two or three rows) is on
    that row or the row above or below. 'page': all strings and the label are on the page but not on one row.
    """
    label_flat = flat(label)
    prefix = label_flat[:8]
    fallback = None
    for pg in page_range:
        if pg < 1 or pg > n_pages(pdf_name):
            continue
        page_rows = rows(pdf_name, pg)
        for i, line in enumerate(page_rows):
            if all(s in line for s in strings) and (not label_flat or label_flat in flat(line)):
                return "line", pg, line.strip()
        for i, line in enumerate(page_rows):
            if label_flat and all(s in line for s in strings):
                around = flat(" ".join(page_rows[max(0, i - 1): i + 2]))
                words = [flat(w) for w in label.split() if len(flat(w)) >= 3] or [prefix]
                if all(w in around for w in words):
                    return "wrapped-name", pg, " | ".join(page_rows[max(0, i - 1): i + 2]).strip()
        joined = " ".join(page_rows)
        if fallback is None and all(s in joined for s in strings) and (not label_flat or label_flat in flat(joined)):
            fallback = ("page", pg, f"(all strings on the page; label '{label}' on the page but not on the same row)")
    return fallback or (None, None, None)


def main():
    rnd = random.Random(20261018)
    b = {}
    for name in ("ftc_sentinel_states", "ftc_sentinel_national", "ftc_refunds", "ftc_dnc_states", "ftc_refund_programs"):
        with open(os.path.join(C.BUILD, f"{name}.json"), encoding="utf-8") as handle:
            b[name] = json.load(handle)
    checks = []

    def add(dataset, rid, field, shown, level, page_no, where):
        checks.append({"dataset": dataset, "id": rid, "field": field, "displayed": shown, "match": level is not None, "level": level, "pdf_page": page_no, "where": where})

    # --- states: ranking row (pages 19-23) and Appendix C row (last four pages)
    for r in rnd.sample(b["ftc_sentinel_states"]["rows"], 24):
        year = int(r["id"].split("-")[1])
        c, name = r["item"]["cells"], P.STATES[r["state"]]
        pdf = CSN[year]
        last = n_pages(pdf)
        level, pg, line = find(pdf, name, [c["fraud_other_per100k"], c["fraud_other_reports"]], range(19, 24))
        for field in ("fraud_other_per100k", "fraud_other_reports"):
            add("ftc_sentinel_states", r["id"], field, c[field], level, pg, line)
        level, pg, line = find(pdf, name, [c["fraud_reports"], c["total_loss"], c["median_loss"]], range(last - 3, last + 1))
        for field in ("fraud_reports", "total_loss", "median_loss"):
            add("ftc_sentinel_states", r["id"], field, c[field], level, pg, line)
    # --- national: headline fraud numbers on the 'Fraud Reports by Amount Lost' page (pages 9-13)
    for r in b["ftc_sentinel_national"]["rows"]:
        if not r["id"].startswith("US-20"):
            continue
        year = int(r["id"][3:])
        fs = r["item"]["fraud_summary"]
        for field, shown in (("fraud_reports", f"{fs['fraud_reports']:,}"), ("total_loss_usd", f"${fs['total_loss_usd']:,}"), ("median_loss_usd", f"${fs['median_loss_usd']:,}"), ("reports_with_loss", f"{fs['reports_with_loss']:,}")):
            level, pg, line = find(CSN[year], "", [shown], range(9, 14))
            add("ftc_sentinel_national", r["id"], field, shown, level, pg, line)
    # --- refunds: case rows (pages 5-10) and state mailed rows (pages 2-3)
    cases = [r for r in b["ftc_refunds"]["rows"] if r["filters"]["kind"] == ["case"]]
    for r in rnd.sample(cases, 14):
        year = int(r["item"]["cells"]["report_year"])
        c = r["item"]["cells"]
        fields = [("amount", c["amount"]), ("consumers", c["consumers"])] + ([("pct_cashed", c["pct_cashed"])] if c["pct_cashed"] != "Not recorded" else [])
        level, pg, line = find(REF[year], r["title"], [v for _, v in fields], range(5, 11))
        for field, shown in fields:
            add("ftc_refunds", r["id"], field, shown, level, pg, line)
    for r in [x for x in b["ftc_refunds"]["rows"] if x["id"].endswith(("-state-TX", "-state-PR", "-state-WY"))]:
        year = int(r["item"]["cells"]["report_year"])
        abbreviation = r["state"]
        level, pg, line = find(REF[year], "", [abbreviation, r["item"]["cells"]["amount"]], range(2, 4))
        add("ftc_refunds", r["id"], "mailed", r["item"]["cells"]["amount"], level, pg, line)
    # --- refunds: the figures printed under each year's state table (military bases, Virgin Islands, electronic/international, total sent)
    summaries = {r["id"]: r for r in b["ftc_refunds"]["rows"]}
    for year in (2022, 2023, 2024):
        values = summaries[f"{year}-summary"]["item"]["values"]
        for key in ("military_bases_usd", "virgin_islands_usd", "international_usd", "electronic_no_geography_usd", "electronic_and_international_usd", "total_sent_usd"):
            if key in values:
                shown = f"${values[key]:,}"
                level, pg, line = find(REF[year], "", [shown], range(2, 4))
                add("ftc_refunds", f"{year}-summary", key, shown, level, pg, line)
    # --- Do Not Call: ranking rows on pages 8 (registrations) and 9 (complaints)
    for r in rnd.sample(b["ftc_dnc_states"]["rows"], 14):
        fy = int(r["id"].split("FY")[1])
        c = r["item"]["cells"]
        name = P.STATES[r["state"]]
        for field, page_no in (("complaints", 9), ("registrations", 8)):
            strings = [c[field], c[field + "_per100k"]]
            level, pg, line = find(DNC[fy], name, strings, [page_no])
            for s, f in zip(strings, (field, field + "_per100k")):
                add("ftc_dnc_states", r["id"], f, s, level, pg, line)
    ok = sum(1 for c in checks if c["match"])
    by_level = {lv: sum(1 for c in checks if c["level"] == lv) for lv in ("line", "wrapped-name", "page")}
    out = {"checks": len(checks), "matches": ok, "mismatches": len(checks) - ok, "by_level": by_level, "detail": checks}
    with open(os.path.join(C.BUILD, "spot_checks.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in out.items() if k != "detail"}))
    for c in checks:
        if not c["match"]:
            print("MISMATCH", c["dataset"], c["id"], c["field"], c["displayed"])


if __name__ == "__main__":
    main()
