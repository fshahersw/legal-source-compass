"""Offline tests for reconcile.py (synthetic normalised tables; no files, no network).

Run: cd scripts/enrichment/uscourts_tables && python3 -B -m unittest -v test_reconcile
"""
import unittest

import checks as C
import reconcile as R


def col(key, path, fmt="#,##0", prior=False):
    return {"index": 0, "key": key, "path": path, "label": " / ".join(path), "fmt": fmt, "marks": [], "prior": prior}


def row(label, entity, entity_id, values, flags=None, path=None, district=None):
    return {"label": label, "label_raw": label, "entity": entity, "entity_id": entity_id, "values": list(values),
            "flags": flags or [None] * len(values), "section": False, "path": path or [label], "indent": 0, "district": district}


def court_norm(total=30, c1=(10, 4, 6), c2=(20, 20), dc=None, end="2025-09-30", pub="JB", extra_rows=(), notes=()):
    """Total, circuit 1 (two districts), circuit 2 (one district); one count column."""
    rows = [row("Total", "national", "national", [total])]
    if dc is not None:
        rows += [row("DC", "district", "dcd", [dc])]
    rows += [row("1st", "circuit", "ca1", [c1[0]]), row("ME", "district", "med", [c1[1]]), row("MA", "district", "mad", [c1[2]]),
             row("2nd", "circuit", "ca2", [c2[0]]), row("CT", "district", "ctd", [c2[1]])]
    rows += list(extra_rows)
    return {"pub": pub, "period_end": end, "scope": "district", "table_key": "c", "columns": [col("filed", ["Filed"])], "rows": rows, "notes": list(notes)}


class CourtTests(unittest.TestCase):
    def test_consistent_table_reconciles(self):
        r = R.reconcile_series([court_norm()])
        self.assertEqual(r["periods"][0]["status"], "reconciled")
        self.assertEqual(C.rollup_failures(court_norm()), [])

    def test_dc_printed_twice_with_the_same_figures_is_counted_once(self):
        n = court_norm(total=35, dc=5)
        n["rows"].insert(2, row("DC", "district", "dcd", [5]))
        self.assertEqual(C.rollup_failures(n), [])
        self.assertEqual(R.reconcile_series([n])["periods"][0]["status"], "reconciled")

    def test_a_circuit_printed_twice_passes_when_one_printed_row_equals_its_districts(self):
        n = court_norm()
        n["rows"].insert(4, row("2ND", "circuit", "ca2", [0]))  # between "2nd" and its district
        self.assertEqual(C.rollup_failures(n), [])

    def test_a_court_rollup_failure_in_one_period_holds_that_period_only(self):
        good = [court_norm(end=f"20{y}-09-30") for y in range(18, 25)]
        bad = court_norm(total=31, end="2025-09-30")  # the Total is one more than its circuits
        r = R.reconcile_series(good + [bad])
        statuses = [p["status"] for p in r["periods"]]
        self.assertEqual(statuses[-1], "held")
        self.assertEqual(set(statuses[:-1]), {"reconciled"})
        self.assertEqual(r["status"], "held_periods")
        self.assertEqual(r["periods"][-1]["failures"][0]["kind"], "national")

    def test_a_court_total_short_of_its_courts_is_also_held(self):
        good = [court_norm(end=f"20{y}-09-30") for y in range(18, 25)]
        bad = court_norm(total=29, end="2025-09-30")
        self.assertEqual(R.reconcile_series(good + [bad])["periods"][-1]["status"], "held")

    def test_a_total_that_is_never_the_sum_is_not_a_printed_total_of_the_table(self):
        # B-3 style: the Total also counts appeals with no district row, in every edition
        series = [court_norm(total=45, end=f"20{y}-09-30") for y in range(18, 26)]
        r = R.reconcile_series(series)
        self.assertNotIn("held", {p["status"] for p in r["periods"]})
        self.assertEqual(r["identities"]["national"]["not_established"], 1)

    def test_a_footnote_saying_totals_include_more_explains_a_row_total_failure(self):
        good = [court_norm(end=f"20{y}-09-30") for y in range(18, 25)]
        bad = court_norm(total=33, end="2025-09-30", notes=["NOTE: Totals include reopened and reinstated appeals."])
        p = R.reconcile_series(good + [bad])["periods"][-1]
        self.assertEqual(p["status"], "reconciled")
        self.assertEqual(p["explained"], 1)

    def test_special_courts_count_in_the_national_total(self):
        special = [row("CIT", "other", "cit", [2]), row("FED", "other", "fed", [3])]
        n = court_norm(total=35, extra_rows=special)
        self.assertEqual(R.reconcile_series([n])["periods"][0]["status"], "reconciled")

    def test_a_dash_counts_as_no_cases_and_a_blank_makes_the_test_not_applicable(self):
        n = court_norm(c1=(4, 4, None))
        n["rows"][3]["flags"] = ["dash"]  # MA printed as a dash
        n["rows"][0]["values"] = [24]
        self.assertEqual(R.reconcile_series([n])["periods"][0]["status"], "reconciled")
        blank = court_norm(c1=(4, 4, None))
        blank["rows"][3]["flags"] = ["blank"]
        tests = R.period_tests(blank)
        self.assertFalse(any(t["kind"] == "circuit" and t["entity"] == "ca1" for t in tests))

    def test_percent_median_and_judge_columns_are_not_summed_but_misdemeanor_counts_are(self):
        n = court_norm()
        n["columns"] = [col("a", ["Percent Reaching Trial"], "0.0%"), col("b", ["Median Time"], "0.0"), col("c", ["Judgeships"]),
                        col("d", ["Class A Misdemeanor"]), col("e", ["Filed", "2024"], prior=True)]
        positions = R.additive_positions(n)
        self.assertEqual([n["columns"][i]["key"] for i in positions], ["d"])


class CategoryAndColumnTests(unittest.TestCase):
    def cat(self, total=10, parent=6, kids=(2, 4), other=4, end="2025-09-30"):
        rows = [row("Total", "national", "national", [total], path=["Total"]),
                row("Contract, Total", "category", "contract", [parent], path=["Contract, Total"]),
                row("Insurance", "category", "contract/insurance", [kids[0]], path=["Contract, Total", "Insurance"]),
                row("Marine", "category", "contract/marine", [kids[1]], path=["Contract, Total", "Marine"]),
                row("Other", "category", "other", [other], path=["Other"])]
        return {"pub": "JB", "period_end": end, "scope": "category", "table_key": "c-2", "columns": [col("filed", ["Filed"])], "rows": rows, "notes": []}

    def test_parent_and_total_rows_are_tested(self):
        tests = R.period_tests(self.cat())
        kinds = {(t["kind"], t["entity"]) for t in tests}
        self.assertIn(("parent", "contract"), kinds)
        self.assertIn(("depth0", "national"), kinds)
        self.assertTrue(all(t["ok"] for t in tests))

    def test_children_adding_up_to_more_than_their_parent_hold_the_period(self):
        series = [self.cat(end=f"20{y}-09-30") for y in range(18, 25)] + [self.cat(kids=(3, 4), end="2025-09-30")]
        self.assertEqual(R.reconcile_series(series)["periods"][-1]["status"], "held")

    def test_a_category_total_larger_than_its_printed_parts_is_recorded_not_held(self):
        series = [self.cat(end=f"20{y}-09-30") for y in range(18, 25)] + [self.cat(parent=7, total=11, end="2025-09-30")]
        last = R.reconcile_series(series)["periods"][-1]
        self.assertEqual(last["status"], "reconciled")
        self.assertGreaterEqual(last["total_exceeds_parts"], 1)

    def test_column_group_total_over_its_columns_and_subgroup_totals(self):
        cols = [col("t", ["Filed", "Total Commenced"]), col("op", ["Filed", "Original Proceedings", "Total"]),
                col("f", ["Filed", "Original Proceedings", "Felony"]), col("m", ["Filed", "Original Proceedings", "Class A Misdemeanor"]),
                col("r", ["Filed", "Reopens"])]
        n = {"pub": "JB", "period_end": "2025-09-30", "scope": "district", "table_key": "d", "columns": cols, "notes": [],
             "rows": [row("Total", "national", "national", [10, 8, 5, 3, 2])]}
        idents = {name: [cols[j]["key"] for j in parts] for _, parts, name in R.column_identities(n, R.additive_positions(n))}
        self.assertEqual(idents["t"], ["op", "r"])
        self.assertEqual(idents["op"], ["f", "m"])
        self.assertTrue(all(t["ok"] for t in R.period_tests(n) if t["kind"] == "coltotal"))

    def test_a_table_with_no_count_columns_has_no_totals(self):
        n = court_norm()
        n["columns"] = [col("w", ["Weighted Filings per Judgeship"], "0.0")]
        self.assertEqual(R.reconcile_series([n])["status"], "no_totals")


if __name__ == "__main__":
    unittest.main()
