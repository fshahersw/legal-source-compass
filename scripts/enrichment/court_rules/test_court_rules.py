"""Offline tests for the court_rules stream (synthetic fixtures, no network).

  cd scripts/enrichment/court_rules && python3 -B -m unittest -v test_court_rules
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import constitution_parse as CP  # noqa: E402
import insights as INS  # noqa: E402
import sections as S  # noqa: E402
import textlib  # noqa: E402

LOCAL_RULES = "\n".join([
    "UNITED STATES DISTRICT COURT",
    "TABLE OF CONTENTS",
    "LR 7.1 Motions ........................................ 5",
    "LR 7.2 Memoranda ...................................... 6",
    "\f",
    "LR 7.1 Motions",
    "(a) Any opposition must be filed within 14 days after the motion is served.",
    "Pursuant to LR 7.2, the memorandum may not exceed 25 pages.",
    "LR 7.2, a party must comply with this rule.",
    "LR 7.2 Memoranda",
    "(a) Memoranda must be double-spaced in 12-point type.",
    "LR 16.1 Scheduling",
    "Rule 56(a) motions are governed by the federal rules.",
    "The parties must confer before the conference.",
    "LR 26.1 Discovery",
    "Discovery materials are not filed.",
    "LR 83.1 Admission",
    "An attorney may apply for admission pro hac vice.",
    "LR 83.2 Discipline",
    "Attorneys are subject to discipline.",
])


class SplitTests(unittest.TestCase):
    def test_headings_and_toc(self):
        secs, method = S.split_sections(LOCAL_RULES)
        labels = [s.label for s in secs]
        self.assertEqual(labels, ["LR 7.1", "LR 7.2", "LR 16.1", "LR 26.1", "LR 83.1", "LR 83.2"])
        self.assertIn("abbrev", method)
        self.assertEqual(secs[0].title, "Motions")
        self.assertEqual(secs[0].page, 2)  # the contents page is page 1
        self.assertIn("within 14 days", secs[0].text)

    def test_cross_references_are_not_headings(self):
        secs, _ = S.split_sections(LOCAL_RULES)
        self.assertNotIn("Rule 56", [s.label for s in secs])
        self.assertEqual(sum(1 for s in secs if s.number == "7.2"), 1)  # "LR 7.2, a party" is a cross-reference

    def test_page_fallback(self):
        text = "Some text without any rule headings at all, long enough to keep.\f" + "Another page of plain text, also long enough."
        secs, method = S.split_sections(text)
        self.assertEqual(method, "pages")
        self.assertEqual([s.label for s in secs], ["Page 1", "Page 2"])

    def test_oversized_sections_split_at_pages_without_losing_text(self):
        body = "\f".join(["word " * 3000] * 4)
        sec = S.Section(label="RULE 9.1", number="9.1", title="Forms", start=0, end=len(body), page=3, text=body)
        parts = S.split_oversized([sec], body, limit=20000)
        self.assertGreater(len(parts), 1)
        self.assertTrue(parts[0].label.endswith(f"(part 1 of {len(parts)})"))
        self.assertEqual(parts[1].page, 3 + parts[0].text.count("\f") + 1)
        self.assertEqual(textlib.squash(" ".join(p.text for p in parts)), textlib.squash(body))

    def test_sentence_after_label_is_not_a_title(self):
        text = "\n".join(["Rule 1. Scope", "These rules govern all suits except as stated in",
                          "Rule 81. They should be construed and employed by the court and the parties.", "Rule 2. One Form", "x",
                          "Rule 3. Commencing", "y", "Rule 4. Summons", "z", "Rule 5. Serving", "w"])
        secs, _ = S.split_sections(text)
        self.assertNotIn("Rule 81", [s.label for s in secs])


class QuoteTests(unittest.TestCase):
    TEXT = "The opposition must be filed and served not more\nthan 14 days after the motion was filed."

    def test_exact_and_spacing(self):
        self.assertEqual(textlib.find_quote("not more\nthan 14 days after", self.TEXT), "exact")
        self.assertEqual(textlib.find_quote("not more than 14 days after the motion", self.TEXT), "spacing_normalized")
        self.assertIsNone(textlib.find_quote("not more than 21 days after the motion", self.TEXT))
        self.assertIsNone(textlib.find_quote("14 days", self.TEXT))  # too short to identify a passage

    def test_value_in_quote(self):
        self.assertTrue(textlib.value_in_quote("14 Days", "served not more than 14 days after"))
        self.assertFalse(textlib.value_in_quote("21 days", "served not more than 14 days after"))


class InsightValidationTests(unittest.TestCase):
    SECTIONS = {"d:0001": {"id": "d:0001", "label": "LR 7.1", "title": "Motions", "page": 3, "source_url": "https://x/doc.pdf#page=3",
                           "text": "Any opposition must be filed within fourteen (14) days after service of the motion. A brief may not exceed 25 pages."}}

    def item(self, **kw):
        base = {"category": "response_deadline", "applies_to": "Opposition", "value": "within fourteen (14) days", "number": 14,
                "unit": "days", "quote": "Any opposition must be filed within fourteen (14) days after service of the motion.", "section_id": "d:0001"}
        base.update(kw)
        return base

    def test_kept(self):
        rec, reason = INS.validate(self.item(), self.SECTIONS)
        self.assertEqual(reason, "kept")
        self.assertEqual(rec["quote_match"], "exact")
        self.assertEqual(rec["number"], 14)
        self.assertEqual(rec["page"], 3)

    def test_drops(self):
        self.assertEqual(INS.validate(self.item(quote="Any opposition must be filed within 21 days after service."), self.SECTIONS)[1], "quote_not_in_text")
        self.assertEqual(INS.validate(self.item(value="21 days"), self.SECTIONS)[1], "value_not_in_quote")
        self.assertEqual(INS.validate(self.item(number=21), self.SECTIONS)[1], "number_not_in_value")
        self.assertEqual(INS.validate(self.item(category="guess"), self.SECTIONS)[1], "unknown_category")
        self.assertEqual(INS.validate(self.item(section_id="d:9999"), self.SECTIONS)[1], "unknown_section")

    def test_number_words(self):
        self.assertTrue(INS.number_written(14, "within fourteen days"))
        self.assertTrue(INS.number_written(13000, "13,000 words"))
        self.assertFalse(INS.number_written(14, "within seven days"))
        self.assertTrue(INS.number_written(None, "anything"))

    def test_quote_across_running_footer_is_dropped(self):
        pages = [f"LOCAL CRIMINAL RULES\nLCrR {n}.1 Rule\nA party must file within {n} days.\nThe clerk dockets it.\n"
                 f"Body text in the middle of page {n}.\nMore rule text.\nEnd of the rule text.\nCR-{n}" for n in range(1, 7)]
        running = INS.running_lines("\f".join(pages))
        self.assertIn("cr-#", running)  # footer
        self.assertIn("local criminal rules", running)  # header
        self.assertNotIn("body text in the middle of page #.", running)
        sections = {"d:0001": {"id": "d:0001", "label": "LCrR 12.1", "title": "Motions", "page": 12, "source_url": "https://x/doc.pdf#page=12",
                               "text": "failure to file a response within fourteen (14)\nCR-12\ndays after being directed shall indicate no opposition."}}
        item = self.item(value="within fourteen (14)", quote="failure to file a response within fourteen (14)\nCR-12\ndays after being directed")
        self.assertEqual(INS.validate(item, sections, running)[1], "quote_crosses_page_header_or_footer")
        self.assertEqual(INS.validate(item, sections)[1], "kept")  # without running lines the quote itself is word for word

    def test_truncated_response_parsing(self):
        text = '{"insights":[{"category":"page_limit","value":"25 pages"},{"category":"adr","value":"medi'
        self.assertEqual([i["category"] for i in INS.parse_json(text)], ["page_limit"])


class ConstitutionTests(unittest.TestCase):
    TEXT = "\n".join([
        "PREAMBLE We the people.",
        "ARTICLE I. DECLARATION OF RIGHTS",
        "Section 1. Inherent rights. All persons are free.",
        "Section 2. Political power. All power is in the people, as provided in",
        "Section 4 of this article and elsewhere.",
        "ARTICLE II",
        "SEC. 1. [Elections.] Elections shall be free.",
        "§ 2. Voting. Every citizen may vote.",
        "Section 3.",
        "Section 3. Residence. Residence rules.",
        "Section 4. Terms. Terms are two years.",
    ])

    def test_structure(self):
        units = CP.split_constitution(self.TEXT)
        secs = [(u["article"], u["section"]) for u in units if u["section"]]
        self.assertEqual(secs, [("I", "1"), ("I", "2"), ("II", "1"), ("II", "2"), ("II", "3"), ("II", "4")])
        self.assertEqual(CP.structure_level(units), "section")
        sec2 = next(u for u in units if u["article"] == "I" and u["section"] == "2")
        self.assertIn("Section 4 of this article", sec2["text"])  # a wrapped cross-reference stays in the text
        self.assertEqual(next(u for u in units if u["article"] == "II" and u["section"] == "1")["section_title"], "Elections.")

    def test_combined_heading(self):
        units = CP.split_constitution("Article I, Section 1 | Inalienable Rights\nAll men are free.")
        self.assertEqual((units[0]["article"], units[0]["section"], units[0]["section_title"]), ("I", "1", "Inalienable Rights"))

    def test_contents_entries_margin_headings_and_titles(self):
        text = "\n".join([
            "ARTICLE I",
            "DECLARATION OF RIGHTS",
            "SECTION 1. Political power.",
            "SECTION 2. Basic rights.",
            "§3",
            "Religious freedom.",
            "SECTION 1. Political power.—All political power is inherent in the people.",
            "SECTION 2. Basic rights.—All natural persons are equal before the law.",
            "§3",
            "Religious freedom.",
            "Sec. 3. There shall be no law respecting the establishment of religion.",
        ])
        units, stats = CP.clean_units(CP.split_constitution(text))
        self.assertEqual([(u["article"], u["section"]) for u in units], [("I", "1"), ("I", "2"), ("I", "3")])
        self.assertTrue(units[0]["text"].startswith("SECTION 1. Political power.—All"))
        self.assertTrue(units[2]["text"].startswith("§3\nReligious freedom.\nSec. 3."))  # margin heading kept with its section
        self.assertEqual(units[0]["article_title"], "DECLARATION OF RIGHTS")
        self.assertEqual(stats["article_heading_kept_as_title"], 1)
        self.assertEqual(stats["margin_heading_kept_with_section"], 1)
        self.assertGreaterEqual(stats["contents_entry_dropped"], 2)
        self.assertEqual(CP.repeated_share(units), 0.0)

    def test_running_headers_do_not_open_units(self):
        pages = []
        for n in range(1, 6):
            pages.append("\n".join([f"Article IV Section {n}", f"Section {n}. Rule {n}. The legislature shall meet on day {n}",
                                    "and shall adjourn when its business is done.", "CONSTITUTION OF THE STATE"]))
        units = CP.split_constitution("ARTICLE IV\n" + "\n\f".join(pages))
        self.assertEqual([u["section"] for u in units if u["section"]], ["1", "2", "3", "4", "5"])
        self.assertTrue(all(u["article"] == "IV" for u in units))

    def test_catchword_spaced_decimal_and_lettered_numbers(self):
        units = CP.split_constitution("\n".join([
            "ARTICLE V.", "Courts. SECTION 1. The judicial power shall be vested in a supreme court.",
            "Section 44. 1. Commission composition and appointment. (1) The commission shall have twelve members.",
            "Section 8-A. Rights of victims of crime. The victim shall be accorded fairness.",
        ]))
        self.assertEqual([(u["section"], u["section_title"]) for u in units if u["section"]],
                         [("1", "Courts"), ("44.1", "Commission composition and appointment"), ("8-A", "Rights of victims of crime")])

    def test_roman(self):
        self.assertEqual(CP.roman_to_int("XIV"), 14)
        self.assertIsNone(CP.roman_to_int("ABC"))


if __name__ == "__main__":
    unittest.main()
