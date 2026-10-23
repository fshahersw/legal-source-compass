"""Offline tests of the batch runner's row building (run_batch.py); no network.

Run: python3 -I -B -m unittest discover -s scripts/citations_v2 -p 'test_*.py' -v
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import engine  # noqa: E402
import run_batch  # noqa: E402

GOLDEN = json.loads((HERE.parents[1] / "src" / "lib" / "citations" / "fixtures" / "golden.json").read_text(encoding="utf-8"))


class Rows(unittest.TestCase):
    def test_rows_map_antecedents_to_page_numbers_like_the_nightly_function(self):
        doc = next(d for d in GOLDEN["documents"] if d["id"] == "pages")
        pages = [{"page": 3, "text": doc["pages"][0]}, {"page": 4, "text": doc["pages"][1]}, {"page": 5, "text": "No citations."}]
        rows = run_batch.load_rows("a" * 64, pages, engine.extract_pages([p["text"] for p in pages]))
        self.assertEqual([(r["page"], len(r["citations"])) for r in rows], [(3, 2), (4, 3), (5, 0)])
        short = next(c for c in rows[1]["citations"] if c["matched"] == "550 U.S. at 556")
        self.assertEqual(short["antecedent"], {"page": 3, "seq": 0})
        self.assertEqual(rows[0]["citations"][0]["name"], "Bell Atl. Corp. v. Twombly")
        self.assertEqual({r["src"] for r in rows}, {"pdf"})

    def test_batches_respect_the_loader_limits(self):
        row = lambda n: {"src": "pdf", "src_id": "a" * 64, "page": 1, "citations": [None] * n}  # noqa: E731
        self.assertEqual([len(b) for b in run_batch.batches([row(1)] * 401)], [400, 1])
        self.assertEqual([len(b) for b in run_batch.batches([row(9000), row(9000)])], [1, 1])
        self.assertEqual(run_batch.batches([]), [])

    def test_pages_group_by_byte_set_in_page_order(self):
        got = run_batch.by_set([{"sha256": "b", "page": 2, "text": "y"}, {"sha256": "a", "page": 1, "text": "x"},
                                {"sha256": "b", "page": 1, "text": "z"}])
        self.assertEqual([(s, [p["page"] for p in ps]) for s, ps in got], [("a", [1]), ("b", [1, 2])])


if __name__ == "__main__":
    unittest.main()
