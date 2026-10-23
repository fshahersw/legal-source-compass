"""Tests of the 10-K legal-proceedings text rules (no network).  python3 -I -B scripts/api_law/edgar/test_edgar_text.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edgar_text as E  # noqa: E402

DOC = b"""<html><body><div>PART I</div>
<table><tr><td>Item 3.</td><td>Legal Proceedings</td><td>18</td></tr><tr><td>Item 4.</td><td>Mine Safety</td></tr></table>
<p>Item 3. Legal Proceedings</p><p>The information called for by this item is incorporated by reference to Note 19 and Notes 20 and 21 of the Notes.</p>
<p>ITEM 4. MINE SAFETY DISCLOSURES</p><p>Not applicable.</p>
<p>18. Debt</p><p>Debt text.</p>
<p>19. Legal proceedings</p><p>The Company is a defendant in In re: Example Products Liability Litigation, MDL No. 2738, and in 3:16-md-02846 &amp; others &ndash; as written.</p><p>""" + b"Further description of the proceedings. " * 10 + b"""</p>
<p>20. Restructuring</p><p>Restructuring text.</p>
<p>NOTE 21&mdash;Commitments and contingencies:</p><p>b.</p><p>Contingencies:</p><p>Contingency text that is long enough.</p><p>c.</p><p>Leases</p>
<p>NOTE 22 - Equity</p><script>var x = "Item 3. Legal Proceedings";</script></body></html>"""


class Tests(unittest.TestCase):
    def setUp(self):
        self.t = E.render(DOC)

    def test_render_keeps_characters_and_lines(self):
        self.assertIn("in 3:16-md-02846 & others – as written.", self.t)
        self.assertNotIn("var x", self.t)
        self.assertIn("NOTE 21—Commitments and contingencies:", self.t)

    def test_item3_is_the_longest_heading_section(self):
        heading, a, b = E.item3(self.t)
        sec = self.t[a:b]
        self.assertTrue(sec.startswith("Item 3. Legal Proceedings\nThe information"))
        self.assertTrue(self.t[b:].startswith("ITEM 4. MINE SAFETY"))
        self.assertEqual(E.note_numbers(sec), ["19", "20", "21"])

    def test_note_sections_end_at_the_next_note(self):
        h, a, b = E.note_section(self.t, "19")
        self.assertEqual(h, "19. Legal proceedings")
        self.assertTrue(self.t[b:].startswith("20. Restructuring"))
        h, a, b = E.note_section(self.t, "21")
        self.assertEqual(h, "NOTE 21—Commitments and contingencies:")
        self.assertTrue(self.t[b:].startswith("NOTE 22 - Equity"))

    def test_lettered_sub_note(self):
        h, a, b = E.note_section(self.t, "21b")
        self.assertEqual(h, "b. Contingencies:")
        self.assertTrue(self.t[b:].startswith("c."))

    def test_mdl_mentions_are_spans(self):
        h, a, b = E.note_section(self.t, "19")
        sec = self.t[a:b]
        ms = E.mdl_mentions(sec)
        self.assertEqual([(m["as_written"], m["mdl_number"]) for m in ms], [("MDL No. 2738", 2738), ("3:16-md-02846", 2846)])
        for m in ms:
            self.assertEqual(sec[m["offset"]:m["offset"] + len(m["as_written"])], m["as_written"])

    def test_titled_notes(self):
        labels = [x[0] for x in E.titled_notes(self.t)]
        self.assertIn("19", labels)


if __name__ == "__main__":
    unittest.main()
