"""Unit tests for the firm-name rules (python3 -B -m unittest test_firm_intel, run from this directory)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import firm_lib as fl  # noqa: E402


class FirmKey(unittest.TestCase):
    def test_case_punctuation_ampersand_and_entity_forms_merge(self):
        forms = ["Shook, Hardy & Bacon L. L. P.", "Shook, Hardy and Bacon L.L.P.", "Shook Hardy & Bacon LLP", "SHOOK, HARDY & BACON"]
        self.assertEqual({fl.firm_key(f) for f in forms}, {"shook hardy and bacon"})
        self.assertEqual(fl.firm_key("Scott+Scott, Attorneys at Law, LLP"), fl.firm_key("Scott & Scott Attorneys at Law LLP"))
        self.assertEqual(fl.firm_key("Scott-Scott LLP"), fl.firm_key("Scott Scott"))

    def test_office_suffix_is_dropped_unless_it_is_an_entity_form(self):
        self.assertEqual(fl.firm_key("Morgan, Lewis & Bockius - Philadelphia"), "morgan lewis and bockius")
        self.assertEqual(fl.firm_key("Morgan, Lewis & Bockius LLP - DC Office"), "morgan lewis and bockius")
        self.assertEqual(fl.strip_office("Kirkland & Ellis - Chicago"), "Kirkland & Ellis")
        self.assertEqual(fl.strip_office("Smith - Jones LLP"), "Smith - Jones LLP")

    def test_prefixes(self):
        self.assertEqual(fl.firm_key("The Watts Law Firm"), fl.firm_key("Watts Law Firm LLP"))
        self.assertEqual(fl.firm_key("Law Offices of Jane Roe"), "jane roe")
        self.assertEqual(fl.firm_key("INVALID ADDRESS - Morgan Lewis & Bockius, LLP - Houston"), "morgan lewis and bockius")

    def test_no_guessing_between_different_names(self):
        self.assertNotEqual(fl.firm_key("Beasley Allen et al - AL"), fl.firm_key("Beasley Allen Crow Methvin Portis & Miles, P.C."))
        self.assertNotEqual(fl.firm_key("Milberg PLLC"), fl.firm_key("Milberg Coleman Bryson Phillips Grossman PLLC"))


class Classes(unittest.TestCase):
    def test_placeholders_are_not_firms(self):
        for s in ["PRO SE", "Counsel Not Admitted to USDC - NJ Bar", "COUNSEL NOT ADMITTED TO USDC-NJ BAR", "Counsel Not Admitted USDC-NJ Bar", "Unknown", "N/A"]:
            self.assertFalse(fl.is_firm(s), s)
        self.assertTrue(fl.is_firm("Seeger Weiss LLP"))

    def test_government_counsel_is_classed_separately(self):
        for s in ["Office of the Attorney General - Jackson", "CAAG - Office of Attorney General", "State of Wisconsin - Department of Justice",
                  "Office of the U.S. Attorney - Cleveland", "Colorado Department of Law", "City of Providence", "Deputy County Attorney"]:
            self.assertTrue(fl.is_government(s), s)
        for s in ["Seeger Weiss LLP", "The Attorneys General Group LLP", "Cityside Law LLP"]:
            self.assertFalse(fl.is_government(s), s)


class Sides(unittest.TestCase):
    def test_party_side(self):
        self.assertEqual(fl.party_side(["Plaintiff"]), "plaintiff")
        self.assertEqual(fl.party_side(["Consolidated Plaintiff", "Petitioner"]), "plaintiff")
        self.assertEqual(fl.party_side(["Defendant"]), "defense")
        self.assertEqual(fl.party_side(["Plaintiff", "Defendant"]), "other")
        self.assertEqual(fl.party_side(["Movant"]), "other")
        self.assertEqual(fl.party_side(None), "other")


if __name__ == "__main__":
    unittest.main()
