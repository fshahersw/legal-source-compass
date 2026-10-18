"""Offline unit tests for the NPDB builders (synthetic fixtures only, no network, no corpus access).

Run: cd scripts/enrichment/npdb && python3 -B -m unittest -v test_npdb
Covers: parsing (codebook, practitioner types, payments, years, DAT export), state attribution, aggregation math
(medians, means, growth, ranks), disclosure control (suppression and complementary suppression), key matching
(unique, non-match and ambiguous), the Not-recorded paths, and an end-to-end scan of a synthetic mini PUF.
"""
import csv
import io
import json
import os
import tempfile
import unittest
import zipfile

import build_npdb as build
import npdb_lib as lib
from npdb_lib import Agg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD_DIR = os.path.join(ROOT, "private", "build", "npdb")


def agg_with(n, pays=None, delays=None, dims=None):
    """An Agg with n reports (payments cycle through `pays` when given)."""
    agg = Agg()
    for i in range(n):
        pay = pays[i % len(pays)] if pays else None
        delay = delays[i % len(delays)] if delays else None
        agg.add(pay, delay, dims(i) if dims else None)
    return agg


class FieldParsing(unittest.TestCase):
    def test_payment_strips_dollar_and_commas(self):
        self.assertEqual(lib.payment("$97500"), 97500.0)
        self.assertEqual(lib.payment("$1,500"), 1500.0)
        self.assertEqual(lib.payment(" $50 "), 50.0)

    def test_payment_blank_is_none_not_zero(self):
        self.assertIsNone(lib.payment(""))
        self.assertIsNone(lib.payment("   "))
        self.assertIsNone(lib.payment(None))

    def test_year_requires_four_digits(self):
        self.assertEqual(lib.year("2019"), 2019)
        self.assertIsNone(lib.year(""))
        self.assertIsNone(lib.year("19"))
        self.assertIsNone(lib.year("20x9"))

    def test_delay_years(self):
        self.assertEqual(lib.delay_years(2020, 2015), 5)
        self.assertEqual(lib.delay_years(2020, 2020), 0)
        self.assertIsNone(lib.delay_years(2020, 3999), "erroneous future act year is not a delay")
        self.assertIsNone(lib.delay_years(2020, 1850), "implausible act year")
        self.assertIsNone(lib.delay_years(2020, None))
        self.assertIsNone(lib.delay_years(None, 2015))

    def test_dat_practitioner_export_parsing(self):
        text = 'Practitioner Type,NPDB Practitioners (tooltip),NPDB Practitioners,Distinct count of PRACTNUM\nOptometrist,"3,929","3,929","3,929"\nPhysician (MD),"258,182","258,182","258,182"\nOdd Type,,,\n,"5","5","5"\n'
        rows = lib.parse_dat_practitioners(text)
        self.assertEqual(rows[0], {"type": "Physician (MD)", "practitioners": 258182})
        self.assertEqual(rows[1], {"type": "Optometrist", "practitioners": 3929})
        self.assertEqual(rows[2], {"type": "Odd Type", "practitioners": None}, "blank count stays unrecorded, never 0")
        self.assertEqual(len(rows), 3, "a row without a type is dropped")


CODEBOOK_HTML = """
<table summary="Variable layout of the file"><tr><td>RECTYPE</td><td>1</td></tr></table>
<table summary="ALGNNATR"><tr><th>Value</th><th>Label</th></tr>
<tr><td>10</td><td>Diagnosis Related</td></tr><tr><td>60</td><td>Surgery Related</td></tr></table>
<table summary="WORKSTAT"><tr><th>Value</th><th>Label</th></tr><tr><td>NJ</td><td>New Jersey</td></tr><tr><td>AA</td><td>Armed Forces - Central and South America</td></tr></table>
<table summary="ALEGATN1"><tr><th>Value</th><th>Label</th></tr><tr><td>101</td><td>Failure to diagnose</td></tr></table>
<table summary="OUTCOME"><tr><th>Value</th><th>Label</th></tr><tr><td>(Same as nothing)</td><td>x</td></tr><tr><td>9</td><td>Death</td></tr></table>
"""

DAT_HTML = """
<table summary="Practitioner Type">
<tr><th>Practitioner Type</th><th>Code</th><th>Label</th></tr>
<tr><td rowspan="2">Physician (MD)</td><td>010</td><td>Physician (MD)</td></tr>
<tr><td>015</td><td>Physician Intern/Resident (MD)</td></tr>
<tr><td>Dentist</td><td>030</td><td>Dentist</td></tr>
</table>"""


class CodebookParsing(unittest.TestCase):
    def test_variable_tables_become_code_label_maps(self):
        book = lib.parse_codebook(CODEBOOK_HTML)
        self.assertEqual(book["ALGNNATR"], {"10": "Diagnosis Related", "60": "Surgery Related"})
        self.assertNotIn("VARIABLE LAYOUT OF THE FILE", book, "layout tables with spaces in the summary are skipped")

    def test_same_as_rows_are_dropped_and_missing_tables_inherit(self):
        book = lib.parse_codebook(CODEBOOK_HTML)
        self.assertEqual(book["OUTCOME"], {"9": "Death"}, "'(Same as ...)' placeholder rows are not codes")
        self.assertEqual(book["HOMESTAT"], book["WORKSTAT"])
        self.assertEqual(book["LICNSTAT"], book["WORKSTAT"])
        self.assertEqual(book["ALEGATN2"], book["ALEGATN1"])

    def test_practitioner_type_groups_use_leading_cell_of_group(self):
        mapping = lib.parse_practitioner_types(DAT_HTML)
        self.assertEqual(mapping, {10: "Physician (MD)", 15: "Physician (MD)", 30: "Dentist"})

    def test_practitioner_type_missing_table_is_empty(self):
        self.assertEqual(lib.parse_practitioner_types("<p>no tables</p>"), {})


class Categories(unittest.TestCase):
    MAPPING = {10: "Physician (MD)", 30: "Dentist"}

    def test_practitioner_type_paths(self):
        self.assertEqual(lib.practitioner_type("10", self.MAPPING), "Physician (MD)")
        self.assertEqual(lib.practitioner_type("010", self.MAPPING), "Physician (MD)")
        self.assertEqual(lib.practitioner_type("", self.MAPPING), lib.NOT_RECORDED)
        self.assertEqual(lib.practitioner_type("1345", self.MAPPING), "Organization / entity (not an individual practitioner)")
        self.assertTrue(lib.practitioner_type("999", self.MAPPING).startswith("Subject unspecified"))
        self.assertEqual(lib.practitioner_type("77", self.MAPPING), "Individual outside NPDB practitioner types")

    def test_severity_distinguishes_legacy_from_unrecorded(self):
        self.assertEqual(lib.severity_group("9", "P"), "Death (9)")
        self.assertEqual(lib.severity_group("", "M"), lib.LEGACY_OUTCOME)
        self.assertEqual(lib.severity_group("", "P"), lib.NOT_RECORDED)
        self.assertEqual(lib.severity_group("42", "P"), lib.NOT_RECORDED, "an undefined code is never guessed into a group")

    def test_payer_and_judgment(self):
        self.assertEqual(lib.payer_group("1"), lib.payer_group("P"))
        self.assertEqual(lib.payer_group(""), lib.NOT_RECORDED)
        self.assertEqual(lib.payer_group("Z"), lib.NOT_RECORDED)
        self.assertEqual(lib.judgment("J"), "Judgment")
        self.assertEqual(lib.judgment("U"), "Settlement or other (S, B, O, U)")
        self.assertEqual(lib.judgment(""), lib.NOT_RECORDED)

    def test_payment_bands_follow_coded_midpoints(self):
        self.assertEqual(lib.band(None), lib.NOT_RECORDED)
        self.assertEqual(lib.band(8750.0), "$10,000 or less")
        self.assertEqual(lib.band(47500.0), "$10,001-$50,000")
        self.assertEqual(lib.band(97500.0), "$50,001-$100,000")
        self.assertEqual(lib.band(105000.0), "$100,001-$250,000")
        self.assertEqual(lib.band(995000.0), "$500,001-$1,000,000")
        self.assertEqual(lib.band(1050000.0), "$1,000,001-$5,000,000")
        self.assertEqual(lib.band(105_000_000.0), "More than $5,000,000")

    def test_aa_type_default(self):
        self.assertEqual(lib.aa_type("302"), ("licensure", "individual"))
        self.assertEqual(lib.aa_type("1702"), ("exclusion_hhs_oig", "organization"))
        self.assertEqual(lib.aa_type("9999"), ("other", "individual"))
        self.assertEqual(lib.aa_type(""), ("other", "individual"))


class StateAttribution(unittest.TestCase):
    def test_mmpr_work_state_then_home_state_then_unassigned(self):
        self.assertEqual(lib.mmpr_state({"WORKSTAT": "NJ", "HOMESTAT": "NY"}), ("NJ", "work state"))
        self.assertEqual(lib.mmpr_state({"WORKSTAT": " ", "HOMESTAT": "NY"})[0], "NY")
        self.assertEqual(lib.mmpr_state({"WORKSTAT": "", "HOMESTAT": ""})[0], lib.UNASSIGNED)
        # a license state is never used for payment reports
        self.assertEqual(lib.mmpr_state({"WORKSTAT": "", "HOMESTAT": "", "LICNSTAT": "CA"})[0], lib.UNASSIGNED)

    def test_aa_licensure_uses_license_state_others_use_work_state(self):
        self.assertEqual(lib.aa_state({"REPTYPE": "302", "LICNSTAT": "NJ", "WORKSTAT": "CA"}), ("NJ", "license state"))
        self.assertEqual(lib.aa_state({"REPTYPE": "302", "LICNSTAT": "", "WORKSTAT": "CA"})[0], "CA")
        self.assertEqual(lib.aa_state({"REPTYPE": "402", "LICNSTAT": "NJ", "WORKSTAT": "CA"})[0], "CA")
        self.assertEqual(lib.aa_state({"REPTYPE": "402", "LICNSTAT": "NJ", "WORKSTAT": "", "HOMESTAT": "TX"})[0], "TX")
        self.assertEqual(lib.aa_state({"REPTYPE": "702"})[0], lib.UNASSIGNED)

    def test_area_kind_and_place_links_only_for_served_pages(self):
        self.assertEqual(lib.area_kind("NJ"), "state")
        self.assertEqual(lib.area_kind("DC"), "state")
        self.assertEqual(lib.area_kind("PR"), "territory")
        self.assertEqual(lib.area_kind("AE"), "military")
        self.assertEqual(lib.area_kind(lib.UNASSIGNED), "unrecorded")
        self.assertEqual(lib.place_link("NJ", "New Jersey"), {"label": "New Jersey state page", "url": "/places/NJ"})
        self.assertIsNone(lib.place_link("PR", "Puerto Rico"), "no /places page for territories")
        self.assertIsNone(lib.place_link(lib.UNASSIGNED, "State not recorded"))
        self.assertIsNone(lib.place_link("nj", "New Jersey"), "keys are exact: no case folding of codes")

    def test_state_name_match_unique_nonmatch_ambiguous(self):
        table = {"NJ": "New Jersey", "NY": "New York", "XX": "Twin Name", "XY": "twin  name"}
        self.assertEqual(lib.match_state_name("  new   jersey ", table), "NJ", "case and whitespace normalisation only")
        self.assertIsNone(lib.match_state_name("New Jersy", table), "no fuzzy matching")
        self.assertIsNone(lib.match_state_name("Twin Name", table), "two codes share the label: ambiguous")
        self.assertIsNone(lib.match_state_name("", table))
        self.assertIsNone(lib.match_state_name(None, table))


class Aggregation(unittest.TestCase):
    def test_median_from_counter(self):
        self.assertIsNone(lib.median_from_counter({}))
        self.assertEqual(lib.median_from_counter({5: 1}), 5)
        self.assertEqual(lib.median_from_counter({1: 1, 3: 1, 9: 1}), 3)
        self.assertEqual(lib.median_from_counter({1: 1, 3: 1}), 2.0, "even count: mean of the two middle values")
        self.assertEqual(lib.median_from_counter({10: 3, 20: 3}), 15.0)
        self.assertEqual(lib.median_from_counter({10: 1, 20: 5}), 20)

    def test_stats_totals_mean_median_delay(self):
        agg = agg_with(12, pays=[100.0, 300.0], delays=[2, 4])
        s = lib.stats(agg)
        self.assertEqual(s["n"], 12)
        self.assertEqual(s["total"], 2400.0)
        self.assertEqual(s["mean"], 200.0)
        self.assertEqual(s["median"], 200.0)
        self.assertEqual(s["delay_median"], 3.0)

    def test_stats_counts_only_reports_with_amounts_for_mean(self):
        agg = Agg()
        for _ in range(10):
            agg.add(pay=1000.0)
        for _ in range(5):
            agg.add(pay=None)  # reports without a payment amount: counted, never valued at 0
        s = lib.stats(agg)
        self.assertEqual((s["n"], s["n_amount"], s["mean"], s["total"]), (15, 10, 1000.0, 10000.0))

    def test_stats_withholds_money_statistics_below_ten_amounts(self):
        agg = Agg()
        for _ in range(10):
            agg.add(pay=None)
        for _ in range(3):
            agg.add(pay=500.0)
        s = lib.stats(agg)
        self.assertEqual(s["n"], 13)
        self.assertIsNone(s["mean"])
        self.assertIsNone(s["median"])
        self.assertIsNone(s["delay_median"])

    def test_merge_sums_counts_and_multisets(self):
        a, b = agg_with(10, pays=[100.0]), agg_with(10, pays=[300.0])
        a.merge(b)
        self.assertEqual(a.n, 20)
        self.assertEqual(lib.stats(a)["median"], 200.0)

    def test_growth_formulas(self):
        self.assertAlmostEqual(lib.cagr(100.0, 400.0, 2), 1.0, places=5)
        self.assertIsNone(lib.cagr(None, 400.0, 2))
        self.assertIsNone(lib.cagr(0, 400.0, 2))
        self.assertIsNone(lib.cagr(100.0, 400.0, 0))
        self.assertEqual(lib.pct_change(200, 150), -0.25)
        self.assertIsNone(lib.pct_change(0, 5))
        self.assertIsNone(lib.pct_change(None, 5))

    def test_competition_ranking_with_ties_and_unranked(self):
        ranked, of = lib.ranks({"A": 10, "B": 30, "C": 30, "D": 5, "E": None})
        self.assertEqual(ranked, {"B": 1, "C": 1, "A": 3, "D": 4})
        self.assertEqual(of, 4)
        self.assertNotIn("E", ranked, "a suppressed (None) value is unranked, not last")

    def test_money_and_count_text(self):
        self.assertEqual(lib.money(None), lib.NOT_RECORDED)
        self.assertEqual(lib.money(1234567.4), "$1,234,567")
        self.assertEqual(lib.count_text({"n": 1234}), "1,234")
        self.assertEqual(lib.count_text({"n": None, "suppressed": True}), "Fewer than 10 reports (suppressed)")


class DisclosureControl(unittest.TestCase):
    def test_cells_below_ten_are_suppressed(self):
        s = lib.stats(agg_with(9, pays=[100.0]))
        self.assertEqual(s, {"n": None, "suppressed": True})
        self.assertEqual(lib.stats(agg_with(10, pays=[100.0]))["n"], 10)
        self.assertEqual(lib.stats(Agg())["n"], 0, "an empty cell is a true zero, not suppressed")

    def test_fold_pools_small_categories_and_tops_up_to_ten(self):
        cells = {"a": agg_with(40), "b": agg_with(3), "c": agg_with(4), "d": agg_with(25)}
        published, pool, folded = lib.fold(cells)
        # 3 + 4 = 7 is still below ten, so the smallest published category (d, 25) joins the pool
        self.assertEqual(pool.n, 32)
        self.assertEqual(folded, ["b", "c", "d"])
        self.assertEqual(set(published), {"a"})

    def test_fold_adds_smallest_published_category_when_pool_stays_small(self):
        cells = {"a": agg_with(40), "b": agg_with(3), "c": agg_with(12), "d": agg_with(25)}
        published, pool, folded = lib.fold(cells)
        self.assertEqual(pool.n, 15, "3 suppressed + smallest published (12) so the 3 cannot be derived by subtraction")
        self.assertEqual(sorted(folded), ["b", "c"])
        self.assertEqual(set(published), {"a", "d"})

    def test_fold_with_pool_already_at_ten_adds_nothing(self):
        cells = {"a": agg_with(40), "b": agg_with(5), "c": agg_with(5), "d": agg_with(25)}
        published, pool, folded = lib.fold(cells)
        self.assertEqual((pool.n, folded), (10, ["b", "c"]))
        self.assertEqual(set(published), {"a", "d"})

    def test_fold_without_small_cells_returns_no_pool(self):
        published, pool, folded = lib.fold({"a": agg_with(40), "b": agg_with(25), "z": agg_with(0)})
        self.assertIsNone(pool)
        self.assertEqual(folded, [])
        self.assertEqual(set(published), {"a", "b"})

    def test_fold_when_everything_is_small_stays_pooled_and_unpublishable(self):
        published, pool, folded = lib.fold({"a": agg_with(3), "b": agg_with(2)})
        self.assertEqual(published, {})
        self.assertEqual(pool.n, 5)
        cell = lib.stats(pool)
        self.assertTrue(cell["suppressed"])

    def test_breakdown_never_publishes_a_count_between_one_and_nine(self):
        total = Agg()
        for i in range(120):
            key = "big" if i < 80 else ("mid" if i < 100 else ("s%d" % (i % 7)))
            total.add(100.0, 1, {"cat": key})
        rows = lib.breakdown(total, "cat")
        for cell in lib.published_cells(rows):
            n = cell.get("n")
            self.assertTrue(n is None or n == 0 or n >= lib.MIN_CELL, cell)
        keys = [r["key"] for r in rows]
        self.assertIn(lib.COMBINED_KEY, keys)
        pool = next(r for r in rows if r["key"] == lib.COMBINED_KEY)
        self.assertTrue(pool["folded"] >= 1 and pool["folded_keys"])
        self.assertAlmostEqual(sum(r["share"] for r in rows if r.get("share") is not None), 1.0, places=2)

    def test_breakdown_labels_and_order(self):
        total = Agg()
        for i in range(30):
            total.add(None, None, {"cat": "x" if i < 20 else "y"})
        rows = lib.breakdown(total, "cat", labels={"x": "Label X", "y": "Label Y"})
        self.assertEqual([(r["key"], r["label"], r["n"]) for r in rows], [("x", "Label X", 20), ("y", "Label Y", 10)])

    def test_share_text_distinguishes_shown_suppressed_zero_and_missing(self):
        total = Agg()
        for i in range(60):
            total.add(None, None, {"cat": "common" if i < 36 else ("other" if i < 56 else "rare")})
        rows = lib.breakdown(total, "cat", money=False)
        self.assertEqual(lib.share_text(rows, "common"), "60.0%")
        self.assertEqual(lib.share_text(rows, "rare"), lib.SUPPRESSED_SHARE, "4 reports are pooled")
        self.assertEqual(lib.share_text(rows, "other"), lib.SUPPRESSED_SHARE, "20 reports pooled as the complementary cell")
        self.assertEqual(lib.share_text(rows, "never-seen"), "0.0%")
        self.assertEqual(lib.share_text([], "common"), lib.NOT_RECORDED)

    def test_death_share_uses_only_reports_with_recorded_severity(self):
        agg = Agg()
        for i in range(100):  # 100 legacy reports without severity
            agg.add(None, None, {"outcome_recorded": "no", "severity": lib.LEGACY_OUTCOME})
        for i in range(40):  # 40 recorded: 12 deaths
            agg.add(None, None, {"outcome_recorded": "yes", "severity": "Death (9)" if i < 12 else "Temporary injury (3-4)"})
        self.assertEqual(lib.death_share(agg), 0.3, "12 / 40, not 12 / 140")

    def test_death_share_not_recorded_paths(self):
        legacy_only = Agg()
        for _ in range(50):
            legacy_only.add(None, None, {"outcome_recorded": "no", "severity": lib.LEGACY_OUTCOME})
        self.assertIsNone(lib.death_share(legacy_only), "no severity recorded: unknown, not 0%")
        few = Agg()
        for i in range(20):
            few.add(None, None, {"outcome_recorded": "yes", "severity": "Death (9)" if i < 4 else "Temporary injury (3-4)"})
        self.assertIsNone(lib.death_share(few), "fewer than 10 deaths is suppressed")

    def test_audit_flags_small_published_counts(self):
        good = {"id": "g", "item": {"cells": {"reports": 12}, "npdb": {"rows": [{"n": 10}, {"n": None, "suppressed": True}, {"n": 0}]}}}
        bad = {"id": "b", "item": {"cells": {"reports": 4}, "npdb": {"rows": [{"n": 7}]}}}
        self.assertEqual(build.audit([good]), [])
        flagged = build.audit([bad])
        self.assertIn(("b", 7), flagged)
        self.assertIn(("b", "reports", 4), flagged)


class MarginExposure(unittest.TestCase):
    @staticmethod
    def row(year, n):
        return {"filters": {"grain": ["year"], "year": [str(year)]}, "item": {"cells": {"reports": n}}}

    def test_single_hidden_cell_is_flagged_when_below_threshold(self):
        rows = [self.row(2014, 40), self.row(2014, None), self.row(2014, 25)]
        self.assertEqual(build.margin_exposure(rows, {2014: 68}), [{"year": 2014, "hidden_cells": 1, "hidden_total": 3}])

    def test_hidden_cells_that_must_each_be_one_are_flagged(self):
        rows = [self.row(1995, 50), self.row(1995, None), self.row(1995, None)]
        self.assertEqual(build.margin_exposure(rows, {1995: 52}), [{"year": 1995, "hidden_cells": 2, "hidden_total": 2}])

    def test_bounded_sums_and_large_hidden_totals_are_not_flagged(self):
        bounded = [self.row(1992, 50), self.row(1992, None), self.row(1992, None)]  # two hidden cells summing to 3: {1, 2}
        self.assertEqual(build.margin_exposure(bounded, {1992: 53}), [])
        forced = [self.row(2001, 50), self.row(2001, None)]  # one hidden complementary cell of 15: not below the threshold
        self.assertEqual(build.margin_exposure(forced, {2001: 65}), [])
        self.assertEqual(build.margin_exposure([self.row(2001, 50)], {2001: 50}), [], "nothing hidden")

    def test_non_year_rows_and_unknown_years_are_ignored(self):
        summary_row = {"filters": {"grain": ["summary"], "year": ["all"]}, "item": {"cells": {"reports": None}}}
        self.assertEqual(build.margin_exposure([summary_row, self.row(2020, None)], {}), [])


class NotRecordedPaths(unittest.TestCase):
    def test_facts_render_none_as_not_recorded(self):
        facts = build.facts_for([("A", None), ("B", 0), ("C", "x")])
        self.assertEqual(facts, [["A", "Not recorded"], ["B", "0"], ["C", "x"]])

    def test_percent_and_rate_helpers(self):
        self.assertIsNone(build.pct(None))
        self.assertEqual(build.pct(0.1234), "12.3%")
        self.assertIsNone(build.per_million(5, 0), "no population: no rate")
        self.assertIsNone(build.per_million(None, 1000))
        self.assertEqual(build.per_million(50, 1_000_000), 50.0)

    def test_window_rate_requires_all_years_of_population_and_ten_reports(self):
        cells = {y: agg_with(20) for y in range(2021, 2026)}
        pops = {y: 1_000_000 for y in range(2021, 2026)}
        self.assertEqual(build.window_rate(cells, pops, 2021, 2025), 20.0)
        self.assertIsNone(build.window_rate(cells, {2021: 1_000_000}, 2021, 2025), "a missing population year is never imputed")
        tiny = {y: agg_with(1) for y in range(2021, 2026)}
        self.assertIsNone(build.window_rate(tiny, pops, 2021, 2025), "5 reports in the window is below the threshold")
        self.assertIsNone(build.window_rate({2021: agg_with(3)}, {2021: 1_000_000}, 2021, 2021), "3 reports is below the threshold")

    def test_year_label_marks_partial_years(self):
        self.assertIn("partial", build.year_label(1990))
        self.assertIn("partial", build.year_label(2026))
        self.assertEqual(build.year_label(2020), "2020")


# ---------------------------------------------------------------------------------------- synthetic mini PUF

COLUMNS = ["SEQNO", "RECTYPE", "REPTYPE", "ORIGYEAR", "WORKSTAT", "HOMESTAT", "LICNSTAT", "LICNFELD", "ALGNNATR", "ALEGATN1",
           "OUTCOME", "MALYEAR1", "PAYMENT", "PAYTYPE", "PYRRLTNS", "PTAGE", "PTSEX", "PTTYPE", "AAYEAR", "AACLASS1", "BASISCD1",
           "AALENTYP", "FUNDPYMT"]


def puf_row(**kw):
    row = {c: "" for c in COLUMNS}
    row.update(kw)
    return row


def mm_row(state="NJ", year="2020", pay="$97500", **kw):
    base = dict(RECTYPE="P", REPTYPE="101", ORIGYEAR=year, WORKSTAT=state, LICNFELD="10", ALGNNATR="10", ALEGATN1="101", OUTCOME="3",
                MALYEAR1="2015", PAYMENT=pay, PAYTYPE="S", PYRRLTNS="1", FUNDPYMT="0")
    base.update(kw)
    return puf_row(**base)


def aa_row(**kw):
    base = dict(RECTYPE="C", REPTYPE="302", ORIGYEAR="2020", LICNSTAT="NJ", WORKSTAT="CA", LICNFELD="10", AAYEAR="2019", AACLASS1="1125", BASISCD1="39", AALENTYP="S")
    base.update(kw)
    return puf_row(**base)


def synthetic_rows():
    rows = []
    rows += [mm_row("NJ", pay="$97500" if i % 2 else "$195000", PAYTYPE="J" if i == 0 else "S") for i in range(12)]  # NJ 2020: 12 reports
    rows += [mm_row("NJ", "2020", pay="")]  # a report with no payment amount
    rows += [mm_row("PA", "2020") for _ in range(4)]  # below the threshold
    rows += [mm_row("", "2020", HOMESTAT="NY") for _ in range(11)]  # home state fallback
    rows += [mm_row("", "2020", HOMESTAT="", LICNSTAT="CA") for _ in range(3)]  # no work/home state: unassigned
    rows += [mm_row("NJ", "2019", RECTYPE="M", OUTCOME="", MALYEAR1="3999") for _ in range(10)]  # legacy format, erroneous act year
    rows += [aa_row() for _ in range(11)]  # licensure: assigned to license state NJ
    rows += [aa_row(REPTYPE="402", LICNSTAT="NJ", WORKSTAT="CA") for _ in range(10)]  # clinical privileges: work state CA
    rows += [aa_row(REPTYPE="702", LICNSTAT="", WORKSTAT="", HOMESTAT="") for _ in range(2)]  # no state at all
    return rows


def synthetic_zip(path):
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(synthetic_rows())
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(build.PUF_MEMBER, buffer.getvalue().encode("latin-1"))


class SyntheticScan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.zip_path = os.path.join(cls.tmp.name, "puf.zip")
        synthetic_zip(cls.zip_path)
        cls.saved = build.PUF_ZIP
        build.PUF_ZIP = cls.zip_path
        cls.mm, cls.aa, cls.total = build.scan({10: "Physician (MD)"}, {2020: 258.8, 2025: 322.0})

    @classmethod
    def tearDownClass(cls):
        build.PUF_ZIP = cls.saved
        cls.tmp.cleanup()

    def test_row_counts_by_record_type(self):
        self.assertEqual(self.total, len(synthetic_rows()))
        self.assertEqual(self.mm["rows"], 12 + 1 + 4 + 11 + 3 + 10)
        self.assertEqual(self.aa["rows"], 11 + 10 + 2)

    def test_state_year_cells_and_money(self):
        cell = self.mm["st_year"][("NJ", 2020)]
        self.assertEqual(cell.n, 13)
        self.assertEqual(cell.n_amount, 12, "the report without a payment is counted but has no amount")
        s = lib.stats(cell)
        self.assertEqual(s["total"], 6 * 97500 + 6 * 195000)
        self.assertEqual(s["median"], (97500 + 195000) / 2)
        self.assertEqual(s["delay_median"], 5.0)

    def test_home_state_fallback_and_unassigned(self):
        self.assertEqual(self.mm["st_year"][("NY", 2020)].n, 11)
        self.assertEqual(self.mm["st_year"][(lib.UNASSIGNED, 2020)].n, 3)
        self.assertEqual(self.mm["unassigned_with_license_state"], 3)
        self.assertNotIn(("CA", 2020), self.mm["st_year"], "a license state is not used for payment reports")

    def test_erroneous_act_year_gives_no_delay(self):
        legacy = self.mm["st_year"][("NJ", 2019)]
        self.assertEqual(legacy.n, 10)
        self.assertIsNone(lib.stats(legacy)["delay_median"], "MALYEAR1 = 3999 is excluded, not imputed")
        severity = {r["key"]: r["n"] for r in lib.breakdown(legacy, "severity")}
        self.assertEqual(severity, {lib.LEGACY_OUTCOME: 10})

    def test_adverse_action_state_assignment(self):
        self.assertEqual(self.aa["st_year"][("NJ", 2020)].n, 11)
        self.assertEqual(self.aa["st_year"][("CA", 2020)].n, 10)
        self.assertEqual(self.aa["st_year"][(lib.UNASSIGNED, 2020)].n, 2)
        types = {r["key"]: r["n"] for r in lib.breakdown(self.aa["nat_all"], "type", money=False)}
        self.assertEqual(types["licensure"], 11)
        # 2 exclusion reports are suppressed; their pool (2) is below ten, so the smallest published type
        # (clinical privileges, 10) joins it: neither can be derived by subtracting from the total.
        self.assertEqual(types[lib.COMBINED_KEY], 12)
        self.assertNotIn("exclusion_hhs_oig", types)
        self.assertNotIn("clinical_privileges", types)

    def test_malpractice_state_records_end_to_end(self):
        book = {"ALGNNATR": {"10": "Diagnosis Related"}, "OUTCOME": {"3": "Minor Temporary Injury"}, "ALEGATN1": {"101": "Failure to diagnose"},
                "PTSEX": {}, "PTAGE": {}, "PTTYPE": {}}
        labels = build.mmpr_labels(book)
        names = {"NJ": "New Jersey", "PA": "Pennsylvania", "NY": "New York", lib.UNASSIGNED: "State not recorded"}
        pops = {"NJ": {2020: 9_300_000}}
        facts = [("Source", "synthetic")]
        rows, summaries, ranks = build.build_malpractice_states(self.mm, labels, names, pops, {}, facts)
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(build.audit(rows), [], "no published count between 1 and 9")
        nj = by_id["npdb-mmpr:NJ:2020"]
        self.assertEqual(nj["item"]["cells"]["reports"], 13)
        self.assertEqual(nj["item"]["cells"]["per_million"], round(13 / 9_300_000 * 1e6, 2))
        self.assertIn({"label": "New Jersey state page", "url": "/places/NJ"}, nj["item"]["links"])
        self.assertEqual(nj["state"], "NJ")
        pa = by_id["npdb-mmpr:PA:2020"]
        self.assertIsNone(pa["item"]["cells"]["reports"], "4 reports are suppressed")
        self.assertIn(["Reports", "Fewer than 10 reports or withheld (suppressed)"], pa["detail"]["facts"])
        self.assertIn("Suppressed", pa["item"]["badges"])
        pa_all = by_id["npdb-mmpr:PA:all"]
        self.assertIsNone(pa_all["item"]["cells"]["reports"])
        self.assertIsNone(pa_all["item"]["cells"]["median_payment"])
        nr = by_id["npdb-mmpr:NR:all"]
        self.assertEqual(nr["item"]["cells"]["state"], "State not recorded")
        self.assertEqual(nr["state"], "", "the unassigned bucket is attached to no state")
        self.assertFalse(any(l["url"].startswith("/places/") for l in nr["item"]["links"]))
        # per-capita denominators not available for NY: Not recorded, never a guess
        ny = by_id["npdb-mmpr:NY:2020"]
        self.assertIsNone(ny["item"]["cells"]["per_million"])
        self.assertTrue(any(f[0] == "Per-capita denominator" and f[1].startswith("Not recorded") for f in ny["detail"]["facts"]))
        # JSON round trip (what publish_build.py validates)
        self.assertEqual(json.loads(json.dumps(rows)), rows)
        # rankings contain only states with a published value (no 2021-2025 window data in the fixture)
        self.assertEqual({d["code"] for d in ranks["median_payment_2021_2025"]}, set())

    def test_ids_are_unique_and_dataset_fields_set(self):
        book = {"ALGNNATR": {}, "OUTCOME": {}, "ALEGATN1": {}, "PTSEX": {}, "PTAGE": {}, "PTTYPE": {}}
        rows, _, _ = build.build_malpractice_states(self.mm, build.mmpr_labels(book), {"NJ": "New Jersey"}, {}, {}, [("Source", "synthetic")])
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(r["dataset"] == "npdb_malpractice_states" and r["category"] == "npdb_malpractice_states" for r in rows))
        self.assertTrue(all(r["source_url"].startswith("https://www.npdb.hrsa.gov/") for r in rows))


@unittest.skipUnless(os.path.exists(os.path.join(BUILD_DIR, "npdb_malpractice_states.json")), "build files not generated")
class BuiltFiles(unittest.TestCase):
    """Optional checks over the generated build files (skipped when they are absent)."""

    NAMES = ["npdb_malpractice_states", "npdb_malpractice_national", "npdb_adverse_actions", "npdb_state_board_compliance"]

    def load(self, name):
        with open(os.path.join(BUILD_DIR, name + ".json")) as handle:
            return json.load(handle)

    def test_no_published_count_between_one_and_nine_and_no_identifiers(self):
        for name in self.NAMES[:3]:
            build_file = self.load(name)
            self.assertEqual(build.audit(build_file["rows"]), [], name)
            text = json.dumps(build_file["rows"])
            self.assertNotIn("PRACTNUM", text)
            self.assertNotIn("SEQNO", text)

    def test_shape_and_places_links(self):
        for name in self.NAMES:
            build_file = self.load(name)
            self.assertEqual(build_file["dataset"], name)
            self.assertEqual(set(build_file), {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs"})
            ids = [r["id"] for r in build_file["rows"]]
            self.assertEqual(len(ids), len(set(ids)))
            for row in build_file["rows"]:
                self.assertTrue(row["source_url"].startswith("http"))
                for link in row["item"]["links"]:
                    url = link["url"]
                    if url.startswith("/places/") and url != "/places/analytics":
                        self.assertIn(url[len("/places/"):], lib.PLACE_CODES, "only states and DC have a /places page")


if __name__ == "__main__":
    unittest.main()
