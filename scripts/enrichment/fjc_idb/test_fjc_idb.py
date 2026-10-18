"""Offline unit tests for the FJC IDB helpers (no DuckDB, no network): codebook parsing, court-id mapping, ranks, series math."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fjc_common as fc  # noqa: E402
import idb_codes as ic  # noqa: E402

CODEBOOK_SNIPPET = """
DISTRICT
(DISTRICT)

District court in which the case was filed.

     00 - Maine                         47 - Ohio - Northern
     08 - New York - Southern           3C - Florida - Southern
     7- - Alaska                        90 - District of Columbia
     94 - Northern Mariana Islands      41 - Texas - Southern

     -8 = Missing

OFFICE
(OFFICE)

NATURE OF SUIT
(NOS)

     Code Description
     110 Insurance
     365 Personal Injury - Product Liability
     367 Health Care / Pharma
     442   Civil Rights Employment

Must have appropriate jurisdiction.
TITLE
(TITL)
"""


class CodebookTests(unittest.TestCase):
    def test_parse_nos_reads_codes_and_collapses_spaces(self):
        nos = ic.parse_nos(CODEBOOK_SNIPPET)
        self.assertEqual(nos[110], "Insurance")
        self.assertEqual(nos[442], "Civil Rights Employment")
        self.assertEqual(sorted(nos), [110, 365, 367, 442])

    def test_parse_districts_reads_two_columns_per_line(self):
        d = ic.parse_districts(CODEBOOK_SNIPPET)
        self.assertEqual(d["47"], "Ohio - Northern")
        self.assertEqual(d["3C"], "Florida - Southern")
        self.assertEqual(d["7-"], "Alaska")
        self.assertEqual(len(d), 8)

    def test_court_id_for_maps_state_and_region(self):
        self.assertEqual(ic.court_id_for("Texas - Southern"), "txsd")
        self.assertEqual(ic.court_id_for("New York - Southern"), "nysd")
        self.assertEqual(ic.court_id_for("Maine"), "med")
        self.assertEqual(ic.court_id_for("District of Columbia"), "dcd")
        self.assertEqual(ic.court_id_for("Northern Mariana Islands"), "nmid")
        self.assertEqual(ic.court_id_for("Illinois - Central"), "ilcd")

    def test_court_id_for_rejects_unknown_state_or_region(self):
        self.assertIsNone(ic.court_id_for("Atlantis"))
        self.assertIsNone(ic.court_id_for("Texas - Upper"))

    def test_label_never_guesses(self):
        self.assertEqual(ic.label(ic.ORIGIN, 6), "Multidistrict litigation transfer (28 USC 1407)")
        self.assertEqual(ic.label(ic.DISPOSITION, 13), "Dismissed: settled")
        self.assertEqual(ic.label(ic.ORIGIN, 99), "Code 99 (not in the codebook)")
        self.assertEqual(ic.label(ic.ORIGIN, None), "Not recorded")

    def test_every_nos_code_is_in_at_most_one_group(self):
        seen = {}
        for key, _label, codes in ic.NOS_GROUPS:
            for c in codes:
                self.assertNotIn(c, seen, f"{c} appears in {seen.get(c)} and {key}")
                seen[c] = key
        self.assertEqual(ic.NOS_TO_GROUP[365], "product")
        self.assertEqual(ic.NOS_TO_GROUP[442], "civil_rights")


class HelperTests(unittest.TestCase):
    def test_rank_desc_is_a_competition_rank_and_skips_none(self):
        r = fc.rank_desc({"a": 10, "b": 30, "c": 30, "d": 5, "e": None})
        self.assertEqual(r, {"b": 1, "c": 1, "a": 3, "d": 4})

    def test_pct_and_labels_handle_zero_and_missing(self):
        self.assertIsNone(fc.pct(1, 0))
        self.assertEqual(fc.pct(1, 3), 33.3)
        self.assertEqual(fc.pct_label(None), "Not recorded")
        self.assertEqual(fc.pct_label(33.34), "33.3%")
        self.assertEqual(fc.n(None), "Not recorded")
        self.assertEqual(fc.n(12345.6), "12,346")
        self.assertEqual(fc.days_label(None), "Not recorded")
        self.assertIn("about 12.0 months", fc.days_label(365.25))

    def test_facts_turns_none_into_not_recorded(self):
        self.assertEqual(fc.facts([("A", 1), ("B", None)]), [["A", "1"], ["B", "Not recorded"]])

    def test_series_for_joins_filed_terminated_and_pending(self):
        agg = {
            "filed": [{"k": "x", "fy": 2024, "filings": 100, "class_action": 10, "pro_se_plaintiff": 20, "pro_se_known": 80, "jury_demanded": 30, "jury_known": 60, "product": 25}],
            "terminated": [{"k": "x", "fy": 2024, "terminations": 90, "median_days": 200.0, "p25_days": 100.0, "p75_days": 300.0, "p90_days": 500.0, "settled": 9, "trial_judgment": 3}],
            "pending": [{"k": "x", "fy": 2024, "pending": 55}, {"k": "x", "fy": 2025, "pending": 60}],
        }
        s = fc.series_for(agg, "x")
        self.assertEqual([r["fy"] for r in s], [2024])  # 2025 has neither filings nor terminations for this key
        r = s[0]
        self.assertEqual((r["filings"], r["terminations"], r["pending_end"]), (100, 90, 55))
        self.assertEqual(r["class_action_pct"], 10.0)
        self.assertEqual(r["pro_se_plaintiff_pct"], 25.0)  # denominator is the cases where the field is recorded
        self.assertEqual(r["jury_demanded_pct"], 50.0)
        self.assertEqual(r["trial_pct"], 3.3)
        self.assertEqual(r["settled_pct"], 10.0)
        self.assertFalse(r["partial"])

    def test_series_marks_the_partial_year_and_skips_pre_1988(self):
        agg = {"filed": [{"k": "x", "fy": fy, "filings": 1} for fy in (1987, 1988, fc.PARTIAL_FY)], "terminated": [], "pending": []}
        s = fc.series_for(agg, "x")
        self.assertEqual([r["fy"] for r in s], [1988, fc.PARTIAL_FY])
        self.assertTrue(s[-1]["partial"])

    def test_window_profile_shares_use_the_recorded_denominator(self):
        mix = {
            "filed_groups": [{"k": "x", "grp": "product", "n": 30}, {"k": "x", "grp": "tax", "n": 10}],
            "filed_nos": [{"k": "x", "nos": 365, "n": 30}],
            "filed_juris": [{"k": "x", "juris": 4, "n": 20}, {"k": "x", "juris": 3, "n": 20}],
            "filed_origin": [{"k": "x", "origin": 1, "n": 40}],
            "term_groups": [{"k": "x", "grp": "product", "n": 20, "with_days": 20, "median_days": 400.0, "settled": 10, "trial_judgment": 1}],
            "term_disp": [{"k": "x", "disp": 13, "n": 15}, {"k": "x", "disp": 7, "n": 5}, {"k": "x", "disp": 99, "n": 5}],
            "term_procprog": [{"k": "x", "procprog": 3, "n": 20}],
            "term_judgment": [{"k": "x", "judgment": 1, "n": 4, "median_amtrec_thousands": 50.0}],
        }
        w = fc.window_profile(mix, "x", {365: "Personal Injury - Product Liability"})
        self.assertEqual(w["filings"], 40)
        self.assertEqual(w["groups"][0]["share_pct"], 75.0)
        self.assertEqual(w["groups"][0]["settled_pct"], 50.0)
        self.assertEqual(w["groups"][1]["terminations"], None)  # no terminations recorded for the tax group in the window
        self.assertEqual(w["top_nos"][0]["label"], "Personal Injury - Product Liability")
        groups = {g["group"]: g["terminations"] for g in w["disposition_groups"]}
        self.assertEqual(groups, {"Dismissed": 15, "Judgment": 5, "Other / not in the codebook": 5})
        self.assertEqual(w["dispositions"][-1]["label"], "Code 99 (not in the codebook)")
        self.assertEqual(w["judgments"][0]["for"], "Plaintiff")

    def test_metric_ranks_rank_each_metric_separately(self):
        latest = {
            "a": {"filings": 10, "pending_end": 5, "median_days": 300.0, "trial_pct": 1.0, "class_action_pct": 2.0, "pro_se_plaintiff_pct": 3.0, "product_pct": 4.0, "settled_pct": 5.0},
            "b": {"filings": 20, "pending_end": None, "median_days": 100.0, "trial_pct": 1.0, "class_action_pct": 1.0, "pro_se_plaintiff_pct": 9.0, "product_pct": 1.0, "settled_pct": 6.0},
        }
        r = fc.metric_ranks(latest)
        self.assertEqual(r["filings"], {"b": 1, "a": 2})
        self.assertEqual(r["pending_end"], {"a": 1})  # a missing value is left out, not ranked last
        self.assertEqual(r["trial_pct"], {"a": 1, "b": 1})  # ties share the lowest number


if __name__ == "__main__":
    unittest.main()
