import re
import unittest

import parse_index
import parse_stage


class IndexParserTests(unittest.TestCase):
    def test_nested_unit_inherits_printed_parent_chapter(self):
        source = """
        <span id="title">TITLE III EXECUTIVE BRANCH</span>
        <a class="chapter" href="chapter.aspx?id=1">CHAPTER 14A BUSINESS ACT</a>
        <a class="subchapter" href="chapter.aspx?id=2">Subchapter 1. General Provisions</a>
        <a class="chapter" href="chapter.aspx?id=3">Subchapter 2. Filings</a>
        """
        parsed = parse_index.parse_index(source)
        self.assertEqual(1, len(parsed["titles"]))
        self.assertEqual(["chapter", "subchapter", "subchapter"],
                         [row["unit_level"] for row in parsed["chapters"]])
        self.assertEqual(["14A", "14A", "14A"],
                         [row["chapter_first"] for row in parsed["chapters"]])
        self.assertEqual("2", parsed["chapters"][2]["unit_number"])
        self.assertEqual("BUSINESS ACT", parsed["chapters"][2]["chapter_heading"])

    def test_chapter_metadata_and_section_links(self):
        source = """
        <span id="Banner1_lblPageTitle">KRS Chapter 2</span>
        <span id="Banner1_LastCondificationSession">Includes enactments through the 2026 Regular Session</span>
        <span id="Banner1_runDate">10/05/2026</span>
        <a class="statute" href="statute.aspx?id=17">.070 Repealed, 1975.</a>
        """
        parsed = parse_index.parse_chapter(source)
        self.assertEqual("KRS Chapter 2", parsed["page_title"])
        self.assertEqual("10/05/2026", parsed["run_date"])
        self.assertEqual("17", parsed["sections"][0]["native_id"])
        self.assertEqual(".070", parsed["sections"][0]["section_suffix"])


class SectionParserTests(unittest.TestCase):
    def test_active_section_fields_and_body_offsets(self):
        raw = (
            "2.035   Pledge of allegiance to state flag. \n"
            "The following shall be the official pledge. \n"
            "Effective: July 14, 2000 \n"
            "History: Created 2000 Ky. Acts ch. 206, sec. 1. \n"
        )
        parsed = parse_stage.split_section_text(
            raw, "2.035", "Pledge of allegiance to state flag."
        )
        self.assertEqual("The following shall be the official pledge.", parsed["text"])
        pub, s, e = parse_stage.publisher_text_and_span(parsed)
        self.assertIn("Effective: July 14, 2000", pub)
        self.assertEqual(pub, parsed["raw_text"][s:e])
        self.assertEqual("Effective: July 14, 2000", parsed["effective"])
        self.assertEqual(
            "History: Created 2000 Ky. Acts ch. 206, sec. 1.", parsed["history"]
        )
        self.assertEqual(
            parsed["text"], parsed["raw_text"][parsed["body_start"]:parsed["body_end"]]
        )

    def test_repealed_placeholder_retains_catchline_and_status(self):
        raw = (
            "2.070   Repealed, 1975. \n"
            "Catchline at repeal: Displaying an immoral flag. \n"
            "History: Repealed 1974 Ky. Acts ch. 406, sec. 336. \n"
        )
        parsed = parse_stage.split_section_text(raw, "2.070", "Repealed, 1975.")
        self.assertEqual(
            "Catchline at repeal: Displaying an immoral flag.", parsed["text"]
        )
        self.assertIsNone(parsed["effective"])
        self.assertEqual("Repealed, 1975.", parse_stage.status_label("Repealed, 1975."))

    def test_status_only_pdf_uses_printed_status_heading_as_nonempty_text(self):
        parsed = parse_stage.split_section_text(
            "10.100   Reserved. \n", "10.100", "Reserved."
        )
        self.assertEqual("Reserved.", parsed["text"])
        self.assertEqual("Reserved.", parse_stage.status_label("Reserved."))
        self.assertIsNone(parse_stage.status_label("Reserved powers of the cabinet."))

    def test_en_dash_and_pdf_control_char_match_inventory_heading(self):
        parsed = parse_stage.split_section_text(
            "16.642   Board is trustee of funds -- Investments \x13 Control over assets in\n"
            "custodial account -- Priority to investments enhancing economic welfare\n"
            "of Commonwealth -- Investment committee of funds.\n"
            "(1)\nThe board shall be the trustee.\n",
            "16.642",
            "Board is trustee of funds -- Investments – Control over assets in custodial account -- "
            "Priority to investments enhancing economic welfare of Commonwealth -- Investment "
            "committee of funds -- Cap on amount of assets managed by any one investment manager.",
        )
        self.assertEqual("The board shall be the trustee.", parsed["text"])

    def test_inventory_quotes_may_be_absent_from_pdf_heading(self):
        parsed = parse_stage.split_section_text(
            '68.001 Definition of state local finance officer. As used in this chapter, "officer" means x.\n',
            "68.001",
            'Definition of "state local finance officer."',
        )
        self.assertIn("As used in this chapter", parsed["text"])

    def test_word_pdf_line_breaks_inside_double_hyphen_match_index_heading(self):
        parsed = parse_stage.split_section_text(
            "7.330 Audit of state-\nsupported programs -\n- Review. \nBody.\n"
            "History : Created 2000 Ky. Acts.\n",
            "7.330",
            "Audit of state-supported programs -- Review.",
        )
        self.assertEqual("Body.", parsed["text"])
        self.assertEqual("History : Created 2000 Ky. Acts.", parsed["history"])

    def test_heading_effective_wording_is_retained_without_effective_block(self):
        parsed = parse_stage.split_section_text(
            "367.3611 Definitions. (Effective July 1, 2027) \nBody.\n",
            "367.3611",
            "Definitions. (Effective July 1, 2027)",
        )
        self.assertEqual("(Effective July 1, 2027)", parsed["effective"])

    def test_nested_and_parallel_intake_paths_match_manifest_regex(self):
        self.assertRegex("304.17A-132", re.compile(parse_stage.SECTION_ID_RE))
        self.assertRegex(
            "367.3611:occurrence:2", re.compile(parse_stage.SECTION_ID_RE)
        )
        self.assertNotRegex("367.3611:occurrence:0", re.compile(parse_stage.SECTION_ID_RE))

    def test_inventory_citation_uses_parent_chapter(self):
        unit = {"chapter_first": "14A", "chapter_label": "Subchapter 2"}
        section = {"section_suffix": ".2-010"}
        self.assertEqual("14A.2-010", parse_stage.section_citation(unit, section))


if __name__ == "__main__":
    unittest.main()
