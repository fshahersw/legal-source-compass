"""Offline tests for the state-code outline release builder (synthetic exports, no network).

    cd scripts/legal/state-codes/outline && python3 -B -m unittest -v test_outline_release
"""
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_outline_release as b  # noqa: E402
import dc_toc_names  # noqa: E402
import de_toc_names  # noqa: E402


def export(jurisdiction, rows):
    """rows: [(native_id, citation, heading, [(level, number, heading), ...])]"""
    paths, index, out = [], {}, []
    for native_id, citation, heading, steps in rows:
        key = json.dumps(steps)
        if key not in index:
            index[key] = len(paths)
            paths.append([[lvl, num, head, None] for lvl, num, head in steps])
        out.append([native_id, citation, heading, None, index[key]])
    return {"jurisdiction": jurisdiction, "source_system": f"{jurisdiction.lower()}-test-code",
            "exported_at": "2026-10-23T00:00:00Z", "sections": len(out), "paths": paths, "rows": out}


def flatten(nodes, depth=0):
    for n in nodes:
        yield depth, n
        yield from flatten(n.get("k", []), depth + 1)


class Headings(unittest.TestCase):
    def test_clean_matches_the_site(self):
        # Same vectors as src/lib/law/stateCodeHeading.test.ts cleanHeading().
        self.assertEqual(b.clean_heading("TITLE 12       \tCOMMERCE"), "TITLE 12 COMMERCE")
        self.assertEqual(b.clean_heading("1 Definitions. &#150;"), "1 Definitions. –")
        self.assertEqual(b.clean_heading("One-Cent (1&cent;) Tax"), "One-Cent (1¢) Tax")
        self.assertEqual(b.clean_heading("JURISDICTION%2C CIVIL DIVISIONS"), "JURISDICTION, CIVIL DIVISIONS")
        self.assertEqual(b.clean_heading("EDUCATION CODE%3A PREKINDERGARTEN - GRADE 12"), "EDUCATION CODE: PREKINDERGARTEN - GRADE 12")
        self.assertEqual(b.clean_heading("SCHEDULE<br/>To insure"), "SCHEDULE To insure")
        self.assertEqual(b.clean_heading("Children (2432KB)"), "Children")
        self.assertIsNone(b.clean_heading("   "))
        self.assertEqual(b.norm_heading("TITLE 2.  Department’s  Code."), "title 2. department's code")

    def test_citation_order(self):
        cites = ["1.002", "1.0015", "1.001", "11.001", "2.001", "10A.1", "10.1"]
        self.assertEqual(sorted(cites, key=b.sort_key), ["1.001", "1.0015", "1.002", "2.001", "10.1", "10A.1", "11.001"])
        self.assertEqual(sorted(["CN:1.10", "CN:1.2", "CN:1.9", "CN:1.1"], key=b.sort_key), ["CN:1.1", "CN:1.2", "CN:1.9", "CN:1.10"])
        self.assertEqual(sorted(["101.10", "101.011", "101.09", "101.01"], key=b.sort_key), ["101.01", "101.011", "101.09", "101.10"])


class Restorations(unittest.TestCase):
    def test_dc_paths(self):
        self.assertEqual(b.dc_steps("titles-1-chapters-2-subchapters-IV-parts-E-subparts-2"),
                         [("title", "1"), ("chapter", "2"), ("subchapter", "IV"), ("part", "E"), ("subpart", "2")])
        self.assertEqual(b.dc_steps("titles-1-chapters-11-subchapters-I-parts-F-i")[-1], ("part", "F-i"))
        self.assertEqual(b.dc_steps("titles-99"), [("title", "99")])
        self.assertIsNone(b.dc_steps("chapter-1"))
        self.assertIsNone(b.dc_steps(None))

    def test_texas_code_from_citation(self):
        extras = {"tx_codes": {"AG": "Agriculture Code"}, "names": {}}
        steps = b.restore_steps("TX", "AG:1.001", [["title", None, "TITLE 1. GENERAL PROVISIONS", None]], extras)
        self.assertEqual(steps[0], ("code", "AG", "Agriculture Code", None))
        with self.assertRaises(ValueError):
            b.restore_steps("TX", "ZZ:1.001", [], extras)
        with self.assertRaises(ValueError):
            b.restore_steps("TX", "1.001", [], extras)

    def test_texas_wrapped_heading_completed_and_recorded_line_kept(self):
        extras = {"tx_codes": {"BC": "Business & Commerce Code"}, "names": {},
                  "tx_wrapped": {"BC\x1fCHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR":
                                 "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR PURPOSE OF SOLICITATION"}}
        steps = b.restore_steps("TX", "BC:305.001", [["chapter", None, "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR", None],
                                                     ["subchapter", None, "SUBCHAPTER B. OTHER", None]], extras)
        self.assertEqual(steps[1], ("chapter", None, "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR PURPOSE OF SOLICITATION",
                                    None, "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR"))
        self.assertEqual(steps[2], ("subchapter", None, "SUBCHAPTER B. OTHER", None))
        data = export("TX", [("TX:BC:305.001", "BC:305.001", "s", [("chapter", None, "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR")])])
        top, _, _ = b.build(data, {**extras, "tx_order": {"BC": 0}}, "x")
        self.assertEqual(top[0]["k"][0]["h"], "CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR PURPOSE OF SOLICITATION")
        self.assertEqual(top[0]["k"][0]["hr"], ["CHAPTER 305. TELEPHONIC COMMUNICATIONS MADE FOR"])

    def test_dc_names_only_from_capture(self):
        extras = {"names": {"title:1": "Title 1. Government Organization."}}
        steps = b.restore_steps("DC", "§ 1–204.73.", [["chapter", "titles-1-chapters-2", "§ 1–204.73. Notes.", None]], extras)
        self.assertEqual(steps, [("title", "1", "Title 1. Government Organization.", None), ("chapter", "2", None, None)])
        with self.assertRaises(ValueError):
            b.restore_steps("DC", "x", [["chapter", "not-a-path", "x", None]], extras)


class Build(unittest.TestCase):
    def test_texas_codes_keep_their_titles_apart(self):
        data = export("TX", [
            ("TX:AG:1.001", "AG:1.001", "Sec. 1.001.", [("title", None, "TITLE 1. GENERAL PROVISIONS"),
                                                        ("chapter", None, "CHAPTER 1. GENERAL PROVISIONS")]),
            ("TX:ED:1.001", "ED:1.001", "Sec. 1.001.", [("title", None, "TITLE 1. GENERAL PROVISIONS"),
                                                        ("chapter", None, "CHAPTER 1. GENERAL PROVISIONS")]),
            ("TX:AG:11.001", "AG:11.001", "Sec. 11.001.", [("title", None, "TITLE 2. DEPARTMENT OF AGRICULTURE"),
                                                           ("chapter", None, "CHAPTER 11. ADMINISTRATION")]),
        ])
        extras = {"names": {}, "tx_codes": {"ED": "Education Code", "AG": "Agriculture Code"},
                  "tx_order": {"AG": 0, "ED": 1}}
        top, direct, report = b.build(data, extras, "2026-10-23T00:00:00Z")
        self.assertEqual([(n["n"], n["h"], n["c"]) for n in top], [("AG", "Agriculture Code", 2), ("ED", "Education Code", 1)])
        self.assertEqual([k["h"] for k in top[0]["k"]], ["TITLE 1. GENERAL PROVISIONS", "TITLE 2. DEPARTMENT OF AGRICULTURE"])
        self.assertEqual(direct, [])

    def test_unnumbered_siblings_stay_apart_and_copies_merge(self):
        data = export("OH", [
            ("OH:101.01", "101.01", "a", [("title", None, "Title 1 State Government")]),
            ("OH:301.01", "301.01", "b", [("title", None, "Title 3 Counties")]),
            ("OH:101.02", "101.02", "c", [("title", None, "Title 1  State Government")]),
        ])
        top, _, report = b.build(data, {"names": {}}, "x")
        self.assertEqual([(n["h"], n["c"]) for n in top], [("Title 1 State Government", 2), ("Title 3 Counties", 1)])
        self.assertEqual(report["merged_variants"], 0)  # whitespace-only variants share one key from the start

    def test_numbered_variants(self):
        data = export("WI", [
            ("WI:1", "1", "a", [("chapter", "1", None), ("subchapter", "I", "DAMAGES, RECOVERY, AND MISCELLANEOUS")]),
            ("WI:2", "2", "b", [("chapter", "1", None), ("subchapter", "I", "DAMAGES, RECOVERY, AND MISCELLANEOUS PROVISIONS")]),
            ("WI:3", "3", "c", [("chapter", "1", None), ("subchapter", "I", "DAMAGES, RECOVERY, AND MISCELLANEOUS PROVISIONS")]),
            ("AL:1", "4", "d", [("chapter", "2", None)]),
            ("AL:2", "5", "e", [("chapter", "2", "Local Laws.")]),
            ("ME:1", "6", "f", [("chapter", "3", "ADMINISTRATION")]),
            ("ME:2", "7", "g", [("chapter", "3", "CHILDREN")]),
            ("ME:3", "8", "h", [("chapter", "3", None)]),
        ])
        top, _, report = b.build(data, {"names": {}}, "x")
        ch1 = next(n for n in top if n["n"] == "1")
        self.assertEqual([(k["h"], k["c"], k.get("hv")) for k in ch1["k"]],
                         [("DAMAGES, RECOVERY, AND MISCELLANEOUS PROVISIONS", 3, ["DAMAGES, RECOVERY, AND MISCELLANEOUS"])])
        ch2 = [n for n in top if n["n"] == "2"]
        self.assertEqual([(n["h"], n["c"]) for n in ch2], [("Local Laws.", 2)])
        # Two different named units with one number stay apart; the unnamed rows are not assigned to either.
        ch3 = sorted((n["h"] or "", n["c"]) for n in top if n["n"] == "3")
        self.assertEqual(ch3, [("", 1), ("ADMINISTRATION", 1), ("CHILDREN", 1)])
        self.assertEqual(report["merged_variants"], 2)

    def test_every_section_once(self):
        data = export("OH", [("OH:1", "1", "a", [("title", None, "Title 1 State Government")])])
        data["sections"] = 2
        with self.assertRaises(ValueError):
            b.build(data, {"names": {}}, "x")

    def test_files_and_root(self):
        data = export("OH", [("OH:101.01", "101.01", "a", [("title", None, "Title 1 State Government"),
                                                           ("chapter", None, "Chapter 101 General Assembly")])])
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "OH.json.gz"
            src.write_bytes(gzip.compress(json.dumps(data).encode()))
            summary = b.main(["--export", str(src), "--out", tmp])
            root = json.loads((Path(tmp) / "state-codes/oh/outline-v1/root.json").read_text())
            self.assertEqual(root["schema_version"], b.SCHEMA)
            self.assertEqual(root["projection_sections"], 1)
            self.assertEqual(root["top"][0]["n"], None)
            shard = json.loads((Path(tmp) / root["top"][0]["shard"]).read_text())
            self.assertEqual(shard["nodes"][0]["k"][0]["s"][0][0], "OH:101.01")
            self.assertEqual(summary["sections"], 1)


class CitationProvenUnits(unittest.TestCase):
    def test_alabama_units_the_citation_proves_are_one(self):
        data = export("AL", [
            ("AL:2-1-1", "2-1-1", "a", [("title", "2", "Agriculture."), ("chapter", "1", "General Provisions.")]),
            ("AL:2-1-2", "2-1-2", "b", [("title", "2", ""), ("chapter", "1", "General Provisions.")]),
            ("AL:2-1-3", "2-1-3", "c", [("title", "2", ""), ("chapter", "1", "General Provisions.")]),
            ("AL:2-1-4", "2-1-4", "d", [("title", "2", ""), ("chapter", "1", "Financial Innovation and Market Expansion Act.")]),
            # Two subtitle names on one title: neither is dominant, so the title shows none.
            ("AL:11-1-1", "11-1-1", "e", [("title", "11", "Provisions Applicable to Counties Only."), ("chapter", "1", "x")]),
            ("AL:11-40-1", "11-40-1", "f", [("title", "11", "Provisions Applicable to Municipal Corporations Only."),
                                            ("chapter", "40", "y")]),
        ])
        top, _, report = b.build(data, {"names": {}}, "x")
        self.assertEqual([(t["n"], t["h"]) for t in top], [("2", "Agriculture."), ("11", None)])
        self.assertEqual(sorted(top[1]["hv"]), ["Provisions Applicable to Counties Only.",
                                                "Provisions Applicable to Municipal Corporations Only."])
        chapter = top[0]["k"]
        self.assertEqual([(c["n"], c["h"], c["c"]) for c in chapter], [("1", "General Provisions.", 4)])
        self.assertEqual(chapter[0]["hv"], ["Financial Innovation and Market Expansion Act."])
        self.assertNotIn("", top[0].get("hv", []))
        self.assertEqual(report["merged_by_citation"], 3)

    def test_nothing_merges_unless_every_section_cites_the_number(self):
        data = export("WY", [
            ("WY:c1", "Article 1, Section 1", "a", [("title", "97", "CONSTITUTION"), ("chapter", "1", "Article 1")]),
            ("WY:c2", "Article 2, Section 1", "b", [("title", "97", "CONSTITUTION"), ("chapter", "1", "Article 2")]),
        ])
        top, _, _ = b.build(data, {"names": {}}, "x")
        self.assertEqual(sorted(k["h"] for k in top[0]["k"]), ["Article 1", "Article 2"])
        # Louisiana's citation does not print a chapter: same-numbered chapters with different names stay apart.
        data = export("LA", [("LA:9:1", "La. R.S. 9:1", "a", [("title", "9", "Civil Code-Ancillaries"), ("chapter", "1", "WOMEN")]),
                             ("LA:9:2", "La. R.S. 9:2", "b", [("title", "9", "Civil Code-Ancillaries"), ("chapter", "1", "DIVORCE")])])
        top, _, _ = b.build(data, {"names": {}}, "x")
        self.assertEqual(len(top[0]["k"]), 2)

    def test_dominant_heading(self):
        self.assertEqual(b.dominant_heading({"STATE OFFICERS": 140, "WYOMING ECONOMIC DEVELOPMENT ACT": 1, "": 9}), "STATE OFFICERS")
        self.assertIsNone(b.dominant_heading({"Financial Innovation and Market Expansion Act.": 5, "Consumable Hemp Products": 2,
                                               "Health Benefits Offered by Nonprofit Agricultural Organizations.": 1}))
        self.assertEqual(b.dominant_heading({"Courts.": 2, "COURTS": 1, "": 50}), "Courts.")
        self.assertIsNone(b.dominant_heading({"": 3, None: 1}))


class Delaware(unittest.TestCase):
    NAMES = {"title:6": "Commerce and Trade",
             "title:6/c002": {"subtitle": ["I", "Uniform Commercial Code"], "level": "article", "number": "2", "heading": "Sales"},
             "title:6/c012_1": {"subtitle": ["II", "Other Laws Relating to Commerce and Trade"], "level": "chapter",
                                "number": "12", "heading": "DELAWARE FALSE CLAIMS AND REPORTING ACT"}}

    def test_ucc_part_recorded_as_title_heading_becomes_its_own_level(self):
        steps = b.restore_steps("DE", "§ 2-101", [["title", "6", "Part 1", None], ["chapter", "2", "", None],
                                                  ["subchapter", "sc01", "", None]], {"names": self.NAMES})
        self.assertEqual(steps, [("title", "6", "Commerce and Trade", None), ("subtitle", "I", "Uniform Commercial Code", None),
                                 ("article", "2", "Sales", None), ("part", "1", None, None)])

    def test_recorded_headings_are_kept(self):
        steps = b.restore_steps("DE", "§ 1201", [["title", "6", "", None],
                                                 ["chapter", "012_1", "CHAPTER 12. Delaware False Claims and Reporting Act", None]],
                                {"names": self.NAMES})
        self.assertEqual(steps[2], ("chapter", "012_1", "CHAPTER 12. Delaware False Claims and Reporting Act", None))
        self.assertEqual(steps[1], ("subtitle", "II", "Other Laws Relating to Commerce and Trade", None))
        # A title without a captured table of contents is untouched.
        same = [("title", "5", "Banking", None), ("chapter", "1", "", None)]
        self.assertEqual(b.restore_steps("DE", "§ 101", [list(s) for s in same], {"names": self.NAMES}), same)

    def test_refuses_what_it_cannot_place(self):
        with self.assertRaises(ValueError):  # unit not in the captured table of contents
            b.restore_steps("DE", "§ 99-101", [["title", "6", "", None], ["chapter", "99", "", None]], {"names": self.NAMES})
        with self.assertRaises(ValueError):  # "Part 2" whose subchapter is sc01
            b.restore_steps("DE", "§ 2-201", [["title", "6", "Part 2", None], ["chapter", "2", "", None],
                                              ["subchapter", "sc01", "", None]], {"names": self.NAMES})

    def test_one_title_six(self):
        data = export("DE", [("DE:2-101", "§ 2-101", "a", [("title", "6", "Part 1"), ("chapter", "2", ""), ("subchapter", "sc01", "")]),
                             ("DE:2-201", "§ 2-201", "b", [("title", "6", "Part 2"), ("chapter", "2", ""), ("subchapter", "sc02", "")]),
                             ("DE:1201", "§ 1201", "c", [("title", "6", ""), ("chapter", "012_1", "CHAPTER 12. Delaware False Claims")])])
        top, _, _ = b.build(data, {"names": self.NAMES}, "x")
        self.assertEqual([(n["l"], n["n"], n["h"]) for n in top], [("title", "6", "Commerce and Trade")])
        article = top[0]["k"][0]["k"][0]
        self.assertEqual((article["l"], article["n"], article["h"]), ("article", "2", "Sales"))
        self.assertEqual([(p["l"], p["n"], p.get("h")) for p in article["k"]], [("part", "1", None), ("part", "2", None)])

    def test_toc_extraction(self):
        index = ('<a href="&#xA;  title6/index.html&#xA; ">\n  Title 6 - Commerce and Trade</a>'
                 '<a href="&#xA;  title6/title6.pdf&#xA; ">Authenticated PDF</a>')
        self.assertEqual(de_toc_names.title_names(index), {"6": "Commerce and Trade"})
        page = ('<h3> Subtitle I</h3> <h3>Uniform Commercial Code</h3>'
                '<div class="title-links"><a href="../title6/c002a/index.html"> Article 2A. Leases</a></div>'
                '<h3> Subtitle II</h3>\n<h3>Other Laws Relating to Commerce and Trade</h3>'
                '<div class="title-links"><a href="../title6/c012_1/index.html"> Chapter 12. DELAWARE FALSE CLAIMS AND REPORTING ACT</a></div>')
        self.assertEqual(de_toc_names.title_units("6", page), {
            "title:6/c002a": {"subtitle": ["I", "Uniform Commercial Code"], "level": "article", "number": "2A", "heading": "Leases"},
            "title:6/c012_1": {"subtitle": ["II", "Other Laws Relating to Commerce and Trade"], "level": "chapter", "number": "12",
                               "heading": "DELAWARE FALSE CLAIMS AND REPORTING ACT"}})
        with self.assertRaises(ValueError):
            de_toc_names.title_units("6", '<a href="../title6/c001/index.html">General Provisions</a>')
        self.assertEqual(b.de_slug("2"), "c002")
        self.assertEqual(b.de_slug("012_1"), "c012_1")
        self.assertIsNone(b.de_slug("sc01"))


class DcToc(unittest.TestCase):
    def test_title_names(self):
        page = ('<a class="x" href="/us/dc/council/code/titles/1">Title 1. Government Organization.</a>'
                '<a href="/us/dc/council/code/titles/29A"><span>Title 29A.</span> Business Organizations.</a>')
        self.assertEqual(dc_toc_names.title_names(page), {"title:1": "Title 1. Government Organization.",
                                                          "title:29A": "Title 29A. Business Organizations."})
        with self.assertRaises(ValueError):
            dc_toc_names.title_names('<a href="/us/dc/council/code/titles/2">Title 3. Wrong.</a>')


if __name__ == "__main__":
    unittest.main()
