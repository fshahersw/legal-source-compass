"""Regression tests for the Kansas packet parser, on retained publisher bytes (fixtures/ = exact copies by sha256)."""
import hashlib, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
import build_packet as B

FX = os.path.join(os.path.dirname(__file__), "fixtures")
def page(n):
    return open(os.path.join(FX, n + ".html"), encoding="utf-8").read()


class ParserTests(unittest.TestCase):
    def test_fixtures_are_unmodified_publisher_bytes(self):
        for n, h in [("repealed_stub", "0d95a2b80736bdc1c8e6c904632401193fd672edb19646473f9bc6dd511212d2"),
                     ("empty_second_number", "050e3071b57bd371cc34f00aaf3dde4944e86b393dbcef4b07d78ebd7909783a")]:
            self.assertEqual(hashlib.sha256(open(os.path.join(FX, n + ".html"), "rb").read()).hexdigest(), h)

    def test_repealed_stub_without_ksa_stat_paragraph_is_parsed(self):
        p = B.parse_page(page("repealed_stub"))
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0]["citation"], "9-2101.")
        self.assertIn("Repealed, L. 2025, ch. 78, § 10", p[0]["history"])

    def test_text_stops_at_print_block(self):
        for n in ("repealed_stub", "empty_second_number"):
            t = "\n".join(B.parse_page(page(n))[0]["lines"])
            for junk in ("Previous", "LEGISLATIVE COORDINATING COUNCIL", "<!--", "Contact Us", "<div"):
                self.assertNotIn(junk, t)

    def test_empty_second_number_span_is_not_a_second_version(self):
        p = B.parse_page(page("empty_second_number"))
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0]["citation"], "21-5513.")
        self.assertEqual(p[0]["caption"], "Lewd and lascivious behavior.")
        self.assertTrue(p[0]["lines"][0].startswith("21-5513. Lewd and lascivious behavior. (a)"))

    def test_two_nonempty_numbers_are_two_versions(self):
        html = ('<div id="print"><div><p class="ksa_stat"><span class="stat_number">1-1.</span> A.</p>'
                '<p class="ksa_stat_hist"><span class="history">History:</span> L. 1.</p>'
                '<p class="ksa_stat"><span class="stat_number">1-1.</span> B.</p></div></div>')
        p = B.parse_page(html)
        self.assertEqual([x["lines"] for x in p], [["1-1. A.", "History: L. 1."], ["1-1. B."]])

    def test_reserved_range_paragraph_class(self):
        html = ('<div id="print"><div><p class="lm_stats_num_reserved"><span class="stat_number">79-15,147 through 79-15,200.'
                '</span><span class="stat_caption">Reserved.</span></p></div></div>')
        p = B.parse_page(html)
        self.assertEqual(p[0]["citation"], "79-15,147 through 79-15,200.")
        self.assertEqual(p[0]["caption"], "Reserved.")

    def test_tables_inside_print_are_kept_and_annotations_are_not(self):
        html = ('<div id="print"><div><p class="ksa_stat"><span class="stat_number">2-1.</span> Fees:</p>'
                '<table><tr><td class="ksa_center">Item</td><td>$5</td></tr></table>'
                '<p class="ksa_stat_8pt_center">Form A</p><p class="ksa_8pt_body">case note</p></div></div>')
        p = B.parse_page(html)
        self.assertEqual(p[0]["lines"], ["2-1. Fees:", "Item\t$5", "Form A", "case note"])

    def test_formula_div_and_lead_subheading(self):
        html = ('<div id="print"><div><p class="lm_ksa_art_subhead">TECHNICAL COLLEGES</p>'
                '<p class="ksa_stat"><span class="stat_number">16-205.</span> Rate:</p><div>R = 2mc</div><hr/></div></div>')
        lead, p = B.parse_page_full(html)
        self.assertEqual(lead, ["TECHNICAL COLLEGES"])
        self.assertEqual(p[0]["lines"], ["16-205. Rate:", "R = 2mc"])

    def test_change_list_wrapped_type(self):
        txt = ("59-2132           Am     2601    4   125                                     7/1/2026\n"
               "                  Rev\n"
               "59-2701                   480    2    89                                     4/23/2026\n"
               "                  & Am\n")
        ch = B.parse_change_text(txt)
        self.assertEqual(ch["59-2701"][0]["type"], "Rev & Am")
        self.assertEqual(ch["59-2132"][0]["type"], "Am")

    def test_change_list_alphanumeric_section(self):
        ch = B.parse_change_text("59-30a01 (Supp.)     New      84    1    77                                     7/1/2026\n")
        self.assertEqual(list(ch), ["59-30a01"])

    def test_change_list_rows(self):
        txt = ("                                    2026 COMPOSITE LIST (K.S.A. Order)\n"
               "                                              Table One\n"
               "1-202           Am     2573     1    80                                    4/23/2026\n"
               "8-1,141a        Rep    2001    14    12                                    7/1/2026\n"
               "21-6205a        New     104     3    55     2                              7/1/2026\n"
               "8-2110 (Supp.)   Rep    2029   26   155   3   As amended by § 2 of 2025 HB 2393     7/1/2026\n")
        ch = B.parse_change_text(txt)
        self.assertEqual(sorted(ch), ["1-202", "21-6205a", "8-1,141a", "8-2110"])
        self.assertEqual(ch["1-202"][0]["type"], "Am")
        self.assertEqual(ch["8-1,141a"][0]["table"], "Table One")


if __name__ == "__main__":
    unittest.main()
