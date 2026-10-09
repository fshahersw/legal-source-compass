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



class LetteredUccArticleTest(unittest.TestCase):
    """Synthetic bodies; citation/layout cases independently observed in official Title 34.1."""
    def parse(self, text):
        return parse_title_text(text, title_key="34.1", title_label="Uniform Commercial Code",
                                source_url="https://wyoleg.gov/statutes/compress/title34.1.pdf",
                                receipt_sha="synthetic-test-only")

    def test_lettered_articles_are_sections_not_tail_of_sales_limitation(self):
        text = """TITLE 34.1 - UNIFORM COMMERCIAL CODE
ARTICLE 2 - SALES
34.1-2-725. Statute of limitations in contracts for sale.

(a) Synthetic sales limitations body.
ARTICLE 2.A - LEASES
PART 1. GENERAL PROVISIONS
34.1-2.A-101. Short title.

Synthetic lease section, not part of the sales limitation.
34.1-2.A-102. Scope.

Synthetic second lease section.
REVISED ARTICLE 3 - NEGOTIABLE INSTRUMENTS
34.1-3-101. Short title.

Synthetic negotiable instruments body.
ARTICLE 4A - FUNDS TRANSFERS
34.1-4A-101. Short title.

Synthetic transfer body.
"""
        expected = ["34.1-2-725", "34.1-2.A-101", "34.1-2.A-102", "34.1-3-101", "34.1-4A-101"]
        chapters, sections, paths = self.parse(text)
        self.assertEqual(paths, expected)
        self.assertEqual(toc_citation_paths(text, "34.1"), expected)
        first = sections[0]
        unit = next(c for c in chapters if c["native_id"] == first["chapter_native_id"])
        fragment = unit["text"][first["start"]:first["end"]]
        self.assertNotIn("Synthetic lease", fragment)
        self.assertNotIn("34.1-2.A-101", fragment)
        article = next(h for h in sections[1]["hierarchy"] if h["level"] == "article")
        self.assertEqual(article["number"], "2.A")
        self.assertEqual(article["heading"], "LEASES")
        self.assertFalse(any(h["level"] == "chapter" for h in sections[1]["hierarchy"]))
        self.assertEqual(next(h for h in sections[3]["hierarchy"] if h["level"] == "article")["number"], "3")

    def test_lettered_sections_do_not_change_embedded_decimal_act_policy(self):
        text = "TITLE 1 - X\nCHAPTER 1 - Y\n" + SKI_BLOCK
        self.assertEqual(toc_citation_paths(text, "01"), ["1-1-123", "1-1-124"])


if __name__ == "__main__":
    unittest.main()
