import os
import unittest

from parse import extract_history, parse_section_html, section_body_text

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


class TestRIParse(unittest.TestCase):
    def test_section_with_history(self):
        raw = open(os.path.join(FIX, "1-2-1.htm"), "rb").read()
        p = parse_section_html(raw, {"citation_number": "1-2-1"})
        self.assertEqual(p["citation_number"], "1-2-1")
        self.assertIn("president and CEO", p["text"])
        self.assertIn("P.L. 2024", p["history"])
        self.assertIsNotNone(p["effective"])
        self.assertIsNone(p["status_label"])

    def test_repealed_section(self):
        raw = open(os.path.join(FIX, "1-2-5.htm"), "rb").read()
        p = parse_section_html(raw, {"citation_number": "1-2-5", "toc_label": "§ 1-2-5. Repealed."})
        self.assertEqual(p["status_label"], "Repealed")
        self.assertIn("Repealed", p["text"])

    def test_history_extractor(self):
        block = open(os.path.join(FIX, "1-2-1.htm"), "rb").read().decode()
        h = extract_history(block)
        self.assertTrue(h.startswith("P.L. 1935"))


if __name__ == "__main__":
    unittest.main()
