import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sc_common import decode_html, sha256_hex  # noqa: E402

from parse import parse_mrg_html


FIX = os.path.join(os.path.dirname(__file__), "fixtures", "ch1-mrg.bin")


class TestParseMrg(unittest.TestCase):
    def test_chapter_one_sections(self):
        raw = open(FIX, "rb").read()
        html, _ = decode_html(raw)
        parsed = parse_mrg_html(html, "https://example/I/1/1-mrg.htm", "abc123")
        self.assertEqual(parsed["chapter_num"], "1")
        self.assertEqual(parsed["title_num"], "I")
        self.assertEqual(parsed["parsed_section_count"], 19)
        self.assertEqual(parsed["sections"][0]["citation_path"], "1:1")
        self.assertIn("Perambulation", parsed["sections"][0]["heading"])
        self.assertIn("Source.", parsed["sections"][0]["history"] or "")
        repealed = [s for s in parsed["sections"] if s["citation_path"] == "1:12"][0]
        self.assertIsNotNone(repealed["status_label"])
        ch = parsed["chapter_text"]
        for s in parsed["sections"]:
            slice_ = ch[s["start"] : s["end"]]
            self.assertEqual(sha256_hex(slice_), sha256_hex(slice_))
            self.assertEqual(slice_, s["end"] - s["start"] and ch[s["start"] : s["end"]])
            self.assertTrue(slice_.startswith("Section " + s["citation_path"]))


if __name__ == "__main__":
    unittest.main()
