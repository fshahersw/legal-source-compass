import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location("mt_" + name, ROOT / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mt_parse = load("parse")
mt_acquire = load("acquire")

HEAD = """<html><body><div class="mca-content mca-toc"><h1>Montana Code Annotated 2025</h1>
<div class="section-header">
<h4 class="section-title-title">TITLE 27. CIVIL LIABILITY, REMEDIES, AND LIMITATIONS</h4>
<h3 class="section-chapter-title">CHAPTER 2. STATUTES OF LIMITATIONS</h3>
<h2 class="section-part-title">Part 2. Time Limits on Specific Kinds of Actions</h2>
<h1 class="section-section-title">%s</h1></div>
"""

TWO_VERSIONS = HEAD % "Tort Actions -- General And Personal Injury" + """
<div class="section-doc" id="mca_0270-0020-0020-0040">
  <div class="section-content">
    <p class="line-indent"><span class="catchline"><span class="citation">27-2-204</span>.&#8195;<span class="effective-clause">(Temporary)</span> Tort actions -- general and personal injury.</span> (1) The period is within 3 years.</p>
    <p class="line-indent">(2)\tThe period for libel is within 2 years.</p>
  </div>
  <div class="section-content">
    <p class="line-indent"><span class="catchline"><span class="citation">27-2-204</span>.&#8195;<span class="effective-clause">(Effective October 1, 2026)</span> Tort actions -- general and personal injury.</span> (1) The period is within 3 years, as amended.</p>
  </div>
</div><div class="history-doc" id="mca_0270-0020-0020-0040_hist">
  <div class="history-content"><p class="line-indent"><span class="header">History:</span>&#8195;En. Sec. 510, C. Civ. Proc. 1895.</p></div>
</div></div></body></html>"""

REPEALED = HEAD % "Repealed" + """
<div class="section-doc" id="mca_0270-0020-0020-0170">
  <div class="section-content"><p class="line-indent"><span class="skip-running-header"></span><span class="catchline"><span class="citation">27-2-217</span>.&#8195;Repealed.</span> Sec. 10, Ch. 367, L. 2019.</p></div>
</div><div class="history-doc" id="mca_0270-0020-0020-0170_hist">
  <div class="history-content"><p class="line-indent"><span class="header">History:</span>&#8195;En. Sec. 3, Ch. 560, L. 1993.</p></div>
</div></div></body></html>"""

TABLE = HEAD % "Rates" + """
<div class="section-doc" id="mca_0270-0020-0020-0300">
  <div class="section-content"><p class="line-indent"><span class="catchline"><span class="citation">27-2-230</span>.&#8195;Rates.</span> The rates are:</p>
  <table><tr><td>Class</td><td>Rate</td></tr><tr><td>A</td><td>1%</td></tr></table></div>
</div></div></body></html>"""

CONST = """<html><body><div class="mca-content mca-toc"><div class="section-header">
<h4 class="section-title-title">THE CONSTITUTION OF THE STATE OF MONTANA</h4>
<h3 class="section-chapter-title">ARTICLE II. DECLARATION OF RIGHTS</h3>
<h2 class="section-part-title">Part II. DECLARATION OF RIGHTS</h2>
<h1 class="section-section-title">Popular Sovereignty</h1></div>
<div class="section-doc" id="mca_0000-0020-0010-0010"><div class="section-content">
<p class="line-indent"><span class="catchline"><span class="citation">Section&#8194;1</span>.&#8195;Popular sovereignty.</span> All political power is vested in and derived from the people.</p>
</div></div></div></body></html>"""

BASE = "https://mca.legmt.gov/bills/mca/"
URL_204 = BASE + "title_0270/chapter_0020/part_0020/section_0040/0270-0020-0020-0040.html"
URL_217 = BASE + "title_0270/chapter_0020/part_0020/section_0170/0270-0020-0020-0170.html"
URL_230 = BASE + "title_0270/chapter_0020/part_0020/section_0300/0270-0020-0020-0300.html"
URL_CONST = BASE + "title_0000/article_0020/part_0010/section_0010/0000-0020-0010-0010.html"

PART_TOC = """<div class="mca-content mca-toc"><div class="section-toc-content"><ul>
<li class="line"><a href="./section_0010/0270-0020-0020-0010.html"><span class="citation">27-2-201</span>&nbsp;Actions upon judgments</a></li>
<li class="line"><span class="reserved">27-2-219 through 27-2-230 reserved</span></li>
</ul></div></div></html>"""


class SectionPageTest(unittest.TestCase):
    def test_every_version_block_is_kept(self):
        row = mt_parse.parse_section_page(TWO_VERSIONS, URL_204)
        self.assertEqual(row["citation"], "27-2-204")
        self.assertEqual(row["versions"], 2)
        self.assertIn("(Temporary) Tort actions", row["text"])
        self.assertIn("(Effective October 1, 2026)", row["text"])
        self.assertIn("as amended", row["text"])
        self.assertEqual(row["catch_heading"], "Tort actions -- general and personal injury")
        self.assertEqual(row["history"], "History: En. Sec. 510, C. Civ. Proc. 1895.")
        self.assertEqual(row["heads"]["chapter"], "CHAPTER 2. STATUTES OF LIMITATIONS")

    def test_repealed_line_is_text(self):
        row = mt_parse.parse_section_page(REPEALED, URL_217)
        self.assertEqual(row["text"], "27-2-217. Repealed. Sec. 10, Ch. 367, L. 2019.")
        self.assertEqual(row["catch_heading"], "Repealed")
        self.assertTrue(row["skip_running_header"])

    def test_table_cells_stay_apart(self):
        row = mt_parse.parse_section_page(TABLE, URL_230)
        self.assertIn("Class Rate", row["text"])
        self.assertIn("A 1%", row["text"])
        self.assertTrue(row["has_table"])

    def test_constitution(self):
        row = mt_parse.parse_section_page(CONST, URL_CONST)
        self.assertEqual(row["citation"], "Section 1")
        self.assertEqual(row["catch_heading"], "Popular sovereignty")
        self.assertEqual(mt_parse.number_from("article", row["heads"]["chapter"]), "II")

    def test_toc_heading(self):
        self.assertEqual(mt_parse.toc_heading("27-2-201 Actions upon judgments", "27-2-201"), "Actions upon judgments")
        self.assertEqual(mt_parse.toc_heading("1. Popular sovereignty", None), "Popular sovereignty")
        self.assertEqual(mt_parse.toc_heading("1-1-210 through 1-1-213 reserved", "1-1-210"),
                         "1-1-210 through 1-1-213 reserved")

    def test_status_line(self):
        row = mt_parse.parse_section_page(REPEALED, URL_217)
        self.assertEqual(mt_parse.status_line(row, "Repealed"), "Repealed. Sec. 10, Ch. 367, L. 2019.")
        real = mt_parse.parse_section_page(TWO_VERSIONS, URL_204)
        self.assertIsNone(mt_parse.status_line(real, "Tort actions -- general and personal injury"))
        void_act = dict(real, versions=1, text="2-1-101. Void act. An act is void when ...", skip_running_header=False)
        self.assertIsNone(mt_parse.status_line(void_act, "Void act"))
        const = {"versions": 1, "text": "Section 3. Repealed. Sec. 1, Const. Amend. No. 16, approved Nov. 4, 1986.",
                 "citation": "Section 3", "skip_running_header": False}
        self.assertEqual(mt_parse.status_line(const, "Repealed"), "Repealed. Sec. 1, Const. Amend. No. 16, approved Nov. 4, 1986.")
        reserved = {"versions": 1, "text": "1-1-210 through 1-1-213 reserved.", "citation": "1-1-210", "skip_running_header": True}
        self.assertEqual(mt_parse.status_line(reserved, "1-1-210 through 1-1-213 reserved"), "1-1-210 through 1-1-213 reserved.")

    def test_section_id_regex(self):
        import re
        rx = re.compile(mt_parse.SECTION_ID_REGEX)
        for ok in ("27-2-204", "15-30-2101", "1-1-101~2", "const-II-1", "const-preamble-1", "30-9A-101"):
            self.assertTrue(rx.match(ok), ok)
        self.assertFalse(rx.match("27-2"))


class TocTest(unittest.TestCase):
    def test_part_toc_entries(self):
        entries = mt_acquire.toc_entries("part", PART_TOC)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["citation"], "27-2-201")
        self.assertEqual(entries[0]["label"], "27-2-201 Actions upon judgments")
        self.assertIsNone(entries[1]["href"])
        self.assertTrue(entries[1]["reserved"])

    def test_validity(self):
        self.assertTrue(mt_acquire.valid("section", TWO_VERSIONS))
        self.assertFalse(mt_acquire.valid("section", "<html><script>challenge</script></html>"))


if __name__ == "__main__":
    unittest.main()
