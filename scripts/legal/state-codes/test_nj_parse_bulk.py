"""Focused regression tests for the NJ publisher TXT/RTF parser."""
import importlib.util
import pathlib
import unittest


PARSER_PATH = pathlib.Path(__file__).with_name("nj-parse-bulk.py")
SPEC = importlib.util.spec_from_file_location("nj_parse_bulk", PARSER_PATH)
parser = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(parser)


def rtf_paragraph(style, content):
    return f"\\pard \\s{style} {content}\\par\n"


class NjParserTests(unittest.TestCase):
    def test_body_quote_of_next_citation_does_not_steal_heading_binding(self):
        text = (
            "TITLE 1\n"
            "1:1-1 Introductory section\n"
            "The brief quotes 30:4D-17.22 Actual heading in its body.\n"
            "30:4D-17.22 Actual heading\n"
            "Text of the later section.\n"
        )
        rtf = "".join(
            [
                rtf_paragraph(2, "TITLE 1"),
                rtf_paragraph(3, "1:1-1 Introductory section"),
                rtf_paragraph(3, "30:4D-17.22 Actual heading"),
            ]
        )

        headings, anomalies = parser.bind_headings(text, rtf)

        self.assertEqual(anomalies, [])
        self.assertEqual([row["citation"] for row in headings if row["kind"] == "section"], ["1:1-1", "30:4D-17.22"])
        later = headings[-1]
        self.assertEqual(text[later["heading_span"][0] : later["heading_span"][1]], "30:4D-17.22 Actual heading")
        self.assertEqual(later["start"], text.index("30:4D-17.22 Actual heading\n", text.index("The brief")))

    def test_parenthesized_suffix_and_multiple_parentheses_in_body_are_preserved(self):
        heading = "14:8-22(1). Assignment of right"
        text = f"TITLE 14\n{heading}\nThe rule also cross-references (a)(1) and (b)(2).\n"
        rtf = rtf_paragraph(2, "TITLE 14") + rtf_paragraph(3, heading)

        headings, _ = parser.bind_headings(text, rtf)
        section = headings[-1]

        self.assertEqual(section["citation"], "14:8-22(1)")
        self.assertEqual(section["printed_citation"], "14:8-22(1).")
        self.assertIn("(a)(1) and (b)(2)", text[section["heading_span"][1] :])

    def test_multiple_parenthetical_components_are_not_partially_keyed(self):
        heading = "2A:14-2(a)(1) Illustrative subsection label"
        text = f"TITLE 2A\n{heading}\n"
        rtf = rtf_paragraph(2, "TITLE 2A") + rtf_paragraph(3, heading)

        headings, anomalies = parser.bind_headings(text, rtf)

        # Until a captured publisher heading establishes this composite form,
        # preserve it as an unmapped source block rather than inventing a key.
        self.assertEqual(headings[-1]["kind"], "unmapped_headnote")
        self.assertIsNone(headings[-1]["citation"])
        self.assertEqual(anomalies[-1]["kind"], "noncitation_headnote")

    def test_compound_headnote_keeps_body_and_extracts_only_next_heading(self):
        first = "1:1-1 Existing section"
        compound = "Notice text\n\n 18A:62-56 Number of credits"
        text = f"TITLE 1\n{first}\nPrior body.\n{compound}\nNew section body.\n"
        rtf = (
            rtf_paragraph(2, "TITLE 1")
            + rtf_paragraph(3, first)
            + rtf_paragraph(3, "Notice text\\line\\line  18A:62-56 Number of credits")
        )

        headings, anomalies = parser.bind_headings(text, rtf)

        self.assertEqual([row["citation"] for row in headings if row["kind"] == "section"], ["1:1-1", "18A:62-56"])
        self.assertEqual(anomalies[-1]["kind"], "noncitation_headnote")
        self.assertEqual(anomalies[-1]["nested_section_headings"], 1)
        child = headings[-1]
        self.assertEqual(text[child["heading_span"][0] : child["heading_span"][1]], "18A:62-56 Number of credits")
        self.assertEqual(child["source_anomaly"], "compound_rtf_headnote")

    def test_duplicate_native_citations_remain_distinct_headings(self):
        text = "TITLE 18A\n18A:6-32 First occurrence\nBody A.\n18A:6-32 Second occurrence\nBody B.\n"
        rtf = (
            rtf_paragraph(2, "TITLE 18A")
            + rtf_paragraph(3, "18A:6-32 First occurrence")
            + rtf_paragraph(3, "18A:6-32 Second occurrence")
        )

        headings, _ = parser.bind_headings(text, rtf)
        repeated = [row for row in headings if row.get("citation") == "18A:6-32"]

        self.assertEqual(len(repeated), 2)
        self.assertLess(repeated[0]["start"], repeated[1]["start"])
        self.assertNotEqual(repeated[0]["heading_span"], repeated[1]["heading_span"])

    def test_rtf_escaped_bytes_and_delimiters_decode_but_unknown_controls_fail_closed(self):
        self.assertEqual(parser.decode_heading(r"18A:1-1 \{A\} \'e9"), "18A:1-1 {A} é")
        self.assertEqual(parser.decode_heading(r"18A:1-1 \\ literal"), "18A:1-1 \\ literal")
        with self.assertRaisesRegex(ValueError, "Unsupported heading control"):
            parser.decode_heading(r"18A:1-1 \unknown7")


if __name__ == "__main__":
    unittest.main()
