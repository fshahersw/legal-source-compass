"""Tests for exact, non-expanding NJ LCTOC-to-body concordance parsing."""
import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("nj-reconcile-toc.py")
SPEC = importlib.util.spec_from_file_location("nj_reconcile_toc", MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class NjTocReconciliationTests(unittest.TestCase):
    def test_preserves_group_and_range_literals_without_expanding_interiors(self):
        text = (
            "TITLE 2A.\n"
            "Chapter 14.\n"
            "C. 2A:14-1.3 and 2A:14-1.4 2001, c.76, ss.2,3.\n"
            "C. 2A:14-2a to 2A:14-2c 2019, c.120, ss.2,9,10.\n"
            "Chapter 15.\n"
            "C. 2A:15-1 2013, c.103, s.4.\n"
            "TITLE 2B.\n"
            "Chapter 14.\n"
            "C. 2B:14-1 2000, c.1.\n"
        )

        records = module.parse_toc(text)

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["explicit_citations_on_entry_line"], ["2A:14-1.3", "2A:14-1.4"])
        self.assertEqual(records[0]["grouping_literal"], " and ")
        self.assertEqual(records[1]["explicit_citations_on_entry_line"], ["2A:14-2a", "2A:14-2c"])
        self.assertEqual(records[1]["grouping_literal"], " to ")
        self.assertNotIn("2A:14-2b", records[1]["explicit_citations_on_entry_line"])

    def test_retains_indented_history_and_repeats_exact_source_text(self):
        text = (
            "TITLE 2A.\n"
            "Chapter 31.\n"
            "N.J.S. 2A:31-3 amended 2000, c.157;\n"
            "\t2021, c.481.\n"
            "\t2021, c.481.\n"
            "\n"
            "Chapter 32.\n"
        )

        record = module.parse_toc(text)[0]

        self.assertEqual(record["explicit_citations_on_entry_line"], ["2A:31-3"])
        self.assertEqual(record["history_text"], "N.J.S. 2A:31-3 amended 2000, c.157;\n\t2021, c.481.\n\t2021, c.481.\n")
        start, end = record["source_span"]
        self.assertEqual(text[start:end], record["history_text"])
        self.assertEqual(record["source_end_line"], 5)

    def test_does_not_collect_other_titles_or_other_chapters(self):
        text = (
            "TITLE 2A.\nChapter 13.\nC. 2A:13-1 1950, c.1.\n"
            "Chapter 14.\nC. 2A:14-2 2004, c.17.\n"
            "TITLE 2B.\nChapter 14.\nC. 2B:14-1 2000, c.1.\n"
            "TITLE 2A.\nChapter 31.\nN.J.S. 2A:31-3 amended 2000, c.157.\n"
        )

        records = module.parse_toc(text)

        self.assertEqual([record["explicit_citations_on_entry_line"] for record in records], [["2A:14-2"], ["2A:31-3"]])


if __name__ == "__main__":
    unittest.main()
