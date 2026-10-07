import pathlib
import unittest

from parse import parse_page, toc_entries
from bs4 import BeautifulSoup

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "abp-101.html"
URL = "https://www.nysenate.gov/legislation/laws/ABP/101"

CONTAINER = """<div class="nys-openleg-statute-container"><div class="nys-openleg-result-container">
<h2 class="nys-openleg-result-title-headline">ARTICLE 9</h2><h3 class="nys-openleg-result-title-short">Markup only</h3>
<div class="nys-openleg-history-published">Viewing most recent revision (from 2020-01-03)</div>
<ul class="nys-openleg-items-container">
<li class="nys-openleg-result-item-container"><a href="/legislation/laws/XYZ/9-A/">SECTION 9-A Example</a></li>
<li class="nys-openleg-result-item-container"><a href="https://www.nysenate.gov/legislation/laws/XYZ/R9#x">RULE 9 Example</a></li>
<li class="nys-openleg-result-item-container"><a href="https://www.nysenate.gov/legislation/laws/XYZ/A9T1">TITLE 1 Example</a></li>
</ul></div></div>"""


class ParseSectionTest(unittest.TestCase):
    def test_section_keeps_publisher_revision_text_and_line_breaks(self):
        page = parse_page(FIXTURE.read_text(encoding="utf8"), URL)
        self.assertTrue(page["leaf"])
        self.assertEqual((page["law"], page["node"], page["type"], page["number"]), ("ABP", "101", "SECTION", "101"))
        self.assertEqual(page["heading"], "Short title")
        self.assertEqual(page["currency_statement"], "Viewing most recent revision (from 2014-09-22)")
        self.assertEqual(page["revision_date"], "2014-09-22")
        self.assertEqual(page["text_blocks"], 1)
        self.assertEqual(page["text"], '§ 101. Short title. This chapter shall be known and may be cited as\nthe "Abandoned Property Law."')

    def test_container_lists_printed_entries_in_order(self):
        url = "https://www.nysenate.gov/legislation/laws/XYZ/A9"
        page = parse_page(CONTAINER, url)
        self.assertFalse(page["leaf"])
        self.assertTrue(page["statute_page"])
        self.assertEqual([(u.rsplit("/", 1)[1], w) for u, _l, w in page["toc"]], [("9-A", "SECTION"), ("R9", "RULE"), ("A9T1", "TITLE")])
        self.assertEqual(toc_entries(BeautifulSoup("<p>none</p>", "lxml")), [])

    def test_not_found_page(self):
        page = parse_page('<div class="nys-openleg-statute-container">The requested entry could not be found.</div>',
                          "https://www.nysenate.gov/legislation/laws/XYZ/T3")
        self.assertTrue(page["not_found"])
        self.assertFalse(page["leaf"])


if __name__ == "__main__":
    unittest.main()
