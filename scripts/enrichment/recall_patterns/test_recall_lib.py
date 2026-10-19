import unittest

import recall_lib as lib


class RecallLibTest(unittest.TestCase):
    def test_firm_key_ignores_case_punctuation_and_suffix_only(self):
        self.assertEqual(lib.firm_key("Sunland, Inc."), lib.firm_key("SUNLAND INC"))
        self.assertNotEqual(lib.firm_key("Sunland Foods"), lib.firm_key("Sunland"))

    def test_themes_are_keyword_rules(self):
        self.assertEqual(lib.themes_for("fda_drug", "Presence of NDMA above the acceptable intake"), ["nitrosamine"])
        self.assertIn("allergen_milk", lib.themes_for("fda_food", "Product may contain undeclared milk."))
        self.assertEqual(lib.themes_for("fda_food", "No reason given"), [])

    def test_commodity_is_a_whole_word(self):
        self.assertEqual(lib.commodities("Potential Salmonella contamination"), [])
        self.assertIn("salmon", lib.commodities("smoked salmon"))
        self.assertIn("blueberr", lib.commodities("frozen blueberries"))
        self.assertIn("peanut butter", lib.commodities("creamy peanut butter"))
        self.assertNotIn("peanut", lib.commodities("creamy peanut butter"))

    def test_suppliers_are_named_companies_other_than_the_recalling_firm(self):
        text = "Products may contain peanut butter manufactured by Sunland, Inc. which was recalled due to Salmonella."
        self.assertEqual(lib.suppliers(text, "Trader Joe's Company"), ["Sunland, Inc"])
        self.assertEqual(lib.suppliers(text, "Sunland Inc"), [])
        self.assertEqual(lib.suppliers("The firm was notified by their supplier that they failed to include wheat.", "X Foods"), [])
        self.assertEqual(lib.suppliers("Peanuts supplied by Peanut Corporation of America. The firm", "Y Inc"), ["Peanut Corporation of America"])
        self.assertEqual(lib.suppliers("pistachios from ARO Pistachio Inc. Salmonella was found", "Z Co"), [])
        self.assertEqual(lib.clean_name("ARO Pistachio Inc. Salmonella"), "ARO Pistachio Inc")

    def test_anomalies_need_a_full_window_and_all_thresholds(self):
        months = lib.month_range("2020-01", "2022-03")
        series = {m: 10 for m in months}
        series["2022-02"] = 60
        flags = lib.anomalies(series, months, min_excess=10)
        self.assertEqual([f["month"] for f in flags], ["2022-02"])
        series["2022-02"] = 25
        self.assertEqual(lib.anomalies(series, months, min_excess=10), [])

    def test_clusters_are_anchored_and_need_three_firms(self):
        def e(i, firm, start):
            return {"id": str(i), "firm_key": firm, "start": start, "themes": ["salmonella"], "commodities": ["cucumber"]}

        events = [e(1, "a", "2024-01-01"), e(2, "b", "2024-02-15"), e(3, "c", "2024-03-20"), e(4, "d", "2024-05-01")]
        got = lib.clusters(events, days=90, min_firms=3)
        self.assertEqual(len(got), 1)
        theme, commodity, group = got[0]
        self.assertEqual((theme, commodity), ("salmonella", "cucumber"))
        self.assertEqual([x["id"] for x in group], ["1", "2", "3"])
        self.assertEqual(lib.clusters(events[:2], days=90, min_firms=3), [])


if __name__ == "__main__":
    unittest.main()
