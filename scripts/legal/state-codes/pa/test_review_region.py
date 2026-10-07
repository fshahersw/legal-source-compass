import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse  # noqa: E402
import review_region  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parent / "fixtures"


class PalegisReviewRegion(unittest.TestCase):
    def test_section_body_matches_parser_slice(self):
        document = (FIX / "title-01-excerpt.html").read_text(encoding="utf8")
        lines = review_region.section_body_lines(document, "1:101")
        self.assertIsNotNone(lines)
        parsed = parse.parse_title(document, "01")
        sec = parsed["sections"][0]
        self.assertEqual(lines, parsed["lines"][sec["first"] : sec["last"]])

    def test_annotation_lines_excused(self):
        self.assertTrue(review_region.is_publisher_annotation_line("Cross References. Section 3543 is referred to in section 3545 of this title."))
        self.assertTrue(review_region.is_publisher_annotation_line("(Dec. 10, 1974, P.L.816, No.271, eff. imd.)"))
        self.assertTrue(review_region.is_publisher_annotation_line("1974 Amendment. Act 82 provided that Act 82 shall take effect 30 days"))
        self.assertFalse(review_region.is_publisher_annotation_line("§ 101. Short title."))


if __name__ == "__main__":
    unittest.main()
