"""Offline parser tests for scripts/state_law/states/*.py on small synthetic pages shaped like each publisher's
markup (no network). The bounded live samples and their exact-text proofs live under private/build/w1025_stat-a."""
from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402
from state_law import verify as verify_mod  # noqa: E402


def load(code: str):
    spec = importlib.util.spec_from_file_location(f"state_{code}", HERE / "states" / f"{code}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetched(url: str, body: bytes, content_type: str = "text/html") -> lib.Fetched:
    return lib.Fetched(url=url, final_url=url, status=200, headers={"content-type": content_type}, body=body,
                       sha256=hashlib.sha256(body).hexdigest(), bytes=len(body), retrieved_at="2026-10-24T00:00:00Z")


class Ctx:
    """Minimal RunContext over a temp dir; sources are recorded so verify.py can check exact text."""

    def __init__(self, module, tmp: pathlib.Path):
        class _F:
            def get(self, *a, **k):
                raise AssertionError("no network in tests")

        self.ctx = lib.RunContext(module.META, tmp / "out", tmp / "raw", sample=1000, fetcher=_F(), log=lambda m: None,
                                  today=dt.date(2026, 10, 24))

    def record(self, f: lib.Fetched) -> lib.Fetched:
        self.ctx._record_source(f)
        return f


class CaliforniaTests(unittest.TestCase):
    def test_status_from_history_line(self):
        ca = load("ca")
        today = dt.date(2026, 10, 24)
        cond = ca.status_of("Repealed (in Sec. 5) and added by Stats. 1980, Ch. 899, Sec. 5.5. Effective September 17, "
                            "1980. Conditionally operative as prescribed by its own provisions.", "1980-09-17", today)
        self.assertEqual(cond["status"], "not_recorded")
        self.assertIsNone(ca.status_of("Added by Stats. 1980, Ch. 899, Sec. 5. Effective September 17, 1980. Repealed on "
                                       "date prescribed by its own provisions.", "1980-09-17", today)["status"])
        self.assertEqual(ca.status_of("Added by Stats. 2002, Ch. 448, Sec. 2.   Effective January 1, 2003.",
                                      "2003-01-01 00:00:00", today)["status"], None)
        future = ca.status_of("Repealed (in Sec. 4) and added by Stats. 2025, Ch. 563, Sec. 5.   (AB 747)   Effective "
                              "January 1, 2026.   Operative January 1, 2027, by its own provisions.", "2026-01-01", today)
        self.assertEqual(future["status"], "future_effective")
        self.assertEqual(future["effective"]["start"], "2027-01-01")
        current = ca.status_of("Amended by Stats. 2025, Ch. 563, Sec. 4.   Effective January 1, 2026.   Repealed as of "
                               "January 1, 2027, by its own provisions.", "2026-01-01", today)
        self.assertEqual(current["status"], None)
        self.assertEqual(current["effective"]["end"], "2027-01-01")
        expired = ca.status_of("Effective June 29, 2026.   Inoperative July 1, 2026, by its own provisions", "2026-06-29", today)
        self.assertEqual(expired["status"], "expired")
        self.assertEqual(ca.node_step("CHAPTER 4. California Condor [3850. - 3858.]"),
                         {"level": "chapter", "label": "Chapter", "number": "4", "heading": "California Condor"})
        self.assertEqual(ca.node_step("PRELIMINARY PROVISIONS [1. - 3.]")["level"], "other")

    def test_dat_parser(self):
        ca = load("ca")
        rows = ca.parse_dat(b"`CCP`\t`335.1.`\tNULL\t2003-01-01 00:00:00\n", 4)
        self.assertEqual(rows[0][1], ["CCP", "335.1.", None, "2003-01-01 00:00:00"])
        with self.assertRaises(ValueError):
            ca.parse_dat(b"`a`\t`b`\n", 3)


class FloridaTests(unittest.TestCase):
    PAGE = ("<html><body><div class='Chapters'><div class='Chapter'><div class='Title'><div class='TitleNumber'>TITLE VIII"
            "</div><span class='TitleName'>LIMITATIONS</span></div><div class='ChapterTitle'><div class='ChapterNumber'>"
            "CHAPTER 95</div><div class='ChapterName'>LIMITATIONS OF ACTIONS</div></div><div class='Section'><span "
            "class='SectionNumber'>95.03&#x2003;</span><span class='Catchline'><span class='CatchlineText'>Contracts "
            "shortening time.</span><span class='EmDash'>&#x2014;</span></span><span class='SectionBody'><span "
            "class='Text Intro Justify'>Any provision in a contract is void.</span></span><div class='History'><span "
            "class='HistoryTitle'>History.</span><span class='EmDash'>&#x2014;</span><span class='HistoryText'>s. 2, ch. "
            "74-382.</span></div><div class='Note'><span class='NoteTitle'>Note.</span>Former s. 95.07.</div></div>"
            "</div></div></body></html>").encode()

    def test_chapter(self):
        fl = load("fl")
        with tempfile.TemporaryDirectory() as tmp:
            c = Ctx(fl, pathlib.Path(tmp))
            page = c.record(fetched("https://www.leg.state.fl.us/statutes/index.cfm?x=95", self.PAGE))
            self.assertEqual(fl.parse_chapter(c.ctx, page, "VIII", "LIMITATIONS"), 1)
            c.ctx.finish()
            row = next(lib.read_jsonl(c.ctx.dir / "sections.jsonl.gz"))
            self.assertEqual(row["section_id"], "FL:FS:95.03")
            self.assertEqual(row["heading"], "Contracts shortening time.")
            self.assertEqual(row["text"], "Any provision in a contract is void.")
            self.assertEqual(row["history"], "History.—s. 2, ch. 74-382.")
            self.assertNotIn("Former", row["text"])
            self.assertTrue(verify_mod.verify(c.ctx.dir, pathlib.Path(tmp) / "raw")["ok"])


class IllinoisTests(unittest.TestCase):
    PAGE = ("<html><body><div class='billtext-host'>"
            "<table><tr><td><div><code><font>(735 ILCS 5/Art. XIII heading)</font></code><code><font>ARTICLE XIII"
            "</font></code> <code><font>LIMITATIONS</font></code></div></td></tr></table>"
            "<table><tr><td><div><code><font>(735 ILCS 5/Art. XIII Pt. 2 heading)</font></code><code><font>Part 2. "
            "Personal Actions</font></code></div></td></tr></table>"
            "<table><tr><td><div align='justify'><p></p><code>&nbsp;</code><code><font>(735 ILCS 5/13-202.1)</font></code>"
            "<br><code><font>Sec. 13-202.1. </font></code><code><font>No limitations on certain actions.</font></code>"
            "<br><code><font>(a) An action may be brought at any time if --</font></code><br><code><font>(1) the action "
            "is based upon conduct of a person </font></code></div></td></tr><tr><td><table><tr><td><code>&nbsp;</code>"
            "</td><td><div><code><font>which constituted a felony; and</font></code></div></td></tr></table></td></tr>"
            "<tr><td><div><code><font>(2) the person was convicted.</font></code><br><code><font>(Source: P.A. "
            "97-1150, eff. 1-25-13.)</font></code></div></td></tr></table>"
            "<table><tr><td><div><code><font>(735 ILCS 5/13-203)</font></code><br><code><font>Sec. 13-203. </font>"
            "</code><code><font>Loss of consortium.</font></code><code><font> Text in force.</font></code><br><code>"
            "<font>(Source: P.A. 104-1, eff. 1-1-27.)</font></code></div></td></tr></table>"
            "</div></body></html>").encode()

    def test_act_page(self):
        il = load("il")
        with tempfile.TemporaryDirectory() as tmp:
            c = Ctx(il, pathlib.Path(tmp))
            page = c.record(fetched("https://www.ilga.gov/legislation/ILCS/details?x=1", self.PAGE))
            n = il.parse_act_page(c.ctx, page, "735", "CIVIL PROCEDURE", "5", "Code of Civil Procedure.", dt.date(2026, 10, 24))
            self.assertEqual(n, 2)
            c.ctx.finish()
            rows = list(lib.read_jsonl(c.ctx.dir / "sections.jsonl.gz"))
            self.assertEqual(rows[0]["section_id"], "IL:ILCS:735:5/13-202.1")
            self.assertEqual(rows[0]["citation"], "735 Ill. Comp. Stat. 5/13-202.1")
            self.assertEqual(rows[0]["text"], "(a) An action may be brought at any time if --\n(1) the action is based "
                                              "upon conduct of a person which constituted a felony; and\n(2) the person was convicted.")
            self.assertEqual([p["number"] for p in rows[0]["path"]], ["735", "5", "XIII", "2"])
            self.assertEqual(rows[0]["path"][3]["heading"], "Personal Actions")
            self.assertEqual(rows[1]["status"], "future_effective")
            self.assertEqual(rows[1]["effective"]["start"], "2027-01-01")
            self.assertTrue(verify_mod.verify(c.ctx.dir, pathlib.Path(tmp) / "raw")["ok"])


class MassachusettsAndMarylandTests(unittest.TestCase):
    def test_ma_section(self):
        ma = load("ma")
        body = ('{"Code":"2A","Name":"Tort actions","IsRepealed":false,"Text":"Section 2A. Actions of tort shall be '
                'commenced within three years&mdash;  \\r\\n\\r\\n(a) next.  \\r\\n"}').encode()
        with tempfile.TemporaryDirectory() as tmp:
            c = Ctx(ma, pathlib.Path(tmp))

            def fake_fetch(url, **kw):
                return c.record(fetched(url, body, "application/json"))

            c.ctx.fetch = fake_fetch
            ma.section_record(c.ctx, {"Code": "III", "Name": "COURTS"}, {"Code": "260", "Name": "LIMITATION OF ACTIONS"},
                              {"Code": "2A", "Details": "https://malegislature.gov/api/Chapters/260/Sections/2A/"})
            c.ctx.finish()
            row = next(lib.read_jsonl(c.ctx.dir / "sections.jsonl.gz"))
            self.assertEqual(row["section_id"], "MA:MGL:260:2A")
            self.assertEqual(row["text"], "Actions of tort shall be commenced within three years—\n(a) next.")
            self.assertEqual(row["citation"], "Mass. Gen. Laws ch. 260, § 2A")

    def test_md_section(self):
        md = load("md")
        page = fetched("https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcj&section=5-101",
                       ("<html><body><div id='StatuteText'><html><div><span>Article - Courts and Judicial Proceedings"
                        "</span></div><br><button>Previous</button>&sect;5&ndash;101.<br><br>&nbsp;&nbsp;A civil action "
                        "shall be filed within three years.<br><br><button>Next</button></html></div></body></html>").encode())
        self.assertEqual(md.parse_section(page), ("5–101", "A civil action shall be filed within three years."))


class DistrictOfColumbiaTests(unittest.TestCase):
    NS = ('xmlns="https://code.dccouncil.us/schemas/dc-library" xmlns:codify="https://code.dccouncil.us/schemas/codify" '
          'xmlns:xi="http://www.w3.org/2001/XInclude"')

    def test_section_text_status_and_pending_instructions(self):
        dc = load("dc")
        body = (f'<section {self.NS}><num>12-301</num><heading>Limitation of time.</heading>'
                '<para><num>[(a)]</num><text>Except as provided:</text><para><num>(9)</num><text>for a violation of '
                '<cite path="§7-1201.01|(11)">§ 7-1201.01(11)</cite>— 1 year;</text>'
                '<codify:repeal doc="D.C. Law 25-217" path="§2162"/></para></para>'
                '<para><prefix>Article</prefix><num>I</num><heading>Purposes.</heading><text>The purposes are:</text></para>'
                '<table><tr><td>Not over $10,000</td><td>6%</td></tr></table>'
                '<annotations><annotation type="History">Dec. 23, 1963, 77 Stat. 510</annotation>'
                '<annotation type="Cross References">see § 9-315</annotation></annotations></section>').encode()
        got = dc.parse_section(body, dt.date(2026, 10, 24))
        self.assertEqual(got["text"].split("\n"), ["[(a)] Except as provided:", "(9) for a violation of § 7-1201.01(11)— 1 year;",
                                                   "Article I Purposes.", "The purposes are:", "Not over $10,000 6%"])
        self.assertEqual(got["history"], "Dec. 23, 1963, 77 Stat. 510")
        self.assertIsNone(got["status"])
        self.assertIn("D.C. Law 25-217", got["effective"]["note"])
        rendered = lib.norm_ws(lib.render_text(body, "application/xml", "x.xml"))
        self.assertTrue(lib.check_quote(rendered, got["text"]))

    def test_reason_markers(self):
        dc = load("dc")
        today = dt.date(2026, 10, 24)

        def parse(reason, text, placeholder=""):
            attr = f' placeholder="{placeholder}"' if placeholder else ""
            return dc.parse_section(f'<section {self.NS}{attr}><num>1-1</num><reason>{reason}</reason><heading>H.</heading>'
                                    f'<text>{text}</text></section>'.encode(), today)

        self.assertEqual(parse("Repealed", "Repealed.")["status"], "repealed")
        self.assertEqual(parse("Recodified", "Recodified as § 1-2.")["status"], "renumbered")
        future = parse("Applicable on January 1, 2027", "Applicable on January 1, 2027.", "Not Funded")
        self.assertEqual((future["status"], future["effective"]["start"]), ("future_effective", "2027-01-01"))
        self.assertEqual(parse("Not Funded", "Not Funded.", "Not Funded")["status"], "not_recorded")
        # a <reason> that annotates an editorial substitution leaves an in-force text alone
        self.assertIsNone(parse("Commissioner", "The Superintendent [Commissioner] may examine.")["status"])

    def test_title_and_code_index(self):
        dc = load("dc")
        title, entries = dc.walk_title(f'<container {self.NS}><prefix>Title</prefix><num>12</num><heading>Right to Remedy.'
                                       '</heading><container><prefix>Chapter</prefix><num>3</num><heading>Limitation.</heading>'
                                       '<xi:include href="./sections/12-301.xml"/></container></container>'.encode())
        self.assertEqual(title["number"], "12")
        self.assertEqual(entries, [([{"level": "chapter", "label": "Chapter", "number": "3", "heading": "Limitation."}],
                                    "sections/12-301.xml")])
        titles, recency = dc.walk_code(f'<document {self.NS}><meta><recency through="2026-10-20"><law doc="D.C. Law 26-190"/>'
                                       '</recency></meta><subheading>Division II. Judiciary.</subheading>'
                                       '<xi:include href="./titles/12/index.xml"/></document>'.encode())
        self.assertEqual(titles[0][0]["number"], "II")
        self.assertEqual(recency, {"through": "2026-10-20", "law": "D.C. Law 26-190"})


class HawaiiAndIdahoTests(unittest.TestCase):
    def test_hi_section_history_and_repealed_pair(self):
        hi = load("hi")
        page = fetched("https://data.capitol.hawaii.gov/x/HRS_0657-0001.htm", (
            '<html><body><div class="WordSection1"><p class="RegularParagraphs" align="center"><b>PART I. PERSONAL ACTIONS</b></p>'
            '<p class="XNotesHeading">Case Notes</p><p class="XNotes">A note.</p>'
            '<p class="RegularParagraphs"> <b>§657-1  Six years.</b> The following actions:</p>'
            '<p class="oneParagraph"> (1) Actions on debts. [CC 1859, §1036; am L 1972, c 105, §1(a)]</p>'
            '<p class="XNotesHeading">Case Notes</p><p class="XNotes">Dropped.</p></div></body></html>').encode())
        got = hi.parse_section(page)
        self.assertEqual((got["numbers"], got["heading"]), (["657-1"], "Six years."))
        self.assertEqual(got["text"], "The following actions:\n(1) Actions on debts.")
        self.assertEqual(got["history"], "CC 1859, §1036; am L 1972, c 105, §1(a)")
        pair = hi.parse_section(fetched("https://x/HRS_0657-0016.htm", (
            '<html><body><div class="WordSection1"><p class="RegularParagraphs"> <b>§§657-16 and 657-17  REPEALED.</b>'
            '  L 1976, c 200, pt of §1.</p></div></body></html>').encode()))
        self.assertEqual((pair["numbers"], pair["status"], pair["text"], pair["history"]),
                         (["657-16", "657-17"], "repealed", "", "L 1976, c 200, pt of §1."))

    def test_id_section(self):
        idaho = load("id")
        page = fetched("https://legislature.idaho.gov/statutesrules/idstat/Title5/T5CH2/SECT5-219", (
            '<html><body><div class="pgbrk"><div style="text-align: center"><span>TITLE 5 </span></div>'
            '<div style="text-align: center"><span>PROCEEDINGS IN CIVIL ACTIONS</span></div>'
            '<div style="text-align: center"><span>CHAPTER 2 </span></div><div style="text-align: center"><span>LIMITATION OF ACTIONS</span></div>'
            '<div style="text-align: justify"><span>5-219.&nbsp;&nbsp;<span style="text-transform: uppercase">Actions against officers.&nbsp;</span>'
            'Within two (2) years:</span></div><div style="text-align: justify"><span>1.&nbsp;&nbsp;An action against a sheriff.</span></div>'
            '<p></p><div style="text-align: justify"><span>History:</span></div>'
            '<div style="text-align: justify"><span>[(5-219) C.C.P. 1881, sec. 159; am. 1971, ch. 180, sec. 1, p. 845.]</span></div>'
            '</div></body></html>').encode())
        got = idaho.parse_section(page)
        self.assertEqual((got["number"], got["heading"]), ("5-219", "Actions against officers."))
        self.assertEqual(got["text"], "Within two (2) years:\n1. An action against a sheriff.")
        self.assertEqual(got["history"], "(5-219) C.C.P. 1881, sec. 159; am. 1971, ch. 180, sec. 1, p. 845.")
        self.assertEqual([(h["level"], h["number"], h["heading"]) for h in got["headers"]],
                         [("title", "5", "PROCEEDINGS IN CIVIL ACTIONS"), ("chapter", "2", "LIMITATION OF ACTIONS")])


class DelawareTests(unittest.TestCase):
    PAGE = ('<html><head><meta charset="utf-8"></head><body><div id="TitleHead"><h1>TITLE 2</h1><h4>Transportation</h4><h2>Aeronautics</h2>'
            '<h3>CHAPTER 1. Regulation</h3><h4>Subchapter III. Licensing</h4></div><div id="CodeBody">'
            '<div class="Section"><div class="SectionHead" id="163">\u00a7 163. Licenses.</div>'
            '<p class="subsection">(a) No airport shall be operated without a license.</p>'
            '<a href="https://legis.delaware.gov/SessionLaws?volume=70">70 Del. Laws, c. 575, \u00a7 8</a>; </div>'
            '<div class="Section"><div class="SectionHead" id="164,165">\u00a7\u00a7 164,165. [Reserved.]</div></div>'
            '<div class="Section"><div class="SectionHead" id="166-169">\u00a7\u00a7 166-169. [Reserved.]</div></div>'
            '<div class="Section"><div class="SectionHead" id="2-101.1">\u00a7 2-101.1. Short title.</div>'
            '<p>This Article may be cited as Uniform Commercial Code \u2014 Sales.</p></div>'
            '</div></body></html>')

    def test_listed_ranged_and_decimal_heads(self):
        de = load("de")
        page = fetched("https://delcode.delaware.gov/title2/c001/sc03/index.html", self.PAGE.encode())
        path, sections = de.parse_chapter(page)
        self.assertEqual([s["number"] for s in path], ["2", None, "1", "III"])
        self.assertEqual([s.get("number") for s in sections], ["163", "164", "165", None, "2-101.1"])
        self.assertEqual(sections[0]["heading"], "Licenses.")
        self.assertEqual(sections[0]["history"], "70 Del. Laws, c. 575, \u00a7 8;")
        self.assertEqual(sections[1]["heading"], "[Reserved.]")
        self.assertEqual(sections[3]["reject"], "range entry: \u00a7\u00a7 166-169. [Reserved.]")
        self.assertEqual(sections[4]["heading"], "Short title.")

    def test_outgoing_and_incoming_versions(self):
        de = load("de")
        today = dt.date(2026, 10, 24)
        out = de.effective_fields("Definitions [Effective until Oct. 21, 2026].", today)
        self.assertEqual((out["heading"], out["status"], out["effective"]["end"]), ("Definitions.", "expired", "2026-10-21"))
        inc = de.effective_fields("Definitions [Effective Oct. 21, 2026].", today)
        self.assertEqual((inc["heading"], inc["status"], inc["effective"]["start"]), ("Definitions.", "in_force", "2026-10-21"))
        later = de.effective_fields("Licenses [Effective Jan. 1, 2027].", today)
        self.assertEqual(later["status"], "future_effective")
        self.assertEqual(de.effective_fields("Short title.", today), {"heading": "Short title."})
        self.assertEqual(de.HEAD_RE.match("\u00a7 A-101. Title.").group(1), "A-101")

    def test_entity_wrapped_links(self):
        de = load("de")
        home = '<a href="&#xA;   title1/index.html&#xA; ">1</a><a href="title10/index.html">10</a><a href="title1/index.html">x</a>'
        self.assertEqual(de.links(home, r"(?:\.\./)?(title\d+[a-z]?/index\.html)"), ["title1/index.html", "title10/index.html"])
        chap = '<a href="../title10/c001/index.html">1</a><a href="&#xA; ../title10/c081/sc01/index.html&#xA;">s</a>'
        self.assertEqual(de.links(chap, r"(?:\.\./title\d+[a-z]?/)?(c\d+[a-z]?/index\.html)"), ["c001/index.html"])


class ConnecticutTests(unittest.TestCase):
    PAGE = ('<html><head><meta charset="utf-8"></head><body>'
            '<p><span class="catchln" id="sec_1-18">Sec. 1-18. Disposition of documents.</span> Any record may be '
            'disposed of.</p><p class="source">(1949 Rev., S. 3611.)</p>'
            '<p><span class="catchln">Secs. 1-19 and 1-19a.</span> Repealed, P.A. 75-342, S. 17.</p>'
            '<p><span class="catchln">Secs. 3-72, 3-72a and 3-73. Funds to be paid to General Fund.</span> '
            'Transferred to Secs. 3-60 to 3-62.</p>'
            '<p><span class="catchln">Secs. 1-42 to 1-54.</span> Repealed, P.A. 15-240, S. 52.</p>'
            '<p class="history">History: editorial note.</p></body></html>')

    def test_listed_numbers_share_one_entry_and_ranges_stay_ledgered(self):
        ct = load("ct")
        items = ct.chapter_sections(fetched("https://www.cga.ct.gov/current/pub/chap_001.htm", self.PAGE.encode()))
        self.assertEqual([i.get("number") or i["range"] for i in items],
                         ["1-18", "1-19", "1-19a", "3-72", "3-72a", "3-73", "Secs. 1-42 to 1-54."])
        self.assertEqual(items[0]["history"], ["(1949 Rev., S. 3611.)"])
        self.assertEqual(items[1]["paras"], ["Repealed, P.A. 75-342, S. 17."])
        self.assertIs(items[1]["paras"], items[2]["paras"])
        self.assertIsNone(items[1]["heading"])
        self.assertEqual(items[5]["heading"], "Funds to be paid to General Fund.")


class LoaderRejectBoundTests(unittest.TestCase):
    def _edition(self, tmp: pathlib.Path, sections: int, rejects: list[str]) -> pathlib.Path:
        import gzip
        import json
        d = tmp / "xx-20261024"
        d.mkdir()
        with gzip.open(d / "rejects.jsonl.gz", "wt") as fh:
            for reason in rejects:
                fh.write(json.dumps({"reason": reason}) + "\n")
        with gzip.open(d / "sections.jsonl.gz", "wt") as fh:
            fh.write(json.dumps({"section_id": "XX:X:1"}) + "\n")
        files = {}
        for name in ("rejects.jsonl.gz", "sections.jsonl.gz"):
            files[name] = {"sha256": hashlib.sha256((d / name).read_bytes()).hexdigest()}
        (d / "edition.json").write_text(json.dumps({"edition_id": "xx-20261024", "state": "XX", "sample": None,
                                                    "files": files, "counts": {"sections": sections, "nodes": 3,
                                                                               "rejected": len(rejects)}}))
        return d

    def test_range_entries_are_not_bounded_but_parse_failures_are(self):
        load_spec = importlib.util.spec_from_file_location("state_law_load", HERE / "load.py")
        loader = importlib.util.module_from_spec(load_spec)
        load_spec.loader.exec_module(loader)
        with tempfile.TemporaryDirectory() as t:
            ok = self._edition(pathlib.Path(t), 100, ["range entry: Secs. 1-42 to 1-54."] * 40 + ["unparsed head"] * 3)
            self.assertEqual(loader.main([str(ok), "--dry-run"]), 0)
        with tempfile.TemporaryDirectory() as t:
            bad = self._edition(pathlib.Path(t), 100, ["range entry: x"] * 2 + ["unparsed head"] * 6)
            with self.assertRaises(SystemExit) as raised:
                loader.main([str(bad), "--dry-run"])
            self.assertIn("6 rejected rows (besides 2 range entries)", str(raised.exception))
        with tempfile.TemporaryDirectory() as t:
            gap = self._edition(pathlib.Path(t), 100, ["unavailable: https://x/Title22/ returned HTTP 404"])
            with self.assertRaises(SystemExit) as raised:
                loader.main([str(gap), "--dry-run"])
            self.assertIn("not served by the publisher", str(raised.exception))
            self.assertEqual(loader.main([str(gap), "--dry-run", "--accept-rejects", "Title 22 returned HTTP 404"]), 0)


class ArizonaVersionTests(unittest.TestCase):
    def test_two_printed_versions_are_kept_and_neither_is_called_in_force(self):
        az = load("az")
        self.assertEqual(az.base_number("3-3493; Version 2"), "3-3493")
        self.assertEqual(az.base_number("12-542"), "12-542")
        seen: dict[str, int] = {}
        first = az.version_fields("3-3493", "(L16, Ch. 232, sec. 27)\nA. All gasoline ...", 2, seen)
        second = az.version_fields("3-3493", "(L17, Ch. 295, sec. 2. Conditionally Eff.)\nA. All gasoline ...", 2, seen)
        self.assertEqual((first["version_index"], second["version_index"]), (1, 2))
        self.assertEqual(second["version"], "L17, Ch. 295, sec. 2. Conditionally Eff.")
        self.assertEqual({first["status"], second["status"]}, {"not_recorded"})
        self.assertIn("prints 2 versions", second["effective"]["note"])
        bare = az.version_fields("9-1", "A. Text without a version line.", 2, {})
        self.assertIsNone(bare["version"])

    def test_index_version_labels_cover_decimal_sections_too(self):
        az = load("az")
        self.assertTrue(az.printed_matches("3-3493", "3-3493; Version 2", "https://www.azleg.gov/ars/3/03493.01.htm"))
        self.assertTrue(az.printed_matches("11-269.33", "11-269; Version 33", "https://www.azleg.gov/ars/11/00269.33.htm"))
        self.assertTrue(az.printed_matches("12-542", "12-542", "https://www.azleg.gov/ars/12/00542.htm"))
        self.assertFalse(az.printed_matches("11-270", "11-269; Version 33", "https://www.azleg.gov/ars/11/00269.33.htm"))


class KansasTests(unittest.TestCase):
    def test_repealed_section_prints_its_number_in_the_history_paragraph(self):
        ks = load("ks")
        body = ('<html><head><meta charset="utf-8"></head><body><div id="print"><div>'
                '<p class="ksa_stat_hist"><span class="stat_number"> 8-1,141a. </span></p>'
                '<p class="ksa_stat_hist"><span class="history"> History: </span> L. 1994, ch. 12, \u00a7 2; '
                'Repealed, L. 2025, ch. 125, \u00a7 14; July 1.</p></div></div></body></html>').encode()
        got = ks.parse_section(fetched("https://www.ksrevisor.gov/statutes/chapters/ch08/008_001_0141a.html", body))
        self.assertEqual(got["number"], "8-1,141a")
        self.assertEqual(got["text"], "")
        self.assertIn("Repealed, L. 2025, ch. 125", got["history"])


class AlaskaHeadTests(unittest.TestCase):
    def test_section_sign_heads_and_ranges(self):
        ak = load("ak")
        self.assertTrue(ak.RANGE_RE.match("\u00a7\u00a7 03.05.025 \u2014 03.05.026 Seafood processing permits"))
        self.assertTrue(ak.RANGE_RE.match("Secs. 09.10.010 \u2014 09.10.030. Repealed."))
        self.assertIsNone(ak.RANGE_RE.match("Sec. 09.10.010. Jurisdiction of actions."))
        m = ak.SEC_RE.match("\u00a7 03.05.010. Powers and duties.")
        self.assertEqual((m.group(1), m.group(2)), ("03.05.010", "Powers and duties."))


class IdahoNumberTests(unittest.TestCase):
    def test_ucc_chapter_article_section_numbers(self):
        idaho = load("id")
        for head, number in (("28-5-101. Short title. This chapter may be cited as ...", "28-5-101"),
                             ("28-2-313. EXPRESS WARRANTIES", "28-2-313"), ("5-219. LIMITATIONS", "5-219"),
                             ("39-1301.5. DEFINITIONS", "39-1301.5")):
            self.assertEqual(idaho.SECTION_RE.match(head).group(1), number)


class BlockedStates(unittest.TestCase):
    def test_blocked_modules_never_fetch(self):
        for code in ("ga", "ar", "co"):
            module = load(code)
            self.assertTrue(module.META.blocked)
            self.assertEqual(module.META.hosts, ())
            with self.assertRaises(lib.Blocked):
                module.acquire(None)


if __name__ == "__main__":
    unittest.main()
