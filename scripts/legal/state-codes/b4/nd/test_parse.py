import os
import unittest

from parse import OFFICIAL_STATEMENT, parse_toc, split_pdf_sections

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


if __name__ == "__main__":
    unittest.main()
