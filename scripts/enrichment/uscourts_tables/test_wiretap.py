"""Offline tests for wiretap.py, coverage.py and series_index.py (synthetic rows and builds; no files, no network).

Run: cd scripts/enrichment/uscourts_tables && python3 -B -m unittest -v test_wiretap
"""
import unittest

import coverage as CV
import series_index as SI
import wiretap as W


def row(label, values, flags=None):
    return {"label": label, "label_raw": label, "values": list(values), "flags": flags or [None] * len(values), "section": False, "indent": 0}


def table(rows):
    return [row(label, values) for label, values in rows]


GOOD = [("Total", [30, 6]), ("Federal Total", [10, 2]), ("ALABAMA MIDDLE", [4, 1]), ("ARIZONA", [6, 1]),
        ("CALIFORNIA", [15, 3]), ("LOS ANGELES", [12, 3]), ("RIVERSIDE", [3, 0]),
        ("MARYLAND", [5, 1]), ("WASHINGTON", [2, 1]), ("BALTIMORE", [3, 0])]


class StructureTests(unittest.TestCase):
    def test_sections_are_read_from_the_tables_own_sums(self):
        out, why = W.structure(table(GOOD), [0, 1])
        self.assertIsNone(why)
        paths = [p for _, p in out]
        self.assertIn(["Federal Total", "ARIZONA"], paths)  # a single-district state in the federal section is a district
        self.assertIn(["CALIFORNIA", "LOS ANGELES"], paths)
        self.assertIn(["MARYLAND", "WASHINGTON"], paths)  # a county named like a state does not end the Maryland block

    def test_a_block_that_does_not_add_up_is_rejected(self):
        bad = [r if r[0] != "RIVERSIDE" else ("RIVERSIDE", [2, 0]) for r in GOOD]
        out, why = W.structure(table(bad), [0, 1])
        self.assertIsNone(out)
        self.assertIn("CALIFORNIA", why)

    def test_total_must_equal_federal_plus_states(self):
        bad = [("Total", [31, 6])] + GOOD[1:]
        out, why = W.structure(table(bad), [0, 1])
        self.assertIsNone(out)
        self.assertIn("Federal Total plus the state rows", why)

    def test_a_block_opened_by_a_name_that_is_not_a_state_is_rejected(self):
        bad = GOOD[:4] + [("MARICOPA", [15, 3])] + GOOD[5:]
        out, why = W.structure(table(bad), [0, 1])
        self.assertIsNone(out)

    def test_flat_editions_without_state_rows_are_kept_only_with_unique_labels(self):
        flat = [("Total", [16, 3]), ("Federal Total", [10, 2]), ("ALABAMA MIDDLE", [4, 1]), ("ARIZONA", [6, 1]), ("MARICOPA", [4, 1]), ("ORANGE", [2, 0])]
        out, why = W.structure(table(flat), [0, 1])
        self.assertIsNone(why)
        self.assertIn(["MARICOPA"], [p for _, p in out])
        dup = flat + [("ORANGE", [1, 0])]
        dup[0] = ("Total", [17, 3])
        out, why = W.structure(table(dup), [0, 1])
        self.assertIsNone(out)
        self.assertIn("printed twice", why)

    def test_text_cells_keep_their_column_out_of_the_grouping(self):
        rows = table(GOOD)
        rows[3]["values"][1], rows[3]["flags"][1] = None, "text:NP"
        self.assertEqual(W.clean_positions(rows, [0, 1]), [0])


class CoverageTests(unittest.TestCase):
    def test_series_names(self):
        self.assertEqual(CV.series_of("JB", "C-4A"), "C")
        self.assertEqual(CV.series_of("BAPCPA", "BAPCPA 1A"), "1")
        self.assertEqual(CV.series_of("JFF", "4.2"), "4")
        self.assertEqual(CV.series_of("WIRETAP", "Wire A1"), "Wire A/B")
        self.assertEqual(CV.series_of("FCMS", "FCMS-APPEALS-PARTICIPATIONS"), "APPEALS-PARTICIPATIONS")

    def test_counts_split_published_held_duplicate_and_gap(self):
        periods = [{"end": "2024-09-30", "acq": "acquired", "parse": "parsed", "pub": "published", "why": ""},
                   {"end": "2023-09-30", "acq": "acquired", "parse": "parsed", "pub": "held", "why": ""},
                   {"end": "2022-09-30", "acq": "acquired", "parse": "not_parsed", "pub": "duplicate", "why": "x"},
                   {"end": "2021-09-30", "acq": "not_acquired", "parse": "not_parsed", "pub": "not_published", "why": "not acquired"}]
        c = CV.count(periods)
        self.assertEqual((c["listed"], c["acquired"], c["parsed"], c["published"], c["held"], c["duplicate"], c["not_published"]), (4, 3, 2, 1, 1, 1, 1))
        self.assertEqual(c["first_published"], "2024-09-30")
        self.assertEqual(CV.reasons_of(periods).most_common(1)[0], ("not acquired", 1))

    def test_published_sets_read_every_period_of_a_record(self):
        builds = {"d": {"rows": [{"item": {"ust": {"table": "C", "src": [{"pub": "JB", "end": "2025-09-30"}, {"pub": "STFJ", "end": "2025-12-31"}]}}}]}}
        self.assertEqual(CV.published_sets(builds), {("JB", "C", "2025-09-30"), ("STFJ", "C", "2025-12-31")})


class SeriesIndexTests(unittest.TestCase):
    def test_series_record_names_its_geography_periods_and_reconciliation(self):
        payload = {"tableKey": "c", "table": "C", "title": "Civil Cases", "scope": "district", "geography": "U.S. district courts", "family": "tables",
                   "periods": [{"end": "2024-09-30", "pub": "JB"}, {"end": "2025-09-30", "pub": "JB"}], "pubs": ["JB"], "cols": [{"k": "filed"}],
                   "rec": {"status": "reconciled", "held": []}, "national": {"dataset": "uscourts_tables_national", "id": "c"}, "page": "https://www.uscourts.gov/x"}
        rec = SI.series_record(payload)
        self.assertEqual(rec["id"], "series:c")
        self.assertEqual(rec["item"]["cells"]["periods"], 2)
        self.assertIn({"url": "/records/uscourts_tables_national/c", "label": "National table"}, rec["item"]["links"])
        self.assertEqual(dict(rec["detail"]["facts"])["Reconciliation"], "reconciled")

    def test_circuit_ids_are_told_apart_from_california_districts(self):
        self.assertIn("ca9", SI.CIRCUITS)
        self.assertNotIn("cacd", SI.CIRCUITS)


if __name__ == "__main__":
    unittest.main()
