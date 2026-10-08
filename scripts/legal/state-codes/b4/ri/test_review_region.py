import os
import unittest

from review_region import section_row_from_html

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


class RIReviewRegion(unittest.TestCase):
    def test_repealed_combined_citation_10_5_3(self):
        raw = open(os.path.join(FIX, "10-5-3.htm"), "rb").read()
        row = section_row_from_html(
            raw,
            "https://webserver.rilegislature.gov/Statutes/TITLE10/10-5/10-5-3.htm",
            "10-5-3",
            {"citation": "§ 10-5-3."},
        )
        self.assertIsNotNone(row)
        self.assertIn("Repealed", row["text"])
        self.assertIn("10-5-4", row["text"])


if __name__ == "__main__":
    unittest.main()
