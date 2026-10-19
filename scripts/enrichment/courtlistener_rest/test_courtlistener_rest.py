"""Offline unit tests for the courtlistener_rest helpers (synthetic inputs, no DuckDB files, no network).

    cd scripts/enrichment/courtlistener_rest && python3 -B -m unittest -v test_courtlistener_rest
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rest_common as rc  # noqa: E402
from build_clb_unmatched import reporter_slug, statuses, unresolved  # noqa: E402

AO = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/financial-disclosures/2017/"
JW = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/financial-disclosures/judicial-watch/"


class FilerFileTests(unittest.TestCase):
    def test_ao_codes(self):
        p = rc.parse_filer_file(AO + "King-RB.%20B.%2005.%20TXW_R_17.tiff")
        self.assertEqual((p["kind"], p["words"], p["position"], p["circuit"], p["district"]), ("ao", "King", "B", "05", "TXW"))
        p = rc.parse_filer_file(AO + "King-RB. J3. 04. --_R_18.tiff")
        self.assertEqual((p["position"], p["circuit"], p["district"]), ("J3", "04", None))
        p = rc.parse_filer_file(AO + "Wood-AR.J3.07.ILN_R_16.tiff")
        self.assertEqual((p["words"], p["circuit"], p["district"]), ("Wood", "07", "ILN"))
        p = rc.parse_filer_file(AO + "Tydingco-Gatewood-FM  J1.09.GU  Resp_R_16.tiff")
        self.assertEqual((p["words"], p["circuit"]), ("Tydingco-Gatewood", "09"))
        p = rc.parse_filer_file(AO + "King-Rob B J3. 04_R_15.tiff")
        self.assertEqual((p["words"], p["circuit"]), ("King", "04"))
        p = rc.parse_filer_file(AO + "Wood-DP J3 07_SR_19.pdf")
        self.assertEqual((p["circuit"], p["district"]), ("07", None))  # SR tags the report, not a district
        p = rc.parse_filer_file(AO + "Batchelder-AM. J3. 06. SPE_R_12.tiff")
        self.assertEqual((p["circuit"], p["district"]), ("06", None))
        p = rc.parse_filer_file(AO + "Gordon-LM. J3. CIT SPE_resp2_R_12.tiff")
        self.assertEqual((p["court_code"], p["district"]), ("CIT", None))
        # malformed: a report tag where the court belongs -> no code fields, surname words kept
        p = rc.parse_filer_file(AO + "Harvey-GM M. DC SPE_Ini_SIA_R_14.tiff")
        self.assertEqual((p["words"], p["position"], p["court_code"], p["circuit"], p["district"]), ("Harvey", None, None, None, None))

    def test_national_court_codes_are_not_numbered_circuits(self):
        p = rc.parse_filer_file(AO + "Holmes-MV. J1. --. TAX_R_13.tiff")
        self.assertEqual((p["circuit"], p["district"]), (None, "TAX"))
        p = rc.parse_filer_file(AO + "Tatel-DS. J3. DC. --_SR_20.pdf")
        self.assertEqual((p["circuit"], p["court_code"]), (None, "DC"))

    def test_judicial_watch_and_unparsed(self):
        p = rc.parse_filer_file(JW + "Robert B King Financial Disclosure Report for 2010.pdf")
        self.assertEqual((p["kind"], p["words"]), ("name", "Robert B King"))
        self.assertIsNone(rc.parse_filer_file("https://storage.courtlistener.com/financial-disclosures/nomination/1990/hearing-1991-part-1-833.pdf"))
        self.assertIsNone(rc.parse_filer_file(None))


class SurnameTests(unittest.TestCase):
    def test_exact_and_suffix(self):
        self.assertTrue(rc.surname_matches("King", "King"))
        self.assertTrue(rc.surname_matches("HaynesJr", "Haynes"))
        self.assertTrue(rc.surname_matches("Cohill, Jr.", "Cohill"))
        self.assertTrue(rc.surname_matches("Robert B King", "King"))

    def test_compound_surname_parts(self):
        self.assertTrue(rc.surname_matches("Garcia", "Garcia-Gregory"))
        self.assertTrue(rc.surname_matches("SmithCamp", "Smith Camp"))

    def test_non_match_and_no_similarity(self):
        self.assertFalse(rc.surname_matches("Martin J Jenkins", "Jones"))
        self.assertFalse(rc.surname_matches("Kleindfeld", "Kleinfeld"))  # misspelt file name: not matched
        self.assertIsNone(rc.surname_matches("", "Jones"))

    def test_lowercase_name_ending_is_kept(self):
        # a name that ends in "sr" or "jr" in lower case is not a glued suffix
        self.assertEqual(rc.name_tokens("Kaysr"), ["kaysr"])
        self.assertEqual(rc.name_tokens("TraxlerJR."), ["traxler"])


class AttributionTests(unittest.TestCase):
    def test_two_circuits_is_a_conflict(self):
        parsed = [rc.parse_filer_file(AO + "King-RB. J3. 04. --_R_18.tiff"), rc.parse_filer_file(AO + "King-RB. B. 05. TXW_R_17.tiff")]
        a = rc.attribution("King", parsed)
        self.assertEqual(a["status"], "conflict")
        self.assertEqual(a["circuits"], {"04": 1, "05": 1})

    def test_consistent_mismatch_and_unchecked(self):
        parsed = [rc.parse_filer_file(AO + "Jones-NR. J3. 02. NYS_R_17.tiff"), rc.parse_filer_file(JW + "Martin J Jenkins Financial Disclosure Report for 2009.pdf"), None]
        a = rc.attribution("Jones", parsed)
        self.assertEqual((a["status"], a["checks"]), ("consistent", ["match", "mismatch", "unchecked"]))
        self.assertEqual(rc.attribution("Jones", [None])["status"], "unchecked")

    def test_move_to_national_court_is_not_compared(self):
        parsed = [rc.parse_filer_file(AO + "OMalley-KM. J3. 06. OHN_R_10.tiff"), rc.parse_filer_file(AO + "OMalley-KM. J3. FC. --_R_15.tiff")]
        self.assertEqual(rc.attribution("O'Malley", parsed)["status"], "consistent")


class HelperTests(unittest.TestCase):
    def test_split_names(self):
        self.assertEqual(rc.split_names("Kozinski, W. Fletcher, and Bybee"), ["Kozinski", "W. Fletcher", "Bybee"])
        self.assertEqual(rc.split_names("FARIS, BRAND, and CORBIT"), ["FARIS", "BRAND", "CORBIT"])
        self.assertEqual(rc.split_names("Smith & Jones; Lee"), ["Smith", "Jones", "Lee"])
        self.assertEqual(rc.split_names(None), [])

    def test_quantiles_and_missing(self):
        self.assertEqual(rc.quantiles([1, 2, 3, 4, 5]), {"p10": 1.0, "p25": 2.0, "p50": 3.0, "p75": 4.0, "p90": 5.0})
        self.assertEqual(rc.quantiles([10, 20, 30, 40]), {"p25": 10.0, "p50": 20.0, "p75": 30.0, "p90": 40.0})
        self.assertIsNone(rc.quantiles(None))
        self.assertIsNone(rc.quantiles([1, None, 3, 4, 5]))

    def test_not_recorded_facts(self):
        self.assertEqual(rc.facts([("Chapter", None), ("Rows", 3)]), [["Chapter", "Not recorded"], ["Rows", "3"]])

    def test_links_only_on_exact_ids(self):
        self.assertEqual(rc.judge_record_link(1780, {"1780"}), "/records/clb_judge_dockets/1780")
        self.assertIsNone(rc.judge_record_link(17800, {"1780"}))
        self.assertIsNone(rc.judge_record_link(None, {"1780"}))
        self.assertEqual(rc.court_link("ca9", {"ca9"}), "/courts/ca9")
        self.assertIsNone(rc.court_link("ca99", {"ca9"}))

    def test_interval(self):
        import datetime as dt

        a, b = dt.date(2020, 1, 1), dt.date(2020, 1, 31)
        self.assertTrue(rc.interval_ok(a, b))
        self.assertFalse(rc.interval_ok(b, a))
        self.assertFalse(rc.interval_ok(None, b))

    def test_reporter_slug_collision(self):
        taken = {}
        self.assertEqual(reporter_slug("So. 2d", taken), "so-2d")
        other = reporter_slug("So.2d", taken)
        self.assertNotEqual(other, "so-2d")
        self.assertTrue(other.startswith("so-2d-"))
        self.assertEqual(reporter_slug("So. 2d", taken), "so-2d")

    def test_status_shares(self):
        row = {"s1": 6, "s2": 1, "s3": 1, "s4": 1, "s5": 1}
        self.assertEqual(unresolved(row), 8)
        st = statuses(row)
        self.assertEqual([s["n"] for s in st], [6, 1, 1, 1, 1])
        self.assertEqual(st[0]["share_pct"], 60.0)

    def test_published_ids_digest(self):
        self.assertEqual(rc.ids_digest(["b", "a"]), rc.ids_digest(["a", "b"]))

    def test_read_build_plain_or_gzipped(self):
        import gzip
        import json
        import tempfile

        saved = rc.OUT
        with tempfile.TemporaryDirectory() as d:
            rc.OUT = d
            try:
                with gzip.open(os.path.join(d, "clb_x.json.gz"), "wt") as h:
                    json.dump({"rows": [{"id": "gz"}]}, h)
                self.assertEqual(rc.read_build("clb_x")["rows"][0]["id"], "gz")
                rc.write({"clb_x": {"rows": [{"id": "plain"}]}})  # a rebuild removes the stale gzipped copy
                self.assertFalse(os.path.exists(os.path.join(d, "clb_x.json.gz")))
                self.assertEqual(rc.read_build("clb_x")["rows"][0]["id"], "plain")
            finally:
                rc.OUT = saved


if __name__ == "__main__":
    unittest.main()
