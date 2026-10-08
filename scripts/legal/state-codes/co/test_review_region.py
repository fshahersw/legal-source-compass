import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import review_region  # noqa: E402

URL = "https://olls.info/crs/crs2026-title-00.htm"
FULL = pathlib.Path(os.environ.get("CO_CONSTITUTION_FIXTURE", "/tmp/co-title-00.htm"))


class COReviewRegion(unittest.TestCase):
    @unittest.skipUnless(FULL.is_file(), f"constitution fixture missing: {FULL}")
    def test_constitution_xxix_13_not_first_section_13_on_page(self):
        raw = FULL.read_bytes()
        row = review_region.section_row_from_title_html(raw, URL, "XXIX-13", {"hierarchy": [{"number": "XXIX-13"}]})
        self.assertIsNotNone(row)
        self.assertIn("election", (row.get("heading") or "").lower())
        self.assertNotIn("bear arms", (row.get("text") or "").lower())


if __name__ == "__main__":
    unittest.main()
