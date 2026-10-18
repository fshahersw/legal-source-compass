"""Unit tests for XBRL series rules. Run: python3 -m unittest scripts/enrichment/sec/test_financials.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import financials as fin  # noqa: E402


def fact(start, end, val, form="10-K", filed="2024-02-01", accn="a", fy=2023, fp="FY"):
    f = {"end": end, "val": val, "form": form, "filed": filed, "accn": accn, "fy": fy, "fp": fp}
    if start:
        f["start"] = start
    return f


FACTS = {
    "us-gaap": {
        "Revenues": {"units": {"USD": [
            fact("2022-01-01", "2022-12-31", 100, filed="2023-02-01"),
            fact("2022-01-01", "2022-12-31", 105, filed="2024-02-01"),  # restated in the next 10-K
            fact("2023-01-01", "2023-12-31", 120),
            fact("2023-10-01", "2023-12-31", 31, form="10-K"),  # a quarter inside the 10-K
            fact("2024-01-01", "2024-03-31", 33, form="10-Q", filed="2024-05-01"),
        ]}},
        "SalesRevenueNet": {"units": {"USD": [fact("2016-01-01", "2016-12-31", 80, filed="2017-02-01")]}},
        "NetIncomeLoss": {"units": {"USD": [fact("2023-01-01", "2023-12-31", 12), fact("2022-01-01", "2022-12-31", 10)]}},
        "LossContingencyAccrualAtCarryingValue": {"units": {"USD": [
            fact(None, "2023-12-31", 9), fact(None, "2022-12-31", 6), fact(None, "2024-02-15", 50),  # subsequent event
        ]}},
        "LitigationReserve": {"units": {"USD": [fact(None, "2023-12-31", 7)]}},
    }
}


class Series(unittest.TestCase):
    def test_restatement_keeps_latest_filed(self):
        pts = fin.metric_series(FACTS, "revenue", "annual")
        self.assertEqual([(p["fy"], p["value"]) for p in pts], [(2016, 80), (2022, 105), (2023, 120)])
        self.assertEqual(pts[0]["concept"], "SalesRevenueNet")

    def test_quarterly_only_three_month_periods(self):
        pts = fin.metric_series(FACTS, "revenue", "quarterly")
        self.assertEqual([p["value"] for p in pts], [31, 33])

    def test_balance_only_on_period_ends(self):
        pts = fin.metric_series(FACTS, "litigation_accrual", "annual")
        self.assertEqual([(p["fy"], p["value"]) for p in pts], [(2022, 6), (2023, 9)])
        self.assertEqual({p["concept"] for p in pts}, {"LossContingencyAccrualAtCarryingValue"})

    def test_fiscal_year_label(self):
        self.assertEqual(fin.fiscal_year("2023-01-01"), 2022)
        self.assertEqual(fin.fiscal_year("2025-01-31"), 2025)
        self.assertEqual(fin.fiscal_year("2024-06-30"), 2024)

    def test_yoy_and_ratio(self):
        rev = fin.metric_series(FACTS, "revenue", "annual")
        acc = fin.metric_series(FACTS, "litigation_accrual", "annual")
        self.assertEqual(fin.yoy(acc)[-1]["change_pct"], 50.0)
        self.assertEqual(fin.yoy(rev)[1]["change_pct"], None)  # 2021 missing
        self.assertEqual(fin.ratio_same_year(acc, rev), [{"fy": 2022, "pct": 5.71}, {"fy": 2023, "pct": 7.5}])

    def test_unit_choice(self):
        self.assertEqual(fin.pick_unit({"EUR": [1, 2], "USD": [1]}), "USD")
        self.assertEqual(fin.pick_unit({"EUR": [1, 2], "DKK": [1]}), "EUR")
        self.assertEqual(fin.pick_unit({"USD/shares": [1]}), "USD/shares")


if __name__ == "__main__":
    unittest.main()


class SeriesConceptChoice(unittest.TestCase):
    def test_series_mode_prefers_the_concept_still_reported(self):
        facts = {"us-gaap": {
            "NetIncomeLoss": {"units": {"USD": [fact(f"{y}-01-01", f"{y}-12-31", 1) for y in range(2012, 2026)]}},
            # Many old observations of one concept, then the company switched concepts.
            "LossContingencyAccrualAtCarryingValue": {"units": {"USD": [fact(None, f"{y}-12-31", 5) for y in range(2012, 2018)]}},
            "LitigationReserve": {"units": {"USD": [fact(None, f"{y}-12-31", 9) for y in range(2022, 2026)]}},
        }}
        pts = fin.metric_series(facts, "litigation_accrual", "annual")
        self.assertEqual({p["concept"] for p in pts}, {"LitigationReserve"})
        self.assertEqual(pts[-1]["fy"], 2025)

    def test_ifrs_sale_of_goods_is_last_revenue_fallback(self):
        facts = {"ifrs-full": {"RevenueFromSaleOfGoods": {"units": {"EUR": [fact("2024-01-01", "2024-12-31", 40, form="20-F")]}}}}
        pts = fin.metric_series(facts, "revenue", "annual")
        self.assertEqual([(p["fy"], p["unit"], p["concept"]) for p in pts], [(2024, "EUR", "RevenueFromSaleOfGoods")])


class NetIncomeFallback(unittest.TestCase):
    def test_available_to_common_used_when_net_income_missing(self):
        facts = {"us-gaap": {
            "NetIncomeLoss": {"units": {"USD": [fact("2023-01-01", "2023-12-31", 1592)]}},
            "NetIncomeLossAvailableToCommonStockholdersBasic": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 1846, filed="2025-02-01")]}},
            "ProfitLoss": {"units": {"USD": [fact("2024-01-01", "2024-12-31", 1853, filed="2025-02-01")]}},
        }}
        pts = fin.metric_series(facts, "net_income", "annual")
        self.assertEqual([(p["fy"], p["value"], p["concept"]) for p in pts],
                         [(2023, 1592, "NetIncomeLoss"), (2024, 1846, "NetIncomeLossAvailableToCommonStockholdersBasic")])
