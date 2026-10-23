"""Offline tests for the ecfr_authorities parsers and builders (fixtures only, no network).

  cd scripts/enrichment/ecfr_authorities && python3 -B -m unittest -v test_ecfr_authorities
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import agencies_parse as A  # noqa: E402
import authorities_common as C  # noqa: E402
import build_agencies as BA  # noqa: E402
import build_ptoa as BP  # noqa: E402
import build_subject as BS  # noqa: E402
import ptoa_parse as P  # noqa: E402
import subject_parse as S  # noqa: E402
import verify_ptoa as V  # noqa: E402

with open(os.path.join(HERE, "fixtures", "ptoa_sample.htm"), encoding="utf-8") as fh:
    SAMPLE = fh.read()
RESULT = P.parse(SAMPLE)
BY = {(e.heading, e.authority): e for e in RESULT.entries}


def groups(e):
    return [(g.cfr_title, g.tokens) for g in e.groups]


class PtoaParseTests(unittest.TestCase):
    def test_header_facts(self):
        self.assertEqual(RESULT.revised_as_of, "January 1, 2025")
        self.assertEqual(RESULT.pages, (964, 965))

    def test_simple_entry(self):
        e = BY[("1 U.S.C.", "112")]
        self.assertEqual((e.category, e.usc_title, e.page), ("usc", "1", 964))
        self.assertEqual(groups(e), [(1, ["2"])])
        self.assertEqual(groups(BY[("1 U.S.C.", "112a")]), [(22, ["181"])])

    def test_wrapped_list_and_following_title_group(self):
        e = BY[("3 U.S.C.", "301")]
        self.assertEqual([g.cfr_title for g in e.groups], [31, 32])
        self.assertEqual(e.groups[0].tokens[0], "510")
        self.assertEqual(e.groups[0].tokens[-1], "599")
        self.assertEqual(len(e.groups[0].tokens), 30)
        self.assertEqual(groups(e)[1], (32, ["719"]))

    def test_et_seq_period_is_restored_and_groups_are_split(self):
        e = BY[("5 U.S.C.", "301 et seq.")]
        self.assertEqual([g.cfr_title for g in e.groups], [20, 29, 30])
        self.assertEqual(e.groups[2].tokens, ["590", "1202", "1206", "1207", "1208", "1210", "1212", "1218", "1243", "1290"])
        self.assertEqual(P.classify_usc(e.authority), {"kind": "et_seq", "keys": [], "start": "301", "end": None})

    def test_note_range_and_exact_classification(self):
        self.assertEqual(P.classify_usc("301 note")["kind"], "note")
        self.assertEqual(P.classify_usc("301 note")["keys"], ["301"])
        self.assertEqual(P.classify_usc("301--303"), {"kind": "range", "keys": [], "start": "301", "end": "303"})
        self.assertEqual(P.classify_usc("441a-1")["keys"], ["441a-1"])
        self.assertEqual(P.classify_usc("2000bb-1")["kind"], "exact")
        self.assertEqual(P.classify_usc("App.")["kind"], "appendix_whole")
        self.assertEqual(P.classify_usc("42301 preceding note")["kind"], "other")
        self.assertEqual(P.classify_usc("460bb app")["kind"], "other")
        self.assertEqual(P.classify_usc("30 et seq.")["start"], "30")

    def test_glued_abbreviations_are_classified_without_changing_the_printed_text(self):
        self.assertEqual(BY[("15 U.S.C.", "637note")].authority, "637note")
        self.assertEqual(P.classify_usc("637note")["keys"], ["637"])
        self.assertEqual(BY[("12 U.S.C.", "1461et seq.")].authority, "1461et seq.")
        self.assertEqual(P.classify_usc("1461et seq.")["start"], "1461")

    def test_appendix_heading_is_a_separate_title(self):
        e = BY[("5 U.S.C. Appendix", "App.")]
        self.assertEqual(e.usc_title, "5a")
        self.assertEqual(groups(e), [(5, ["295", "2600", "2601"]), (5, ["9801"])])
        self.assertEqual(BY[("5 U.S.C. Appendix", "I")].groups[0].tokens, ["1a"])

    def test_entry_with_extra_indent_is_still_an_entry(self):
        e = BY[("8 U.S.C.", "1282")]
        self.assertEqual(groups(e), [(8, ["208", "209", "214"])])
        self.assertEqual(groups(BY[("8 U.S.C.", "1281")]), [(8, ["214", "251", "252"])])
        self.assertTrue(any("indented" in a["kind"] for a in RESULT.anomalies))

    def test_continuation_after_a_page_marker_belongs_to_the_last_entry(self):
        e = BY[("12 U.S.C.", "1461et seq.")]
        self.assertEqual(groups(e), [(12, ["1703"]), (24, ["1006"])])
        self.assertEqual(e.page, 964)

    def test_hyphen_at_line_end_joins_a_designation(self):
        e = BY[("20 U.S.C.", "905")]
        toks = e.groups[0].tokens
        self.assertIn("302-12", toks)
        self.assertEqual(len(toks), 19)
        self.assertEqual(e.groups[0].unparsed_tokens, [])

    def test_irc_headings_keep_their_variant(self):
        self.assertEqual(BY[("26 U.S.C. (1939 I.R.C.)", "62")].variant, "1939 I.R.C.")
        self.assertEqual(BY[("26 U.S.C. (1986 I.R.C.)", "7805")].variant, "1986 I.R.C.")
        self.assertEqual(BY[("26 U.S.C. (1986 I.R.C.)", "7805")].usc_title, "26")

    def test_part_ranges_are_kept_and_not_expanded(self):
        g = BY[("41 U.S.C.", "414")].groups[0]
        self.assertEqual(g.part_ranges, ["1301--1309", "1311--1319"])
        self.assertEqual(g.parts, ["1339"])

    def test_missing_comma_is_kept_as_one_unparsed_token(self):
        g = BY[("49 U.S.C.", "106")].groups[0]
        self.assertEqual(g.unparsed_tokens, ["152 153"])
        self.assertEqual(g.parts, ["140", "150", "155"])

    def test_authority_without_leader_is_joined_to_its_group_line_and_counted(self):
        e = BY[("129 Stat.", "457")]
        self.assertTrue(e.leader_missing)
        self.assertEqual(groups(e), [(31, ["1010"])])
        self.assertTrue(any(a["kind"].startswith("entry without leader") for a in RESULT.anomalies))
        self.assertEqual(groups(BY[("129 Stat.", "362")]), [(42, ["413"])])

    def test_other_categories(self):
        self.assertEqual(BY[("Public Laws", "87-328")].category, "publaw")
        self.assertEqual(groups(BY[("Public Laws", "87-328")]), [(18, ["410", "415", "520", "430"])])
        n = BY[("Notices:", "Aug. 7, 2015")]
        self.assertEqual((n.category, n.sub), ("presidential", "Notices"))
        self.assertEqual([g.cfr_title for g in BY[("Proclamations:", "3004")].groups], [8, 22])
        self.assertEqual(BY[("Executive Orders:", "October 7, 2022")].sub, "Executive Orders")
        self.assertEqual([g.cfr_title for g in BY[("Reorganization Plans:", "1950 Plan No. 3")].groups], [25, 36])
        self.assertEqual(BY[("Memorandums:", "404")].groups[0].tokens, ["3", "20", "111"])

    def test_no_unexplained_anomaly(self):
        kinds = sorted(a["kind"] for a in RESULT.anomalies)
        self.assertEqual(len([k for k in kinds if "indented" in k]), 2)
        self.assertEqual(len([k for k in kinds if k.startswith("entry without leader")]), 1)
        self.assertEqual(len(kinds), 3)

    def test_group_splitter_never_drops_text(self):
        gs = P.split_groups("31 Parts 510, 525 32 Part 719 33 Parts 1, 2-3, x9")
        self.assertEqual([g.cfr_title for g in gs], [31, 32, 33])
        self.assertEqual(gs[2].unparsed_tokens, ["x9"])
        lead = P.split_groups("junk 5 Part 1")
        self.assertEqual(lead[0].cfr_title, 0)
        self.assertEqual(lead[0].unparsed_tokens, ["junk"])


SECTIONS = {"1:112", "5:301", "5:301a", "3:301", "20:905", "8:1281", "26:7805", "26:1", "5a:c1-1"}
PARTS = {"cfr:1:part-2", "cfr:31:part-510", "cfr:20:part-658", "cfr:42:part-413", "cfr:31:part-1010"}


class LinkTests(unittest.TestCase):
    def link(self, heading, authority):
        return C.usc_link(BY[(heading, authority)], SECTIONS)

    def test_exact_match_links_only_on_title_and_key(self):
        l = self.link("1 U.S.C.", "112")
        self.assertEqual((l["state"], l["id"], l["href"]), ("resolved", "1:112", "/law/uscode/1/112"))
        self.assertEqual(self.link("1 U.S.C.", "112a")["state"], "not_in_stored_code")
        self.assertEqual(self.link("8 U.S.C.", "1282")["state"], "not_in_stored_code")
        self.assertEqual(self.link("3 U.S.C.", "301")["id"], "3:301")  # same key, other title: no cross-title match

    def test_note_links_to_its_section_with_its_own_state(self):
        l = self.link("5 U.S.C.", "301 note")
        self.assertEqual((l["state"], l["id"]), ("resolved_note", "5:301"))

    def test_range_and_et_seq_are_never_linked_and_record_their_ends(self):
        r = self.link("3 U.S.C.", "301--303")
        self.assertEqual((r["state"], r["start_stored"], r["end_stored"]), ("range", True, False))
        e = self.link("5 U.S.C.", "301 et seq.")
        self.assertEqual((e["state"], e["start"], e["start_stored"]), ("et_seq", "301", True))
        self.assertNotIn("href", r)
        self.assertNotIn("href", e)

    def test_1939_code_is_not_matched_to_the_stored_1986_title(self):
        l = self.link("26 U.S.C. (1939 I.R.C.)", "62")
        self.assertEqual(l["state"], "not_in_stored_code")
        self.assertIn("1939", l["reason"])
        self.assertEqual(self.link("26 U.S.C. (1986 I.R.C.)", "7805")["state"], "resolved")

    def test_appendix_uses_its_own_title_and_other_forms_stay_as_published(self):
        self.assertEqual(self.link("5 U.S.C. Appendix", "I")["state"], "other_form")
        self.assertEqual(self.link("5 U.S.C. Appendix", "App.")["state"], "other_form")

    def test_non_usc_authorities_are_not_applicable(self):
        self.assertEqual(self.link("Public Laws", "87-328")["state"], "not_applicable")
        self.assertEqual(C.usc_filter_values(BY[("Public Laws", "87-328")], {"state": "not_applicable"}), {})

    def test_filter_values_for_pages(self):
        e = BY[("5 U.S.C.", "301 et seq.")]
        self.assertEqual(C.usc_filter_values(e, C.usc_link(e, SECTIONS)), {"usc_edge": ["5:301"]})
        r = BY[("3 U.S.C.", "301--303")]
        self.assertEqual(C.usc_filter_values(r, C.usc_link(r, SECTIONS)), {"usc_edge": ["3:301", "3:303"]})
        x = BY[("1 U.S.C.", "112")]
        self.assertEqual(C.usc_filter_values(x, C.usc_link(x, SECTIONS)), {"usc": ["1:112"]})
        n = BY[("5 U.S.C.", "301 note")]
        self.assertEqual(C.usc_filter_values(n, C.usc_link(n, SECTIONS)), {"usc": ["5:301"]})
        old = BY[("26 U.S.C. (1939 I.R.C.)", "62")]
        self.assertEqual(C.usc_filter_values(old, C.usc_link(old, SECTIONS)), {})

    def test_part_state_is_exact(self):
        self.assertEqual(C.part_state(31, "510", PARTS)["state"], "resolved")
        self.assertEqual(C.part_state(31, "510", PARTS)["href"], "/law/cfr/31/part/510")
        self.assertEqual(C.part_state(32, "510", PARTS)["state"], "not_in_stored_ecfr")
        self.assertEqual(C.part_state(31, "5100", PARTS)["state"], "not_in_stored_ecfr")


class PtoaRowsTests(unittest.TestCase):
    rows, stats = BP.build_rows(RESULT, year="2025", retrieved_at="2026-10-23T00:00:00Z", section_ids=SECTIONS, part_ids=PARTS)
    by_id = {r["id"]: r for r in rows}

    def test_one_row_per_authority_and_cfr_title(self):
        self.assertEqual(self.stats["entries"], len(RESULT.entries))
        self.assertEqual(self.stats["rows"], sum(len(e.groups) for e in RESULT.entries))
        self.assertEqual(len(self.by_id), len(self.rows))
        r = self.by_id["usc:5:301_et_seq.:cfr29"]
        self.assertEqual(r["detail"]["ptoa"]["cfr"]["parts"], ["290"])
        self.assertEqual(r["filters"]["usc_edge"], ["5:301"])

    def test_repeated_authority_gets_distinct_ids(self):
        again = P.parse(SAMPLE.replace("1 U.S.C.\n  112....", "1 U.S.C.\n  112....").replace("112a.......", "112.......", 1))
        rows, _ = BP.build_rows(again, year="2025", retrieved_at="x", section_ids=SECTIONS, part_ids=PARTS)
        ids = [r["id"] for r in rows if r["id"].startswith("usc:1:112:")]
        self.assertEqual(sorted(ids), ["usc:1:112:cfr1", "usc:1:112:cfr22"])
        twice = P.parse(SAMPLE.replace("112a.......................................................22 Part 181", "112........................................................1 Part 9"))
        rows2, _ = BP.build_rows(twice, year="2025", retrieved_at="x", section_ids=SECTIONS, part_ids=PARTS)
        self.assertEqual(sorted(r["id"] for r in rows2 if r["id"].startswith("usc:1:112:")), ["usc:1:112:cfr1", "usc:1:112:cfr1~2"])

    def test_resolved_and_unresolved_counts(self):
        s = self.stats["authority_link_states"]
        self.assertEqual(s["usc/resolved"], sum(1 for e in RESULT.entries if C.usc_link(e, SECTIONS)["state"] == "resolved"))
        self.assertEqual(s["usc/range"], 2)
        self.assertEqual(self.stats["part_range_tokens"], 2)
        self.assertEqual(self.stats["unparsed_part_tokens"], 1)
        self.assertEqual(self.stats["distinct_cfr_parts_stored"], len({(g.cfr_title, p) for e in RESULT.entries for g in e.groups for p in g.parts if f"cfr:{g.cfr_title}:part-{p}" in PARTS}))

    def test_row_shape(self):
        r = self.by_id["usc:1:112:cfr1"]
        self.assertEqual(r["dataset"], C.DATASET)
        self.assertEqual(r["category"], C.DATASET)
        self.assertIn("#page=", r["source_url"])
        self.assertTrue(r["source_url"].startswith("https://www.govinfo.gov/content/pkg/GPO-CFR-INDEX-2025/pdf/"))
        self.assertEqual(r["item"]["cells"]["authority"], "1 U.S.C. 112")
        self.assertEqual(r["item"]["cells"]["parts_stored"], "1 of 1")
        self.assertIn("/law/uscode/1/112", [l["url"] for l in r["item"]["links"]])
        self.assertEqual(r["filters"]["cfr_part"], ["1:2"])
        self.assertEqual(json.loads(json.dumps(r)), r)

    def test_unstored_parts_are_listed_but_not_marked_stored(self):
        r = self.by_id["usc:3:301:cfr31"]
        c = r["detail"]["ptoa"]["cfr"]
        self.assertEqual(len(c["parts"]), 30)
        self.assertEqual(c["parts_stored"], ["510"])
        self.assertEqual(r["item"]["cells"]["parts_stored"], "1 of 30")

    def test_leader_missing_row_says_so(self):
        r = self.by_id["stat:129:457:cfr31"]
        self.assertTrue(r["detail"]["ptoa"]["leader_missing"])
        self.assertTrue(any(f[0] == "Typesetting note" for f in r["detail"]["facts"]))
        self.assertEqual(r["detail"]["ptoa"]["link"]["state"], "not_applicable")

    def test_pdf_page_mapping(self):
        self.assertEqual(BP.pdf_page_of(964, 964), 2)
        self.assertEqual(BP.pdf_page_of(1070, 964), 108)
        self.assertIsNone(BP.pdf_page_of(None, 964))


class PdfCrossCheckTests(unittest.TestCase):
    RAW = (
        "intro\n1 U.S.C.\n112....................................................1 Part 2\n"
        "3 U.S.C.\n301.......31 Parts 510, 525,\n526\n32 Part 719\n"
        "VerDate Sep 11 2014\nrmajette\non\nCFR\n965\nAuthorities\n3 U.S.C.—Continued\n"
        "301 et seq ......................20 Part 658\n41 Part 101–\n19\n"
    )

    def test_independent_reader_and_comparison(self):
        entries = V.parse_pdf_text(V.repair_bare(self.RAW))
        self.assertEqual([e["authority"] for e in entries], ["112", "301", "301 et seq"])
        self.assertEqual(entries[1]["groups"], [(31, ["510", "525", "526"]), (32, ["719"])])
        self.assertEqual(entries[2]["groups"], [(20, ["658"]), (41, ["101-19"])])
        self.assertEqual(V.norm_auth("301—303"), V.norm_auth("301--303"))
        self.assertEqual(V.norm_auth("301 et seq"), V.norm_auth("301 et seq."))

    def test_bare_authority_repair_is_structural(self):
        raw = "129 Stat.\n362 ....42 Part 413\n457\n31 Part 1010\n458—459 .....31 Part 590\n"
        self.assertIn("457 ........ 31 Part 1010", V.repair_bare(raw))
        cont = "301 ....31 Parts 1243,\n1290\n31 Part 251\n"
        self.assertNotIn("........", V.repair_bare(cont).split("\n")[1])


# ---------------------------------------------------------------------------------------------------------------------
def L(page, col, x, text, bold=False, xref=False, top=0.0, big=False):
    return S.Line(pdf_page=page, col=col, top=top, x_rel=x, bold=bold, xref_first=xref, text=text, big=big)


class SubjectParseTests(unittest.TestCase):
    LINES = [
        L(2, 0, 81, "A", bold=True),
        L(2, 0, 0, "Accidents", bold=True),
        L(2, 0, 0, "See Safety", xref=True),
        L(2, 0, 0, "Accountants", bold=True),
        L(2, 0, 0, "Energy Policy Act, form and content of financial statements, 17 CFR 210"),
        L(2, 0, 18, "(wrapped, see 5 CFR 3)"),
        L(2, 0, 0, "Practice before"),
        L(2, 0, 9, "Farm Credit Administration, 12 CFR 623"),
        L(2, 0, 9, "Internal Revenue Service, 31 CFR 10"),
        L(2, 0, 0, "See also Business and industry; Uniform", xref=True),
        L(2, 0, 42, "System of Accounts"),
        L(2, 1, 0, "Nondiscrimination on basis of disability, 41 CFR 101–8, 41 CFR 105–8"),
        L(2, 1, 9, "Income taxes, 26 CFR 1 (1.1–1.11)"),
        L(2, 1, 0, "Federal Government, equal employment opportunity, 29 CFR"),
        L(3, 0, 36, "1614"),
        L(3, 0, 0, "Agriculture Department", bold=True),
        L(3, 0, 0, "Papaha¯ naumoku¯akea Marine Monument, 50 CFR 404"),
        L(3, 0, 0, "A very long subject heading that wraps", bold=True),
        L(3, 0, 18, "onto a second line", bold=True),
        L(3, 0, 0, "Entry with no reference at all"),
    ]

    def setUp(self):
        self.heads, self.anoms = S.build(self.LINES)

    def test_headings_come_from_the_typeface(self):
        self.assertEqual([h.text for h in self.heads], ["Accidents", "Accountants", "Agriculture Department", "A very long subject heading that wraps onto a second line"])
        self.assertEqual(self.anoms, [])

    def test_xrefs_and_wraps(self):
        acc = self.heads[1].entries
        self.assertEqual(acc[0].text, "Energy Policy Act, form and content of financial statements, 17 CFR 210 (wrapped, see 5 CFR 3)")
        self.assertEqual([r["title"] for r in acc[0].refs], [17, 5])
        self.assertEqual([(e.level, e.xref) for e in acc], [(0, False), (0, False), (1, False), (1, False), (0, True), (0, False), (1, False), (0, False)])
        x = [e for e in acc if e.xref][0]
        self.assertEqual(x.text, "See also Business and industry; Uniform System of Accounts")
        self.assertEqual(self.heads[0].entries[0].text, "See Safety")

    def test_references_normalise_dashes_and_keep_section_ranges(self):
        e = self.heads[1].entries[5]
        self.assertEqual(e.refs, [{"title": 41, "part": "101-8", "sections": None}, {"title": 41, "part": "105-8", "sections": None}])
        t = self.heads[1].entries[6]
        self.assertEqual(t.refs, [{"title": 26, "part": "1", "sections": "1.1–1.11"}])

    def test_number_after_a_dangling_cfr_continues_the_entry(self):
        e = self.heads[1].entries[7]
        self.assertEqual(e.text, "Federal Government, equal employment opportunity, 29 CFR 1614")
        self.assertEqual(e.refs, [{"title": 29, "part": "1614", "sections": None}])

    def test_diacritics_are_recomposed_and_missing_refs_stay_empty(self):
        self.assertEqual(S.recompose("Papaha\u00afnaumokua\u00afkea"), "Papah\u0101naumoku\u0101kea")
        self.assertEqual(S.recompose("a\u00af"), "\u0101")
        last = self.heads[3].entries[-1]
        self.assertEqual((last.text, last.refs), ("Entry with no reference at all", []))

    def test_title_lines_and_dividers_are_skipped(self):
        lines = [L(2, 0, 0, "intro text before the first divider"), L(2, 0, 81, "A", bold=True), L(2, 1, 42, "INDEX", big=True), L(2, 0, 0, "Heading", bold=True)]
        heads, anoms = S.build(lines)
        self.assertEqual([h.text for h in heads], ["Heading"])
        self.assertEqual(anoms, [])

    def test_join_rules(self):
        self.assertEqual(S._join("Indians-", "business"), "Indians-business")
        self.assertEqual(S._join("Acquisition regulations—", "Protests"), "Acquisition regulations—Protests")
        self.assertEqual(S._join("a", "b"), "a b")

    def test_ref_regex_does_not_match_inside_words_or_decimals(self):
        self.assertEqual(S.extract_refs("see 1.5 CFR 20 and 21 CFR 314.70"), [{"title": 21, "part": "314", "sections": None}])
        self.assertEqual(S.extract_refs("48 CFR Chapter 1, 2 CFR Part 200"), [])


class SubjectRowsTests(unittest.TestCase):
    def test_rows_filters_and_segments(self):
        heads, _ = S.build(SubjectParseTests.LINES)
        rows, stats = BS.build_rows(heads, year="2025", retrieved_at="r", part_ids={"cfr:17:part-210", "cfr:41:part-101-8"}, revised_as_of="January 1, 2025")
        self.assertEqual(stats["headings"], 4)
        self.assertEqual(len(rows), 4)
        r = {x["id"]: x for x in rows}["subject:Accountants"]
        self.assertEqual(r["filters"]["cfr_part"], ["5:3", "12:623", "17:210", "26:1", "29:1614", "31:10", "41:101-8", "41:105-8"])
        self.assertEqual(r["filters"]["letter"], ["A"])
        self.assertEqual(r["item"]["cells"]["page"], "3")
        self.assertEqual(stats["cfr_references_to_stored_parts"], 2)
        self.assertEqual(stats["distinct_cfr_parts_stored"], 2)

    def test_long_heading_is_split_at_first_level_entries(self):
        entries = [S.Entry(level=i % 3, text=f"e{i}", xref=False, pdf_page=2, x_rel=0) for i in range(10)]
        segs = BS.segments(entries, size=4)
        self.assertEqual(sum(len(s) for s in segs), 10)
        self.assertTrue(all(s[0].level == 0 or len(segs[i - 1]) >= 8 for i, s in enumerate(segs) if i))
        self.assertEqual(BS.segments([], size=4), [[]])


class AgenciesTests(unittest.TestCase):
    DOC = {
        "agencies": [
            {"name": "Parent", "short_name": "PAR", "display_name": "Parent", "sortable_name": "Parent", "slug": "parent",
             "cfr_references": [{"title": 7, "chapter": "I"}, {"title": 9, "subtitle": "A"}],
             "children": [
                 {"name": "Child", "short_name": None, "display_name": "Child, Parent", "sortable_name": "Child", "slug": "child",
                  "cfr_references": [{"title": 19, "chapter": "I"}], "children": []}]},
            {"name": "Other", "short_name": "OTH", "display_name": "Other", "sortable_name": "Other", "slug": "other",
             "cfr_references": [{"title": 19, "chapter": "I"}, {"title": 37, "chapter": "II"}], "children": []},
        ]
    }
    PREP = (
        "<html><pre>\n  Title and chapter or parAgency\n----------------------------\n\n"
        "3 CFR                                   The President\n"
        "11 CFR Parts 1-8, 100-116, 200-201, 9001-9007 and 9012, 9008, 9031-9039 \n"
        "  (5 indexes)                           Federal Election Commission\n"
        "19 CFR Chapter I                        Bureau of Customs and Border \n"
        "                                          Protection, Department of \n"
        "                                          Homeland Security\n"
        "37 CFR Chapters I and II (5 indexes)    Patent and Trademark Office\n"
        "37 CFR Chapter II                       Copyright Office\n"
        "</pre></html>"
    )

    def test_flatten_keeps_every_node_and_the_published_references(self):
        nodes = A.flatten(self.DOC)
        self.assertEqual([n["slug"] for n in nodes], ["parent", "child", "other"])
        self.assertEqual(nodes[1]["parent"], "parent")
        self.assertEqual(nodes[0]["children"], ["child"])
        self.assertEqual(nodes[0]["cfr_references"][1], {"title": 9, "subtitle": "A"})
        self.assertEqual(A.ref_text(nodes[0]["cfr_references"][1]), "Title 9, Subtitle A")
        self.assertEqual(A.ref_text({"title": 21, "chapter": "I"}), "Title 21, Chapter I")

    def test_prepared_index_rows_and_exact_links(self):
        rows = A.parse_prepared_indexes(self.PREP)
        self.assertEqual([r["cfr_title"] for r in rows], [3, 11, 19, 37, 37])
        self.assertEqual(rows[1]["indexes_printed"], "(5 indexes)")
        self.assertEqual(rows[1]["agency_as_printed"], "Federal Election Commission")
        self.assertEqual(rows[2]["agency_as_printed"], "Bureau of Customs and Border Protection, Department of Homeland Security")
        nodes = A.flatten(self.DOC)
        self.assertEqual(A.link_prepared(rows[2], nodes)["slug"], None)  # two agencies list title 19 chapter I: ambiguous, not linked
        self.assertIn("2 agencies", A.link_prepared(rows[2], nodes)["reason"])
        self.assertEqual(A.link_prepared(rows[3], nodes)["slug"], None)  # two chapters in one row
        self.assertEqual(A.link_prepared(rows[4], nodes)["slug"], "other")
        self.assertEqual(A.link_prepared(rows[0], nodes)["slug"], None)

    def test_rows_and_profile_links(self):
        nodes = A.flatten(self.DOC)
        prep = A.parse_prepared_indexes(self.PREP)
        rows, stats = BA.build_rows(nodes, prep, year="2025", retrieved_at="r", fr_slugs={"child": "42", "other": "7"}, titles_asof="2026-10-21")
        by = {r["id"]: r for r in rows}
        self.assertEqual(stats["agency_records"], 3)
        self.assertEqual(stats["top_level"], 2)
        self.assertEqual(stats["linked_to_fr_profile"], 2)
        self.assertIn("/agencies/42", [l["url"] for l in by["agency:child"]["item"]["links"]])
        self.assertNotIn("/agencies/42", [l["url"] for l in by["agency:parent"]["item"]["links"]])
        self.assertEqual(by["agency:child"]["item"]["cells"]["parent"], "Parent")
        self.assertEqual(by["agency:parent"]["detail"]["agency"]["children"], [{"slug": "child", "name": "Child"}])
        self.assertEqual(by["agency:other"]["filters"]["cfr_title"], ["19", "37"])
        self.assertEqual(by["agency:child"]["item"]["cells"]["short_name"], "Not recorded")
        self.assertEqual(len(rows), 3 + 5)

    def test_fr_slug_index_needs_a_unique_exact_slug(self):
        rows = [
            {"id": "1", "item": {"links": [{"url": "https://www.federalregister.gov/agencies/food-and-drug-administration"}]}},
            {"id": "2", "item": {"links": [{"url": "https://www.federalregister.gov/agencies/dup"}]}},
            {"id": "3", "item": {"links": [{"url": "https://www.federalregister.gov/agencies/dup"}]}},
            {"id": "4", "item": {"links": [{"url": "https://www.federalregister.gov/agencies/x/y"}]}},
        ]
        self.assertEqual(BA.fr_slug_index(rows), {"food-and-drug-administration": "1"})


if __name__ == "__main__":
    unittest.main()
