"""Offline parity checks between the Python semantic builders and the committed golden fixture the TypeScript port is tested
against (src/lib/semantic/chunking.test.ts), plus the pruned-row contract of the scheduled refresh (refresh_rows.py).

    cd scripts/semantic && python3 -B -m unittest -v test_chunk_parity
"""
from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import make_chunk_fixtures as mf  # noqa: E402
import refresh_rows as rr  # noqa: E402
import sources as src  # noqa: E402


class ChunkParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(mf.ROWS_PATH, encoding="utf-8") as fh:
            cls.rows_doc = json.load(fh)
        with open(mf.GOLDEN_PATH, encoding="utf-8") as fh:
            cls.golden_text = fh.read()

    def test_golden_fixture_is_what_python_produces(self):
        # the TypeScript test reproduces this file; if the Python chunker or builders change, the file must be rebuilt.
        # The generating interpreter's patch release is provenance, not behaviour; the Unicode version still must match.
        produced = mf.build(self.rows_doc)
        produced["meta"]["python"] = json.loads(self.golden_text)["meta"]["python"]
        self.assertEqual(mf.dump(produced), self.golden_text)

    def test_fixture_covers_every_collection_and_shape(self):
        golden = json.loads(self.golden_text)
        self.assertEqual({r["dataset"] for r in golden["rows"]}, set(rr.SPECS))
        self.assertTrue(any(r["doc"] is None for r in golden["rows"]), "a record without a document")
        self.assertTrue(any(r["chunks"] and r["chunks"][0]["chunk_total"] > len(r["chunks"]) for r in golden["rows"]), "a capped record")
        self.assertTrue(any(len(r["chunks"]) > 3 for r in golden["rows"]), "a multi-passage record")
        self.assertTrue(any(ck.MARK in r["text"] for r in golden["docs"]), "U.S. Code heading marks")
        self.assertTrue(any(any(ord(c) > 0xFFFF for c in r["text"]) for r in golden["docs"]), "astral characters")

    def test_pruned_rows_build_the_same_documents(self):
        titles = self.rows_doc["us_code_titles"]
        for row in self.rows_doc["rows"]:
            ds = row["dataset"]
            pruned = rr.prune(ds, row, titles)
            self.assertLessEqual(set(pruned), set(rr.SPECS[ds]) | {"_title_names"})
            full = mf.build_doc(ds, row, titles)
            if ds == "us_code_sections":
                cut = src.usc_doc(pruned, rr.titles_map(pruned["_title_names"]))
            else:
                cut = mf.BUILDERS[ds](pruned)
            self.assertEqual(full, cut, f"{ds} {row['id']}")

    def test_prune_keeps_non_objects_and_missing_keys_as_the_sql_projection_does(self):
        self.assertEqual(rr.prune("ftc_publications_index", {"id": "x", "title": "T"}),
                         {"id": "x", "title": "T", "source_url": None, "item": None})
        self.assertEqual(rr.prune("ftc_publications_index", {"id": "x", "item": {"cells": None, "other": 1}})["item"],
                         {"summary": None, "page_url": None, "cells": None})
        self.assertEqual(rr.prune("crs_reports", {"detail": "text"})["detail"], "text")
        self.assertEqual(rr.json_text(5), "5")
        self.assertEqual(rr.json_text("5"), "5")
        self.assertIsNone(rr.json_text(None))

    def test_title_names_follow_the_python_dictionary(self):
        titles = [
            {"detail": {"usc_title": {"number": "5", "name": "First"}}},
            {"detail": {"usc_title": {"number": "6", "name": "Six"}}},
            {"detail": {"usc_title": {"number": "5", "name": "Second  name"}}},
            {"detail": {"usc_title": {"number": "5", "name": ""}}},
        ]
        row = {"id": "5:1", "text": "x", "detail": {"usc": {"title": "5", "key": "1"}}}
        pruned = rr.prune("us_code_sections", row, titles)
        self.assertEqual(pruned["_title_names"], [["5", "First"], ["5", "Second  name"], ["5", ""]])
        self.assertEqual(rr.titles_map(pruned["_title_names"]), {"5": "Second name"})


if __name__ == "__main__":
    unittest.main()
