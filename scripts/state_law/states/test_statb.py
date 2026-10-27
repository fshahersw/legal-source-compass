"""Offline tests for STAT-B's state modules (no network): small synthetic fragments shaped like each publisher's
markup, the strict publisher-marker status rule, the RTF renderer, and module metadata. Run:

    python3 -m unittest scripts/state_law/states/test_statb.py

The bounded live/retained samples and their exact-text proofs live under private/build/w1025_stat-b/state_law."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import datetime as dt
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import _statb as sb  # noqa: E402
from state_law import lib  # noqa: E402

MINE = "MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()


def load(code: str):
    spec = importlib.util.spec_from_file_location(f"statb_{code}", HERE / f"{code}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Ctx:
    """Just enough of RunContext for acquire() to reach its live/retained decision."""

    def __init__(self, options=None):
        self.options = options or {}
        self.retained = None

    def get(self, *a, **k):
        raise AssertionError("no network in tests")

    fetch = get


class StatusMarkers(unittest.TestCase):
    def test_marker_only_entries(self):
        self.assertEqual(sb.status_kwargs("Repealed by Laws 1984, c. 164, § 32, eff. Nov. 1, 1984.", "")["status"], "repealed")
        self.assertEqual(sb.status_kwargs(None, "[Reserved.]")["status"], "reserved")
        self.assertEqual(sb.status_kwargs("Recompiled.", "")["status"], "renumbered")
        self.assertEqual(sb.status_kwargs("Salary (Repealed).", "")["status"], "repealed")
        self.assertEqual(sb.status_kwargs("Transferred to § 17.1 of Title 10.", "")["status"], "transferred")

    def test_words_that_are_not_markers(self):
        # catchlines that merely contain a marker word are in force when text is printed under them
        for heading, text in (("Reserved name.", "A name may be reserved for 120 days."),
                              ("Transferred employees.", "Employees transferred under this act keep their rights."),
                              ("Expired labor contracts.", "An expired contract continues until replaced."),
                              ("Repealed", "Sections 1 to 5 of P.L.1990, c.1 are repealed.")):
            got = sb.status_kwargs(heading, text)
            self.assertEqual(got["status"], "in_force", heading)
            self.assertEqual(got["status_basis"], "current_compilation")
        self.assertIsNone(sb.status_kwargs("Definitions.", ""))
        # a marker word that runs on into ordinary words is not a marker
        self.assertEqual(sb.status_kwargs(None, "Reserved seats shall be ...")["status"], "in_force")


class Rtf(unittest.TestCase):
    def test_rtf_text(self):
        body = (rb"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Times;}}{\*\generator Word;}{\info{\title x}}"
                rb"\pard \'a712-1.  Title of chapter.\par This chapter shall be known as \ldblquote the Code\rdblquote ."
                rb"\par a.\tab first\par R.L. 1910, \'a7 4641.\par " + b"\\u8212?dash}")
        text = sb.rtf_to_text(body)
        self.assertNotIn("Times", text)
        self.assertNotIn("Word", text)
        self.assertIn("§12-1.  Title of chapter.", text)
        self.assertIn("“the Code”", text)
        self.assertIn("a.\tfirst", text)
        self.assertIn("—dash", text)
        self.assertNotIn("?dash", text)


class Oklahoma(unittest.TestCase):
    def test_title_sections(self):
        ok = load("ok")
        text = ("§12-1.  Title of chapter.\nThis chapter shall be known as the Code.\nR.L. 1910, § 4641.\n\n"
                "§12-3.  Repealed by Laws 1984, c. 164, § 32, eff. Nov. 1, 1984.\n\n"
                "§12-19.1.  Affidavit.\nA.  1.  In any civil action ...\nb.\tthe plaintiff ...\n"
                "Added by Laws 2009, c. 228, § 1.\nNOTE:  Laws 2009, c. 228, § 2 was held unconstitutional.\n")
        got = ok.parse_title(text)
        self.assertEqual([(s["title"], s["section"]) for s in got], [("12", "1"), ("12", "3"), ("12", "19.1")])
        self.assertEqual(got[0]["history"], "R.L. 1910, § 4641.")
        self.assertEqual(got[0]["text"], "This chapter shall be known as the Code.")
        self.assertEqual(got[1]["text"], "")
        self.assertEqual(got[2]["history"], "Added by Laws 2009, c. 228, § 1.")
        self.assertNotIn("NOTE", got[2]["text"])
        self.assertEqual(got[2]["notes_dropped"], 1)

    def test_live_is_refused(self):
        with self.assertRaises(lib.Blocked):
            load("ok").acquire(_Ctx())


class Wisconsin(unittest.TestCase):
    TXT = ("\nCHAPTER 893\nLIMITATIONS OF ACTIONS\n\nSUBCHAPTER I\nGENERAL\n893.01 Civil actions.\n893.02 Action, when "
           "commenced.\n\nNOTE:  See the note at the end.\nSUBCHAPTER I\nGENERAL\n"
           "893.01 Civil actions.  Civil actions may be commenced only within the periods prescribed.\n"
           "History:  1979 c. 323.\nJudicial Council Committee’s Note, 1979:  This section remains.\n"
           "Estoppel can be invoked.  State ex rel. Susedik v. Knutson, 52 Wis. 2d 593 (1971).\n"
           "SUBCHAPTER II\nCOMMENCEMENT OF\nACTIONS\nJudicial Council Committee’s Note, 1979:  This subchapter ...\n"
           "893.02 Action, when commenced.  An action is commenced when the summons is filed.\n"
           "(1) First subsection.\nA court has no authority to enlarge the time.  Pulchinski v. Strnad, 88 Wis. 2d 423.\n")

    def test_chapter(self):
        wi = load("wi")
        got = wi.parse_chapter(self.TXT)
        self.assertEqual(got["chapter"], "893")
        first, second = got["sections"]
        self.assertEqual(first["text"], "Civil actions may be commenced only within the periods prescribed.")
        self.assertEqual(first["history"], "1979 c. 323.")
        self.assertEqual(first["subchapter"], ("I", "GENERAL"))
        self.assertEqual(second["subchapter"], ("II", "COMMENCEMENT OF ACTIONS"))
        self.assertIsNone(second["history"])

    def test_annotation_cut_by_print_size(self):
        wi = load("wi")
        lines = ["An action is commenced when the summons is filed.", "(1) First subsection of the statute text.",
                 "A court has no authority to enlarge the time in which to file a complaint."]
        big = wi._key(" ".join(lines[:2]))
        small = wi._key(lines[2])
        kept, dropped = wi.trim_annotations(lines, small, big)
        self.assertEqual(kept, lines[:2])
        self.assertEqual(dropped, 1)


class NewHampshire(unittest.TestCase):
    PAGE = (b"<html><body><center><h1>TITLE LII<br>ACTIONS</h1></center><center><h2>Chapter 508<br>LIMITATION OF "
            b"ACTIONS</h2></center><center><h3>Section 508:4</h3></center>&nbsp;<b> 508:4 Personal Actions. &#150;</b>"
            b"<codesect><br>I. Except as otherwise provided by law, RSA 72:23-<i>l.</i>\n<br>II. Second.</codesect>"
            b"<sourcenote><p><b>Source.</b> RS 181:3. 1981, 556:1.</p></sourcenote><center><h3>Section 508:4-a</h3>"
            b"</center><b> 508:4-a Repealed by 1965, 241:3, eff. Aug. 31, 1965. &#150;</b><codesect>\n</codesect>"
            b"<sourcenote></sourcenote></body></html>")

    def test_chapter(self):
        nh = load("nh")
        got = nh.parse_chapter(self.PAGE)
        self.assertEqual(got["title"], ("LII", "ACTIONS"))
        self.assertEqual(got["chapter"], ("508", "LIMITATION OF ACTIONS"))
        a, b = got["sections"]
        self.assertEqual((a["number"], a["heading"]), ("508:4", "Personal Actions."))
        self.assertEqual(a["text"], "I. Except as otherwise provided by law, RSA 72:23-l.\nII. Second.")
        self.assertEqual(a["history"], "RS 181:3. 1981, 556:1.")
        self.assertEqual(sb.status_kwargs(b["heading"], b["text"])["status"], "repealed")

    def test_live_is_refused(self):
        with self.assertRaises(lib.Blocked):
            load("nh").acquire(_Ctx())


class NewMexico(unittest.TestCase):
    def test_header_and_sections(self):
        nm = load("nm")
        lines = ["                             UNANNOTATED", "                         CHAPTER 71",
                 "                  Energy and Minerals", "ARTICLE 2", "Energy Department",
                 "71-2-8. Confidentiality; penalty.", "    The provisions of any confidential contract shall be",
                 "held confidential.", "    B. Second paragraph.", "History: Laws 1975, ch. 289, § 18.", "",
                 "71-2-9. Recompiled.", "History: Laws 1977, ch. 255, § 1.", ""]
        self.assertEqual(nm.chapter_header(lines), ("71", "Energy and Minerals"))
        got = nm.parse_chapter(lines, "71")
        self.assertEqual([s["number"] for s in got], ["71-2-8", "71-2-9"])
        self.assertEqual(got[0]["text"], "The provisions of any confidential contract shall be held confidential.\n"
                                         "B. Second paragraph.")
        self.assertEqual(got[0]["history"], "Laws 1975, ch. 289, § 18.")
        self.assertEqual(got[0]["article"], ("Article", "2", "Energy Department"))
        self.assertEqual(sb.status_kwargs(got[1]["heading"], got[1]["text"])["status"], "renumbered")


class Ohio(unittest.TestCase):
    PAGE = ("<html><body><div class='breadcrumbs'><a>Ohio Revised Code</a><a>Title 23 Courts - Common Pleas</a>"
            "<a>Chapter 2305 Jurisdiction; Limitation of Actions</a></div><section class='laws-header'><h1>Section "
            "2305.10 | Bodily injury or injury to personal property.</h1></section><div class='laws-section-info'>"
            "<div class=\"laws-section-info-module\"><div class=\"label\">Effective:</div><div class=\"value\">"
            "August 3, 2006</div></div><div class=\"laws-section-info-module\"><div class=\"label\">Latest "
            "Legislation:</div><div class=\"value\">Senate Bill 17 - 126th General Assembly</div></div></div>"
            "<section class='laws-body'><p>(A) Except as provided in division (C) ...</p><p>(B)(1) For purposes "
            "of division (A) ...</p></section><p>The Legislative Service Commission staff updates the Revised Code "
            "on an ongoing basis, as it completes its act review of enacted legislation.</p></body></html>")

    def test_section_page(self):
        oh = load("oh")
        got = oh.parse_section_page(self.PAGE.encode(), "2026-10-23")
        self.assertEqual((got["number"], got["heading"]), ("2305.10", "Bodily injury or injury to personal property."))
        self.assertEqual(got["text"], "(A) Except as provided in division (C) ...\n(B)(1) For purposes of division (A) ...")
        self.assertEqual(got["effective"]["start"], "2006-08-03")
        self.assertFalse(got["future"])
        self.assertEqual(got["title"], ("23", "Courts - Common Pleas"))
        self.assertTrue(got["banner"].startswith("The Legislative Service Commission staff updates"))

    def test_live_needs_owner_decision(self):
        with self.assertRaises(lib.Blocked):
            load("oh").acquire(_Ctx())


class Vermont(unittest.TestCase):
    def test_history_split(self):
        vt = load("vt")
        text, history = vt.split_history("(a) A person who ... shall be fined. (Amended 1967, No. 32, § 2, eff. March "
                                         "16, 1967; 1971, No. 185 (Adj. Sess.).)")
        self.assertEqual(text, "(a) A person who ... shall be fined.")
        self.assertTrue(history.startswith("(Amended 1967"))
        self.assertEqual(vt.split_history("as provided in (1) above (see subsection (b))"),
                         ("as provided in (1) above (see subsection (b))", None))

    def test_ucc_em_dash_numbers(self):
        vt = load("vt")
        page = ('<html><body><ul class="item-list statutes-detail"><li><p></p><div><p style="margin-left:0px"><b>\u00a7 '
                '2\u2014101. Short title</b></p><p style="text-indent:19.2px">This article shall be known and may be cited '
                'as Uniform Commercial Code\u2014Sales.</p></div></li></ul></body></html>').encode()
        sections = vt.parse_fullchapter(page)["sections"]
        self.assertEqual([(s["number"], s["heading"]) for s in sections], [("2-101", "Short title")])

    def test_listed_and_ranged_status_entries(self):
        vt = load("vt")
        page = ('<html><body><ul class="item-list statutes-detail"><li><p></p><div><p style="margin-left:0px"><b>\u00a7\u00a7 '
                '151, 152. Repealed. 1965, No. 81, \u00a7 11.</b></p></div></li><li><p></p><div><p style="margin-left:0px"><b>'
                '\u00a7\u00a7 160-169. Repealed. 1971, No. 14.</b></p></div></li></ul></body></html>').encode()
        sections = vt.parse_fullchapter(page)["sections"]
        self.assertEqual([s.get("number") for s in sections], ["151", "152", None])
        self.assertEqual(sections[0]["heading"], "Repealed. 1965, No. 81, \u00a7 11.")
        self.assertTrue(sections[2]["range"].startswith("\u00a7\u00a7 160-169."))

    def test_identical_repeats_kept_once(self):
        vt = load("vt")
        one = {"number": "6064", "heading": "Claim applied", "text": "The amount ...", "history": "(Added 1969.)"}
        other = dict(one, heading="Claim applied [Effective July 1, 2029 if contingency met]", text="The new amount ...")
        self.assertEqual(vt.unique_copies([one, dict(one), other]), [one, other])


class MontanaVersions(unittest.TestCase):
    def test_temporary_and_contingent_versions_and_rule_numbers(self):
        mt = load("mt")
        today = dt.date(2026, 10, 24).isoformat()  # acquire passes ctx.today.isoformat()
        started = [{"clause": "(Temporary)"}, {"clause": "(Effective October 1, 2026)"}]
        ahead = [{"clause": "(Temporary)"}, {"clause": "(Effective July 1, 2027)"}]
        self.assertTrue(mt.temporary_superseded(started, today))
        self.assertFalse(mt.temporary_superseded(ahead, today))
        # MCA 53-4-1005: a later temporary version with its own date supersedes the undated one once that date has come
        dated = [{"clause": "(Temporary)"}, {"clause": "(Temporary -- effective October 1, 2026)"}]
        self.assertTrue(mt.temporary_superseded(dated, today))
        self.assertEqual(mt.DATED_CLAUSE.match("(Temporary -- effective July 1, 2027)").group(1), "July 1, 2027")
        self.assertTrue(mt.CONTINGENT_CLAUSE.match("(Effective on occurrence of contingency)"))
        self.assertEqual(mt.rule_number("Rule 4", "25", "20"), "25-20 Rule 4")
        self.assertEqual(mt.rule_number("2-18-704", "2", "18"), "2-18-704")


class WestVirginia(unittest.TestCase):
    def test_selected_first_chapter(self):
        wv = load("wv")
        page = ("<option value='1' selected>CHAPTER 1. THE STATE AND ITS SUBDIVISIONS.</option>\r\n"
                "<option value='2'>CHAPTER 2. COMMON LAW, STATUTES.</option><option value='5A'>CHAPTER 5A. "
                "DEPARTMENT OF ADMINISTRATION.</option>")
        self.assertEqual(wv.chapter_options(page), [("1", "THE STATE AND ITS SUBDIVISIONS."), ("2", "COMMON LAW, STATUTES."),
                                                    ("5A", "DEPARTMENT OF ADMINISTRATION.")])


class Utah(unittest.TestCase):
    XML = (b'<title number="78B"><catchline>Judicial Code</catchline><chapter number="78B-2"><catchline>Statutes of '
           b'Limitations</catchline><section number="78B-2-307"><histories><history>Amended by Chapter 99, 2024 '
           b'General Session</history></histories><catchline>Within four years.</catchline>An action may be brought '
           b'within four years:<subsection number="78B-2-307(1)">after the last charge<subsection number='
           b'"78B-2-307(1)(a)">on an open account;</subsection></subsection></section><section number="78B-2-308">'
           b'<catchline>Future.</catchline><effdate>5/6/2027</effdate>Text.</section></chapter></title>')

    def test_title_xml(self):
        ut = load("ut")
        got = ut.parse_title(self.XML)
        s = got["sections"][0]
        self.assertEqual(s["number"], "78B-2-307")
        self.assertEqual(s["heading"], "Within four years.")
        self.assertEqual(s["lines"], ["An action may be brought within four years:", "(1) after the last charge",
                                      "(a) on an open account;"])
        self.assertEqual(s["history"], "Amended by Chapter 99, 2024 General Session")
        self.assertEqual(got["sections"][1]["effdate"], "5/6/2027")


class EarlierModules(unittest.TestCase):
    def test_nc_history(self):
        nc = load("nc")
        text, history = nc.split_history("(a) The action shall be brought within three years. (1943, c. 543; 2021-91, s. 1.)")
        self.assertEqual(text, "(a) The action shall be brought within three years.")
        self.assertEqual(history, "(1943, c. 543; 2021-91, s. 1.)")

    def test_nc_three_part_numbers(self):
        nc = load("nc")
        for head, number, heading in (("§ 25-2-313.  Express warranties by affirmation.", "25-2-313", "Express warranties by affirmation."),
                                      ("§ 36C-1-101.  Short title.", "36C-1-101", "Short title."),
                                      ("§ 1C-1601.  What property exempt.", "1C-1601", "What property exempt."),
                                      ("§ 14-113.20B.  Definitions.", "14-113.20B", "Definitions.")):
            m = nc.SECTION_HEAD.match(head)
            self.assertIsNotNone(m, head)
            self.assertEqual((m.group(1), m.group(2)), (number, heading))

    def test_mo_ucc_numbers(self):
        mo = load("mo")
        for head, number in (("400.2-313. Express warranties by affirmation, promise, description, sample. —", "400.2-313"),
                             ("400.4A-101. Short title. —", "400.4A-101"), ("537.090. Damages to be determined by jury —",
                                                                          "537.090")):
            m = mo.HEAD.match(head)
            self.assertIsNotNone(m, head)
            self.assertEqual(m.group(1), number)
        line = mo.DATE_LINE.search("-------- 400.2-312 8/28/1963 --------")
        self.assertEqual(line.group(1), "400.2-312")

    def test_sc_plain_markup_chapter(self):
        sc = load("sc")
        lines = [("center", "CHAPTER 2A"), ("center", "Commercial Code\u2014Leases"), ("line", "Introduction"),
                 ("line", "Article 2A of the Uniform Commercial Code ..."), ("line", "Part 1"), ("line", "General Provisions"),
                 ("line", "SECTION 36-2A-101. Short title."), ("line", "This chapter may be cited as ..."),
                 ("line", "HISTORY: 2001 Act No. 67, SECTION 2.")]
        got = sc._plain_heads(lines)
        self.assertEqual([k for k, _ in got], ["center", "center", "line", "line", "center", "center", "bold", "line", "line"])
        bold_page = [("bold", "SECTION 36-2-313. Express warranties."), ("line", "SECTION 36-2-314 is cited here.")]
        self.assertEqual(sc._plain_heads(bold_page), bold_page)

    def test_mo_nc_citation_forms(self):
        import sys as _sys
        _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
        from state_law import lib as _lib
        mo, nc = load("mo"), load("nc")
        for cite, want in (("Mo. Rev. Stat. Ann. § 537.090", "537.090"), ("Mo. Stat. § 27.060", "27.060"),
                           ("MO. STAT. §§ 407.010", "407.010"), ("Mo. Rev. Stat. § 400.2-313", "400.2-313"),
                           ("§ 537.090 RSMo", "537.090"), ("V.A.M.S. § 516.120", "516.120")):
            self.assertIn(("RSMO", want), _lib.apply_patterns(mo.META.codes, cite), cite)
        for cite, want in (("N.C. Gen. Stat. Ann. § 25-2-314", "25-2-314"), ("N.C.G.S. § 75-1.1", "75-1.1"),
                           ("N.C. Gen. Stat. § 28A-18-2", "28a-18-2")):
            self.assertIn(("GS", want), _lib.apply_patterns(nc.META.codes, cite), cite)

    def test_nv_number_split_across_spans(self):
        nv = load("nv")
        raw = ('<html><body><p class="SectBody"><span class="Empty">NRS</span><span class="Empty">&#8194;</span>'
               '<span class="Section">388C</span><span class="Section">.140</span><span class="Empty">&#8194;</span>'
               '<span class="Leadline">Rules for academic advancement of pupils.</span></p>'
               '<p class="SectBody">1. The governing body shall adopt rules.</p></body></html>').encode("windows-1252")
        got = nv.parse_chapter(raw)["sections"]
        self.assertEqual([(s["number"], s["heading"]) for s in got], [("388C.140", "Rules for academic advancement of pupils.")])

    def test_in_act_naming_version_notes(self):
        ind = load("in")
        dated = ind.NOTE_RE.match("Note: This version of section amended by P.L.152-2026, SEC.497, effective 7-1-2027. "
                                  "See also preceding version of this section amended by P.L.145-2026, SEC.248.")
        self.assertEqual(dated.groups(), (None, "7", "1", "2027"))
        undated = ind.NOTE_RE.match("Note: This version of section amended by P.L.248-2017, SEC.8. See also preceding "
                                    "version of this section amended by P.L.229-2017, SEC.40.")
        self.assertIsNotNone(undated)
        self.assertIsNone(undated.group(4))
        self.assertEqual(ind.NOTE_RE.match("Note: This version of section effective until 7-1-2027.").group(1), "until ")

    def test_nj_section(self):
        nj = load("nj")
        got = nj.split_section("2A:14-1. Actions of trespass to real property.",
                               "2A:14-1. Every action at law for trespass to real property shall be commenced within 6 "
                               "years.\n\nL.1951 (1st SS), c.344.")
        self.assertEqual(got["number"], "2A:14-1")
        self.assertEqual(got["heading"], "Actions of trespass to real property.")
        self.assertEqual(got["text"], "Every action at law for trespass to real property shall be commenced within 6 years.")
        self.assertEqual(got["history"], "L.1951 (1st SS), c.344.")

    def test_va_body(self):
        va = load("va")
        lines, history = va.body_parts("<p>A. Every action shall be brought within two years.</p><p>B. Second.</p>"
                                       "<p>Code 1950, § 8-24; 1977, c. 617.</p>")
        self.assertEqual(lines, ["A. Every action shall be brought within two years.", "B. Second."])
        self.assertEqual(history, "Code 1950, § 8-24; 1977, c. 617.")

    def test_wy_section_head(self):
        wy = load("wy")
        self.assertEqual(wy.RAW_SECTION.match("1-3-105.  Actions other than recovery of real property.").group(1),
                         "1-3-105")
        self.assertIsNone(wy.RAW_SECTION.match("1-3-105. referred to in text"))


class Texas(unittest.TestCase):
    PAGE = (
        '<html><body><pre>'
        '<p class="left"><a name="21.251"></a></p>'
        '<p style="text-indent:7ex;" class="left"><a href="https://statutes.capitol.texas.gov/Docs/SD/htm/SD.21.htm#21.251"'
        ' style="color:inherit;font-weight:bold;">Sec. 21.251.  CONTRACTS.</a> The district may contract.</p>'
        '<p class="left"><a name="21.252"></a></p>'
        '<p style="text-indent:7ex;" class="left"><a href="https://statutes.capitol.texas.gov/Docs/SD/htm/SD.21.htm#21.252"'
        ' style="color:inherit;font-weight:bold;">Sec. 21.252. </a>BIDS ON CONTRACTS OVER $15,000. The district may'
        ' enter into a contract only after competitive bidding.</p>'
        '<p class="left"><a name="21.253"></a></p>'
        '<p style="text-indent:7ex;" class="left"><a href="https://statutes.capitol.texas.gov/Docs/SD/htm/SD.21.htm#21.253"'
        ' style="color:inherit;font-weight:bold;">Sec. 21.253. </a>(a) The board may adopt rules.</p>'
        '</pre></body></html>'
    )

    def test_catchline_inside_or_after_the_heading_link(self):
        out = load("tx").parse_member(self.PAGE.encode(), "SD", "sd.21.htm", "2026-10-23")
        by = {s["number"]: s for s in out["sections"]}
        self.assertEqual(by["21.251"]["heading"], "CONTRACTS.")
        self.assertEqual(by["21.252"]["heading"], "BIDS ON CONTRACTS OVER $15,000.")
        self.assertTrue(by["21.252"]["text"].startswith("The district may enter into a contract"))
        self.assertIsNone(by["21.253"]["heading"])
        self.assertTrue(by["21.253"]["text"].startswith("(a) The board may adopt rules."))


class OregonChapterList(unittest.TestCase):
    """The ORS title list prints "Chapter 1. …" then bare "2. …" lines (shape of ors001.html / ors011.html, read
    2026-10-27). Reading only the "Chapter" line gave 7,041 sections from 59 chapters on a full run."""
    CH1 = ("<html><body><p>Oregon Revised Statutes</p><p>TITLE 1</p><p>COURTS OF RECORD; COURT OFFICERS; JURIES</p>"
           "<p>Chapter 1. Courts and Judicial Officers Generally</p><p>2. Supreme Court; Court of Appeals</p>"
           "<p>3. Circuit Courts Generally</p><p>72A. Leases</p><p>10. Juries</p><p>_______________</p>"
           "<p>Chapter 1 — Courts and Judicial Officers Generally</p><p>2025 EDITION</p>"
           "<p>1.001 State policy for courts</p></body></html>").encode()
    CH11 = ("<html><body><p>Oregon Revised Statutes</p><p>Chapter 11 (Former Provisions) — Forms of Actions and Suits</p>"
            "<p>TITLE 2</p><p>PROCEDURE IN CIVIL PROCEEDINGS</p><p>Chapter 12. Limitations of Actions and Suits</p>"
            "<p>14. Jurisdiction; Venue; Change of Judge</p><p>25. Child Support Services</p><p>_______________</p>"
            "<p>11.010 [Repealed by 1979 c.284 §199]</p></body></html>").encode()

    def test_list_lines_after_the_first(self):
        orx = load("or")
        self.assertEqual(orx.title_chapters(self.CH1), ["1", "2", "3", "72A", "10"])
        self.assertEqual(orx.title_chapters(self.CH11), ["12", "14", "25"])

    def test_numbers_cover_the_list_the_first_chapter_and_the_range(self):
        orx = load("or")
        group = {"title": "2", "name": "Procedure in Civil Proceedings", "start": "11", "end": "25"}
        numbers = orx.title_chapter_numbers(group, orx.title_chapters(self.CH11))
        self.assertEqual(numbers[0], "11")
        self.assertIn("12", numbers)
        self.assertIn("13", numbers)  # unlisted former-provisions numbers are probed (404 = no file)
        self.assertEqual(numbers[-1], "25")
        self.assertEqual(len(numbers), 15)
        lettered = orx.title_chapter_numbers({"title": "1", "start": "1", "end": "10"}, ["1", "72A"])
        self.assertIn("72A", lettered)
        self.assertEqual(orx.chapter_url("72A"), "https://www.oregonlegislature.gov/bills_laws/ors/ors072a.html")


class Metadata(unittest.TestCase):
    def test_all_modules_validate(self):
        for state in MINE:
            module = load(state.lower())
            self.assertEqual(module.META.state, state)
            module.META.validate()
            if module.META.access == "blocked":
                self.assertTrue(module.META.blocked)
                with self.assertRaises(lib.Blocked):
                    module.acquire(_Ctx())

    def test_citation_patterns(self):
        cases = {"ok": ("Okla. Stat. tit. 12, § 2001", "12:2001"), "wi": ("Wis. Stat. § 893.80", "893.80"),
                 "nh": ("RSA 508:4", "508:4"), "oh": ("R.C. 2305.10", "2305.10"),
                 "vt": ("Vt. Stat. Ann. tit. 12, § 512", "12:512")}
        for state, (cite, number) in cases.items():
            hits = lib.apply_patterns(load(state).META.codes, cite)
            self.assertIn(number, [n for _, n in hits], f"{state}: {cite} -> {hits}")


if __name__ == "__main__":
    unittest.main()
