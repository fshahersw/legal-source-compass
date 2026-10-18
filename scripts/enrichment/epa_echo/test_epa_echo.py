"""Offline tests for the epa_echo stream (synthetic fixtures, no network).

Run: cd scripts/enrichment/epa_echo && python3 -B -m unittest -v test_epa_echo
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import echo_parse as ep  # noqa: E402
import build_epa_echo as build  # noqa: E402


def conc(fy, fed=0.0, sep=0.0, st=0.0, comp=0.0, cr=0.0, collected=None):
    return {"fy": fy, "fed_penalty": fed, "sep": sep, "st_lcl_penalty": st, "compliance_cost": comp, "cost_recovery": cr, "penalty_collected": collected}


def case(cid, number, fy, type_="AFR", region="06", statute="CAA", programs=("CAASIP",), states=("TX",), pen=None, conclusions=(), defendants=()):
    return {"id": cid, "case_number": number, "name": f"Case {number}", "type": type_, "fy": fy, "region": region, "statute": statute,
            "programs": list(programs), "states": list(states), "pen": pen, "conclusions": list(conclusions),
            "defendants": [{"name": d, "complaint": True, "settlement": False} for d in defendants]}


class ParsingTests(unittest.TestCase):
    def test_money(self):
        self.assertEqual(ep.money("1,250.50"), 1250.5)
        self.assertEqual(ep.money(" $3,000 "), 3000.0)
        self.assertEqual(ep.money("-12"), -12.0)  # kept as recorded
        self.assertIsNone(ep.money(""))
        self.assertIsNone(ep.money("n/a"))

    def test_count_and_dates(self):
        self.assertEqual(ep.count("3"), 3)
        self.assertEqual(ep.count("4.0"), 4)
        self.assertIsNone(ep.count(""))
        self.assertIsNone(ep.count("x"))
        self.assertEqual(ep.fiscal_year("2025"), 2025)
        self.assertIsNone(ep.fiscal_year("25"))
        self.assertEqual(ep.us_date("09/30/2025"), "2025-09-30")
        self.assertIsNone(ep.us_date("2025-09-30"))

    def test_fy_complete(self):
        self.assertTrue(ep.fy_complete(2026, "2026-10-17"))
        self.assertFalse(ep.fy_complete(2027, "2026-10-17"))
        self.assertFalse(ep.fy_complete(2026, "2026-09-30"))
        self.assertFalse(ep.fy_complete(None, "2026-10-17"))

    def test_primary_statute_and_states(self):
        self.assertEqual(ep.primary_statute([("0", "CWA"), ("1", "CAA"), ("1", "RCRA")]), "CAA")
        self.assertIsNone(ep.primary_statute([("0", "CWA")]))
        self.assertEqual(ep.state_codes(["tx", " TX", "LA", "", "123", "Texas"]), ["LA", "TX"])

    def test_clean_keeps_internal_spacing_and_case(self):
        self.assertEqual(ep.clean("  BP  Products North America "), "BP  Products North America")


class AnalyticsTests(unittest.TestCase):
    def test_pct_change(self):
        self.assertEqual(ep.pct_change(150, 100), 50.0)
        self.assertEqual(ep.pct_change(50, 100), -50.0)
        self.assertIsNone(ep.pct_change(5, 0))
        self.assertIsNone(ep.pct_change(5, None))

    def test_rank_desc_competition_ranking_and_none(self):
        self.assertEqual(ep.rank_desc({"a": 5.0, "b": 9.0, "c": 5.0, "d": 1.0}), {"b": 1, "a": 2, "c": 2, "d": 4})
        self.assertEqual(ep.rank_desc({"a": None, "b": 2}), {"b": 1})  # an unknown value is unranked, never rank-last
        self.assertEqual(ep.rank_desc({}), {})

    def test_top_share_and_median(self):
        values = [100.0] * 10 + [50.0, 50.0]
        self.assertAlmostEqual(ep.top_share(values, 10), 1000 / 1100, places=6)
        self.assertIsNone(ep.top_share([0.0, 0.0]))
        self.assertEqual(ep.median([3, 1, 2]), 2)
        self.assertEqual(ep.median([1, 2, 3, 4]), 2.5)
        self.assertIsNone(ep.median([]))


class SeriesTests(unittest.TestCase):
    def setUp(self):
        self.cases = [
            case("1", "06-2020-0001", 2020, type_="JDC", states=("TX", "LA"), programs=("CAASIP", "CAATVP"),
                 pen={"fed_penalty": 1000.0, "st_lcl_penalty": 10.0, "sep": 0.0, "compliance_cost": 0.0, "fed_cost_recovery": 0.0, "st_cost_recovery": 5.0, "penalty_collected": None},
                 conclusions=[conc(2021, fed=600.0, sep=20.0), conc(2022, fed=400.0, st=10.0)]),
            case("2", "06-2021-0002", 2021, states=("TX",), statute="CWA", programs=("CWAOTHR",),
                 conclusions=[conc(2021, fed=50.0), conc(None, fed=7.0)]),
            case("3", "HQ-2021-0003", 2021, region="HQ", states=(), statute=None, programs=(), conclusions=[]),
        ]
        acc = ep.aggregate_series(self.cases)
        self.cells = {k: ep.finalize_cell(v) for k, v in acc.items()}

    def test_opened_by_case_fy(self):
        self.assertEqual(self.cells[("US", 2020)]["opened"], 1)
        self.assertEqual(self.cells[("US", 2021)]["opened"], 2)
        self.assertEqual(self.cells[("US", 2020)]["opened_judicial"], 1)
        self.assertEqual(self.cells[("US", "all")]["opened"], 3)

    def test_concluded_and_dollars_by_settlement_fy(self):
        fy21 = self.cells[("US", 2021)]
        self.assertEqual(fy21["concluded_cases"], 2)
        self.assertEqual(fy21["conclusions"], 2)
        self.assertEqual(fy21["fed_penalty"], 650.0)
        self.assertEqual(fy21["sep"], 20.0)
        self.assertEqual(self.cells[("US", 2022)]["st_lcl_penalty"], 10.0)
        self.assertEqual(self.cells[("US", 2020)]["conclusions"], 0)  # opened in FY2020, settled later

    def test_unattributed_settlement_only_in_all_row(self):
        everything = self.cells[("US", "all")]
        self.assertEqual(everything["fed_penalty"], 1057.0)
        self.assertEqual(everything["unattributed"]["conclusions"], 1)
        self.assertEqual(everything["unattributed"]["fed_penalty"], 7.0)
        self.assertEqual(sum(self.cells[("US", fy)]["fed_penalty"] for fy in (2021, 2022)), 1050.0)

    def test_state_attribution_not_additive_and_unrecorded(self):
        self.assertEqual(self.cells[("state:TX", "all")]["opened"], 2)
        self.assertEqual(self.cells[("state:LA", "all")]["opened"], 1)
        self.assertEqual(self.cells[("state:NR", "all")]["opened"], 1)
        self.assertEqual(self.cells[("region:HQ", 2021)]["opened"], 1)

    def test_case_level_by_fy_opened(self):
        cl = self.cells[("US", 2020)]["case_level"]
        self.assertEqual(cl["fed_penalty"], 1000.0)
        self.assertEqual(cl["st_cost_recovery"], 5.0)
        self.assertEqual(cl["cases_with_penalty_record"], 1)
        self.assertEqual(self.cells[("US", 2021)]["case_level"]["cases_with_penalty_record"], 0)

    def test_dims_arrays(self):
        statute = {row[0]: row for row in self.cells[("US", "all")]["dims"]["statute"]}
        cols = ep.DIM_COLUMNS["statute"]
        self.assertEqual(statute["CAA"][cols.index("opened")], 1)
        self.assertEqual(statute["CAA"][cols.index("fed_penalty")], 1000.0)
        self.assertEqual(statute["NR"][cols.index("opened")], 1)
        program = {row[0]: row for row in self.cells[("US", "all")]["dims"]["program"]}
        self.assertEqual(set(program), {"CAASIP", "CAATVP", "CWAOTHR"})
        self.assertEqual(len(program["CAASIP"]), len(ep.DIM_COLUMNS["program"]))
        self.assertNotIn("region", self.cells[("region:06", "all")]["dims"])

    def test_yoy(self):
        series = {fy: dict(self.cells[("US", fy)]) for fy in (2020, 2021, 2022)}
        ep.add_yoy(series)
        self.assertEqual(series[2021]["yoy"]["opened_pct"], 100.0)
        self.assertIsNone(series[2020]["yoy"]["opened_pct"])  # FY2019 absent
        self.assertIsNone(series[2021]["yoy"]["fed_penalty_pct"])  # FY2020 had no settled penalty
        partial = {fy: dict(self.cells[("US", fy)]) for fy in (2021, 2022)}
        ep.add_yoy(partial, in_progress={2022})
        self.assertIsNone(partial[2022]["yoy"]["opened_pct"])
        self.assertIn("in progress", partial[2022]["yoy"]["note"])

    def test_largest_case(self):
        largest = self.cells[("US", "all")]["largest_case"]
        self.assertEqual(largest["case_number"], "06-2020-0001")
        self.assertEqual(largest["fed_penalty"], 1000.0)
        self.assertAlmostEqual(largest["share_of_fed_penalty"], 1000 / 1057, places=6)
        self.assertIsNone(self.cells[("US", 2020)]["largest_case"])  # nothing settled in FY2020: no positive penalty, not 0%

    def test_largest_case_combines_national_case_records(self):
        cases = [case("1", "N-1", 2020, conclusions=[conc(2020, fed=100.0)]), case("2", "N-2", 2020, conclusions=[conc(2020, fed=300.0)]),
                 case("3", "P-1", 2020, conclusions=[conc(2020, fed=350.0)])]
        cell = ep.finalize_cell(ep.aggregate_series(cases, {"N-2": "N-1"})[("US", 2020)])
        self.assertEqual(cell["largest_case"]["case_number"], "N-1")
        self.assertEqual(cell["largest_case"]["fed_penalty"], 400.0)
        self.assertAlmostEqual(cell["largest_case"]["share_of_fed_penalty"], 400 / 750, places=6)

    def test_top10_share_groups_national_case_records(self):
        cases = [case(str(i), f"N-{i}", 2020, conclusions=[conc(2020, fed=100.0)]) for i in range(12)]
        cases.append(case("99", "N-99", 2020, conclusions=[conc(2020, fed=100.0)]))
        plain = ep.finalize_cell(ep.aggregate_series(cases)[("US", 2020)])
        self.assertAlmostEqual(plain["top10_case_share"], 10 / 13, places=6)
        grouped = ep.finalize_cell(ep.aggregate_series(cases, {"N-99": "N-0"})[("US", 2020)])
        self.assertAlmostEqual(grouped["top10_case_share"], 11 / 13, places=6)
        self.assertEqual(grouped["penalty_cases"], 12)


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.index = ep.title_index([("0000313807", "BP PLC"), ("0001012569", "Energy Transfer, LP"),
                                     ("0000000001", "ACME CORP"), ("0000000002", "Acme  Corp")])

    def test_unique_exact_match(self):
        self.assertEqual(ep.match_company("bp plc", self.index), ("matched", "0000313807"))
        self.assertEqual(ep.match_company("  BP   PLC ", self.index), ("matched", "0000313807"))

    def test_non_match_punctuation_differs(self):
        self.assertEqual(ep.match_company("Energy Transfer LP", self.index), ("none", None))
        self.assertEqual(ep.match_company("BP Products North America Inc.", self.index), ("none", None))

    def test_ambiguous(self):
        status, ciks = ep.match_company("ACME CORP", self.index)
        self.assertEqual(status, "ambiguous")
        self.assertEqual(ciks, ["0000000001", "0000000002"])


class DefendantTests(unittest.TestCase):
    def test_joint_credit_sole_and_not_recorded(self):
        pen = lambda fed: {"fed_penalty": fed, "st_lcl_penalty": 0.0, "sep": 0.0, "compliance_cost": 0.0, "fed_cost_recovery": 0.0, "st_cost_recovery": 0.0, "penalty_collected": None}  # noqa: E731
        cases = [
            case("1", "A-1", 2019, pen=pen(1000.0), defendants=("Acme Corp", "Beta LLC")),
            case("2", "A-2", 2020, pen=pen(200.0), defendants=("Acme Corp",)),
            case("3", "A-3", 2021, pen=None, defendants=("Acme Corp",)),
            case("4", "A-4", 2021, pen=pen(50.0), defendants=("ACME CORP",)),
        ]
        table = ep.defendant_table(cases)
        acme = table["Acme Corp"]
        self.assertEqual(len(acme["cases"]), 3)
        self.assertEqual(acme["fed_penalty"], 1200.0)
        self.assertEqual(acme["fed_penalty_sole"], 200.0)
        self.assertEqual(acme["sole"], 2)
        self.assertEqual(acme["no_penalty_record"], 1)
        self.assertEqual(acme["codefendants_max"], 1)
        self.assertEqual(table["ACME CORP"]["codefendants_max"], 0)
        self.assertEqual(table["Beta LLC"]["fed_penalty"], 1000.0)
        self.assertIn("ACME CORP", table)  # spelling variants are not merged
        self.assertEqual(table["ACME CORP"]["fed_penalty"], 50.0)

    def test_national_case_and_duplicates(self):
        pen = {"fed_penalty": 500.0}
        cases = [case("1", "L-1", 2015, pen=pen, defendants=("BP X",)), case("2", "M-1", 2015, pen=pen, defendants=("BP X",)),
                 case("3", "D-1", 2016, pen={"fed_penalty": 30.0}, defendants=("Dup Co",)),
                 case("4", "D-2", 2016, pen={"fed_penalty": 30.0}, defendants=("Dup Co",))]
        table = ep.defendant_table(cases, twins={"M-1": "L-1"}, dupes=[["D-1", "D-2"]])
        self.assertEqual(table["BP X"]["national_cases"], {"L-1"})
        self.assertEqual(table["BP X"]["fed_penalty"], 1000.0)  # shares of one national penalty are summed
        self.assertEqual(ep.dupe_extra(table["Dup Co"], {0: 30.0}), 30.0)
        self.assertEqual(ep.dupe_extra(table["BP X"], {0: 30.0}), 0)


class ExporterTests(unittest.TestCase):
    def test_add_exporter_row(self):
        acc = ep.new_program_acc()
        rows = [
            {"FAC_ACTIVE_FLAG": "Y", "AIR_FLAG": "Y", "NPDES_FLAG": "Y", "RCRA_FLAG": "N", "SDWIS_FLAG": "N", "CAA_HPV_FLAG": "Y",
             "CWA_SNC_FLAG": "Y", "CAA_FORMAL_ACTION_COUNT": "2", "CAA_EVALUATION_COUNT": "1", "FAC_FORMAL_ACTION_COUNT": "2",
             "FAC_DATE_LAST_FORMAL_ACTION": "05/01/2024", "FEC_NUMBER_OF_CASES": "1", "FAC_SNC_FLG": "N",
             "CWA_COMPLIANCE_STATUS": "Terminated Permit", "FAC_COMPLIANCE_STATUS": "Significant Violation"},
            {"FAC_ACTIVE_FLAG": "", "AIR_FLAG": "N", "NPDES_FLAG": "N", "RCRA_FLAG": "Y", "SDWIS_FLAG": "Y", "RCRA_FORMAL_ACTION_COUNT": "",
             "FAC_FORMAL_ACTION_COUNT": "1", "FAC_DATE_LAST_FORMAL_ACTION": "01/13/1994", "SDWA_SNC_FLAG": "N"},
        ]
        for row in rows:
            ep.add_exporter_row(acc, row, "2021-10-18")
        self.assertEqual(acc["facilities"], 2)
        self.assertEqual(acc["active_flag"], 1)
        self.assertEqual(acc["programs"]["CAA"]["with_id"], 1)
        self.assertEqual(acc["programs"]["CAA"]["formal_5y"], 1)
        self.assertEqual(acc["programs"]["CAA"]["formal_actions_5y"], 2)
        self.assertEqual(acc["programs"]["RCRA"]["formal_5y"], 0)  # blank count is not a positive count
        self.assertEqual(acc["any_snc_now"], 1)  # one facility flagged in two programs counts once
        self.assertEqual(acc["programs"]["CWA"]["snc_now"], 1)
        self.assertEqual(acc["any_formal_5y"], 2)
        self.assertEqual(acc["any_formal_date_older"], 1)
        self.assertEqual(acc["fec_cases_5y"], 1)
        self.assertEqual(acc["programs"]["CWA"]["status"]["Terminated Permit"], 1)
        self.assertEqual(acc["fac_snc_flag_y"], 0)


class NotRecordedTests(unittest.TestCase):
    def test_formatters(self):
        self.assertEqual(build.usd(None), "Not recorded")
        self.assertEqual(build.usd(1234.5), "$1,234.50")
        self.assertEqual(build.num(None), "Not recorded")
        self.assertEqual(build.facts([("A", None), ("B", 3)]), [["A", "Not recorded"], ["B", "3"]])
        self.assertTrue(build.pct(None).startswith("n/a"))
        self.assertTrue(build.share(None).startswith("Not recorded"))

    def test_scope_meta(self):
        self.assertEqual(build.scope_meta("state:TX")["kind"], "state")
        self.assertEqual(build.scope_meta("state:PR")["kind"], "territory")
        self.assertEqual(build.scope_meta("state:XX")["kind"], "other")
        self.assertEqual(build.scope_meta("state:NR")["kind"], "unrecorded")
        self.assertEqual(build.scope_meta("region:06")["name"], "EPA Region 6 (case region 06)")
        self.assertEqual(build.scope_meta("region:HQ")["kind"], "region")


if __name__ == "__main__":
    unittest.main()
