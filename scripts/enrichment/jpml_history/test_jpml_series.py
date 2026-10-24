"""Offline tests for the wave-1026 JPML series code: derived metrics, the by-circuit parser and the series builder
helpers. Run: cd scripts/enrichment/jpml_history && python3 -B -m unittest -v test_jpml_series"""
import unittest

import parse_quarterly as pq
import series_metrics as sm


class WholeMonths(unittest.TestCase):
    def test_same_day_next_month_is_one(self):
        self.assertEqual(sm.whole_months_between("2024-01-15", "2024-02-15"), 1)

    def test_day_before_is_not_complete(self):
        self.assertEqual(sm.whole_months_between("2024-01-15", "2024-02-14"), 0)

    def test_across_years(self):
        self.assertEqual(sm.whole_months_between("2016-10-04", "2026-10-01"), 119)
        self.assertEqual(sm.whole_months_between("2016-10-04", "2026-10-04"), 120)

    def test_missing_or_reversed_is_not_recorded(self):
        self.assertIsNone(sm.whole_months_between(None, "2024-01-01"))
        self.assertIsNone(sm.whole_months_between("2024-02-01", "2024-01-01"))


class Peak(unittest.TestCase):
    def test_earliest_date_wins_tie(self):
        pts = [{"date": "2024-01-01", "pending": 5}, {"date": "2024-02-01", "pending": 9}, {"date": "2024-03-01", "pending": 9}]
        self.assertEqual(sm.peak(pts), {"value": 9, "date": "2024-02-01", "points": 3})

    def test_no_values(self):
        self.assertIsNone(sm.peak([{"date": "2024-01-01", "pending": None}]))


class Changes(unittest.TestCase):
    SEQ = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]

    def test_gap_is_skipped_not_zero(self):
        pts = [{"date": "2024-01-01", "pending": 10, "total": 20}, {"date": "2024-02-01", "pending": 12, "total": 25},
               {"date": "2024-04-01", "pending": 11, "total": 30}]
        ch = sm.consecutive_changes(pts, self.SEQ)
        self.assertEqual(len(ch), 1)
        self.assertEqual(ch[0], {"from": "2024-01-01", "to": "2024-02-01", "days": 31, "months_apart": 1, "pending_change": 2, "total_change": 5, "total_decreased": False})

    def test_adjacent_only(self):
        seq = ["2021-11-15", "2024-10-01", "2024-11-01"]
        pts = [{"date": d, "pending": 1, "total": t} for d, t in zip(seq, (10, 50, 55))]
        ch = sm.consecutive_changes(pts, seq)
        self.assertEqual([c["months_apart"] for c in ch], [35, 1])
        self.assertEqual(sm.actions_added_sum(ch)["added"], 45)
        self.assertEqual(sm.actions_added_sum(ch, adjacent_only=True), {"added": 5, "intervals": 1, "decreases": 0, "decrease_sum": 0})

    def test_decrease_flagged(self):
        pts = [{"date": "2024-01-01", "pending": 10, "total": 20}, {"date": "2024-02-01", "pending": 8, "total": 18}]
        ch = sm.consecutive_changes(pts, self.SEQ)
        self.assertTrue(ch[0]["total_decreased"])
        self.assertEqual(sm.actions_added_sum(ch), {"added": 0, "intervals": 1, "decreases": 1, "decrease_sum": -2})

    def test_added_sum(self):
        ch = [{"total_change": 5, "months_apart": 1}, {"total_change": 0, "months_apart": 1}, {"total_change": 7, "months_apart": 2}]
        self.assertEqual(sm.actions_added_sum(ch), {"added": 12, "intervals": 3, "decreases": 0, "decrease_sum": 0})
        self.assertIsNone(sm.actions_added_sum([]))


class Concentration(unittest.TestCase):
    def test_hhi_and_lead(self):
        rows = [{"district": "NJ", "pending": 60}, {"district": "NJ", "pending": 20}, {"district": "SC", "pending": 20}, {"district": None, "pending": 99}]
        c = sm.concentration(rows, "district")
        self.assertEqual(c["groups"], 2)
        self.assertEqual(c["total"], 100)
        self.assertEqual(c["hhi"], 6800.0)  # 80^2 + 20^2
        self.assertEqual(c["hhi_counts"], round((100 * 2 / 3) ** 2 + (100 / 3) ** 2, 1))
        self.assertEqual((c["lead"], c["lead_value"], c["lead_rows"]), ("NJ", 80, 2))
        self.assertEqual(c["lead_share_pct"], 80.0)
        self.assertEqual(c["top5_share_pct"], 100.0)

    def test_tie_alphabetical(self):
        c = sm.concentration([{"d": "B", "pending": 5}, {"d": "A", "pending": 5}], "d")
        self.assertEqual(c["lead"], "A")

    def test_empty(self):
        self.assertIsNone(sm.concentration([], "district"))


class Flows(unittest.TestCase):
    def test_entered_left_continuing(self):
        prev = [{"mdl": 1, "pending": 10, "total": 20}, {"mdl": 2, "pending": 5, "total": 9}]
        cur = [{"mdl": 1, "pending": 12, "total": 26}, {"mdl": 3, "pending": 4, "total": 4}]
        f = sm.flows(prev, cur)
        self.assertEqual(f["entered"], [3])
        self.assertEqual(f["left"], [2])
        self.assertEqual(f["continuing"], 1)
        self.assertEqual(f["continuing_total_change"], 6)
        self.assertEqual(f["continuing_pending_change"], 2)
        self.assertEqual(f["entered_total"], 4)
        self.assertEqual(f["left_pending_before"], 5)

    def test_first_report_has_no_flows(self):
        self.assertIsNone(sm.flows(None, [{"mdl": 1, "pending": 1, "total": 1}]))


class Runs(unittest.TestCase):
    def test_value_returning_is_new_run(self):
        r = sm.runs([("2024-01", "A"), ("2024-02", "A"), ("2024-03", "B"), ("2024-04", "A")])
        self.assertEqual([(x["value"], x["from"], x["to"], x["reports"]) for x in r], [("A", "2024-01", "2024-02", 2), ("B", "2024-03", "2024-03", 1), ("A", "2024-04", "2024-04", 1)])


CIRCUIT_TEXT = """United States Judicial Panel on Multidistrict Litigation                    Report Date: 9/30/2026
                     MDL Statistics Report - Distribution of Pending MDL Dockets by Circuit
  MDL Filters:
    Status: Transferred
    Limited to Active Litigations

 District          Judge (Title)                                Docket No. Litigation                         Actions Now Total Actions
 District of Columbia Circuit
 DC              Emmet G. Sullivan (Sr. District Judge)         MDL -2165 IN RE: Endangered Species Litigation           1            40
                 John D. Bates (U.S. District Judge)            MDL -3162 IN RE: Class Action Settlement Litigation     12           12
                 Circuit Summary: Districts: 1, MDLs: 2                                                                 13           52

 First Circuit
 MA                Patti B. Saris (Sr. District Judge)          MDL -3029 IN RE: Covidien Hernia Mesh Litigation     2,479        2,489
 NH                Landya B. McCafferty (Chief Judge, USDC)     MDL -2753 IN RE: Atrium Mesh Litigation               101         3,592
                   Circuit Summary: Districts: 2, MDLs: 2                                                             2580         6081


 Report Totals:                                                     4                                                  2,593   6,133

   Total Number of MDL Dockets: 4
   Total Number of Transferee Districts: 3

   Total Number of Transferee Judges: 4
               1 Chief Judge, USDC
               2 Sr. District Judge
               1 U.S. District Judge
"""


class CircuitParser(unittest.TestCase):
    def test_parses_and_validates(self):
        p = pq.parse_circuit_report(CIRCUIT_TEXT)
        self.assertEqual(p["report_date"], "2026-09-30")
        self.assertEqual([c["slug"] for c in p["circuits"]], ["dc", "1"])
        self.assertEqual(p["circuits"][1]["printed"], {"districts": 2, "mdls": 2, "pending": 2580, "total": 6081})
        self.assertEqual([r["circuit"] for r in p["rows"]], ["District of Columbia", "District of Columbia", "First", "First"])
        self.assertEqual(p["rows"][1]["district"], "DC")  # blank district cell carries the row above
        v = pq.validate_circuit_report(p)
        self.assertTrue(v["valid"], [c for c in v["checks"] if not c["ok"]])

    def test_circuit_total_mismatch_holds_report(self):
        bad = CIRCUIT_TEXT.replace("2580         6081", "2581         6081")
        v = pq.validate_circuit_report(pq.parse_circuit_report(bad))
        self.assertFalse(v["valid"])
        failed = {c["check"] for c in v["checks"] if not c["ok"]}
        self.assertIn("circuit:1:pending", failed)
        self.assertIn("circuit_pending_sum_to_report_totals", failed)

    def test_row_outside_circuit_fails(self):
        moved = CIRCUIT_TEXT.replace(" District of Columbia Circuit\n", "")
        v = pq.validate_circuit_report(pq.parse_circuit_report(moved))
        self.assertFalse(v["valid"])


if __name__ == "__main__":
    unittest.main()
