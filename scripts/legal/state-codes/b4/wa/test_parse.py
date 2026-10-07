import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wa_html import parse_chapter_index, parse_title_page  # noqa: E402
from wa_pdf import split_sections  # noqa: E402

TITLE1_SNIP = open(os.path.join(os.path.dirname(__file__), "fixtures", "title1.htm"), encoding="utf-8").read()
CH104_SNIP = open(os.path.join(os.path.dirname(__file__), "fixtures", "chapter1.04.htm"), encoding="utf-8").read()


class TestWaParse(unittest.TestCase):
    def test_title_page(self):
        p = parse_title_page(TITLE1_SNIP)
        self.assertEqual(p["native_title_id"], "1")
        self.assertGreaterEqual(len(p["chapters"]), 10)

    def test_chapter_index(self):
        p = parse_chapter_index(CH104_SNIP)
        self.assertEqual(p["chapter_id"], "1.04")
        self.assertEqual(len(p["sections_toc"]), 9)
        self.assertIn("COMBINEDCHAPTER.pdf", p["complete_chapter_pdf_url"])

    def test_pdf_split_sample(self):
        sample = open(os.path.join(os.path.dirname(__file__), "fixtures", "chapter1.04.pdf.txt"), encoding="utf-8").read()
        secs = split_sections(sample, [f"1.04.0{x}" for x in ("10", "13", "14")])
        self.assertGreaterEqual(len(secs), 3)
        self.assertTrue(secs[0]["text"].startswith("RCW 1.04"))


if __name__ == "__main__":
    unittest.main()
