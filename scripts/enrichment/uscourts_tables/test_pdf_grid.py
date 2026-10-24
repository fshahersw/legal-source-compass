"""Offline tests for the word-position PDF reader (pdf_grid.py) and the heading match (pdf_align.py), on synthetic word layouts
shaped like the published pages (no PDF files, no network)."""
import unittest

import pdf_align as A
import pdf_grid as G
import pdf_grid_ingest as GI


class Page:
    width = 792.0


def word(text, x0, top, size=10.0, width=None):
    w = width if width is not None else 5.0 * len(text)
    return {"text": text, "x0": x0, "x1": x0 + w, "top": top, "size": size}


def right(text, edge, top, size=10.0):
    """A figure right-aligned at `edge`."""
    w = 5.0 * len(text)
    return {"text": text, "x0": edge - w, "x1": edge, "top": top, "size": size}


EDGES = [300, 360, 420]


def table_words(rows, title=True, top0=100):
    words = []
    if title:
        words += [word("Table", 50, 40), word("C-4A.", 80, 40), word("U.S.", 50, 52), word("District", 72, 52), word("Courts", 115, 52),
                  word("During", 50, 64), word("the", 85, 64), word("12-Month", 102, 64), word("Period", 150, 64), word("Ending", 185, 64),
                  word("September", 220, 64), word("30,", 270, 64), word("2010", 288, 64)]
    words += [word("Court", 350, 80), word("Action", 380, 80)]
    words += [word("Circuit", 50, 90), word("Total", 280, 90), word("Total", 340, 90), word("Percent", 398, 90)]
    for k, (label, figs) in enumerate(rows):
        top = top0 + 12 * k
        x = 50
        for part in label.split():
            words.append(word(part, x, top))
            x += 5.0 * len(part) + 3
        for f, e in zip(figs, EDGES):
            if f is not None:
                words.append(right(f, e, top))
    return words


ROWS = [("TOTAL", ["1,000", "600", "60.0"]), ("DC", ["100", "60", "60.0"]), ("1ST", ["900", "540", "-"]), ("ME", ["900", "540", "60.0"])]


class LineTests(unittest.TestCase):
    def test_a_number_at_word_spacing_belongs_to_the_label(self):
        line = G.lines_of([word("Chapter", 50, 100), word("7", 88, 100), right("12", 300, 100), right("19", 360, 100)])[0]
        label, figs, marks = G.split_line(line)
        self.assertEqual([w["text"] for w in label], ["Chapter", "7"])
        self.assertEqual([w["text"] for w in figs], ["12", "19"])

    def test_small_footnote_marks_are_marks_not_figures(self):
        line = G.lines_of([word("Pending", 50, 100), word("1", 92, 98, size=6.0), right("12", 300, 100), right("19", 360, 100)])[0]
        label, figs, marks = G.split_line(line)
        self.assertEqual([w["text"] for w in marks], ["1"])
        self.assertEqual([w["text"] for w in figs], ["12", "19"])

    def test_dashes_including_the_soft_hyphen(self):
        self.assertEqual(G.to_value("-"), (None, "dash"))
        self.assertEqual(G.to_value("­"), (None, "dash"))
        self.assertTrue(G.is_number("­"))
        self.assertEqual(G.to_value("1,234"), (1234, None))
        self.assertEqual(G.to_value("-12.7"), (-12.7, None))
        self.assertEqual(G.to_value("(NA)"), (None, "na"))

    def test_a_capital_set_apart_from_its_word_is_joined(self):
        line = G.lines_of([word("A", 439, 100, width=6.0), word("cquitted", 447, 100), word("by", 490, 100)])[0]
        self.assertEqual([w["text"] for w in line["words"]], ["Acquitted", "by"])
        self.assertEqual(line["words"][0]["x1"], 487.0)
        far = G.lines_of([word("A", 400, 100, width=6.0), word("cquitted", 420, 100)])[0]
        self.assertEqual([w["text"] for w in far["words"]], ["A", "cquitted"])  # too far apart: two words
        upper = G.lines_of([word("A", 439, 100, width=6.0), word("CT", 446, 100)])[0]
        self.assertEqual([w["text"] for w in upper["words"]], ["A", "CT"])  # not a lower-case continuation


class PageTests(unittest.TestCase):
    def page(self, rows=ROWS, title=True):
        return G.parse_page(Page(), G.lines_of(table_words(rows, title)))

    def test_title_headings_rows(self):
        p = self.page()
        self.assertEqual(p["ncols"], 3)
        self.assertTrue(p["title"][0].startswith("Table C-4A."))
        self.assertEqual(len(p["title"]), 3)  # through the period line
        labels = [G.text_of(r["label_words"]) for r in p["rows"]]
        self.assertEqual(labels, ["TOTAL", "DC", "1ST", "ME"])
        self.assertEqual(p["rows"][0]["values"], [1000, 600, 60.0])
        self.assertEqual(p["rows"][2]["flags"][2], "dash")
        bands = {w["text"]: w["band"] for line in p["headers"] for w in line}
        self.assertEqual(bands["Percent"], 2)

    def test_a_short_line_is_placed_by_its_right_edges(self):
        p = self.page(ROWS + [("NH", ["5", None, "1.0"])])
        nh = p["rows"][-1]
        self.assertEqual(nh["values"], [5, None, 1.0])
        self.assertEqual(nh["flags"][1], "blank")

    def test_a_line_with_too_many_figures_is_not_read(self):
        words = table_words(ROWS) + [word("NH", 50, 200), right("1", 300, 200), right("2", 360, 200), right("3", 420, 200), right("4", 480, 200)]
        p = G.parse_page(Page(), G.lines_of(words))
        self.assertTrue(p["problems"])
        self.assertNotIn("NH", [G.text_of(r["label_words"]) for r in p["rows"]])

    def test_sort_codes_are_removed(self):
        words = table_words(ROWS + [("MA", ["10", "6", "60.0"])])
        codes = ["0.0", "00", "01", "010", "011"]
        for k, c in enumerate(codes):
            words.append(right(c, 700, 100 + 12 * k))
        lines = G.lines_of(words)
        centre = G.sort_band([lines])[0]
        self.assertIsNotNone(centre)
        p = G.parse_page(Page(), lines, centre)
        self.assertEqual(p["ncols"], 3)
        self.assertEqual(p["sort_codes"], 5)

    def test_no_sort_band_without_leading_zeros(self):
        words = table_words(ROWS) + [right(c, 700, 100 + 12 * k) for k, c in enumerate(["12", "34", "56", "78", "90"])]
        self.assertEqual(G.sort_band([G.lines_of(words)]), [None])


class BlockTests(unittest.TestCase):
    def test_pages_with_the_same_headings_continue_one_block(self):
        p1 = G.parse_page(Page(), G.lines_of(table_words(ROWS[:2])))
        p2 = G.parse_page(Page(), G.lines_of(table_words(ROWS[2:], title=False)))
        blocks = G.blocks_of([p1, p2])
        self.assertEqual(len(blocks), 1)
        self.assertEqual(len(blocks[0]["rows"]), 4)

    def test_wrapped_labels_and_section_headings(self):
        rows = [{"kind": "text", "label_words": [word("CONTRACT", 50, 0), word("ACTIONS", 100, 0)], "marks": [], "x0": 50},
                {"kind": "text", "label_words": [word("RECOVERY", 60, 0), word("OF", 110, 0), word("OVERPAYMENTS", 125, 0), word("AND", 200, 0)], "marks": [], "x0": 60},
                {"kind": "data", "label_words": [word("ENFORCEMENT", 72, 0), word("OF", 140, 0), word("JUDGMENTS", 155, 0)], "marks": [], "x0": 72, "values": [1], "flags": [None]},
                {"kind": "data", "label_words": [word("OTHER", 72, 0)], "marks": [], "x0": 72, "values": [2], "flags": [None]}]
        out = G.join_rows(rows)
        self.assertEqual([(r["label"], r["section"], r["x0"]) for r in out],
                         [("CONTRACT ACTIONS", True, 50), ("RECOVERY OF OVERPAYMENTS AND ENFORCEMENT OF JUDGMENTS", False, 60), ("OTHER", False, 72)])


def ref(paths, end="2017-09-30", scope="district"):
    return {"period_end": end, "scope": scope, "columns": [{"key": "/".join(p).lower().replace(" ", "_"), "path": p, "label": " / ".join(p), "prior": False, "fmt": None} for p in paths]}


def block(band_texts, groups=(), title=("Table B-1.",)):
    """A block whose heading words sit over columns 0..n-1 (band i spans x 100i..100i+100); groups: (text, first col, last col)."""
    headers, n = [], len(band_texts)
    line = []
    for text, a, b in groups:
        centre = (100 * a + 100 * (b + 1)) / 2
        for t in text.split():
            line.append({"text": t, "x0": centre - 10, "x1": centre + 10, "mark": False, "band": None})
    if line:
        headers.append(line)
    low = []
    for i, text in enumerate(band_texts):
        for t in text.split():
            low.append({"text": t, "x0": 100 * i + 40, "x1": 100 * i + 60, "mark": False, "band": i})
    headers.append(low)
    return {"ncols": n, "headers": headers, "title": list(title), "pages": [{"bands": [(100 * i, 100 * i + 100) for i in range(n)]}]}


class AlignTests(unittest.TestCase):
    def test_an_older_edition_with_one_column_fewer(self):
        r = ref([["Pending Oct. 1, 2016"], ["Commenced", "Total"], ["Commenced", "Original"], ["Commenced", "Reinstated"], ["Commenced", "Reopened"]])
        b = block(["Pending Oct. 1, 2009", "Total", "Original", "Reopened"], groups=[("Cases Commenced", 1, 3)])
        mapping, why = A.align(b, r, "2010-09-30")
        self.assertEqual(why, "")
        self.assertEqual([c["key"] for c in mapping], ["pending_oct._1,_2016", "commenced/total", "commenced/original", "commenced/reopened"])

    def test_a_group_heading_that_changed_is_not_matched(self):
        r = ref([["Terminated", "On Procedural Grounds", "Total"], ["Terminated", "On Procedural Grounds", "By Judge"]])
        b = block(["Total", "By Judge"], groups=[("Procedural Terminations", 0, 1)])
        mapping, why = A.align(b, r, "2010-09-30")
        self.assertIsNone(mapping)
        self.assertIn("group heading", why)

    def test_two_equal_matches_are_not_chosen_between(self):
        r = ref([["Filed", "Total"], ["Terminated", "Total"]])
        b = block(["Total"])
        mapping, why = A.align(b, r, "2010-09-30")
        self.assertIsNone(mapping)

    def test_words_years_and_renamings(self):
        self.assertEqual(A.words_of("Not Terminated as of September 30, 2011", 2012), ["not", "terminated", "as", "of", "september", "ym1"])
        self.assertEqual(A.words_of("Cases Commenced", 2010), ["case", "filed"])
        self.assertEqual(A.words_of("Non-Jury", 2010), ["nonjury", "non", "jury"])
        self.assertEqual(A.words_of("Non-Jury", 2010, parts=False), ["nonjury"])
        self.assertEqual(A.words_of("CHAP. 7", 2010), ["chapter", "7"])
        self.assertEqual(A.words_of("Conditions1 Pending July 1, 2009", 2010), ["condition", "pending", "july", "ym1"])
        self.assertEqual(A.words_of("By Consoli- dation", 2017), ["by", "consolidation"])


class TitleTests(unittest.TestCase):
    def test_an_edition_printed_under_its_earlier_number(self):
        b = {"title": ["Table S-1.", "U.S. Courts of Appeals—Appeals Terminated on the Merits After Oral Hearings or Submission on Briefs",
                       "During the 12-Month Period Ending September 30, 2012"]}
        entry = {"table": "B-10", "period_end": "2012-09-30", "title": "U.S. Courts of Appeals - Cases Terminated on the Merits After Oral Arguments or Submission on Briefs"}
        reasons, warn, _ = GI.check_title(b, entry, {"B-9", "C-1"})
        self.assertEqual(reasons, [])
        self.assertIn("earlier number (S-1)", warn[0])
        reasons, _, _ = GI.check_title(b, entry, {"S-1"})  # another table of the period has that number: not this one
        self.assertTrue(reasons)

    def test_the_period_must_match(self):
        b = {"title": ["Table C-2A.", "U.S. District Courts", "During the 12-Month Period Ending September 30, 2009"]}
        reasons, _, _ = GI.check_title(b, {"table": "C-2A", "period_end": "2010-09-30", "title": "U.S. District Courts"}, set())
        self.assertIn("period in title 2009-09-30 differs from listing 2010-09-30", reasons)

    def test_court_labels(self):
        self.assertEqual(GI.court_label("1ST CIRCUIT"), "1ST")
        self.assertEqual(GI.court_label("First"), "1ST")
        self.assertEqual(GI.court_label("ALL CIRCUITS"), "TOTAL")
        self.assertEqual(GI.court_label("NY, S"), "NY,S")


def court_row(entity, eid, values):
    return {"entity": entity, "entity_id": eid, "label": eid.upper(), "values": values, "flags": [None] * len(values)}


def court_norm(rows):
    return {"scope": "district", "columns": [{"key": "filed", "path": ["Filed"]}, {"key": "terminated", "path": ["Terminated"]}], "rows": rows}


REF_ROWS = [court_row("national", "national", [30, 20]), court_row("circuit", "ca1", [30, 20]), court_row("district", "med", [10, 5]),
            court_row("district", "mad", [15, 10]), court_row("district", "nhd", [5, 5])]


class CourtGateTests(unittest.TestCase):
    def test_a_court_the_edition_does_not_list_is_accepted_when_its_circuit_adds_up(self):
        norm = court_norm([court_row("national", "national", [25, 15]), court_row("circuit", "ca1", [25, 15]), court_row("district", "med", [10, 5]),
                           court_row("district", "mad", [15, 10])])
        reasons, warn = GI.court_gates(norm, court_norm(REF_ROWS), "")
        self.assertEqual(reasons, [])
        self.assertIn("not printed: nhd", warn[0])

    def test_a_court_whose_figures_are_still_in_its_circuit_is_not_accepted(self):
        norm = court_norm([court_row("national", "national", [30, 20]), court_row("circuit", "ca1", [30, 20]), court_row("district", "med", [10, 5]),
                           court_row("district", "mad", [15, 10])])  # the circuit still counts the missing court: a row was lost
        reasons, _ = GI.court_gates(norm, court_norm(REF_ROWS), "")
        self.assertTrue(reasons)

    def test_a_court_without_a_circuit_roll_up_is_not_accepted(self):
        norm = court_norm([court_row("national", "national", [25, 15]), court_row("circuit", "ca1", [25, 15]), court_row("district", "med", [10, 5]),
                           court_row("district", "mad", [15, 10]), court_row("circuit", "ca2", [None, None]), court_row("district", "ctd", [1, 1])])
        norm["rows"][4]["flags"] = ["na", "na"]
        ref_rows = REF_ROWS + [court_row("circuit", "ca2", [None, None])]
        reasons, _ = GI.court_gates(norm, court_norm(ref_rows), "")
        self.assertEqual(len(reasons), 1)
        self.assertIn("no circuit roll-up checks ['ctd']", reasons[0])


class DecimalCountTests(unittest.TestCase):
    def test_a_count_printed_with_decimals_stops_the_edition(self):
        # FJCS H-2, March 2012: AK prints "0.5" under No Reports Made / Total (223 prebail + 0 postbail + 5 = 228 activated)
        norm = court_norm([court_row("national", "national", [228, 5]), court_row("district", "akd", [228, 0.5])])
        norm["columns"] = [{"key": "cases_activated", "path": ["Cases Activated"], "fmt": "#,##0"},
                           {"key": "no_reports_made/total", "path": ["No Reports Made", "Total"], "fmt": "#,##0"}]
        self.assertIn("AKD no_reports_made/total 0.5", GI.decimal_counts(norm)[0])
        norm["columns"][1]["path"] = ["No Reports Made", "Percent"]
        self.assertEqual(GI.decimal_counts(norm), [])  # a percent column may print decimals


def wrow(label, values=None, indent=-189.0):
    return {"label": label, "indent": indent, "section": values is None, "values": values, "flags": None if values is None else [None] * len(values),
            "marks": [], "label_raw": label, "row": None, "cell_marks": {}}


# Wiretap Table 4, 2010 (PDF): TOTAL, FEDERAL, state headings without figures, labels printed over two lines
WIRE_2010 = [wrow("TOTAL", [30, 20]), wrow("FEDERAL", [12, 8]), wrow("COLORADO"), wrow("1ST JUDICIAL DISTRICT", [5, 3]), wrow("(JEFFERSON)", indent=-182.2),
             wrow("4TH JUDICIAL DISTRICT (EL", [4, 2]), wrow("PASO)"), wrow("MISSISSIPPI"), wrow("STATE ATTORNEY", [9, 7]), wrow("GENERAL")]


class WiretapPdfTests(unittest.TestCase):
    def test_state_headings_and_two_line_labels(self):
        rows, why = GI.wiretap_paths(WIRE_2010, known={G.norm_label("STATE ATTORNEY GENERAL")})
        self.assertIsNone(why)
        self.assertEqual([r["path"] for r in rows], [["Total"], ["FEDERAL"], ["COLORADO", "1ST JUDICIAL DISTRICT (JEFFERSON)"],
                                                     ["COLORADO", "4TH JUDICIAL DISTRICT (EL PASO)"], ["MISSISSIPPI", "STATE ATTORNEY GENERAL"]])
        self.assertEqual(rows[4]["entity_id"], "mississippi/state_attorney_general")
        norm = {"rows": rows, "columns": [{"key": "number_authorized", "path": ["Number Authorized"], "fmt": "#,##0"},
                                          {"key": "installed", "path": ["Orders for Which Intercepts Installed"], "fmt": "#,##0"}]}
        self.assertEqual(GI.wiretap_gates(norm), [])
        rows[2]["values"] = [6, 3]
        self.assertTrue(GI.wiretap_gates(norm)[0].startswith("Total number_authorized 30 != FEDERAL plus the local jurisdictions 31"))

    def test_a_jurisdiction_printed_twice_is_left_out(self):
        rows, _ = GI.wiretap_paths([wrow("TOTAL", [12, 8]), wrow("FEDERAL", [5, 4]), wrow("NEW YORK"), wrow("STATE ATTORNEY GENERAL", [4, 2]),
                                    wrow("STATE ATTORNEY GENERAL", [3, 2])])
        norm = {"rows": rows, "columns": [{"key": "a", "path": ["Authorized"], "fmt": "#,##0"}, {"key": "i", "path": ["Installed"], "fmt": "#,##0"}]}
        self.assertEqual(GI.wiretap_gates(norm), [])  # the sums hold with both rows
        warn = GI.drop_twice_printed(norm)
        self.assertIn("NEW YORK / STATE ATTORNEY GENERAL", warn[0])
        self.assertEqual([r["path"] for r in norm["rows"]], [["Total"], ["FEDERAL"]])

    def test_an_unknown_heading_is_not_taken_as_a_state(self):
        rows = WIRE_2010[:2] + [wrow("ATLANTIS"), wrow("CAPITAL", [18, 12])]
        out, why = GI.wiretap_paths(rows)
        self.assertIsNone(out)
        self.assertIn("'ATLANTIS' is not a state", why)

    def test_report_codes_take_no_part_in_the_sums(self):
        rows, _ = GI.wiretap_paths([wrow("TOTAL", [9, 7]), wrow("FEDERAL", [5, 4]), wrow("ARIZONA"), wrow("PIMA", [4, 3]), wrow("YUMA", [None, None])])
        rows[3]["flags"] = ["text:NP", "text:NP"]
        norm = {"rows": rows, "columns": [{"key": "installed", "path": ["Installed"], "fmt": "#,##0"}, {"key": "cost", "path": ["Cost Reported"], "fmt": "#,##0"}]}
        self.assertEqual(GI.wiretap_gates(norm), [])


def slanted(text, x, band_of_x, top=100.0, step=5.0):
    """Letters of a heading printed rotated and slanted: each letter up and to the right of the one before."""
    out = []
    for k, ch in enumerate(text):
        cx = x + step * k
        out.append({"text": ch, "x0": cx - 1, "x1": cx + 1, "band": band_of_x(cx), "mark": False, "top": top - step * k})
    return out


class RotatedHeadingTests(unittest.TestCase):
    bands = [(200.0, 240.0), (240.0, 280.0)]

    def band(self, x):
        return next((i for i, (lo, hi) in enumerate(self.bands) if lo <= x < hi), None)

    def block(self, first, second):
        letters = slanted(first, 225, self.band) + slanted(second, 262, self.band)
        return {"ncols": 2, "headers": [[w] for w in letters], "pages": [{"bands": self.bands}]}

    def test_slanted_letters_are_read_back_to_their_columns(self):
        ref = {"columns": [{"key": "total", "path": ["Total"]}, {"key": "other", "path": ["Other"]}]}
        mapping, why = GI.letters_in_order(self.block("Total", "Other"), ref)
        self.assertEqual(why, "")
        self.assertEqual([c["key"] for c in mapping], ["total", "other"])

    def test_other_letters_or_another_column_count_are_not_matched(self):
        ref = {"columns": [{"key": "total", "path": ["Total"]}, {"key": "other", "path": ["Other"]}]}
        mapping, _ = GI.letters_in_order(self.block("Total", "Order"), ref)
        self.assertIsNone(mapping)
        mapping, why = GI.letters_in_order(self.block("Total", "Other"), {"columns": ref["columns"] + [{"key": "x", "path": ["X"]}]})
        self.assertIsNone(mapping)
        self.assertIn("2 figure columns, 3 in the workbook", why)


if __name__ == "__main__":
    unittest.main()
