"""Unit tests for Alaska Statutes HTML parsing."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from parse import ak_fragment_text, parse_chapter_html, section_anchors_in_page  # noqa: E402

FIXTURE = b"""<div class="statute"><b><a name="01.05"> </a><h6>Chapter 05. Alaska Statutes.<BR></h6></b><b><a name="01.05.006"> </a>Sec. 01.05.006.   Adoption of Alaska Statutes; notes, headings, and references not law. <BR></b>The bulk formal revision of the laws of Alaska which was authorized by AS 24.20.070.<BR><BR></p>
<b><a name="01.05.010"> </a>Sec. 01.05.010.   Adoption of revision. [Repealed, \\u00a7 2 ch 1 SLA 1963.] <BR></b><b><a name="01.05.011"> </a>Sec. 01.05.011.   Designation and citation. <BR></b>The bulk formal revision of Alaska law adopted and enacted into law by AS 01.05.006.<BR><BR></div>"""

SECS_FIXTURE = (
    b'<div class="statute"><b><a name="02.10"> </a><h6>Chapter 10. X<BR></h6></b>'
    b'<b><a name="02.10.020"> </a>Secs. 02.10.020  , 02.10.030.    Investigations and hearings. '
    b'[Repealed, \xa7 14 ch 56 SLA 2001.] <BR></b>'
    b'<b><a name="02.10.040"> </a>Sec. 02.10.040.   Regulations. <BR></b>Body here.<BR></div>'
)

LETTER_FIXTURE = (
    b'<div class="statute"><b><a name="05.15.020a"> </a>Sec. 05.15.020a.   Supplemental heading. <BR></b>'
    b"Text with \x93smart\x94 quotes.<BR></div>"
)


class TestAkParse(unittest.TestCase):
    def test_fragment_preserves_subsections(self):
        t = ak_fragment_text("&nbsp;(a) First line<BR>&nbsp;(b) Second")
        self.assertIn("(a) First line", t)
        self.assertIn("(b) Second", t)

    def test_parse_chapter_sections(self):
        heading, secs, _co, anchors = parse_chapter_html(FIXTURE, "01.05", "http://example", "abc")
        self.assertIn("Chapter 05", heading or "")
        self.assertEqual(len(secs), 3)
        self.assertEqual(anchors, ["01.05.006", "01.05.010", "01.05.011"])
        self.assertEqual(secs[0]["anchor"], "01.05.006")
        self.assertIn("bulk formal revision", secs[0]["text"])
        self.assertIn("Repealed", secs[1]["status_label"] or "")

    def test_secs_combined_line(self):
        _, secs, _, anchors = parse_chapter_html(SECS_FIXTURE, "02.10", "http://example", "abc")
        self.assertEqual(anchors, ["02.10.020", "02.10.040"])
        self.assertEqual(len(secs), 2)
        self.assertEqual(secs[0]["anchor"], "02.10.020")
        self.assertIn("Secs. 02.10.020", secs[0]["text"])
        self.assertIn("02.10.030", secs[0]["text"])
        self.assertIn("Repealed", secs[0]["status_label"] or "")

    def test_letter_suffix_anchor(self):
        _, secs, _, anchors = parse_chapter_html(LETTER_FIXTURE, "05.15", "http://example", "abc")
        self.assertEqual(anchors, ["05.15.020a"])
        self.assertEqual(secs[0]["anchor"], "05.15.020a")
        self.assertIn("\u201c", secs[0]["text"])
        self.assertNotIn("\ufffd", secs[0]["text"])


if __name__ == "__main__":
    unittest.main()
