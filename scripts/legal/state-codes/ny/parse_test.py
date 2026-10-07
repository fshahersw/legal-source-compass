import pathlib
import unittest
from parse import parse_document

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "abp-101.html"
URL = "https://www.nysenate.gov/legislation/laws/ABP/101"


class ParseSectionTest(unittest.TestCase):
    def test_section_keeps_publisher_revision_and_text(self):
        parsed = parse_document(FIXTURE.read_text(encoding="utf8"), URL)
        self.assertEqual(parsed["kind"], "section")
        self.assertEqual(parsed["code"], "ABP")
        self.assertEqual(parsed["section"], "101")
        self.assertEqual(parsed["heading"], "Short title")
        self.assertEqual(parsed["currency_statement"], "Viewing most recent revision (from 2014-09-22)")
        self.assertEqual(parsed["revision_date"], "2014-09-22")
        self.assertIn('cited as the "Abandoned Property Law."', parsed["text"])
        self.assertTrue(parsed["text"].startswith("§ 101."))


if __name__ == "__main__":
    unittest.main()
