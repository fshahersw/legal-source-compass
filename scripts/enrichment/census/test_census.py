"""Offline tests for the Census builders: synthetic responses only, no network.

Run: cd scripts/enrichment/census && python3 -B -m unittest -v test_census
"""
from __future__ import annotations

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import census_http as C  # noqa: E402
import census_load as L  # noqa: E402
import census_rows as R  # noqa: E402
import census_spec as S  # noqa: E402


def cell(e, m=0.0):
    return S.read_cell(e, m)


class LabelTests(unittest.TestCase):
    def test_normalises_colons_and_decoration(self):
        self.assertEqual(S.norm_label("Estimate!!Total:!!Male:!!Under 5 years"), "Total|Male|Under 5 years")
        self.assertEqual(S.norm_label("Estimate!!Median age --!!Total:"), "Median age|Total")
        self.assertEqual(
            S.norm_label("Estimate!!Median household income in the past 12 months (in 2014 Inflation-adjusted dollars)"),
            "Median household income in the past 12 months (in YYYY inflation-adjusted dollars)",
        )

    def test_layout_check_accepts_expected_labels(self):
        labels = {"B23025_005": "Estimate!!Total:!!In labor force:!!Civilian labor force:!!Unemployed"}
        self.assertNotIn("B23025_005", S.check_layout(labels, 2024))

    def test_layout_check_flags_changed_and_missing_cells(self):
        labels = {"B23025_005": "Estimate!!Total!!Not in labor force"}
        problems = S.check_layout(labels, 2024)
        self.assertIn("B23025_005", problems)  # a cell that now means something else
        self.assertEqual(problems["B23025_003"], "cell not in the vintage's table")  # absent cell

    def test_table_not_started_is_not_expected(self):
        self.assertNotIn("B28002_004", S.cells_for_year(2016, "acs5"))
        self.assertIn("B28002_004", S.cells_for_year(2017, "acs5"))
        self.assertNotIn("B28002_004", S.cells_for_year(2015, "acs1"))
        self.assertIn("B28002_004", S.cells_for_year(2016, "acs1"))

    def test_every_measure_cell_has_a_label_rule(self):
        for measure in S.MEASURES:
            for c in measure.cells:
                self.assertIn(c, S.CELLS)

    def test_batches_stay_under_the_api_limit_and_keep_pairs(self):
        variables = S.api_variables(S.ALL_CELLS)
        batches = S.batches(variables)
        self.assertTrue(all(len(b) <= 49 for b in batches))
        self.assertEqual([v for b in batches for v in b], variables)
        for b in batches:
            for v in b:
                if v.endswith("E"):
                    self.assertIn(v[:-1] + "M", b)


class SentinelTests(unittest.TestCase):
    def test_estimate_sentinels_become_none(self):
        for sentinel, flag in ((-666666666, -666666666), (-999999999, -999999999), (-888888888, -888888888)):
            c = S.read_cell(str(sentinel), "10")
            self.assertIsNone(c.estimate)
            self.assertEqual(c.estimate_flag, flag)

    def test_unlisted_sentinel_never_becomes_a_number(self):
        c = S.read_cell("-777777777", "5")
        self.assertIsNone(c.estimate)
        self.assertEqual(c.estimate_flag, -777777777)

    def test_moe_sentinels(self):
        self.assertEqual(S.read_cell("100", "-555555555").moe_flag, S.CONTROLLED)
        self.assertIsNone(S.read_cell("100", "-555555555").moe)
        self.assertEqual(S.read_cell("100", "-555555555").moe_for_math, 0.0)
        self.assertEqual(S.read_cell("100", "-222222222").moe_flag, -222222222)
        self.assertIsNone(S.read_cell("100", "-333333333").moe_for_math)

    def test_null_and_empty(self):
        c = S.read_cell(None, None)
        self.assertIsNone(c.estimate)
        self.assertIsNone(S.read_cell("", "").estimate)


class MeasureTests(unittest.TestCase):
    def test_value_measure(self):
        m = S.MEASURE_BY_KEY["median_hh_income"]
        f = S.compute_measure(m, {"B19013_001": cell("65000", "1200")})
        self.assertEqual((f.value, f.moe, f.moe_note), (65000.0, 1200.0, None))

    def test_value_measure_with_sentinels(self):
        m = S.MEASURE_BY_KEY["median_hh_income"]
        self.assertIsNone(S.compute_measure(m, {"B19013_001": S.read_cell("-666666666", "-222222222")}).value)
        f = S.compute_measure(m, {"B19013_001": S.read_cell("250000", "-333333333")})
        self.assertEqual((f.value, f.moe, f.moe_note), (250000.0, None, "m"))

    def test_controlled_population(self):
        f = S.compute_measure(S.MEASURE_BY_KEY["pop"], {"B01003_001": S.read_cell("39287377", "-555555555")})
        self.assertEqual((f.value, f.moe, f.moe_note), (39287377.0, None, "c"))

    def test_share_value_and_moe_formula(self):
        m = S.MEASURE_BY_KEY["poverty_rate"]
        cells = {"B17001_002": cell("1200", "150"), "B17001_001": cell("10000", "300")}
        f = S.compute_measure(m, cells)
        p = 0.12
        expected = math.sqrt(150**2 - p**2 * 300**2) / 10000 * 100
        self.assertAlmostEqual(f.value, 12.0)
        self.assertAlmostEqual(f.moe, expected)

    def test_share_moe_falls_back_to_the_ratio_form_when_the_radicand_is_negative(self):
        m = S.MEASURE_BY_KEY["poverty_rate"]
        cells = {"B17001_002": cell("9000", "10"), "B17001_001": cell("10000", "500")}
        f = S.compute_measure(m, cells)
        p = 0.9
        self.assertLess(10**2 - p**2 * 500**2, 0)
        self.assertAlmostEqual(f.moe, math.sqrt(10**2 + p**2 * 500**2) / 10000 * 100)

    def test_sum_of_cells_uses_root_sum_of_squares(self):
        m = S.MEASURE_BY_KEY["bachelors_plus"]
        cells = {c: cell("100", "30") for c in S.BACHELORS_CELLS}
        cells["B15003_001"] = cell("4000", "0")
        f = S.compute_measure(m, cells)
        self.assertAlmostEqual(f.value, 10.0)
        self.assertAlmostEqual(f.moe, math.sqrt(4 * 30**2) / 4000 * 100)

    def test_difference_measure_language(self):
        m = S.MEASURE_BY_KEY["non_english"]
        cells = {"B06007_001": cell("1000", "40"), "B06007_002": cell("700", "50")}
        f = S.compute_measure(m, cells)
        self.assertAlmostEqual(f.value, 30.0)  # (1000 - 700) / 1000
        self.assertAlmostEqual(f.moe, math.sqrt((40**2 + 50**2) - 0.3**2 * 40**2) / 1000 * 100)

    def test_all_controlled_share_has_no_margin_of_error(self):
        m = S.MEASURE_BY_KEY["hispanic"]
        f = S.compute_measure(m, {"B03002_012": S.read_cell("400", "-555555555"), "B03002_001": S.read_cell("1000", "-555555555")})
        self.assertEqual((f.value, f.moe, f.moe_note), (40.0, None, "c"))

    def test_partly_controlled_share_counts_controlled_as_zero(self):
        m = S.MEASURE_BY_KEY["hispanic"]
        f = S.compute_measure(m, {"B03002_012": cell("400", "20"), "B03002_001": S.read_cell("1000", "-555555555")})
        self.assertAlmostEqual(f.moe, 20 / 1000 * 100)

    def test_share_with_missing_or_sentinel_inputs(self):
        m = S.MEASURE_BY_KEY["unemployment_rate"]
        self.assertIsNone(S.compute_measure(m, {"B23025_005": S.read_cell("-666666666", "1"), "B23025_003": cell("100", "5")}).value)
        self.assertIsNone(S.compute_measure(m, {"B23025_005": cell("0", "5"), "B23025_003": cell("0", "5")}).value)  # empty universe
        self.assertIsNone(S.compute_measure(m, {"B23025_003": cell("100", "5")}).value)  # missing cell

    def test_compute_all_marks_unavailable_and_omits_missing(self):
        row = {c: cell("1000", "10") for c in S.cells_for_year(2024)}
        row["B19013_001"] = S.read_cell("-666666666", "-222222222")
        out = S.compute_all(row, 2024)
        self.assertEqual(out["median_hh_income"], [None, None, -666666666])
        self.assertEqual(out["pop"][0], 1000)
        early = S.compute_all({c: cell("1000", "10") for c in S.cells_for_year(2013)}, 2013)
        self.assertNotIn("broadband", early)

    def test_storage_precision(self):
        m = S.MEASURE_BY_KEY["poverty_rate"]
        v, moe = S.round_figure(m, S.Figure(12.3456789, 0.98765))
        self.assertEqual((v, moe), (12.346, 0.988))
        v, moe = S.round_figure(S.MEASURE_BY_KEY["median_age"], S.Figure(39.84, 0.44))
        self.assertEqual((v, moe), (39.8, 0.4))
        v, moe = S.round_figure(S.MEASURE_BY_KEY["pop"], S.Figure(1234.0, None))
        self.assertEqual((v, moe), (1234, None))


class LoadTests(unittest.TestCase):
    STATE = [
        ["NAME", "B01003_001E", "B01003_001M", "B19013_001E", "B19013_001M", "state"],
        ["Alabama", "5000000", "-555555555", "60000", "500", "01"],
        ["Puerto Rico", "3200000", "-555555555", "-666666666", "-222222222", "72"],
    ]
    COUNTY = [
        ["NAME", "B01003_001E", "B01003_001M", "state", "county"],
        ["Autauga County, Alabama", "58000", "-555555555", "01", "001"],
    ]

    def test_state_response(self):
        names, cells = L.read_acs_response(self.STATE, "state")
        self.assertEqual(names["72"], "Puerto Rico")
        self.assertEqual(cells["01"]["B19013_001"].estimate, 60000)
        self.assertIsNone(cells["72"]["B19013_001"].estimate)

    def test_county_geoid_is_state_plus_county(self):
        names, cells = L.read_acs_response(self.COUNTY, "county")
        self.assertIn("01001", cells)
        self.assertTrue(L.geoid_ok("county", "01001"))
        self.assertFalse(L.geoid_ok("county", "01"))

    def test_national_geoid(self):
        data = [["NAME", "B01003_001E", "B01003_001M", "us"], ["United States", "330000000", "-555555555", "1"]]
        self.assertIn("US", L.read_acs_response(data, "us")[1])

    def test_merge_batches_checks_agreement_and_overlap(self):
        a = L.read_acs_response(self.STATE, "state")
        b = L.read_acs_response([["NAME", "B01002_001E", "B01002_001M", "state"], ["Alabama", "39.1", "0.2", "01"], ["Puerto Rico", "41.0", "0.3", "72"]], "state")
        names, cells = L.merge_batches([a, b])
        self.assertIn("B01002_001", cells["01"])
        self.assertIn("B01003_001", cells["01"])
        with self.assertRaises(ValueError):  # overlapping cells
            L.merge_batches([a, a])
        c = L.read_acs_response([["NAME", "B01002_001E", "B01002_001M", "state"], ["Alabama", "39.1", "0.2", "01"]], "state")
        with self.assertRaises(ValueError):  # different geographies
            L.merge_batches([a, c])


class PepTests(unittest.TestCase):
    STATE_CSV = (
        "SUMLEV,REGION,DIVISION,STATE,NAME,ESTIMATESBASE2020,POPESTIMATE2020,POPESTIMATE2025\n"
        "010,0,0,00,United States,331,332,342\n040,3,6,01,Alabama,5,6,7\n040,3,6,72,Puerto Rico,3,3,3\n030,1,1,00,Northeast,1,1,1\n"
    )
    COUNTY_CSV = (
        "SUMLEV,REGION,DIVISION,STATE,COUNTY,STNAME,CTYNAME,CENSUS2010POP,ESTIMATESBASE2010,POPESTIMATE2019\n"
        "040,3,6,01,000,Alabama,Alabama,4,4,5\n050,3,6,01,001,Alabama,Autauga County,1,1,2\n050,3,6,01,003,Alabama,Baldwin County,2,2,\n"
    )

    def test_state_file(self):
        rows = L.read_pep_csv(self.STATE_CSV, "state")
        self.assertEqual(set(rows), {"US", "01", "72"})  # regions (SUMLEV 030) are dropped
        self.assertEqual(rows["01"]["pop"], {"2020": 6, "2025": 7})
        self.assertEqual(rows["01"]["base"], {"2020": 5})

    def test_county_file_and_missing_values(self):
        rows = L.read_pep_csv(self.COUNTY_CSV, "county")
        self.assertEqual(set(rows), {"01001", "01003"})
        self.assertEqual(rows["01001"]["name"], "Autauga County, Alabama")
        self.assertEqual(rows["01001"]["base"]["census2010"], 1)
        self.assertEqual(rows["01003"]["pop"], {})  # a blank value is absent, not zero


class CbpTests(unittest.TestCase):
    HEADER = ["NAME", "NAICS2017", "ESTAB", "ESTAB_F", "EMP", "EMP_F", "EMP_N", "PAYANN", "PAYANN_F", "PAYANN_N", "NAICS2017", "state", "county"]

    def test_flagged_values_are_not_zero(self):
        data = [
            self.HEADER,
            ["Goochland County, Virginia", "21", "4", None, "0", "b", "0", "0", "S", "0", "21", "51", "075"],
            ["Albany County, Wyoming", "21", "4", None, "17", None, "0", "1053", None, "0", "21", "56", "001"],
        ]
        out = L.read_cbp_response(data, "county", "NAICS2017")
        withheld = out["51075"]["21"]
        self.assertEqual((withheld["estab"], withheld["emp"], withheld["pay"]), (4, None, None))
        self.assertEqual(withheld["flags"], {"emp": "b", "pay": "S"})
        published = out["56001"]["21"]
        self.assertEqual((published["emp"], published["pay"]), (17, 1053))
        self.assertNotIn("flags", published)


class RankTests(unittest.TestCase):
    def test_competition_ranking_highest_first(self):
        ranks = R.competition_ranks({"a": 5.0, "b": 9.0, "c": 5.0, "d": 1.0})
        self.assertEqual(ranks["b"], (1, 4))
        self.assertEqual(ranks["a"], (2, 4))
        self.assertEqual(ranks["c"], (2, 4))
        self.assertEqual(ranks["d"], (4, 4))

    def test_puerto_rico_is_not_ranked(self):
        self.assertNotIn("72", L.RANKED_STATES)
        self.assertEqual(len(L.RANKED_STATES), 51)

    def test_latest_skips_missing_years_without_carrying_values_forward(self):
        series = {"x": {"2022": [3, 1], "2023": [None, None, -666666666]}}
        self.assertEqual(R.latest_of(series), {"x": [3, 1, 2022]})


class UrlTests(unittest.TestCase):
    def test_county_request_selects_one_county_and_never_contains_the_key(self):
        urls = R.api_urls("acs5", 2024, "county", "06037", C.build_url)
        self.assertGreaterEqual(len(urls), 2)
        for url in urls:
            self.assertIn("for=county:037&in=state:06", url)
            self.assertIn("/2024/acs/acs5?get=NAME,", url)
            self.assertNotIn("key=", url)

    def test_period_label(self):
        self.assertEqual(R.period_label("acs5", 2024), "2020-2024")
        self.assertEqual(R.period_label("acs1", 2024), "2024")

    def test_cache_name_is_stable_and_key_free(self):
        url = C.build_url("2024/acs/acs5", {"get": "NAME,B01003_001E", "for": "state:*"})
        self.assertEqual(C.cache_name(url), C.cache_name(url))
        self.assertTrue(C.cache_name(url).endswith(".json"))

    def test_formatting_and_not_recorded(self):
        self.assertEqual(R.fmt(None, "pct"), "Not recorded")
        self.assertEqual(R.fmt(12.345, "pct"), "12.3%")
        self.assertEqual(R.fmt(1234567, "int"), "1,234,567")
        self.assertEqual(R.fmt(65000, "dollars"), "$65,000")


if __name__ == "__main__":
    unittest.main()
