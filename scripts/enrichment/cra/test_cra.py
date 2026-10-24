"""Offline tests for the class action research report extraction (synthetic fixtures, no network, no PDFs).

    cd scripts/enrichment/cra && python3 -B -m unittest -v test_cra
"""
from __future__ import annotations

import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import cra_specs as S  # noqa: E402
import cra_tables as T  # noqa: E402
import cra_textfacts as X  # noqa: E402

BASIC = """Appendix 1: Filings Basic Metrics
                                            Disclosure Dollar Loss                    Maximum Dollar Loss
               Class
               Action     Core     DDL Total Average             Median       MDL Total Average             Median                 of Listed  of Listed
    Year       Filings   Filings   ($ Billions) ($ Millions)   ($ Millions)   ($ Billions) ($ Millions)   ($ Millions)   Number   Firms Sued Firms Sued
    2024        226       221         $429       $2,258          $410          $1,639       $8,625        $1,854        5,316         206        3.9%
    2025        207       201         $694       $4,059          $503          $2,862      $16,738        $2,370        5,129         181        3.5%
   Average
               227       194         $250       $1,453          $236          $1,244       $7,224        $1,219        5,531         173        3.2%
 1997–2024

Note: The numbers shown in this figure have been inflation-
adjusted to 2025 dollars and will not match prior reports.
"""

CIRCUIT = """Appendix 6: Filings by Circuit—Core Federal Filings
(Dollars in 2025 billions)
                                      Class Action Filings                      Disclosure Dollar Loss                       Maximum Dollar Loss
                            Average                                   Average                                      Average
              Circuit     1997–2024     2023        2024     2025   1997–2024      2023        2024      2025    1997–2024      2023      2024     2025
 1st                           8            6           9      4       $10            $6         $9        $1        $32          $22       $38       $6
 2nd                          56          49           64     63       $71         $107         $88      $254       $385         $505      $469     $496
 Total                        64          55           73     67       $81         $113         $97      $255       $417         $527      $507     $502
Note: Figures may not sum due to rounding.
"""

SUMMARY = """Figure 1: Federal and State Class Action Filings Summary
(Dollars in 2025 billions)
                                                            Annual (1997–2024)                                 2024              2025
                                                     Average    Maximum      Minimum
      Class Action Filings                               227                427                120               226                207
         Core Filings                                    194                267               120                221               201
      Disclosure Dollar Loss (DDL)                      $250              $652                 $76             $429               $694
Note: This figure presents combined federal and state data.
"""


def ctx(pages, period="2025", rid="cr-filings-2025-yir"):
    return {"id": rid, "pages": pages, "printed": [None] * len(pages), "report": {"id": rid, "period": period}}


class ParseLine(unittest.TestCase):
    def test_label_and_values(self):
        self.assertEqual(T.parse_line(" Consumer Non-Cyclical        55          54"), ("Consumer Non-Cyclical", ["55", "54"]))

    def test_year_row(self):
        self.assertEqual(T.parse_line("    2001        180       $364", year_rows=True), ("2001", ["180", "$364"]))

    def test_header_of_years_is_not_data(self):
        self.assertIsNone(T.parse_line("      Annual (1997–2016)        2016        2017"))
        self.assertIsNone(T.parse_line("   (1997–2013)     2013     2014"))

    def test_prose_is_not_data(self):
        self.assertIsNone(T.parse_line("There were 16 filings in the AI trend category in 2025"))

    def test_word_scaled_dollars(self):
        self.assertEqual(T.parse_line("   Median        $7.5 million        $6.3 million"), ("Median", ["$7.5 million", "$6.3 million"]))
        self.assertEqual(T.scale_suffix("$3.5 billion"), "B")
        self.assertEqual(T.scale_suffix("$44.8B"), "B")
        self.assertEqual(T.scale_suffix("$437,000"), "")

    def test_malformed_value_rejects_the_row(self):
        self.assertIsNone(T.parse_line("Total Amount   $20,486.9   $2.227.5   $4,395.2"))


class Values(unittest.TestCase):
    def test_dash_is_not_zero(self):
        self.assertEqual(T.value_of("-"), (None, "-"))
        self.assertEqual(T.value_of("—")[0], None)

    def test_numbers(self):
        self.assertEqual(T.value_of("$1,909")[0], 1909)
        self.assertEqual(T.value_of("2.0%")[0], 2.0)
        self.assertEqual(T.value_of("$12.2(1)")[0], 12.2)
        self.assertEqual(T.value_of("(12)")[0], -12)


class Regions(unittest.TestCase):
    def test_multiline_average_label_and_note(self):
        regs = T.regions([BASIC], re.compile(r"Appendix 1: Filings Basic Metrics"), year_rows=True)
        self.assertEqual(len(regs), 1)
        labels = [r.label for r in regs[0].rows]
        self.assertEqual(labels, ["2024", "2025", "Average 1997–2024"])
        self.assertIn("2025 dollars", regs[0].notes)

    def test_toc_line_is_not_a_caption(self):
        page = "Appendix 1: Filings Basic Metrics                                  29\nAppendix 2: Other     30\n"
        self.assertEqual(T.regions([page], re.compile(r"Appendix 1: Filings Basic Metrics")), [])


class Periods(unittest.TestCase):
    def test_header_periods_skip_dollar_year(self):
        self.assertEqual(S.header_periods("(Dollars in 2025 billions) Annual (1997–2024) 2024 2025"),
                         [("1997–2024", "range"), ("2024", "year"), ("2025", "year")])

    def test_halves_and_through(self):
        self.assertEqual(S.header_periods("Semiannual (1997 H1–2025 H2) 2025 H1 2025 H2 2026 H1")[0], ("1997 H1–2025 H2", "range"))
        self.assertEqual(S.header_periods("2010   Settlements Through 2009"), [("2010", "year"), ("through 2009", "range")])

    def test_row_period(self):
        self.assertEqual(S.row_period("2025 H1"), ("2025 H1", "half", ""))
        self.assertEqual(S.row_period("Average (1997– 2016)"), ("1997–2016", "range", "annual average"))
        self.assertIsNone(S.row_period("Average"))  # an average without its printed period is left out

    def test_summary_columns(self):
        cols = S.summary_columns("Annual (1997–2024) 2024 2025 Average Maximum Minimum", 5)
        self.assertEqual([c[2] for c in cols], ["annual average", "annual maximum", "annual minimum", "", ""])
        self.assertIsNone(S.summary_columns("Annual (1997–2024) 2024 2025 Average", 5))


class Totals(unittest.TestCase):
    def test_exact_counts(self):
        self.assertEqual(S.sums_ok([["8"], ["56"]], ["64"], [True]), [])
        self.assertTrue(S.sums_ok([["8"], ["56"]], ["65"], [True]))

    def test_rounding_tolerance_per_cell(self):
        # three values rounded to whole dollars may differ from the printed total by up to 1.5 + 0.5
        self.assertEqual(S.sums_ok([["$10"], ["$71"], ["$1"]], ["$83"], [False]), [])
        self.assertTrue(S.sums_ok([["$10"], ["$71"]], ["$6"], [False]))  # a truncated total ("$6" for ~$81) is held


class Basis(unittest.TestCase):
    def test_hyphenated_note(self):
        self.assertEqual(T.basis_of("have been inflation- adjusted to 2025 dollars", "usd_billions"), "inflation-adjusted, 2025 dollars")

    def test_not_stated(self):
        self.assertEqual(T.basis_of("(Dollars in Billions)", "usd_billions"), "not stated")
        self.assertEqual(T.basis_of("anything", "filings"), "")


class Extraction(unittest.TestCase):
    def test_basic_metrics(self):
        res = S.Result()
        S.extract_year_table(res, ctx([BASIC]), re.compile(r"Appendix 1: Filings Basic Metrics"), S.basic_columns)
        f = {(x.series, x.period, x.aggregate): x for x in res.facts}
        self.assertEqual(f[("filings.class_action_filings", "2025", "")].value, 207)
        self.assertEqual(f[("filings.ddl_total", "2025", "")].value_text, "$694")
        self.assertEqual(f[("filings.ddl_total", "2025", "")].basis, "inflation-adjusted, 2025 dollars")
        self.assertEqual(f[("filings.listed_firms_sued_core_pct", "1997–2024", "annual average")].value, 3.2)
        self.assertEqual(len(res.facts), 33)

    def test_category_table_with_total(self):
        res = S.Result()
        S.extract_category_table(res, ctx([CIRCUIT]), re.compile(r"Appendix 6: Filings by Circuit"), "Circuit", "filings.by_circuit")
        self.assertFalse(res.issues)
        f = {(x.series, x.dimension, x.period): x for x in res.facts}
        self.assertEqual(f[("filings.by_circuit.filings", "Circuit: 2nd", "2025")].value, 63)
        self.assertEqual(f[("filings.by_circuit.mdl_total", "Circuit: 1st", "1997–2024")].aggregate, "annual average")

    def test_category_table_failing_total_is_held(self):
        bad = CIRCUIT.replace("73     67       $81", "73     68       $81")  # a single-year count must add up exactly
        res = S.Result()
        S.extract_category_table(res, ctx([bad]), re.compile(r"Appendix 6: Filings by Circuit"), "Circuit", "filings.by_circuit")
        self.assertEqual(res.facts, [])
        self.assertEqual(res.tables[0]["status"], "held")

    def test_summary(self):
        res = S.Result()
        S.extract_filings_summary(res, ctx([SUMMARY]))
        f = {(x.series, x.period, x.aggregate): x for x in res.facts}
        self.assertEqual(f[("filings.class_action_filings", "1997–2024", "annual maximum")].value, 427)
        self.assertEqual(f[("filings.core_filings", "2025", "")].value, 201)
        self.assertEqual(f[("filings.ddl_total", "2024", "")].unit, "usd_billions")

    def test_cohort_partial(self):
        c = ctx([], period="2025")
        self.assertTrue(S.cohort_partial("2024", "filings.cohort_status.y2_settled", c))
        self.assertFalse(S.cohort_partial("2023", "filings.cohort_status.y2_settled", c))
        self.assertFalse(S.cohort_partial("2024", "filings.cohort_status.y1_settled", c))

    def test_metric_label_tail(self):
        rowmap = S.SETTLEMENT_ROWS
        self.assertEqual(S.tail_match("Even excluding the Median", rowmap)[1], "Median")
        self.assertIsNone(S.tail_match("Settlements", rowmap))


class PrintedPages(unittest.TestCase):
    def test_gap_fill_and_lone_detection(self):
        pages = ["cover", "x\n2025 Year in Review | Securities Class Action Filings     1", "no footer",
                 "x\n2025 Year in Review | Securities Class Action Filings     3", "x\nsome table 977"]
        self.assertEqual(T.printed_pages(pages), [None, "1", "2", "3", None])


class TextFacts(unittest.TestCase):
    rep = {"id": "nera-us-2025-fy", "family": "nera_us"}

    def run_text(self, text, fam="nera_us"):
        return X.apply({"id": "r", "family": fam}, [text], [None])[0]

    def test_filings_with_year(self):
        f = self.run_text("There were 207 new federal securities class actions filed in the US in 2025, an 11% decline from the 232 cases "
                          "filed in 2024 and ending a two-year increase.")
        self.assertEqual(sorted((x.period, x.value) for x in f), [("2024", 232), ("2025", 207)])

    def test_sentence_without_year_is_ignored(self):
        f = self.run_text("Focusing on specific categories of cases, there were 17 filings with AI-related claims, while there were 14 "
                          "cases with crypto-related claims, 75% more than in 2024.")
        self.assertEqual(f, [])

    def test_half_year_and_partial(self):
        f = self.run_text("There were 15 AI-related filings in 2026 H1, which is on pace to nearly double.", fam="cr_filings")
        self.assertEqual((f[0].period, f[0].period_type), ("2026 H1", "half"))
        p = self.run_text("Filings Through November 30, 2009, 215 federal securities class actions were filed.")
        self.assertTrue(p[0].partial)

    def test_word_numbers(self):
        f = self.run_text("The number of COVID-19-related filings decreased from 15 in 2024 to three in 2025, the lowest.", fam="cr_filings")
        self.assertEqual(sorted((x.period, x.value) for x in f), [("2024", 15), ("2025", 3)])

    def test_projection_not_captured(self):
        f = self.run_text("If filings continue at the same rate over the second half of the year, there will be a total of 202 federal "
                          "securities class action filings in 2010.")
        self.assertEqual(f, [])

    def test_two_measures_in_one_sentence(self):
        f = self.run_text("While the average settlement value declined by 9% in 2025 to $40 million, the median settlement value increased "
                          "by 21% to $17 million, a 10-year high.")
        self.assertEqual(sorted((x.series, x.value, x.unit) for x in f),
                         [("nera.settlement_average", 40, "usd_millions"), ("nera.settlement_median", 17, "usd_millions")])


class Registry(unittest.TestCase):
    def test_ids_unique_and_families_known(self):
        import cra_inventory as I
        ids = [r[1] for r in I._R]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(r[2] in I.FAMILIES for r in I._R))

    def test_filename_matching(self):
        import cra_inventory as I
        def match(name):
            return [r[1] for r in I._R if re.search(r[0], name)]
        self.assertEqual(match("Securities-Class-Action-Filings-2026-Midyear-Assessment.pdf"), ["cr-filings-2026-mya"])
        self.assertEqual(match("Settlements-Through-12-2016-Review.pdf"), ["cr-settlements-2016"])
        self.assertEqual(match("PUB_2025_Recent_SCA_Trends_Full-Year_0121.pdf"), ["nera-us-2025-fy"])
        self.assertEqual(match("unrelated.pdf"), [])


class Build(unittest.TestCase):
    def fact(self, **kw):
        base = dict(report_id="cr-filings-2025-yir", series="filings.class_action_filings", series_label="Class action filings",
                    period="2025", period_type="year", aggregate="", value=207, value_text="207", unit="filings", basis="",
                    dimension="", scope="Federal and State", table="Appendix 1: Filings Basic Metrics", row_label="2025",
                    column_label="Class action filings", pdf_page=33, printed_page="29")
        base.update(kw)
        return S.Fact(**base)

    def test_row_shape(self):
        import build_cra as B
        rep = {"id": "cr-filings-2025-yir", "title": "Securities Class Action Filings—2025 Year in Review",
               "publisher": "Cornerstone Research", "date": "January 2026", "date_basis": "x", "period": "2025", "family": "cr_filings",
               "pdf_url": "https://www.cornerstone.com/r.pdf"}
        row = B.fact_row(self.fact(), rep)
        self.assertEqual(row["source_url"], "https://www.cornerstone.com/r.pdf#page=33")
        self.assertEqual(row["filters"]["series"], ["filings.class_action_filings"])
        self.assertEqual(row["item"]["profile"]["value"], 207)
        self.assertEqual(B.fact_id(self.fact()), B.fact_id(self.fact()))
        self.assertNotEqual(B.fact_id(self.fact()), B.fact_id(self.fact(period="2024")))

    def test_restatement_and_within_report_checks(self):
        import build_cra as B
        reps = {"a": {"id": "a", "family": "cr_filings", "publisher": "P", "date": "2025"},
                "b": {"id": "b", "family": "cr_filings", "publisher": "P", "date": "2026"}}
        facts = [self.fact(report_id="a", value=225, value_text="225", period="2024"),
                 self.fact(report_id="b", value=226, value_text="226", period="2024"),
                 self.fact(report_id="b", value=226, value_text="226", period="2024", table="Figure 1")]
        ck = B.checks(facts, reps)
        self.assertEqual(len(ck["restated"]), 1)
        self.assertEqual(ck["within_report"], [])
        facts.append(self.fact(report_id="b", value=227, value_text="227", period="2024", table="Figure 2"))
        self.assertEqual(len(B.checks(facts, reps)["within_report"]), 1)


if __name__ == "__main__":
    unittest.main()
