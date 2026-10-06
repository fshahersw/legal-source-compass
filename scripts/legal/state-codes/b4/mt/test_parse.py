import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("mt_parse", ROOT / "parse.py")
mt_parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt_parse)

FIXTURE = """
<h4 class="section-title-title">TITLE 1. GENERAL LAWS AND DEFINITIONS</h4>
<h3 class="section-chapter-title">CHAPTER 1. GENERAL PROVISIONS</h3>
<h2 class="section-part-title">Part 1. Meaning of Law</h2>
<h1 class="section-section-title">Definition Of Law</h1>
<div class="section-doc" id="mca_0010-0010-0010-0010">
  <div class="section-content">
    <p class="line-indent">
      <span class="catchline"><span class="citation">1-1-101</span>. Definition of law.</span>
      "Law" is a solemn expression of the will of the supreme power of the state.
    </p>
  </div>
</div>
<div class="history-doc" id="mca_0010-0010-0010-0010_hist">
  <div class="history-content">
    <p class="line-indent">
      <span class="header">History:</span> En. Sec. 5150, Pol. C. 1895.
    </p>
  </div>
</div>
"""

URL = (
    "https://mca.legmt.gov/bills/mca/title_0010/chapter_0010/part_0010/"
    "section_0010/0010-0010-0010-0010.html"
)
REC = {"sha256": "abc123" * 10 + "abcd"}


class MontanaParseTest(unittest.TestCase):
    def test_section_fields(self):
        row = mt_parse.parse_section_page(FIXTURE, URL, REC)
        self.assertEqual(row["citation"], "1-1-101")
        self.assertIn("solemn expression", row["body"])
        self.assertTrue(row["history"] and "History:" in row["history"])
        self.assertEqual(row["hierarchy"][-1]["level"], "section")


if __name__ == "__main__":
    unittest.main()
