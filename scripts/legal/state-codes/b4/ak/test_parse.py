"""Unit tests for Alaska Statutes HTML parsing."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from parse import ak_fragment_text, parse_chapter_html  # noqa: E402

FIXTURE = b"""<div class="statute"><b><a name="01.05"> </a><h6>Chapter 05. Alaska Statutes.<BR></h6></b><b><a name="01.05.006"> </a>Sec. 01.05.006.   Adoption of Alaska Statutes; notes, headings, and references not law. <BR></b>The bulk formal revision of the laws of Alaska which was authorized by AS 24.20.070.<BR><BR></p>
<b><a name="01.05.010"> </a>Sec. 01.05.010.   Adoption of revision. [Repealed, \\u00a7 2 ch 1 SLA 1963.] <BR></b><b><a name="01.05.011"> </a>Sec. 01.05.011.   Designation and citation. <BR></b>The bulk formal revision of Alaska law adopted and enacted into law by AS 01.05.006.<BR><BR></div>"""


class TestAkParse(unittest.TestCase):
    def test_fragment_preserves_subsections(self):
        t = ak_fragment_text("&nbsp;(a) First line<BR>&nbsp;(b) Second")
        self.assertIn("(a) First line", t)
        self.assertIn("(b) Second", t)

    def test_parse_chapter_sections(self):
        heading, secs, _co = parse_chapter_html(FIXTURE, "01.05", "http://example", "abc")
        self.assertIn("Chapter 05", heading or "")
        self.assertEqual(len(secs), 3)
        self.assertEqual(secs[0]["number"], "01.05.006")
        self.assertIn("bulk formal revision", secs[0]["text"])
        self.assertEqual(secs[1]["number"], "01.05.010")
        self.assertIn("Repealed", secs[1]["status_label"] or "")
        self.assertEqual(secs[2]["number"], "01.05.011")


if __name__ == "__main__":
    unittest.main()
