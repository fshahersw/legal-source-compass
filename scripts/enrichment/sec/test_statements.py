"""Unit tests for the statement builder (periods, quarter derivation, concept consistency, margins and growth).
Run: python3 -m unittest scripts/enrichment/sec/test_statements.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import statements as st  # noqa: E402


def fact(start, end, val, form="10-K", filed="2025-02-01", accn="k25"):
    f = {"end": end, "val": val, "form": form, "filed": filed, "accn": accn}
    if start:
        f["start"] = start
    return f


def q_facts(year, q1, h1, m9, annual, *, filed_k, accn_k, concept_q=None):
    """10-Q year-to-date facts (Q1 3-month, 6-month, 9-month) and the 10-K annual value of one calendar fiscal year."""
    return [
        fact(f"{year}-01-01", f"{year}-03-31", q1, form="10-Q", filed=f"{year}-05-01", accn=f"q1-{year}"),
        fact(f"{year}-01-01", f"{year}-06-30", h1, form="10-Q", filed=f"{year}-08-01", accn=f"q2-{year}"),
        fact(f"{year}-01-01", f"{year}-09-30", m9, form="10-Q", filed=f"{year}-11-01", accn=f"q3-{year}"),
        fact(f"{year}-01-01", f"{year}-12-31", annual, filed=filed_k, accn=accn_k),
    ]


def company(revenue, *, net=None, eps=None, assets=None, extra=None):
    gaap = {"Revenues": {"units": {"USD": revenue}}}
    if net:
        gaap["NetIncomeLoss"] = {"units": {"USD": net}}
    if eps:
        gaap["EarningsPerShareDiluted"] = {"units": {"USD/shares": eps}}
    if assets:
        gaap["Assets"] = {"units": {"USD": assets}}
    gaap.update(extra or {})
    return {"us-gaap": gaap}


REVENUE = (q_facts(2023, 10, 21, 33, 46, filed_k="2024-02-01", accn_k="k23")
           + q_facts(2024, 12, 25, 39, 54, filed_k="2025-02-01", accn_k="k24")
           # the year in progress: two 10-Qs so far
           + [fact("2025-01-01", "2025-03-31", 14, form="10-Q", filed="2025-05-01", accn="q1-2025"),
              fact("2025-01-01", "2025-06-30", 29, form="10-Q", filed="2025-08-01", accn="q2-2025")])


class Periods(unittest.TestCase):
    def test_fiscal_years_from_annual_forms(self):
        fys = st.fiscal_years(company(REVENUE))
        self.assertEqual([(y["fy"], y["start"], y["end"]) for y in fys], [(2023, "2023-01-01", "2023-12-31"), (2024, "2024-01-01", "2024-12-31")])

    def test_quarter_periods_need_three_interior_ends(self):
        fy = {"fy": 2024, "start": "2024-01-01", "end": "2024-12-31"}
        pool = st.facts_for(company(REVENUE), "us-gaap", "Revenues", "money")[1]
        qs = st.quarter_periods(fy, pool)
        self.assertEqual([q["end"] for q in qs], ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"])
        partial = [f for f in pool if f["end"] != "2024-09-30"]
        self.assertIsNone(st.quarter_periods(fy, partial))

    def test_current_year_quarters_follow_the_last_annual_report(self):
        pool = st.facts_for(company(REVENUE), "us-gaap", "Revenues", "money")[1]
        qs = st.current_year_quarters({"fy": 2024, "start": "2024-01-01", "end": "2024-12-31"}, pool)
        self.assertEqual([(q["fy"], q["q"], q["start"], q["end"]) for q in qs],
                         [(2025, 1, "2025-01-01", "2025-03-31"), (2025, 2, "2025-04-01", "2025-06-30")])

    def test_current_year_quarters_stop_at_a_gap(self):
        pool = [{"start": "2025-01-01", "end": "2025-03-31", "v": 1}, {"start": "2025-01-01", "end": "2025-09-30", "v": 3}]
        qs = st.current_year_quarters({"fy": 2024, "start": "2024-01-01", "end": "2024-12-31"}, pool)
        self.assertEqual([q["end"] for q in qs], ["2025-03-31"])


class Quarters(unittest.TestCase):
    def setUp(self):
        self.s = st.build_statements(company(REVENUE))

    def test_quarterly_values_and_derivation_flags(self):
        cells = self.s["lines"]["revenue"]["quarterly"]
        ends = [q["end"] for q in self.s["quarterly_periods"]]
        self.assertEqual(ends[-2:], ["2025-03-31", "2025-06-30"])
        got = {e: (c["v"], c["derived"]) for e, c in zip(ends, cells)}
        self.assertEqual(got["2024-03-31"], (12, False))
        self.assertEqual(got["2024-06-30"], (13, True))  # 25 - 12
        self.assertEqual(got["2024-09-30"], (14, True))  # 39 - 25
        self.assertEqual(got["2024-12-31"], (15, True))  # 54 - 39
        self.assertEqual(got["2025-06-30"], (15, True))  # 29 - 14

    def test_per_share_values_are_never_derived(self):
        eps = [fact("2024-01-01", "2024-03-31", 0.5, form="10-Q", filed="2024-05-01", accn="q1-2024"),
               fact("2024-01-01", "2024-06-30", 1.1, form="10-Q", filed="2024-08-01", accn="q2-2024"),
               fact("2024-01-01", "2024-12-31", 2.4, accn="k24")]
        s = st.build_statements(company(REVENUE, eps=eps))
        ends = [q["end"] for q in s["quarterly_periods"]]
        cells = dict(zip(ends, s["lines"]["eps_diluted"]["quarterly"]))
        self.assertEqual(cells["2024-03-31"]["v"], 0.5)
        self.assertIsNone(cells["2024-06-30"])
        self.assertIsNone(cells["2024-12-31"])

    def test_fourth_quarter_from_annual_less_three_quarters_of_the_same_concept(self):
        # Quarters filed as 3-month values only (no 9-month year to date): Q4 = FY - Q1 - Q2 - Q3.
        revenue = [fact("2024-01-01", "2024-03-31", 12, form="10-Q", filed="2024-05-01", accn="q1"),
                   fact("2024-04-01", "2024-06-30", 13, form="10-Q", filed="2024-08-01", accn="q2"),
                   fact("2024-07-01", "2024-09-30", 14, form="10-Q", filed="2024-11-01", accn="q3"),
                   fact("2024-01-01", "2024-12-31", 54, accn="k24")]
        s = st.build_statements(company(revenue))
        q4 = s["lines"]["revenue"]["quarterly"][3]
        self.assertEqual((q4["v"], q4["derived"]), (15, True))
        self.assertEqual(q4["derived_from"], ["q1", "q2", "q3", "k24"])

    def test_a_quarter_never_takes_a_concept_other_than_its_years_total(self):
        # Revenues is the annual concept; a narrower concept with only a Q4 3-month value must not fill Q4.
        revenue = [fact("2024-01-01", "2024-03-31", 12, form="10-Q", filed="2024-05-01", accn="q1"),
                   fact("2024-01-01", "2024-06-30", 25, form="10-Q", filed="2024-08-01", accn="q2"),
                   fact("2024-01-01", "2024-09-30", 39, form="10-Q", filed="2024-11-01", accn="q3"),
                   fact("2024-01-01", "2024-12-31", 54, accn="k24")]
        other = {"RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
            fact("2024-10-01", "2024-12-31", 4, accn="k24")]}}}
        s = st.build_statements(company(revenue, extra=other))
        q4 = s["lines"]["revenue"]["quarterly"][3]
        self.assertEqual(q4["concept"], "Revenues")
        self.assertEqual(q4["v"], 15)

    def test_a_synonym_reporting_the_same_annual_amount_may_fill_a_quarter(self):
        # Revenues (first in precedence) gives the annual value and Q1 only; a synonym with the same annual amount fills
        # Q2 and Q3; a concept with a different annual amount does not.
        revenue = [fact("2024-01-01", "2024-12-31", 54, accn="k24"), fact("2024-01-01", "2024-03-31", 12, form="10-Q", filed="2024-05-01", accn="q1")]
        extra = {
            "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
                fact("2024-01-01", "2024-12-31", 30, accn="k24"), fact("2024-04-01", "2024-06-30", 7, form="10-Q", filed="2024-08-01", accn="q2")]}},
            "SalesRevenueNet": {"units": {"USD": [
                fact("2024-01-01", "2024-12-31", 54, accn="k24"), fact("2024-04-01", "2024-06-30", 13, form="10-Q", filed="2024-08-01", accn="q2"),
                fact("2024-07-01", "2024-09-30", 14, form="10-Q", filed="2024-11-01", accn="q3")]}},
        }
        s = st.build_statements(company(revenue, extra=extra))
        cells = s["lines"]["revenue"]["quarterly"]
        self.assertEqual([(c["v"], c["concept"]) for c in cells[:3]],
                         [(12, "Revenues"), (13, "SalesRevenueNet"), (14, "SalesRevenueNet")])


class Ifrs(unittest.TestCase):
    def test_net_sales_of_goods_is_revenue_only_when_no_revenue_line_is_tagged(self):
        sales = {"RevenueFromSaleOfGoods": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 50, form="20-F", accn="f24")]}}}
        s = st.build_statements({"ifrs-full": sales})
        self.assertEqual(s["lines"]["revenue"]["annual"][0]["concept"], "RevenueFromSaleOfGoods")
        both = {**sales, "Revenue": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 55, form="20-F", accn="f24")]}}}
        s = st.build_statements({"ifrs-full": both})
        self.assertEqual((s["lines"]["revenue"]["annual"][0]["concept"], s["lines"]["revenue"]["annual"][0]["v"]), ("Revenue", 55))


class Latest(unittest.TestCase):
    def test_latest_filing_wins_for_a_restated_period(self):
        revenue = [fact("2023-01-01", "2023-12-31", 46, filed="2024-02-01", accn="k23"),
                   fact("2023-01-01", "2023-12-31", 47, filed="2025-02-01", accn="k24"),
                   fact("2024-01-01", "2024-12-31", 54, filed="2025-02-01", accn="k24")]
        s = st.build_statements(company(revenue))
        first = s["lines"]["revenue"]["annual"][0]
        self.assertEqual((first["v"], first["accn"]), (47, "k24"))

    def test_eight_k_facts_are_ignored(self):
        revenue = [fact("2024-01-01", "2024-12-31", 54, accn="k24"), fact("2024-01-01", "2024-12-31", 99, form="8-K", filed="2025-03-01", accn="8k")]
        s = st.build_statements(company(revenue))
        self.assertEqual(s["lines"]["revenue"]["annual"][0]["v"], 54)


class Computed(unittest.TestCase):
    def test_margins_growth_and_free_cash_flow(self):
        extra = {
            "CostOfRevenue": {"units": {"USD": [fact("2023-01-01", "2023-12-31", 26, filed="2024-02-01", accn="k23"),
                                                  fact("2024-01-01", "2024-12-31", 27, accn="k24")]}},
            "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 20, accn="k24")]}},
            "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 5, accn="k24")]}},
        }
        net = [fact("2023-01-01", "2023-12-31", 4, filed="2024-02-01", accn="k23"), fact("2024-01-01", "2024-12-31", 6, accn="k24")]
        s = st.build_statements(company(REVENUE, net=net, extra=extra))
        gp = s["lines"]["gross_profit"]["annual"]
        self.assertEqual([c["v"] for c in gp], [20, 27])
        self.assertTrue(all(c["computed"] for c in gp))
        self.assertEqual(s["lines"]["fcf"]["annual"][1]["v"], 15)
        self.assertEqual(s["margins"]["annual"]["gross_margin"], [round(100 * 20 / 46, 2), 50.0])
        self.assertEqual(s["margins"]["annual"]["net_margin"][1], round(100 * 6 / 54, 2))
        self.assertEqual(s["growth"]["annual"]["revenue"], [None, round(100 * 8 / 46, 1)])

    def test_quarterly_growth_compares_the_same_quarter_a_year_earlier(self):
        s = st.build_statements(company(REVENUE))
        periods = s["quarterly_periods"]
        growth = dict(zip([(p["fy"], p["q"]) for p in periods], s["growth"]["quarterly"]["revenue"]))
        self.assertEqual(growth[(2024, 1)], 20.0)  # 12 vs 10
        self.assertEqual(growth[(2025, 1)], round(100 * 2 / 12, 1))

    def test_no_annual_report_means_no_statements(self):
        self.assertIsNone(st.build_statements(company([fact("2024-01-01", "2024-03-31", 1, form="10-Q")])))


if __name__ == "__main__":
    unittest.main()
