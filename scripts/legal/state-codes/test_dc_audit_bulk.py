import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("dc_audit", Path(__file__).with_name("dc-audit-bulk.py"))
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)


class IndependentTextComparisonTests(unittest.TestCase):
    def test_preserves_every_non_whitespace_character(self):
        actual = "§ 1.\n(a) Text & notes."
        export = "Code of the District of Columbia § 1. (a) Text &amp; notes."
        self.assertEqual(dc.comparison_text(actual), dc.comparison_text(export, True, "/us/dc/council/code/sections/1"))
        self.assertNotEqual(dc.comparison_text(actual), dc.comparison_text(export.replace("notes", "note"), True, "/us/dc/council/code/sections/1"))

    def test_entity_decode_once_and_root_heading_retained(self):
        self.assertEqual(dc.comparison_text("&amp;amp;", True), "&amp;")
        self.assertEqual(dc.comparison_text("Code of the District of Columbia", True, "/us/dc/council/code"), "CodeoftheDistrictofColumbia")
        self.assertEqual(dc.comparison_text("&amp;"), "&amp;")


if __name__ == "__main__":
    unittest.main()
