"""Offline tests for the US Code stream (synthetic fixtures in fixtures/, no network).

  cd scripts/enrichment/uscode && python3 -B -m unittest -v test_uscode
"""
import io
import json
import sys
import unittest
import xml.parsers.expat
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bodytext  # noqa: E402
import cite  # noqa: E402
import lawindex  # noqa: E402
import olrc  # noqa: E402
import release_points  # noqa: E402
import statute_parse  # noqa: E402
import uslm  # noqa: E402
import verify_uscode  # noqa: E402

FIX = HERE / "fixtures"


def parse_fixture(name, key):
    with open(FIX / name, "rb") as fh:
        events = list(uslm.parse_title(fh, key))
    units = [r for k, r in events if k == "unit"]
    containers = sorted((r for k, r in events if k == "container"), key=lambda c: c["index"])
    meta = [r for k, r in events if k == "meta"][0]
    return units, containers, meta


class UslmTitle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.units, cls.containers, cls.meta = parse_fixture("usc99.xml", "99")
        cls.by = {u["key"]: u for u in cls.units}

    def test_meta_and_outline(self):
        self.assertEqual(self.meta["is-positive-law"], "yes")
        kinds = [c["kind"] for c in self.containers]
        self.assertEqual(kinds, ["title", "chapter"])
        self.assertEqual(self.containers[1]["num"], "CHAPTER 1—")
        self.assertEqual(self.containers[1]["heading"], "GENERAL RULES")
        self.assertEqual(self.by["1"]["ancestors"], [0, 1])

    def test_units_and_keys(self):
        self.assertEqual([u["key"] for u in self.units], ["1", "2", "3", "4+5", "2000e-2", "6", "6~2"])
        self.assertEqual(self.by["2000e-2"]["num_value"], "2000e–2")
        self.assertEqual(self.by["6~2"]["repeat"], 2)

    def test_body_structure(self):
        lines = self.by["1"]["lines"]
        self.assertEqual(lines[0], [0, "(a) In any of the following cases the court may vacate the award—"])
        self.assertEqual(lines[1], [1, "(1) where the award was procured by fraud; or"])
        self.assertEqual(lines[2], [1, "(2) where the arbitrators exceeded their powers."])
        self.assertEqual(lines[3], [0, "The court shall state its reasons."])
        self.assertEqual(lines[4], [0, "(b) A rehearing may be directed as the court sets [1] in its order."])
        self.assertEqual(self.by["1"]["footnotes"], [["1", "So in original. Probably should be “sets forth”."]])

    def test_hanging_headings_and_tables(self):
        lines = self.by["2"]["lines"]
        self.assertEqual(lines[0], [0, "(a) In general", "h"])
        self.assertEqual(lines[1], [1, "The Architect shall have charge of work that affects—"])
        self.assertEqual(lines[2], [2, "(1) the structure;"])
        self.assertEqual(lines[3], [0, "(b) Rates", "h"])
        self.assertEqual(lines[4], [0, "A tax determined in accordance with the following table:"])
        self.assertEqual(lines[5], [0, ["If taxable income is:", "The tax is:"], "th"])
        self.assertEqual(lines[6], [0, ["Not over $36,900", "15% of taxable income."], "tr"])

    def test_quoted_content_stays_in_body(self):
        words = " ".join(x[1] for x in self.by["2000e-2"]["lines"])
        self.assertIn("(x) a quoted rule", words)

    def test_status_and_heading_refs(self):
        u = self.by["3"]
        self.assertEqual(u["status"], "repealed")
        self.assertEqual(u["lines"], [])
        self.assertEqual(u["heading_dates"], ["1986-05-19"])
        self.assertEqual([h for h, _ in u["heading_refs"]], ["/us/pl/99/308/s104/b", "/us/stat/100/459"])
        self.assertEqual(self.by["1"]["status"], None)

    def test_source_credit_groups(self):
        g = self.by["1"]["source_credit_groups"]
        self.assertEqual(len(g), 2)
        self.assertEqual(g[0]["text"], "July 30, 1947, ch. 392, 61 Stat. 672")
        self.assertEqual([h for h, _ in g[1]["refs"]], ["/us/pl/101/552/s5", "/us/stat/104/2745"])
        self.assertEqual(g[1]["dates"], ["1990-11-15"])

    def test_notes(self):
        notes = self.by["1"]["notes"]
        self.assertEqual([(n["group"], n["topic"], n["heading"]) for n in notes],
                         [("Editorial Notes", "amendments", "Amendments"),
                          ("Statutory Notes and Related Subsidiaries", "effectiveDateOfAmendment",
                           "Effective Date of 1990 Amendment")])
        self.assertEqual(notes[0]["lines"], [[0, "1990—Pub. L. 101–552 designated existing provisions as subsec. (a)."]])
        self.assertEqual(notes[0]["refs"], [["/us/pl/101/552", "Pub. L. 101–552"]])


class UslmAppendix(unittest.TestCase):
    def test_court_rules_plans_and_unidentified_units(self):
        units, containers, meta = parse_fixture("usc98a.xml", "98a")
        self.assertEqual(meta["is-positive-law"], "no")
        keys = [u["key"] for u in units]
        self.assertEqual(keys[0], "courtRules_Civil_rule4")
        self.assertEqual(keys[1], "reorgPlan_1939_I")
        self.assertTrue(keys[2].endswith("-1") and keys[2].startswith("c"))
        rule = units[0]
        self.assertEqual(rule["kind"], "courtRule")
        self.assertEqual(rule["lines"], [[0, "(a) Contents. A summons must name the court."]])
        group = next(containers[i]["heading"] for i in rule["ancestors"] if containers[i]["kind"] == "courtRules")
        self.assertEqual(cite.citation("98a", rule, group), "98 U.S.C. App., Federal Rules of Civil Procedure, Rule 4")
        plan = units[1]
        self.assertEqual(cite.citation("98a", plan), "98 U.S.C. App., Reorganization Plan No. I of 1939")
        self.assertEqual(plan["lines"], [[0, "Eff. July 1, 1939."], [0, "Section 1. Transfers."]])
        self.assertEqual(units[2]["status"], "transferred")


class Encoding(unittest.TestCase):
    def test_round_trip(self):
        lines = [[0, "(a) Heading", "h"], [1, "text — “quoted”"], [2, ["a", "", "c"], "tr"], [2, ["h1", "h2"], "th"]]
        enc = bodytext.encode(lines)
        self.assertNotIn("\r", enc)
        self.assertEqual(bodytext.decode(enc), lines)
        self.assertEqual(bodytext.decode(""), [])
        self.assertEqual(bodytext.words(lines), ["(a)", "Heading", "text", "—", "“quoted”", "a", "c", "h1", "h2"])

    def test_reserved_characters_rejected(self):
        with self.assertRaises(ValueError):
            bodytext.encode([[0, "bad\ttext"]])


class Citations(unittest.TestCase):
    def test_round_trip(self):
        for tkey, unit in [("42", {"kind": "section", "num_value": "1983"}),
                           ("42", {"kind": "section", "num_value": "2000e–2"}),
                           ("26", {"kind": "section", "num_value": "54A to 54F"}),
                           ("18a", {"kind": "section", "num_value": "2"})]:
            c = cite.citation(tkey, unit)
            p = cite.parse_citation(c)
            self.assertEqual((p["title_key"], p["num"]), (tkey, unit["num_value"]), c)
        self.assertEqual(cite.citation("42", {"kind": "section", "num_value": "1983"}), "42 U.S.C. § 1983")
        self.assertEqual(cite.citation("26", {"kind": "section", "num_value": "54A to 54F"}), "26 U.S.C. §§ 54A to 54F")
        self.assertIsNone(cite.parse_citation("42 U.S.C. §§ 1983"))   # range sign without a range
        self.assertIsNone(cite.parse_citation("Fed. R. Civ. P. 4"))

    def test_smart_title(self):
        self.assertEqual(cite.smart_title("FEDERAL RULES OF CIVIL PROCEDURE"), "Federal Rules of Civil Procedure")
        self.assertEqual(cite.smart_title("TITLE II—CHILDREN'S PROGRAMS"), "Title II—Children's Programs")
        self.assertEqual(cite.smart_title("Already mixed Case"), "Already mixed Case")

    def test_official_urls(self):
        sec = {"kind": "section", "identifier": "/us/usc/t42/s2000e–2"}
        self.assertEqual(cite.plain_section_path("42", sec), "t42/s2000e-2/")
        self.assertIsNone(cite.plain_section_path("42", {"kind": "section", "identifier": "/us/usc/t42/s1...1j"}))
        self.assertIsNone(cite.plain_section_path("2", {"kind": "section", "identifier": "/us/usc/t2/s3 /us/usc/t2/s4"}))
        rule = {"kind": "courtRule", "identifier": "/us/usc/t28a/courtRules/Civil/rule4"}
        self.assertEqual(cite.url_candidates("119-124", "28a", rule, "/us/usc/t28a/courtRules/Civil/tII")[0],
                         "https://uscode.house.gov/us/usc/119-124/t28a/courtRules/Civil/tII/rule4/")


class OlrcPages(unittest.TestCase):
    CURRENT = """<h3 class="releasepointinformation">Public Law 119-124</h3>
<p class="releasepointdescription">All files are current through Public Law 119-124 (October 15, 2026). Titles in bold</p>
<a href="download/releasepoints/us/pl/119/124/xml_uscAll@119-124.zip">[XML]</a>
<div class="uscitem">
  <div class="usctitle">1 - General Provisions <span class="footnote"><a href="#fn" class="fn">&#1645;</a></span></div>
  <div class="itemcurrency">119-124</div>
  <div class="itemdownloadlinks">
    <a href="download/releasepoints/us/pl/119/124/xml_usc01@119-124.zip">[XML]</a>
  </div>
</div>
<div class="uscitem">
  <div class="usctitlechanged">16 - Conservation</div>
  <div class="itemcurrency">119-124</div>
  <div class="itemdownloadlinks">
    <a href="download/releasepoints/us/pl/119/124/xml_usc16@119-124.zip">[XML]</a>
  </div>
</div>
<div class="uscitem">
  <div class="usctitleappendix">Appendix</div>
  <div class="itemcurrency">119-124</div>
  <div class="itemdownloadlinks">
    <a href="download/releasepoints/us/pl/119/124/xml_usc05a@119-124.zip">[XML]</a>
  </div>
</div>"""
    PRIOR = """<p>Public Law 119-121 (October 9, 2026), affecting title 15. </p>
<p><a href="download/119-121.html">x</a> Public Law 119-102not101 (July 12, 2026), except 119-101, affecting titles 5, 16. </p>
<a href="download/119-102not101.html">y</a>"""

    def test_current(self):
        cur = olrc.parse_current(self.CURRENT)
        self.assertEqual((cur["id"], cur["law_date"]), ("119-124", "2026-10-15"))
        rows = {r["key"]: r for r in cur["titles"]}
        self.assertTrue(rows["01"]["positive_law"])
        self.assertTrue(rows["16"]["changed"])
        self.assertFalse(rows["01"]["changed"])
        self.assertEqual(rows["05a"]["label"], "5 - Appendix")

    def test_prior_and_laws(self):
        prior = olrc.parse_prior(self.PRIOR)
        self.assertEqual([p["id"] for p in prior], ["119-121", "119-102not101"])
        self.assertEqual(prior[0]["titles_affected"], ["15"])
        self.assertEqual(prior[1]["titles_affected"], ["5", "16"])
        self.assertEqual(prior[1]["except_text"], "except 119-101")
        self.assertEqual(olrc.parse_rp_id("119-102not101"), {"congress": 119, "through_law": 102, "except_laws": [101]})
        self.assertEqual(olrc.laws_between("119-121", "119-124"), (119, [122, 123, 124]))
        self.assertEqual(olrc.laws_between("119-102not101", "119-102"), (119, [101]))
        self.assertIsNone(olrc.laws_between("118-200", "119-3"))


class Statutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = io.StringIO()
        with open(FIX / "STATUTE-9.xml", "rb") as fh:
            statute_parse.parse_stream(fh, "statute", "https://example.invalid/STATUTE-9.xml", "STATUTE-9.xml", out)
        cls.laws = [json.loads(line) for line in out.getvalue().splitlines()]

    def test_records(self):
        self.assertEqual(len(self.laws), 5)
        a = self.laws[0]
        self.assertEqual(a["public_law"], {"congress": 108, "number": 204, "printed": "Public Law 108–204",
                                           "from": "citableAs"})
        self.assertEqual(a["stat"], {"volume": 118, "page": 542})
        self.assertEqual((a["first_page"], a["last_page"]), (542, 543))
        self.assertEqual(a["bill"], {"href": "/us/bill/108/s/523", "printed": "S. 523"})
        self.assertEqual(a["enacted"], "2004-03-02")
        # quoted text being inserted elsewhere is not a reference of this law
        self.assertEqual(a["usc_refs"], [["/us/usc/t25/s461", "25 USC 461 note", "margin"],
                                         ["/us/usc/t42/s1983", "42 U.S.C. 1983", "text"]])

    def test_numbers_from_short_citation_and_preface(self):
        b = self.laws[1]
        self.assertEqual(b["public_law"]["congress"], 82)
        self.assertEqual(b["public_law"]["number"], 248)
        self.assertEqual((b["chapter"], b["chapter_from"]), (655, "preface"))
        c = self.laws[2]
        self.assertEqual((c["chapter"], c["chapter_from"]), (16, "docNumber"))
        self.assertEqual(c["public_law"]["from"], "longTitle sidenote")
        self.assertEqual(c["enacted"], "1837-03-01")
        self.assertEqual(self.laws[3]["public_private"], "private")
        self.assertEqual(self.laws[4]["doc_tag"], "resolution")

    def test_roman(self):
        self.assertEqual(statute_parse.roman_to_int("XVI"), 16)
        self.assertEqual(statute_parse.roman_to_int("CLXIV"), 164)
        self.assertIsNone(statute_parse.roman_to_int("XCXIX"))     # not a canonical numeral (OCR)
        self.assertEqual(statute_parse.chapter_number("XVI.—"), 16)
        self.assertEqual(statute_parse.chapter_number("565"), 565)


class LawResolution(unittest.TestCase):
    def setUp(self):
        laws = [
            {"id": "stat-104-2735", "public_law": {"congress": 101, "number": 552}, "stat": {"volume": 104, "page": 2735},
             "last_page": 2747, "enacted": "1990-11-15"},
            {"id": "stat-61-669", "chapter": 392, "enacted": "1947-07-30", "stat": {"volume": 61, "page": 669},
             "last_page": 674},
            # two measures GovInfo prints with the same public law number
            {"id": "stat-96-763", "public_law": {"congress": 97, "number": 258}, "stat": {"volume": 96, "page": 763},
             "last_page": 807, "enacted": "1982-09-08"},
            {"id": "stat-96-877", "public_law": {"congress": 97, "number": 258}, "stat": {"volume": 96, "page": 877},
             "last_page": 1086, "enacted": "1982-09-13"},
            {"id": "pl-112-74", "public_law": {"congress": 112, "number": 74}, "enacted": "2011-12-23", "volume": 125},
            {"id": "stat-32-735", "stat": {"volume": 32, "page": 735}, "enacted": "1902-02-07"},
            {"id": "stat-32-735-2", "stat": {"volume": 32, "page": 735}, "enacted": "1902-02-08"},
        ]
        self.idx = lawindex.LawIndex(laws)

    def test_exact_keys(self):
        r = self.idx.resolve_group
        self.assertEqual(r([["/us/pl/101/552/s5", ""], ["/us/stat/104/2745", ""]]),
                         ("stat-104-2735", "public law number + Stat. page"))
        self.assertEqual(r([["/us/act/1947-07-30/ch392", ""], ["/us/stat/61/672", ""]])[0], "stat-61-669")
        self.assertEqual(r([["/us/pl/101/552/s5", ""], ["/us/stat/104/9999", ""]]), (None, "inconsistent"))
        self.assertEqual(r([["/us/pl/97/258", ""]]), (None, "ambiguous"))
        self.assertEqual(r([["/us/pl/97/258", ""], ["/us/stat/96/1000", ""]])[0], "stat-96-877")
        self.assertEqual(r([["/us/pl/1/1", ""]]), (None, "not_found"))
        self.assertEqual(r([]), (None, "no_law_reference"))
        # no page recorded for the law: the public law number alone decides
        self.assertEqual(r([["/us/pl/112/74", ""], ["/us/stat/125/1131", ""]])[0], "pl-112-74")
        # Stat. page alone: only a law starting on that page whose enactment date is printed too
        self.assertEqual(r([["/us/stat/32/735", ""]]), (None, "stat_page_without_law_reference"))
        self.assertEqual(r([["/us/stat/32/735", ""]], ["1902-02-08"])[0], "stat-32-735-2")
        self.assertEqual(r([["/us/stat/61/672", ""]], ["1947-07-30"]), (None, "not_found"))

    def test_split_citation(self):
        items = [["ref", "/us/pl/90/206/tII/s225/l", "Pub. L. 90–206, title II, § 225(l)"],
                 ["ref", "/us/pl/101/194/tVII/s701/i", "Pub. L. 101–194, title VII, § 701(i)"],
                 ["date", "1989-11-30"], ["ref", "/us/stat/103/1764", "103 Stat. 1764"]]
        subs = lawindex.split_citation(items)
        self.assertEqual(subs, [{"refs": [["/us/pl/90/206/tII/s225/l", "Pub. L. 90–206, title II, § 225(l)"]],
                                 "dates": []},
                                {"refs": [["/us/pl/101/194/tVII/s701/i", "Pub. L. 101–194, title VII, § 701(i)"],
                                          ["/us/stat/103/1764", "103 Stat. 1764"]], "dates": ["1989-11-30"]}])
        self.assertEqual(lawindex.split_citation([["date", "1990-01-01"]]), [])

    def test_section_index(self):
        units = {"42": [{"key": "1983", "identifier": "/us/usc/t42/s1983"},
                        {"key": "2000e-2", "identifier": "/us/usc/t42/s2000e–2"},
                        {"key": "3+4", "identifier": "/us/usc/t42/s3 /us/usc/t42/s4"},
                        {"key": "7", "identifier": "/us/usc/t42/s7"},
                        {"key": "7~2", "identifier": "/us/usc/t42/s7"}]}
        idx, dup = lawindex.section_index(units)
        self.assertEqual(lawindex.usc_target("/us/usc/t42/s1983/a/1", idx), "42:1983")
        self.assertEqual(lawindex.usc_target("/us/usc/t42/s2000e-2", idx), "42:2000e-2")
        self.assertEqual(lawindex.usc_target("/us/usc/t42/s4", idx), "42:3+4")
        self.assertIsNone(lawindex.usc_target("/us/usc/t42/s7", idx))        # two units share the number
        self.assertIsNone(lawindex.usc_target("/us/usc/t42/s9999", idx))
        self.assertEqual(dup, {("42", "7")})


class ChangeList(unittest.TestCase):
    def test_compare(self):
        old = {"1:1": ("h1", None, "1 U.S.C. § 1"), "1:2": ("h2", None, "1 U.S.C. § 2"),
               "1:3": ("h3", None, "1 U.S.C. § 3"), "1:4": ("h4", None, "1 U.S.C. § 4")}
        new = {"1:1": ("h1", None, "1 U.S.C. § 1"), "1:2": ("h2x", None, "1 U.S.C. § 2"),
               "1:3": ("h3x", "repealed", "1 U.S.C. § 3"), "1:5": ("h5", None, "1 U.S.C. § 5")}
        c = release_points.compare(old, new)
        self.assertEqual([x[0] for x in c["added"]], ["1:5"])
        self.assertEqual([x[0] for x in c["changed"]], ["1:2"])
        self.assertEqual([x[0] for x in c["repealed"]], ["1:3"])
        self.assertEqual([x[0] for x in c["removed"]], ["1:4"])


class IndependentPath(unittest.TestCase):
    """The verify script's expat reader must find the same words as the renderer on the fixtures."""

    def test_words_agree(self):
        for name, key in (("usc99.xml", "99"), ("usc98a.xml", "98a")):
            units, containers, _ = parse_fixture(name, key)
            reader = verify_uscode.UnitReader(set(range(1, len(units) + 1)))
            p = xml.parsers.expat.ParserCreate(namespace_separator=" ")
            p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = reader.start, reader.end, reader.data
            p.Parse((FIX / name).read_bytes(), True)
            self.assertEqual(reader.count, len(units))
            for i, u in enumerate(units, 1):
                row = {"text": bodytext.encode(u["lines"]),
                       "detail": {"usc": {"heading": u["heading"], "credit": u["source_credit"],
                                          "footnotes": u["footnotes"],
                                          "notes": [{"h": n["heading"], "l": n["lines"], "f": n["footnotes"]}
                                                    for n in u["notes"]]}}}
                got = verify_uscode.record_words(row)
                x = reader.units[i]
                self.assertEqual(verify_uscode.words_of(x["body"]), got["body"], (name, u["key"]))
                self.assertEqual(verify_uscode.words_of(x["heading"]), got["heading"])
                self.assertEqual(verify_uscode.words_of(x["credit"]), got["credit"])
                self.assertEqual([verify_uscode.words_of(f) for f in x["footnotes"]], got["footnotes"])
                self.assertEqual([verify_uscode.words_of(t) + [w for f in fns for w in verify_uscode.words_of(f)]
                                  for t, fns in x["notes"]], got["notes"])


if __name__ == "__main__":
    unittest.main()
