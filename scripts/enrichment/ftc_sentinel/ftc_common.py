"""Shared helpers for the FTC builders: display formats, analytics formulas, exact-name matching, input manifest."""
import json
import os
import re
from decimal import Decimal

NOT_RECORDED = "Not recorded"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_sentinel")
BUILD = os.path.join(ROOT, "private", "build", "ftc_sentinel")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")


# --------------------------------------------------------------------------------------------------------------------
# Display formats. Every missing value renders as 'Not recorded', never as zero or an estimate.

def fmt_int(value):
    return NOT_RECORDED if value is None else f"{int(value):,}"


def fmt_usd(value):
    if value is None:
        return NOT_RECORDED
    if abs(value - round(value)) < 0.005:
        return f"${int(round(value)):,}"
    return f"${value:,.2f}"


def fmt_pct(value, digits=1):
    return NOT_RECORDED if value is None else f"{value:.{digits}f}%"


def fmt_pct_exact(value):
    """A published percentage shown exactly as its value (66.55 -> '66.55%', 93.0 -> '93%'): no second rounding."""
    if value is None:
        return NOT_RECORDED
    text = format(Decimal(repr(float(value))).normalize(), "f")
    return text + "%"


def fmt_signed_pct(value, digits=1):
    return NOT_RECORDED if value is None else f"{value:+.{digits}f}%"


def fmt_signed_int(value):
    return NOT_RECORDED if value is None else f"{int(value):+d}"


def fmt_rank(value):
    return NOT_RECORDED if value is None else str(int(value))


# --------------------------------------------------------------------------------------------------------------------
# /places routes. The app resolves /places/<USPS> only for the jurisdictions in src/lib/corpus/geo.ts (50 states and DC).

_GEO_DEFAULT = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"}


def routable_places(geo_path=None):
    """USPS codes /places/<code> can resolve: read from src/lib/corpus/geo.ts when present, else the 50 states + DC."""
    path = geo_path or os.path.join(ROOT, "src", "lib", "corpus", "geo.ts")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            found = set(re.findall(r'\["\d{2}",\s*"([A-Z]{2})",\s*"[^"]+"\]', handle.read()))
        return found or set(_GEO_DEFAULT)
    except OSError:
        return set(_GEO_DEFAULT)


def places_links(usps, name, routable=None):
    """The /places/<USPS> link for a jurisdiction the app can resolve; [] for Puerto Rico and anything else outside geo.ts."""
    ok = routable if routable is not None else routable_places()
    return [{"url": f"/places/{usps}", "label": f"{name} state page"}] if usps in ok else []


# --------------------------------------------------------------------------------------------------------------------
# Analytics. Each returns None when an input is missing; nothing is imputed.

def yoy_pct(current, previous):
    """Year-over-year change in percent: (current / previous - 1) * 100. None when previous is missing or zero."""
    if current is None or previous in (None, 0):
        return None
    return round((current / previous - 1) * 100, 2)


def cagr_pct(first, last, years):
    """Compound annual growth rate in percent: ((last / first) ** (1 / years) - 1) * 100. Needs first > 0, last > 0, years >= 1."""
    if first is None or last is None or first <= 0 or last <= 0 or not years or years < 1:
        return None
    return round(((last / first) ** (1 / years) - 1) * 100, 2)


def rank_change(previous_rank, current_rank):
    """Places gained toward rank 1: previous_rank - current_rank (positive = moved up). None for unranked entries."""
    if previous_rank is None or current_rank is None:
        return None
    return previous_rank - current_rank


def share_pct(part, total):
    """part / total * 100, rounded to 2 places."""
    if part is None or not total:
        return None
    return round(part / total * 100, 2)


def ratio(numerator, denominator, digits=2):
    if numerator is None or not denominator:
        return None
    return round(numerator / denominator, digits)


# --------------------------------------------------------------------------------------------------------------------
# Exact-name matching (company_sec_profiles titles, refund program pages)

def name_key(name):
    """Documented normalisation for exact matching: lower case, '&amp;' decoded, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", (name or "").replace("&amp;", "&").lower())


def unique_exact_matches(names, targets):
    """For each name, the target id when exactly one target has the same name_key; ambiguous and absent are reported.

    names: {name_id: name}; targets: {target_id: name}. Returns (matches, ambiguous, unmatched) where matches maps
    name_id -> target_id, ambiguous maps name_id -> [target_ids], unmatched is a list of name_ids.
    """
    by_key = {}
    for target_id, target_name in targets.items():
        key = name_key(target_name)
        if key:
            by_key.setdefault(key, []).append(target_id)
    matches, ambiguous, unmatched = {}, {}, []
    for name_id, name in names.items():
        hits = by_key.get(name_key(name), [])
        if len(hits) == 1:
            matches[name_id] = hits[0]
        elif len(hits) > 1:
            ambiguous[name_id] = sorted(hits)
        else:
            unmatched.append(name_id)
    return matches, ambiguous, unmatched


# --------------------------------------------------------------------------------------------------------------------
# Input manifest

def load_manifest(path=MANIFEST):
    entries = {}
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                entry = json.loads(line)
                entries[os.path.basename(entry["path"])] = entry
    return entries


def input_ref(entry):
    return {"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]}


# Firecrawl capture file -> official PDF file (both registered in the manifest under the same ftc.gov URL)
CAPTURE_TO_PDF = {
    "csn_databook_2017_pdf.json": "consumer_sentinel_data_book_2017.pdf",
    "csn_databook_2018_pdf.json": "consumer_sentinel_network_data_book_2018_0.pdf",
    "csn_databook_2019_pdf.json": "consumer_sentinel_network_data_book_2019.pdf",
    "csn_databook_2020_pdf.json": "csn_annual_data_book_2020.pdf",
    "csn_databook_2021_pdf.json": "CSN_Annual_Data_Book_2021_Final_PDF.pdf",
    "csn_databook_2022_pdf.json": "CSN-Data-Book-2022.pdf",
    "csn_databook_2023_pdf.json": "CSN-Annual-Data-Book-2023.pdf",
    "csn_databook_2024_pdf.json": "csn-annual-data-book-2024.pdf",
    "ftc_refunds_report_2022_pdf.json": "2022_FTC_REFUNDS_TO_CONSUMERS.pdf",
    "ftc_refunds_report_2023_pdf.json": "ftc-refunds-to-consumers-2023.pdf",
    "ftc_refunds_report_2024_pdf.json": "ftc-refunds-consumers-2024.pdf",
    "dnc_databook_fy2021_pdf.json": "dnc_data_book_2021.pdf",
    "dnc_databook_fy2022_pdf.json": "DNC-Data-Book-2022.pdf",
    "dnc_databook_fy2023_pdf.json": "Do-Not-Call-Data-Book-2023.pdf",
    "dnc_databook_fy2024_pdf.json": "DNC-Data-Book-2024.pdf",
    "dnc_databook_fy2025_pdf.json": "DNC-Data-Book-2025.pdf",
}


def official_pdf(manifest, capture_entry):
    """Manifest entry of the official PDF behind a Firecrawl capture (same ftc.gov URL), or None for HTML pages."""
    name = CAPTURE_TO_PDF.get(os.path.basename(capture_entry["path"]))
    if not name:
        return None
    pdf = manifest[name]
    if pdf["url"] != capture_entry["url"]:
        raise ValueError(f"{name}: URL differs from the capture's ({pdf['url']} vs {capture_entry['url']})")
    return pdf


def provenance(capture_entry, pdf_entry=None, **extra):
    """Row provenance. capture_sha256 is the hash of the Firecrawl tool-result JSON (an extraction of the PDF);
    official_pdf_sha256 is the hash of the PDF bytes as served by ftc.gov."""
    out = {"capture": capture_entry["path"], "capture_sha256": capture_entry["sha256"]}
    if pdf_entry:
        out.update({"official_pdf": pdf_entry["path"], "official_pdf_sha256": pdf_entry["sha256"]})
    out.update(extra)
    return out


def source_record(capture_entry, pdf_entry=None, **extra):
    """Summary 'sources' entry that says which hash is which."""
    out = {"url": capture_entry["url"], "capture_sha256": capture_entry["sha256"], "capture_retrieved": capture_entry["retrieved_at"],
           "capture_note": "SHA-256 of the page-fetching service's JSON response kept in private/acq (a text extraction of the page/PDF), not of the PDF itself"}
    if pdf_entry:
        out.update({"official_pdf_sha256": pdf_entry["sha256"], "official_pdf_bytes": pdf_entry["bytes"], "official_pdf_retrieved": pdf_entry["retrieved_at"],
                    "official_pdf_note": "SHA-256 of the official PDF bytes as served by ftc.gov (downloaded by the independent verifier, copied byte-identical)"})
    out.update(extra)
    return out


def pdf_inputs(*captures_and_pdfs):
    """input_ref list for captures and their official PDFs (entries may be None)."""
    refs = []
    for e in captures_and_pdfs:
        if e:
            refs.append(input_ref(e))
    return refs


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60] or "x"
