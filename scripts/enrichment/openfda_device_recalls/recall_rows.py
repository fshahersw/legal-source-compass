"""Pure shaping of openFDA device recall records into corpus rows (no I/O). Tested by test_device_recalls.py.

One row per FDA product recall number (product_res_number, e.g. Z-0129-2027), the same identifier the device
enforcement dataset stores as recall_number. Exact keys are kept as published so other datasets join on equality
only: product_code (device classification, MAUDE subjects, PMA), k_numbers (510(k)), pma_numbers (PMA),
res_event_number (FDA recall event = enforcement event_id), cfres_id (FDA Medical Device Recalls database record)
and firm_fei_number. Nothing is matched by name.

Not published from the source record: street address, postal code, contact block (additional_info_contact),
code_info (lot and serial lists), the firm's action text, and the openFDA harmonized k_number / registration /
FEI lists (those describe every device under the product code, not this recall).
"""
import re
import urllib.parse

DATASET = "agency_safety_openfda_device_recalls"
LABEL = "FDA medical device recalls (openFDA)"
CATEGORY = "agency_safety"
API = "https://api.fda.gov/device/recall.json"
CFRES = "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id={}"
FIELD_REFERENCE = "https://open.fda.gov/apis/device/recall/searchable-fields/"
LICENSE = "https://open.fda.gov/license/"
TEXT_CAP = 4000
SNIPPET = 240
DATE_KEYS = ("event_date_initiated", "event_date_created", "event_date_posted", "event_date_terminated")
DATE_LABELS = {
    "event_date_initiated": "Recall initiated (firm)",
    "event_date_created": "Recall record created",
    "event_date_posted": "Posted by FDA",
    "event_date_terminated": "Terminated by FDA",
}
LONG_TEXT = ("product_description", "reason_for_recall", "distribution_pattern", "truncated")
TEXT_INDEX_CAP = 1200
HARMONIZED = ("device_name", "device_class", "medical_specialty_description", "regulation_number")
QUALIFICATION = (
    "FDA Medical Device Recalls records as published in the openFDA device/recall bulk export. One record per product "
    "recall number; several products can share one recall event (res_event_number). event_date_initiated is the date "
    "the firm began the recall, which can precede any public notice; event_date_posted is the date FDA posted it. "
    "root_cause_description is FDA's cause category, not a finding of defect, injury or liability. Device name, class, "
    "specialty and regulation number are openFDA's harmonized fields for the product code. openFDA data: public "
    "domain (CC0) per https://open.fda.gov/license/; FDA says to assume all results are unvalidated and not to rely "
    "on openFDA for medical-care decisions."
)

SHORT_QUALIFICATION = (
    "FDA device recall record as published by openFDA (CC0). The cause category is FDA's, not a defect or injury "
    "finding; the initiation date is the firm's and can precede public notice."
)

_PMA_BASE = re.compile(r"^([PN][0-9]{4,6})")
PRODUCT_CODE = re.compile(r"^[A-Z]{3}$")


def clean(value):
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def capped(value, cap=TEXT_CAP):
    text = clean(value)
    if text is None:
        return None, False
    return (text[:cap], True) if len(text) > cap else (text, False)


FIRST_YEAR = 1970  # earlier years in the export are keying errors such as 0010-08-17; kept raw, never corrected


def iso_date(value):
    """openFDA device/recall dates are YYYY-MM-DD; anything else, or a year before FIRST_YEAR, is not used as a date
    (the published value stays in the *_raw field; it is never corrected or guessed)."""
    text = clean(value)
    if text and re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        year, month, day = int(text[:4]), int(text[5:7]), int(text[8:10])
        if year >= FIRST_YEAR and 1 <= month <= 12 and 1 <= day <= 31:
            return text
    return None


def firm_norm(firm):
    """Same rule as the enforcement datasets (src/lib/ingest/sources/openfdaEnforcement.ts firmNorm)."""
    text = (firm or "").replace("&", " and ")
    text = re.sub(r"['’]", "", text)
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    return re.sub(r" +", " ", text).strip().upper()


def firm_id(norm):
    return "firm:" + norm.lower().replace(" ", "-")


def str_list(value):
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = clean(item)
        if text and text not in out:
            out.append(text)
    return out


def pma_bases(pma_numbers):
    """The PMA number part of each published value ('P970004/S9' -> 'P970004'), for exact joins to the PMA dataset."""
    out = []
    for value in pma_numbers:
        m = _PMA_BASE.match(value)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def source_url(product_res_number):
    """The openFDA query for this record's own product recall number (exact, one result)."""
    return f"{API}?search=product_res_number:%22{urllib.parse.quote(product_res_number, safe='')}%22"


def cfres_url(cfres_id):
    text = clean(cfres_id)
    return CFRES.format(text) if text and text.isdigit() else None


def harmonized(openfda):
    if not isinstance(openfda, dict):
        return {key: None for key in HARMONIZED}
    out = {}
    for key in HARMONIZED:
        value = openfda.get(key)
        out[key] = clean(value[0] if isinstance(value, list) and len(value) == 1 else value if isinstance(value, str) else None)
    return out


def shape(raw):
    """One published record -> the fields kept, under their openFDA names."""
    number = clean(raw.get("product_res_number"))
    if not number:
        raise ValueError("record has no product_res_number")
    description, description_cut = capped(raw.get("product_description"))
    reason, reason_cut = capped(raw.get("reason_for_recall"))
    distribution, distribution_cut = capped(raw.get("distribution_pattern"), 1500)
    k_numbers = str_list(raw.get("k_numbers"))
    pma_numbers = str_list(raw.get("pma_numbers"))
    return {
        "product_res_number": number,
        "res_event_number": clean(raw.get("res_event_number")),
        "cfres_id": clean(raw.get("cfres_id")),
        "product_code": clean(raw.get("product_code")),
        "k_numbers": k_numbers,
        "pma_numbers": pma_numbers,
        "pma_number_bases": pma_bases(pma_numbers),
        "recall_status": clean(raw.get("recall_status")),
        "root_cause_description": clean(raw.get("root_cause_description")),
        "recalling_firm": clean(raw.get("recalling_firm")),
        "firm_fei_number": clean(raw.get("firm_fei_number")),
        "firm_state": clean(raw.get("state")),
        "firm_country": clean(raw.get("country")),
        "product_description": description,
        "reason_for_recall": reason,
        "product_quantity": clean(raw.get("product_quantity")),
        "distribution_pattern": distribution,
        "truncated": [k for k, cut in (("product_description", description_cut), ("reason_for_recall", reason_cut), ("distribution_pattern", distribution_cut)) if cut],
        **{key: iso_date(raw.get(key)) for key in DATE_KEYS},
        **{f"{key}_raw": clean(raw.get(key)) for key in DATE_KEYS},
        "harmonized": harmonized(raw.get("openfda")),
    }


def _title(rec):
    first = (rec["product_description"] or "").split(";")[0].strip()
    if first and len(first) > 160:
        first = first[:157].rstrip() + "..."
    return first or f"FDA device recall {rec['product_res_number']}"


def facts(rec):
    nr = "Not recorded"
    h = rec["harmonized"]
    pairs = [
        ("Product recall number", rec["product_res_number"]),
        ("Recall event", rec["res_event_number"]),
        ("FDA recall database record", rec["cfres_id"]),
        ("Recall status (FDA)", rec["recall_status"]),
        ("Cause category (FDA)", rec["root_cause_description"]),
        ("Product code", rec["product_code"]),
        ("510(k) numbers", ", ".join(rec["k_numbers"]) or None),
        ("PMA numbers", ", ".join(rec["pma_numbers"]) or None),
        ("Device name (openFDA, by product code)", h["device_name"]),
        ("Device class (openFDA, by product code)", h["device_class"]),
        ("Medical specialty (openFDA, by product code)", h["medical_specialty_description"]),
        ("Regulation number (openFDA, by product code)", h["regulation_number"]),
        ("Recalling firm", rec["recalling_firm"]),
        ("Firm FEI number", rec["firm_fei_number"]),
        ("Firm state / country", " / ".join(x for x in (rec["firm_state"], rec["firm_country"]) if x) or None),
        *[(DATE_LABELS[k], rec[k] or (f"{rec[k + '_raw']} (as published; not a usable date)" if rec[k + "_raw"] else None)) for k in DATE_KEYS],
        ("Product quantity", rec["product_quantity"]),
        ("Distribution", rec["distribution_pattern"]),
        ("Reason for recall", rec["reason_for_recall"]),
        ("Product description", rec["product_description"]),
    ]
    if rec["truncated"]:
        pairs.append(("Shortened here", f"{', '.join(rec['truncated'])} cut at {TEXT_CAP} characters; full text at the source URL"))
    return [[label, nr if value in (None, "") else str(value)] for label, value in pairs]


def row(raw, *, bulk_url, export_date):
    """The corpus row (corpus_writer.record shape plus detail qualification and provenance)."""
    rec = shape(raw)
    rid = f"openfda:device/recall:{rec['product_res_number']}"
    title = _title(rec)
    norm = firm_norm(rec["recalling_firm"] or "")
    fid = firm_id(norm) if norm else None
    dates = {key: rec[key] for key in DATE_KEYS}
    initiated = rec["event_date_initiated"]
    url = source_url(rec["product_res_number"])
    links = [{"url": url, "label": "openFDA record (query by product recall number)"}]
    if cfres_url(rec["cfres_id"]):
        links.append({"url": cfres_url(rec["cfres_id"]), "label": "FDA Medical Device Recalls database record"})
    links.append({"url": bulk_url, "label": f"openFDA device recall bulk export ({export_date})"})
    subtitle = " · ".join(x for x in (
        rec["product_res_number"],
        f"event {rec['res_event_number']}" if rec["res_event_number"] else None,
        f"initiated {initiated}" if initiated else "initiation date not recorded",
        rec["recall_status"],
    ) if x)
    cells = {
        "product_res_number": rec["product_res_number"],
        "res_event_number": rec["res_event_number"],
        "product_code": rec["product_code"],
        "k_numbers": ", ".join(rec["k_numbers"]) or None,
        "pma_numbers": ", ".join(rec["pma_numbers"]) or None,
        "recall_status": rec["recall_status"],
        "root_cause_description": rec["root_cause_description"],
        "recalling_firm": rec["recalling_firm"],
        "event_date_initiated": initiated,
        "event_date_posted": rec["event_date_posted"],
        "event_date_terminated": rec["event_date_terminated"],
        "device_class": rec["harmonized"]["device_class"],
    }
    item_extra = {
        "native_id": rec["product_res_number"],
        "group": "device_recalls",
        "dataset": "openfda_device_recall",
        "firm": rec["recalling_firm"],
        "firm_norm": norm or None,
        "firm_id": fid,
        "dates": dates,
        "sort_date": initiated,
        "published_at": rec["event_date_posted"],
        "status": rec["recall_status"],
        "classification": None,
        "product_code": rec["product_code"],
        "snippet": (rec["reason_for_recall"] or "")[:SNIPPET],
        # exact keys, dates and harmonized fields; the long texts live in detail.facts only
        "recall": {k: v for k, v in rec.items() if k not in LONG_TEXT},
    }
    year = initiated[:4] if initiated else None
    filters = {
        "recall_number": rec["product_res_number"],
        # join key: only codes in FDA's three-letter form; other published values ('--', '000') stay in cells
        "product_code": [rec["product_code"]] if rec["product_code"] and PRODUCT_CODE.match(rec["product_code"]) else [],
        "k_numbers": rec["k_numbers"],
        "pma_numbers": rec["pma_number_bases"],
        "recall_status": [rec["recall_status"].lower()] if rec["recall_status"] else [],
        "root_cause": [rec["root_cause_description"]] if rec["root_cause_description"] else [],
        "device_class": [rec["harmonized"]["device_class"]] if rec["harmonized"]["device_class"] else [],
        "firm_norm": norm or None,
        "firm_fei_number": rec["firm_fei_number"],
        "date": initiated,
        "sort_date": initiated,
        "year": [year] if year else [],
        "date_types": sorted(k for k in DATE_KEYS if rec[k]),
    }
    if rec["res_event_number"]:
        filters["event_id"] = rec["res_event_number"]
    if rec["cfres_id"]:
        filters["cfres_id"] = rec["cfres_id"]
    for key in DATE_KEYS:
        if rec[key]:
            filters[key] = rec[key]
    text = " ".join(x for x in (
        rec["product_res_number"], rec["res_event_number"], rec["product_code"], " ".join(rec["k_numbers"]),
        " ".join(rec["pma_numbers"]), rec["recalling_firm"], rec["firm_fei_number"], rec["root_cause_description"],
        rec["harmonized"]["device_name"], (rec["product_description"] or "")[:TEXT_INDEX_CAP],
        (rec["reason_for_recall"] or "")[:TEXT_INDEX_CAP],
    ) if x)
    out = {
        "dataset": DATASET,
        "id": rid,
        "category": CATEGORY,
        "state": rec["firm_state"] if rec["firm_country"] in (None, "United States") and rec["firm_state"] and len(rec["firm_state"]) == 2 else "",
        "title": title,
        "source_url": url,
        "item": {"id": rid, "title": title, "subtitle": subtitle, "cells": cells, "badges": [b for b in (rec["recall_status"], rec["root_cause_description"]) if b], "links": links, **item_extra},
        "detail": {
            "id": rid, "title": title, "subtitle": subtitle, "facts": facts(rec), "links": links,
            # the full qualification and licence sit once in the catalog summary
            "qualification": SHORT_QUALIFICATION,
            "provenance": {"source_url": url, "bulk_file": bulk_url, "export_date": export_date},
        },
        "text": text,
        "filters": {"_listing": ["yes"], **filters},
    }
    return out


def listing_columns():
    return [
        ("product_res_number", "Recall number"),
        ("event_date_initiated", "Initiated"),
        ("recalling_firm", "Firm"),
        ("product_code", "Product code"),
        ("device_class", "Class"),
        ("root_cause_description", "Cause category (FDA)"),
        ("recall_status", "Status"),
        ("k_numbers", "510(k)"),
        ("pma_numbers", "PMA"),
    ]


def summary(rows, *, export_date, bulk_url, sha256):
    """Catalog summary with exact counts from the rows (no estimate)."""
    years = {}
    statuses = {}
    keys = {"product_code": 0, "k_numbers": 0, "pma_numbers": 0, "cfres_id": 0, "firm_fei_number": 0}
    events = set()
    for r in rows:
        rec = r["item"]["recall"]
        y = (rec["event_date_initiated"] or "")[:4] or "Not recorded"
        years[y] = years.get(y, 0) + 1
        s = rec["recall_status"] or "Not recorded"
        statuses[s] = statuses.get(s, 0) + 1
        for k in keys:
            if rec[k]:
                keys[k] += 1
        if rec["res_event_number"]:
            events.add(rec["res_event_number"])
    initiated = sorted(r["item"]["recall"]["event_date_initiated"] for r in rows if r["item"]["recall"]["event_date_initiated"])
    return {
        "group": "device_recalls",
        "grain": "one record per FDA product recall number (product_res_number)",
        "publisher": "U.S. Food and Drug Administration (openFDA device/recall)",
        "source_url": "https://open.fda.gov/apis/device/recall/",
        "bulk_file": bulk_url,
        "bulk_sha256": sha256,
        "export_date": export_date,
        "records": len(rows),
        "recall_events": len(events),
        "initiated_from": initiated[0] if initiated else None,
        "initiated_to": initiated[-1] if initiated else None,
        "records_with": keys,
        "initiation_date_not_usable": sum(
            1 for r in rows if r["item"]["recall"]["event_date_initiated_raw"] and not r["item"]["recall"]["event_date_initiated"]
        ),
        "by_status": dict(sorted(statuses.items())),
        "by_initiation_year": dict(sorted(years.items())),
        "source_url_rule": "openFDA device/recall query by the record's own product_res_number; links add the FDA Medical Device Recalls database page (cfres_id) and the dated bulk file.",
        "join_keys": "Exact equality only: recall_number = device enforcement recall_number; event_id = enforcement detail.fields.event_id; product_code = device classification / MAUDE subject codes / PMA product_code; pma_numbers (PMA number part) = PMA pma_number; k_numbers = 510(k) numbers.",
        "partial_period": f"Recalls initiated in {export_date[:4]} are a partial year (export {export_date}).",
        "license": LICENSE,
        "field_reference": FIELD_REFERENCE,
        "qualification": QUALIFICATION,
    }
