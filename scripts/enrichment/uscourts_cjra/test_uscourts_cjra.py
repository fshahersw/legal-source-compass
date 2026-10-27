"""Offline unit tests for the CJRA stream (synthetic fixtures only; no network, no private files).

Run: cd scripts/enrichment/uscourts_cjra && python3 -B -m unittest -v test_uscourts_cjra
"""
import unittest

import build_uscourts_cjra as B
import cjra_data as D
import cjra_extract as X
import cjra_judges as J
import cjra_parse as P
import cjra_tables as T

MEASURES = P.MEASURES
EDGES = [300.0, 340.0, 380.0, 420.0, 460.0]


def word(text, x1, top, width=None, font="ArialMT"):
    width = width if width is not None else 5.0 * len(text)
    return {"text": text, "x0": x1 - width, "x1": x1, "top": top, "fontname": font, "size": 9}


def label_word(text, top, x0=50.0, font="ArialMT"):
    return {"text": text, "x0": x0, "x1": x0 + 5.0 * len(text), "top": top, "fontname": font, "size": 9}


def row(label, cols, page=1, top=100.0, markers=None, stray=None):
    return {"page": page, "top": top, "label": label, "cols": list(cols), "nums": [c for c in cols if c is not None], "markers": markers or [], "stray": stray or [],
            "shifted": False, "bold": False}


def heading(label, page=1, top=100.0):
    return row(label, [None] * 5, page, top)


COURTS = {c: ["District Court, " + c, "XX"] for c in ("med", "mad", "nhd", "prd", "rid", "laed", "lamd", "lawd", "nmid", "nysd", "nynd", "nyed")}


class ExtractTests(unittest.TestCase):
    def test_full_row_with_marker_superscript(self):
        words = [label_word("SMITH,", 100), label_word("JOHN", 100, 80)]
        for x1, text in zip(EDGES, ["5", "12", "0", "1", "3"]):
            words.append(word(text, x1, 100.0))
        words.append({"text": "2", "x0": 301.0, "x1": 304.0, "top": 96.0, "fontname": "ArialMT", "size": 5})  # superscript endnote after the first count
        rows = X.assemble(words, EDGES, 7)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["label"], "SMITH, JOHN")
        self.assertEqual(rows[0]["cols"], [5, 12, 0, 1, 3])
        self.assertEqual(rows[0]["markers"], [[0, 2]])
        self.assertEqual(rows[0]["stray"], [])

    def test_short_run_is_placed_by_column_edges_and_unaligned_token_is_stray(self):
        words = [label_word("ROE,", 120), label_word("JANE", 120, 80), word("7", EDGES[0], 120.0), word("4", EDGES[3], 120.0), word("9", 355.0, 120.0)]
        rows = X.assemble(words, EDGES, 1)
        self.assertEqual(rows[0]["cols"], [7, None, None, 4, None])
        self.assertEqual(rows[0]["stray"], ["9"])

    def test_row_with_five_numbers_shifted_from_the_edges_is_read_in_printed_order(self):
        words = [label_word("PORTER,", 140)] + [word(str(v), x1 - 40, 140.0) for v, x1 in zip([0, 0, 0, 0, 0], EDGES)]
        rows = X.assemble(words, EDGES, 1)
        self.assertEqual(rows[0]["cols"], [0, 0, 0, 0, 0])
        self.assertTrue(rows[0]["shifted"])

    def test_edge_candidates_need_five_clusters(self):
        words = []
        for top in (100.0, 120.0, 140.0):
            words += [word(str(i), x1, top) for i, x1 in enumerate(EDGES)]
        edges = X.edge_candidates(words)
        self.assertEqual(len(edges), 5)
        self.assertAlmostEqual(edges[0], 300.0, places=1)
        self.assertIsNone(X.edge_candidates(words[:6]))

    def test_white_text_and_cid_decoding(self):
        self.assertTrue(X.is_white((1, 1, 1)))
        self.assertTrue(X.is_white((0, 0, 0, 0)))
        self.assertFalse(X.is_white((0.13, 0.12, 0.12)))
        self.assertFalse(X.is_white(None))
        self.assertEqual(X.decode_cid("(cid:20)(cid:3)(cid:21)"), "12")
        self.assertIn("(cid:99)", X.decode_cid("(cid:99)"))


class ParseTests(unittest.TestCase):
    def test_parse_name_forms(self):
        n = P.parse_name("PAULEY, WILLIAM H., III")
        self.assertEqual((n["surname"], n["given"], n["suffix"], n["format"]), ("PAULEY", "WILLIAM H.", "III", "surname_first"))
        n = P.parse_name("HOWELL, BERYL A. (CJ)")
        self.assertEqual(n["designations"], ["CJ"])
        self.assertEqual(n["given"], "BERYL A.")
        # comma after the given names (not after the surname): not parsed, never linked
        self.assertEqual(P.parse_name("NUMBERS ROBERT T., II")["format"], "unparsed")
        self.assertEqual(P.parse_name("BARBARA MOSES")["format"], "unparsed")

    def test_district_aliases_and_collapsed_match(self):
        aliases = P.district_aliases(COURTS)
        self.assertEqual(P.find_district(P.district_key("LOUISIANA MIDDLE"), aliases), "lamd")
        self.assertEqual(P.find_district(P.district_key("louiSiAnA MiDle"), aliases), "lamd")  # a lost repeated letter in the small-caps heading
        self.assertEqual(P.find_district(P.district_key("NORTHERN MARIANAS ISLANDS"), aliases), "nmid")
        self.assertEqual(P.find_district(P.district_key("NEW YORK SOUTHERN (CONTINUED)"), aliases), "nysd")
        self.assertIsNone(P.find_district(P.district_key("SUBTOTAL"), aliases))
        self.assertIsNone(P.find_district(P.district_key("Smith Jones"), aliases))

    def test_collapsed_aliases_never_join_two_courts(self):
        aliases = P.district_aliases({c: ["", ""] for c in P.CIRCUIT_OF})
        seen = {}
        for key, cid in aliases.items():
            if key.startswith("~"):
                continue
            seen.setdefault(P.collapse(key), set()).add(cid)
        ambiguous = {k for k, v in seen.items() if len(v) > 1}
        for k in ambiguous:
            self.assertNotIn("~" + k, aliases)

    def report_2010_layout(self):
        return [
            heading("CJRA Appendix A", 1, 10), heading("First Circuit", 1, 40),
            row("New Hampshire", [8, 3, 0, 0, 0], 1, 60), row("District Judges", [8, 3, 0, 0, 0], 1, 70),
            row("BARBADORO, PAUL J.", [2, 0, 0, 0, 0], 1, 80), row("MCAULIFFE, STEVEN J.", [6, 3, 0, 0, 0], 1, 90),
            row("Maine", [1, 0, 0, 0, 0], 1, 100), row("District Judges", [1, 0, 0, 0, 0], 1, 110), row("WOODCOCK, JOHN A., JR.", [1, 0, 0, 0, 0], 1, 120),
            row("First Circuit Total", [9, 3, 0, 0, 0], 1, 130),
            heading("Appendix B", 2, 10),
        ]

    def test_parse_period_totals_rows_and_arithmetic(self):
        parsed = P.parse_period(self.report_2010_layout(), COURTS)
        self.assertEqual({r["court_id"] for r in parsed["rows"]}, {"nhd", "med"})
        self.assertEqual(len([r for r in parsed["rows"] if r["court_id"] == "nhd"]), 2)
        checks = P.validate(parsed)
        self.assertTrue(checks)
        self.assertTrue(all(c["ok"] for c in checks), checks)
        levels = {c["level"] for c in checks}
        self.assertTrue({"type", "district"} <= levels)

    def test_validate_reports_a_difference_instead_of_correcting_it(self):
        lines = self.report_2010_layout()
        lines[2] = row("New Hampshire", [9, 3, 0, 0, 0], 1, 60)  # printed total is one more than the judges
        parsed = P.parse_period(lines, COURTS)
        bad = [c for c in P.validate(parsed) if not c["ok"]]
        self.assertTrue(any(c["level"] == "district" and c["key"] == "nhd" for c in bad))
        nhd = next(t for t in parsed["totals"] if t["level"] == "district" and t["key"] == "nhd")
        self.assertEqual(nhd["values"]["civil_3y"], 9)  # the printed value is kept

    def test_incomplete_rows_are_reported_not_used(self):
        lines = self.report_2010_layout()
        lines.insert(5, row("PARTIAL, PAT", [3, None, 1, None, None], 1, 85))
        parsed = P.parse_period(lines, COURTS)
        self.assertEqual(len(parsed["incomplete"]), 1)
        self.assertNotIn("PARTIAL, PAT", [r["printed"] for r in parsed["rows"]])

    def test_appendix_e_range_is_read_for_the_exempted_district(self):
        lines = [heading("Appendix A.", 1, 10), heading("Report on Motions Pending More Than Six Months", 1, 20), heading("MAINE", 1, 30),
                 heading("DISTRICT JUDGES", 1, 40), row("CARTER, GENE", [2, 2, 0, 0, 0], 1, 50), row("DISTRICT TOTAL", [2, 2, 0, 0, 0], 1, 60),
                 heading("Appendix B.", 2, 10), heading("filler one", 2, 20), heading("filler two", 2, 30), heading("filler three", 2, 40), heading("filler four", 2, 50),
                 heading("Appendix E.", 3, 10), heading("Report on Motions Pending More Than Six Months,", 3, 20), heading("LOUISIANA EASTERN", 3, 30),
                 heading("DISTRICT JUDGES", 3, 40), row("FELDMAN, MARTIN L. C.", [52, 4, 0, 0, 0], 3, 50), row("DISTRICT TOTAL", [52, 4, 0, 0, 0], 3, 60)]
        ranges = P.appendix_ranges(lines)
        self.assertEqual(len(ranges), 2)
        parsed = P.parse_period(lines, COURTS)
        self.assertEqual({r["court_id"] for r in parsed["rows"]}, {"med", "laed"})
        self.assertTrue(all(c["ok"] for c in P.validate(parsed)))

    def test_endnotes_page_level_and_end_of_report_list(self):
        lines = [row("1 Fifty-one of the 68 cases are related to the 2004 Republican National Convention.", [None] * 5, 12, 647),
                 row("SULLIVAN, RICHARD J.", [68, 0, 0, 0, 0], 12, 263, markers=[[0, 1]]),
                 heading("Endnotes", 20, 44), row("", [None] * 5, 20, 81, stray=["1"]), row("Three-year-old caseload consists mostly of cases related to multidistrict litigation.", [None] * 5, 20, 84),
                 row("", [None] * 5, 20, 106, stray=["2"]), row("In August of 2022 the Camp Lejeune Justice Act was signed.", [None] * 5, 20, 109)]
        look = P.note_lookup(lines)
        self.assertIn("Republican National Convention", look(12, 1))      # same page wins
        self.assertIn("multidistrict litigation", look(30, 1) or look(99, 1) or "")  # else the report's own list
        self.assertIn("Camp Lejeune", look(5, 2))
        self.assertIsNone(look(5, 7))


class TableTests(unittest.TestCase):
    def test_split_numbers_and_glued_label(self):
        label, tokens = T.split_numbers("District Judges18,623 20,128 8.1")
        self.assertEqual(label, "District Judges")
        self.assertEqual(tokens, ["18,623", "20,128", "8.1"])
        self.assertEqual(T.split_numbers("Bench Trials Pending, Total 64 64 -")[1], ["64", "64", "-"])

    def test_fit_triples_drops_only_an_endnote_digit_that_makes_the_percent_true(self):
        triples, ok = T.fit_triples(["25,995", "2", "24,641", "-5.2"], 1)
        self.assertEqual(triples, [(25995, 24641, -5.2)])
        self.assertTrue(ok)
        self.assertEqual(T.fit_triples(["10", "20", "100.0"], 1), ([(10, 20, 100.0)], True))
        triples, ok = T.fit_triples(["10", "20", "99.0"], 1)
        self.assertFalse(ok)  # the printed percent does not follow from the counts: kept, but flagged
        self.assertIsNone(T.fit_triples(["1", "2", "3", "4", "5"], 1)[0])

    def test_pct_ok_accepts_printed_dash_and_rejects_zero_base(self):
        self.assertTrue(T.pct_ok(5, 6, None))
        self.assertFalse(T.pct_ok(0, 6, 5.0))
        self.assertTrue(T.pct_ok(200, 210, 5.0))

    def table1_lines(self, extra=()):
        rows = ["Table 1—U.S. District Courts", "Cases Pending More Than", "Three Years, Total 20,541 19,917 -3.0", "District Judges 20,161 19,550 -3.0", "Magistrate Judges 380 367 -3.4",
                "Motions Pending, Total 7,520 7,104 -5.5", "District Judges 6,829 6,653 -2.6", "Magistrate Judges 691 451 -34.7",
                "Bench Trials Pending, Total 108 87 -19.4", "District Judges 89 69 -22.5", "Magistrate Judges 19 18 -5.3",
                "Bankruptcy Appeals Pending, Total 285 270 -5.3", "District Judges 284 269 -5.3", "Magistrate Judges 1 1 -",
                "Social Security Appeals Cases Pending, Total 730 785 7.5", "District Judges 639 640 0.2", "Magistrate Judges 91 145 59.3"] + list(extra)
        return [(3, r) for r in rows]

    def test_table1_reads_five_measures_and_ignores_narrative_that_repeats_a_label(self):
        lines = self.table1_lines(["Civil Cases. The number of civil cases pending more than three years fell 3"])
        parsed, ok = T.parse_table1(lines)
        self.assertEqual(set(parsed), set(T.MEASURE_ORDER))
        self.assertEqual(parsed["civil_3y"]["total"]["current"], 19917)
        self.assertEqual(parsed["ss_appeals_6m"]["magistrate"]["current"], 145)
        self.assertEqual(parsed["bankruptcy_appeals_6m"]["magistrate"]["pct_change"], None)
        self.assertTrue(ok)

    def test_table1_missing_measure_is_unparsed(self):
        lines = [l for l in self.table1_lines() if "Bench" not in l[1]]
        self.assertEqual(T.parse_table1(lines), (None, False))

    def table4_lines(self, fifth):
        names = ["Total", "District of Columbia", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh"]
        rows = []
        for i, n in enumerate(names):
            rows.append(f"{n} {100 + i} {i + 1} {50 + i} {2}")
        rows[6] = "Fifth " + fifth
        return [(6, r) for r in rows]

    def test_table4_endnote_digit_needs_the_table2_reference(self):
        lines = self.table4_lines("106 1 17 56 2")
        rows, ok = T.parse_table4(lines, None)
        self.assertIsNotNone(rows)
        self.assertNotIn("5", rows)          # not guessed without a reference
        self.assertFalse(ok)
        rows, ok = T.parse_table4(lines, {"5": (106, 56)})
        self.assertEqual(rows["5"]["civil_3y"], 106)
        self.assertEqual(rows["5"]["civil_3y_per_judge"], 17.0)
        self.assertTrue(ok)

    def test_table4_with_a_missing_circuit_row_is_partial(self):
        lines = [l for l in self.table4_lines("106 7 56 2") if not l[1].startswith("Eleventh")]
        rows, ok = T.parse_table4(lines, None)
        self.assertIsNotNone(rows)
        self.assertNotIn("11", rows)
        self.assertFalse(ok)


class DataTests(unittest.TestCase):
    def entry(self, values, status="no_total_row", rows_sum=None):
        return {"values": values, "source": "printed_total" if values else "not_recorded", "reason": None,
                "reconciliation": {"status": status, "difference": {}, "judge_rows_sum": rows_sum}}

    def vals(self, civil):
        return {"civil_3y": civil, "motions_6m": 0, "bench_trials_6m": 0, "bankruptcy_appeals_6m": 0, "ss_appeals_6m": 0}

    def test_judge_row_sum_is_accepted_only_when_the_circuit_table_implies_it(self):
        districts = {"med": self.entry(self.vals(4), "reconciled"), "mad": self.entry(self.vals(10), "reconciled"), "prd": self.entry(self.vals(6), "reconciled"),
                     "rid": self.entry(self.vals(1), "reconciled"), "nhd": self.entry(None, "no_total_row", self.vals(3))}
        D.confirm_missing_totals(districts, {"1": self.vals(24)})
        self.assertEqual(districts["nhd"]["values"], self.vals(3))
        self.assertEqual(districts["nhd"]["source"], "judge_rows_sum_matches_circuit_table")

    def test_unconfirmed_sum_stays_not_recorded_with_a_reason(self):
        districts = {"med": self.entry(self.vals(4), "reconciled"), "mad": self.entry(self.vals(10), "reconciled"), "prd": self.entry(self.vals(6), "reconciled"),
                     "rid": self.entry(self.vals(1), "reconciled"), "nhd": self.entry(None, "no_total_row", self.vals(3))}
        D.confirm_missing_totals(districts, {"1": self.vals(99)})
        self.assertIsNone(districts["nhd"]["values"])
        self.assertEqual(districts["nhd"]["source"], "not_recorded")
        self.assertIn("do not match", districts["nhd"]["reason"])

    def test_another_unrecorded_district_blocks_confirmation(self):
        districts = {"med": self.entry(None, "not_listed"), "mad": self.entry(self.vals(10), "reconciled"), "prd": self.entry(self.vals(6), "reconciled"),
                     "rid": self.entry(self.vals(1), "reconciled"), "nhd": self.entry(None, "no_total_row", self.vals(3))}
        D.confirm_missing_totals(districts, {"1": self.vals(20)})
        self.assertIsNone(districts["nhd"]["values"])
        self.assertIn("could not confirm", districts["nhd"]["reason"])


class JudgeTests(unittest.TestCase):
    def index(self):
        return J.FjcIndex({"judges": [
            {"profile": "p1", "court": "nhd", "level": ["district"], "name": "Paul J. Barbadoro"},
            {"profile": "p2", "court": "nhd", "level": ["district"], "name": "Steven J. McAuliffe"},
            {"profile": "p3", "court": "nysd", "level": ["district"], "name": "William H. Pauley III"},
            {"profile": "p4", "court": "nysd", "level": ["district"], "name": "John G. Koeltl"},
            {"profile": "p5", "court": "nysd", "level": ["district"], "name": "John Gerard Koeltl"},
            {"profile": "p6", "court": "med", "level": ["district"], "name": "Julien Xavier Neals"}]})

    def match(self, court, printed):
        return self.index().match(court, P.parse_name(printed))

    def test_identity_key_folds_case_accents_and_punctuation_only(self):
        a = J.identity_key("nhd", P.parse_name("BARBADORO, PAUL J."))
        b = J.identity_key("nhd", P.parse_name("Barbadoro, Paul J"))
        c = J.identity_key("nhd", P.parse_name("BARBADORO, PAUL"))
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)       # a dropped middle initial is a different identity, never merged
        self.assertIsNone(J.identity_key("nhd", P.parse_name("PAUL BARBADORO")))

    def test_unique_exact_match_with_middle_initial_and_suffix(self):
        (profile, shown), status = self.match("nhd", "BARBADORO, PAUL J.")
        self.assertEqual((profile, shown, status), ("p1", "Paul J. Barbadoro", "unique"))
        (profile, _), status = self.match("nysd", "PAULEY, WILLIAM H., III")
        self.assertEqual((profile, status), ("p3", "unique"))

    def test_non_match_other_court_and_wrong_middle_initial(self):
        self.assertEqual(self.match("med", "BARBADORO, PAUL J."), (None, "none"))      # same name, different court
        self.assertEqual(self.match("nhd", "BARBADORO, PAUL K."), (None, "none"))      # different middle initial
        self.assertEqual(self.match("nhd", "BARBADORO, PAUL"), (None, "none"))         # middle initial missing on one side

    def test_ambiguous_match_is_not_linked(self):
        result, status = self.match("nysd", "KOELTL, JOHN G.")
        self.assertIsNone(result)
        self.assertEqual(status, "ambiguous")

    def test_unparsed_label_is_never_linked(self):
        self.assertEqual(self.match("nhd", "PAUL BARBADORO"), (None, "unparsed"))

    def test_display_name_preference_and_casing(self):
        n = P.parse_name("MCAULIFFE, STEVEN J.")
        self.assertEqual(J.display_name(n), "Steven J. McAuliffe")
        self.assertEqual(J.display_name(P.parse_name("O'TOOLE, GEORGE A., JR.")), "George A. O'Toole Jr.")
        self.assertEqual(J.display_name(n, fjc_name="Steven J. McAuliffe"), "Steven J. McAuliffe")
        mixed = P.parse_name("Takasugi, Robert M.")
        self.assertEqual(J.display_name(P.parse_name("TAKASUGI, ROBERT M."), mixed), "Robert M. Takasugi")


def fjc_row(nid, name, profiles, *services, status="Active"):
    return {"nid": nid, "name": name, "status": status, "profiles": list(profiles),
            "services": [{"court_id": c, "court_type": t, "commission": s, "termination": e} for c, t, s, e in services]}


class FjcLookupTests(unittest.TestCase):
    """Fixed lookup (de-judges-data): every FJC status, one profile per FJC nid, suffix and service-date guards."""

    DC = "U.S. District Court"

    def lookup(self, fjc, xwalk=()):
        return J.lookup_from_snapshots(fjc, list(xwalk))

    def match(self, lookup, court, printed, listed=None):
        return J.FjcIndex(lookup).match(court, P.parse_name(printed), listed)

    def test_senior_and_service_ended_judges_are_in_the_lookup(self):
        lk = self.lookup([fjc_row("1", "Alvin K. Hellerstein", ["p-hell"], ("nysd", self.DC, "1998-10-21", None), status="Senior"),
                          fjc_row("2", "Robert Porter Patterson, Jr.", ["p-pat"], ("nysd", self.DC, "1988-10-06", "2015-04-21"), status="Service ended")])
        (profile, _), status = self.match(lk, "nysd", "HELLERSTEIN, ALVIN K.", ["2026-03-31"])
        self.assertEqual((profile, status), ("p-hell", "unique"))
        (profile, _), status = self.match(lk, "nysd", "PATTERSON, ROBERT P., JR.", ["2004-03-31", "2015-09-30"])
        self.assertEqual((profile, status), ("p-pat", "unique"))

    def test_only_district_court_services_count(self):
        lk = self.lookup([fjc_row("3", "Jane Q. Roe", ["p-roe"], ("ca9", "U.S. Court of Appeals", "2010-01-01", None))])
        self.assertEqual(self.match(lk, "ca9", "ROE, JANE Q."), (None, "none"))
        self.assertEqual(lk["judges"], [])

    def test_profile_comes_from_crosswalk_when_the_fjc_record_has_none(self):
        lk = self.lookup([fjc_row("4", "Michelle Williams Court", [], ("cacd", self.DC, "2023-01-01", None))],
                         [{"judges_id": "p-court", "fjc_nid": "4"}])
        (profile, _), status = self.match(lk, "cacd", "COURT, MICHELLE WILLIAMS", ["2026-03-31"])
        self.assertEqual((profile, status), ("p-court", "unique"))

    def test_two_services_or_two_entries_of_one_nid_are_one_judge(self):
        lk = self.lookup([fjc_row("5", "Robert Lewis Hinkle", ["p-hink"], ("flnd", self.DC, "1996-01-01", None), ("flnd", self.DC, "1996-01-01", None))],
                         [{"judges_id": "p-hink", "fjc_nid": "5"}])
        (profile, _), status = self.match(lk, "flnd", "HINKLE, ROBERT L.", ["2026-03-31"])
        self.assertEqual((profile, status), ("p-hink", "unique"))

    def test_conflicting_profiles_for_one_nid_are_never_linked(self):
        lk = self.lookup([fjc_row("6", "J. Philip Calabrese", ["p-a"], ("ohnd", self.DC, "2020-12-01", None))],
                         [{"judges_id": "p-b", "fjc_nid": "6"}])
        self.assertEqual(lk["profile_conflicts"], ["6"])
        self.assertEqual(self.match(lk, "ohnd", "CALABRESE, J. PHILIP", ["2026-03-31"]), (None, "no_profile"))

    def test_judge_without_any_profile_is_no_profile(self):
        lk = self.lookup([fjc_row("7", "Anna Elizabeth Wagner St. John", [], ("txsd", self.DC, "2026-05-01", None))])
        self.assertEqual(self.match(lk, "txsd", "WAGNER ST. JOHN, ANNA E.", ["2026-03-31"]), (None, "no_profile"))
        lk2 = self.lookup([fjc_row("8", "Ana Isabel de Alba", [], ("caed", self.DC, "2022-06-01", None))])
        self.assertEqual(self.match(lk2, "caed", "DE ALBA, ANA I.", ["2026-03-31"]), (None, "no_profile"))

    def father_and_son(self):
        return self.lookup([fjc_row("10", "James Maxwell Moody", ["p-sr"], ("ared", self.DC, "1995-08-14", "2014-03-07"), status="Service ended"),
                            fjc_row("11", "James Maxwell Moody, Jr.", ["p-jr"], ("ared", self.DC, "2014-03-10", None))])

    def test_namesakes_are_told_apart_by_service_dates(self):
        lk = self.father_and_son()
        (profile, _), status = self.match(lk, "ared", "MOODY, JAMES MAXWELL", ["2004-03-31", "2013-09-30"])
        self.assertEqual((profile, status), ("p-sr", "unique"))
        (profile, _), status = self.match(lk, "ared", "MOODY, JAMES M., JR.", ["2014-03-31", "2026-03-31"])
        self.assertEqual((profile, status), ("p-jr", "unique"))

    def test_namesakes_without_dates_stay_ambiguous(self):
        self.assertEqual(self.match(self.father_and_son(), "ared", "MOODY, JAMES MAXWELL"), (None, "ambiguous"))

    def test_namesakes_both_serving_during_the_listings_stay_ambiguous(self):
        lk = self.lookup([fjc_row("12", "John A. Doe", ["p-1"], ("ded", self.DC, "2000-01-01", None)),
                          fjc_row("13", "John A. Doe, Jr.", ["p-2"], ("ded", self.DC, "2005-01-01", None))])
        self.assertEqual(self.match(lk, "ded", "DOE, JOHN A.", ["2006-03-31", "2010-03-31"]), (None, "ambiguous"))

    def test_contradicting_suffix_never_matches(self):
        lk = self.lookup([fjc_row("14", "William Horsley Orrick, Jr.", ["p-jr"], ("cand", self.DC, "1974-07-08", "2003-08-14"), status="Service ended"),
                          fjc_row("15", "William Horsley Orrick, III", ["p-3"], ("cand", self.DC, "2013-05-16", None))])
        (profile, _), status = self.match(lk, "cand", "ORRICK, WILLIAM H., III")
        self.assertEqual((profile, status), ("p-3", "unique"))

    def test_service_ended_long_before_the_listings_never_matches(self):
        lk = self.lookup([fjc_row("16", "Albert Vickers Bryan", ["p-old"], ("vaed", self.DC, "1947-06-05", "1961-08-24"), status="Service ended")])
        self.assertEqual(self.match(lk, "vaed", "BRYAN, ALBERT V.", ["2004-03-31"]), (None, "none"))
        lk2 = self.lookup([fjc_row("17", "Mary B. Grey", ["p-g"], ("ded", self.DC, "1990-01-01", "2004-01-15"), status="Service ended")])
        (profile, _), status = self.match(lk2, "ded", "GREY, MARY B.", ["2004-03-31"])  # printed once more on the next report
        self.assertEqual((profile, status), ("p-g", "unique"))

    def test_footnote_digits_after_the_name_are_ignored_but_initials_stay_strict(self):
        lk = self.lookup([fjc_row("18", "William Haskell Alsup", ["p-al"], ("cand", self.DC, "1999-01-01", None), status="Senior")])
        (profile, _), status = self.match(lk, "cand", "ALSUP, WILLIAM HASKELL 1", ["2012-03-31"])
        self.assertEqual((profile, status), ("p-al", "unique"))
        self.assertEqual(self.match(lk, "cand", "ALSUP, WILLIAM", ["2012-03-31"]), (None, "none"))  # dropped middle name: never linked

    def test_profile_link_text_covers_every_status(self):
        for status in ("unique", "none", "ambiguous", "no_profile", "unparsed"):
            self.assertTrue(J.PROFILE_LINK_TEXT[status])


class RelinkTests(unittest.TestCase):
    """relink_cjra_judges: packet rows and the patch contract text (synthetic snapshots; nothing is read or written)."""

    @classmethod
    def setUpClass(cls):
        import relink_cjra_judges as R
        cls.R = R

    def snap(self, rid, identity, listed, match=None, filt=None, role="district"):
        court = identity.split("|")[0]
        return {"id": rid, "title": rid, "identity": identity, "court_id": court, "roles": [role], "role": role, "active": "yes", "listed": listed,
                "match": match or {"status": "none", "profile": None}, "filter_judge_profile": filt, "row_md5": "0" * 32}

    def lookup(self):
        return J.lookup_from_snapshots([fjc_row("1", "Alvin K. Hellerstein", ["p-h"], ("nysd", "U.S. District Court", "1998-10-21", None), status="Senior"),
                                        fjc_row("2", "Paul J. Barbadoro", ["p-b"], ("nhd", "U.S. District Court", "1992-01-01", None))], [])

    def test_name_from_identity(self):
        self.assertEqual(self.R.name_from_identity("nysd|HELLERSTEIN|ALVIN K|"), {"format": "surname_first", "surname": "HELLERSTEIN", "given": "ALVIN K", "suffix": None})
        self.assertEqual(self.R.name_from_identity("ohnd|KNEPP|JAMES R|II")["suffix"], "II")
        self.assertIsNone(self.R.name_from_identity("nysd|raw|SOME LABEL"))

    def test_changes_link_new_rows_and_add_the_filter_to_kept_links(self):
        rows = [self.snap("nysd-hellerstein-alvin-k", "nysd|HELLERSTEIN|ALVIN K|", ["2004-03-31", "2026-03-31"]),
                self.snap("nhd-barbadoro-paul-j", "nhd|BARBADORO|PAUL J|", ["2026-03-31"], {"status": "unique", "profile": "p-b"}),
                self.snap("nhd-barbadoro-paul-j-2", "nhd|BARBADORO|PAUL J|", ["2026-03-31"], {"status": "unique", "profile": "p-b"}, ["p-b"]),
                self.snap("nhd-nobody-a", "nhd|NOBODY|A|", ["2026-03-31"])]
        results = self.R.relink(rows, self.lookup())
        chs = {c["id"]: c for c in self.R.changes(results)}
        self.assertEqual(chs["nysd-hellerstein-alvin-k"]["kind"], "linked")
        self.assertEqual(chs["nysd-hellerstein-alvin-k"]["after"], {"status": "unique", "profile": "p-h"})
        self.assertEqual(chs["nhd-barbadoro-paul-j"]["kind"], "filter_only")
        self.assertNotIn("nhd-barbadoro-paul-j-2", chs)   # already carries filters.judge_profile
        self.assertNotIn("nhd-nobody-a", chs)             # still unlinked, nothing to change
        before, after = self.R.counts(results, "before"), self.R.counts(results, "after")
        self.assertEqual((before["linked"], after["linked"]), (2, 3))

    def test_contract_is_guarded_and_reversible(self):
        rows = [self.snap("nysd-hellerstein-alvin-k", "nysd|HELLERSTEIN|ALVIN K|", ["2026-03-31"])]
        results = self.R.relink(rows, self.lookup())
        chs = self.R.changes(results)
        sql = self.R.render_sql(chs, self.R.counts(results, "before"), self.R.counts(results, "after"), {"cjra_judges": "x"})
        self.assertIn("md5(to_jsonb(r)::text) = c.original_record->>'row_md5'", sql)
        self.assertIn("ROLLBACK (exact)", sql)
        self.assertIn("'judge_profile', jsonb_build_array(x.profile)", sql)
        self.assertIn("('nysd-hellerstein-alvin-k', '00000000000000000000000000000000', 'unique', 'p-h',", sql)
        for forbidden in ("delete from", "drop ", "truncate"):
            self.assertNotIn(forbidden, sql.lower())
        preview = self.R.preview_sql(chs)
        self.assertNotIn("insert into", preview.lower())
        self.assertNotIn("update public", preview.lower())


class BuilderHelperTests(unittest.TestCase):
    def test_pct_change_not_computed_for_zero_or_missing_base(self):
        self.assertEqual(B.pct_change(110, 100), 10.0)
        self.assertEqual(B.pct_change(5, 6), -16.7)
        self.assertIsNone(B.pct_change(5, 0))
        self.assertIsNone(B.pct_change(None, 4))
        self.assertIsNone(B.pct_change(4, None))

    def test_competition_rank_ties_share_best_rank_and_skip_none(self):
        self.assertEqual(B.competition_rank({"a": 9, "b": 9, "c": 3, "d": None}), {"a": 1, "b": 1, "c": 3})
        self.assertEqual(B.competition_rank({"a": 1, "b": 2}, reverse=False), {"a": 1, "b": 2})

    def test_fmt_label_and_delta_text(self):
        self.assertEqual(B.fmt(None), "Not recorded")
        self.assertEqual(B.fmt(1234567), "1,234,567")
        self.assertEqual(B.fmt(12.345, 1, "%"), "12.3%")
        self.assertEqual(B.label("2026-03-31"), "Mar 31, 2026")
        self.assertEqual(B.delta_text(None, 3, None), "Not recorded")
        self.assertIn("zero base", B.delta_text(4, 0, None))
        self.assertEqual(B.delta_text(110, 100, 10.0), "+10 (+10.0%)")

    def make_ctx(self):
        def district(values, rows=()):
            return {"values": values, "source": "printed_total" if values else "not_recorded", "reason": None if values else "exempt", "rows": list(rows), "persons": len(rows),
                    "district_judges": len(rows), "magistrate_judges": 0, "assignments": 0, "pages": [3],
                    "reconciliation": {"status": "reconciled" if values else "not_listed", "difference": {}}}

        def vals(civil, motions=1):
            return {"civil_3y": civil, "motions_6m": motions, "bench_trials_6m": 0, "bankruptcy_appeals_6m": 0, "ss_appeals_6m": 0}

        data = {}
        for p, a, b in (("2025-09-30", vals(30), None), ("2026-03-31", vals(20), vals(80))):
            data[p] = {"districts": {"nhd": district(a, [{"notes": [], "printed": "X, Y"}]), "med": district(b)}, "main_file": {"url": f"https://example.test/{p}.pdf"}, "table_files": []}
        lookup = {"courts": {"nhd": ["District Court, D. New Hampshire", "NH"], "med": ["District Court, D. Maine", "ME"]}}
        return B.Context(lookup, data, {"judges": []}, {"ids": ["NH", "ME"]}, {"years": [2014], "pending_over_3y": {}}, manifest={})

    def test_district_records_shares_ranks_and_not_recorded(self):
        ctx = self.make_ctx()
        rows = B.district_records(ctx)
        by_id = {r["id"]: r for r in rows}
        nhd, med = by_id["nhd"]["item"], by_id["med"]["item"]
        self.assertEqual(nhd["series"]["civil_3y"], [30, 20])
        self.assertEqual(med["series"]["civil_3y"], [None, 80])                       # not recorded stays None, never zero
        self.assertEqual(med["not_recorded"], {"2025-09-30": "exempt"})
        self.assertEqual(nhd["share_civil_3y_pct"], [100.0, 20.0])                     # share = value / sum of recorded districts in the same report
        self.assertEqual(med["share_civil_3y_pct"], [None, 80.0])
        self.assertEqual(med["ranks"]["civil_3y"], 1)
        self.assertEqual(nhd["ranks"]["civil_3y"], 2)
        self.assertEqual(nhd["change_civil_3y"]["previous_pct"], -33.3)
        self.assertIsNone(med["change_civil_3y"]["previous_pct"])                      # earlier value not recorded
        self.assertEqual(by_id["nhd"]["state"], "NH")
        self.assertEqual(by_id["nhd"]["source_url"], "https://example.test/2026-03-31.pdf")
        self.assertTrue(any(l["url"] == "/places/NH" for l in by_id["nhd"]["item"]["links"]))
        facts = dict((f[0], f[1]) for f in by_id["med"]["detail"]["facts"])
        self.assertEqual(facts["Reports not recorded for this district"], "1")
        self.assertEqual(facts["Change from the previous report (six months earlier)"], "Not recorded")


if __name__ == "__main__":
    unittest.main()
