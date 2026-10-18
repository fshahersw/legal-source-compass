"""Offline unit tests for the NEISS stream (synthetic fixtures only; no network, no private data).

  cd scripts/enrichment/neiss && python3 -B -m unittest -v test_neiss
"""
import gzip
import json
import math
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import aggregate as A  # noqa: E402
import build_neiss as B  # noqa: E402
import codes as C  # noqa: E402
import highlights as H  # noqa: E402
import neiss_lib as L  # noqa: E402
import pooling as P  # noqa: E402
import render as R  # noqa: E402
import themes as T  # noqa: E402

HEADER = ("CPSC_Case_Number\tTreatment_Date\tAge\tSex\tRace\tOther_Race\tHispanic\tBody_Part\tDiagnosis\tOther_Diagnosis\tBody_Part_2\t"
          "Diagnosis_2\tOther_Diagnosis_2\tDisposition\tLocation\tFire_Involvement\tProduct_1\tProduct_2\tProduct_3\tAlcohol\tDrug\t"
          "Narrative\tStratum\tPSU\tWeight")


def line(case, date="06/01/2099", age=30, sex=1, body=75, diag=57, disp=1, loc=1, p1=1233, p2="", p3="", narrative="FELL.", stratum="S", psu=1,
         weight=10.0, fire=0):
    f = [case, date, age, sex, 1, "", 0, body, diag, "", "", "", "", disp, loc, fire, p1, p2, p3, "", "", narrative, stratum, psu, weight]
    return "\t".join(str(x) for x in f)


def records(lines, year=2099):
    stats = L.YearStats()
    out = list(L.iter_records([HEADER] + lines, year, stats))
    return out, stats


class ParsingTests(unittest.TestCase):
    def test_normal_record_fields(self):
        recs, st = records([line(1, age=212, sex=2, p2=5022, weight=12.5, psu=7, stratum="M")])
        r = recs[0]
        self.assertEqual((r["case"], r["age"], r["sex"], r["p1"], r["p2"], r["p3"], r["stratum"], r["psu"], r["weight"], r["month"]),
                         (1, 212, 2, 1233, 5022, None, "M", 7, 12.5, 6))
        self.assertEqual(st.rejected, {})

    def test_rejections_are_counted_and_never_repaired(self):
        recs, st = records([line(1, stratum="X"), line(2, weight=0), line(3, date="2099-06-01"), line(4, psu="abc"), line(5, weight="n/a"), line(6)])
        self.assertEqual([r["case"] for r in recs], [6])
        self.assertEqual(sum(st.rejected.values()), 5)
        self.assertEqual(st.rejected["stratum not S/M/L/V/C"], 1)
        self.assertEqual(st.rejected["Weight missing or not positive"], 2)

    def test_narrative_split_by_stray_line_break_is_rejoined(self):
        whole = line(9, narrative="PT FELL OFF BIKE AND HIT HEAD DX: CONTUSION", weight=33.0, psu=4)
        cut = whole.index("HIT HEAD")
        recs, st = records([whole[:cut], whole[cut:]])
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["narrative"], "PT FELL OFF BIKE AND HIT HEAD DX: CONTUSION")
        self.assertEqual(recs[0]["weight"], 33.0)
        self.assertEqual(st.joined_records, 1)

    def test_quoted_field_with_tab_is_merged(self):
        f = line(11).split("\t")
        f[9] = '"SYNCOPE, SEIZURE-LIKE ACTIVITY\t"'      # Other_Diagnosis holds a tab inside quotes
        recs, st = records(["\t".join(f)])
        self.assertEqual(len(recs), 1)
        self.assertEqual(st.quote_merged, 1)
        self.assertEqual(recs[0]["psu"], 1)

    def test_duplicates_and_date_year_mismatch_are_counted(self):
        recs, st = records([line(1), line(1), line(2, date="06/01/2098")])
        self.assertEqual(len(recs), 3)
        self.assertEqual(st.duplicates, 1)
        self.assertEqual(st.date_year_mismatch, 1)

    def test_blank_lines_skipped(self):
        recs, st = records(["", line(1), ""])
        self.assertEqual(len(recs), 1)

    def test_age_codes(self):
        self.assertIsNone(L.age_years(None))
        self.assertIsNone(L.age_years(0))
        self.assertIsNone(L.age_years(1))        # not a valid years code
        self.assertEqual(L.age_years(2), 2)
        self.assertEqual(L.age_years(120), 120)
        self.assertEqual(L.age_years(201), 0)    # 1 month
        self.assertEqual(L.age_years(211), 0)    # 11 months
        self.assertEqual(L.age_years(212), 1)    # 12 months
        self.assertEqual(L.age_years(223), 1)
        self.assertIsNone(L.age_years(224))
        self.assertEqual(L.coarse_band(4), "0-4")
        self.assertEqual(L.coarse_band(5), "5-14")
        self.assertEqual(L.coarse_band(65), "65+")
        self.assertEqual(L.coarse_band(0), "Not recorded")
        self.assertEqual(L.fine_band(205), "<1")
        self.assertEqual(L.fine_band(90), "85+")
        self.assertEqual(L.fine_band(34), "25-34")

    def test_gzip_file_with_crlf_terminators_and_embedded_lf(self):
        text = "\r\n".join([HEADER, line(1, narrative="LINE ONE\nLINE TWO"), line(2)]) + "\r\n"
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "neiss2099.tsv.gz")
            with gzip.open(p, "wb") as fh:
                fh.write(text.encode("cp1252"))
            recs, st = L.read_year(p, 2099)
            recs = list(recs)
        self.assertEqual([r["case"] for r in recs], [1, 2])
        self.assertIn("LINE TWO", recs[0]["narrative"])


class VarianceTests(unittest.TestCase):
    def test_stratum_variance_hand_computed(self):
        # n_h = 3 hospitals, two with cases (10 and 20), one without: deviations 0, 10, -10 -> SS 200, factor 3/2 -> 300
        self.assertAlmostEqual(L.stratum_variance([10.0, 20.0], 3), 300.0)
        self.assertEqual(L.stratum_variance([5.0], 1), 0.0)       # a single hospital stratum cannot be estimated
        self.assertEqual(L.stratum_variance([], 4), 0.0)

    def test_design_variance_adds_strata(self):
        v = L.design_variance({"S": [20.0, 10.0], "M": [5.0]}, {"S": 2, "M": 1, "L": 0})
        self.assertAlmostEqual(v, 100.0)

    def test_cv_ci_and_reliability_rule(self):
        self.assertAlmostEqual(L.cv_of(100.0, 25.0), 0.05)
        self.assertIsNone(L.cv_of(0.0, 1.0))
        self.assertEqual(L.ci95(100000, 0.09), [100000 - 1.96 * 9000, 100000 + 1.96 * 9000])
        self.assertEqual(L.ci95(100, 2.0)[0], 0.0)                   # lower bound floored at zero
        self.assertTrue(L.reliability(1200, 20, 0.33)[0])
        self.assertFalse(L.reliability(1199, 20, 0.1)[0])
        self.assertFalse(L.reliability(5000, 19, 0.1)[0])
        self.assertFalse(L.reliability(5000, 50, 0.3301)[0])
        ok, why = L.reliability(100, 5, 0.5)
        self.assertFalse(ok)
        self.assertEqual(len(why), 3)
        self.assertFalse(L.reliability(None, None, None)[0])

    def _acc(self):
        acc = A.Acc()
        # stratum S: hospital 1 two cases (10 each, one admitted), hospital 2 one case (10); stratum M: hospital 3 one case (5)
        data = [("S", 1, 10.0, 4), ("S", 1, 10.0, 1), ("S", 2, 10.0, 1), ("M", 3, 5.0, 1)]
        for h, psu, w, disp in data:
            acc.add_all([("nat",)], acc.pair(h, psu), w, disp)
        return acc

    def test_accumulator_matches_hand_computation(self):
        res = self._acc().reduce()[("nat",)]
        est, cases, var, est4, cases4, var4, rvar4 = res[:7]
        self.assertEqual((est, cases), (35.0, 4))
        self.assertAlmostEqual(var, 100.0)       # S: totals 20,10 over n=2 -> 2*(500-450)=100; M: single hospital -> 0
        self.assertEqual((est4, cases4), (10.0, 1))
        self.assertAlmostEqual(var4, 100.0)
        # ratio variance agrees with the stand-alone Taylor routine
        R_, v = L.ratio_variance({"S": {1: 20.0, 2: 10.0}, "M": {3: 5.0}}, {"S": {1: 10.0}}, {"S": 2, "M": 1})
        self.assertAlmostEqual(R_, 10.0 / 35.0)
        self.assertAlmostEqual(rvar4, v)
        self.assertAlmostEqual(rvar4, 0.04166, places=4)

    def test_hospital_and_doa_grouping(self):
        acc = A.Acc()
        for disp in (1, 2, 4, 5, 6, 8, 9):
            acc.add_all([("d",)], acc.pair("S", 1), 1.0, disp)
        t = acc.reduce()[("d",)]
        self.assertEqual(t[3], 1.0)      # disposition 4 only
        self.assertEqual(t[7], 4.0)      # 2, 4, 5, 8

    def test_run_pass_on_synthetic_file(self):
        rows = [line(1, psu=1, weight=10, disp=4), line(2, psu=1, weight=10), line(3, psu=2, weight=10), line(4, stratum="M", psu=3, weight=5, p1=5022)]
        text = "\r\n".join([HEADER] + rows) + "\r\n"
        with tempfile.TemporaryDirectory() as d:
            with gzip.open(os.path.join(d, "neiss2099.tsv.gz"), "wb") as fh:
                fh.write(text.encode("cp1252"))
            old = A.TSV_DIR
            A.TSV_DIR = d
            try:
                res, info = A.run_pass([2099], A.year_keys, collect_meta=True)
            finally:
                A.TSV_DIR = old
        nat = res[("nat",)]
        self.assertAlmostEqual(nat[0], 35.0)
        self.assertEqual(nat[1], 4)
        self.assertAlmostEqual(nat[2], 100.0)
        self.assertEqual(info["hospitals"], 3)
        self.assertEqual(info["n_h"]["S"], 2)
        self.assertEqual(info["psu_multi_stratum"], {})
        self.assertAlmostEqual(res[("prod", 1233)][0], 30.0)
        self.assertAlmostEqual(res[("prod", 5022)][0], 5.0)
        self.assertEqual(res[("sex", 1)][1], 4)
        self.assertAlmostEqual(info["files"][2099]["meta"]["weight_sum"], 35.0)

    def test_hospital_identifier_in_two_strata_is_reported(self):
        rows = [line(1, stratum="S", psu=9), line(2, stratum="M", psu=9)]
        text = "\r\n".join([HEADER] + rows) + "\r\n"
        with tempfile.TemporaryDirectory() as d:
            with gzip.open(os.path.join(d, "neiss2099.tsv.gz"), "wb") as fh:
                fh.write(text.encode("cp1252"))
            old = A.TSV_DIR
            A.TSV_DIR = d
            try:
                _res, info = A.run_pass([2099], A.year_keys)
            finally:
                A.TSV_DIR = old
        self.assertEqual(info["psu_multi_stratum"], {9: ["M", "S"]})


class PoolingTests(unittest.TestCase):
    def seg(self, rows):
        acc = A.Acc()
        for h, psu, w, disp in rows:
            acc.add_all([("nat",)], acc.pair(h, psu), w, disp)
        return acc.reduce()[("nat",)]

    def test_single_segment_is_identity(self):
        t = self.seg([("S", 1, 10.0, 4), ("S", 1, 10.0, 1), ("S", 2, 10.0, 1), ("M", 3, 5.0, 1)])
        c = P.combine([t])
        for i in range(11):
            if t[i] is None:
                self.assertIsNone(c[i])
            else:
                self.assertAlmostEqual(c[i], t[i], places=9)

    def test_two_segments_sum_and_upper_bound(self):
        a = self.seg([("S", 1, 10.0, 4), ("S", 2, 30.0, 1), ("M", 3, 5.0, 1), ("M", 4, 7.0, 4)])
        b = self.seg([("S", 1, 20.0, 1), ("S", 2, 10.0, 4), ("M", 3, 9.0, 1), ("M", 4, 1.0, 1)])
        c = P.combine([a, b])
        self.assertAlmostEqual(c[0], a[0] + b[0])
        self.assertEqual(c[1], a[1] + b[1])
        self.assertAlmostEqual(c[2], (math.sqrt(a[2]) + math.sqrt(b[2])) ** 2)
        self.assertGreaterEqual(c[2], a[2] + b[2])                  # never below the independent-periods variance
        self.assertAlmostEqual(c[3], a[3] + b[3])
        self.assertGreaterEqual(c[6], 0.0)

    def test_absent_domain_in_one_segment(self):
        a = self.seg([("S", 1, 10.0, 4), ("S", 2, 30.0, 1)])
        self.assertEqual(P.combine([a, None])[0], a[0])
        self.assertAlmostEqual(P.combine([None, a])[2], a[2])
        self.assertIsNone(P.combine([None, None]))

    def test_combine_results_unions_keys(self):
        a = {("nat",): self.seg([("S", 1, 10.0, 4), ("S", 2, 30.0, 1)])}
        b = {("nat",): self.seg([("S", 1, 5.0, 1), ("S", 2, 5.0, 1)]), ("prod", 1): self.seg([("S", 1, 5.0, 1), ("S", 2, 1.0, 1)])}
        out = P.combine_results([a, b])
        self.assertEqual(set(out), {("nat",), ("prod", 1)})
        self.assertAlmostEqual(out[("nat",)][0], 50.0)
        self.assertAlmostEqual(out[("prod", 1)][0], 6.0)


class RenderTests(unittest.TestCase):
    def test_unstable_estimates_are_withheld(self):
        f = R.figure(1000.0, 500, 100.0)                 # estimate below 1,200
        self.assertFalse(f["reliable"])
        self.assertIsNone(f["estimate"])
        self.assertEqual(f["cases"], 500)
        self.assertIn("estimate below 1,200", f["reasons"])
        g = R.figure(50000.0, 19, 100.0)
        self.assertIn("fewer than 20 cases", g["reasons"])
        h = R.figure(50000.0, 400, 50000.0 ** 2 * 0.4 ** 2)
        self.assertIn("CV above 33%", h["reasons"])

    def test_reliable_figure_has_cv_and_cpsc_interval(self):
        f = R.figure(100000.0, 300, (100000 * 0.09) ** 2)
        self.assertTrue(f["reliable"])
        self.assertEqual(f["estimate"], 100000)
        self.assertEqual(f["cv"], 0.09)
        self.assertEqual(f["ci95"], [82360, 117640])        # CPSC's worked example in its explanation of estimates
        self.assertIn("CV 9.0%", R.fig_text(f))

    def test_absent_domain_is_not_zero(self):
        f = R.absent_figure()
        self.assertFalse(f["reliable"])
        self.assertIsNone(f["estimate"])
        self.assertEqual(f["cases"], 0)
        self.assertIn("no sample cases", R.fig_text(f))

    def test_share_needs_both_reliable_figures(self):
        num = R.figure(20000.0, 100, 1e6)
        den = R.figure(100000.0, 500, 1e7)
        s = R.share_figure(num, den, 20000.0, 100000.0, 0.0004)
        self.assertTrue(s["reliable"])
        self.assertAlmostEqual(s["share"], 0.2)
        self.assertAlmostEqual(s["cv"], 0.1)
        self.assertEqual(s["ci95"], [round(0.2 - 1.96 * 0.02, 5), round(0.2 + 1.96 * 0.02, 5)])
        weak = R.figure(500.0, 5, 10.0)
        self.assertFalse(R.share_figure(weak, den, 500.0, 100000.0, 0.0004)["reliable"])
        self.assertEqual(R.share_text(R.share_figure(weak, den, 500.0, 100000.0, 0.0004)), R.UNSTABLE)

    def test_change_test_is_conservative(self):
        a = (1000000.0, 100, 1e9)
        b = (1200000.0, 100, 1e9)
        self.assertTrue(R.change(a, b)["exceeds_sampling_error"])       # diff 200,000 > 1.96 * sqrt(2e9) = 87,658
        c = (1050000.0, 100, 1e9)
        self.assertFalse(R.change(a, c)["exceeds_sampling_error"])
        self.assertEqual(R.change(a, b)["difference"], 200000)
        self.assertIsNone(R.change(None, b))

    def test_labels_not_recorded_paths(self):
        lab = R.Labels({"Sex": {1: "Male"}}, {1233: {"label": "Trampolines", "source": "S", "in_use": True, "alternates": [], "comparability": None}})
        self.assertEqual(lab.coded("Sex", 1), "Male")
        self.assertEqual(lab.coded("Sex", None), "Not recorded")
        self.assertEqual(lab.coded("Sex", -1), "Not recorded")
        self.assertIn("code 9 has no label", lab.coded("Sex", 9))
        self.assertTrue(lab.coded("Diagnosis", 70).startswith("Not recorded"))
        self.assertEqual(lab.product(1233)[0], "Trampolines")
        self.assertTrue(lab.product(99999)[0].startswith("Not recorded"))   # non-match: the code is in no CPSC document
        self.assertIsNone(lab.product(99999)[1])
        self.assertEqual(lab.band("Not recorded"), "Not recorded")
        self.assertEqual(lab.band("5-14"), "5-14 years")
        self.assertEqual(lab.month(13), "Not recorded")
        self.assertEqual(R.num(None), "Not recorded")

    def test_ordering_puts_unstable_last(self):
        es = [{"code": 1, "estimate": None, "cases": 5}, {"code": 2, "estimate": 10, "cases": 1}, {"code": 3, "estimate": 99, "cases": 1}]
        self.assertEqual([e["code"] for e in R.ordered(es)], [3, 2, 1])


PRODUCT_LISTING = """
Appendix H: Numerical Listing of NEISS Product Codes
   Code   Product Title
   1233   Trampolines
   1213   Golf carts, motorized vehicle
   5046   Power-assisted cycles, not elsewhere classified (excl. off-road
          vehicles, minibikes, and licensed vehicles.)
          Cosmetics, including facial and eye make-up, deodorants,
   1913
          nail polish and removers, etc.
   NEISS Coding Manual   Appendices Page 12
"""

COMPARABILITY = """
Title                                                NEISS        CPSRMS Notes
0117* Automatic door openers and closers; automatic        72-78        72-78         Expanded into 0137 & 0138
      garage doors
0141
1233  Trampolines (comparability title)                    72--         72--
1936  BBs or pellets                                       79--         79--          Expansion of 1919
1939  Illegal drugs (incl. cocaine, crack, heroin,         04--
      marijuana, PCP, and hallucinogens
1940* Mouthwashes or mouth rinses (excl. peroxide)         96A-01       96A-01        Previously included in code 2640.
                                                                                      Deleted when 2640 was reinstated as
5042* Scooters/skateboards, powered                        98O-19       98O-19
"""


class CodesTests(unittest.TestCase):
    def test_product_listing_wrapped_and_three_line_titles(self):
        out = C.parse_product_listing(PRODUCT_LISTING)
        self.assertEqual(out[1233], "Trampolines")
        self.assertEqual(out[5046], "Power-assisted cycles, not elsewhere classified (excl. off-road vehicles, minibikes, and licensed vehicles.)")
        self.assertIn("Cosmetics, including facial and eye make-up", out[1913])

    def test_comparability_rows_with_missing_columns_and_wraps(self):
        out = C.parse_comparability(COMPARABILITY)
        self.assertEqual(out[117]["title"], "Automatic door openers and closers; automatic garage doors")
        self.assertTrue(out[117]["deleted"])
        self.assertEqual(out[1936]["title"], "BBs or pellets")                    # not polluted by the next row's wrapped title
        self.assertEqual(out[1939]["title"], "Illegal drugs (incl. cocaine, crack, heroin, marijuana, PCP, and hallucinogens")
        self.assertEqual(out[1939]["neiss_span"], "04--")
        self.assertEqual(out[1940]["title"], "Mouthwashes or mouth rinses (excl. peroxide)")   # the notes column wrap is ignored
        self.assertNotIn(141, out)                                                # reserved code with no title
        self.assertEqual(out[5042]["neiss_span"], "98O-19")
        self.assertNotIn("Title", " ".join(v["title"] for v in out.values()))

    def test_label_precedence_conflict_and_non_match(self):
        labels = C.product_labels(PRODUCT_LISTING, "", COMPARABILITY)
        # 1233 is in the 2025 manual AND the comparability table with a different title: the manual wins, the other is kept as an alternate
        self.assertEqual(labels[1233]["label"], "Trampolines")
        self.assertTrue(labels[1233]["source"].startswith("NEISS Coding Manual January 2025"))
        self.assertEqual([a[0] for a in labels[1233]["alternates"]], ["Trampolines (comparability title)"])
        self.assertTrue(labels[1233]["in_use"])
        # comparability-only code marked deleted
        self.assertFalse(labels[5042]["in_use"])
        self.assertTrue(labels[5042]["comparability"]["deleted"])
        # a code in no document is absent (the builder renders it as Not recorded)
        self.assertNotIn(4242, labels)

    def test_dictionary_rows(self):
        rows = [("Diagnosis", "DIAG", "Diagnosis code"), (None, None, "41 = Ingestion"), (None, None, "50 = Amputaion"), (None, None, "not a code line"),
                ("Sex", "SEX", None), (None, None, "1 = Male")]
        out = C.parse_dictionary_rows(rows)
        self.assertEqual(out["Diagnosis"], {41: "Ingestion", 50: "Amputation"})    # the CPSC spelling slip is corrected
        self.assertEqual(out["Sex"], {1: "Male"})


class ThemeTests(unittest.TestCase):
    def test_positive_and_negative_matches(self):
        m = T.match
        self.assertIn("escooter", m("16 YOM FELL OFF AN ELECTRIC SCOOTER DX WRIST FX"))
        self.assertIn("escooter", m("RIDING A RENTAL SCOOTER E-SCOOTER"))
        self.assertNotIn("escooter", m("5 YOM RIDING A NON MOTORIZED SCOOTER FELL"))
        self.assertNotIn("escooter", m("FELL OFF HER MOBILITY SCOOTER"))
        self.assertNotIn("escooter", m("FELL OFF UNPOWERED SCOOTER"))
        self.assertIn("ebike", m("FELL OFF E-BIKE GOING TO SCHOOL"))
        self.assertIn("ebike", m("rode his electric bike into a pole"))
        self.assertNotIn("ebike", m("FELL OFF BIKE"))
        self.assertIn("hoverboard", m("FELL OFF HOVER BOARD"))
        self.assertIn("pickleball", m("PLAYING PICKLE BALL TORE CALF"))
        self.assertIn("water_beads", m("SWALLOWED A WATER BEAD"))
        self.assertNotIn("water_beads", m("SHOT WITH GEL BLASTER"))
        self.assertIn("detergent_pod", m("BIT A LAUNDRY POD"))
        self.assertNotIn("detergent_pod", m("INHALED A VAPE POD"))
        self.assertIn("magnet_ingestion", m("2 YOF SWALLOWED A MAGNET"))
        self.assertNotIn("magnet_ingestion", m("HAD AN MRI WITH A MAGNET IN THE ROOM"))
        self.assertIn("battery_ingestion", m("SWALLOWED A BUTTON BATTERY"))
        self.assertIn("battery_fire", m("LITHIUM BATTERY EXPLODED IN POCKET"))
        self.assertNotIn("battery_fire", m("CHANGING THE BATTERY IN A SMOKE DETECTOR FELL OFF LADDER"))
        self.assertNotIn("battery_fire", m("CAR BATTERY EXPLODED"))

    def test_empty_narrative_and_none(self):
        self.assertEqual(T.match(""), ())
        self.assertEqual(T.match(None), ())

    def test_definitions_hash_changes_with_patterns(self):
        h = T.definitions_hash()
        self.assertEqual(h, T.definitions_hash())
        old = T.DEFS["pickleball"]["include"]
        try:
            T.DEFS["pickleball"]["include"] = old + [r"\bpaddle\b"]
            self.assertNotEqual(h, T.definitions_hash())
        finally:
            T.DEFS["pickleball"]["include"] = old
        self.assertEqual(h, T.definitions_hash())


class HighlightsTests(unittest.TestCase):
    def test_row_parse_and_skip(self):
        text = ("Basketball                            332,391     .09     10,485   200  300\n"
                "Totals have changed                   see note\n"
                "Golf                                   67,488     .28      1,375   500   600\n")
        rows = H.parse_highlights(text)
        self.assertEqual([r["group"] for r in rows], ["Basketball", "Golf"])
        self.assertEqual(rows[0]["estimate"], 332391)
        self.assertEqual(rows[0]["cv"], 0.09)
        self.assertEqual(rows[1]["cases"], 1375)


class BuilderTests(unittest.TestCase):
    def row(self, ds, rid, links=()):
        return B.rec(ds, rid, "T " + rid, source_url="https://example.test/x", subtitle="s", cells={"a": 1}, facts=[("k", "v")], text="t",
                     filters={"f": ["x"]}, links=list(links))

    def test_record_shape_matches_corpus_writer(self):
        r = self.row("neiss_x", "1")
        self.assertEqual(r["dataset"], "neiss_x")
        self.assertEqual(r["category"], "neiss_x")
        self.assertEqual(r["detail"]["facts"], [["k", "v"]])
        self.assertEqual(r["filters"]["_listing"], ["yes"])
        self.assertNotIn("ordinal", r)

    def test_links_found_and_dangling_links_detected(self):
        a = self.row("neiss_a", "1", [{"label": "ok", "url": "/records/neiss_b/9"}, {"label": "ext", "url": "https://example.test"}])
        b = self.row("neiss_b", "9", [{"label": "gone", "url": "/records/neiss_b/404"}])
        total, ok, bad = B.check_links({"neiss_a": [a], "neiss_b": [b]})
        self.assertEqual((total, ok), (4, 2))          # each internal link is counted in item and detail
        self.assertEqual(sorted(set(x[1] for x in bad)), ["/records/neiss_b/404"])

    def test_design_break_counts_hospitals_that_moved(self):
        segs = [{"info": {"year_pairs": {2023: [("S", 1), ("V", 2), ("V", 3)]}}}, {"info": {"year_pairs": {2024: [("S", 1), ("M", 2), ("L", 4)]}}}]
        db = B.design_break(segs)
        self.assertEqual(db["in_both_years"], 2)
        self.assertEqual(db["changed_stratum"], 1)
        self.assertEqual(db["strata_2023"], {"S": 1, "V": 2})
        self.assertIn("1 of the 2 hospital identifiers", B.break_note(db))
        self.assertIn("UPPER bound", B.pool_note(db))

    def test_write_build_rejects_duplicate_ids_and_unstable_json(self):
        with tempfile.TemporaryDirectory() as d:
            old = B.OUT
            B.OUT = d
            try:
                with self.assertRaises(SystemExit):
                    B.write_build("neiss_x", "l", {}, {}, [self.row("neiss_x", "1"), self.row("neiss_x", "1")], [], "now")
                bad = self.row("neiss_x", "2")
                bad["item"]["cells"] = {"t": (1, 2)}          # a tuple does not survive a JSON round trip
                with self.assertRaises(SystemExit):
                    B.write_build("neiss_x", "l", {}, {}, [bad], [], "now")
                info = B.write_build("neiss_x", "l", {}, {"s": 1}, [self.row("neiss_x", "3")], [], "now")
                self.assertEqual(info["rows"], 1)
                with open(os.path.join(d, "neiss_x.json"), encoding="utf-8") as fh:
                    blob = json.load(fh)
                self.assertEqual(set(blob), {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs"})
            finally:
                B.OUT = old

    def test_tab_entries_handles_unlabelled_codes_and_unstable_cells(self):
        lab = R.Labels({"Diagnosis": {57: "Fracture"}}, {})
        res = {("diag", 57): (500000.0, 800, (500000 * 0.1) ** 2), ("diag", 70): (800.0, 10, 100.0), ("sex", 1): (1.0, 1, 0.0)}
        total = R.figure(1000000.0, 2000, (1000000 * 0.08) ** 2)
        ents = B.tab_entries(res, "diag", lambda c: lab.coded("Diagnosis", c), total)
        self.assertEqual([e["code"] for e in ents], [57, 70])
        self.assertEqual(ents[0]["label"], "Fracture")
        self.assertEqual(ents[0]["share"], 0.5)
        self.assertTrue(ents[1]["label"].startswith("Not recorded"))
        self.assertIsNone(ents[1]["estimate"])             # unstable: withheld, only the sample case count is kept
        self.assertEqual(ents[1]["cases"], 10)
        self.assertIsNone(ents[1]["share"])

    def test_dataset_ids_valid_and_unique(self):
        import re
        ids = [B.DS_YEARS, B.DS_PRODUCTS, B.DS_DIMS, B.DS_THEMES]
        self.assertEqual(len(set(ids)), 4)
        for i in ids:
            self.assertRegex(i, r"^[a-z0-9_]{1,80}$")


if __name__ == "__main__":
    unittest.main()
