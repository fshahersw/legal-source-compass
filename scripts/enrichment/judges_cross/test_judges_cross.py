"""Unit tests for the judges-cross parsers and matchers. Run: python3 -m unittest discover scripts/enrichment/judges_cross"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common as c  # noqa: E402


class CourtIds(unittest.TestCase):
    def test_fjc_names(self):
        self.assertEqual(c.district_court_id("U.S. District Court for the Eastern District of Louisiana"), "laed")
        self.assertEqual(c.district_court_id("U.S. District Court for the District of New Jersey"), "njd")
        self.assertEqual(c.district_court_id("U.S. District Court for the District of Columbia"), "dcd")
        self.assertIsNone(c.district_court_id("U.S. Court of Appeals for the Ninth Circuit"))

    def test_jpml_headings(self):
        self.assertEqual(c.jpml_district_court_id("LOUISIANA EASTERN"), "laed")
        self.assertEqual(c.jpml_district_court_id("DISTRICT OF COLUMBIA"), "dcd")
        self.assertEqual(c.jpml_district_court_id("NEW YORK SOUTHERN"), "nysd")
        self.assertEqual(c.jpml_district_court_id("PUERTO RICO"), "prd")
        self.assertEqual(c.jpml_district_court_id("WEST VIRGINIA SOUTHERN"), "wvsd")
        self.assertIsNone(c.jpml_district_court_id("ATLANTIS NORTHERN"))

    def test_pending_codes_and_state(self):
        self.assertEqual(c.pending_district_court_id("OHS"), "ohsd")
        self.assertEqual(c.pending_district_court_id("DC"), "dcd")
        self.assertIsNone(c.pending_district_court_id("N/A"))
        self.assertEqual(c.court_state("wvsd"), "West Virginia")
        self.assertEqual(c.court_state("vaed"), "Virginia")
        self.assertEqual(c.court_circuit("laed"), 5)


class JudgeNames(unittest.TestCase):
    def test_initials(self):
        [j] = c.parse_jpml_judges("Caldwell, W.C.")
        self.assertEqual(j, {"surname": ["caldwell"], "given": ["w", "c"], "court": None, "suffix": None})

    def test_suffix_and_hint(self):
        [j] = c.parse_jpml_judges("Pointer, Jr., S.C. (ALN)")
        self.assertEqual(j["surname"], ["pointer"])
        self.assertEqual(j["given"], ["s", "c"])
        self.assertEqual(j["court"], "alnd")

    def test_full_names_and_two_judges(self):
        [j] = c.parse_jpml_judges("Rodgers, M. Casey")
        self.assertEqual(j["given"], ["m", "casey"])
        self.assertEqual(len(c.parse_jpml_judges("Bilby, R.M. & Roll, J.M.")), 2)
        self.assertEqual(len(c.parse_jpml_judges("Motz, J.F., Davis, A.M.")), 2)
        [j] = c.parse_jpml_judges("Rodney W. Sippel")
        self.assertEqual(j["surname"], ["sippel"])
        self.assertEqual(j["given"], ["rodney", "w"])
        [j] = c.parse_jpml_judges("Boulee, J-P")
        self.assertEqual(j["given"], ["j", "p"])
        [j] = c.parse_jpml_judges("Castel. P.K.")
        self.assertEqual(j["surname"], ["castel"])

    def test_suffix_parsing(self):
        [j] = c.parse_jpml_judges("Bartle, III, H.")
        self.assertEqual((j["surname"], j["given"], j["suffix"]), (["bartle"], ["h"], "iii"))
        [j] = c.parse_jpml_judges("Patterson, Jr., R.P.")
        self.assertEqual(j["suffix"], "jr")
        self.assertEqual(c.suffix_key("Jr."), "jr")
        self.assertIsNone(c.suffix_key(""))

    def test_brackets_and_loose(self):
        self.assertTrue(c.given_consistent(["w"], "[Percy]", "Whitman"))
        self.assertTrue(c.given_consistent(["a", "v"], "Alfred", "V."))
        self.assertFalse(c.given_consistent(["d", "l"], "Denise", ""))
        self.assertTrue(c.first_initial_consistent(["d", "l"], "Denise", ""))
        self.assertFalse(c.first_initial_consistent(["k"], "Denise", ""))

    def test_given_consistency(self):
        self.assertTrue(c.given_consistent(["w", "c"], "William", "Caldwell"))
        self.assertFalse(c.given_consistent(["w", "d"], "William", "Caldwell"))
        self.assertTrue(c.given_consistent(["m", "casey"], "Margaret", "Casey"))
        self.assertFalse(c.given_consistent(["charles"], "Carl", ""))
        self.assertFalse(c.given_consistent(["a", "b", "c"], "Ann", ""))


class Terminated(unittest.TestCase):
    TEXT = "\n".join([
        "                                     FIFTH CIRCUIT",
        "   53L         LOUISIANA EASTERN                                            (2 Litigations)",
        "   1657        Vioxx PL                                    Fallon, E.E.        6,985     3,335    10,314       6     2018",
        "   1873        FEMA Trailer Formaldehyde PL                Engelhardt, K.D.    1,053     3,775     4,827       1     2013",
        "                                     SIXTH CIRCUIT",
        "   647            OHIO NORTHERN                                     35 Litigations",
        "   2807  Sonic Corp. Customer Data Security Breach Litigation   Gwin, James S.   10   1   11   0   2023",
    ])

    def test_headers_and_rows(self):
        rows, headers, unparsed = c.parse_terminated_text(self.TEXT)
        self.assertEqual([h["code"] for h in headers], ["53L", "647"])
        self.assertEqual(headers[0]["court_id"], "laed")
        self.assertEqual(headers[1]["printed"], 35)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["court_id"], "laed")
        self.assertEqual(rows[0]["actions_closed"], 10314)
        self.assertEqual(rows[2]["court_id"], "ohnd")
        self.assertEqual(rows[2]["circuit"], "Sixth Circuit")
        self.assertEqual(rows[2]["transferee_judge"], "Gwin, James S.")
        self.assertEqual(unparsed, [])


class CompanyKey(unittest.TestCase):
    def test_equivalents(self):
        self.assertEqual(c.company_key("Johnson & Johnson"), "johnson and johnson")
        self.assertEqual(c.company_key("JOHNSON & JOHNSON COM"), "johnson and johnson")
        self.assertEqual(c.company_key("Johnson & Johnson (JNJ) common stock"), "johnson and johnson")
        self.assertEqual(c.company_key("C.R. Bard, Inc."), "cr bard")
        self.assertEqual(c.company_key("C. R. Bard Inc"), "cr bard")
        self.assertEqual(c.company_key("3M Company"), "3m")
        self.assertEqual(c.company_key("Mead Johnson & Company, LLC"), "mead johnson")
        self.assertEqual(c.company_key("Abbott Laboratories, et al."), "abbott laboratories")
        self.assertEqual(c.company_key("Alphabet Inc. Class A"), "alphabet")
        self.assertEqual(c.company_key("Bank of America - cash accounts"), "bank of america")

    def test_non_equivalents(self):
        self.assertNotEqual(c.company_key("Abbott Labs"), c.company_key("Abbott Laboratories"))
        self.assertNotEqual(c.company_key("Johnson Controls"), c.company_key("Johnson & Johnson"))
        self.assertNotEqual(c.company_key("Koninklijke Philips NV"), c.company_key("Philips"))
        self.assertEqual(c.company_key("Common stock"), "")


class Stats(unittest.TestCase):
    def test_median_and_hhi(self):
        self.assertEqual(c.median([3, 1, 2]), 2)
        self.assertEqual(c.median([1, 2, 3, 4]), 2.5)
        self.assertIsNone(c.median([None]))
        self.assertEqual(c.hhi([50, 50]), 5000)
        self.assertEqual(c.hhi([100]), 10000)
        self.assertIsNone(c.hhi([0, 0]))


if __name__ == "__main__":
    unittest.main()
