"""Tests for Oregon ORS chapter HTML parsing (parity with or-parse.test.mjs)."""
import unittest

from or_parse import parse_chapter_html, parse_title_chapter_list_html


class OrParseTests(unittest.TestCase):
    def test_parses_bold_body_headings_and_spans(self):
        html = """<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body>
<p>Chapter 12 \u0097 Limitations of Actions</p>
<p>12.010 TOC heading, not a bold body heading</p>
<p><b>12.010 First published text.</b> First version of the section.</p>
<p>New sections were added to this chapter in the 2026 regular session.</p>
<p><b>12.010 Second operative version.</b> A separate source block using the same citation.</p>
<p><b>12.020 Next section.</b> Next section text.</p>
</body></html>"""
        raw = html.encode("latin1")
        parsed = parse_chapter_html(raw, "12")
        self.assertEqual(parsed["encoding"], "windows-1252")
        self.assertEqual(
            [section["citation"] for section in parsed["sections"]],
            ["ORS 12.010", "ORS 12.010", "ORS 12.020"],
        )
        self.assertEqual(parsed["sections"][0]["chapter_title"], "Limitations of Actions")
        self.assertRegex(parsed["sections"][0]["text"], r"New sections were added")
        self.assertRegex(parsed["sections"][1]["text"], r"Second operative version")
        for section in parsed["sections"]:
            source = raw[section["source_span"]["byte_start"] : section["source_span"]["byte_end"]].decode(
                "latin1"
            )
            self.assertRegex(source, r"<b>12\.0")

    def test_title_chapter_list(self):
        html = """<meta charset="windows-1252">
<p>TITLE 16</p><p>CRIMES AND PUNISHMENTS</p>
<p>Chapter 161. General Provisions</p><p>162. Offenses Against the State</p>
<p>163. Offenses Against Persons</p><p>163A. Sex Offender Reporting</p>
<p>164. Offenses Against Property</p><p>____________________</p>
<p>Chapter 161 \x97 General Provisions</p><p>161.005 Short title</p>"""
        parsed = parse_title_chapter_list_html(html.encode("latin1"))
        self.assertEqual(parsed["title_number"], "16")
        self.assertEqual(
            [chapter["chapter"] for chapter in parsed["chapters"]],
            ["161", "162", "163", "163A", "164"],
        )

    def test_rejects_missing_charset(self):
        with self.assertRaisesRegex(ValueError, "charset"):
            parse_chapter_html(b"<p><b>12.010 Title</b></p>", "12")


if __name__ == "__main__":
    unittest.main()
