"""Independent check of the visual-registry build files (offline).

  python3 -I -B verify_visual_registry.py

1. CONTRACT.md build-file rules (the same rules publish_build.py validates offline): dataset id format, required
   keys, rows present, unique ids, dataset/category equal to the dataset, no ordinal, a source_url and a title on
   every row, JSON round-trip stable.
2. court_images: the first 189 rows equal the existing build's rows exactly and in order.
3. Field names and types the UI codes against (WORKER_RULES_VIS.md, plus rights_status and license_family).
4. Every URL is https; derived Wikimedia thumbnails are at a standard width equal to the stated width.
5. Second path: every image object is re-read from the registry record by asset id (or the workbook row) and its
   licence, rights status, author and image URL compared with what the registry recorded.
6. Identity: court ids in court_spine with official evidence; agency, committee and CIK ids in the md5-checked
   lookups; no ARTWORK title among building photographs; no building recorded as demolished or former.
Prints failure counts per check; exit status 1 when any check fails.
"""
import json
import re
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "court_images"))
from build_court_images import ARTWORK  # noqa: E402
from vr_common import BUILD, COURT_SPINE, ROOT, load_registry  # noqa: E402

DATASETS = ["court_images", "court_buildings", "judge_portraits_open", "agency_images", "committee_marks",
            "company_logos_open", "state_capitol_images"]
FAMILIES = {"public domain", "cc0", "cc by", "cc by-sa", "other"}
STD = {330, 500, 960, 1280, 1920}
PHOTO = {"file_page", "display", "thumb", "license", "license_family", "license_url", "license_url_is_deed", "author",
         "credit", "verified_at", "rights_status"}
PORTRAIT = {"display", "thumb", "file_page", "license", "license_family", "license_url", "license_url_is_deed",
            "author", "credit", "image_date", "verified_at", "rights_status"}
AGENCY_PHOTO = {"building", "photo_date", "display", "thumb", "source_page", "license", "license_family",
                "license_url", "license_url_is_deed", "author", "credit_line", "occupancy_note", "verified_at",
                "rights_status"}
MARK = {"url", "width", "height", "mime", "source_page", "policy_url", "policy_quote", "branding_note", "verified_at",
        "rights_status"}
LOGO = {"display", "thumb", "file_page", "license", "license_family", "license_url", "license_url_is_deed", "author",
        "wikidata", "statement_id", "trademark_note", "verified_at", "rights_status"}
BUILDING = {"asset_id", "building", "street_address", "city", "state", "latitude", "longitude", "relationship_label",
            "evidence_url", "photo"}


class Fail:
    def __init__(self):
        self.counts = Counter()
        self.examples = {}

    def __call__(self, check, ok, example=""):
        if not ok:
            self.counts[check] += 1
            self.examples.setdefault(check, example)


def contract(build):
    problems = []
    ds = build.get("dataset", "")
    if not re.fullmatch(r"[a-z0-9_]{1,80}", ds or ""):
        problems.append("bad dataset id")
    for key in ("label", "listing_block", "summary", "rows", "built_at", "inputs"):
        if key not in build:
            problems.append(f"missing {key}")
    rows = build.get("rows") or []
    if not rows:
        problems.append("no rows")
    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)):
        problems.append("duplicate ids")
    for r in rows:
        if r.get("dataset") != ds or r.get("category") != ds:
            problems.append(f"{r.get('id')}: dataset/category")
        if "ordinal" in r:
            problems.append(f"{r.get('id')}: ordinal")
        if not str(r.get("source_url") or "").startswith(("http://", "https://", "/")):
            problems.append(f"{r.get('id')}: source_url")
        if not str(r.get("title") or "").strip():
            problems.append(f"{r.get('id')}: title")
    if json.loads(json.dumps(rows)) != rows:
        problems.append("not JSON round-trip stable")
    return problems


def https(url):
    p = urllib.parse.urlsplit(url or "")
    return p.scheme == "https" and bool(p.netloc)


def rendition_ok(r):
    if not (isinstance(r, dict) and https(r.get("url")) and isinstance(r.get("width"), int) and
            isinstance(r.get("height"), int) and r["width"] > 0 and r["height"] > 0):
        return False
    m = re.search(r"/wikipedia/commons/thumb/.+/(?:lossy-page\d+-)?(\d+)px-[^/]+$", urllib.parse.urlsplit(r["url"]).path)
    return not m or (int(m.group(1)) in STD and int(m.group(1)) == r["width"])


def family_of(text):
    t = " ".join((text or "").lower().split())
    for pattern, fam in ((r"public domain\b", "public domain"), (r"cc0\b", "cc0"), (r"cc by-sa \d", "cc by-sa"),
                         (r"cc by \d", "cc by")):
        if re.match(pattern, t):
            return fam
    return "other"


def check_image(fail, ds, obj, keys, asset, url_key="display"):
    fail(f"{ds}: field names", keys <= set(obj), sorted(keys - set(obj)))
    fail(f"{ds}: license_family", obj.get("license_family") in FAMILIES, obj.get("license_family"))
    if url_key in ("display",):
        fail(f"{ds}: renditions", rendition_ok(obj.get("display")) and rendition_ok(obj.get("thumb")), obj.get("display"))
    page = obj.get("file_page") or obj.get("source_page")
    fail(f"{ds}: source page https", https(page) or (ds in ("agency_images", "committee_marks") and page is None), page)
    if asset is None:
        fail(f"{ds}: registry record found", False, obj.get("asset_id"))
        return
    fail(f"{ds}: rights_status as recorded", obj.get("rights_status") == (asset.get("rights_status") or "Not recorded"),
         (obj.get("rights_status"), asset.get("rights_status")))
    lic = (asset.get("license") or "").strip() or "Not recorded"
    fail(f"{ds}: licence as recorded", obj.get("license", lic) == lic, (obj.get("license"), lic))
    fail(f"{ds}: licence family from recorded text", obj.get("license_family") == family_of(asset.get("license")),
         (obj.get("license_family"), asset.get("license")))
    if "author" in obj:
        rec_author = next((asset.get(k).strip() for k in ("author", "creator_credit")
                           if isinstance(asset.get(k), str) and asset.get(k).strip()), None)
        fail(f"{ds}: author as recorded", obj["author"] == rec_author, (obj["author"], rec_author))
    image = asset.get("image_url") or ""
    if url_key == "display":
        disp = obj["display"]["url"]
        name = urllib.parse.urlsplit(image).path.rsplit("/", 1)[-1]
        fail(f"{ds}: image URL derived from the recorded image", disp == image or (name and name in disp) or
             disp == asset.get("thumbnail_url"), (disp, image))
    else:
        fail(f"{ds}: mark URL as recorded", obj.get("url") == image, (obj.get("url"), image))


def main():
    fail = Fail()
    assets = {a["asset_id"]: a for a in load_registry()["assets"]}
    spine = {r["id"]: r for r in json.load(open(COURT_SPINE))}
    lk = {n: json.load(open(BUILD / "lookups" / f"{n}.json"))["data"] for n in
          ("fr_agencies", "committees", "company_profiles", "committee_titles")}
    builds = {ds: json.load(open(BUILD / f"{ds}.json")) for ds in DATASETS}
    for ds, b in builds.items():
        problems = contract(b)
        fail(f"{ds}: contract", not problems, problems[:3])
        fail(f"{ds}: dataset name", b["dataset"] == ds, b["dataset"])
    existing = json.load(open(ROOT / "private" / "build" / "court_images" / "court_images.json"))["rows"]
    ci = builds["court_images"]["rows"]
    fail("court_images: existing 189 rows unchanged and first", [json.dumps(r, sort_keys=True) for r in ci[:189]] ==
         [json.dumps(r, sort_keys=True) for r in existing], "rows differ")
    for r in ci[189:]:
        p = r["item"]["photo"]
        fail("court_images: new row court id in spine", r["id"] in spine, r["id"])
        fail("court_images: new row has rights_status", "rights_status" in p, r["id"])
        fail("court_images: new row renditions", rendition_ok(p["display"]) and rendition_ok(p["thumb"]), r["id"])
    for r in builds["court_buildings"]["rows"]:
        fail("court_buildings: court id in spine", r["id"] in spine, r["id"])
        bs = r["item"]["buildings"]
        fail("court_buildings: 1-12 buildings", 1 <= len(bs) <= 12, len(bs))
        fail("court_buildings: counts", r["item"]["counts"]["buildings_shown"] == len(bs) <=
             r["item"]["counts"]["buildings_listed"], r["item"]["counts"])
        for b in bs:
            fail("court_buildings: building field names", BUILDING <= set(b), sorted(BUILDING - set(b)))
            a = assets.get(b["asset_id"])
            check_image(fail, "court_buildings", b["photo"], PHOTO, a)
            if a:
                link = [l for l in a.get("court_links") or [] if l["court_id"] == r["id"] and
                        l["evidence_url"] == b["evidence_url"]]
                ev = urllib.parse.urlsplit(b["evidence_url"]).netloc
                site = urllib.parse.urlsplit(spine[r["id"]].get("website") or "").netloc.removeprefix("www.")
                fail("court_buildings: link recorded for this court", bool(link), (r["id"], b["asset_id"]))
                fail("court_buildings: official evidence", ev.endswith("uscourts.gov") or ev.removeprefix("www.") == site, ev)
                fail("court_buildings: no artwork title", not ARTWORK.search(a.get("source_title") or ""),
                     a.get("source_title"))
                occ = a.get("occupancy_statement") or ""
                fail("court_buildings: not former/demolished", a.get("building_lifecycle") !=
                     "Former / historical use explicitly sourced" and not re.search(r"(?i)demoli|\bformer\b", occ)
                     or occ.startswith("Historic and current"), occ)
    for r in builds["judge_portraits_open"]["rows"]:
        fail("judge_portraits_open: 32-hex judge id", bool(re.fullmatch(r"[0-9a-f]{32}", r["id"])), r["id"])
        ident = r["item"]["identity"]
        fail("judge_portraits_open: identity fields", {"wikidata", "fjc_slug", "fjc_nid", "fjc_url"} <= set(ident), ident)
        aid = next((f[1] for f in r["detail"]["facts"] if f[0] == "Registry asset"), None)
        check_image(fail, "judge_portraits_open", r["item"]["portrait"], PORTRAIT, assets.get(aid))
        if ident.get("basis") == "fjc_node_id":
            fail("judge_portraits_open: FJC id as recorded",
                 ident["fjc_slug"] in ((assets.get(aid) or {}).get("source_ids") or {}).get("fjc_alpha_ids", []), aid)
    for r in builds["agency_images"]["rows"]:
        fail("agency_images: agency id in lookup", r["id"] in lk["fr_agencies"], r["id"])
        fail("agency_images: <= 3 photos", len(r["item"]["photos"]) <= 3, r["id"])
        for p in r["item"]["photos"]:
            a = assets.get(p.get("asset_id"))
            fail("agency_images: photo of this agency", str((a or {}).get("fr_id")) == r["id"], p.get("asset_id"))
            check_image(fail, "agency_images", {**p, "file_page": p["source_page"]}, AGENCY_PHOTO, a)
        for m in r["item"]["marks"]:
            a = assets.get(m.get("asset_id"))
            fail("agency_images: mark of this agency", str((a or {}).get("fr_id")) == r["id"], m.get("asset_id"))
            fail("agency_images: mark is a seal or logo", (a or {}).get("asset_type") in ("seal", "logo"), m.get("asset_id"))
            check_image(fail, "agency_images", m, MARK, a, url_key="url")
    for r in builds["committee_marks"]["rows"]:
        fail("committee_marks: committee id in lookup", r["id"] in lk["committees"] and r["id"] in lk["committee_titles"],
             r["id"])
        m = r["item"]["mark"]
        fail("committee_marks: mark https", https(m["url"]), m["url"])
        a = next((x for x in assets.values() if x.get("entity_type") == "committee" and x.get("image_url") == m["url"]),
                 None)
        check_image(fail, "committee_marks", m, MARK, a, url_key="url")
        if a:
            site = urllib.parse.urlsplit(lk["committees"][r["id"]]["website"]).netloc.removeprefix("www.")
            fail("committee_marks: same website host", urllib.parse.urlsplit(a["source_page_url"]).netloc.removeprefix(
                "www.") == site, r["id"])
    claims = Counter()
    for a in assets.values():
        if a.get("entity_type") == "company":
            for c in set((a.get("external_ids") or {}).get("sec_cik_source_claims") or []):
                claims[(c, a["entity_id"])] += 1
    by_cik = Counter(c for c, _ in claims)
    for r in builds["company_logos_open"]["rows"]:
        fail("company_logos_open: CIK has a company page", r["id"] in lk["company_profiles"], r["id"])
        fail("company_logos_open: CIK claimed by one registry entity", by_cik[r["id"]] == 1, r["id"])
        logo = r["item"]["logo"]
        fail("company_logos_open: trademark note", logo.get("trademark_note", "").startswith("Logo shown to identify"), r["id"])
        a = next((x for x in assets.values() if x.get("entity_type") == "company" and x.get("statement_id") ==
                  logo["statement_id"]), None)
        check_image(fail, "company_logos_open", logo, LOGO, a)
    for r in builds["state_capitol_images"]["rows"]:
        fail("state_capitol_images: 2-letter id", bool(re.fullmatch(r"[A-Z]{2}", r["id"])), r["id"])
        p = r["item"]["photo"]
        fail("state_capitol_images: field names", PHOTO | {"building"} <= set(p), sorted(PHOTO - set(p)))
        fail("state_capitol_images: renditions", rendition_ok(p["display"]) and rendition_ok(p["thumb"]), r["id"])
        fail("state_capitol_images: licence family", p["license_family"] == family_of(p["license"]), r["id"])
    total = sum(fail.counts.values())
    checked = {ds: len(b["rows"]) for ds, b in builds.items()}
    print(json.dumps({"rows": checked, "failures": dict(fail.counts), "examples": {k: str(v)[:200] for k, v in
                                                                               fail.examples.items()},
                      "total_failures": total}, indent=1))
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
