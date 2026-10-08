import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import review_region  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parent / "fixtures"


class MiReviewRegion(unittest.TestCase):
    def test_section_row_from_chapter_fixture(self):
        raw = (FIX / "chapter-10-sample.xml").read_bytes()
        row = review_region.section_row_from_chapter(raw, "10.2")
        self.assertIsNotNone(row)
        self.assertIn("lieutenant governor", row["text"])
        self.assertIsNone(review_region.section_row_from_chapter(raw, "99.99"))


if __name__ == "__main__":
    unittest.main()
