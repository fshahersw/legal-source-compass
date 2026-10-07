import re
import unittest

from md_lib import SECTION_ID_REGEX, citation_path, normalize_section_number, parse_statute_html

SAMPLE = """
<div id="StatuteText">
<div style="text-align: center;"><span style="font-weight: bold;">Article - Economic Development</span></div><br/>
§5–409. <br/><br/> (a) Body text here.
</div>
"""

CONSTITUTION = """
<div id="StatuteText">
<div style="text-align: center;"><span style="font-weight: bold;">Article - I - Elective Franchise</span></div><br/>
§6. <br/><br/> Body for section six.
</div>
"""


class MdParseTest(unittest.TestCase):
    def test_normalize_section_number(self):
        self.assertEqual(normalize_section_number("5\u2013409"), "5-409")

    def test_parse_statute_html(self):
        parsed = parse_statute_html(SAMPLE)
        self.assertEqual(parsed["section_number"], "5-409")
        self.assertIn("Body text", parsed["text"])

    def test_citation_path(self):
        self.assertEqual(citation_path("gcr", "2-101"), "gcr 2-101")

    def test_section_id_regex_allows_single_digit_sections(self):
        pattern = re.compile(SECTION_ID_REGEX)
        self.assertTrue(pattern.fullmatch("c0 1"))
        self.assertTrue(pattern.fullmatch("gcr 2-101"))

    def test_constitution_section_number(self):
        parsed = parse_statute_html(CONSTITUTION)
        self.assertEqual(parsed["section_number"], "6")


if __name__ == "__main__":
    unittest.main()
