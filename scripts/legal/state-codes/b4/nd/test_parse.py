import os
import unittest

from citation import canon_citation, citations_equal_lists, filter_sections_to_official_toc
from parse import OFFICIAL_STATEMENT, parse_toc, split_pdf_sections, citation_chapter_id

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


class TestNdParse(unittest.TestCase):
    def test_toc_fixture(self):
        html = open(os.path.join(FIX, "t01c01_toc_snippet.html"), encoding="utf-8").read()
        chapter_id, heading, rows = parse_toc(html)
        self.assertEqual(chapter_id, "1-01")
        self.assertIn("General Principles", heading)
        self.assertEqual(rows[0]["citation"], "1-01-01")
        self.assertIn("referred", rows[0]["heading"].lower())

    def test_pdf_sections_fixture(self):
        text = open(os.path.join(FIX, "t01c01_pdf_snippet.txt"), encoding="utf-8").read()
        secs = split_pdf_sections(text)
        self.assertGreaterEqual(len(secs), 3)
        self.assertEqual(secs[0]["citation"], "1-01-01")
        self.assertIn("Century Code", secs[0]["body"])

    def test_official_statement_present(self):
        self.assertIn("official version", OFFICIAL_STATEMENT.lower())

    def test_canon_citation_leading_zeros(self):
        self.assertEqual(canon_citation("1-03-19"), canon_citation("01-03-19"))
        self.assertTrue(citations_equal_lists(["5-02-10.1"], ["05-02-10.1"]))

    def test_filter_sections_to_official_toc_drops_pdf_duplicate(self):
        toc = [{"citation": "8-10-11", "heading": "A"}]
        pdf = [
            {"citation": "8-10-11", "heading": "A", "body": "one"},
            {"citation": "8-10-11", "heading": "A", "body": "two"},
        ]
        kept, dropped = filter_sections_to_official_toc(pdf, toc)
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(dropped), 1)
        self.assertEqual(dropped[0]["canon"], "8-10-11")

    def test_citation_chapter_id(self):
        self.assertEqual(citation_chapter_id("6-13-01"), "6-13")


if __name__ == "__main__":
    unittest.main()
