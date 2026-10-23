"""Offline tests for the ecfr_full stream (parser, builder helpers, FR linking, verify integrity).

  cd scripts/enrichment/ecfr_full && python3 -B -m unittest -v test_ecfr_full
"""
import io
import json
import os
import sys
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_ecfr_full as bf  # noqa: E402
import ecfr_parse as ep  # noqa: E402
import frindex  # noqa: E402
import verify_ecfr_full as vf  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def items(name):
    stats = ep.Stats()
    with open(os.path.join(FIX, name), "rb") as fh:
        return [x for x in ep.iter_title(fh, stats)], stats


def item(name):
    out, _ = items(name)
    return next(obj for kind, obj, _ in out if kind == "item")


class NestedParagraphs(unittest.TestCase):
    def setUp(self):
        self.it = item("nested.xml")

    def test_depths_follow_markers(self):
        got = [(entry[1], line.split(" ")[0]) for entry, line in zip(self.it["layout"], self.it["lines"])]
        self.assertEqual(got, [
            (0, "(a)"), (2, "(ii)"), (1, "(2)"), (2, "(i)"), (3, "(A)"), (4, "(1)"), (5, "(i)"),
            (0, "(b)"), (0, "An"), (0, "(c)"), (0, "(h)"), (0, "(i)"), (0, "(j)"), (1, "A"),
        ])

    def test_flush_paragraph_flag_and_empty_paragraph_dropped(self):
        self.assertEqual(self.it["layout"][-1], ["p", 1, "i"])
        self.assertEqual(len(self.it["lines"]), 14)

    def test_heading_number_and_source_note(self):
        self.assertEqual(self.it["n"], "§ 99.10")
        self.assertEqual(self.it["heading"], "§ 99.10 Nested paragraphs.")
        self.assertEqual(self.it["notes"], [["source", "[85 FR 1234, Jan. 2, 2020, as amended at 88 FR 5678, Mar. 3, 2023]"]])
        self.assertEqual(ep.fr_citations(self.it["notes"][0][1]), [(85, 1234), (88, 5678)])

    def test_letter_or_roman_by_lookahead(self):
        m = lambda *toks: [[(t, False)] for t in toks]  # noqa: E731
        self.assertEqual(ep.assign_depths(m("a", "1", "i", "ii")), [0, 1, 2, 2])
        self.assertEqual(ep.assign_depths(m("h", "1", "i", "j")), [0, 1, 0, 0])
        self.assertEqual(ep.assign_depths(m("u", "v", "w")), [0, 0, 0])
        self.assertEqual(ep.assign_depths(m("1", "i", "ii", "iii", "iv", "v")), [0, 1, 1, 1, 1, 1])
        self.assertEqual(ep.assign_depths(m("y", "z", "aa", "bb")), [0, 0, 0, 0])
        self.assertEqual(ep.assign_depths([[], [("1", False)]]), [None, 0])


class Tables(unittest.TestCase):
    def test_govinfo_table(self):
        it = item("table_govinfo.xml")
        self.assertEqual(it["lines"][1:4], ["Table 1 to Paragraph (a)", "[Daily maximum]", "Pollutant\tLimit ¹"])
        self.assertEqual(it["layout"][1:3], [["h", 3], ["h", 4]])
        table = it["layout"][3]
        self.assertEqual(table[0], "t")
        self.assertEqual(table[1][0], [[1, 1, 1], [2, 1, 1]])
        self.assertEqual(it["lines"][4], "CO₂\t8½\t10⁻⁶")
        self.assertEqual(it["lines"][5], "f_(H2O)\tm" + chr(0x307) + "\t1 1/16")
        self.assertEqual(it["lines"][6], "¹ Pounds per 1,000 pounds of product.")
        self.assertEqual(it["layout"][4], ["p", 0, "f"])
        self.assertEqual(it["lines"][-1], "(b) After the table.")
        self.assertEqual(it["layout"][-1], ["p", 0])

    def test_api_form_reads_the_same(self):
        a, b = item("table_govinfo.xml"), item("table_api.xml")
        self.assertEqual(a["lines"], b["lines"])
        self.assertEqual(a["layout"], b["layout"])
        self.assertEqual(ep.norm_identifier(a["n"]), ep.norm_identifier(b["n"]))


class AppendixAndBoxes(unittest.TestCase):
    def test_appendix_blocks(self):
        it = item("appendix.xml")
        self.assertEqual(it["type"], "APPENDIX")
        self.assertEqual(it["heading"], "Appendix A to Part 99—Forms and Examples")
        kinds = [(e[0], e[1], e[2] if len(e) > 2 else "") for e in it["layout"]]
        self.assertEqual(kinds[0], ("h", 1, ""))
        self.assertIn(("p", 0, "x"), kinds)          # extract box
        self.assertIn(("p", 2, "x"), kinds)          # FP-2 inside the box keeps its level
        self.assertIn(("g", "/graphics/er01ja20.000.gif", ""), kinds)
        self.assertIn(("h", 2, "x"), kinds)          # NOTE heading
        self.assertIn(("p", 0, "f"), kinds)          # footnote
        self.assertEqual(it["lines"][1], "1. This appendix gives forms.²")
        g = [e[0] for e in it["layout"]].index("g")
        self.assertEqual(it["lines"][g], "")
        t = next(e for e in it["layout"] if e[0] == "t")
        self.assertEqual(t[1], [2, 2])
        self.assertIn("Wash temperature\t150 °F", it["lines"])
        self.assertEqual(it["lines"][-1], "Kept as a paragraph.")

    def test_unknown_tag_counted(self):
        _, stats = items("appendix.xml")
        self.assertEqual(stats.unknown["UNKNOWNTAG"], 1)
        self.assertEqual(stats.graphics, 1)


class ReservedAndNotes(unittest.TestCase):
    def test_stream(self):
        out, _ = items("reserved_notes.xml")
        kinds = [k for k, _, _ in out]
        self.assertEqual(kinds, ["note", "note", "body", "note", "item", "item"])
        notes = [(o[0], anc[-1][0]) for k, o, anc in out if k == "note"]
        self.assertEqual(notes, [("authority", "PART"), ("source", "PART"), ("source", "SUBPART")])
        body = next(o for k, o, _ in out if k == "body")
        self.assertEqual(body["lines"], ["Part-level text printed before the sections."])
        reserved = [o for k, o, _ in out if k == "item"][0]
        self.assertEqual((reserved["lines"], reserved["layout"], reserved["heading"]), ([], [], "§ 99.11 [Reserved]"))
        anc = [[x[:2] for x in a] for k, _, a in out if k == "item"][0]
        self.assertEqual(anc, [("TITLE", "99"), ("CHAPTER", "I"), ("PART", "99"), ("SUBPART", "A")])

    def test_section_notes_kept_apart(self):
        out, _ = items("reserved_notes.xml")
        sec = [o for k, o, _ in out if k == "item"][1]
        self.assertEqual(sec["lines"], ["The rule text."])
        self.assertEqual([n[0] for n in sec["notes"]], ["amendment", "authority", "omb", "source", "editorial", "effective_date"])
        self.assertTrue(sec["notes"][4][1].startswith("Editorial Note: An editorial note."))


class Identifiers(unittest.TestCase):
    def test_norm_identifier(self):
        for raw, want in [("§ 1.1", "1.1"), ("§§ 13.21 -13.29", "13.21 -13.29"), ("§ 752.1.", "752.1"), ("Sec. 1-1", "1-1"),
                          ("Section 01", "01"), ("§thnsp;8.2", "8.2"), ("849.504", "849.504")]:
            self.assertEqual(ep.norm_identifier(raw), want)

    def test_loose(self):
        self.assertEqual(ep.loose("Appendix A to Part 11 ¹"), ep.loose("Appendix A to Part 11 1"))
        self.assertEqual(ep.loose("(Non-mandatory) Appendix A—x"), ep.loose("Non-mandatory Appendix A-x"))

    def test_native_path_matches_hierarchy_encoding(self):
        path = [("title", "17", "Title 17"), ("chapter", "II", "Chapter II"), ("part", "230", "Part 230"),
                ("subject_group", "ECFRb33419ac951ceae", "x")]
        self.assertEqual(bf.native_path(path, "section", "230.702(T)-230.703(T)"),
                         "title-17/chapter-II/part-230/subject_group-ECFRb33419ac951ceae/section-230.702%28T%29-230.703%28T%29")
        self.assertEqual(bf.native_path([("title", "49", "")], "appendix", "Appendix B to Part 229"),
                         "title-49/appendix-Appendix%20B%20to%20Part%20229")

    def test_part_from_head_and_ids(self):
        self.assertEqual(bf.part_from_head("PART 101-1—INTRODUCTION"), "101-1")
        self.assertEqual(bf.part_from_head("PARTS 1240-1259—REPORTS"), "1240-1259")
        self.assertIsNone(bf.part_from_head("Special Note—Application"))
        self.assertEqual(bf.record_id("21", "section", "314.70"), "cfr:21:314.70")
        self.assertEqual(bf.record_id("21", "part", "314"), "cfr:21:part-314")
        self.assertEqual(bf.clean_label('Appendix B—Section 332(<span class="standard">a</span>)\n'), "Appendix B—Section 332(a)")

    def test_ecfr_urls(self):
        path = [("title", "40", ""), ("chapter", "I", ""), ("subchapter", "C", ""), ("part", "60", ""), ("subject_group", "ECFRx", "")]
        self.assertEqual(bf.ecfr_url("40", path, "section", "60.4"), "https://www.ecfr.gov/current/title-40/section-60.4")
        self.assertEqual(bf.ecfr_url("40", path, "appendix", "Appendix A-1 to Part 60"),
                         "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-60/appendix-Appendix%20A-1%20to%20Part%2060")


class Aligner(unittest.TestCase):
    def leaves(self):
        mk = lambda t, i, **kw: {"node": {"type": t, "identifier": i, "label": kw.get("label", i), "label_level": kw.get("level", i),  # noqa: E731
                                          **({"generated_id": True} if kw.get("gen") else {})}, "path": []}
        return [mk("section", "1.1"), mk("section", "752.1"), mk("appendix", "Appendix A to Part 1"),
                mk("appendix", "ECFRP94", label="Table 2 to Subpart III of Part 63—Compliance", gen=True),
                mk("appendix", "Alphabetical Index"), mk("appendix", "Alphabetical Index")]

    def test_match_by_keys_and_order(self):
        a = bf.Aligner(self.leaves())
        self.assertEqual(a.find({"type": "SECTION", "n": "§ 752.1.", "heading": "§ 752.1. What"}), 1)
        self.assertEqual(a.find({"type": "SECTION", "n": "§ 1.1", "heading": "§ 1.1 Definitions."}), 0)
        self.assertEqual(a.find({"type": "APPENDIX", "n": "Appendix A", "heading": "Appendix A to Part 1—Forms"}), 2)
        self.assertEqual(a.find({"type": "APPENDIX", "n": "", "heading": "Table 2 to Subpart III of Part 63—Compliance"}), 3)
        self.assertEqual(a.find({"type": "APPENDIX", "n": "", "heading": "Alphabetical Index"}), 4)
        self.assertEqual(a.find({"type": "APPENDIX", "n": "", "heading": "Alphabetical Index"}), 5)
        self.assertIsNone(a.find({"type": "SECTION", "n": "§ 1.1", "heading": "§ 1.1 Definitions."}))  # printed twice


class FederalRegisterLinks(unittest.TestCase):
    def setUp(self):
        doc = lambda num, vol, start, end, pub, eff: {"document_number": num, "volume": vol, "start_page": start, "end_page": end,  # noqa: E731
                                                     "publication_date": pub, "effective_on": eff, "citation": f"{vol} FR {start}",
                                                     "cfr_references": [{"title": 21, "part": 314}]}
        self.idx = frindex.FRIndex([
            doc("2020-1", 85, 5000, 5100, "2020-01-02", "2020-02-03"),
            doc("2020-2", 85, 6000, 6001, "2020-01-20", "2020-02-03"),
            doc("2020-3", 85, 7000, 7010, "2020-03-01", "2020-04-01"),
            doc("2020-4", 85, 8000, 8010, "2020-05-02", "2020-04-01"),  # published after the eCFR issue date
        ])

    def test_source_note_preferred(self):
        basis, docs = self.idx.link("21", "314", "2020-02-03", "2020-02-03", [(85, 5050)])
        self.assertEqual((basis, [d["document_number"] for d in docs]), ("source_note", ["2020-1"]))

    def test_several_listed(self):
        basis, docs = self.idx.link("21", "314", "2020-02-03", "2020-02-03", [])
        self.assertEqual((basis, len(docs)), ("rules_for_part_on_date", 2))

    def test_only_rule_and_publication_after_issue_excluded(self):
        basis, docs = self.idx.link("21", "314", "2020-04-01", "2020-04-01", [])
        self.assertEqual((basis, [d["document_number"] for d in docs]), ("only_rule_for_part_on_date", ["2020-3"]))

    def test_none(self):
        self.assertEqual(self.idx.link("21", "315", "2020-02-03", "2020-02-03", []), ("none", []))
        self.assertEqual(self.idx.link("21", None, "2020-02-03", "2020-02-03", []), ("none", []))


class VerifyIntegrity(unittest.TestCase):
    def row(self, text, layout):
        return {"title": "x", "source_url": "https://www.govinfo.gov/bulkdata/ECFR/title-1/ECFR-title1.xml", "text": text,
                "detail": {"layout": layout}}

    def test_layout_and_text_must_agree(self):
        self.assertIsNone(vf.integrity(self.row("a\nb\tc", [["p", 0], ["t", [2]]])))
        self.assertIsNone(vf.integrity(self.row("", [["g", "/graphics/x.gif"]])))
        self.assertIsNone(vf.integrity(self.row("", [])))
        self.assertIsNotNone(vf.integrity(self.row("a\nb", [["p", 0]])))
        self.assertIsNotNone(vf.integrity(self.row("a\nb", [["p", 0], ["t", [2]]])))
        self.assertIsNotNone(vf.integrity(self.row("text", [])))


class Inline(unittest.TestCase):
    def el(self, s):
        return ET.fromstring(s)

    def test_scripts_fractions_accents(self):
        self.assertEqual(ep.inline(self.el("<P>x<E T='51'>2</E> and i<E T='51'>th</E> and C<E T='52'>max</E></P>")), "x² and iᵗʰ and Cₘₐₓ")
        self.assertEqual(ep.inline(self.el("<P>V<E T='52'>CO</E> 8<FR>3/4</FR></P>")), "V_(CO) 8¾")
        self.assertEqual(ep.inline(self.el("<P>Coliform (\n<sup>2</sup>) and KNO<E T='0732'>3</E></P>")), "Coliform (²) and KNO₃")
        self.assertEqual(ep.inline(self.el("<P>applicable\n<SU>1</SU> and V\n<SU>2</SU></P>")), "applicable ¹ and V ²")
        got = ep.inline(self.el("<P><I>x\n<AC T='8'/></I> mean, <I>t</I>\n<AC T='g'/>, z<AC T='0'/></P>"))
        self.assertEqual(got, "x" + chr(0x304) + " mean, t" + chr(0x331) + ", z")

    def test_round_trip_through_iter(self):
        xml = b"<DIV8 N='\xc2\xa7 5.1' TYPE='SECTION'><HEAD>\xc2\xa7 5.1 A.</HEAD><P>(a) One.</P></DIV8>"
        out = list(ep.iter_title(io.BytesIO(xml), ep.Stats()))
        self.assertEqual(out[0][1]["lines"], ["(a) One."])
        self.assertEqual(json.loads(json.dumps(out[0][1]))["layout"], [["p", 0]])


if __name__ == "__main__":
    unittest.main()
