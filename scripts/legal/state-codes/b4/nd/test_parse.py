import os
import unittest

from citation import canon_citation, citations_equal_lists, citations_equal_multisets, filter_sections_to_official_toc
from html_section_bodies import section_bodies_from_chapter_html
from parse import OFFICIAL_STATEMENT, parse_toc, sections_for_chapter, split_pdf_sections, citation_chapter_id

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

    def test_pdf_section_after_bare_citation_line(self):
        text = "1-02-23.\n\n   1-02-25. Continuations of existing statutes.\n   Body line one.\n"
        secs = split_pdf_sections(text)
        cits = [s["citation"] for s in secs]
        self.assertIn("1-02-25", cits)
        self.assertNotIn("1-02-23", cits)

    def test_official_statement_present(self):
        self.assertIn("official version", OFFICIAL_STATEMENT.lower())

    def test_canon_citation_leading_zeros(self):
        self.assertEqual(canon_citation("1-03-19"), canon_citation("01-03-19"))
        self.assertTrue(citations_equal_lists(["5-02-10.1"], ["05-02-10.1"]))

    def test_citations_equal_multisets_ignores_order(self):
        a = ["8-10-01", "8-10-02"]
        b = ["8-10-02", "8-10-01"]
        self.assertFalse(citations_equal_lists(a, b))
        self.assertTrue(citations_equal_multisets(a, b))

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

    def test_html_section_body_from_toc_cell(self):
        html = open(os.path.join(FIX, "t01c99_toc_cell_body_snippet.html"), encoding="utf-8").read()
        toc = [{"citation": "1-99-01", "heading": "Sample heading"}]
        bodies = section_bodies_from_chapter_html(html, toc)
        self.assertIn("1-99-01", bodies["1-99-01"])
        self.assertIn("Additional official text", bodies["1-99-01"])

    def test_sections_for_chapter_filters_stray(self):
        parsed = [
            {"citation": "6-13-01", "heading": "a", "body": ""},
            {"citation": "44-04-18", "heading": "b", "body": ""},
        ]
        kept = sections_for_chapter(parsed, "6-13")
        self.assertEqual([s["citation"] for s in kept], ["6-13-01"])
        self.assertEqual(citation_chapter_id("6-13-01"), "6-13")


if __name__ == "__main__":
    unittest.main()
