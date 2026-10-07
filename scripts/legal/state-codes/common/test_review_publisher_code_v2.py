import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review_publisher_code_v2 import (  # noqa: E402
    _stored_covers_live_line,
    live_lines,
    ordered_siblings,
    reverse_check,
    site_chrome,
)

PAGE = (b"<html><body><div id='nav'>Home | Search</div><div id='va_code'>"
        b"<b>\xc2\xa7 8.9A-322. Priorities.</b><p>(a) General rule. First text.</p><p>(c) Proceeds rule.</p>"
        b"(d) First-to-file priority rule for certain collateral.<p>(e) Applicability.</p><p>2000, c. 1007.</p>"
        b"<b>\xc2\xa7 8.9A-323. Future advances.</b><p>(a) When priority depends.</p>"
        b"<table><tr><td>Population</td><td>Salary</td></tr><tr><td>200,000 and over</td><td>$15,000</td></tr></table>"
        b"<p>2001, c. 2.</p>"
        b"<b>\xc2\xa7 8.9A-324. (Effective until July 1, 2027) Purchase-money.</b><p>(a) Old version.</p>"
        b"<b>\xc2\xa7 8.9A-324. (Effective July 1, 2027) Purchase-money.</b><p>(a) New version with more words.</p>"
        b"<b>\xc2\xa7 8.9A-325. Last.</b><p>Only text.</p></div><div id='foot'>Contact the clerk</div></body></html>")


def row(path, heading, text, history=None, start=None):
    return {"unit_key": "title8.9A", "citation_path": path, "citation": "Va. Code \u00a7 " + path, "heading": heading,
            "text": text, "history": history, "status_note": None,
            "hierarchy": [{"level": "title", "number": "8.9A", "heading": "Commercial Code"}, {"level": "section", "number": path, "heading": heading}],
            "currency": {"basis": "publisher_statement", "statement": "Code of Virginia", "through_date": None, "edition": None},
            "span": None if start is None else {"unit": "unicode_code_points", "start": start, "end": start + len(text)}}


class ReverseCheck(unittest.TestCase):
    def setUp(self):
        self.lines = live_lines(PAGE, "https://law.lis.virginia.gov/vacodefull/title8.9A/")
        self.later = [row("8.9A-323", "Future advances.", "(a) When priority depends.\nPopulation Salary 200,000 and over $15,000\n2001, c. 2."),
                      row("8.9A-324", "(Effective until July 1, 2027) Purchase-money.", "(a) Old version."),
                      row("8.9A-325", "Last.", "Only text.")]

    def test_table_cells_and_bare_text_are_lines(self):
        self.assertIn("(d) First-to-file priority rule for certain collateral.", self.lines)
        self.assertIn("$15,000", self.lines)

    def test_complete_row_passes(self):
        full = row("8.9A-322", "Priorities.", "(a) General rule. First text.\n(c) Proceeds rule.\n"
                   "(d) First-to-file priority rule for certain collateral.\n(e) Applicability.\n2000, c. 1007.")
        self.assertTrue(reverse_check(self.lines, full, self.later)["ok"])

    def test_missing_bare_paragraph_fails(self):
        trailing = row("8.9A-322", "Priorities.", "(a) General rule. First text.\n(c) Proceeds rule.")
        result = reverse_check(self.lines, trailing, self.later)
        self.assertFalse(result["ok"])
        self.assertTrue(any("First-to-file" in m for m in result["missing"]))

    def test_missing_table_fails(self):
        no_table = row("8.9A-323", "Future advances.", "(a) When priority depends.")
        result = reverse_check(self.lines, no_table, self.later[1:])
        self.assertFalse(result["ok"])
        self.assertTrue(any("Population" in m or "15,000" in m for m in result["missing"]))

    def test_unstored_second_version_fails(self):
        only_first = row("8.9A-324", "(Effective until July 1, 2027) Purchase-money.", "(a) Old version.")
        result = reverse_check(self.lines, only_first, [self.later[2]])
        self.assertFalse(result["ok"])
        self.assertTrue(any("New version" in m for m in result["missing"]))

    def test_stored_second_version_bounds_the_first(self):
        first = row("8.9A-324", "(Effective until July 1, 2027) Purchase-money.", "(a) Old version.")
        second = row("8.9A-324:occurrence:2", "(Effective July 1, 2027) Purchase-money.", "(a) New version with more words.")
        self.assertTrue(reverse_check(self.lines, first, [second, self.later[2]])["ok"])

    def test_last_section_uses_shared_chrome(self):
        last = row("8.9A-325", "Last.", "Only text.")
        self.assertFalse(reverse_check(self.lines, last, [])["ok"])
        other = live_lines(b"<html><div id='nav'>Home | Search</div><p>x</p><div id='foot'>Contact the clerk</div></html>",
                           "https://law.lis.virginia.gov/vacodefull/title1/")
        chrome = site_chrome({"https://law.lis.virginia.gov/vacodefull/title8.9A/": self.lines,
                              "https://law.lis.virginia.gov/vacodefull/title1/": other})["law.lis.virginia.gov"]
        result = reverse_check(self.lines, last, [], chrome)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["excused_chrome"], 1)

    def test_notes_after_history_are_not_section_text(self):
        page = (b"<html><body><p>631.83 Fire insurance. (1) Coverage text.</p><p>History: 1975 c. 375.</p>"
                b"<p>The term fire insurance covers indemnity. Villa Clement v. Union, 120 Wis. 2d 140.</p>"
                b"<p>631.85 Next section. Next text here for the following section.</p></body></html>")
        lines = live_lines(page, "https://docs.legis.wisconsin.gov/statutes/statutes/631.txt")
        r = row("631.83", "Fire insurance.", "(1) Coverage text.", history="History: 1975 c. 375.")
        nxt = row("631.85", "Next section.", "Next text here for the following section.")
        self.assertTrue(reverse_check(lines, r, [nxt])["ok"])

    def test_unstored_second_version_after_history_fails(self):
        page = (b"<html><body><b>\xc2\xa7 8.9A-324. (Effective until July 1, 2027) Purchase-money.</b><p>(a) Old version.</p>"
                b"<p>2000, c. 1007.</p><b>\xc2\xa7 8.9A-324. (Effective July 1, 2027) Purchase-money.</b>"
                b"<p>(a) New version with more words.</p><p>2026, c. 5.</p><b>\xc2\xa7 8.9A-325. Last.</b><p>Only text.</p></body></html>")
        lines = live_lines(page, "https://law.lis.virginia.gov/vacodefull/title8.9A/")
        first = row("8.9A-324", "(Effective until July 1, 2027) Purchase-money.", "(a) Old version.", history="2000, c. 1007.")
        result = reverse_check(lines, first, [row("8.9A-325", "Last.", "Only text.")])
        self.assertFalse(result["ok"])
        self.assertTrue(any("New version" in m for m in result["missing"]))

    def test_siblings_by_span(self):
        rows = [row("a", "A.", "aaa", start=0), row("b", "B.", "bbb", start=10), row("c", "C.", "ccc", start=20)]
        self.assertEqual([x["citation_path"] for x in ordered_siblings(rows[0], rows)], ["b", "c"])
        rows[2]["span"] = None
        self.assertEqual(len(ordered_siblings(rows[0], rows)), 2)

    def test_body_and_history_on_one_live_line(self):
        r = row(
            "12-101",
            "Heading.",
            "The board shall implement a citywide reappraisal.",
            history="(Added 2013, No. 26, § 1, eff. May 13, 2013.)",
        )
        live_line = "The board shall implement a citywide reappraisal. (Added 2013, No. 26, § 1, eff. May 13, 2013.)"
        self.assertTrue(_stored_covers_live_line(live_line, r))


if __name__ == "__main__":
    unittest.main()
