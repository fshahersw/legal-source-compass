import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from va_parse import count_section_markers, count_section_versions, parse_title  # noqa: E402

PAGE = """<html><body><div id="va_code"><h2>Title 8.9A. Commercial Code</h2><h3>Chapter 3. Perfection and Priority.</h3>
<b>\u00a7 8.9A-322. Priorities.</b><p>(a) General rule.</p><p>(c) Proceeds rule.</p>(d) First-to-file rule under \u00a7 <a href='/vacode/8.9A-203/'>8.9A-203</a>. For purposes.
<p>(e) Applicability.</p><p>2000, c. 1007.</p>
<b>\u00a7 8.9A-323. Salaries.</b><p>Boards may set salaries not to exceed:</p><table><tr><td class="hiddenTable">a</td><td>Population</td><td>Annual Salary</td></tr>
<tr><td class="hiddenTable">b</td><td>200,000 and over</td><td>$15,000</td></tr></table><p>1984, c. 221.</p>
<b>\u00a7 8.9A-324. (Effective until July 1, 2027) Purchase-money.</b><p>(a) Old version.</p><p>2001, c. 5.</p>
<b>\u00a7 8.9A-324. (Effective July 1, 2027) Purchase-money.</b><p>(a) New version.</p><p>2026, c. 7.</p>
<b>\u00a7\u00a7 8.9A-325, 8.9A-326. Repealed.</b><p>Repealed by Acts 2001, c. 1.</p>
<b>\u00a7 8.9A-326.1:01. Colon section.</b><p>Colon body text.</p>
</div></body></html>"""
ORDERED = ["8.9A-322", "8.9A-323", "8.9A-324", "8.9A-325", "8.9A-326", "8.9A-326.1:01"]
RECEIPT = {"url": "https://law.lis.virginia.gov/vacodefull/title8.9A/", "sha256": "0" * 64}


class ParseTitle(unittest.TestCase):
    def setUp(self):
        self.rows, self.inventory, self.report, self.derivative = parse_title(PAGE, "8.9A", RECEIPT, ORDERED, {})
        self.by_id = {r["native_id"]: r for r in self.rows}

    def test_text_outside_paragraphs_is_kept_with_inline_links(self):
        text = self.by_id["8.9A-322"]["text"]
        self.assertIn("(d) First-to-file rule under \u00a7 8.9A-203. For purposes.", text)
        self.assertLess(text.index("(c) Proceeds"), text.index("(d) First-to-file"))
        self.assertLess(text.index("(d) First-to-file"), text.index("(e) Applicability"))
        self.assertTrue(text.endswith("(e) Applicability.\n2000, c. 1007."))

    def test_table_cells_are_kept(self):
        text = self.by_id["8.9A-323"]["text"]
        self.assertIn("Population\tAnnual Salary\n200,000 and over\t$15,000", text)

    def test_every_version_is_kept(self):
        first, second = self.by_id["8.9A-324"], self.by_id["8.9A-324:occurrence:2"]
        self.assertEqual((first["occurrence"], second["occurrence"]), (1, 2))
        self.assertEqual(first["text"], "(a) Old version.\n2001, c. 5.")
        self.assertEqual(second["text"], "(a) New version.\n2026, c. 7.")
        self.assertEqual(second["citation"], "8.9A-324")
        self.assertTrue(second["heading"].startswith("(Effective July 1, 2027)"))
        self.assertEqual(second["citation_path"][-1]["heading"], second["heading"])

    def test_colon_numbered_section_is_its_own_section(self):
        row = self.by_id["8.9A-326.1:01"]
        self.assertEqual((row["heading"], row["text"]), ("Colon section.", "Colon body text."))
        self.assertEqual(self.by_id["8.9A-326"]["text"], "Repealed by Acts 2001, c. 1.")

    def test_counts_and_spans(self):
        self.assertEqual(self.report["html_sections"], 6)
        self.assertEqual(self.report["html_versions"], 7)
        self.assertEqual(count_section_markers(PAGE, ORDERED), 6)
        self.assertEqual(count_section_versions(PAGE, ORDERED), 7)
        for r in self.rows:
            span = r["source"]["span"]
            if span:
                self.assertEqual(self.derivative[span["start"]:span["end"]], r["text"])


if __name__ == "__main__":
    unittest.main()
