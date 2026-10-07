"""Unit tests for Wyoming PDF text parsing."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wy_parse import parse_title_text, toc_citation_paths  # noqa: E402

SKI_BLOCK = """
     1-1-123.   Assumption of risk.

     (a) Any person who takes part in any sport or recreational
opportunity assumes the inherent risks in that sport or
recreational opportunity, whether those risks are known or
unknown, and is legally responsible for any and all damage,
injury or death to himself or other persons or property that
results from the inherent risks in that sport or recreational
opportunity.

     (e) This act shall not apply to skiing in a ski area as
defined by the Ski Safety Act.

     1-1-123.1.    Ski Safety Act; short title.

This act shall be known and may be cited as the "Ski Safety
Act."

     1-1-123.2.    Definitions.

     (a)   As used in this act:

          (i) "Freestyle terrain" includes terrain parks;

     1-1-124.   Next section heading.
"""

FIXTURE = """
                TITLE 1 - CODE OF CIVIL PROCEDURE

               CHAPTER 1 - GENERAL PROVISIONS

    32-3-101.   Wrong title prefix ignored.

    1-1-101.   Provisions to be liberally construed.

Body of 1-1-101.

    1-1-102.   Repealed by Laws 2021, ch. 27, § 3.
"""


class WyParseTest(unittest.TestCase):
    def test_ski_safety_stays_inside_1_1_123(self):
        text = "TITLE 1 - X\nCHAPTER 1 - Y\n" + SKI_BLOCK
        toc = toc_citation_paths(text, "01")
        self.assertEqual(toc, ["1-1-123", "1-1-124"])
        chs, secs, paths = parse_title_text(
            text,
            title_key="01",
            title_label="Title 1",
            source_url="https://wyoleg.gov/statutes/compress/title01.pdf",
            receipt_sha="abc",
        )
        self.assertEqual(paths, toc)
        one = [s for s in secs if s["citation_path"] == "1-1-123"][0]
        ch = next(c for c in chs if c["native_id"] == "1-1")
        frag = ch["text"][one["start"] : one["end"]]
        self.assertIn("Ski Safety Act", frag)
        self.assertIn("1-1-123.1.", frag)
        self.assertIn("1-1-123.2.", frag)
        self.assertNotIn("1-1-123:2", [s["citation_path"] for s in secs])

    def test_inventory_and_repealed(self):
        ids = toc_citation_paths(FIXTURE, "01")
        self.assertEqual(ids, ["1-1-101", "1-1-102"])
        chs, secs, paths = parse_title_text(
            FIXTURE,
            title_key="01",
            title_label="Title 1",
            source_url="https://wyoleg.gov/statutes/compress/title01.pdf",
            receipt_sha="abc",
        )
        self.assertEqual(paths, ids)
        by = {s["citation_path"]: s for s in secs}
        self.assertIn("Repealed", by["1-1-102"]["status_label"])

    def test_constitution_article(self):
        text = """
                TITLE 97 - WYOMING CONSTITUTION

               ARTICLE 1 - DECLARATION OF RIGHTS

    Article 1, Section 1   Power inherent in the people.

All power is inherent in the people.
"""
        toc = toc_citation_paths(text, "97")
        chs, secs, paths = parse_title_text(
            text,
            title_key="97",
            title_label="Constitution",
            source_url="https://wyoleg.gov/statutes/compress/title97.pdf",
            receipt_sha="def",
        )
        self.assertEqual(paths, toc)
        self.assertEqual(secs[0]["citation"], "Article 1, Section 1")


if __name__ == "__main__":
    unittest.main()
