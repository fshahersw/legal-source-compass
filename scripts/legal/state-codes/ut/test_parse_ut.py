import os
import unittest

from parse_ut import load_section, section_body, section_history  # noqa: E402

SAMPLE = b"""<section number="10-20-615"><effdate>11/6/2025</effdate><histories><history>Renumbered and Amended by Chapter <modchap sess="2025S1">15</modchap>, 2025 Special Session 1</history><modyear>2025</modyear></histories><catchline>Specified public utility located in a municipal utility easement.</catchline><tab/>A specified public utility may exercise each power of a public utility under Section <xref depth="3" refnumber="54-3-27">54-3-27</xref> if the specified public utility uses an easement:<subsection number="10-20-615(1)">with the consent of a municipality; and</subsection><subsection number="10-20-615(2)">that is located within a municipal utility easement described in Subsections <xref depth="4" refnumber="10-20-102(50)(a)">10-20-102(50)(a)</xref> through (e).</subsection></section>"""


class TestParseUt(unittest.TestCase):
    def test_section_body_and_history(self):
        root, _ = load_section(SAMPLE)
        body = section_body(root)
        self.assertIn("54-3-27", body)
        self.assertIn("(1) with the consent of a municipality", body)
        hist = section_history(root)
        self.assertIn("Renumbered and Amended", hist or "")
        self.assertNotIn("effdate", body.lower())


if __name__ == "__main__":
    unittest.main()
