import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("sd_parse", pathlib.Path(__file__).with_name("parse.py"))
parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse)


class SouthDakotaParseTest(unittest.TestCase):
    def test_section_fixture(self):
        data = json.loads((pathlib.Path(__file__).parent / "fixtures/1-1-1.json").read_text())
        r = parse.parse_section_json(data, "https://sdlegislature.gov/api/Statutes/Statute/1-1-1", "abc")
        self.assertIsNotNone(r)
        self.assertEqual(r["number"], "1-1-1")
        self.assertIn("sovereignty", (r["body"] or "").lower())
        self.assertIn("SDC 1939", r["history"] or "")

    def test_chapter_from_citation(self):
        self.assertEqual(parse.chapter_from_citation("1-1A-3")[1], "1-1A")
        self.assertEqual(parse.chapter_from_citation("1-1-1.1")[0], 1)


if __name__ == "__main__":
    unittest.main()
