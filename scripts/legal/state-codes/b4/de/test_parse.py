import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("de_parse", ROOT / "parse.py")
de_parse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(de_parse)

FIXTURE = """
<div id="TitleHead">
<h1>TITLE 22</h1><h4>Municipalities</h4>
<h3>CHAPTER 9. Municipal User Tax</h3>
</div>
<ul class="chaptersections">
<li><a href="#901">§ 901</a></li>
<li><a href="#902">§ 902</a></li>
</ul>
<div id="CodeBody">
<div class="Section">
<div class="SectionHead" id="901">§ 901. Authority to levy.</div>
<p class="subsection">Any municipality may levy a tax.</p>22 Del. C. 1953, § 901;
<a href="https://legis.delaware.gov/SessionLaws?volume=57&amp;chapter=11">57 Del. Laws, c. 11</a>;
</div><br>
<div class="Section">
<div class="SectionHead" id="902">§ 902. Limitations.</div>
<p class="subsection">The tax shall not exceed 1.25 percent.</p>22 Del. C. 1953, § 902;
</div><br>
</div>
"""

REC = {"sha256": "abc123" * 10 + "abcd"}


class DelawareParseTest(unittest.TestCase):
    def test_chapter_sections_and_spans(self):
        ch, secs, inv = de_parse.parse_unit_page(
            FIXTURE, "https://delcode.delaware.gov/title22/c009/index.html", REC
        )
        de_parse.assign_citation_paths(secs)
        self.assertEqual(inv["toc_count"], 2)
        self.assertEqual(inv["parsed_count"], 2)
        self.assertEqual(len(secs), 2)
        self.assertEqual(secs[0]["citation_path"], "22-9-901")
        self.assertEqual(secs[0]["heading"], "Authority to levy.")
        self.assertIn("municipality", ch["text"])
        body0 = "Any municipality may levy a tax."
        self.assertEqual(ch["text"][secs[0]["start"] : secs[0]["end"]], body0)
        self.assertTrue(secs[0]["history"] and "57 Del. Laws" in secs[0]["history"])


if __name__ == "__main__":
    unittest.main()
