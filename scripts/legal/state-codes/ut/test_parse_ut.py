import os
import unittest

from parse_ut import load_section, section_body, section_history  # noqa: E402

SAMPLE = b"""<section number="10-20-615"><effdate>11/6/2025</effdate><histories><history>Renumbered and Amended by Chapter <modchap sess="2025S1">15</modchap>, 2025 Special Session 1</history><modyear>2025</modyear></histories><catchline>Specified public utility located in a municipal utility easement.</catchline><tab/>A specified public utility may exercise each power of a public utility under Section <xref depth="3" refnumber="54-3-27">54-3-27</xref> if the specified public utility uses an easement:<subsection number="10-20-615(1)">with the consent of a municipality; and</subsection><subsection number="10-20-615(2)">that is located within a municipal utility easement described in Subsections <xref depth="4" refnumber="10-20-102(50)(a)">10-20-102(50)(a)</xref> through (e).</subsection></section>"""

NESTED = b"""<section number="41-6a-1639"><catchline>Hazardous materials.</catchline><subsection number="41-6a-1639(1)"><subsection number="41-6a-1639(1)(a)">Rulemaking.</subsection><subsection number="41-6a-1639(1)(b)">Adopt by reference.</subsection></subsection><subsection number="41-6a-1639(2)">Intro text:<subsection number="41-6a-1639(2)(a)">marked; and</subsection></subsection></section>"""

INLINE = b"""<section number="67-1a-12"><catchline>Authority to administer oaths.</catchline><tab/>The lieutenant governor and personnel employed under Section <xref refnumber="67-1a-3">67-1a-3</xref>, who are designated by the lieutenant governor, may administer oaths when necessary in the performance of official duties.</section>"""


class TestParseUt(unittest.TestCase):
    def test_section_body_and_history(self):
        root, _ = load_section(SAMPLE)
        body = section_body(root)
        self.assertIn("54-3-27", body)
        self.assertIn("(1) with the consent of a municipality", body)
        hist = section_history(root)
        self.assertIn("Renumbered and Amended", hist or "")
        self.assertNotIn("effdate", body.lower())

    def test_nested_subsection_lines(self):
        root, _ = load_section(NESTED)
        lines = section_body(root).splitlines()
        self.assertEqual(lines[0], "(1)")
        self.assertTrue(lines[1].startswith("(a)"))
        self.assertTrue(any(l.startswith("(2) Intro text:") for l in lines))

    def test_inline_xref_after_tab(self):
        root, _ = load_section(INLINE)
        body = section_body(root)
        self.assertIn("67-1a-3", body)
        self.assertIn("administer oaths", body)


if __name__ == "__main__":
    unittest.main()
