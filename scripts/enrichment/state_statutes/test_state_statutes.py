"""Offline tests for the state_statutes stream (synthetic fixtures, no network).

Run: cd scripts/enrichment/state_statutes && python3 -B -m unittest -v test_state_statutes
"""
import json
import unittest

import build_state_code_sd as bsd
import codebuild
import parse_sd
import parse_wa

SD_HTML = (
    '<html><head><title>SDLRC - Codified Law 2</title></head><body><div>'
    '<p class="aNormal"><span>CHAPTER 2-1</span></p><p class="aNormal"><span>INITIATIVE AND REFERENDUM</span></p>'
    '<p class="aB"><a href="https://sdlegislature.gov/Statutes?Statute=2-1-1"><span>2-1-1</span></a>'
    '<span>    Petitions.</span></p></div></body></html><br /><hr><br />'
    '<html><head><meta property="og:url" content="https://sdlegislature.gov/Statutes/2-1-1"></head><body><div>'
    '<p class="sxNormal"><a href="x?Statute=2-1-1"><span class="sxSENU">2-1-1</span></a><span class="sxSENU">. </span>'
    '<span class="sxCL">Initiative and referenda petitions--Number of signatures required.</span></p>'
    '<p class="sxStatute"><span>All measures proposed by initiative must be presented by petition.</span></p>'
    '<p class="sxStatute"><span>(1)    A second   paragraph.</span></p>'
    '<p class="sxNormal"><span> </span></p>'
    '<p class="sxNoIndent"><span>Source: </span><span>SDC 1939, § 55.0401; SL 2025, ch 14, § 1.</span></p>'
    '<p class="sxNoIndent"><span>Commission Note: This section is repealed effective January 1, 2027.</span></p>'
    '</div></body></html><br /><hr><br />'
    '<html><head></head><body><div><p class="s2Normal"><span class="s2SENU">2-1-2, 2-1-2.1</span>'
    '<span>. Repealed by SL 2012, ch 18, §§ 4, 5.</span></p></div></body></html><br /><hr><br />'
    '<html><head></head><body><div><p class="effectiveDate">Effective January 1, 2027</p></div></body></html>'
    '<html><head></head><body><div><p class="s3Normal"><span class="s3SENU">2-1-1</span><span>. </span>'
    '<span class="s3CL">Initiative and referenda petitions--Number of signatures required.</span></p>'
    '<p class="s3Statute"><span>Future text.</span></p></div></body></html><br /><hr><br />'
    '<html><head></head><body><div><p class="s4Normal"><span>APPENDIX TO CHAPTER 2-1</span></p></div></body></html>'
)

WA_CHAPTER = (
    "<html><body><h1><!-- field: Citations -->Chapter 9A.32 RCW<!-- field: --></h1><h2><div>HOMICIDE</div></h2>"
    "<div id='contentWrapper' class='chapter-page'><h3 class=\"list-heading\">Sections</h3><table>"
    "<tr><td><a href='#9A.32.010'>HTML</a></td><td><a href='#9A.32.010'>9A.32.010</a></td><td>Homicide defined.</td></tr>"
    "<tr><td><a href='#9A.32.020'>HTML</a></td><td><a href='#9A.32.020'>9A.32.020</a></td><td>Premeditation.</td></tr>"
    "</table></div><span id=\"ContentPlaceHolder1_dlSectionContent\">"
    "<span><a name='9A.32.010'></a><div><h3><a class=\"btn btn-outline\" href=\"x\">PDF</a>RCW <a href='y'>9A.32.010</a></h3></div>"
    "<div><h3>Homicide defined.</h3></div><div><div style=\"text-indent:0.5in;\">Homicide is the killing of a human being.</div></div>"
    "<div style=\"margin-top:15pt;margin-bottom:0pt;\">[ <a href='z'>1997 c 196 s 3</a>; 1975 1st ex.s. c 260 s 9A.32.010.]</div>"
    "<div style=\"margin-top:0.25in;\"><h3>NOTES:</h3></div><div><div>Excusable homicide: RCW 9A.16.030.</div></div></span>"
    "<span><a name='9A.32.020'></a><div><h3><a class=\"btn\">PDF</a>RCW <a>9A.32.020</a></h3></div>"
    "<div><h3>Premeditation—Limitations. (Effective until July 1, 2027.)</h3></div>"
    "<div><div>(1) First.</div><div>(2) Second.</div></div>"
    "<div style=\"margin-top:15pt;\">[ 1975 1st ex.s. c 260 s 9A.32.020.]</div></span></span></body></html>"
)


class ParseSD(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_sd.parse_title(SD_HTML.encode("utf-16-le"))

    def test_decodes_utf16_without_bom(self):
        self.assertEqual(parse_sd.decode("<p>x</p>".encode("utf-16-le")), "<p>x</p>")
        self.assertEqual(parse_sd.decode(b"<p>x</p>"), "<p>x</p>")

    def test_section_text_history_and_notes(self):
        first = self.parsed["sections"][0]
        self.assertEqual(first["number"], "2-1-1")
        self.assertEqual(first["heading"], "Initiative and referenda petitions--Number of signatures required.")
        self.assertEqual(first["paragraphs"], ["All measures proposed by initiative must be presented by petition.", "(1) A second paragraph."])
        self.assertEqual(first["source"], "Source: SDC 1939, § 55.0401; SL 2025, ch 14, § 1.")
        self.assertEqual(first["notes"], ["Commission Note: This section is repealed effective January 1, 2027."])
        self.assertIsNone(first["effective"])

    def test_range_stub_keeps_printed_label_and_status(self):
        stub = self.parsed["sections"][1]
        self.assertEqual(stub["label"], "2-1-2, 2-1-2.1")
        self.assertEqual(stub["heading"], "Repealed by SL 2012, ch 18, §§ 4, 5.")
        self.assertEqual(stub["status"], "Repealed")
        self.assertEqual(stub["paragraphs"], [])

    def test_effective_banner_attaches_to_next_section_and_appendix_is_excluded(self):
        future = self.parsed["sections"][2]
        self.assertEqual(future["number"], "2-1-1")
        self.assertEqual(future["effective"], "Effective January 1, 2027")
        self.assertEqual(len(self.parsed["appendices"]), 1)
        self.assertEqual(self.parsed["errors"], [])

    def test_split_heading_and_label_numbers(self):
        self.assertEqual(parse_sd.split_heading("1-2-3", "1-2-3 to 1-2-7. Repealed by SL 1988."), ("1-2-3 to 1-2-7", "Repealed by SL 1988."))
        self.assertEqual(parse_sd.split_heading("15-6-4(c)", "15-6-4(c). By whom summons served."), ("15-6-4(c)", "By whom summons served."))
        self.assertEqual(parse_sd.label_numbers("1-2-3 to 1-2-7"), (["1-2-3", "1-2-7"], True))

    def test_banner_date_and_title_contents(self):
        self.assertEqual(bsd.banner_date("Effective July 1, 2027"), "2027-07-01")
        self.assertIsNone(bsd.banner_date("Effective soon"))
        self.assertEqual(bsd.title_contents_chapters("1", [(None, "01A Unconstitutional Official Actions"), (None, "not a row")]),
                         {"1-1A": "Chapter 1-1A. Unconstitutional Official Actions"})
        self.assertEqual(bsd.title_order("23A"), (23, "A"))


class ParseWA(unittest.TestCase):
    def test_chapter_page(self):
        page = parse_wa.parse_chapter_page(WA_CHAPTER)
        self.assertEqual((page["h1"], page["caption"]), ("Chapter 9A.32 RCW", "HOMICIDE"))
        self.assertEqual([c for c, _ in page["toc"]], ["9A.32.010", "9A.32.020"])
        first, second = page["sections"]
        self.assertEqual(first["cite_line"], "RCW 9A.32.010")
        self.assertEqual(first["paragraphs"], ["Homicide is the killing of a human being."])
        self.assertEqual(first["history"], "[ 1997 c 196 s 3; 1975 1st ex.s. c 260 s 9A.32.010.]")
        self.assertNotIn("Excusable", json.dumps(first))  # Code Reviser notes are not kept
        self.assertEqual(second["paragraphs"], ["(1) First.", "(2) Second."])
        self.assertEqual(second["version_note"], "(Effective until July 1, 2027.)".strip(" ."))
        self.assertEqual(page["errors"], [])

    def test_section_without_anchor_is_an_error_not_a_guess(self):
        page = parse_wa.parse_chapter_page(WA_CHAPTER.replace("<a name='9A.32.020'></a>", ""))
        self.assertEqual(len(page["sections"]), 1)
        self.assertEqual(len(page["errors"]), 1)


class CodeBuild(unittest.TestCase):
    def row(self, **over):
        args = dict(citation="SDCL 2-1-1", heading="Petitions.", title_value="2", chapter_label="Chapter 2-1. Initiative",
                    body="Text.", source_url="https://sdlegislature.gov/Statutes/2-1-1", edition="E", currency="C",
                    history="SL 2025, ch 14", status=None)
        args.update(over)
        return codebuild.section_row("state_code_sd", "SD", "2-1-1", **args)

    def test_row_follows_the_state_code_contract_and_is_lean(self):
        row = self.row()
        self.assertEqual(row["title"], "SDCL 2-1-1 Petitions.")
        self.assertEqual(row["filters"], {"_listing": ["yes"], "title": ["2"]})
        self.assertEqual(row["item"]["cells"], {"chapter": "Chapter 2-1. Initiative"})
        self.assertEqual(row["detail"]["sections"], [{"heading": "Section text", "text": "Text."}])
        self.assertIn(["Source note", "SL 2025, ch 14"], row["detail"]["facts"])
        self.assertNotIn("subtitle", row["item"])
        self.assertNotIn("links", row["detail"])
        self.assertEqual(row["text"], "2-1-1 SDCL 2-1-1 Petitions.")

    def test_status_stub_has_no_empty_section(self):
        row = self.row(body=None, status="Repealed", history=None)
        self.assertNotIn("sections", row["detail"])
        self.assertEqual(row["item"]["cells"]["status"], "Repealed")
        self.assertIn(["Status as printed", "Repealed"], row["detail"]["facts"])
        self.assertFalse(any(f[0] == "Source note" for f in row["detail"]["facts"]))

    def test_listing_counts_and_prune(self):
        rows = [self.row(), self.row(title_value="2"), self.row(title_value="23A")]
        block = codebuild.listing_block(rows, {"2": "TITLE 2", "23A": "TITLE 23A"}, "q")
        options = block["filters"][1]["options"]
        self.assertEqual([(o["value"], o["count"]) for o in options], [("2", 2), ("23A", 1)])
        self.assertEqual(block["qualification"], "q")
        self.assertEqual(codebuild.prune({"a": "", "b": [], "c": {"d": None}, "e": 0}), {"e": 0})


if __name__ == "__main__":
    unittest.main()
