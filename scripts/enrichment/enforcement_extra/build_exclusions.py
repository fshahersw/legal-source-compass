"""Build sam_exclusions (SAM.gov public exclusions extract) and oig_leie_exclusions (HHS-OIG LEIE).

Inputs (unchanged raw files, see private/acq/enforcement_extra/_manifest.jsonl):
  sam/SAM_Exclusions_Public_Extract_V2_<YYDDD>.ZIP   newest daily extract downloaded by acquire.py sam
  leie/UPDATED.csv.gz                                 LEIE full file (stored gzip-compressed, bytes unchanged inside)
  private/build/enforcement_extra/lookups/company_sec_profiles.json   (read-only corpus lookup)

One record per published row. Names exactly as published; no street address, ZIP code or date of birth.
Company links (/companies/<CIK>) only on a unique exact normalised-name match (exclusions.company_key).

  python3 -I -B build_exclusions.py [sam|leie]   (default: both)
"""
from __future__ import annotations

import collections
import csv
import glob
import gzip
import io
import json
import os
import sys
import zipfile

from common import ACQ, LOOKUPS, NOT_RECORDED, compact, latest_manifest, write_build
from exclusions import (
    LEIE_AUTHORITIES,
    LEIE_AUTHORITIES_URL,
    LEIE_URL,
    SAM_DATA_PAGE,
    SAM_RECORD_URL,
    company_index,
    leie_key,
    leie_record_fields,
    match_company,
    sam_record_fields,
)

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import corpus_writer as writer  # noqa: E402

LEIE_FILE_DATE = "2026-10-09"  # "Last Update" on OIG's LEIE downloads page and the file's Last-Modified header

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands", "GU": "Guam", "AS": "American Samoa",
    "MP": "Northern Mariana Islands",
}


def companies():
    with open(os.path.join(LOOKUPS, "company_sec_profiles.json"), encoding="utf-8") as f:
        return company_index(json.load(f)["rows"])


def place_link(usps: str) -> list[dict]:
    return [{"url": f"/places/{usps}", "label": f"{STATE_NAMES[usps]} place profile"}] if usps in STATE_NAMES else []


def year_of(date: str | None) -> str:
    return date[:4] if date else NOT_RECORDED


def lean_record(dataset, rid, title, source_url, cells, detail_fields, text, filters, subtitle, links, state):
    """corpus_writer.record shape with the facts carried as named detail fields instead of [label, value] pairs."""
    row = writer.record(dataset, rid, title, source_url=source_url, cells=cells, facts=[], text=text,
                        filters=filters, subtitle=subtitle, links=links, state=state)
    row["detail"] = {"id": rid, "title": title, "subtitle": subtitle, **detail_fields, "links": list(links)}
    return row


ABRIDGE_OVER = 200
ABRIDGE_KEEP = 160
ABRIDGED_MARK = " … [abridged; full text on the SAM.gov record]"


def abridge(text: str) -> tuple[str, bool]:
    """Comments longer than 200 characters keep their first 160 characters (cut at a word boundary) plus an explicit
    marker; the full text stays on the record's SAM.gov page (the row's source_url)."""
    if len(text) <= ABRIDGE_OVER:
        return text, False
    cut = text[:ABRIDGE_KEEP]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:") + ABRIDGED_MARK, True


# ------------------------------------------------------------------------------------------------ SAM
def sam_extract() -> tuple[str, dict]:
    paths = sorted(glob.glob(os.path.join(ACQ, "sam", "SAM_Exclusions_Public_Extract_V2_*.ZIP")))
    if not paths:
        raise SystemExit("no SAM extract; run acquire.py sam")
    path = paths[-1]
    entry = latest_manifest("acq/enforcement_extra/sam/" + os.path.basename(path))
    if not entry:
        raise SystemExit(f"{path} is not in the manifest")
    return path, entry


def iter_sam(path: str):
    with zipfile.ZipFile(path) as z:
        members = [i for i in z.infolist() if i.filename.upper().endswith(".CSV")]
        if len(members) != 1:
            raise SystemExit(f"expected one CSV in {path}, found {[m.filename for m in members]}")
        with z.open(members[0]) as raw:
            yield members[0].filename, None
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline="")):
                yield None, row


def build_sam() -> dict:
    path, entry = sam_extract()
    index = companies()
    code = os.path.basename(path).split("_")[-1].split(".")[0]
    extract_label = f"SAM.gov exclusions extract {code}"
    abridged = withheld = far_future = city_zip = 0
    rows, skipped = [], collections.Counter()
    stats = {k: collections.Counter() for k in ("classification", "agency", "type", "program", "active_year", "state", "country")}
    match_stats = collections.Counter()
    matched = []
    prefix_withheld = 0
    member = None
    source_rows = 0
    for name, raw in iter_sam(path):
        if name:
            member = name
            continue
        source_rows += 1
        f = sam_record_fields(raw)
        if not f:
            skipped["no SAM Number or no name"] += 1
            continue
        prefix_withheld += f["prefix_withheld"]
        for k, v in (("classification", f["classification"]), ("agency", f["agency"] or NOT_RECORDED), ("type", f["type"]),
                     ("program", f["program"]), ("active_year", year_of(f["active"])), ("state", f["usps"] or "Outside U.S. / not recorded"),
                     ("country", f["country"] or NOT_RECORDED)):
            stats[k][v] += 1
        # The SAM.gov record page is the row's source_url; links carry only in-app cross-references.
        links = place_link(f["usps"])
        cik = None
        if f["classification"] != "Individual":
            cik, outcome = match_company(f["name"], index)
            match_stats[outcome] += 1
            if cik:
                links.append({"url": f"/companies/{cik}", "label": "Company profile (exact name match)"})
                matched.append({"sam_number": f["sam_number"], "name": f["name"], "cik": cik})
        state_text = f["usps"] or f["state_province"]
        place = ", ".join(p for p in (f["city"], state_text, f["country"]) if p)
        cells = compact({
            "classification": f["classification"], "agency": f["agency"], "type": f["type"],
            "active": f["active"], "termination": f["termination"], "place": place, "state": f["usps"],
            "uei": f["uei"], "cage": f["cage"], "npi": f["npi"], "company_cik": cik,
        })
        comments, was_abridged = abridge(f["comments"])
        abridged += was_abridged
        withheld += f["comment_withheld"]
        city_zip += f["city_zip_removed"]
        if f["termination"] not in (None, "Indefinite") and f["termination"] > "2100":
            far_future += 1
        # Facts as named detail fields (the entity view labels them from the key; None shows as not recorded).
        # This keeps 169k rows small enough to publish and read back on a memory-limited machine.
        detail = {
            "classification": f["classification"] or None,
            "program": f["program"] or None,
            "excluding_agency": f["agency"] or None,
            "exclusion_type": f["type"] or None,
            "active_date": f["active"],
            "termination_date": f["termination"],
            "place": place or None,
            **compact({
                "ct_code": f["ct_code"], "unique_entity_id": f["uei"], "cage_code": f["cage"],
                "national_provider_identifier": f["npi"], "cross_reference": f["xref"], "comments": comments,
            }),
            "source": extract_label,
        }
        filters = {
            "classification": [f["classification"]] if f["classification"] else [],
            "agency": [f["agency"]] if f["agency"] else [],
            "type": [f["type"]] if f["type"] else [],
        }
        if f["usps"]:
            filters["state"] = [f["usps"]]
        if cik:
            filters["company"] = [cik]
        filters = {k: v for k, v in filters.items() if v}
        subtitle = " · ".join(p for p in (f["classification"], f["agency"] or "Agency not recorded") if p)
        text = " ".join(p for p in (f["xref"], f["city"], state_text, f["uei"], f["cage"], f["npi"]) if p)
        rows.append(lean_record(
            "sam_exclusions", f"sam:{f['sam_number']}", f["name"], SAM_RECORD_URL.format(f["sam_number"]),
            cells, detail, text, filters, subtitle, links, f["usps"],
        ))
    rows.sort(key=lambda r: (r["title"].lower(), r["id"]))
    top = lambda c, n=60: [{"value": k, "records": v} for k, v in c.most_common(n)]  # noqa: E731
    summary = {
        "source": {
            "publisher": "U.S. General Services Administration, System for Award Management (SAM.gov)",
            "file": os.path.basename(path), "member": member, "url": entry["url"], "data_page": SAM_DATA_PAGE,
            "sha256": entry["sha256"], "bytes": entry["bytes"], "retrieved_at": entry["retrieved_at"],
            "terms": "SAM.gov public extract, downloadable without login (privacy=Public); federal government data.",
        },
        "records": len(rows), "source_rows": source_rows, "skipped": dict(skipped),
        "by_classification": top(stats["classification"]), "by_agency": top(stats["agency"]),
        "by_type": top(stats["type"]), "by_program": top(stats["program"]),
        "by_active_year": sorted(({"value": k, "records": v} for k, v in stats["active_year"].items()), key=lambda x: x["value"]),
        "by_state": top(stats["state"], 80), "by_country": top(stats["country"], 30),
        "company_links": {"method": "exact equality of exclusions.company_key (lowercase; characters other than letters, digits and & to spaces; whitespace collapsed) between a non-individual SAM name and a company_sec_profiles title; link only when exactly one profile has the key",
                          "candidates": sum(match_stats.values()), "matched": match_stats["matched"], "ambiguous": match_stats["ambiguous"],
                          "unmatched": match_stats["none"], "matches": matched},
        "notes": [
            "The public extract lists active exclusions only (every row has Record Status 'Active').",
            "Individual names are Prefix, First, Middle, Last and Suffix as published; a prefix containing a digit is withheld (not a name prefix): "
            f"{prefix_withheld} records.",
            "Street addresses and ZIP codes are not carried; city, state/province and country are shown as published.",
            "Each record's source_url is its SAM.gov exclusion page (https://sam.gov/exclusion/<SAM record>/view), the authoritative current view.",
            f"Additional comments longer than {ABRIDGE_OVER} characters (mostly agency boilerplate) keep their first {ABRIDGE_KEEP} characters with an explicit "
            f"'[abridged; full text on the SAM.gov record]' marker: {abridged} records.",
            f"For individuals, a comment that repeats the person's own street address or ZIP code is withheld (full text on the SAM.gov record): {withheld} records. "
            "Facility addresses in firms' comments (facility-specific EPA exclusions) are shown as published.",
            f"Where an individual's City field also holds a ZIP code (e.g. 'HONOLULU, HI 96819'), the ZIP code is removed: {city_zip} records. "
            "An all-zero NPI ('0000000000') is treated as not recorded.",
            f"Termination dates are shown as published, including {far_future} dates later than 2100 (for example 2220-09-17).",
        ],
        "abridged_comments": abridged,
        "withheld_comments": withheld,
        "individual_city_zip_removed": city_zip,
        "termination_dates_after_2100": far_future,
    }
    listing_block = writer.listing(
        [("classification", "Classification"), ("agency", "Agency"), ("type", "Exclusion type"), ("active", "Active"), ("termination", "Termination"), ("place", "Place")],
        [
            ("classification", "Classification", {k: k for k, _ in stats["classification"].most_common()}),
            ("program", "Program", {k: k for k, _ in stats["program"].most_common()}),
            ("type", "Exclusion type", {k: k for k, _ in stats["type"].most_common()}),
            ("agency", "Excluding agency", {k: k for k, _ in stats["agency"].most_common(40) if k != NOT_RECORDED}),
        ],
    )
    out = write_build("sam_exclusions", "SAM.gov exclusions (debarments, suspensions and reciprocal exclusions)", rows, listing_block, summary,
                      [{"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]}])
    print(json.dumps({"dataset": "sam_exclusions", "records": len(rows), "file": out, "companies": dict(match_stats), "skipped": dict(skipped)}))
    return summary


# ------------------------------------------------------------------------------------------------ LEIE
def build_leie() -> dict:
    path = os.path.join(ACQ, "leie", "UPDATED.csv.gz")
    entry = latest_manifest("acq/enforcement_extra/leie/UPDATED.csv.gz")
    if not entry:
        raise SystemExit("LEIE file is not in the manifest; run acquire.py leie")
    index = companies()
    rows, seen, skipped = [], collections.Counter(), collections.Counter()
    stats = {k: collections.Counter() for k in ("code", "general", "state", "year", "kind")}
    match_stats, matched = collections.Counter(), []
    source_rows = 0
    unknown_codes = collections.Counter()
    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        for raw in csv.DictReader(fh):
            source_rows += 1
            f = leie_record_fields(raw)
            if not f:
                skipped["no name"] += 1
                continue
            key = leie_key(f)
            seen[key] += 1
            rid = f"leie:{key}" if seen[key] == 1 else f"leie:{key}-{seen[key]}"
            if not f["ssa_section"]:
                unknown_codes[f["code"] or NOT_RECORDED] += 1
            for k, v in (("code", f["code"] or NOT_RECORDED), ("general", f["general"] or NOT_RECORDED), ("state", f["usps"] or NOT_RECORDED),
                         ("year", year_of(f["excluded"])), ("kind", f["kind"])):
                stats[k][v] += 1
            links = place_link(f["usps"])
            cik = None
            if f["business"]:
                cik, outcome = match_company(f["business"], index)
                match_stats[outcome] += 1
                if cik:
                    links.append({"url": f"/companies/{cik}", "label": "Company profile (exact name match)"})
                    matched.append({"id": rid, "business": f["business"], "cik": cik})
            authority = f"Social Security Act §{f['ssa_section']} ({f['usc']})" if f["ssa_section"] else None
            place = ", ".join(p for p in (f["city"], f["state"]) if p)
            cells = compact({
                "kind": f["kind"], "business": f["business"], "general": f["general"], "specialty": f["specialty"],
                "place": place, "state": f["usps"], "code": f["code"], "excluded": f["excluded"],
                "reinstated": f["reinstated"], "waiver": f["waiver"], "waiver_state": f["waiver_state"],
                "npi": f["npi"], "company_cik": cik,
            })
            detail = {
                "kind": f["kind"],
                "general_category": f["general"] or None,
                "specialty": f["specialty"] or None,
                "place": place or None,
                "exclusion_type_code": f["code"] or None,
                "exclusion_authority": authority or "Not described in OIG's exclusion-authorities table; code shown as published",
                "exclusion_date": f["excluded"],
                **compact({
                    "business_name": f["business"], "reinstatement_date": f["reinstated"], "waiver_date": f["waiver"],
                    "waiver_state": f["waiver_state"], "national_provider_identifier": f["npi"], "upin": f["upin"],
                }),
                "source": f"HHS-OIG LEIE UPDATED.csv (last update {LEIE_FILE_DATE})",
            }
            filters = {"kind": [f["kind"]]}
            if f["code"]:
                filters["code"] = [f["code"]]
            if f["general"]:
                filters["general"] = [f["general"]]
            if f["usps"]:
                filters["state"] = [f["usps"]]
            if cik:
                filters["company"] = [cik]
            subtitle = " · ".join(p for p in (f["general"], f"§{f['ssa_section']}" if f["ssa_section"] else f["code"]) if p)
            text = " ".join(p for p in (f["business"], f["specialty"], f["city"], f["state"], f["npi"]) if p)
            rows.append(lean_record(
                "oig_leie_exclusions", rid, f["name"], LEIE_URL, cells, detail, text, filters, subtitle, links, f["usps"],
            ))
    rows.sort(key=lambda r: (r["title"].lower(), r["id"]))
    top = lambda c, n=60: [{"value": k, "records": v} for k, v in c.most_common(n)]  # noqa: E731
    summary = {
        "source": {
            "publisher": "U.S. Department of Health and Human Services, Office of Inspector General",
            "file": "UPDATED.csv", "url": LEIE_URL, "data_page": "https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/",
            "authorities_page": LEIE_AUTHORITIES_URL, "sha256": entry["sha256"], "bytes": entry["bytes"], "retrieved_at": entry["retrieved_at"],
            "terms": "U.S. government work published by HHS-OIG for public download.",
        },
        "records": len(rows), "source_rows": source_rows, "skipped": dict(skipped),
        "duplicate_published_rows": sum(n - 1 for n in seen.values() if n > 1),
        "by_code": top(stats["code"]), "by_general": top(stats["general"]), "by_state": top(stats["state"], 80),
        "by_kind": top(stats["kind"]),
        "by_exclusion_year": sorted(({"value": k, "records": v} for k, v in stats["year"].items()), key=lambda x: x["value"]),
        "codes_without_official_description": top(unknown_codes),
        "authorities": {k: {"ssa": v[0], "usc": f"42 U.S.C. {v[1]}", "kind": v[2], "text": v[3]} for k, v in sorted(LEIE_AUTHORITIES.items())},
        "company_links": {"method": "exact equality of exclusions.company_key between BUSNAME and a company_sec_profiles title; link only when exactly one profile has the key",
                          "candidates": sum(match_stats.values()), "matched": match_stats["matched"], "ambiguous": match_stats["ambiguous"],
                          "unmatched": match_stats["none"], "matches": matched},
        "notes": [
            "UPDATED.csv lists current exclusions; individuals are shown as 'LASTNAME, FIRSTNAME MIDNAME' exactly as published.",
            "Dates of birth, street addresses and ZIP codes in the file are not carried into any record.",
            "Exclusion authority descriptions are quoted from OIG's exclusion-authorities table; 1128(b)(1) covers both (A) and (B) because the file's code does not say which.",
            "Record ids are a hash of the published fields (no person identifiers are hashed beyond what is shown).",
        ],
    }
    listing_block = writer.listing(
        [("kind", "Kind"), ("general", "General category"), ("specialty", "Specialty"), ("code", "Exclusion type"), ("excluded", "Excluded"), ("place", "Place")],
        [
            ("kind", "Kind", {"Individual": "Individual", "Entity": "Entity"}),
            ("code", "Exclusion type", {k: k for k, _ in stats["code"].most_common() if k != NOT_RECORDED}),
            ("general", "General category", {k: k for k, _ in stats["general"].most_common(40) if k != NOT_RECORDED}),
        ],
    )
    out = write_build("oig_leie_exclusions", "HHS-OIG List of Excluded Individuals/Entities (LEIE)", rows, listing_block, summary,
                      [{"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]}])
    print(json.dumps({"dataset": "oig_leie_exclusions", "records": len(rows), "file": out, "companies": dict(match_stats),
                      "duplicates": summary["duplicate_published_rows"], "unknown_codes": dict(unknown_codes)}))
    return summary


if __name__ == "__main__":
    which = sys.argv[1:] or ["sam", "leie"]
    if "sam" in which:
        build_sam()
    if "leie" in which:
        build_leie()
