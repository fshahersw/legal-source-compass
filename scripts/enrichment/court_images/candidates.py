"""Photo leads from the owner's workbook, one per (court id, workbook row), with the exact-id name check applied.

The workbook is a lead list. Nothing here is trusted as a fact about an image: license, author and dimensions are
taken later from the image's origin (the Commons file page metadata). The workbook supplies only: which court id a row
names, the court name(s) the row gives for it, the building it calls the court's building, and which image file it
points at.
"""
import re
import urllib.parse

from namecheck import name_match
from workbook import split_ids

# Lower is preferred when several verified photos exist for one court.
SOURCE_RANK = {"Top Courts": 0, "Court Directory": 1, "Federal Offices HQ": 2, "Federal Offices": 3, "Buildings": 4}
QUALITY_RANK = {
    "Strong thumbnail candidate": 0,
    "Usable standard thumbnail": 1,
    "Higher resolution recommended": 2,
    "Alternate image recommended": 3,
    "Check image reuse terms": 4,
}
COUNTY_CANDIDATE = "Verify exact building match"


def split_names(value):
    return [n.strip() for n in re.split(r"\s*[|;]\s*", value or "") if n.strip()]


def commons_title(source_page, original_url):
    """'File:Name.jpg' for a Wikimedia Commons file, from its file page or its upload.wikimedia.org URL; else None."""
    for url in (source_page or "", original_url or ""):
        p = urllib.parse.urlsplit(url)
        if p.scheme != "https":
            continue
        if p.netloc == "commons.wikimedia.org" and p.path.startswith("/wiki/File:"):
            name = urllib.parse.unquote(p.path[len("/wiki/"):])
            return name.replace("_", " ")
        if p.netloc == "upload.wikimedia.org" and p.path.startswith("/wikipedia/commons/"):
            parts = p.path.split("/")
            # /wikipedia/commons/a/ab/Name.jpg  or  /wikipedia/commons/thumb/a/ab/Name.jpg/960px-Name.jpg
            if len(parts) >= 6 and parts[3] == "thumb":
                name = parts[6] if len(parts) > 6 else None
            else:
                name = parts[5] if len(parts) > 5 else None
            if name:
                return "File:" + urllib.parse.unquote(name).replace("_", " ")
    return None


def image_host(original_url):
    p = urllib.parse.urlsplit(original_url or "")
    return p.netloc or ""


def _lead(sheet, number, row, court_id, names, building, address, city, state, building_id, f):
    original = row.get(f["original"], "")
    page = row.get(f["page"], "")
    return {
        "court_id": court_id,
        "sheet": sheet,
        "row": number,
        "row_names": names,
        "building": building or "",
        "address": address or "",
        "city": city or "",
        "state": state or "",
        "building_id": building_id or "",
        "workbook_status": row.get("Thumbnail status", ""),
        "workbook_license": row.get(f["license"], ""),
        "workbook_rights": row.get(f["rights"], ""),
        "workbook_attribution": row.get(f["attribution"], ""),
        "original_url": original,
        "source_page": page,
        "host": image_host(original),
        "commons_title": commons_title(page, original),
    }


TOP = {"original": "Original image URL", "page": "Image source page", "license": "License / rights",
       "rights": "Rights status", "attribution": "Attribution / credit"}
DIRECTORY = {"original": "Original image URL", "page": "Image source page", "license": "Image license / rights",
             "rights": "Image rights status", "attribution": "Image attribution"}
OFFICES = DIRECTORY
BUILDINGS = {"original": "Original image URL", "page": "Image source page", "license": "License / rights statement",
             "rights": "Rights status", "attribution": "Attribution / credit"}


def collect(wb, spine, courts_db):
    """Returns (leads, unmatched). A lead has passed the exact id + name check; unmatched rows are listed with why."""
    leads, unmatched = [], []

    def check(sheet, number, court_id, names, label):
        if court_id not in spine:
            unmatched.append({"sheet": sheet, "row": number, "court_id": court_id, "names": names,
                              "reason": "court id not in court_spine", "label": label})
            return None
        how = name_match(court_id, names, spine, courts_db)
        if not how:
            unmatched.append({"sheet": sheet, "row": number, "court_id": court_id, "names": names,
                              "ours": spine[court_id]["title"], "reason": "court name differs from ours for this id",
                              "label": label})
        return how

    for number, row in wb.get("Top Courts", []):
        if not row.get("Original image URL"):
            continue
        cid = row.get("Court ID", "")
        names = [row.get("Court", "")]
        how = check("Top Courts", number, cid, names, row.get("Court", ""))
        if how:
            lead = _lead("Top Courts", number, row, cid, names, row.get("Representative building"),
                         row.get("Court address"), row.get("City"), row.get("State / territory"),
                         row.get("Building ID"), TOP)
            lead.update(rank_source=SOURCE_RANK["Top Courts"], name_check=how)
            leads.append(lead)

    for number, row in wb.get("Court Directory", []):
        if not row.get("Original image URL"):
            continue
        cid = row.get("Court ID", "")
        names = [row.get("Court / adjudicative organization", "")] + split_names(row.get("Other court names"))
        how = check("Court Directory", number, cid, names, names[0])
        if how:
            lead = _lead("Court Directory", number, row, cid, names, row.get("Representative building"),
                         row.get("Representative address"), row.get("Building city"), row.get("Building state"),
                         row.get("Representative building ID"), DIRECTORY)
            lead.update(rank_source=SOURCE_RANK["Court Directory"], name_check=how,
                        relation=row.get("Court-to-building relation", ""))
            leads.append(lead)

    for number, row in wb.get("Federal Offices", []):
        if not row.get("Original image URL") or not row.get("Linked court IDs"):
            continue
        if row.get("Entity type") not in ("Court location", "Court-related location"):
            continue
        names = [row.get("Office / court organization", "")]
        hq = row.get("Headquarters") == "Yes"
        for cid in split_ids(row.get("Linked court IDs")):
            how = check("Federal Offices", number, cid, names, row.get("Office / court location", ""))
            if not how:
                continue
            lead = _lead("Federal Offices", number, row, cid, names, row.get("Directory building name"),
                         row.get("Directory address"), row.get("City"), row.get("State"), row.get("Building ID"),
                         OFFICES)
            lead.update(rank_source=SOURCE_RANK["Federal Offices HQ" if hq else "Federal Offices"], name_check=how,
                        headquarters=hq, location_id=row.get("Location ID", ""),
                        official_location=row.get("Official location source", ""))
            leads.append(lead)

    for number, row in wb.get("Buildings", []):
        if not row.get("Original image URL") or not row.get("Linked court IDs"):
            continue
        if row.get("Photo match type") != "Source-linked building":
            continue
        names = split_names(row.get("Linked court names"))
        for cid in split_ids(row.get("Linked court IDs")):
            how = check("Buildings", number, cid, names, row.get("Building / site", ""))
            if not how:
                continue
            lead = _lead("Buildings", number, row, cid, names, row.get("Building / site"),
                         row.get("Street address"), row.get("City"), row.get("State"), row.get("Building ID"),
                         BUILDINGS)
            lead.update(rank_source=SOURCE_RANK["Buildings"], name_check=how)
            leads.append(lead)
    return leads, unmatched
