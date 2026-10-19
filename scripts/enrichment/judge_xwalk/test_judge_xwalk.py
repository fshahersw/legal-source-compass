"""Unit tests for the judge crosswalk normalisers (python3 -I -B -m unittest scripts/enrichment/judge_xwalk/test_judge_xwalk.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xwalk_lib as xl  # noqa: E402


class Names(unittest.TestCase):
    def test_honorifics_and_suffix(self):
        self.assertEqual(xl.record_name("Judge Barrington Daniels Parker Jr."), (("barrington", "daniels", "parker"), frozenset({"jr"})))
        self.assertEqual(xl.record_name("Hon. Mary Jane Bowes"), (("mary", "jane", "bowes"), frozenset()))
        self.assertEqual(xl.record_name("Clifford R. Anderson III"), (("clifford", "r", "anderson"), frozenset({"iii"})))

    def test_hyphen_and_apostrophe_split_identically(self):
        self.assertEqual(xl.record_name("Panayotta D. Augustin-Birch")[0], ("panayotta", "d", "augustin", "birch"))
        full, suffix, *_ = xl.cl_name("Panayotta", "D.", "Augustin-Birch", None)
        self.assertEqual(full, ("panayotta", "d", "augustin", "birch"))
        self.assertEqual(xl.record_name("Sandra Day O'Connor")[0], xl.cl_name("Sandra", "Day", "O'Connor", None)[0])

    def test_cl_suffix_codes_and_suffix_inside_middle(self):
        full, suffix, f, m, l = xl.cl_name("Donald", " E., Jr.", "Van Luven", None)
        self.assertEqual(full, ("donald", "e", "van", "luven"))
        self.assertEqual(suffix, frozenset({"jr"}))
        self.assertEqual(xl.cl_name("John", "", "Roe", "3")[1], frozenset({"iii"}))
        self.assertEqual(xl.cl_name("John", "", "Roe", "1")[1], frozenset())

    def test_middle_compatibility(self):
        self.assertTrue(xl.middle_compatible(("m",), ("martin",)))
        self.assertTrue(xl.middle_compatible((), ("martin",)))
        self.assertTrue(xl.middle_compatible(("martin",), ("martin",)))
        self.assertFalse(xl.middle_compatible(("m",), ("lee",)))
        self.assertFalse(xl.middle_compatible(("a", "b"), ("anne",)))

    def test_no_fuzzy_matching(self):
        self.assertNotEqual(xl.record_name("Jon Smith")[0], xl.record_name("John Smith")[0])
        self.assertNotEqual(xl.record_name("Chris Martin")[0], xl.record_name("Christopher Martin")[0])


class Courts(unittest.TestCase):
    def test_federal_district_forms(self):
        a = xl.court_aliases("District Court, N.D. Illinois", "N.D. Illinois")
        self.assertIn(xl.norm_court("U.S. District Court for the Northern District of Illinois"), a)
        self.assertIn(xl.norm_court("United States District Court for the Northern District of Illinois"), a)
        b = xl.court_aliases("District Court, D. New Jersey", "D. New Jersey")
        self.assertIn(xl.norm_court("U.S. District Court for the District of New Jersey"), b)

    def test_bankruptcy_appeals_and_dc(self):
        self.assertIn(xl.norm_court("U.S. Bankruptcy Court for the District of Delaware"), xl.court_aliases("United States Bankruptcy Court, D. Delaware", "D. Delaware"))
        self.assertIn(xl.norm_court("U.S. Court of Appeals for the First Circuit"), xl.court_aliases("Court of Appeals for the First Circuit", "First Circuit"))
        self.assertIn(xl.norm_court("U.S. Court of Appeals for the District of Columbia Circuit"), xl.court_aliases("Court of Appeals for the D.C. Circuit", "D.C. Circuit"))

    def test_state_trial_court_forms(self):
        self.assertIn(xl.norm_court("228th District Court of Texas"), xl.court_aliases("Texas 228th Judicial District Court", None))
        self.assertIn(xl.norm_court("Monterey County Superior Court"), xl.court_aliases("Superior Court of California, County of Monterey", None))
        self.assertIn(xl.norm_court("Kings County Supreme Court"), xl.court_aliases("New York Supreme Court, Kings County", None))
        self.assertEqual(xl.norm_court("CO - Denver County Court"), xl.norm_court("Denver County Court"))

    def test_partial_names_do_not_resolve(self):
        self.assertNotIn(xl.norm_court("228th District Court of Oklahoma"), xl.court_aliases("Texas 228th Judicial District Court", None))
        self.assertNotIn(xl.norm_court("Northern District of Illinois Bankruptcy"), xl.court_aliases("District Court, N.D. Illinois", "N.D. Illinois"))


class Positions(unittest.TestCase):
    def test_untyped_positions_need_a_judicial_title(self):
        types = {"jud", "mag"}
        self.assertTrue(xl.is_judicial("jud", None, types))
        self.assertFalse(xl.is_judicial("clerk", "Law Clerk", types))
        self.assertTrue(xl.is_judicial(None, "Deputy Supervising Judge", types))
        self.assertFalse(xl.is_judicial(None, "Clerk to the Hon. Barrington D. Parker, Jr.", types))
        self.assertFalse(xl.is_judicial(None, "Principal Law Clerk to Administrative Judge", types))

    def test_term_years(self):
        self.assertEqual(xl.term_years("January 2024 to December 2033"), (2024, 2033))
        self.assertEqual(xl.term_years(None), (None, None))


if __name__ == "__main__":
    unittest.main()
