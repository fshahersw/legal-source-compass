"""Unit tests for XBRL series rules. Run: python3 -m unittest scripts/enrichment/sec/test_financials.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_company_sec as builder  # noqa: E402
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


class TrackedConcepts(unittest.TestCase):
    """company_sec_financials 'tracked concepts reported' (published as 0 for every company before the fix:
    RAW_CONCEPTS holds (taxonomy, concept) pairs and the builder tested bare concept names against it)."""

    def test_raw_concepts_are_taxonomy_concept_pairs(self):
        self.assertIn(("us-gaap", "Revenues"), fin.RAW_CONCEPTS)
        self.assertIn(("ifrs-full", "Revenue"), fin.RAW_CONCEPTS)
        self.assertNotIn("Revenues", fin.RAW_CONCEPTS)

    def test_builder_reports_tracked_concepts_present(self):
        facts = {"us-gaap": {**FACTS["us-gaap"], "AcmeCustomExtension": {"units": {"USD": [fact("2023-01-01", "2023-12-31", 1)]}}}}
        out = builder.build_financials("0000000001", {"facts": facts})
        self.assertEqual(out["concepts_present"], ["LitigationReserve", "LossContingencyAccrualAtCarryingValue",
                                                   "NetIncomeLoss", "Revenues", "SalesRevenueNet"])

    def test_concept_counts_only_under_the_taxonomy_it_is_tracked_in(self):
        facts = {"ifrs-full": {"Revenues": {"units": {}}, "LitigationReserve": {"units": {}}, "Assets": {"units": {}},
                               "Revenue": {"units": {}}},
                 "dei": {"EntityCommonStockSharesOutstanding": {"units": {}}}}
        self.assertEqual(fin.concepts_present(facts), ["Assets", "Revenue"])

    def test_same_name_in_both_taxonomies_is_listed_per_taxonomy(self):
        # Assets is tracked under both taxonomies: each reported pair is one entry, named with its taxonomy.
        facts = {"us-gaap": {"Assets": {"units": {}}}, "ifrs-full": {"Assets": {"units": {}}}}
        self.assertEqual(fin.tracked_pairs(facts), [("ifrs-full", "Assets"), ("us-gaap", "Assets")])
        self.assertEqual(fin.concepts_present(facts), ["ifrs-full:Assets", "us-gaap:Assets"])
        self.assertEqual(fin.concepts_present({}), [])

    def test_financials_record_cells_and_facts_carry_the_concepts(self):
        fdata = builder.build_financials("0000000001", {"facts": FACTS})
        row = builder.financials_record("0000000001", "Acme Corp", fdata, "2026-10-18")
        self.assertEqual(row["item"]["cells"]["concepts"], "5")
        self.assertIn("5 tracked concepts in companyfacts", row["item"]["subtitle"])
        facts = dict(row["detail"]["facts"])
        self.assertEqual(facts["Tracked concepts in companyfacts (any period)"],
                         "LitigationReserve, LossContingencyAccrualAtCarryingValue, NetIncomeLoss, Revenues, SalesRevenueNet")
        self.assertIn("series keep fiscal years 2012 onward", facts["Rules"])
        self.assertEqual(facts["Source"], "SEC XBRL companyfacts API, retrieved 2026-10-18")
        self.assertEqual(row["item"]["retrieved"], "2026-10-18")

    def test_concepts_reported_only_before_the_series_window_are_listed_but_add_no_point(self):
        # WYETH-shaped: tracked facts end in 2009, so the series (FY2012 on) are empty while the concepts are listed.
        facts = {"us-gaap": {"Revenues": {"units": {"USD": [fact("2008-01-01", "2008-12-31", 22, filed="2009-02-01")]}},
                             "Assets": {"units": {"USD": [fact(None, "2008-12-31", 44, filed="2009-02-01")]}}}}
        fdata = builder.build_financials("0000005187", {"facts": facts})
        self.assertEqual(fdata["concepts_present"], ["Assets", "Revenues"])
        self.assertEqual(fdata["annual"]["revenue"], [])
        self.assertEqual(fdata["annual"]["assets"], [])
        row = builder.financials_record("0000005187", "WYETH", fdata, "2026-10-18")
        self.assertEqual(row["item"]["subtitle"], "us-gaap · 0 fiscal years of revenue · 2 tracked concepts in companyfacts")


def ifrs(concept, start, end, val):
    return {concept: {"units": {"GBP": [fact(start, end, val, form="20-F")]}}}


class TaxonomyLabel(unittest.TestCase):
    """company_sec_financials / company_sec_profiles taxonomy (was 'us-gaap' whenever any us-gaap key existed)."""

    def test_ifrs_filer_with_one_untracked_us_gaap_fact_is_ifrs(self):
        # British American Tobacco shape: one us-gaap OtherIncome fact on a 20-F, every tracked concept in ifrs-full.
        facts = {"dei": {"EntityCommonStockSharesOutstanding": {"units": {}}},
                 "us-gaap": {"OtherIncome": {"units": {"GBP": [fact("2019-01-01", "2019-12-31", 3, form="20-F")]}}},
                 "ifrs-full": {**ifrs("Revenue", "2023-01-01", "2023-12-31", 27000), **ifrs("Assets", None, "2023-12-31", 120000),
                               **ifrs("ProfitLossAttributableToOwnersOfParent", "2023-01-01", "2023-12-31", -14000),
                               "ProfitLoss": {"units": {"GBP": [fact("2023-01-01", "2023-12-31", -14100, form="20-F")]}}}}
        self.assertEqual(fin.taxonomy_label(facts), "ifrs-full")
        fdata = builder.build_financials("0001303523", {"facts": facts})
        self.assertEqual(fdata["taxonomy"], "ifrs-full")
        self.assertEqual(fdata["concepts_present"], ["Assets", "ProfitLossAttributableToOwnersOfParent", "Revenue"])
        self.assertEqual({p["taxonomy"] for m in fin.METRICS for p in fdata["annual"][m]}, {"ifrs-full"})
        row = builder.financials_record("0001303523", "British American Tobacco p.l.c.", fdata, "2026-10-18")
        self.assertEqual(row["item"]["cells"]["taxonomy"], "ifrs-full")
        self.assertEqual(dict(row["detail"]["facts"])["Taxonomy"], "ifrs-full")
        self.assertEqual(row["filters"]["taxonomy"], ["ifrs-full"])
        self.assertTrue(row["item"]["subtitle"].startswith("ifrs-full · 1 fiscal years of revenue · 3 tracked concepts"))

    def test_tracked_concepts_under_both_taxonomies_is_mixed(self):
        # Toyota shape: us-gaap 10-K/20-F years, then IFRS.
        facts = {"us-gaap": {"Revenues": {"units": {"JPY": [fact("2019-04-01", "2020-03-31", 29, form="20-F")]}},
                             "Assets": {"units": {"JPY": [fact(None, "2020-03-31", 52, form="20-F")]}}},
                 "ifrs-full": {**ifrs("Revenue", "2023-04-01", "2024-03-31", 45), **ifrs("Assets", None, "2024-03-31", 90)}}
        self.assertEqual(fin.taxonomy_label(facts), "mixed")
        fdata = builder.build_financials("0001094517", {"facts": facts})
        self.assertEqual(fdata["concepts_present"], ["ifrs-full:Assets", "ifrs-full:Revenue", "us-gaap:Assets", "us-gaap:Revenues"])
        row = builder.financials_record("0001094517", "TOYOTA MOTOR CORP/", fdata, "2026-10-18")
        self.assertEqual(row["item"]["taxonomy"], "mixed")
        self.assertEqual(row["item"]["cells"]["taxonomy"], "us-gaap and ifrs-full")
        self.assertEqual(row["item"]["cells"]["concepts"], "4")
        self.assertEqual(row["filters"]["taxonomy"], ["us-gaap", "ifrs-full", "mixed"])

    def test_no_standard_taxonomy_is_not_recorded(self):
        # Finance subsidiaries whose companyfacts holds only filing-fee (ffd) facts.
        facts = {"ffd": {"FeeAmount": {"units": {"USD": [fact(None, "2024-01-01", 1)]}}}}
        self.assertIsNone(fin.taxonomy_label(facts))
        fdata = builder.build_financials("0001224462", {"facts": facts})
        row = builder.financials_record("0001224462", "GLAXOSMITHKLINE CAPITAL INC", fdata, "2026-10-18")
        self.assertIsNone(row["item"]["taxonomy"])
        self.assertEqual(row["item"]["cells"]["taxonomy"], "Not recorded")
        self.assertEqual(dict(row["detail"]["facts"])["Taxonomy"], "Not recorded")
        self.assertEqual(dict(row["detail"]["facts"])["Tracked concepts in companyfacts (any period)"], "None")
        self.assertEqual(row["filters"]["taxonomy"], [])

    def test_without_tracked_concepts_the_standard_taxonomy_present_decides(self):
        self.assertEqual(fin.taxonomy_label({"us-gaap": {"OtherIncome": {"units": {}}}, "dei": {"X": {}}}), "us-gaap")
        self.assertEqual(fin.taxonomy_label({"ifrs-full": {"OtherIncome": {"units": {}}}}), "ifrs-full")
        self.assertEqual(fin.taxonomy_label({"us-gaap": {"OtherIncome": {}}, "ifrs-full": {"Other": {}}}), "mixed")
        self.assertEqual(fin.taxonomy_label({"us-gaap": {}, "ifrs-full": {}}), None)

    def test_us_gaap_only_filer_keeps_its_published_label(self):
        fdata = builder.build_financials("0000000001", {"facts": FACTS})
        row = builder.financials_record("0000000001", "Acme Corp", fdata, "2026-10-18")
        self.assertEqual((fdata["taxonomy"], row["item"]["cells"]["taxonomy"], row["filters"]["taxonomy"]),
                         ("us-gaap", "us-gaap", ["us-gaap"]))

    def test_listing_offers_every_filter_value_the_rows_use(self):
        options = {o["value"] for f in builder.financials_listing()["filters"] if f["name"] == "taxonomy" for o in f["options"]}
        self.assertEqual(options, {"us-gaap", "ifrs-full", "mixed"})
        for value in (*fin.STANDARD_TAXONOMIES, "mixed", None):
            self.assertLessEqual(set(builder.taxonomy_filter(value)), options)


class ProfilesCatalog(unittest.TestCase):
    def test_profiles_summary_does_not_count_the_overview_record(self):
        rows = [{"id": "0000000001"}, {"id": "0000000002"}, {"id": "summary:overview"}]
        self.assertEqual(builder.profiles_summary(rows, "2026-10-18"),
                         {"source": builder.SUMMARY_SOURCE, "retrieved": "2026-10-18", "companies": 2})
        self.assertEqual([c["key"] for c in builder.profiles_listing()["columns"]][:2], ["company", "tickers"])


if __name__ == "__main__":
    unittest.main()
