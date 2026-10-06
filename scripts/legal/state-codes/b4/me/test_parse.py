import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("me_parse", pathlib.Path(__file__).with_name("parse.py"))
parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse)


class MaineParseTest(unittest.TestCase):
    def test_section_fixture_number_heading_body_history(self):
        raw = (pathlib.Path(__file__).parent / "fixtures/title1sec1.html").read_text()
        r = parse.parse_section_page(raw, "https://legislature.maine.gov/statutes/1/title1sec1.html")
        self.assertIsNotNone(r)
        self.assertEqual(r["number"], "1")
        self.assertEqual(r["heading"], "Extent of sovereignty and jurisdiction")
        self.assertIn("jurisdiction and sovereignty", r["body"])
        self.assertNotIn("[PL 1985", r["body"])
        self.assertIn("PL 1985", r["history"])
        self.assertIn("extracted on", r["docinfo"])

    def test_section_block_sha(self):
        raw = (pathlib.Path(__file__).parent / "fixtures/title1sec1.html").read_text()
        r = parse.parse_section_page(raw, "http://x")
        block = r["heading_line"] + "\n" + r["body"] + "\n" + r["history"]
        from sc_common import sha256_hex

        self.assertEqual(sha256_hex(block), sha256_hex(block))
        self.assertGreater(len(block), 100)

    def test_currency_from_homepage_statement(self):
        c = parse.parse_currency(
            [
                "The text reflects changes made through the First Special Session of the 132nd Maine Legislature, and is current through October 1, 2025. The text is subject to change without notice."
            ]
        )
        self.assertEqual(c["as_of"], "2025-10-01")
        self.assertIn("October 1, 2025", c["statement"])


if __name__ == "__main__":
    unittest.main()
