"""Offline tests for the court_images builder (synthetic fixtures, no network).

cd scripts/enrichment/court_images && python3 -B -m unittest -v test_court_images
"""
import unittest

import build_court_images as b
from candidates import collect, commons_title
from licenses import licence_family, plain
from namecheck import federal_key, name_match, norm

SPINE = {
    "neb": {"id": "neb", "title": "Nebraska Supreme Court", "system": "State"},
    "nebraskab": {"id": "nebraskab", "title": "United States Bankruptcy Court, D. Nebraska", "system": "Federal"},
    "ca9": {"id": "ca9", "title": "Court of Appeals for the Ninth Circuit", "system": "Federal"},
    "alnd": {"id": "alnd", "title": "District Court, N.D. Alabama", "system": "Federal"},
    "alnb": {"id": "alnb", "title": "United States Bankruptcy Court, N.D. Alabama", "system": "Federal"},
    "dcd": {"id": "dcd", "title": "District Court, District of Columbia", "system": "Federal"},
    "bap10": {"id": "bap10", "title": "Bankruptcy Appellate Panel of the Tenth Circuit", "system": "Federal"},
    "md": {"id": "md", "title": "Court of Appeals of Maryland", "system": "State"},
}
CDB = {"md": {"name": "Court of Appeals of Maryland", "sub_names": []}}


def ext(**fields):
    return {k: {"value": v} for k, v in fields.items()}


class NameCheck(unittest.TestCase):
    def test_normalisation(self):
        self.assertEqual(norm("U.S. Court of Appeals, Ninth Cir."), "united states court of appeals ninth cir")
        self.assertEqual(norm("Bench & Bar"), "bench and bar")

    def test_federal_grammar_both_styles(self):
        self.assertEqual(federal_key("Texas Western District Court"), federal_key("District Court, W.D. Texas"))
        self.assertEqual(federal_key("Ninth Circuit Court of Appeals"),
                         federal_key("Court of Appeals for the Ninth Circuit"))
        self.assertEqual(federal_key("Tenth Circuit Bankruptcy Appellate Panel"),
                         federal_key("Bankruptcy Appellate Panel of the Tenth Circuit"))
        self.assertEqual(federal_key("District of Columbia District Court"),
                         federal_key("District Court, District of Columbia"))
        self.assertEqual(federal_key("Alaska Bankruptcy Court"), federal_key("United States Bankruptcy Court, D. Alaska"))
        self.assertIsNone(federal_key("Alaska Supreme Court"))

    def test_text_and_key_matches(self):
        self.assertEqual(name_match("ca9", ["Court of Appeals for the Ninth Circuit"], SPINE, {}), "text")
        self.assertEqual(name_match("ca9", ["Ninth Circuit Court of Appeals"], SPINE, {}), "federal_key")

    def test_non_match_wrong_court_for_id(self):
        # The workbook links "Nebraska Bankruptcy Court" to id neb, which is the Nebraska Supreme Court here.
        self.assertIsNone(name_match("neb", ["Nebraska Bankruptcy Court"], SPINE, {}))
        self.assertIsNone(name_match("missing", ["Anything"], SPINE, {}))

    def test_renamed_court_is_not_matched(self):
        self.assertIsNone(name_match("md", ["Supreme Court of Maryland"], SPINE, CDB))
        self.assertEqual(name_match("md", ["Supreme Court of Maryland", "Court of Appeals of Maryland"], SPINE, CDB),
                         "text")

    def test_multi_id_row_checks_each_id_against_its_own_names(self):
        names = ["Alabama Northern District Court", "Alabama Northern Bankruptcy Court"]
        self.assertEqual(name_match("alnd", names, SPINE, {}), "federal_key")
        self.assertEqual(name_match("alnb", names, SPINE, {}), "federal_key")
        self.assertIsNone(name_match("alnd", ["Alabama Northern Bankruptcy Court"], SPINE, {}))


class Licences(unittest.TestCase):
    def test_kept_families(self):
        self.assertEqual(licence_family(ext(LicenseShortName="Public domain", License="pd"))[0], "public domain")
        self.assertEqual(licence_family(ext(LicenseShortName="CC0", License="cc0"))[0], "cc0")
        self.assertEqual(licence_family(ext(LicenseShortName="CC BY 2.0", License="cc-by-2.0"))[0], "cc by")
        self.assertEqual(licence_family(ext(LicenseShortName="CC BY-SA 3.0 us", License="cc-by-sa-3.0-us"))[0],
                         "cc by-sa")

    def test_excluded(self):
        self.assertIn("NC", licence_family(ext(LicenseShortName="CC BY-NC 2.0", License="cc-by-nc-2.0"))[1])
        self.assertIn("ND", licence_family(ext(LicenseShortName="CC BY-ND 2.0", License="cc-by-nd-2.0"))[1])
        self.assertIn("non-free", licence_family(ext(LicenseShortName="Fair use", NonFree="true"))[1])
        self.assertIn("GFDL", licence_family(ext(LicenseShortName="GFDL 1.2", License="gfdl"))[1])
        self.assertIn("other licence", licence_family(ext(LicenseShortName="Attribution", License="attribution"))[1])
        self.assertIn("no licence", licence_family({})[1])

    def test_plain_text_author(self):
        self.assertEqual(plain('<a href="//x">James&nbsp;Brooks</a><br/>Juneau'), "James Brooks Juneau")


class Titles(unittest.TestCase):
    def test_commons_title_from_page_or_upload_url(self):
        self.assertEqual(commons_title("https://commons.wikimedia.org/wiki/File:Boney_Courthouse,_Anchorage.jpg", ""),
                         "File:Boney Courthouse, Anchorage.jpg")
        self.assertEqual(commons_title("", "https://upload.wikimedia.org/wikipedia/commons/a/a0/Boney_Courthouse%2C_Anchorage.jpg"),
                         "File:Boney Courthouse, Anchorage.jpg")
        self.assertIsNone(commons_title("https://www.fjc.gov/history/x", "https://www.fjc.gov/a.jpg"))
        self.assertIsNone(commons_title("", "https://upload.wikimedia.org/wikipedia/en/a/ab/Local.jpg"))


def page(title, width, height, licence="CC BY-SA 4.0", code="cc-by-sa-4.0", artist="Jane Roe"):
    name = title.removeprefix("File:").replace(" ", "_")
    return {
        "title": title,
        "imageinfo": [{
            "url": f"https://upload.wikimedia.org/wikipedia/commons/a/ab/{name}",
            "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{name}",
            "thumburl": f"https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/{name}/960px-{name}",
            "thumbwidth": 960, "thumbheight": 640, "width": width, "height": height, "mime": "image/jpeg",
            "sha1": "x", "extmetadata": ext(LicenseShortName=licence, License=code, Artist=artist,
                                             LicenseUrl="https://creativecommons.org/licenses/by-sa/4.0"),
        }],
    }


def rendition_page(title, width):
    name = title.removeprefix("File:").replace(" ", "_")
    return {"title": title, "imageinfo": [{
        "thumburl": f"https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/{name}/{width}px-{name}",
        "thumbwidth": width, "thumbheight": 200}]}


class Evaluate(unittest.TestCase):
    def lead(self, title):
        return {"court_id": "ca9", "workbook_status": "Strong thumbnail candidate", "commons_title": title,
                "host": "upload.wikimedia.org", "workbook_license": "", "workbook_rights": "", "original_url": ""}

    def run_eval(self, pg, measured=None, mid=True):
        title = pg["title"]
        pages = {title: pg}
        thumbs = ({title: rendition_page(title, 330)}, {})
        mids = ({title: rendition_page(title, 500)} if mid else {}, {})
        return b.evaluate(self.lead(title), pages, {}, thumbs, mids, measured or {}, "2026-10-24T00:00:00Z")

    def test_needs_measured_sizes_then_uses_them(self):
        pg = page("File:Big Courthouse.jpg", 4000, 3000)
        photo, reason, urls = self.run_eval(pg)
        self.assertIsNone(photo)
        self.assertEqual(reason, "rendition size not measured")
        self.assertEqual(len(urls), 2)
        measured = {urls[0]: {"status": 200, "width": 960 if "960px" in urls[0] else 330, "height": 721},
                    urls[1]: {"status": 200, "width": 960 if "960px" in urls[1] else 330, "height": 248}}
        photo, reason, _ = self.run_eval(pg, measured)
        self.assertIsNone(reason)
        self.assertEqual(photo["display"]["width"], 960)
        self.assertIn(photo["display"]["height"], (721, 248))
        self.assertEqual(photo["size_basis"], "decoded from each rendition")

    def test_mid_width_for_originals_under_960_and_exclusion_at_500(self):
        pg = page("File:Small Courthouse.jpg", 792, 629)
        _, _, urls = self.run_eval(pg)
        self.assertTrue(any("/500px-" in u for u in urls))
        _, reason, _ = self.run_eval(page("File:Tiny.jpg", 480, 300))
        self.assertIn("500 px wide or less", reason)

    def test_measured_width_must_equal_requested(self):
        pg = page("File:Big Courthouse.jpg", 4000, 3000)
        _, _, urls = self.run_eval(pg)
        measured = {u: {"status": 200, "width": 959, "height": 600} for u in urls}
        _, reason, _ = self.run_eval(pg, measured)
        self.assertEqual(reason, "rendition is not at the requested standard width")

    def test_artwork_and_licence_exclusions(self):
        _, reason, _ = self.run_eval(page('File:Sculpture "Urns of Justice" at a courthouse.tif', 7000, 5000))
        self.assertIn("artwork", reason)
        _, reason, _ = self.run_eval(page("File:NC.jpg", 4000, 3000, "CC BY-NC 2.0", "cc-by-nc-2.0"))
        self.assertIn("NC", reason)

    def test_non_commons_hosts(self):
        lead = {"court_id": "ded", "workbook_status": "Strong thumbnail candidate", "commons_title": None,
                "host": "www.fjc.gov", "workbook_license": "Not assessed", "workbook_rights": "", "original_url": "x"}
        self.assertIn("rights not stated", b.evaluate(lead, {}, {}, ({}, {}), ({}, {}), {}, "t")[1])
        lead.update(host="example.org", workbook_license="All Rights Reserved; reuse permission not established")
        self.assertEqual(b.evaluate(lead, {}, {}, ({}, {}), ({}, {}), {}, "t")[1], "all rights reserved")


class Collect(unittest.TestCase):
    def test_unmatched_rows_are_listed(self):
        wb = {
            "Top Courts": [(6, {"Court ID": "md", "Court": "Supreme Court of Maryland",
                                "Original image URL": "https://upload.wikimedia.org/wikipedia/commons/a/ab/M.jpg"})],
            "Federal Offices": [(9, {"Linked court IDs": "neb", "Office / court organization": "Nebraska Bankruptcy Court",
                                     "Entity type": "Court location", "Original image URL": "https://x/y.jpg"})],
            "Court Directory": [(7, {"Court ID": "nope", "Court / adjudicative organization": "Nowhere Court",
                                     "Original image URL": "https://x/z.jpg"})],
        }
        leads, unmatched = collect(wb, SPINE, CDB)
        self.assertEqual(leads, [])
        self.assertEqual(sorted(u["court_id"] for u in unmatched), ["md", "neb", "nope"])
        self.assertEqual({u["reason"] for u in unmatched},
                         {"court id not in court_spine", "court name differs from ours for this id"})


if __name__ == "__main__":
    unittest.main()
