"""Unit tests for the Open Payments lane parsers (run: python3 -m unittest scripts/enrichment/open_payments/test_open_payments.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from archive_aggregate import parse_amount  # noqa: E402
from names import matches_any, normalize_company, queryable, same_company  # noqa: E402
from op_model import count, money  # noqa: E402


class NormalizeCompany(unittest.TestCase):
    def test_suffix_case_and_punctuation(self):
        self.assertEqual(normalize_company("C. R. BARD, INC. & SUBSIDIARIES"), "CR BARD")
        self.assertEqual(normalize_company("C. R. Bard, Inc."), "CR BARD")
        self.assertEqual(normalize_company("C R BARD INCORPORATED"), "CR BARD")
        self.assertEqual(normalize_company("C.R. BARD, INC"), "CR BARD")
        self.assertEqual(normalize_company("Boston Scientific Corporation"), "BOSTON SCIENTIFIC")
        self.assertEqual(normalize_company("Stryker Corp."), "STRYKER")
        self.assertEqual(normalize_company("ACME L.L.C."), "ACME")

    def test_distinct_businesses_stay_distinct(self):
        self.assertNotEqual(normalize_company("MEDTRONIC USA, INC."), normalize_company("MEDTRONIC, INC."))
        self.assertNotEqual(normalize_company("C. R. BARD INC. (BASD)"), normalize_company("C. R. BARD, INC."))
        self.assertNotEqual(normalize_company("BARD PERIPHERAL VASCULAR, INC."), normalize_company("C. R. BARD, INC."))
        self.assertEqual(normalize_company("Johnson & Johnson"), "JOHNSON AND JOHNSON")

    def test_legal_forms_must_agree(self):
        self.assertTrue(same_company("Stryker Corp", "STRYKER CORPORATION"))
        self.assertTrue(same_company("C R BARD", "C. R. BARD, INC. & SUBSIDIARIES"))
        self.assertTrue(same_company("3M CO", "3M Company"))
        self.assertFalse(same_company("BIOSENSE WEBSTER LTD", "BIOSENSE WEBSTER, INC."))
        self.assertFalse(same_company("Medtronic plc", "MEDTRONIC, INC."))
        self.assertFalse(same_company("MEDTRONIC USA, INC.", "MEDTRONIC, INC."))
        self.assertFalse(same_company("", ""))

    def test_matches_any_uses_reference_forms(self):
        refs = ["BAXTER HEALTHCARE"]
        self.assertTrue(matches_any("BAXTER HEALTHCARE CORPORATION", refs, us_based=True))
        self.assertTrue(matches_any("BAXTER HEALTHCARE", refs, us_based=True))
        self.assertFalse(matches_any("BAXTER HEALTHCARE PTY. LTD.", refs, us_based=True))
        self.assertFalse(matches_any("BAXTER HEALTHCARE CORPORATION", refs, us_based=False))
        self.assertTrue(matches_any("SANOFI-AVENTIS", ["Sanofi", "SANOFI-AVENTIS"], us_based=False))
        self.assertFalse(matches_any("SANOFI SPA", ["Sanofi"], us_based=False))
        refs = ["GE HEALTHCARE", "GE HEALTHCARE, INC."]
        self.assertFalse(matches_any("GE HEALTHCARE CO., LTD.", refs, us_based=True))
        self.assertTrue(matches_any("GE HEALTHCARE INC", refs, us_based=True))

    def test_queryable_spellings(self):
        self.assertTrue(queryable("SMITH+NEPHEW, INC."))
        self.assertTrue(queryable("C. R. BARD INC. (BASD)"))
        self.assertFalse(queryable("Biosense Webster; Inc"))
        self.assertFalse(queryable('ACME "X"'))

    def test_degenerate(self):
        self.assertEqual(normalize_company("INC"), "INC")
        self.assertEqual(normalize_company(None), "")
        self.assertEqual(normalize_company("  "), "")


class Amounts(unittest.TestCase):
    def test_parse_amount_cents(self):
        self.assertEqual(parse_amount("21.34"), 2134)
        self.assertEqual(parse_amount("0.1"), 10)
        self.assertEqual(parse_amount("1000000"), 100000000)
        self.assertIsNone(parse_amount(""))
        self.assertIsNone(parse_amount("n/a"))

    def test_money_and_count(self):
        self.assertEqual(money("79010916.21"), 79010916.21)
        self.assertEqual(money("1,234.50"), 1234.5)
        self.assertIsNone(money(""))
        self.assertIsNone(money(None))
        self.assertIsNone(money("abc"))
        self.assertEqual(count("32677"), 32677)
        self.assertIsNone(count(""))

class BuilderHelpers(unittest.TestCase):
    def test_usd_formatting_and_state_slices(self):
        from build_open_payments import fmt_usd, state_slices

        self.assertEqual(fmt_usd(None), "Not recorded")
        self.assertEqual(fmt_usd(3_923_550_962.80), "$3.92B")
        self.assertEqual(fmt_usd(41_200_000), "$41.2M")
        self.assertEqual(fmt_usd(940.4), "$940")
        rows = state_slices({"CA": [500, 2], "": [900, 9], "NJ": [700, 1], "ONTARIO": [1, 1]}, 5)
        self.assertEqual([r["state"] for r in rows], ["NJ", "CA"])
        self.assertEqual(rows[0]["amount"], 7.0)

    def test_nature_codes_are_complete_and_unique(self):
        from build_open_payments import NATURE

        self.assertEqual(sorted(NATURE, key=int), [str(i) for i in range(1, 20)])
        self.assertEqual(len(set(NATURE.values())), 19)


class OwnerResolution(unittest.TestCase):
    def test_current_name_wins_else_ambiguous(self):
        from fetch_maude import resolve_owners

        corp = {"id": "173", "names": ["OLYMPUS CORPORATION OF THE AMERICAS"], "usBased": True, "candidates": {"OLYMPUS CORPORATION OF THE AMERICAS": 9}}
        inc = {"id": "5451", "names": ["OLYMPUS AMERICA INC.", "OLYMPUS CORPORATION OF THE AMERICAS"], "usBased": True, "candidates": {"OLYMPUS CORPORATION OF THE AMERICAS": 9, "OLYMPUS AMERICA INC": 4}}
        self.assertEqual(resolve_owners([corp, inc]), {})
        self.assertIn("OLYMPUS CORPORATION OF THE AMERICAS", corp["candidates"])
        self.assertNotIn("OLYMPUS CORPORATION OF THE AMERICAS", inc["candidates"])
        self.assertEqual(inc["reassigned"][0]["owner"], "173")

        a = {"id": "1", "names": ["ACME HOLDINGS", "ACME"], "usBased": True, "candidates": {"ACME": 5}}
        b = {"id": "2", "names": ["ACME SUPPLY", "ACME"], "usBased": True, "candidates": {"ACME": 5}}
        self.assertEqual(resolve_owners([a, b]), {"ACME": ["1", "2"]})
        self.assertEqual(a["candidates"], {})
        self.assertEqual(b["candidates"], {})
        self.assertEqual(a["ambiguous"][0]["name"], "ACME")


if __name__ == "__main__":
    unittest.main()
