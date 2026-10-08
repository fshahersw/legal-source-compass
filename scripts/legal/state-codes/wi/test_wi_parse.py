import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import wi_acquire
import wi_parse


CHAPTER_HTML = """
<html><body>
<div class="qsnum_chap">CHAPTER 12</div>
<div class="qstitle_chap"><span class="qstr">ELECTIONS</span></div>
<div class="qstoc_subchap"><span class="qstr">SUBCHAPTER I</span></div>
<div class="qstoc_subchap"><span class="qstr">GENERAL</span></div>
<div class="qstoc_entry"><span class="qstr"><a rel="statutes/12.01"
 href="/document/statutes/12.01">12.01</a><span class="qstab"></span> Definitions.</span></div>
<div class="qstoc_entry"><span class="qstr"><a rel="statutes/12.02"
 href="/document/statutes/12.02">12.02</a><span class="qstab"></span> Repealed.</span></div>
<div class="qsatxt_1sect" data-section="12.01">
 <a class="reference">12.01</a><span class="qsnum_sect">12.01</span>
 <span class="qstitle_sect">Definitions.</span><span class="qstr">  In this chapter:</span></div>
<div class="qsatxt_2subsect" data-section="12.01">
 <a class="reference">12.01(1)</a><span class="qsnum_subsect">(1)</span>
 <span class="qstr"> “Board” means the board.</span></div>
<div class="qsnote_history" data-section="12.01"><span class="reference">12.01 History</span>
 <span class="qstr">History:  2025 a. 1.</span></div>
<div class="qsnote_annot" data-section="12.01"><span class="reference">12.01 Annotation</span>
 <span class="qstr">This commentary must not enter the statute text.</span></div>
<div class="qsnote_note" data-section="12.01"><span class="reference">12.01 Note</span>
 <span class="qstr">NOTE: This section takes effect on January 1, 2027.</span></div>
<div class="qsatxt_1sect" data-section="12.02">
 <a class="reference">12.02</a><span class="qsnum_sect">12.02</span>
 <span class="qstitle_sect">Repealed.</span></div>
</body></html>
""".encode("utf8")


class WisconsinParserTests(unittest.TestCase):
    def test_acquisition_includes_all_complete_chapter_renditions(self):
        paths = [path.format(chapter="1") for path, _ in wi_acquire.CHAPTER_FORMS]
        self.assertEqual(
            paths,
            [
                "/statutes/statutes/1",
                "/statutes/statutes/1.txt",
                "/statutes/statutes/1.json",
                "/statutes/statutes/1.pdf",
            ],
        )

    def test_master_toc_subjects_and_wrapped_heading(self):
        text = """header
TABLE OF CONTENTS

Functions and Government
of Municipalities.
59. Counties.
60. Towns.
Criminal Code.
939. Crimes.
"""
        subjects, chapters = wi_parse.parse_master_toc(text)
        self.assertEqual([x["heading"] for x in subjects], [
            "Functions and Government of Municipalities.",
            "Criminal Code.",
        ])
        self.assertEqual(chapters["59"]["subject"]["ordinal"], 1)
        self.assertEqual(chapters["939"]["heading"], "Crimes.")

    def test_currency_is_verbatim_and_prose_date_not_parsed(self):
        source = {
            "content": "\n".join(
                [
                    "Updated 2023-24 Wisconsin Statutes & Annotations",
                    "Published October 1, 2026.  Certified under s. 35.18.",
                    "Updated through 2025 Wisconsin Act 247.",
                    "Statutory changes effective after October 1, 2026, are designated by NOTES.",
                ]
            )
        }
        edition, currency = wi_parse.currency_metadata(source)
        self.assertEqual(edition, "Updated 2023-24 Wisconsin Statutes & Annotations")
        self.assertIsNone(currency["as_of"])
        self.assertIn("Published October 1, 2026.", currency["statement"])

    def test_section_text_history_status_and_annotation_separation(self):
        receipt = {
            "url": "https://docs.legis.wisconsin.gov/statutes/statutes/12",
            "sha256": "a" * 64,
        }
        rows, toc, stats, derivative = wi_parse.parse_chapter_html(
            CHAPTER_HTML,
            "12",
            {"heading": "Elections.", "subject": None},
            "Edition",
            {"statement": "Statement", "as_of": None},
            receipt,
        )
        self.assertEqual(len(toc), 2)
        self.assertEqual(len(rows), 2)
        first = rows[0]
        self.assertIn("In this chapter:", first["text"])
        self.assertIn("“Board” means the board.", first["text"])
        self.assertIn("NOTE: This section takes effect on January 1, 2027.", first["text"])
        self.assertEqual(first["history"], "History:  2025 a. 1.")
        self.assertNotIn("commentary", first["text"])
        self.assertEqual(first["effective"], "NOTE: This section takes effect on January 1, 2027.")
        self.assertEqual(first["citation_path"][-2]["number"], "I")
        self.assertEqual(first["citation_path"][-1]["level"], "section")
        self.assertEqual(rows[1]["status_label"], "Repealed.")
        self.assertEqual(rows[1]["text"], "")
        span = first["source"]["span"]
        self.assertEqual(derivative[span["start"] : span["end"]], first["text"])
        self.assertEqual(stats["annotation_counts"], {"history": 1, "annot": 1, "note": 1})

    def test_json_child_inventory_ignores_subunits(self):
        source = {
            "children": [
                "/statutes/statutes/12/_1",
                "/statutes/statutes/12/title",
                "/statutes/statutes/12/01",
                "/statutes/statutes/12/01/1",
                "/statutes/statutes/12/02",
            ]
        }
        self.assertEqual(wi_parse.json_top_level_sections(source, "12"), ["12.01", "12.02"])

    def test_txt_toc_inventory_merges_when_html_truncates(self):
        content = """CHAPTER 99\nTITLE\n99.01 First.\n99.02 Second.\n99.03 Third.\n\n99.01 First.  Body one.\n99.02 Second.\n99.03 Third.  Body three.\n"""
        html_toc = [
            {
                "citation": "99.01",
                "heading": "First.",
                "subchapter": None,
                "url": "https://example/99.01",
            },
            {
                "citation": "99.02",
                "heading": "Second.",
                "subchapter": None,
                "url": "https://example/99.02",
            },
        ]
        txt_toc = wi_parse.inventory_from_txt_toc_region(content, "99")
        self.assertEqual([item["citation"] for item in txt_toc], ["99.01", "99.02", "99.03"])
        merged = wi_parse.merge_toc_sections(html_toc, txt_toc)
        self.assertEqual(len(merged), 3)
        self.assertEqual(merged[0]["heading"], "First.")
        self.assertEqual(merged[2]["heading"], "Third.")

    def test_cross_reference_and_note_stay_inside_section_text(self):
        content = """\nCHAPTER 99\nTITLE\n99.10 Sample.\n\n99.10 Sample.  (1) First part.\nCross-reference:  See also ch. 1, Wis. stat.\n(2) Second part.\nNOTE:  Par. (a) is amended eff. 1-1-28 by 2025 Wis. Act 1 to read:\n(a)  Preview text.\n(3) Third part.\nHistory:  2025 a. 1.\n"""
        toc = [
            {
                "citation": "99.10",
                "heading": "Sample.",
                "subchapter": None,
                "url": "https://example/99.10",
            }
        ]
        receipt = {"url": "https://example/99.txt", "sha256": "c" * 64}
        rows, _, _ = wi_parse.parse_chapter_text(
            content,
            "99",
            {"heading": "Title.", "subject": None},
            toc,
            [],
            "Edition",
            {"statement": "Statement", "as_of": None},
            receipt,
        )
        self.assertEqual(len(rows), 1)
        self.assertIn("Cross-reference:", rows[0]["text"])
        self.assertIn("(2) Second part.", rows[0]["text"])
        self.assertIn("NOTE:", rows[0]["text"])
        self.assertIn("(3) Third part.", rows[0]["text"])
        self.assertIn("eff. 1-1-28", rows[0]["effective"])

    def test_complete_plain_text_parser_uses_exact_spans_and_excludes_annotations(self):
        content = """\nCHAPTER 12\nELECTIONS\n12.01 Definitions.\n12.02 Repealed.\n\n12.01 Definitions.  In this chapter:\n(1) “Board” means the board.\nNOTE: This section takes effect on January 1, 2027.\nHistory:  2025 a. 1.\nAn annotation that is not statutory text.\n12.02 Repealed.\nHistory:  1999 a. 1.\n"""
        toc = [
            {
                "citation": "12.01",
                "heading": "Definitions.",
                "subchapter": None,
                "url": "https://example/12.01",
            },
            {
                "citation": "12.02",
                "heading": "Repealed.",
                "subchapter": None,
                "url": "https://example/12.02",
            },
        ]
        receipt = {"url": "https://example/12.txt", "sha256": "b" * 64}
        rows, stats, derivative = wi_parse.parse_chapter_text(
            content,
            "12",
            {"heading": "Elections.", "subject": None},
            toc,
            [],
            "Edition",
            {"statement": "Statement", "as_of": None},
            receipt,
        )
        self.assertIn("NOTE: This section takes effect on January 1, 2027.", rows[0]["text"])
        self.assertIn("(1) “Board” means the board.", rows[0]["text"])
        self.assertEqual(rows[0]["history"], "History:  2025 a. 1.")
        self.assertNotIn("annotation", rows[0]["text"].casefold())
        self.assertIn("takes effect", rows[0]["effective"])
        self.assertEqual(rows[1]["status_label"], "Repealed.")
        self.assertEqual(rows[1]["text"], "")
        for row in rows:
            span = row["source"]["span"]
            self.assertEqual(derivative[span["start"] : span["end"]], row["text"])
        self.assertEqual(stats["span_mismatches"], [])


if __name__ == "__main__":
    unittest.main()
