import os
import unittest

from parse import citation_display, parse_fullchapter, publisher_currency  # noqa: E402


FIX = os.path.join(os.path.dirname(__file__), "fixtures")


class TestVTParse(unittest.TestCase):
    def test_currency_verbatim(self):
        html = open(os.path.join(FIX, "fullchapter_09A_012.html"), encoding="utf-8").read()
        cur = publisher_currency(html)
        self.assertIn("2025 session", cur["statement"])
        self.assertIn("unofficial copy", cur["statement"])
        self.assertIsNone(cur["as_of"])

    def test_fullchapter_sections(self):
        html = open(os.path.join(FIX, "fullchapter_09A_012.html"), encoding="utf-8").read()
        secs = parse_fullchapter(
            html,
            title="09A",
            chapter="012",
            source_url="https://legislature.vermont.gov/statutes/fullchapter/09A/012",
            receipt_sha="abc",
        )
        self.assertEqual(len(secs), 7)
        self.assertEqual(secs[0]["number"], "12—101")
        self.assertEqual(secs[0]["citation"], "9A V.S.A. § 12-101")
        self.assertIn("Controllable Electronic Records", secs[0]["text"])
        self.assertIn("Added 2025", secs[0]["history"])

    def test_citation_em_dash(self):
        self.assertEqual(citation_display("9A", "12—101"), "9A V.S.A. § 12-101")

    def test_decimal_section_number(self):
        from parse import section_header_parts  # noqa: WPS433

        num, head = section_header_parts("§ 16.01. Corporate powers")
        self.assertEqual(num, "16.01")
        self.assertEqual(head, "Corporate powers")
        num, head = section_header_parts("§ 16.21. Other reports to shareholders")
        self.assertEqual(num, "16.21")
        self.assertEqual(head, "Other reports to shareholders")


if __name__ == "__main__":
    unittest.main()
