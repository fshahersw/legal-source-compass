"""Corpus rows for the complete FDA warning-letter index (pure; tested by test_warning_letters.py).

One row per letter page listed in FDA's warning-letter table, keyed by the letter's FDA.gov URL path (the publisher's
own identifier for the page). source_url is that letter page. Dates are the table's Posted Date and Letter Issue
Date, kept apart. Company names appear exactly as FDA lists them (whitespace collapsed as a browser renders it).
FDA's table does not publish an FEI number, so none is recorded; letter bodies are not fetched.
"""
import re

import wl_parse as wp

DATASET = "agency_safety_fda_warning_letters_index"
LABEL = "FDA warning letters (complete FDA.gov index)"
CATEGORY = "agency_safety"
QUALIFICATION = (
    "Every warning letter listed in FDA's warning-letter table on FDA.gov at the capture date. Posted Date is when "
    "FDA posted the letter; Letter Issue Date is when it was issued, and posting can lag issue. A warning letter "
    "states FDA's allegations at the time; it is not a final agency or court finding, and later responses and "
    "closeouts are linked as FDA lists them. FDA's table does not publish FEI numbers; letter bodies were not "
    "fetched. U.S. Government work (public domain)."
)
SHORT_QUALIFICATION = (
    "FDA warning letter as listed on FDA.gov. A warning letter states FDA's allegations; it is not a final finding."
)


def firm_norm(firm):
    """Same rule as the FDA enforcement datasets (src/lib/ingest/sources/openfdaEnforcement.ts firmNorm)."""
    text = (firm or "").replace("&", " and ")
    text = re.sub(r"['’]", "", text)
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    return re.sub(r" +", " ", text).strip().upper()


def row(letter, *, captured):
    nr = "Not recorded"
    rid = f"fda-wl:{letter['slug']}"
    title = letter["company_name"] or f"FDA warning letter {letter['slug']}"
    posted, issued = letter["posted_date"], letter["letter_issue_date"]
    response_date = wp.us_date(letter["response_letter"] or "")
    closeout_date = wp.us_date(letter["closeout_letter"] or "")
    norm = firm_norm(letter["company_name"] or "")
    subtitle = " · ".join(x for x in (
        f"issued {issued}" if issued else "issue date not recorded",
        f"posted {posted}" if posted else "posted date not recorded",
        letter["issuing_office"],
    ) if x)
    links = [{"url": letter["url"], "label": "Warning letter on FDA.gov"}]
    links += [{"url": u, "label": "Response letter on FDA.gov"} for u in letter["response_letter_urls"]]
    links += [{"url": u, "label": "Closeout letter on FDA.gov"} for u in letter["closeout_letter_urls"]]
    links.append({"url": wp.FDA_WARNINGS, "label": "FDA warning-letter index"})
    cells = {
        "posted_date": posted,
        "letter_issue_date": issued,
        "company_name": letter["company_name"],
        "issuing_office": letter["issuing_office"],
        "subject": letter["subject"],
        "response_letter": response_date or letter["response_letter"],
        "closeout_letter": closeout_date or letter["closeout_letter"],
    }
    facts = [
        ["Company (as listed by FDA)", letter["company_name"] or nr],
        ["Subject", letter["subject"] or nr],
        ["Issuing office", letter["issuing_office"] or nr],
        ["Letter issue date", issued or (f"{letter['letter_issue_date_raw']} (as published)" if letter["letter_issue_date_raw"] else nr)],
        ["Posted by FDA", posted or (f"{letter['posted_date_raw']} (as published)" if letter["posted_date_raw"] else nr)],
        ["Response letter", response_date or letter["response_letter"] or nr],
        ["Closeout letter", closeout_date or letter["closeout_letter"] or nr],
        ["FEI number", "Not recorded (FDA's warning-letter table does not publish it)"],
        ["Letter page", letter["url"]],
    ]
    year = posted[:4] if posted else None
    filters = {
        "_listing": ["yes"],
        "date": posted,
        "sort_date": posted,
        "posted_date": posted,
        "letter_issue_date": issued,
        "year": [year] if year else [],
        "issuing_office": [letter["issuing_office"]] if letter["issuing_office"] else [],
        "firm_norm": norm or None,
        "closeout": ["yes" if letter["closeout_letter"] else "no"],
        "letter_path": letter["path"],
    }
    item = {
        "id": rid, "title": title, "subtitle": subtitle, "cells": cells,
        "badges": [b for b in ("Closeout letter" if letter["closeout_letter"] else None,
                                "Response letter" if letter["response_letter"] else None) if b],
        "links": links,
        "native_id": letter["slug"],
        "group": "warning_letters",
        "dataset": "fda_warning_letters_index",
        "firm": letter["company_name"],
        "firm_norm": norm or None,
        "firm_id": ("firm:" + norm.lower().replace(" ", "-")) if norm else None,
        "dates": {"posted_date": posted, "letter_issue_date": issued, "response_letter_date": response_date, "closeout_letter_date": closeout_date},
        "sort_date": posted,
        "published_at": posted,
        "status": None,
        "classification": None,
        "product_code": None,
        "snippet": letter["subject"] or "",
        "letter": {k: v for k, v in letter.items() if k != "slug"},
    }
    text = " ".join(x for x in (letter["company_name"], letter["subject"], letter["issuing_office"], issued, posted) if x)
    return {
        "dataset": DATASET,
        "id": rid,
        "category": CATEGORY,
        "state": "",
        "title": title,
        "source_url": letter["url"],
        "item": item,
        "detail": {"id": rid, "title": title, "subtitle": subtitle, "facts": facts, "links": links,
                   "qualification": SHORT_QUALIFICATION,
                   "provenance": {"source_url": letter["url"], "index": wp.FDA_WARNINGS, "captured": captured}},
        "text": text,
        "filters": filters,
    }


def summary(rows, *, captured, table_total, passes):
    years, offices = {}, {}
    for r in rows:
        y = (r["item"]["dates"]["posted_date"] or "")[:4] or "Not recorded"
        years[y] = years.get(y, 0) + 1
        o = r["item"]["letter"]["issuing_office"] or "Not recorded"
        offices[o] = offices.get(o, 0) + 1
    posted = sorted(r["item"]["dates"]["posted_date"] for r in rows if r["item"]["dates"]["posted_date"])
    return {
        "group": "warning_letters",
        "grain": "one record per warning-letter page listed in FDA's warning-letter table (FDA.gov URL path)",
        "publisher": "U.S. Food and Drug Administration (FDA.gov)",
        "source_url": wp.FDA_WARNINGS,
        "captured": captured,
        "records": len(rows),
        "table_total": table_total,
        "read_passes": passes,
        "posted_from": posted[0] if posted else None,
        "posted_to": posted[-1] if posted else None,
        "by_posted_year": dict(sorted(years.items())),
        "issuing_offices": len(offices),
        "with_closeout": sum(1 for r in rows if r["item"]["letter"]["closeout_letter"]),
        "with_response": sum(1 for r in rows if r["item"]["letter"]["response_letter"]),
        "fei": "FDA's warning-letter table does not publish FEI numbers; none is recorded.",
        "coverage": "FDA's current warning-letter table; it lists letters posted from "
                    f"{posted[0] if posted else 'Not recorded'}. Earlier letters are not in this table.",
        "partial_period": f"{captured[:4]} is a partial year (captured {captured[:10]}).",
        "source_url_rule": "The letter's own FDA.gov page.",
        "replaces_sample": "agency_safety_fda_warning_letters held a 1,000-row export sample; this index lists every letter in FDA's table.",
        "license": "U.S. Government work (public domain)",
        "qualification": QUALIFICATION,
    }
