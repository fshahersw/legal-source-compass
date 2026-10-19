import unittest

import courtsdb_lib as lib


class CourtsDbLibTest(unittest.TestCase):
    def test_labels_keep_unknown_codes_and_mark_empty(self):
        self.assertEqual(lib.label(lib.LEVELS, "colr"), "Court of last resort")
        self.assertEqual(lib.label(lib.LEVELS, "xyz"), "xyz")
        self.assertEqual(lib.label(lib.LEVELS, ""), "Not recorded")
        self.assertEqual(lib.label(lib.LEVELS, None), "Not recorded")

    def test_periods_drop_malformed_dates(self):
        got = lib.periods([{"start": "1850-01-01", "end": None, "reorganization": ["1966-01-01", "bad", "1866-03-09"]},
                           {"start": None, "end": None}, "x"])
        self.assertEqual(got, [{"start": "1850-01-01", "end": None, "reorganizations": ["1866-03-09", "1966-01-01"]}])

    def test_parent_chain_stops_on_cycle_and_missing(self):
        by_id = {"a": {"parent": "b"}, "b": {"parent": "c"}, "c": {"parent": "a"}, "d": {"parent": "zz"}}
        self.assertEqual(lib.parent_chain("a", by_id), ["b", "c"])
        self.assertEqual(lib.parent_chain("d", by_id), [])

    def test_children_and_appeals(self):
        by_id = {"g": {}, "x": {"parent": "g", "appeal_to": "ca9"}, "y": {"parent": "g"}, "ca9": {"lower_courts": ["y", "nope"]}}
        self.assertEqual(lib.children_index(by_id), {"g": ["x", "y"]})
        self.assertEqual(lib.appeal_index(by_id), {"ca9": ["x", "y"]})

    def test_circuit_only_for_existing_numbered_circuit(self):
        by_id = {"ca9": {}}
        self.assertEqual(lib.circuit_id({"federal_circuit": 9}, by_id), "ca9")
        self.assertIsNone(lib.circuit_id({"federal_circuit": 2}, by_id))
        self.assertIsNone(lib.circuit_id({"federal_circuit": "9"}, by_id))
        self.assertIsNone(lib.circuit_id({}, by_id))

    def test_strings_dedupes_and_limits(self):
        self.assertEqual(lib.strings([" a", "a", "", 3, "b"], limit=1), ["a"])


if __name__ == "__main__":
    unittest.main()
