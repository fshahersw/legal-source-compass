"""Build court_images: one row per court with a building photo whose licence was verified at its origin.

Inputs (all local, read-only):
  private/acq/court_images/US_Courts_and_Public_Buildings_1.xlsx   the owner's workbook (leads only)
  private/acq/court_images/commons/*.json.gz + _manifest.jsonl     Commons file-page metadata (fetch_commons.py)
  private/build/court_images/lookups/court_spine.json              our court ids and names (live fingerprint checked)
  private/build/court_images/lookups/courts_db_names.json          Courts-DB names for the same ids

Outputs in private/build/court_images/: court_images.json (CONTRACT.md build file), exclusions.json, unmatched.json.

Rules: a court id is taken only when it exists in court_spine and a court name the workbook row gives for it equals
one of our names for that id (namecheck.py). Licence, author, credit, sizes and URLs come from the file's own page
metadata, never from the workbook. Kept licences: public domain, CC0, CC BY, CC BY-SA (any version). Images hosted
elsewhere are kept only when their source page states public domain or a kept licence; none of the non-Commons leads
does (see HOST_REASONS).
"""
import argparse
import gzip
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import corpus_writer as cw  # noqa: E402
from candidates import COUNTY_CANDIDATE, QUALITY_RANK, collect  # noqa: E402
from licenses import file_facts, load_responses, resolve, thumb_facts  # noqa: E402
from workbook import read_workbook  # noqa: E402

ROOT = Path("/home/user/legal-source-compass")
ACQ = ROOT / "private" / "acq" / "court_images"
BUILD = ROOT / "private" / "build" / "court_images"
WORKBOOK = ACQ / "US_Courts_and_Public_Buildings_1.xlsx"
DATASET = "court_images"
LABEL = "Court building photographs with verified licences (Wikimedia Commons file pages, October 2026)"
# Wikimedia's standard thumbnail widths only (hotlinks at other widths are refused); originals are never served.
DISPLAY_WIDTH = 960
MID_WIDTH = 500
THUMB_WIDTH = 330
TWO_X_WIDTH = 1920
# A photograph of an artwork at a courthouse is not a photograph of the building, and the artwork's own copyright is
# not covered by the photograph's licence. Matched on the file title only; it can only exclude.
ARTWORK = re.compile(r"(?i)\b(sculpture|statue|mural|relief|fresco|untitled)\b")

# Non-Commons hosts in the leads, with what their source pages state (checked 2026-10-24; see REPORT.md).
HOST_REASONS = {
    "uscountycourthouses.org": "reuse permission not established (county courthouse directory photo)",
    "www.fjc.gov": "rights not stated on the source page (courthouse page names a source only)",
    "www.gsa.gov": "rights not stated on the source page (GSA building page)",
    "tile.loc.gov": "no public-domain statement at the source ('No known restrictions on publication')",
}
LICENCE_LABEL = {"public domain": "Public domain", "cc0": "CC0", "cc by": "CC BY", "cc by-sa": "CC BY-SA",
                 "other": "Other licence (as recorded)"}
# The owner's visual registry (scripts/enrichment/visual_registry) is a second lead source, used only for courts the
# workbook leads above do not cover; its leads name an asset id instead of a sheet row.
REGISTRY_SHEET = "Visual registry"
SHEET_SLUG = {"Top Courts": "top_courts", "Court Directory": "court_directory", "Federal Offices": "federal_offices",
              "Buildings": "buildings", REGISTRY_SHEET: "visual_registry"}


def rendition_sizes(acq):
    """url -> latest measurement (measure_renditions.py); decoded sizes only, no image bytes are kept."""
    path = acq / "renditions" / "_manifest.jsonl"
    out = {}
    if path.exists():
        for line in open(path):
            entry = json.loads(line)
            if entry["url"] not in out or entry.get("status") == 200:
                out[entry["url"]] = entry
    return out


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def commons_inputs(acq):
    """Latest HTTP-200 manifest entry per stored response, each checked against the stored bytes."""
    latest = {}
    for line in open(acq / "commons" / "_manifest.jsonl"):
        entry = json.loads(line)
        if entry["status"] == 200:
            latest[entry["path"]] = entry
    for path, entry in latest.items():
        body = gzip.open(path).read()
        if hashlib.sha256(body).hexdigest() != entry["sha256"]:
            raise SystemExit(f"{path}: stored bytes do not match the manifest")
    return sorted(latest.values(), key=lambda e: e["path"])


def non_commons_reason(lead):
    if lead["host"] in HOST_REASONS:
        return HOST_REASONS[lead["host"]]
    text = (lead["workbook_license"] + " " + lead["workbook_rights"]).lower()
    if "all rights reserved" in text:
        return "all rights reserved"
    return "publisher or court website photo; no licence at the source (unverifiable)"


def measured_size(url, expected_width, measured):
    """(width, height) decoded from the rendition itself, or a reason it cannot be used."""
    entry = measured.get(url)
    if not entry or entry.get("status") != 200 or not entry.get("width"):
        return None, "rendition size not measured"
    if entry["width"] != expected_width:
        return None, "rendition is not at the requested standard width"
    return (entry["width"], entry["height"]), None


def scaled(url, width):
    """A scaled Commons thumbnail at exactly this width ('/960px-Name.jpg', or 'lossy-page1-960px-Name.tif.jpg' for
    multi-page originals such as TIFF)."""
    return bool(re.search(rf"/thumb/.+/(?:lossy-)?(?:page\d+-)?{width}px-[^/]+$", url.split("?")[0]))


def evaluate(lead, pages, alias, thumbs, mids, measured, verified_at):
    """(verified photo dict, None, urls) or (None, exclusion reason, urls); urls are renditions that need measuring."""
    if lead["workbook_status"] == COUNTY_CANDIDATE:
        return None, "building match not confirmed (county directory candidate)", []
    if not lead["commons_title"]:
        return None, non_commons_reason(lead), []
    page = resolve(lead["commons_title"], pages, alias)
    facts = file_facts(page)
    if not facts:
        return None, "file missing or unreadable at origin", []
    if not facts["family"]:
        return None, facts["exclusion"], []
    if ARTWORK.search(facts["title"]):
        return None, "photograph of an artwork, not the building (the artwork's copyright is not covered)", []
    width = facts["width"] or 0
    if width > DISPLAY_WIDTH:
        display_url, display_width = facts["display_url"], DISPLAY_WIDTH
    elif width > MID_WIDTH:
        mid = thumb_facts(resolve(lead["commons_title"], *mids))
        display_url, display_width = (mid or {}).get("thumb_url", ""), MID_WIDTH
    else:
        return None, f"original {MID_WIDTH} px wide or less (no standard display rendition)", []
    thumb = thumb_facts(resolve(lead["commons_title"], *thumbs)) or {}
    thumb_url = thumb.get("thumb_url", "")
    if not scaled(display_url, display_width) or not scaled(thumb_url, THUMB_WIDTH):
        return None, "no scaled rendition at a standard width returned", []
    display_size, why = measured_size(display_url, display_width, measured)
    thumb_size, why_t = measured_size(thumb_url, THUMB_WIDTH, measured)
    if why or why_t:
        return None, why or why_t, [display_url, thumb_url]
    two_x = None
    responsive = ((page.get("imageinfo") or [{}])[0].get("responsiveUrls")) or {}
    if display_width == DISPLAY_WIDTH and width > TWO_X_WIDTH and scaled(responsive.get("2", ""), TWO_X_WIDTH):
        two_x = {"url": responsive["2"], "width": TWO_X_WIDTH}
    licence_url = facts["license_url"] or None
    return {
        "file": facts["title"],
        "source_page": facts["description_url"],
        "display": {"url": display_url, "width": display_size[0], "height": display_size[1]},
        "display_2x": two_x,
        "thumb": {"url": thumb_url, "width": thumb_size[0], "height": thumb_size[1]},
        "size_basis": "decoded from each rendition",
        "original": {"url": facts["original_url"], "width": facts["width"], "height": facts["height"],
                     "mime": facts["mime"]},
        "license": facts["license"] or LICENCE_LABEL[facts["family"]],
        "license_family": facts["family"],
        "license_url": licence_url or (facts["description_url"] + "#Licensing"),
        "license_url_basis": "licence deed" if licence_url else "file page licensing section",
        "attribution": facts["artist"] or None,
        "credit": facts["credit"] or None,
        "attribution_required": facts["attribution_required"],
        "restrictions": facts["restrictions"] or None,
        "sha1": facts["sha1"],
        "verified_at": verified_at,
    }, None, []


def rank(lead, photo):
    quality = QUALITY_RANK.get(lead["workbook_status"], 9)
    strong = quality <= 1 and photo["display"]["width"] >= DISPLAY_WIDTH
    return (0 if strong else 1, lead["rank_source"], 0 if lead.get("headquarters") else 1, quality,
            -(photo["original"]["width"] or 0), photo["file"], lead["row"])


def row_for(court_id, spine_row, lead, photo, alternates):
    title = spine_row["title"]
    place = ", ".join(p for p in (lead["city"], lead["state"]) if p)
    building = lead["building"] or "Not recorded"
    author = photo["attribution"] or "Not recorded"
    registry = lead["sheet"] == REGISTRY_SHEET
    named_by = (f"owner's visual registry, asset {lead['asset_id']} ({lead['relationship_label']})" if registry
                else f"owner's court-buildings workbook, sheet {lead['sheet']}, row {lead['row']}")
    # Registry rows carry the licence as the registry recorded it (owner decision 2026-10-24: no licence re-check).
    verified = (f"not re-verified; licence and rights status as recorded by the visual registry "
                f"({photo['verified_at'] or 'date not recorded'})" if registry
                else f"{photo['verified_at']} from the file page metadata")
    facts = [
        ["Court", title],
        ["Court id", court_id],
        ["Building", building],
        ["Place", place or "Not recorded"],
        ["Photograph", photo["file"].removeprefix("File:")],
        ["Author", author],
        ["Licence", photo["license"]],
        ["Licence link", photo["license_url"] or "Not recorded"],
        ["Image source page", photo["source_page"]],
        ["Original size", f"{photo['original']['width']} × {photo['original']['height']} px"],
        ["Licence verified", verified],
        ["Building named by", named_by],
    ]
    if registry:
        facts.append(["Rights status (as recorded)", photo.get("rights_status") or "Not recorded"])
    if photo["restrictions"]:
        facts.append(["Other restrictions", photo["restrictions"]])
    photo_out = {**photo, "building": lead["building"] or None, "city": lead["city"] or None,
                 "state": lead["state"] or None,
                 "lead": {"sheet": lead["sheet"], "row": lead["row"], "workbook_status": lead["workbook_status"],
                          "name_check": lead["name_check"]},
                 "alternates": alternates}
    filters = {"license": [photo["license_family"].replace(" ", "_").replace("-", "_")],
               "system": [(spine_row.get("system") or "not_recorded").lower()],
               "lead": [SHEET_SLUG[lead["sheet"]]]}
    if spine_row.get("state"):
        filters["state"] = [spine_row["state"]]
    return cw.record(
        DATASET, court_id, title,
        source_url=photo["source_page"],
        cells={"court": title, "building": building, "place": place or "Not recorded",
               "license": photo["license"], "author": author},
        facts=facts,
        text=" ".join(x for x in (building, place, photo["file"], author, photo["license"]) if x),
        filters=filters,
        subtitle=" · ".join(x for x in (building if lead["building"] else "", place) if x),
        badges=[LICENCE_LABEL[photo["license_family"]]],
        links=[{"label": "Court page", "url": f"/courts/{court_id}"},
               {"label": "Image source page", "url": photo["source_page"]}],
        state=spine_row.get("state") or "",
        extra={"photo": photo_out},
    )


def build(workbook_path=WORKBOOK, acq=ACQ, out=BUILD, now=None):
    spine = {r["id"]: r for r in json.load(open(out / "lookups" / "court_spine.json"))}
    courts_db = json.load(open(out / "lookups" / "courts_db_names.json"))
    wb = read_workbook(workbook_path)
    leads, unmatched = collect(wb, spine, courts_db)

    manifest = commons_inputs(acq)
    pages, alias = load_responses([e["path"] for e in manifest if e["pass"] == "display"])
    thumbs = load_responses([e["path"] for e in manifest if e["pass"] == "thumb"])
    mids = load_responses([e["path"] for e in manifest if e["pass"] == "mid"])
    verified_at = max(e["retrieved_at"] for e in manifest if e["pass"] == "display")
    measured = rendition_sizes(acq)

    by_court = defaultdict(list)
    exclusions = []
    to_measure = []
    for lead in leads:
        photo, reason, urls = evaluate(lead, pages, alias, thumbs, mids, measured, verified_at)
        to_measure += urls
        if photo:
            by_court[lead["court_id"]].append((lead, photo))
        else:
            exclusions.append({"court_id": lead["court_id"], "sheet": lead["sheet"], "row": lead["row"],
                               "image": lead["commons_title"] or lead["original_url"], "reason": reason})

    rows = []
    for court_id in sorted(by_court):
        options = sorted(by_court[court_id], key=lambda pair: rank(*pair))
        lead, photo = options[0]
        alternates = sorted({p["file"] for _, p in options[1:] if p["file"] != photo["file"]})
        rows.append(row_for(court_id, spine[court_id], lead, photo, alternates))

    lead_courts = {lead["court_id"] for lead in leads}
    without = sorted(lead_courts - set(by_court))
    pair_reasons = Counter()
    seen_pairs = set()
    for x in exclusions:
        key = (x["court_id"], x["image"], x["reason"])
        if key not in seen_pairs:
            seen_pairs.add(key)
            pair_reasons[x["reason"]] += 1
    file_reasons = Counter()
    seen_files = set()
    for x in exclusions:
        if (x["image"], x["reason"]) not in seen_files:
            seen_files.add((x["image"], x["reason"]))
            file_reasons[x["reason"]] += 1
    county_rows = wb.get("County Photos", [])
    county_excluded = Counter(r.get("Rights statement", "Not recorded") for _, r in county_rows)
    directory_not_in_spine = sum(1 for _, r in wb.get("Court Directory", []) if r.get("Court ID") not in spine)

    family_counts = Counter(r["item"]["photo"]["license_family"] for r in rows)
    lead_counts = Counter(r["item"]["photo"]["lead"]["sheet"] for r in rows)
    summary = {
        "description": ("One record per court that has a photograph of its building with a licence verified on the "
                        "image's own file page: the court id, the building, display and thumbnail renditions at fixed "
                        f"widths ({DISPLAY_WIDTH} and {THUMB_WIDTH} px) with their pixel sizes, the licence, its link, "
                        "the author as plain text, the source page and when the licence was read."),
        "method": [
            "Leads: the owner's court-buildings workbook (sheets Top Courts, Court Directory, Federal Offices, "
            "Buildings). The workbook is not the source of any published fact about an image.",
            "Court ids: exact id only, present in court_spine, and a court name the workbook row gives for that id "
            "equal to one of our names for the same id (court_spine title or short name, Courts-DB name or "
            "sub-names) after case, punctuation and 'U.S.' normalisation, or equal under the fixed federal naming "
            "grammar ('Texas Western District Court' = 'District Court, W.D. Texas'). No fuzzy or closest-name "
            "matching.",
            "Licences: read from each file's Wikimedia Commons page metadata (imageinfo extmetadata: "
            "LicenseShortName, License, LicenseUrl, Artist, Credit, AttributionRequired, UsageTerms, NonFree). Kept: "
            "public domain, CC0, CC BY and CC BY-SA, any version. Excluded: NC, ND, non-free, GFDL-only, other "
            "licences, missing files and anything not stated at the origin.",
            "Sizes: the true pixel size of each returned rendition (a file narrower than the requested width is "
            "served unscaled at its own size). Renditions under 640 px wide are not used.",
            "Choice when a court has several verified photos: a strong photo (workbook review 'strong' or 'usable' "
            f"and at least {DISPLAY_WIDTH} px wide) first, then the workbook sheet in the order Top Courts, Court "
            "Directory, Federal Offices headquarters, Federal Offices, Buildings, then the larger original.",
            "Public-domain files have no licence deed; their licence link is the licensing section of the file page.",
        ],
        "counts": {
            "rows": len(rows),
            "courts_with_leads": len(lead_courts),
            "courts_without_kept_image": len(without),
            "leads": len(leads),
            "licence_family": dict(sorted(family_counts.items())),
            "chosen_from_sheet": dict(sorted(lead_counts.items())),
            "excluded_court_image_pairs_by_reason": dict(pair_reasons.most_common()),
            "excluded_files_by_reason": dict(file_reasons.most_common()),
            "unmatched_rows": len(unmatched),
            "unmatched_by_reason": dict(Counter(u["reason"] for u in unmatched).most_common()),
            "county_photo_rows_excluded": dict(county_excluded),
            "court_directory_rows_without_court_spine_id": directory_not_in_spine,
        },
        "courts_without_kept_image": without,
        "sources": [
            {"name": "Wikimedia Commons file pages (per-file licence and author metadata)",
             "url": "https://commons.wikimedia.org/w/api.php", "terms": "Each file's own licence, as recorded."},
            {"name": "Owner's workbook 'U.S. courts and public buildings' (compiled 2026-10-23), leads only",
             "url": "owner upload", "terms": "Not republished; used to find candidate files and court ids."},
        ],
        "units": "pixels",
        "period": f"licences read {verified_at}",
    }
    listing = cw.listing(
        [("court", "Court"), ("building", "Building"), ("place", "Place"), ("license", "Licence"),
         ("author", "Author")],
        [("license", "Licence", {"public_domain": "Public domain", "cc0": "CC0", "cc_by": "CC BY",
                                 "cc_by_sa": "CC BY-SA"}),
         ("system", "System", {v: v.replace("_", " ").capitalize()
                               for v in sorted({r["filters"]["system"][0] for r in rows})}),
         ("lead", "Workbook sheet", {"top_courts": "Top Courts", "court_directory": "Court Directory",
                                     "federal_offices": "Federal Offices", "buildings": "Buildings"})],
    )
    inputs = [{"url": "owner upload: US_Courts_and_Public_Buildings_1.xlsx", "path": str(workbook_path),
               "sha256": sha256_file(workbook_path)}]
    inputs += [{"url": e["url"], "path": e["path"], "sha256": e["sha256"], "retrieved_at": e["retrieved_at"]}
               for e in manifest]
    renditions = acq / "renditions" / "_manifest.jsonl"
    if renditions.exists():
        inputs.append({"url": "rendition size measurements (measure_renditions.py)", "path": str(renditions),
                       "sha256": sha256_file(renditions)})
    for name in ("court_spine.json", "courts_db_names.json"):
        p = out / "lookups" / name
        inputs.append({"url": "read-only corpus lookup", "path": str(p), "sha256": sha256_file(p)})
    built = {
        "dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary, "rows": rows,
        "built_at": now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "inputs": inputs,
    }
    return built, exclusions, unmatched, sorted(set(to_measure))


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(BUILD))
    args = parser.parse_args(argv)
    out = Path(args.out)
    built, exclusions, unmatched, to_measure = build(out=out)
    (out / "measure_list.json").write_text(json.dumps(to_measure, indent=0) + "\n")
    (out / f"{DATASET}.json").write_text(json.dumps(built, ensure_ascii=False, indent=1) + "\n")
    (out / "exclusions.json").write_text(json.dumps(exclusions, ensure_ascii=False, indent=1) + "\n")
    (out / "unmatched.json").write_text(json.dumps(unmatched, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({"rows": len(built["rows"]), "renditions_to_measure": len(to_measure),
                      **{k: v for k, v in built["summary"]["counts"].items()}},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
