"""Unit tests for the court_stats parsers and flag rules. Run: python3 -m unittest scripts/enrichment/court_stats/test_court_stats.py"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import tables as T  # noqa: E402
import build as B  # noqa: E402

ACQ = HERE.parents[2] / "private" / "acq" / "court-stats" / "jb"


class LabelTests(unittest.TestCase):
    def test_district_ids(self):
        self.assertEqual(T.district_id("NY,N"), "nynd")
        self.assertEqual(T.district_id("CA,C"), "cacd")
        self.assertEqual(T.district_id("NJ"), "njd")
        self.assertEqual(T.district_id("DC"), "dcd")
        self.assertEqual(T.district_id("NMI"), "nmid")
        self.assertEqual(T.district_id("GU"), "gud")
        self.assertEqual(T.district_id("WV,S²"), "wvsd")
        self.assertIsNone(T.district_id("Total"))
        self.assertIsNone(T.district_id("Circuit and District"))

    def test_circuit_ids(self):
        self.assertEqual(T.circuit_id("1st"), "ca1")
        self.assertEqual(T.circuit_id("11TH"), "ca11")
        self.assertEqual(T.circuit_id("DC"), "cadc")
        self.assertIsNone(T.circuit_id("NJ"))

    def test_numbers(self):
        self.assertEqual(T.to_number("1,234"), 1234)
        self.assertEqual(T.to_number("15.6"), 15.6)
        self.assertIsNone(T.to_number("-"))
        self.assertIsNone(T.to_number(None))
        self.assertIsNone(T.to_number("n/a text"))
        self.assertEqual(T.to_number(0), 0)

    def test_char_lines_ignore_offset_space_glyphs(self):
        class Page:
            chars = [
                {"text": "C", "top": 10.0, "x0": 0.0, "x1": 5.0}, {"text": "T", "top": 10.0, "x0": 5.0, "x1": 10.0},
                {"text": " ", "top": 11.7, "x0": 7.0, "x1": 9.0},  # stray padding glyph on an offset baseline
                {"text": "2", "top": 10.0, "x0": 40.0, "x1": 44.0}, {"text": "0", "top": 10.0, "x0": 44.0, "x1": 48.0},
                {"text": ",", "top": 10.0, "x0": 48.0, "x1": 50.0}, {"text": "5", "top": 10.0, "x0": 50.0, "x1": 54.0},
                {"text": "6", "top": 10.0, "x0": 54.0, "x1": 58.0}, {"text": "5", "top": 10.0, "x0": 58.0, "x1": 62.0},
                {"text": "7", "top": 30.0, "x0": 0.0, "x1": 4.0},
            ]

        self.assertEqual(T.char_lines(Page()), ["CT 20,565", "7"])

    def test_repair_line_only_unambiguous_splits(self):
        self.assertEqual(T.repair_line("NY,E 6,720 282 1 ,063 1,491"), "NY,E 6,720 282 1,063 1,491")
        self.assertEqual(T.repair_line("Total 52,698 60,357 14. 5 -4 .2"), "Total 52,698 60,357 14.5 -4.2")
        self.assertEqual(T.repair_line("T otal 54,988"), "Total 54,988")
        # a space between digits is ambiguous and must be left alone
        self.assertEqual(T.repair_line("TOTAL 2 37,453"), "TOTAL 2 37,453")


class RuleTests(unittest.TestCase):
    YEARS = list(range(2014, 2026))

    def test_baseline_requires_five_published_years(self):
        self.assertIsNone(B.baseline_median([1, 2, 3, 4], 4))
        self.assertEqual(B.baseline_median([1, 2, 3, 4, 5, 9], 5), 3)
        self.assertIsNone(B.baseline_median([1, None, 3, 4, 5, 9], 5))

    def test_surge_rule(self):
        pl = [100, 100, 100, 100, 100, 201, 150, 100, 100, 100, 100, 100]
        nat = [10_000] * 12
        civil = [50_000] * 12
        flags = B.pl_flags(self.YEARS, pl, nat, civil, [500_000] * 12)
        surges = [f for f in flags if f["rule"] == "pl_surge"]
        self.assertEqual([f["year"] for f in surges], [2019])
        self.assertEqual(surges[0]["baseline"], 100)

    def test_surge_needs_minimum_count(self):
        pl = [10, 10, 10, 10, 10, 90, 10, 10, 10, 10, 10, 10]
        flags = B.pl_flags(self.YEARS, pl, [10_000] * 12, [5_000] * 12, [500_000] * 12)
        self.assertFalse([f for f in flags if f["rule"] == "pl_surge"])

    def test_concentration_and_cluster(self):
        pl = [1_500] * 12
        flags = B.pl_flags(self.YEARS, pl, [10_000] * 12, [3_000] * 12, [300_000] * 12)
        rules = {f["rule"] for f in flags}
        self.assertIn("pl_concentration", rules)  # 15% of national PL
        self.assertIn("pl_share_cluster", rules)  # 50% of own docket vs 3.3% nationally

    def test_missing_values_never_flag(self):
        pl = [None] * 12
        self.assertEqual(B.pl_flags(self.YEARS, pl, [10_000] * 12, [None] * 12, [300_000] * 12), [])

    def test_time_flags(self):
        flags = B.time_flags([2025], [30.0], [400], [10.0], [40.0], [900], [10.0])
        self.assertEqual({f["rule"] for f in flags}, {"slow_disposition", "aging_backlog"})
        self.assertEqual(B.time_flags([2025], [30.0], [50], [10.0], [40.0], [100], [10.0]), [])

    def test_time_flags_report_pooled_national_but_use_district_median(self):
        flags = B.time_flags([2025], [12.0], [400], [7.9], [25.0], [900], [10.1], [15.6], [39.3])
        slow = next(f for f in flags if f["rule"] == "slow_disposition")
        self.assertEqual((slow["district_median"], slow["national"]), (7.9, 15.6))
        self.assertEqual({f["rule"] for f in flags}, {"slow_disposition", "aging_backlog"})

    def test_decline_ratio_keeps_precision(self):
        pl = [2000, 2000, 2000, 2000, 2000, 995, 2000, 2000, 2000, 2000, 2000, 2000]
        flags = B.pl_flags(self.YEARS, pl, [100_000] * 12, [50_000] * 12, [500_000] * 12)
        decline = next(f for f in flags if f["rule"] == "pl_decline")
        self.assertEqual(decline["ratio"], 0.4975)

    def test_district_median_and_dash_years(self):
        data = {"districts": {"a": {"2025": {"c5": {"median_total": 7.0}}}, "b": {"2025": {"c5": {"median_total": 9.0, "_dash": []}}},
                              "c": {"2025": {"c5": {"median_total": None, "_dash": ["median_total"]}}}}}
        self.assertEqual(B.district_median(data, [2025], "c5", "median_total"), [8.0])
        self.assertEqual(B.dash_years(data["districts"]["c"], [2025], "c5", "median_total"), [2025])
        self.assertEqual(B.dash_map(data["districts"]["a"], [2025], [("median_total", "c5", "median_total")]), {})

    def test_ranks_ties_and_nulls(self):
        self.assertEqual(B.ranks({"a": 5, "b": 9, "c": 5, "d": None}), {"b": 1, "a": 2, "c": 2})
        self.assertEqual(B.ranks({"a": 5, "b": 9}, higher_first=False), {"a": 1, "b": 2})

    def test_spearman(self):
        rho, n = B.spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
        self.assertEqual((rho, n), (1.0, 5))
        rho, n = B.spearman([1, 2, 3, 4, 5, None], [5, 4, 3, 2, 1, 7])
        self.assertEqual((rho, n), (-1.0, 5))


@unittest.skipUnless((ACQ / "2025").exists(), "raw U.S. Courts tables not downloaded (run acquire.py)")
class PublishedTableTests(unittest.TestCase):
    """Spot values read by hand from the published tables."""

    @classmethod
    def setUpClass(cls):
        import extract as E

        cls.E = E

    def test_c11_fy2025_new_jersey(self):
        rows, fmt, _ = self.E.read_c11(2025)
        self.assertEqual(fmt, "xlsx")
        self.assertEqual(rows["NJ"]["total"], 11215)
        self.assertEqual(rows["NJ"]["other_pi"], 11153)
        self.assertEqual(rows["Total"]["total"], 45713)

    def test_c11_fy2016_pdf_dc_airline(self):
        rows, fmt, _ = self.E.read_c11(2016)
        self.assertEqual(fmt, "pdf")
        self.assertEqual(rows["DC"]["airplane"], 32)
        self.assertEqual(rows["DC"]["total"], 51)

    def test_x1a_block_order_differs_by_edition(self):
        fy2014, _, _ = self.E.read_x1a(2014)  # weighted block printed first
        fy2015, _, _ = self.E.read_x1a(2015)  # unweighted block printed first
        self.assertEqual(fy2014["TOTAL"]["unweighted_total"], 568.0)
        self.assertEqual(fy2014["TOTAL"]["weighted_total"], 533.0)
        self.assertEqual(fy2015["Total"]["unweighted_total"], 535.0)

    def test_c3_fy2015_pdf_glyph_positions(self):
        # The FY2015 text layer splits printed numbers ("2 0,565", "C T"); rows are rebuilt from glyph positions.
        rows, fmt, _ = self.E.read_c3(2015)
        self.assertEqual(fmt, "pdf")
        self.assertEqual(rows["CT"]["total"], 2087)
        self.assertEqual(rows["4TH"]["total"], 37531)
        self.assertEqual(rows["4TH"]["other_pi"], 20565)
        self.assertEqual(rows["TOTAL"]["private"], 237453)

    def test_b4_fy2016_pdf(self):
        rows, fmt, _ = self.E.read_b4(2016)
        self.assertEqual(fmt, "pdf")
        self.assertEqual(rows["9th"], {"merits_terminations": 7056, "n_notice_to_final": 6709, "median_notice_to_final": 15.2,
                                       "n_lower_court_to_final": 4345, "median_lower_court_to_final": 37.8})

    def test_c11_fy2015_truncated_cell_is_withheld(self):
        rows, _, _ = self.E.read_c11(2015)
        self.assertTrue(rows["IL,N"]["components_withheld"])
        self.assertEqual(rows["IL,N"]["total"], 2690)
        self.assertIsNone(rows["IL,N"]["other_pi"])

    def test_c5_dash_is_not_computed(self):
        rows, _, _ = self.E.read_c5(2016)
        self.assertIsNone(rows["SD"]["median_trial"])  # printed "--": fewer than 10 cases
        self.assertEqual(rows["SD"]["n_total"], 513)


if __name__ == "__main__":
    unittest.main()
