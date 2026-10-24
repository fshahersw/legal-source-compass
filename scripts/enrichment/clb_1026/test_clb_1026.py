"""Offline tests for the wave-1026 CourtListener builders (synthetic fixtures; no network, no corpus).

    cd scripts/enrichment/clb_1026 && python3 -B -m unittest -v test_clb_1026
"""
from __future__ import annotations

import bz2
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import clb1026_common as cm  # noqa: E402
import search_plan as sp  # noqa: E402
import build_clb_search_counts as bsc  # noqa: E402
import build_clb_judge_disclosure_items as bdi  # noqa: E402
import build_clb_judge_people as bjp  # noqa: E402
import build_clb_court_appeals_to as bat  # noqa: E402


def write_bz2(dirname: str, name: str, text: str) -> str:
    path = os.path.join(dirname, name)
    with bz2.open(path, "wt", encoding="utf-8", newline="") as h:
        h.write(text)
    return path


class CommonTests(unittest.TestCase):
    def test_pg_rows_reads_postgres_backslash_escapes(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_bz2(d, "t.csv.bz2", 'id,name,note\n"1","Smith \\"Jr\\"","a\\\\b"\n"2",,""\n')
            rows = list(cm.pg_rows(path))
        self.assertEqual(rows[0], {"id": "1", "name": 'Smith "Jr"', "note": "a\\b"})
        self.assertEqual(rows[1], {"id": "2", "name": "", "note": ""})

    def test_pg_rows_rejects_a_short_row(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_bz2(d, "t.csv.bz2", 'id,name\n"1"\n')
            with self.assertRaises(ValueError):
                list(cm.pg_rows(path))

    def test_show_date_keeps_the_recorded_precision(self):
        self.assertEqual(cm.show_date("1986-01-01", "%Y"), "1986")
        self.assertEqual(cm.show_date("1986-03-01", "%Y-%m"), "1986-03")
        self.assertEqual(cm.show_date("1986-03-15", "%Y-%m-%d"), "1986-03-15")
        self.assertEqual(cm.show_date("1986-03-15", ""), "1986-03-15")
        self.assertIsNone(cm.show_date("", "%Y"))
        self.assertIsNone(cm.show_date("March 1986", None))

    def test_compact_drops_empty_values_but_keeps_zero(self):
        self.assertEqual(cm.compact({"a": None, "b": 0, "c": [], "d": {"e": "", "f": False, "g": True}, "h": [{"x": None}]}),
                         {"b": 0, "d": {"g": True}, "h": [{}]})

    def test_label_reads_the_legend_and_leaves_unknown_codes_out(self):
        leg = {"positions": {"how_selected": {"a_pres": "Appointment (President)"}}}
        self.assertEqual(cm.label(leg, "positions", "how_selected", "a_pres"), "Appointment (President)")
        self.assertIsNone(cm.label(leg, "positions", "how_selected", "zz"))
        self.assertIsNone(cm.label(leg, "positions", "how_selected", ""))

    def test_facts_write_not_recorded(self):
        self.assertEqual(cm.facts([("A", None), ("B", 0)]), [["A", "Not recorded"], ["B", "0"]])

    def test_court_link_only_for_an_exact_directory_id(self):
        spine = {"nysd", "ca9"}
        self.assertEqual(cm.court_link("nysd", spine), "/courts/nysd")
        self.assertIsNone(cm.court_link("nysdx", spine))
        self.assertIsNone(cm.court_link(None, spine))


class PeopleTests(unittest.TestCase):
    def test_full_name_with_suffix_code(self):
        self.assertEqual(bjp.full_name({"name_first": "John", "name_middle": "G.", "name_last": "Roberts", "name_suffix": "jr"}), "John G. Roberts Jr.")
        self.assertEqual(bjp.full_name({"name_first": "", "name_middle": "", "name_last": "", "name_suffix": ""}), "Name not recorded")

    def test_aba_ratings_follow_pages_and_join_on_person_ids(self):
        api = "https://www.courtlistener.com/api/rest/v4/"
        first = bjp.cl_api.build_url("aba-ratings/", [("order_by", "id")])
        second = api + "aba-ratings/?cursor=abc&order_by=id"
        pages = {
            first: {"next": second, "results": [{"id": 1, "person": api + "people/44/", "rating": "q", "year_rated": 2014},
                                                {"id": 2, "person": "https://elsewhere.example/people/45/", "rating": "wq", "year_rated": 2015}]},
            second: {"next": None, "results": [{"id": 3, "person": api + "people/44/", "rating": "wq", "year_rated": 2019},
                                               {"id": 1, "person": api + "people/44/", "rating": "q", "year_rated": 2014}]},
        }
        index = {("GET", u): {"sha256": u, "retrieved_at": "2026-10-24T01:40:00Z"} for u in pages}
        old = (bjp.cl_api.load_index, bjp.cl_api.read_raw)
        bjp.cl_api.load_index = lambda: index
        bjp.cl_api.read_raw = lambda sha: json.dumps(pages[sha]).encode()
        try:
            out, meta = bjp.aba_ratings()
        finally:
            bjp.cl_api.load_index, bjp.cl_api.read_raw = old
        self.assertEqual(sorted(out), [44])  # the person URL on another host is not joined
        self.assertEqual([r["id"] for r in out[44]], [1, 3])  # a repeated row is counted once
        self.assertEqual(meta["pages"], 2)
        self.assertEqual(meta["rows"], 3)


class DisclosureTests(unittest.TestCase):
    def test_code_key(self):
        self.assertEqual(bdi.code_key("J", bdi.VALUE_CODES), "J")
        self.assertEqual(bdi.code_key("", bdi.VALUE_CODES), "none")
        self.assertEqual(bdi.code_key("Z", bdi.VALUE_CODES), "other")
        self.assertEqual(bdi.code_key("-1", bdi.VALUE_CODES), "-1")

    def test_ordered_counts_follow_form_order_and_drop_zero(self):
        c = Counter({"K": 2, "J": 5, "none": 1, "P1": 0, "other": 3})
        self.assertEqual(bdi.ordered_counts(c, bdi.VALUE_CODES), [["J", 5], ["K", 2], ["other", 3], ["none", 1]])

    def test_top_text_is_stable_on_ties(self):
        self.assertEqual(bdi.top_text(Counter({"Dividend": 2, "Rent": 2, "Int/Div": 5}), 2), [["Int/Div", 5], ["Dividend", 2]])


class SearchCountTests(unittest.TestCase):
    def test_plan_has_every_query_once(self):
        plan = sp.plan()
        self.assertEqual(len(plan), len(sp.YEARS) * (1 + len(sp.TOPICS)) + len(sp.APPELLATE) * (1 + len(sp.TOPICS)) + 1 + len(sp.TOPICS))
        self.assertEqual(len({p["key"] for p in plan}), len(plan))

    def test_queries_are_exact_and_round_trip_through_the_url(self):
        plan = {p["key"]: p for p in sp.plan()}
        p = plan["national:class_waiver:2020"]
        self.assertEqual(p["q"], '"class waiver arbitration"~10 AND dateFiled:[2020-01-01 TO 2020-12-31]')
        qs = urllib.parse.parse_qs(p["url"].split("?", 1)[1])
        self.assertEqual(qs["q"], [p["q"]])
        self.assertEqual(qs["stat_Published"], ["on"])
        self.assertEqual(qs["stat_Unpublished"], ["on"])
        c = plan["court:ca9:product_liability"]
        self.assertEqual(c["q"], 'court_id:ca9 AND ("products liability" OR "product liability") AND dateFiled:[2000-01-01 TO 2025-12-31]')
        self.assertNotIn("q=", plan["oral:all"]["url"])

    def test_share_and_rank(self):
        self.assertEqual(bsc.share(7, 200000), 0.004)
        self.assertIsNone(bsc.share(1, 0))
        self.assertIsNone(bsc.share(None, 10))
        self.assertEqual(bsc.competition_rank({"a": 2.0, "b": 3.0, "c": 2.0, "d": None}), {"b": 1, "a": 2, "c": 2})

    def test_front_url_keeps_the_parameters(self):
        api = "https://www.courtlistener.com/api/rest/v4/search/?type=o&q=%22x%22"
        self.assertEqual(bsc.front_url(api), "https://www.courtlistener.com/?type=o&q=%22x%22")

    def _rows(self, missing=()):
        rows = {}
        for i, p in enumerate(sp.plan()):
            if p["key"] in missing:
                continue
            n = 100000 if p["topic"] is None else 100 + i % 7
            rows[p["key"]] = {**p, "count": n, "retrieved_at": "2026-10-24T02:00:00Z", "sha256": f"{i:064d}", "http_status": 200}
        return rows

    def test_build_from_synthetic_counts(self):
        old = (bsc.cm.spine_ids, bsc.cm.bulk_path, bsc.cm.pg_rows)
        bsc.cm.spine_ids = lambda: {"ca9", "scotus"}
        bsc.cm.bulk_path = lambda name: name
        bsc.cm.pg_rows = lambda path: iter([{"id": c, "full_name": f"Court {c}"} for c in sp.APPELLATE])
        try:
            spec = bsc.build(self._rows(missing={"court:ca1:daubert"}))
        finally:
            bsc.cm.spine_ids, bsc.cm.bulk_path, bsc.cm.pg_rows = old
        by = {r["id"]: r for r in spec["rows"]}
        self.assertIn("year:all", by)
        self.assertEqual(len([k for k in by if k.startswith("topic:")]), len(sp.TOPICS))
        ca9 = by["court:ca9"]["item"]["profile"]
        qi = next(t for t in ca9["topics"] if t["slug"] == "qualified_immunity")
        self.assertEqual(qi["share_pct"], round(100 * qi["count"] / ca9["total"]["count"], 3))
        self.assertEqual(qi["rank_of"], 14)
        # a court missing one topic leaves that topic's pooled share out (never pooled over fewer courts)
        d = next(t for t in ca9["topics"] if t["slug"] == "daubert")
        self.assertIsNone(d["pooled_share_pct"])
        self.assertEqual(spec["summary"]["queries"]["missing"], ["court:ca1:daubert"])
        topic = by["topic:daubert"]["item"]["profile"]
        last = topic["points"][-1]
        self.assertTrue(last["partial"])
        self.assertEqual(last["year"], sp.PARTIAL_YEAR)
        self.assertTrue(all(p["search_url"].startswith("https://www.courtlistener.com/?") for p in topic["points"]))
        self.assertEqual(by["court:ca9"]["item"]["links"][0]["url"], "/courts/ca9")
        self.assertNotIn("/courts/ca1", json.dumps(by["court:ca1"]["item"]["links"]))  # not in the stub directory


class AppealsTests(unittest.TestCase):
    def test_court_view_unknown_court_is_kept_without_a_link(self):
        v = bat.court_view("zzz", {}, {"cafc"}, {})
        self.assertEqual(v, {"court_id": "zzz", "name": None, "link": None, "level": None, "start": None, "end": None, "in_courts_table": False})
        leg = {"courts": {"jurisdiction": {"F": "Federal Appellate"}}}
        v = bat.court_view("cafc", {"cafc": {"full_name": "Court of Appeals for the Federal Circuit", "jurisdiction": "F", "start_date": "1982-04-02", "end_date": ""}}, {"cafc"}, leg)
        self.assertEqual((v["link"], v["level"], v["start"], v["end"]), ("/courts/cafc", "Federal Appellate", "1982-04-02", None))


if __name__ == "__main__":
    unittest.main()
