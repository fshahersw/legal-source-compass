"""Leads from the owner's visual registry, filtered by the exact-identifier rules before anything is fetched.

The registry is a list of leads. Owner decision 2026-10-24 (relayed by the lead): no licence check, so licence, host
and rights status never hold a lead here; they are carried as recorded (recorded.py). What this module decides, from
the registry's own identifiers only, is which page an image belongs to, and which leads are held (with the reason):

  courthouse -> court page: court_links[].court_id present in court_spine AND the link's evidence_url is a U.S. Courts
                page (*.uscourts.gov) or the linked court's own website (the court_spine website host for that id);
                buildings recorded as demolished or in former use are not shown as the court's building.
  judge      -> exactly one FJC id (source_ids.fjc_alpha_ids); the FJC page, its node id and our profile are
                resolved later (state and special-court judges: state_judges.py).
  agency     -> building photographs (photos) and seals/logos (marks); registry fr_id equals an /agencies page id.
  committee  -> House clerk code -> hs + code, Senate/Joint system code as recorded; our congress_committees row must
                have that system code, the same chamber and the same official website host.
  company    -> exactly one CIK claim on the entity, no other entity claims it, and the CIK has a company page.
  state      -> the workbook's Page Visuals `state:<XX>` default photograph.
Only an image URL that is not https is refused before identity. No names are compared for any binding here.
"""
import re
import urllib.parse

RELATIONSHIP_LABEL = {
    "official_location_named_or_address_match": "Listed by U.S. Courts as a location of this court",
    "representative_building_source_link": "Headquarters listed by U.S. Courts",
}
# A representative link whose evidence is the court's own website (not uscourts.gov) is labelled for what it is.
OWN_SITE_LABEL = "Building named on the court's own website"
FORMER = re.compile(r"(?i)\b(demolish\w*|demolition|former)\b")
HOSTS_COMMONS = {"upload.wikimedia.org"}
HOSTS_LOC = {"tile.loc.gov"}


def host(url):
    return urllib.parse.urlsplit(url or "").netloc.lower()


def strip_www(h):
    return h[4:] if h.startswith("www.") else h


def commons_title(page_url, image_url=""):
    """'File:Name.jpg' from a commons.wikimedia.org/wiki/File: page (or an upload.wikimedia.org URL); else None."""
    for url in (page_url or "", image_url or ""):
        p = urllib.parse.urlsplit(url)
        if p.scheme != "https":
            continue
        if p.netloc == "commons.wikimedia.org" and p.path.startswith("/wiki/File:"):
            return urllib.parse.unquote(p.path[len("/wiki/"):]).replace("_", " ")
        if p.netloc == "upload.wikimedia.org" and p.path.startswith("/wikipedia/commons/"):
            parts = p.path.split("/")
            name = (parts[6] if len(parts) > 6 else None) if len(parts) > 3 and parts[3] == "thumb" else (
                parts[5] if len(parts) > 5 else None)
            if name:
                return "File:" + urllib.parse.unquote(name).replace("_", " ")
    return None


def loc_item_id(page_url):
    """'2013634629' from https://www.loc.gov/item/2013634629/ ; else None."""
    p = urllib.parse.urlsplit(page_url or "")
    if p.scheme == "https" and p.netloc == "www.loc.gov":
        m = re.fullmatch(r"/item/([0-9a-z]{6,20})/?", p.path)
        if m:
            return m.group(1)
    return None


def origin_of(asset):
    """('commons', title) | ('loc', item id) | ('other', host) | (None, reason). Hosts are recorded, not filtered
    (owner decision 2026-10-24: no licence check); only an image URL that is not https is refused."""
    url = asset.get("image_url") or ""
    if urllib.parse.urlsplit(url).scheme != "https":
        return None, "image URL not https"
    h = host(url)
    if h in HOSTS_COMMONS:
        title = commons_title(asset.get("source_page_url"), url)
        if title:
            return "commons", title
    if h in HOSTS_LOC:
        item = loc_item_id(asset.get("source_page_url"))
        if item:
            return "loc", item
    return "other", h


def evidence_ok(link, spine):
    """(ok, label or reason) for one court link."""
    cid = link.get("court_id")
    if cid not in spine:
        return False, "court id not in court_spine"
    ev = host(link.get("evidence_url"))
    rel = link.get("relationship")
    if rel not in RELATIONSHIP_LABEL:
        return False, f"relationship not recognised ({rel})"
    if ev == "uscourts.gov" or ev.endswith(".uscourts.gov"):
        return True, RELATIONSHIP_LABEL[rel]
    site = host(spine[cid].get("website") or "")
    if site and strip_www(ev) == strip_www(site):
        return True, OWN_SITE_LABEL if rel == "representative_building_source_link" else RELATIONSHIP_LABEL[rel]
    return False, f"evidence is not a U.S. Courts or court-website page ({ev or 'no url'})"


def former_building(asset):
    """Reason when the registry records the building as demolished or in former use; else None."""
    if (asset.get("building_lifecycle") or "") == "Former / historical use explicitly sourced":
        return "registry lifecycle: former / historical use"
    occ = asset.get("occupancy_statement") or ""
    if FORMER.search(occ) and not occ.startswith("Historic and current"):
        return f"registry occupancy: {occ}"
    return None


def court_leads(assets, spine):
    """(leads, held) -- one lead per (asset, court id) that passes the identity rules."""
    leads, held = [], []
    for a in assets:
        if a.get("entity_type") != "courthouse" or not a.get("court_links"):
            continue
        gone = former_building(a)
        kind, ref = origin_of(a)
        by_court = {}
        for link in a["court_links"]:
            ok, label = evidence_ok(link, spine)
            cid = link.get("court_id")
            if not ok:
                held.append({"asset_id": a["asset_id"], "court_id": cid, "reason": label})
                continue
            current = by_court.get(cid)
            # A court linked twice by one building keeps the representative (headquarters) link.
            if current is None or (link["relationship"] == "representative_building_source_link"
                                   and current[0]["relationship"] != "representative_building_source_link"):
                by_court[cid] = (link, label)
        for cid, (link, label) in sorted(by_court.items()):
            if gone:
                held.append({"asset_id": a["asset_id"], "court_id": cid, "reason": gone})
                continue
            if kind is None:
                held.append({"asset_id": a["asset_id"], "court_id": cid, "reason": ref})
                continue
            leads.append({
                "asset_id": a["asset_id"], "court_id": cid, "relationship": link["relationship"],
                "relationship_label": label, "evidence_url": link["evidence_url"],
                "registry_court_name": link.get("court_name") or "",
                "building": a.get("entity_name") or "", "building_entity": a.get("entity_id") or "",
                "street_address": a.get("street_address") or "", "city": a.get("city") or "",
                "state": a.get("state_code") or "", "latitude": a.get("latitude"), "longitude": a.get("longitude"),
                "origin": kind, "ref": ref, "registry_license": a.get("license") or "",
                "registry_author": a.get("author") or "", "registry_width": a.get("original_width"),
                "registry_visual": a.get("visual_review_status") or "", "lifecycle": a.get("building_lifecycle"),
            })
    return leads, held


def judge_leads(assets):
    leads, held = [], []
    for a in assets:
        if a.get("entity_type") != "judge":
            continue
        ids = a.get("source_ids") or a.get("external_ids") or {}
        slugs = list(ids.get("fjc_alpha_ids") or [])
        if len(slugs) != 1:
            reason = "two FJC ids on one registry person" if len(slugs) > 1 else (
                "no exact id path (state or special-court judge)" if a.get("selection_group") ==
                "state_or_special_court_judicial_biography" else "no FJC id")
            held.append({"asset_id": a["asset_id"], "reason": reason, "group": a.get("selection_group")})
            continue
        kind, ref = origin_of(a)
        if kind is None:
            held.append({"asset_id": a["asset_id"], "reason": ref})
            continue
        leads.append({"asset_id": a["asset_id"], "fjc_slug": slugs[0], "wikidata": ids.get("wikidata") or "",
                      "origin": kind, "ref": ref, "registry_license": a.get("license") or "",
                      "registry_author": a.get("author") or "", "registry_width": a.get("original_width"),
                      "image_date": a.get("image_date") or "", "name": a.get("entity_name") or ""})
    return leads, held


def agency_leads(assets, agency_ids):
    leads, held = [], []
    for a in assets:
        if a.get("entity_type") != "agency":
            continue
        kind_of = a.get("asset_type")
        role = "mark" if kind_of in ("seal", "logo") else "photo"
        fr = a.get("fr_id")
        if fr is None or str(fr) not in agency_ids:
            held.append({"asset_id": a["asset_id"], "reason": "no registry fr_id matching an agency page"})
            continue
        kind, ref = origin_of(a)
        if kind is None:
            held.append({"asset_id": a["asset_id"], "reason": ref})
            continue
        leads.append({"asset_id": a["asset_id"], "fr_id": str(fr), "role": role, "asset_type": kind_of,
                      "recommended_default": bool(a.get("recommended_default")),
                      "building": a.get("building_name") or "",
                      "photo_date": a.get("photo_date") or "", "identity_url": a.get("identity_evidence_url") or "",
                      "origin": kind, "ref": ref, "registry_license": a.get("license") or "",
                      "registry_author": a.get("author") or "", "registry_width": a.get("original_width"),
                      "registry_identity": a.get("identity_match_status") or "",
                      "registry_rights": a.get("rights_status") or ""})
    return leads, held


def committee_id(asset, committees):
    """Our congress_committees id for the registry's chamber + committee code, or None."""
    code = (asset.get("committee_id") or "").strip()
    chamber = asset.get("chamber")
    if chamber == "House" and re.fullmatch(r"[A-Z]{2}\d{2}", code):
        cid = "hs" + code.lower()  # House clerk code (JU00) -> Congress.gov system code (hsju00)
    elif chamber in ("Senate", "Joint") and re.fullmatch(r"[A-Z]{4}\d{2}", code):
        cid = code.lower()  # the registry already records the full system code (SSBK00 -> ssbk00)
    else:
        return None
    row = committees.get(cid)
    if not row or row["chamber"] != chamber or row["system_code"] != cid:
        return None
    if strip_www(host(row["website"])) != strip_www(host(asset.get("source_page_url"))):
        return None
    return cid


def committee_leads(assets, committees):
    leads, held = [], []
    for a in assets:
        if a.get("entity_type") != "committee":
            continue
        cid = committee_id(a, committees)
        if not cid:
            held.append({"asset_id": a["asset_id"], "reason": "no exact committee code + website match"})
            continue
        policy = [p["url"] for p in a.get("policy_evidence") or [] if p.get("url", "").endswith("/copyright")]
        leads.append({"asset_id": a["asset_id"], "committee": cid, "url": a.get("image_url") or "",
                      "source_page": a.get("source_page_url") or "", "policy_urls": policy,
                      "alternate": a["asset_id"].endswith("-alternate"), "mime": a.get("mime") or "",
                      "branding": a.get("branding_context") or "", "name": a.get("entity_name") or ""})
    return leads, held


def company_leads(assets, page_ciks):
    """Leads per entity (all its registry logo statements); the logo itself is chosen at Wikidata later."""
    ents = {}
    for a in assets:
        if a.get("entity_type") == "company":
            ents.setdefault(a["entity_id"], []).append(a)
    claims = {}
    for eid, rows in ents.items():
        for a in rows:
            for c in (a.get("external_ids") or {}).get("sec_cik_source_claims") or []:
                claims.setdefault(c, set()).add(eid)
    leads, held = [], []
    for eid, rows in sorted(ents.items()):
        ciks = sorted({c for a in rows for c in (a.get("external_ids") or {}).get("sec_cik_source_claims") or []})
        reason = None
        if not ciks:
            reason = "no CIK claim"
        elif len(ciks) > 1:
            reason = "two or more CIK claims"
        elif len(claims[ciks[0]]) > 1:
            reason = "CIK claimed by another registry entity"
        elif ciks[0] not in page_ciks:
            reason = "no company page for this CIK"
        if reason:
            held.append({"entity_id": eid, "assets": [a["asset_id"] for a in rows], "reason": reason})
            continue
        qid = rows[0].get("wikidata_id") or (rows[0].get("external_ids") or {}).get("wikidata") or ""
        leads.append({"entity_id": eid, "cik": ciks[0], "wikidata": qid, "name": rows[0].get("entity_name") or "",
                      "statements": [{"asset_id": a["asset_id"], "file": a.get("file_title") or "",
                                      "statement_id": a.get("statement_id") or "", "rank": a.get("statement_rank"),
                                      "registry_license": a.get("license") or ""} for a in rows]})
    return leads, held


def state_leads(page_rows, design_assets):
    leads, held = [], []
    for r in page_rows:
        if r.get("Page family") != "state":
            continue
        code = r.get("State code") or ""
        title = commons_title(r.get("Default source URL"), r.get("Default original image URL"))
        if r.get("Default asset kind") != "photograph" or not title or not re.fullmatch(r"[A-Z]{2}", code):
            held.append({"state": code, "reason": f"default asset is a {r.get('Default asset kind')}, not a photograph"})
            continue
        da = design_assets.get(r.get("Default asset ID")) or {}
        subject = (da.get("Name / subject") or "").split(" — ")[0].strip()
        leads.append({"state": code, "asset_id": r.get("Default asset ID"), "origin": "commons", "ref": title,
                      "building": subject, "state_name": r.get("State / territory name") or "",
                      "registry_license": da.get("License / rights statement") or "",
                      "registry_author": da.get("Creator / source credit") or ""})
    return leads, held
