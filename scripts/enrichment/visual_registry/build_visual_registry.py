"""Build the visual-registry datasets (CONTRACT.md build files) from the owner's visual registry.

  python3 -I -B build_visual_registry.py

Owner decision 2026-10-24 (relayed by the lead): "FORGET THE LICENSE CHECK JUST DO IT." Licences are not re-verified
at origin and there is no visual review: every registry image is included whatever its rights status, licence text or
host, and carries the registry's own recorded licence, licence URL, author, credit, source page, image URLs and size,
plus `rights_status` as recorded and `license_family` read from the recorded licence text (public domain | cc0 | cc by
| cc by-sa | other). What is still checked, automatically: identity (exact ids only, registry.py and the FJC node-id
bridge; state judges by an exact unique name in a recorded state, state_judges.py), the ARTWORK title rule, buildings
recorded as demolished or in former use, and https URLs.

Inputs (local, read-only): leads.json (select_leads.py), the registry JSON and workbook, lookups/*.json (read-only
corpus queries, md5-checked), cached FJC pages and Wikidata entities, the existing court_images build and builder.
Outputs in private/build/visual_registry/: court_images.json (existing 189 rows unchanged and first; new courts
appended), court_buildings.json, judge_portraits_open.json, agency_images.json, committee_marks.json,
company_logos_open.json, state_capitol_images.json, build_report.json.
"""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "court_images"))
import build_court_images as bci  # noqa: E402
import corpus_writer as cw  # noqa: E402
import origin as og  # noqa: E402
import recorded as rec  # noqa: E402
import state_judges as sj  # noqa: E402
from namecheck import name_match  # noqa: E402
from select_leads import sheet_rows  # noqa: E402
from vr_common import (BUILD, CACHE, COURT_SPINE, COURTS_DB, LEAD_NOTE, REGISTRY, ROOT, WORKBOOK, Store,  # noqa: E402
                       load_registry, sha256_file, write_json)

REPO = HERE.parents[2]
PORTRAITS = REPO / "src" / "lib" / "judges" / "portraits.server.json"
EXISTING_COURT_IMAGES = ROOT / "private" / "build" / "court_images" / "court_images.json"
MAX_BUILDINGS, MAX_AGENCY_PHOTOS = 12, 3
TRADEMARK = "Logo shown to identify the company. Trademarks belong to their owners; no endorsement implied."
FAMILY_SLUG = {"public domain": "public_domain", "cc0": "cc0", "cc by": "cc_by", "cc by-sa": "cc_by_sa", "other": "other"}
FAMILY_LABEL = {"public domain": "Public domain", "cc0": "CC0", "cc by": "CC BY", "cc by-sa": "CC BY-SA",
                "other": "Other licence (as recorded)"}
FAMILY_OPTIONS = {FAMILY_SLUG[k]: v for k, v in FAMILY_LABEL.items()}
RIGHTS_OPTIONS = {"reusable": "Reusable (as recorded)", "review_required": "Review required (as recorded)",
                  "restricted": "Restricted (as recorded)", "not_recorded": "Not recorded"}
DECISION = ("Owner decision 2026-10-24: licences are not re-verified and there is no visual review; every image "
            "carries the registry's recorded licence, author, credit and rights status as recorded.")
SOURCE_REGISTRY = {"name": LEAD_NOTE, "url": "owner upload",
                   "terms": "Image URLs, licences, authors, credits and rights statuses as recorded by the registry."}


def now_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def lookup(name, default=None):
    p = BUILD / "lookups" / f"{name}.json"
    return json.load(open(p))["data"] if p.exists() else default


def rights_slug(value):
    v = (value or "").strip().lower()
    return v if v in ("reusable", "review_required", "restricted") else "not_recorded"


def photo_block(p):
    """The shared photo shape (court_buildings, state_capitol_images) plus rights_status."""
    return {"file_page": p["file_page"], "display": p["display"], "thumb": p["thumb"], "license": p["license"],
            "license_family": p["license_family"], "license_url": p["license_url"],
            "license_url_is_deed": p["license_url_is_deed"], "author": p["author"], "credit": p["credit"],
            "verified_at": p["verified_at"], "rights_status": p["rights_status"]}


def place(city, state):
    return ", ".join(x for x in (city, state) if x) or "Not recorded"


def inputs_for(stores=()):
    files = [(REGISTRY, "owner upload: image registry JSON"),
             (WORKBOOK, "owner upload: Government visual registry workbook"),
             (BUILD / "leads.json", "lead selection (select_leads.py)")]
    out = [{"url": label, "path": str(p), "sha256": sha256_file(p)} for p, label in files]
    for p in sorted((BUILD / "lookups").glob("*.json")):
        out.append({"url": "read-only corpus lookup (md5-checked against the live table)", "path": str(p),
                    "sha256": sha256_file(p)})
    for name in stores:
        path = CACHE / name / "_manifest.jsonl"
        if path.exists():
            out.append({"url": f"stored responses ({name})", "path": str(path), "sha256": sha256_file(path)})
    return out


def built(dataset, label, rows, listing, summary, inputs, built_at):
    return {"dataset": dataset, "label": label, "listing_block": listing, "summary": summary, "rows": rows,
            "built_at": built_at, "inputs": inputs}


def method_common():
    return [DECISION,
            "Identity: exact identifiers only (see the dataset's identity rule); no name matching except where stated.",
            "Automatic checks kept: a photograph whose title names a sculpture, statue, mural, relief or fresco is not "
            "used as a building photograph; buildings recorded as demolished or in former use are not shown; only "
            "https URLs are used.",
            "Hosting: images are served from their origin. Wikimedia Commons originals are served as thumbnails at "
            "standard widths (960, 500, 330) narrower than the recorded original, heights scaled from the recorded "
            "size; any other image uses the URL and size as recorded."]


class Ctx:
    def __init__(self):
        self.leads = json.load(open(BUILD / "leads.json"))
        reg = load_registry()
        self.meta = reg["metadata"]
        self.assets = {a["asset_id"]: a for a in reg["assets"]}
        self.spine = {r["id"]: r for r in json.load(open(COURT_SPINE))}
        self.courts_db = json.load(open(COURTS_DB))
        self.holds = defaultdict(Counter)
        self.built_at = now_utc()


# ------------------------------------------------------------------ courts

def court_choices(ctx):
    out, listed = defaultdict(list), defaultdict(set)
    for lead in ctx.leads["court"]["leads"]:
        listed[lead["court_id"]].add(lead["building_entity"] or lead["asset_id"])
        photo, why = rec.photo(ctx.assets[lead["asset_id"]], "building")
        if not photo:
            ctx.holds["court_buildings"][why] += 1
            continue
        how = name_match(lead["court_id"], [lead["registry_court_name"]], ctx.spine, ctx.courts_db)
        out[lead["court_id"]].append(({**lead, "name_check": how or "not equal (recorded, not used)"}, photo))
    for h in ctx.leads["court"]["held"]:
        ctx.holds["court_buildings"][h["reason"]] += 1
    return out, listed


RIGHTS_ORDER = {"reusable": 0, "review_required": 1, "restricted": 2}


def building_rank(pair):
    """Headquarters (representative) building first, then photos the registry recorded as reusable, then the larger
    display rendition. Ordering only: every photo passing the identity checks is included."""
    lead, photo = pair
    return (0 if lead["relationship"] == "representative_building_source_link" else 1,
            RIGHTS_ORDER.get(photo["rights_status"], 3), -photo["display"]["width"],
            -(photo["original"]["width"] or 0), lead["asset_id"])


def court_buildings(ctx, choices, listed):
    rows = []
    for cid in sorted(choices):
        by_building = {}
        for lead, photo in sorted(choices[cid], key=building_rank):
            by_building.setdefault(lead["building_entity"] or lead["asset_id"], (lead, photo))
        ordered = sorted(by_building.values(), key=building_rank)
        if len(ordered) > MAX_BUILDINGS:
            ctx.holds["court_buildings"]["beyond the 12 buildings shown per court"] += len(ordered) - MAX_BUILDINGS
        ordered = ordered[:MAX_BUILDINGS]
        spine = ctx.spine[cid]
        buildings = [{
            "asset_id": lead["asset_id"], "building": lead["building"] or None,
            "street_address": lead["street_address"] or None, "city": lead["city"] or None,
            "state": lead["state"] or None, "latitude": lead["latitude"], "longitude": lead["longitude"],
            "relationship_label": lead["relationship_label"], "evidence_url": lead["evidence_url"],
            "photo": photo_block(photo)} for lead, photo in ordered]
        counts = {"buildings_listed": len(listed[cid]), "buildings_shown": len(buildings)}
        first_lead, first = ordered[0]
        title = spine["title"]
        families = sorted({b["photo"]["license_family"] for b in buildings})
        facts = [["Court", title], ["Court id", cid], ["Buildings shown", str(counts["buildings_shown"])],
                 ["Buildings listed in the visual registry", str(counts["buildings_listed"])],
                 ["Primary building", first_lead["building"] or "Not recorded"],
                 ["Primary building place", place(first_lead["city"], first_lead["state"])],
                 ["Relationship", first_lead["relationship_label"]],
                 ["Relationship evidence", first_lead["evidence_url"]],
                 ["Primary photograph licence (as recorded)", first["license"]],
                 ["Primary photograph rights status (as recorded)", first["rights_status"]],
                 ["Primary image source page", first["file_page"]],
                 ["Recorded by the registry", first["verified_at"] or "Not recorded"],
                 ["Buildings named by", LEAD_NOTE]]
        filters = {"license": [FAMILY_SLUG[f] for f in families],
                   "rights": sorted({rights_slug(b["photo"]["rights_status"]) for b in buildings}),
                   "system": [(spine.get("system") or "not_recorded").lower()],
                   "relationship": sorted({"headquarters" if lead["relationship"] ==
                                           "representative_building_source_link" else "location"
                                           for lead, _ in ordered})}
        if spine.get("state"):
            filters["state"] = [spine["state"]]
        rows.append(cw.record(
            "court_buildings", cid, title, source_url=first["file_page"],
            cells={"court": title, "primary_building": first_lead["building"] or "Not recorded",
                   "place": place(first_lead["city"], first_lead["state"]),
                   "buildings": str(counts["buildings_shown"]), "license": first["license"],
                   "rights": first["rights_status"]},
            facts=facts,
            text=" ".join(" ".join(x for x in (b["building"], place(b["city"], b["state"])) if x) for b in buildings),
            filters=filters,
            subtitle=" · ".join(x for x in (first_lead["building"], place(first_lead["city"], first_lead["state"])) if x),
            badges=[FAMILY_LABEL[f] for f in families],
            links=[{"label": "Court page", "url": f"/courts/{cid}"},
                   {"label": "Primary image source page", "url": first["file_page"]}],
            state=spine.get("state") or "", extra={"buildings": buildings, "counts": counts}))
    hosts = Counter(b["photo"]["display"]["url"].split("/")[2] for r in rows for b in r["item"]["buildings"])
    rights = Counter(b["photo"]["rights_status"] for r in rows for b in r["item"]["buildings"])
    summary = {
        "description": ("One record per court with at least one registry building photograph: up to 12 buildings, "
                        "primary first, each with its address and coordinates as listed, its relationship to the "
                        "court with the official evidence link, and the photograph with its licence, author, credit "
                        "and rights status as recorded by the visual registry."),
        "method": method_common() + [
            "Court identity: the link's court_id must exist in court_spine and its evidence_url must be a U.S. Courts "
            "page (*.uscourts.gov) or the court's own website as recorded in court_spine. Links evidenced only by USGS "
            "map layers or encyclopedia pages are held.",
            "Order: the headquarters (representative) building first, then photographs the registry recorded as "
            "reusable, then the larger display rendition (ordering only; nothing is dropped for its rights status).",
            "buildings_listed counts every current building the registry links to the court by a qualifying link; "
            "buildings_shown counts those with a usable photograph (at most 12)."],
        "counts": {"rows": len(rows), "buildings": sum(len(r["item"]["buildings"]) for r in rows),
                   "image_hosts": dict(hosts.most_common()), "rights_status": dict(rights.most_common()),
                   "held_by_reason": dict(ctx.holds["court_buildings"].most_common())},
        "sources": [SOURCE_REGISTRY],
        "units": "pixels; coordinates in decimal degrees as listed",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("court", "Court"), ("primary_building", "Primary building"), ("place", "Place"),
                          ("buildings", "Buildings shown"), ("license", "Primary licence"),
                          ("rights", "Rights status")],
                         [("license", "Licence", FAMILY_OPTIONS), ("rights", "Rights status", RIGHTS_OPTIONS),
                          ("relationship", "Relationship", {"headquarters": "Headquarters", "location": "Location"})])
    return rows, summary, listing


def court_images_photo(lead, photo, asset):
    """A court_images photo block (existing row format) from recorded fields."""
    deed = photo["license_url_is_deed"]
    return {
        "file": photo["file"] or asset.get("asset_id"),
        "source_page": photo["file_page"],
        "display": photo["display"],
        "display_2x": None,
        "thumb": photo["thumb"],
        "size_basis": photo["size_basis"],
        "original": {"url": photo["image_url"], "width": photo["original"]["width"],
                     "height": photo["original"]["height"], "mime": photo["original"]["mime"]},
        "license": photo["license"],
        "license_family": photo["license_family"],
        "license_url": photo["license_url"],
        "license_url_basis": "licence deed" if deed else "as recorded by the visual registry",
        "attribution": photo["author"],
        "credit": photo["credit"],
        "attribution_required": asset.get("attribution_required") if isinstance(asset.get("attribution_required"),
                                                                               bool) else None,
        "restrictions": photo["restrictions"],
        "sha1": None,
        "verified_at": photo["verified_at"],
        "rights_status": photo["rights_status"],
    }


def court_images_extension(ctx, choices):
    existing = json.load(open(EXISTING_COURT_IMAGES))
    have = {r["id"] for r in existing["rows"]}
    new_rows = []
    for cid in sorted(set(choices) - have):
        options = sorted(choices[cid], key=lambda lp: (0 if lp[1]["display"]["url"].split("/")[2] in (
            "upload.wikimedia.org", "thumb.wikimedia.org") else 1, *building_rank(lp)))
        lead, photo = options[0]
        bl = {"sheet": bci.REGISTRY_SHEET, "row": None, "workbook_status": "", "name_check": lead["name_check"],
              "building": lead["building"], "city": lead["city"], "state": lead["state"],
              "asset_id": lead["asset_id"], "relationship_label": lead["relationship_label"]}
        p = court_images_photo(lead, photo, ctx.assets[lead["asset_id"]])
        alternates = sorted({ph["file"] for _, ph in options[1:] if ph["file"] and ph["file"] != p["file"]})
        new_rows.append(bci.row_for(cid, ctx.spine[cid], bl, p, alternates))
    rows = existing["rows"] + new_rows
    summary = json.loads(json.dumps(existing["summary"]))
    summary["counts"]["rows"] = len(rows)
    summary["registry_extension"] = {
        "rows_added": len(new_rows), "court_ids_added": [r["id"] for r in new_rows],
        "method": (f"Courts without a row from the workbook leads gain one from the {LEAD_NOTE} (court_buildings "
                   f"identity rules). {DECISION} The new rows carry rights_status; their license_family may be "
                   "'other'. Wikimedia-hosted photographs are chosen first, then the headquarters building, then the "
                   "larger rendition. The existing 189 rows are unchanged and keep their order; new rows follow."),
        "license_family": dict(Counter(r["item"]["photo"]["license_family"] for r in new_rows)),
        "rights_status": dict(Counter(r["item"]["photo"]["rights_status"] for r in new_rows)),
        "hosts": dict(Counter(r["item"]["photo"]["display"]["url"].split("/")[2] for r in new_rows)),
    }
    summary["sources"] = summary["sources"] + [SOURCE_REGISTRY]
    listing = json.loads(json.dumps(existing["listing_block"]))
    for f in listing["filters"]:
        values = {o["value"] for o in f["options"]} if "options" in f else set()
        if f["name"] == "lead" and "visual_registry" not in values:
            f["options"].append({"label": "Visual registry", "value": "visual_registry"})
        if f["name"] in ("license", "system"):
            for r in new_rows:
                v = r["filters"][f["name"]][0]
                if v not in values:
                    label = FAMILY_OPTIONS.get(v) if f["name"] == "license" else v.replace("_", " ").capitalize()
                    f["options"].append({"label": label or v, "value": v})
                    values.add(v)
    inputs = existing["inputs"] + inputs_for()
    return built("court_images", existing["label"], rows, listing, summary, inputs, existing["built_at"])


# ------------------------------------------------------------------ judges

def judge_target(nid, nid_lookup, photos, portraits):
    """(judge profile id, None) when the FJC node id resolves to exactly one judge page without a portrait.

    nid_lookup: {fjc_nid: {"title", "judge_profile": [...]}} from judge_profiles_fjc; photos: {judge id: has
    photo_url} from the judges dataset; portraits: the site's portrait map {judge id: person}. A page that already has
    a portrait keeps it.
    """
    hit = nid_lookup.get(nid)
    if not hit:
        return None, "no judge_profiles_fjc row with this FJC node id"
    if len(hit["judge_profile"]) != 1:
        return None, "judge_profiles_fjc row has no single judge profile"
    profile = hit["judge_profile"][0]
    if photos.get(profile) or profile in portraits:
        return None, "judge page already has a portrait (kept)"
    if profile not in photos:
        return None, "judge profile id not in the judges dataset"
    return profile, None


def portrait_block(photo):
    return {"display": photo["display"], "thumb": photo["thumb"], "file_page": photo["file_page"],
            "license": photo["license"], "license_family": photo["license_family"],
            "license_url": photo["license_url"], "license_url_is_deed": photo["license_url_is_deed"],
            "author": photo["author"], "credit": photo["credit"], "image_date": photo["date"],
            "verified_at": photo["verified_at"], "rights_status": photo["rights_status"]}


def judge_portraits(ctx):
    fjc = Store("fjc")
    nid_lookup = lookup("judge_fjc", {})
    photos = lookup("judge_photos", {})
    portraits = json.load(open(PORTRAITS)).get("judges", {}) if PORTRAITS.exists() else {}
    holds = ctx.holds["judge_portraits_open"]
    by_profile = defaultdict(list)
    for lead in ctx.leads["judge"]["leads"]:
        photo, why = rec.photo(ctx.assets[lead["asset_id"]], "portrait")
        if not photo:
            holds[why] += 1
            continue
        body = fjc.read(lead["fjc_slug"])
        if body is None:
            entry = fjc.entries.get(lead["fjc_slug"])
            holds["FJC page not returned" if entry else "FJC page not fetched yet"] += 1
            continue
        nid = og.fjc_nid(body)
        if not nid:
            holds["FJC page states no single node id"] += 1
            continue
        profile, why = judge_target(nid, nid_lookup, photos, portraits)
        if not profile:
            holds[why] += 1
            continue
        identity = {"wikidata": lead["wikidata"] or None, "fjc_slug": lead["fjc_slug"], "fjc_nid": nid,
                    "fjc_url": f"https://www.fjc.gov/history/judges/{lead['fjc_slug']}", "basis": "fjc_node_id"}
        by_profile[profile].append((lead["asset_id"], photo, identity, nid_lookup[nid]["title"]))
    state_rows = lookup("state_judges", [])
    state_found, state_held = sj.leads(list(ctx.assets.values()))
    for a, why in state_held:
        holds["state/special-court judge: " + why] += 1
    for a, name_norm, states in state_found:
        jid, why = sj.match(name_norm, states, state_rows)
        if not jid:
            holds["state/special-court judge: " + why] += 1
            continue
        row = next(r for r in state_rows if r["id"] == jid)
        if row["has_photo"] or jid in portraits:
            holds["judge page already has a portrait (kept)"] += 1
            continue
        photo, why = rec.photo(a, "portrait")
        if not photo:
            holds[why] += 1
            continue
        wd = (a.get("source_ids") or {}).get("wikidata") or None
        identity = {"wikidata": wd, "fjc_slug": None, "fjc_nid": None, "fjc_url": None,
                    "basis": "exact_name_same_state", "state": sorted(set(row["states"]) & set(states))[0]}
        by_profile[jid].append((a["asset_id"], photo, identity, row["title"]))
    rows = []
    for profile in sorted(by_profile):
        if len(by_profile[profile]) > 1:
            holds["two registry portraits resolve to one judge page"] += len(by_profile[profile])
            continue
        asset_id, photo, identity, title = by_profile[profile][0]
        portrait = portrait_block(photo)
        path = (f"registry FJC id {identity['fjc_slug']} -> FJC biography page node id {identity['fjc_nid']} -> "
                "judge_profiles_fjc row -> judge profile" if identity["basis"] == "fjc_node_id" else
                f"registry name equals exactly one judges record title in {identity['state']}, a state named by "
                "the person's registry-recorded role or court")
        facts = [["Judge", title], ["Identity path", path],
                 ["FJC biography", identity["fjc_url"] or "Not applicable"],
                 ["Wikidata item (as recorded)", f"https://www.wikidata.org/wiki/{identity['wikidata']}"
                  if identity["wikidata"] else "Not recorded"],
                 ["Author (as recorded)", photo["author"] or "Not recorded"],
                 ["Licence (as recorded)", photo["license"]], ["Rights status (as recorded)", photo["rights_status"]],
                 ["Image date (as recorded)", photo["date"] or "Not recorded"],
                 ["Image source page", photo["file_page"]], ["Registry asset", asset_id]]
        rows.append(cw.record(
            "judge_portraits_open", profile, title, source_url=photo["file_page"],
            cells={"judge": title, "license": photo["license"], "author": photo["author"] or "Not recorded",
                   "image_date": photo["date"] or "Not recorded", "rights": photo["rights_status"],
                   "basis": "FJC node id" if identity["basis"] == "fjc_node_id" else "Exact name, same state"},
            facts=facts, text=" ".join(x for x in (title, photo["author"] or "") if x),
            filters={"license": [FAMILY_SLUG[photo["license_family"]]], "rights": [rights_slug(photo["rights_status"])],
                     "basis": [identity["basis"]]},
            subtitle=(f"FJC {identity['fjc_nid']}" if identity["fjc_nid"] else identity.get("state") or ""),
            badges=[FAMILY_LABEL[photo["license_family"]]],
            links=[{"label": "Judge page", "url": f"/judges/{profile}"},
                   {"label": "Image source page", "url": photo["file_page"]}]
            + ([{"label": "FJC biography", "url": identity["fjc_url"]}] if identity["fjc_url"] else []),
            extra={"portrait": portrait, "identity": identity}))
    summary = {
        "description": ("Portraits for judge pages that had none: one record per judge page, with display and "
                        "thumbnail renditions and the licence, author, credit, image date and rights status as "
                        "recorded by the visual registry, plus the identity path."),
        "method": method_common() + [
            "Federal judges: registry FJC id (exactly one) -> https://www.fjc.gov/history/judges/<id> (robots.txt "
            "obeyed: Crawl-delay 30) -> the page's own node id (shortlink) -> the judge_profiles_fjc row whose fjc_nid "
            "equals it -> its single judge_profile.",
            "State and special-court judges: the registry name, normalised (lower case, non-alphanumerics as one "
            "space), must equal the title of exactly one judges record in a state that one of the person's "
            "registry-recorded roles or courts names; otherwise held.",
            "Judge pages that already have a portrait (judges photo_url or the site's portrait map) keep it."],
        "counts": {"rows": len(rows), "by_basis": dict(Counter(r["item"]["identity"]["basis"] for r in rows)),
                   "held_by_reason": dict(holds.most_common())},
        "sources": [SOURCE_REGISTRY, {"name": "Federal Judicial Center, Biographical Directory of Article III "
                                              "Federal Judges (node ids)", "url": "https://www.fjc.gov/history/judges",
                                      "terms": "Public U.S. government pages; robots.txt obeyed."}],
        "units": "pixels",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("judge", "Judge"), ("license", "Licence"), ("author", "Author"),
                          ("image_date", "Image date"), ("rights", "Rights status"), ("basis", "Identity path")],
                         [("license", "Licence", FAMILY_OPTIONS), ("rights", "Rights status", RIGHTS_OPTIONS),
                          ("basis", "Identity path", {"fjc_node_id": "FJC node id",
                                                      "exact_name_same_state": "Exact name, same state"})])
    return rows, summary, listing


# ------------------------------------------------------------------ agencies

def agency_images(ctx):
    titles = lookup("fr_agencies")
    holds = ctx.holds["agency_images"]
    photos_by, marks_by = defaultdict(list), defaultdict(list)
    for lead in ctx.leads["agency"]["leads"]:
        a = ctx.assets[lead["asset_id"]]
        if lead["role"] == "mark":
            m, why = rec.mark(a)
            if not m:
                holds[why] += 1
                continue
            marks_by[lead["fr_id"]].append((lead, m))
        else:
            p, why = rec.photo(a, "building")
            if not p:
                holds[why] += 1
                continue
            photos_by[lead["fr_id"]].append((lead, p))
    for h in ctx.leads["agency"]["held"]:
        holds[h["reason"]] += 1
    rows = []
    for fr in sorted(set(photos_by) | set(marks_by), key=int):
        options = sorted(photos_by.get(fr, []), key=lambda lp: (0 if lp[0]["recommended_default"] else 1,
                                                               -lp[1]["display"]["width"], lp[0]["asset_id"]))
        seen, photos = set(), []
        for lead, p in options:
            if p["display"]["url"] in seen:
                continue
            seen.add(p["display"]["url"])
            note = ctx.assets[lead["asset_id"]].get("review_notes")
            photos.append({"building": lead["building"] or None, "photo_date": p["date"], "display": p["display"],
                           "thumb": p["thumb"], "source_page": p["file_page"], "license": p["license"],
                           "license_family": p["license_family"], "license_url": p["license_url"],
                           "license_url_is_deed": p["license_url_is_deed"], "author": p["author"],
                           "credit_line": p["credit"],
                           "occupancy_note": note if isinstance(note, str) and note.strip() else None,
                           "verified_at": p["verified_at"], "rights_status": p["rights_status"],
                           "asset_id": lead["asset_id"]})
        if len(photos) > MAX_AGENCY_PHOTOS:
            holds["beyond the three photos shown per agency"] += len(photos) - MAX_AGENCY_PHOTOS
        photos = photos[:MAX_AGENCY_PHOTOS]
        marks = [{**m, "asset_id": lead["asset_id"]} for lead, m in
                 sorted(marks_by.get(fr, []), key=lambda lm: (0 if lm[0]["recommended_default"] else 1,
                                                              0 if lm[0]["asset_type"] == "seal" else 1,
                                                              lm[0]["asset_id"]))]
        title = titles[fr]
        first = photos[0] if photos else None
        facts = [["Agency", title], ["Federal Register agency id", fr], ["Building photos shown", str(len(photos))],
                 ["Seals and logos shown", str(len(marks))]]
        if first:
            facts += [["Primary building", first["building"] or "Not recorded"],
                      ["Primary photograph date (as recorded)", first["photo_date"] or "Not recorded"],
                      ["Primary licence (as recorded)", first["license"]],
                      ["Primary rights status (as recorded)", first["rights_status"]],
                      ["Primary image source page", first["source_page"]]]
        if marks:
            facts += [["Mark", f"{marks[0]['asset_type'] or 'mark'} · {marks[0]['url']}"],
                      ["Mark rights status (as recorded)", marks[0]["rights_status"]],
                      ["Mark note (as recorded)", marks[0]["branding_note"] or "Not recorded"]]
        source = first["source_page"] if first else (marks[0]["source_page"] or marks[0]["url"])
        rights = sorted({rights_slug(x["rights_status"]) for x in photos + marks})
        rows.append(cw.record(
            "agency_images", fr, title, source_url=source,
            cells={"agency": title, "building": (first or {}).get("building") or "Not recorded",
                   "photos": str(len(photos)), "marks": str(len(marks)),
                   "license": first["license"] if first else "Not recorded",
                   "photo_date": (first or {}).get("photo_date") or "Not recorded"},
            facts=facts, text=" ".join(p["building"] or "" for p in photos),
            filters={"license": sorted({FAMILY_SLUG[x["license_family"]] for x in photos + marks}), "rights": rights,
                     "has": sorted(({"photo"} if photos else set()) | ({"mark"} if marks else set()))},
            subtitle=(first or {}).get("building") or "",
            badges=sorted({FAMILY_LABEL[p["license_family"]] for p in photos}),
            links=[{"label": "Agency page", "url": f"/agencies/{fr}"}]
            + ([{"label": "Primary image source page", "url": first["source_page"]}] if first else []),
            extra={"photos": photos, "marks": marks}))
    summary = {
        "description": ("Agency images for agency pages: up to three building photographs (photos[], primary first) "
                        "and the agency's seal or logo (marks[], primary first), each with licence, credit and rights "
                        "status as recorded by the visual registry."),
        "method": method_common() + [
            "Agency identity: the registry fr_id equals the /agencies page id (a Federal Register agency id present "
            "in fr_agency_profiles).",
            "Seals and logos are served from agency-logos.federalregister.gov as recorded; their recorded rights "
            "status is review_required or restricted and their recorded note (branding_note) says emblem/trademark "
            "review remains required."],
        "counts": {"rows": len(rows), "photos": sum(len(r["item"]["photos"]) for r in rows),
                   "marks": sum(len(r["item"]["marks"]) for r in rows),
                   "rights_status": dict(Counter(x["rights_status"] for r in rows for x in r["item"]["photos"]
                                                 + r["item"]["marks"]).most_common()),
                   "held_by_reason": dict(holds.most_common())},
        "sources": [SOURCE_REGISTRY],
        "units": "pixels",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("agency", "Agency"), ("building", "Building"), ("photos", "Photos"), ("marks", "Marks"),
                          ("license", "Licence"), ("photo_date", "Photo date")],
                         [("license", "Licence", FAMILY_OPTIONS), ("rights", "Rights status", RIGHTS_OPTIONS),
                          ("has", "Images", {"photo": "Building photo", "mark": "Seal or logo"})])
    return rows, summary, listing


# ------------------------------------------------------------------ committees

def committee_marks(ctx):
    titles = lookup("committee_titles")
    holds = ctx.holds["committee_marks"]
    by = defaultdict(list)
    for lead in ctx.leads["committee"]["leads"]:
        a = ctx.assets[lead["asset_id"]]
        m, why = rec.mark(a)
        if not m:
            holds[why] += 1
            continue
        # The policy text: the registry's captured text of the site's copyright page when it recorded one (a captured
        # privacy page is not a copyright statement); otherwise the registry's own rights-evidence sentence.
        texts = [p.get("text") for p in a.get("policy_evidence") or []
                 if p.get("url") == m["policy_url"] and (p.get("url") or "").rstrip("/").endswith("/copyright")]
        if texts and texts[0]:
            m["policy_quote"] = " ".join(texts[0].split())
        by[lead["committee"]].append((lead, m))
    for h in ctx.leads["committee"]["held"]:
        holds[h["reason"]] += 1
    rows = []
    for cid in sorted(by):
        options = sorted(by[cid], key=lambda lm: (lm[0]["alternate"], lm[0]["asset_id"]))
        if len(options) > 1:
            holds["alternate mark not shown (one mark per committee)"] += len(options) - 1
        lead, m = options[0]
        mark = {"url": m["url"], "width": m["width"], "height": m["height"], "mime": m["mime"],
                "source_page": m["source_page"], "policy_url": m["policy_url"], "policy_quote": m["policy_quote"],
                "branding_note": m["branding_note"], "verified_at": m["verified_at"],
                "rights_status": m["rights_status"], "license": m["license"], "license_family": m["license_family"]}
        title = titles[cid]
        chamber = "house" if cid.startswith("h") else "senate" if cid.startswith("s") else "joint"
        rows.append(cw.record(
            "committee_marks", cid, title, source_url=m["source_page"] or m["url"],
            cells={"committee": title, "chamber": chamber.capitalize(), "mime": m["mime"] or "Not recorded",
                   "license": m["license"], "rights": m["rights_status"]},
            facts=[["Committee", title], ["Committee id", cid], ["Mark file", m["url"]],
                   ["Size (as recorded)", f"{m['width']} × {m['height']} px"],
                   ["Licence (as recorded)", m["license"]], ["Rights status (as recorded)", m["rights_status"]],
                   ["Policy page (as recorded)", m["policy_url"] or "Not recorded"],
                   ["Policy statement (as recorded)", m["policy_quote"] or "Not recorded"],
                   ["Recorded by the registry", m["verified_at"] or "Not recorded"]],
            text=title, filters={"chamber": [chamber], "rights": [rights_slug(m["rights_status"])],
                                 "license": [FAMILY_SLUG[m["license_family"]]]},
            subtitle=f"{chamber.capitalize()} committee",
            links=[{"label": "Committee page", "url": f"/law/legislation/committees/{cid}"}]
            + ([{"label": "Committee website", "url": m["source_page"]}] if m["source_page"] else []),
            extra={"mark": mark}))
    summary = {
        "description": ("Committee marks for committee pages, served from each committee's own website, with the "
                        "licence, policy page and rights status as recorded by the visual registry."),
        "method": method_common() + [
            "Committee identity: House clerk code (e.g. JU00) -> hs + code (hsju00); Senate and Joint codes as "
            "recorded (SSBK00 -> ssbk00); the congress_committees row must have that system code, the same chamber "
            "and the same official website host. One mark per committee (the primary, not the alternate)."],
        "counts": {"rows": len(rows), "rights_status": dict(Counter(r["item"]["mark"]["rights_status"]
                                                                    for r in rows)),
                   "held_by_reason": dict(holds.most_common())},
        "sources": [SOURCE_REGISTRY],
        "units": "pixels (SVG: viewBox units as recorded)",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("committee", "Committee"), ("chamber", "Chamber"), ("mime", "File type"),
                          ("license", "Licence"), ("rights", "Rights status")],
                         [("chamber", "Chamber", {"house": "House", "senate": "Senate", "joint": "Joint"}),
                          ("rights", "Rights status", RIGHTS_OPTIONS)])
    return rows, summary, listing


# ------------------------------------------------------------------ companies

def company_logos(ctx):
    holds = ctx.holds["company_logos_open"]
    wd = Store("wikidata")
    rows = []
    for lead in ctx.leads["company"]["leads"]:
        body = wd.read(lead["wikidata"]) if lead["wikidata"] else None
        entity = og.wikidata_entity(body, lead["wikidata"]) if body else None
        logo, why = og.company_logo(entity, lead["cik"])
        if not logo:
            holds[why] += 1
            continue
        match = [s for s in lead["statements"] if og.file_key(s["file"]) == og.file_key(logo["file"])]
        if not match:
            holds["Wikidata logo statement names a file the registry did not record"] += 1
            continue
        a = ctx.assets[match[0]["asset_id"]]
        p, why = rec.photo(a, "logo")
        if not p:
            holds[why] += 1
            continue
        label = ((entity or {}).get("labels") or {}).get("en", {}).get("value") or lead["name"]
        out = {"display": p["display"], "thumb": p["thumb"], "file_page": p["file_page"], "license": p["license"],
               "license_family": p["license_family"], "license_url": p["license_url"],
               "license_url_is_deed": p["license_url_is_deed"], "author": p["author"], "wikidata": lead["wikidata"],
               "statement_id": logo["statement_id"], "trademark_note": TRADEMARK, "verified_at": p["verified_at"],
               "rights_status": p["rights_status"]}
        rows.append(cw.record(
            "company_logos_open", lead["cik"], label, source_url=p["file_page"],
            cells={"company": label, "cik": lead["cik"], "license": p["license"],
                   "author": p["author"] or "Not recorded", "rights": p["rights_status"]},
            facts=[["Company", label], ["CIK", lead["cik"]],
                   ["Wikidata item", f"https://www.wikidata.org/wiki/{lead['wikidata']}"],
                   ["Logo statement", f"{logo['statement_id']} (P154, {logo['rank']} rank)"],
                   ["Logo file", p["file"].removeprefix("File:")], ["Licence (as recorded)", p["license"]],
                   ["Rights status (as recorded)", p["rights_status"]],
                   ["Author (as recorded)", p["author"] or "Not recorded"], ["Trademark", TRADEMARK]],
            text=label, filters={"license": [FAMILY_SLUG[p["license_family"]]], "rights": [rights_slug(p["rights_status"])]},
            subtitle=f"CIK {lead['cik']}", badges=[FAMILY_LABEL[p["license_family"]]],
            links=[{"label": "Company page", "url": f"/companies/{lead['cik']}"},
                   {"label": "Logo source page", "url": p["file_page"]}],
            extra={"logo": out}))
    rows.sort(key=lambda r: r["id"])
    summary = {
        "description": "Company logos for company pages, shown for identification only.",
        "method": method_common() + [
            "Company identity: exactly one CIK claim on the registry entity, no other entity claims it, the CIK has a "
            "company page here (company_sec_profiles), and the Wikidata entity read now has exactly that CIK (P5531).",
            "Logo: that entity's P154 statement of preferred rank, or its sole normal-rank statement, without an end "
            "time; the registry record for that file supplies the image, licence and rights status as recorded.",
            TRADEMARK],
        "counts": {"rows": len(rows), "held_by_reason": dict(holds.most_common()),
                   "registry_entities_held_before_fetch": dict(Counter(h["reason"] for h in
                                                                       ctx.leads["company"]["held"]).most_common())},
        "sources": [SOURCE_REGISTRY, {"name": "Wikidata entity records (P5531 CIK, P154 logo statement)",
                                      "url": "https://www.wikidata.org/", "terms": "CC0"}],
        "units": "pixels",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("company", "Company"), ("cik", "CIK"), ("license", "Licence"), ("author", "Author"),
                          ("rights", "Rights status")],
                         [("license", "Licence", FAMILY_OPTIONS), ("rights", "Rights status", RIGHTS_OPTIONS)])
    return rows, summary, listing


# ------------------------------------------------------------------ state capitols

def state_capitols(ctx):
    holds = ctx.holds["state_capitol_images"]
    design = {r["Asset ID"]: r for r in sheet_rows(WORKBOOK, "Design Assets", "Asset ID")}
    rows = []
    for lead in ctx.leads["state"]["leads"]:
        d = design.get(lead["asset_id"]) or {}

        def num(v):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return None
        asset = {"asset_id": lead["asset_id"], "image_url": d.get("Original browser image URL"),
                 "source_page_url": d.get("Source record URL"), "source_title": d.get("Source work title"),
                 "original_width": num(d.get("Linked browser image width px")),
                 "original_height": num(d.get("Linked browser image height px")),
                 "license": d.get("License / rights statement"), "license_url": d.get("License / rights URL"),
                 "author": d.get("Creator / source credit"), "credit": d.get("Creator / source credit"),
                 "rights_status": d.get("Rights status"), "fetched_at": ctx.meta.get("assembledAtUTC"),
                 "photo_date": d.get("Image date as recorded")}
        p, why = rec.photo(asset, "building")
        if not p:
            holds[why] += 1
            continue
        block = {**photo_block(p), "building": lead["building"] or None}
        title = lead["state_name"] or lead["state"]
        rows.append(cw.record(
            "state_capitol_images", lead["state"], title, source_url=p["file_page"],
            cells={"state": title, "building": lead["building"] or "Not recorded", "license": p["license"],
                   "author": p["author"] or "Not recorded", "rights": p["rights_status"]},
            facts=[["State", title], ["Building", lead["building"] or "Not recorded"],
                   ["Photograph", (p["file"] or "").removeprefix("File:") or "Not recorded"],
                   ["Author (as recorded)", p["author"] or "Not recorded"], ["Licence (as recorded)", p["license"]],
                   ["Rights status (as recorded)", p["rights_status"]], ["Image source page", p["file_page"]],
                   ["Chosen by", f"{LEAD_NOTE}, Page Visuals default for state:{lead['state']}"]],
            text=" ".join(x for x in (title, lead["building"], p["author"] or "") if x),
            filters={"license": [FAMILY_SLUG[p["license_family"]]], "rights": [rights_slug(p["rights_status"])]},
            subtitle=lead["building"] or "", badges=[FAMILY_LABEL[p["license_family"]]],
            links=[{"label": "State page", "url": f"/places/{lead['state']}"},
                   {"label": "Image source page", "url": p["file_page"]}],
            state=lead["state"], extra={"photo": block}))
    for h in ctx.leads["state"]["held"]:
        holds[h["reason"]] += 1
    rows.sort(key=lambda r: r["id"])
    summary = {
        "description": "One photograph of the state capitol (or territorial government building) per state page.",
        "method": method_common() + [
            f"Identity: the {LEAD_NOTE} workbook sheet Page Visuals, default photograph of page state:<XX>; the "
            "photograph's fields come from the workbook's Design Assets row for that asset id. verified_at carries "
            "the registry's assembly time (the workbook records no per-row retrieval time)."],
        "counts": {"rows": len(rows), "held_by_reason": dict(holds.most_common())},
        "sources": [SOURCE_REGISTRY],
        "units": "pixels",
        "period": f"as recorded by the registry, assembled {ctx.meta.get('assembledAtUTC')}",
    }
    listing = cw.listing([("state", "State"), ("building", "Building"), ("license", "Licence"), ("author", "Author"),
                          ("rights", "Rights status")],
                         [("license", "Licence", FAMILY_OPTIONS), ("rights", "Rights status", RIGHTS_OPTIONS)])
    return rows, summary, listing


LABELS = {
    "court_buildings": "Court buildings with photographs from the owner's visual registry (U.S. Courts locations, October 2026)",
    "judge_portraits_open": "Judge portraits for judge pages without one (owner's visual registry; FJC identity path, October 2026)",
    "agency_images": "Agency building photographs, seals and logos (owner's visual registry, October 2026)",
    "committee_marks": "Congressional committee marks from the committees' own websites (owner's visual registry, October 2026)",
    "company_logos_open": "Company logos for identification (owner's visual registry; Wikidata logo statements, October 2026)",
    "state_capitol_images": "State capitol photographs (owner's visual registry, October 2026)",
}


def main():
    ctx = Ctx()
    choices, listed = court_choices(ctx)
    outputs = {}
    rows, summary, listing = court_buildings(ctx, choices, listed)
    outputs["court_buildings"] = built("court_buildings", LABELS["court_buildings"], rows, listing, summary,
                                       inputs_for(), ctx.built_at)
    outputs["court_images"] = court_images_extension(ctx, choices)
    for ds, fn, stores in (("judge_portraits_open", judge_portraits, ["fjc"]),
                           ("agency_images", agency_images, []),
                           ("committee_marks", committee_marks, []),
                           ("company_logos_open", company_logos, ["wikidata"]),
                           ("state_capitol_images", state_capitols, [])):
        rows, summary, listing = fn(ctx)
        outputs[ds] = built(ds, LABELS[ds], rows, listing, summary, inputs_for(stores), ctx.built_at)
    for ds, data in outputs.items():
        ids = [r["id"] for r in data["rows"]]
        assert len(ids) == len(set(ids)), f"{ds}: duplicate ids"
        write_json(BUILD / f"{ds}.json", data)
    report = {"built_at": ctx.built_at, "rows": {ds: len(d["rows"]) for ds, d in outputs.items()},
              "holds": {ds: dict(c.most_common()) for ds, c in ctx.holds.items()},
              "court_images_new_rows": [r["id"] for r in outputs["court_images"]["rows"][189:]]}
    write_json(BUILD / "build_report.json", report)
    print(json.dumps(report["rows"], indent=1))
    for ds, h in report["holds"].items():
        print(ds, json.dumps(h)[:600])


if __name__ == "__main__":
    main()
