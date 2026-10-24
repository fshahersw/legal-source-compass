"""Offline tests for the visual-registry builders (synthetic fixtures, no network).

cd scripts/enrichment/visual_registry && python3 -B -m unittest -v test_visual_registry
"""
import gzip
import json
import tempfile
import unittest
from pathlib import Path

import build_visual_registry as bvr
import origin as og
import recorded as rec
import registry as rg
import state_judges as sj

SPINE = {
    "ca10": {"id": "ca10", "title": "Court of Appeals for the Tenth Circuit", "system": "Federal",
             "website": "http://www.ca10.uscourts.gov/"},
    "ga": {"id": "ga", "title": "Supreme Court of Georgia", "system": "State", "website": "http://www.gasupreme.us/"},
    "guam": {"id": "guam", "title": "Supreme Court of Guam", "system": "Territory",
             "website": "http://www.guamsupremecourt.com"},
}
HIGHSMITH_TEXT = ("Carol M. Highsmith's photographs are in the public domain. Ms. Highsmith has stipulated that her "
                  "photographs are in the public domain.")
STATEMENTS = {"482_high.html": HIGHSMITH_TEXT, "123_abc.html": "Rights status not evaluated. No known restrictions."}


def ext(**fields):
    return {k: {"value": v} for k, v in fields.items()}


def court_asset(asset_id="a1", links=None, image="https://upload.wikimedia.org/wikipedia/commons/4/40/X.jpg",
                page="https://commons.wikimedia.org/wiki/File:X.jpg", lifecycle="Current official listing",
                occupancy="Mapped as a courthouse; current occupancy unverified", license="CC BY-SA 4.0"):
    return {"asset_id": asset_id, "entity_type": "courthouse", "entity_id": "BLD-1", "entity_name": "Byron White",
            "image_url": image, "source_page_url": page, "license": license, "building_lifecycle": lifecycle,
            "occupancy_statement": occupancy, "street_address": "1823 Stout Street", "city": "Denver",
            "state_code": "CO", "latitude": 39.7, "longitude": -104.9, "court_links": links if links is not None else [
                {"court_id": "ca10", "court_name": "Court of Appeals for the Tenth Circuit",
                 "relationship": "official_location_named_or_address_match",
                 "evidence_url": "https://www.uscourts.gov/federal-court-finder/location/250"}]}


class CourtIdentity(unittest.TestCase):
    def test_uscourts_evidence_accepted_with_recorded_label(self):
        ok, label = rg.evidence_ok({"court_id": "ca10", "relationship": "representative_building_source_link",
                                    "evidence_url": "https://www.uscourts.gov/federal-court-finder/location/250"}, SPINE)
        self.assertTrue(ok)
        self.assertEqual(label, "Headquarters listed by U.S. Courts")

    def test_usgs_and_encyclopedia_evidence_held(self):
        ok, why = rg.evidence_ok({"court_id": "ga", "relationship": "representative_building_source_link",
                                  "evidence_url": "https://carto.nationalmap.gov/arcgis/rest/x"}, SPINE)
        self.assertFalse(ok)
        self.assertIn("carto.nationalmap.gov", why)

    def test_court_own_website_must_equal_spine_website(self):
        ok, label = rg.evidence_ok({"court_id": "ga", "relationship": "representative_building_source_link",
                                    "evidence_url": "https://www.gasupreme.us/court-information/directions/"}, SPINE)
        self.assertTrue(ok)
        self.assertEqual(label, rg.OWN_SITE_LABEL)
        ok, _ = rg.evidence_ok({"court_id": "guam", "relationship": "representative_building_source_link",
                                "evidence_url": "https://www.guamcourts.gov/quick-assist"}, SPINE)
        self.assertFalse(ok)

    def test_unknown_court_id_held(self):
        ok, why = rg.evidence_ok({"court_id": "nope", "relationship": "official_location_named_or_address_match",
                                  "evidence_url": "https://www.uscourts.gov/x"}, SPINE)
        self.assertFalse(ok)
        self.assertEqual(why, "court id not in court_spine")

    def test_demolished_and_former_buildings_dropped(self):
        leads, held = rg.court_leads([court_asset(occupancy="historic demolished")], SPINE)
        self.assertEqual(leads, [])
        self.assertIn("demolished", held[0]["reason"])
        leads, held = rg.court_leads([court_asset(lifecycle="Former / historical use explicitly sourced")], SPINE)
        self.assertEqual(leads, [])
        self.assertIn("former", held[0]["reason"])
        leads, _ = rg.court_leads([court_asset(occupancy="Historic and current federal buildings; current occupancy "
                                                         "unverified")], SPINE)
        self.assertEqual(len(leads), 1)

    def test_any_https_host_kept_as_recorded_but_http_refused(self):
        # Owner decision 2026-10-24: no licence check, so an FJC-hosted "Not assessed" photo is a lead.
        leads, held = rg.court_leads([court_asset(image="https://www.fjc.gov/sites/default/files/courthouses/x.jpg",
                                                  page="https://www.fjc.gov/history/courthouse/x",
                                                  license="Not assessed; credit original repository")], SPINE)
        self.assertEqual([(lead["origin"], lead["ref"]) for lead in leads], [("other", "www.fjc.gov")])
        self.assertEqual(held, [])
        leads, held = rg.court_leads([court_asset(image="http://example.org/x.jpg")], SPINE)
        self.assertEqual(leads, [])
        self.assertEqual(held[0]["reason"], "image URL not https")

    def test_one_lead_per_court_prefers_representative_link(self):
        links = [{"court_id": "ca10", "court_name": "x", "relationship": "official_location_named_or_address_match",
                  "evidence_url": "https://www.uscourts.gov/a"},
                 {"court_id": "ca10", "court_name": "x", "relationship": "representative_building_source_link",
                  "evidence_url": "https://www.uscourts.gov/b"}]
        leads, _ = rg.court_leads([court_asset(links=links)], SPINE)
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["relationship"], "representative_building_source_link")

    def test_commons_and_loc_origins(self):
        self.assertEqual(rg.origin_of(court_asset()), ("commons", "File:X.jpg"))
        loc = court_asset(image="https://tile.loc.gov/image-services/iiif/service:pnp:highsm:1/full/pct:25/0/default.jpg",
                          page="https://www.loc.gov/item/2013634629/")
        self.assertEqual(rg.origin_of(loc), ("loc", "2013634629"))


class OtherIdentity(unittest.TestCase):
    def test_judge_needs_exactly_one_fjc_id(self):
        base = {"entity_type": "judge", "image_url": "https://upload.wikimedia.org/wikipedia/commons/5/58/J.jpg",
                "source_page_url": "https://commons.wikimedia.org/wiki/File:J.jpg"}
        leads, held = rg.judge_leads([
            {**base, "asset_id": "j1", "source_ids": {"wikidata": "Q1", "fjc_alpha_ids": ["smith-a"]}},
            {**base, "asset_id": "j2", "source_ids": {"wikidata": "Q2", "fjc_alpha_ids": ["a", "b"]}},
            {**base, "asset_id": "j3", "source_ids": {"wikidata": "Q3", "fjc_alpha_ids": []},
             "selection_group": "state_or_special_court_judicial_biography"}])
        self.assertEqual([lead["asset_id"] for lead in leads], ["j1"])
        self.assertEqual(sorted(h["reason"] for h in held),
                         ["no exact id path (state or special-court judge)", "two FJC ids on one registry person"])

    def test_duplicated_cik_is_held(self):
        def logo(aid, eid, ciks):
            return {"asset_id": aid, "entity_type": "company", "entity_id": eid, "wikidata_id": eid.split(":")[1],
                    "external_ids": {"sec_cik_source_claims": ciks}, "file_title": f"File:{aid}.svg"}
        leads, held = rg.company_leads([logo("a", "wikidata:Q1", ["0000000001"]),
                                        logo("b", "wikidata:Q2", ["0000000001"]),
                                        logo("c", "wikidata:Q3", ["0000000003", "0000000004"]),
                                        logo("d", "wikidata:Q4", ["0000000005"]),
                                        logo("e", "wikidata:Q5", ["0000000009"])],
                                       {"0000000001", "0000000003", "0000000005"})
        self.assertEqual([lead["cik"] for lead in leads], ["0000000005"])
        reasons = {h["entity_id"]: h["reason"] for h in held}
        self.assertEqual(reasons["wikidata:Q1"], "CIK claimed by another registry entity")
        self.assertEqual(reasons["wikidata:Q2"], "CIK claimed by another registry entity")
        self.assertEqual(reasons["wikidata:Q3"], "two or more CIK claims")
        self.assertEqual(reasons["wikidata:Q5"], "no company page for this CIK")

    def test_committee_exact_code_and_website(self):
        committees = {"hsju00": {"chamber": "House", "system_code": "hsju00", "website": "https://judiciary.house.gov/"}}
        a = {"committee_id": "JU00", "chamber": "House", "source_page_url": "https://judiciary.house.gov/"}
        self.assertEqual(rg.committee_id(a, committees), "hsju00")
        self.assertIsNone(rg.committee_id({**a, "source_page_url": "https://example.house.gov/"}, committees))
        self.assertIsNone(rg.committee_id({**a, "chamber": "Senate"}, committees))
        self.assertIsNone(rg.committee_id({**a, "committee_id": "AG00"}, committees))
        # Any recorded licence is accepted now; identity still needs the exact code and website.
        leads, held = rg.committee_leads([{**a, "asset_id": "m", "entity_type": "committee",
                                           "license": "Pending file-specific policy and visual review"}], committees)
        self.assertEqual([lead["committee"] for lead in leads], ["hsju00"])
        self.assertEqual(held, [])

    def test_senate_and_joint_codes_are_recorded_system_codes(self):
        committees = {"ssbk00": {"chamber": "Senate", "system_code": "ssbk00", "website": "https://www.banking.senate.gov/"},
                      "hlig00": {"chamber": "House", "system_code": "hlig00", "website": "https://intelligence.house.gov/"}}
        a = {"committee_id": "SSBK00", "chamber": "Senate", "source_page_url": "https://www.banking.senate.gov//"}
        self.assertEqual(rg.committee_id(a, committees), "ssbk00")
        self.assertIsNone(rg.committee_id({**a, "chamber": "Joint"}, committees))
        # House clerk code IG00 is not hs + code in our data (hlig00): held, never guessed.
        self.assertIsNone(rg.committee_id({"committee_id": "IG00", "chamber": "House",
                                           "source_page_url": "https://intelligence.house.gov/"}, committees))

    def test_agency_marks_included_and_fr_id_exact(self):
        rows = [{"asset_id": "s", "entity_type": "agency", "asset_type": "seal", "fr_id": 160,
                 "image_url": "https://agency-logos.federalregister.gov/160/medium.png",
                 "source_page_url": "https://www.federalregister.gov/agencies/x"},
                {"asset_id": "b1", "entity_type": "agency", "asset_type": "building", "fr_id": 160,
                 "image_url": "https://tile.loc.gov/x", "source_page_url": "https://www.loc.gov/item/2013634629/"},
                {"asset_id": "b2", "entity_type": "agency", "asset_type": "building", "fr_id": 999,
                 "image_url": "https://tile.loc.gov/x", "source_page_url": "https://www.loc.gov/item/2013634629/"}]
        leads, held = rg.agency_leads(rows, {"160"})
        self.assertEqual(sorted((lead["asset_id"], lead["role"]) for lead in leads), [("b1", "photo"), ("s", "mark")])
        self.assertEqual({h["asset_id"]: h["reason"] for h in held}, {"b2": "no registry fr_id matching an agency page"})

    def test_judge_with_existing_portrait_is_skipped(self):
        nid_lookup = {"100": {"title": "A", "judge_profile": ["p1"]}, "200": {"title": "B", "judge_profile": ["p2"]},
                      "300": {"title": "C", "judge_profile": ["p3"]}, "400": {"title": "D", "judge_profile": []}}
        photos = {"p1": True, "p2": False, "p3": False}
        portraits = {"p3": 77}
        self.assertEqual(bvr.judge_target("100", nid_lookup, photos, portraits)[1],
                         "judge page already has a portrait (kept)")
        self.assertEqual(bvr.judge_target("300", nid_lookup, photos, portraits)[1],
                         "judge page already has a portrait (kept)")
        self.assertEqual(bvr.judge_target("200", nid_lookup, photos, portraits), ("p2", None))
        self.assertEqual(bvr.judge_target("400", nid_lookup, photos, portraits)[1],
                         "judge_profiles_fjc row has no single judge profile")
        self.assertEqual(bvr.judge_target("999", nid_lookup, photos, portraits)[1],
                         "no judge_profiles_fjc row with this FJC node id")


class LocRights(unittest.TestCase):
    RIGHTS = ['<p>For information see: <a href="https://www.loc.gov/rr/print/res/482_high.html">Carol M. Highsmith - '
              'Rights and Restrictions Information</a></p>']

    def test_highsmith_rule(self):
        item = {"rights": self.RIGHTS, "contributor_names": ["Highsmith, Carol M., 1946-, photographer"],
                "rights_advisory": "No known restrictions on publication."}
        self.assertEqual(og.loc_rights(item, STATEMENTS), ("highsmith", None))

    def test_highsmith_link_but_other_photographer(self):
        item = {"rights": self.RIGHTS, "contributor_names": ["Doe, Jane, photographer"]}
        self.assertIsNone(og.loc_rights(item, STATEMENTS)[0])

    def test_no_known_restrictions_alone_is_not_public_domain(self):
        item = {"rights": ['<a href="https://www.loc.gov/rr/print/res/123_abc.html">x</a>'],
                "contributor_names": ["Highsmith, Carol M., 1946-, photographer"],
                "rights_advisory": "No known restrictions on publication."}
        basis, why = og.loc_rights(item, STATEMENTS)
        self.assertIsNone(basis)
        self.assertIn("No known restrictions", why)

    def test_loc_photo_needs_measured_iiif_sizes(self):
        item = {"item": {"rights": self.RIGHTS, "contributor_names": ["Highsmith, Carol M., 1946-, photographer"],
                         "title": "FBI Headquarters Building", "id": "http://www.loc.gov/item/2013634629/",
                         "url": "https://www.loc.gov/item/2013634629/", "reproduction_number":
                             "LC-DIG-highsm-25144 (original digital file)", "created_published": ["2012 March."],
                         "resources": [{"files": [[{"info": "https://tile.loc.gov/image-services/iiif/service:pnp:"
                                                            "highsm:25100:25144/info.json", "width": 6144,
                                                    "height": 2436}]]}]}}
        photo, why, pending = og.loc_photo(item, STATEMENTS, {})
        self.assertIsNone(photo)
        self.assertEqual(len(pending), 2)
        base = "https://tile.loc.gov/image-services/iiif/service:pnp:highsm:25100:25144/full/"
        measured = {base + "960,/0/default.jpg": {"status": 200, "width": 960, "height": 380},
                    base + "330,/0/default.jpg": {"status": 200, "width": 330, "height": 130}}
        photo, why, _ = og.loc_photo(item, STATEMENTS, measured)
        self.assertEqual(photo["license_family"], "public domain")
        self.assertEqual(photo["credit"], "Library of Congress, Prints & Photographs Division, photograph by Carol M. "
                                          "Highsmith [LC-DIG-highsm-25144]")
        self.assertEqual(photo["display"], {"url": base + "960,/0/default.jpg", "width": 960, "height": 380})
        self.assertFalse(photo["license_url_is_deed"])
        sculpture = json.loads(json.dumps(item))
        sculpture["item"]["title"] = "Statue of Justice, Washington"
        self.assertIn("artwork", og.loc_photo(sculpture, STATEMENTS, measured)[1])


class FakeCommons:
    """Minimal stand-in for origin.Commons built from synthetic imageinfo pages."""

    def __init__(self, title, width, ext_meta, mime="image/jpeg", cats=()):
        def page(w):
            name = title.removeprefix("File:").replace(" ", "_")
            url = (f"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/{name}/{w}px-{name}"
                   if width > w or mime == "image/svg+xml" else f"https://upload.wikimedia.org/wikipedia/commons/a/ab/{name}")
            tw = w if (width > w or mime == "image/svg+xml") else width
            return {"title": title, "imageinfo": [{
                "url": f"https://upload.wikimedia.org/wikipedia/commons/a/ab/{name}", "width": width,
                "height": width // 2, "mime": mime, "sha1": "x", "descriptionurl": f"https://commons.wikimedia.org/wiki/{name}",
                "thumburl": url, "thumbwidth": tw, "thumbheight": tw // 2, "extmetadata": ext_meta}]}
        self.display = ({title: page(960)}, {})
        self.mid = ({title: page(500)}, {})
        self.thumb = ({title: page(330)}, {})
        self.retrieved = {title: "2026-10-24T06:00:00Z"}
        self._cats = list(cats)

    def page(self, title):
        return self.display[0].get(title)

    def cats(self, title):
        return self._cats


class CommonsRules(unittest.TestCase):
    def test_kept_cc_by_sa_with_author_and_deed(self):
        c = FakeCommons("File:Court.jpg", 4000, ext(LicenseShortName="CC BY-SA 4.0", License="cc-by-sa-4.0",
                                                     LicenseUrl="https://creativecommons.org/licenses/by-sa/4.0",
                                                     Artist="<a href='x'>Jane Doe</a>"))
        photo, why = og.commons_photo(c, "File:Court.jpg", "building")
        self.assertIsNone(why)
        self.assertEqual(photo["display"]["width"], 960)
        self.assertEqual(photo["thumb"]["width"], 330)
        self.assertEqual(photo["author"], "Jane Doe")
        self.assertEqual(photo["credit"], "Jane Doe · CC BY-SA 4.0")
        self.assertTrue(photo["license_url_is_deed"])

    def test_public_domain_basis_from_categories(self):
        c = FakeCommons("File:Judge.jpg", 800, ext(LicenseShortName="Public domain", License="pd"),
                        cats=["Judge X", "PD US Government"])
        photo, _ = og.commons_photo(c, "File:Judge.jpg", "portrait")
        self.assertEqual(photo["credit"], "Public domain (U.S. government work)")
        self.assertEqual(photo["display"]["width"], 500)
        self.assertFalse(photo["license_url_is_deed"])
        self.assertTrue(photo["license_url"].endswith("#Licensing"))

    def test_excluded_licences_and_shapes(self):
        nc = FakeCommons("File:A.jpg", 4000, ext(LicenseShortName="CC BY-NC 2.0", License="cc-by-nc-2.0"))
        self.assertIn("NC", og.commons_photo(nc, "File:A.jpg", "building")[1])
        attribution = FakeCommons("File:A.jpg", 4000, ext(LicenseShortName="Attribution", License="attribution"))
        self.assertIn("other licence", og.commons_photo(attribution, "File:A.jpg", "building")[1])
        art = FakeCommons("File:Statue of Justice.jpg", 4000, ext(LicenseShortName="Public domain", License="pd"))
        self.assertIn("artwork", og.commons_photo(art, "File:Statue of Justice.jpg", "building")[1])
        small = FakeCommons("File:Small.jpg", 300, ext(LicenseShortName="Public domain", License="pd"))
        self.assertIn("too small", og.commons_photo(small, "File:Small.jpg", "portrait")[1])
        self.assertIn("500 px", og.commons_photo(small, "File:Small.jpg", "building")[1])
        no_author = FakeCommons("File:N.jpg", 4000, ext(LicenseShortName="CC BY 2.0", License="cc-by-2.0",
                                                        LicenseUrl="https://creativecommons.org/licenses/by/2.0"))
        self.assertIn("names no author", og.commons_photo(no_author, "File:N.jpg", "building")[1])

    def test_vector_logo_has_standard_renditions(self):
        c = FakeCommons("File:Logo.svg", 120, ext(LicenseShortName="Public domain", License="pd"), mime="image/svg+xml",
                        cats=["PD textlogo"])
        photo, why = og.commons_photo(c, "File:Logo.svg", "logo")
        self.assertIsNone(why)
        self.assertEqual((photo["display"]["width"], photo["thumb"]["width"]), (500, 330))
        self.assertIn("threshold of originality", photo["credit"])


class Wikidata(unittest.TestCase):
    @staticmethod
    def entity(**props):
        claims = {}
        for prop, values in props.items():
            claims[prop] = [{"id": f"Q1${i}", "rank": rank, "mainsnak": {"snaktype": "value", "datavalue": {"value": v}},
                             "qualifiers": ({"P582": [{"datavalue": {"value": {"time": end}}}]} if end else {})}
                            for i, (v, rank, end) in enumerate(values)]
        return {"id": "Q1", "claims": claims}

    def test_company_logo_preferred_or_sole_normal(self):
        e = self.entity(P5531=[("66740", "normal", None)], P154=[("A logo.svg", "preferred", None),
                                                                ("Old logo.svg", "normal", "+2000")])
        logo, why = og.company_logo(e, "0000066740")
        self.assertEqual(logo["file"], "File:A logo.svg")
        e = self.entity(P5531=[("0000066740", "normal", None)], P154=[("Only.svg", "normal", None)])
        self.assertEqual(og.company_logo(e, "0000066740")[0]["file"], "File:Only.svg")
        e = self.entity(P5531=[("0000066740", "normal", None)], P154=[("A.svg", "normal", None), ("B.svg", "normal", None)])
        self.assertIn("none preferred", og.company_logo(e, "0000066740")[1])
        e = self.entity(P5531=[("0000066740", "normal", None)], P154=[("A.svg", "preferred", "+2020")])
        self.assertIn("end time", og.company_logo(e, "0000066740")[1])

    def test_company_cik_must_match_exactly_once(self):
        e = self.entity(P5531=[("1", "normal", None)], P154=[("A.svg", "preferred", None)])
        self.assertIn("does not include", og.company_logo(e, "0000066740")[1])
        e = self.entity(P5531=[("66740", "normal", None), ("2", "normal", None)], P154=[("A.svg", "preferred", None)])
        self.assertIn("more than one CIK", og.company_logo(e, "0000066740")[1])

    def test_judge_identity(self):
        e = self.entity(P2736=[("smith-norman-randy", "normal", None)], P18=[("N._Randy_Smith.jpg", "normal", None)])
        self.assertIsNone(og.judge_identity(e, "smith-norman-randy", "File:N. Randy Smith.jpg"))
        self.assertIn("P2736", og.judge_identity(e, "smith-other", "File:N. Randy Smith.jpg"))
        self.assertIn("P18", og.judge_identity(e, "smith-norman-randy", "File:Someone else.jpg"))

    def test_fjc_node_id(self):
        page = '<html><head><link rel="shortlink" href="https://www.fjc.gov/node/1385976" /></head></html>'
        self.assertEqual(og.fjc_nid(page), "1385976")
        self.assertIsNone(og.fjc_nid("<html></html>"))
        two = page + '<link rel="shortlink" href="https://www.fjc.gov/node/2" />'
        self.assertIsNone(og.fjc_nid(two))


class OutputShape(unittest.TestCase):
    def test_photo_block_fields_match_the_contract(self):
        photo = {"file_page": "https://commons.wikimedia.org/wiki/File:X.jpg", "display": {"url": "u", "width": 960,
                 "height": 480}, "thumb": {"url": "t", "width": 330, "height": 165}, "license": "CC BY 2.0",
                 "license_family": "cc by", "license_url": "https://creativecommons.org/licenses/by/2.0",
                 "license_url_is_deed": True, "author": "A", "credit": "A · CC BY 2.0",
                 "verified_at": "2026-10-24T06:00:00Z", "rights_status": "reusable", "extra": "not copied"}
        self.assertEqual(sorted(bvr.photo_block(photo)), sorted(
            ["file_page", "display", "thumb", "license", "license_family", "license_url", "license_url_is_deed",
             "author", "credit", "verified_at", "rights_status"]))

    def test_not_recorded_place(self):
        self.assertEqual(bvr.place("", ""), "Not recorded")
        self.assertEqual(bvr.place("Denver", "CO"), "Denver, CO")


ORIG = "https://upload.wikimedia.org/wikipedia/commons/4/40/Bryon_White_United_States_Courthouse.jpg"


class RecordedFields(unittest.TestCase):
    """Owner decision 2026-10-24: registry fields as recorded; Wikimedia thumbnails derived at standard widths."""

    def test_license_family_from_recorded_text(self):
        f = rec.license_family
        self.assertEqual(f("Public domain — LOC Highsmith archive rights advisory"), "public domain")
        self.assertEqual(f("CC0"), "cc0")
        self.assertEqual(f("CC BY-SA 3.0 us"), "cc by-sa")
        self.assertEqual(f("CC BY 2.0"), "cc by")
        self.assertEqual(f("CC BY-NC 2.0"), "other")
        self.assertEqual(f("GFDL 1.2"), "other")
        self.assertEqual(f("No known restrictions on publication."), "other")
        self.assertEqual(f("U.S. government work under official committee copyright policy"), "other")
        self.assertEqual(f(None), "other")

    def test_derived_standard_width_thumbnails(self):
        a = {"image_url": ORIG, "original_width": 4032, "original_height": 3024}
        display, thumb, basis = rec.renditions(a, "building")
        self.assertEqual(display, {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Bryon_White_United"
                                          "_States_Courthouse.jpg/960px-Bryon_White_United_States_Courthouse.jpg",
                                   "width": 960, "height": 720})
        self.assertEqual((thumb["width"], thumb["height"]), (330, 248))
        self.assertIn("standard-width", basis)
        portrait = rec.renditions({"image_url": ORIG, "original_width": 800, "original_height": 1000}, "portrait")
        self.assertEqual((portrait[0]["width"], portrait[1]["width"]), (500, 330))

    def test_small_original_uses_recorded_url_and_size(self):
        a = {"image_url": ORIG, "original_width": 134, "original_height": 165}
        display, thumb, basis = rec.renditions(a, "portrait")
        self.assertEqual(display, {"url": ORIG, "width": 134, "height": 165})
        self.assertEqual(basis, "image URL and size as recorded")

    def test_svg_rendered_at_standard_widths(self):
        svg = "https://upload.wikimedia.org/wikipedia/commons/1/15/3M_wordmark.svg"
        display, thumb, _ = rec.renditions({"image_url": svg, "original_width": 300, "original_height": 158}, "logo")
        self.assertTrue(display["url"].endswith("/500px-3M_wordmark.svg.png"))
        self.assertEqual((display["width"], display["height"]), (500, 263))

    def test_other_hosts_keep_recorded_url_and_need_a_size(self):
        loc = "https://tile.loc.gov/image-services/iiif/service:pnp:highsm:25100:25144/full/pct:25/0/default.jpg"
        display, _, _ = rec.renditions({"image_url": loc, "original_width": 1536, "original_height": 609}, "building")
        self.assertEqual(display, {"url": loc, "width": 1536, "height": 609})
        fjc = {"image_url": "https://www.fjc.gov/sites/default/files/courthouses/x.jpg", "original_width": None}
        self.assertEqual(rec.renditions(fjc, "building")[2], "no recorded width and height")
        self.assertEqual(rec.renditions({"image_url": "http://x.org/a.jpg"}, "building")[2], "image URL not https")

    def test_photo_carries_recorded_fields_and_artwork_rule(self):
        a = {"asset_id": "x", "image_url": ORIG, "source_page_url": "https://commons.wikimedia.org/wiki/File:B.jpg",
             "source_title": "File:B.jpg", "original_width": 4032, "original_height": 3024, "license": "CC BY-SA 4.0",
             "license_url": "https://creativecommons.org/licenses/by-sa/4.0", "author": "Disucbsiudciub",
             "credit": "Own work", "rights_status": "review_required", "fetched_at": "2026-10-24T03:11:14Z"}
        p, why = rec.photo(a, "building")
        self.assertIsNone(why)
        self.assertEqual((p["license"], p["license_family"], p["license_url_is_deed"], p["author"], p["credit"],
                          p["rights_status"], p["verified_at"]),
                         ("CC BY-SA 4.0", "cc by-sa", True, "Disucbsiudciub", "Own work", "review_required",
                          "2026-10-24T03:11:14Z"))
        art = {**a, "source_title": "File:Statue of Justice at the courthouse.jpg"}
        self.assertIn("artwork", rec.photo(art, "building")[1])
        fjc_art = {**a, "source_title": "Courthouse", "image_url": "https://www.fjc.gov/files/Mural_lobby.jpg"}
        self.assertIn("artwork", rec.photo(fjc_art, "building")[1])

    def test_mark_as_recorded(self):
        a = {"image_url": "https://agency-logos.federalregister.gov/2/medium.png?1279162074", "original_width": 245,
             "original_height": 245, "mime": "image/png", "license": "Not specified by logo registry",
             "rights_status": "restricted", "rights_evidence": "No reuse clearance.",
             "special_emblem_restrictions": "Emblem review required.", "asset_type": "seal",
             "source_page_url": "https://www.federalregister.gov/agencies/x", "fetched_at": "2026-10-24T03:09:12Z"}
        m, why = rec.mark(a)
        self.assertIsNone(why)
        self.assertEqual((m["rights_status"], m["license_family"], m["policy_quote"], m["branding_note"], m["width"]),
                         ("restricted", "other", "No reuse clearance.", "Emblem review required.", 245))
        self.assertIn("no recorded width", rec.mark({**a, "original_width": None})[1])


class StateJudges(unittest.TestCase):
    def test_states_named_by_role_labels(self):
        self.assertEqual(sj.states_named("Associate Justice of the West Virginia Supreme Court"), ["West Virginia"])
        self.assertEqual(sj.states_named("justice of the Supreme Court of Georgia"), ["Georgia"])
        self.assertEqual(sj.states_named("United States Attorney for the District of Columbia"), ["District of Columbia"])
        self.assertEqual(sj.states_named("Mayor of Washington, D.C."), ["District of Columbia"])
        self.assertEqual(sj.states_named("United States representative"), [])

    def test_exact_unique_match_in_recorded_state(self):
        rows = [{"id": "a", "title": "Sue Bell Cobb", "states": ["Alabama"]},
                {"id": "b", "title": "John Smith", "states": ["Ohio"]},
                {"id": "c", "title": "John Smith", "states": ["Ohio"]},
                {"id": "d", "title": "Jane Roe", "states": ["Texas"]}]
        self.assertEqual(sj.match(sj.norm("Sue Bell Cobb"), ["Alabama"], rows), ("a", None))
        self.assertIn("2 judges records", sj.match(sj.norm("John Smith"), ["Ohio"], rows)[1])
        self.assertIn("no judges record", sj.match(sj.norm("Jane Roe"), ["Ohio"], rows)[1])
        self.assertIn("no judges record", sj.match(sj.norm("Sue B. Cobb"), ["Alabama"], rows)[1])

    def test_name_normalisation(self):
        self.assertEqual(sj.norm("Maureen O'Connor"), "maureen o connor")
        self.assertEqual(sj.norm("  Bill  Waller, Jr. "), "bill waller jr")


if __name__ == "__main__":
    unittest.main()
