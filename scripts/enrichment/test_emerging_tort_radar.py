"""Offline tests for build_emerging_tort_radar.py (synthetic rows shaped like the read-only inputs; no network).

  python -B -m unittest scripts/enrichment/test_emerging_tort_radar.py -v
"""
import datetime as dt
import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_emerging_tort_radar as r  # noqa: E402

mdl_map = r.mdl_map
AS_OF = dt.date(2026, 10, 27)
END = "2026-06-01"


def win(sid, series, recent, baseline, months=36, tail=None, tag=""):
    h = hashlib.md5(f"{sid if not tag else tag}:{series}:{recent}:{baseline}".encode()).hexdigest()
    return {"subject_id": sid, "series": series, "recent": recent, "baseline": baseline, "recent_months": 12, "baseline_months": months,
            "coverage_from": "2004-01-01", "coverage_to": END, "values_hash": h, "tail": tail or [recent // 12] * 24}


def faers(sid, reports, base, serious=None, sbase=None, deaths=None, dbase=None, tag=""):
    serious = reports // 2 if serious is None else serious
    sbase = base // 2 if sbase is None else sbase
    deaths = reports // 50 if deaths is None else deaths
    dbase = base // 50 if dbase is None else dbase
    return [win(sid, "faers_reports", reports, base, tag=tag), win(sid, "faers_serious", serious, sbase, tag=tag),
            win(sid, "faers_death", deaths, dbase, tag=tag)]


class Inputs:
    basis = "test"

    def __init__(self, **kw):
        self.subjects = [{"id": "national:faers", "label": "All FAERS", "keys": {}}]
        self.mdl_links = []
        self.faers_windows = faers("national:faers", 1_200_000, 3_600_000, 600_000, 1_800_000, 60_000, 180_000)
        self.mdls = [{"id": str(m), "title": t, "source_url": "https://www.jpml.uscourts.gov/x.pdf",
                      "item": {"status": "pending", "date_transferred": d}} for m, t, d in [
            (3094, "IN RE: Glucagon-like Peptide-1 Receptor Agonists (GLP-1 RAs) Products Liability Litigation", "2024-02-02"),
            (3163, "IN RE: GLP-1 RAs Non-Arteritic Anterior Ischemic Optic Neuropathy Products Liability Litigation", "2025-12-15"),
            (2789, "IN RE: Proton-Pump Inhibitor Products Liability Litigation (No. II)", "2017-08-02"),
            (2974, "IN RE: Paragard IUD Products Liability Litigation", "2020-12-16"),
            (3140, "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation", "2025-02-07")]]
        self.terminated = []
        self.hearing_orders = []
        self.drugsfda = [{"id": "openfda:drug/drugsfda:NDA018680", "fields": {"application_number": "NDA018680", "brand_names": '["PARAGARD T 380A"]',
                                                                              "active_ingredients": '["COPPER"]', "sponsor_name": "COOPERSURGICAL"}}]
        self.nhtsa_max_received = "2026-10-21"
        self.nhtsa_windows = [{"scope": "national", "make": None, "model": None, "component": None, "recent": 77000, "prior": 73000,
                               "recent_severe": 5000, "prior_severe": 4000, "recent_deaths": 60, "prior_deaths": 50,
                               "recent_injured": 900, "prior_injured": 800, "months": [6000] * 24}]
        self.investigations, self.recalls, self.sec, self.term_quarters = [], [], [], []
        self.ndc = None
        for k, v in kw.items():
            setattr(self, k, v)

    def add_drug(self, slug, generic, reports, base, **kw):
        sid = f"faers:{slug}"
        self.subjects.append({"id": sid, "label": generic, "keys": {"generic_name": generic}, "reports_total": reports * 10})
        self.faers_windows += faers(sid, reports, base, **kw)
        return sid


REVIEWED = r.load_json(r.REVIEWED)


def build(inp, reviewed=REVIEWED):
    radar = r.Radar(inp, reviewed, AS_OF)
    units = radar.build()
    return {u["unit_id"]: u for u in units}, radar


class StatisticsTest(unittest.TestCase):
    def test_exact_poisson_limits(self):
        self.assertAlmostEqual(r.poisson_lower(10), 4.7954, places=3)   # chi2(0.025, 20) / 2
        self.assertAlmostEqual(r.poisson_upper(10), 18.3904, places=3)  # chi2(0.975, 22) / 2
        self.assertAlmostEqual(r.poisson_lower(1), 0.0253, places=3)
        self.assertEqual(r.poisson_lower(0), 0.0)
        big = r.poisson_lower(75_000)
        self.assertLess(big, 75_000)
        self.assertGreater(big, 75_000 - 2 * 1.96 * 274)

    def test_points_bands_and_minimum(self):
        c = r.rate_component("A", "x", 49, 30, 36)
        self.assertFalse(c["rated"])
        self.assertEqual(c["note"], "Too few reports to rate")
        self.assertEqual(c["points"], 0)
        c = r.rate_component("A", "x", 300, 300, 36)  # E = 100, ratio 3
        self.assertEqual(c["points"], 2)
        self.assertGreater(c["ci_low"], 1.5)
        c = r.rate_component("A", "x", 150, 300, 36)  # lower bound ~127 / 100
        self.assertEqual(c["points"], 1)
        c = r.rate_component("A", "x", 120, 300, 36)  # ratio 1.2 but lower bound below 1: no point
        self.assertEqual(c["points"], 0)
        c = r.rate_component("A", "x", 100, 300, 36)
        self.assertEqual(c["points"], 0)
        c = r.rate_component("A", "x", 500, 100, 12)
        self.assertFalse(c["rated"])
        self.assertIn("Baseline covers 12 months", c["note"])

    def test_partial_month_is_dropped(self):
        self.assertEqual(r.last_complete_month("2026-10-21"), dt.date(2026, 9, 1))
        self.assertEqual(r.last_complete_month("2026-09-30"), dt.date(2026, 9, 1))
        self.assertEqual(r.last_complete_month("2026-02-28"), dt.date(2026, 2, 1))
        c = r.rate_component("A", "x", 900, 900, 36, recent_months=11)
        self.assertFalse(c["rated"])

    def test_window_twin_matches_the_rpc_arithmetic(self):
        vals = list(range(1, 61))  # 2021-07 .. 2026-06
        w = r.window_from_values("faers:x", "faers_reports", vals, "2021-07", "2026-06", dt.date(2026, 6, 1))
        self.assertEqual(w["recent"], sum(range(49, 61)))
        self.assertEqual(w["baseline"], sum(range(13, 49)))
        self.assertEqual(w["baseline_months"], 36)
        self.assertEqual(len(w["tail"]), 24)
        short = r.window_from_values("faers:x", "faers_reports", vals[-30:], "2024-01", "2026-06", dt.date(2026, 6, 1))
        self.assertEqual(short["baseline_months"], 18)
        self.assertIsNone(r.window_from_values("faers:x", "faers_reports", vals[:-1], "2021-07", "2026-05", dt.date(2026, 6, 1)))


class ExclusionTest(unittest.TestCase):
    def inputs(self, ndc):
        inp = Inputs(ndc=ndc)
        for slug, g in [("tirzepatide", "TIRZEPATIDE"), ("oral-semaglutide", "ORAL SEMAGLUTIDE"), ("semaglutide", "SEMAGLUTIDE"),
                        ("liraglutide", "LIRAGLUTIDE"), ("dulaglutide", "DULAGLUTIDE"), ("omeprazole", "OMEPRAZOLE"),
                        ("omeprazole-magnesium", "OMEPRAZOLE MAGNESIUM"), ("copper", "COPPER"), ("guselkumab", "GUSELKUMAB")]:
            inp.add_drug(slug, g, 74_000, 3 * 28_000, tag=slug)
        return inp

    def check(self, units):
        for slug in ("tirzepatide", "oral-semaglutide", "semaglutide", "liraglutide", "dulaglutide", "omeprazole", "omeprazole-magnesium", "copper"):
            u = units[f"drug:faers:{slug}"]
            self.assertEqual(u["mdl_status"]["status"], "pending_mdl", slug)
            self.assertIsNone(u["rank"], slug)
        self.assertEqual(units["drug:faers:guselkumab"]["mdl_status"]["status"], "none_linked")
        self.assertIsNotNone(units["drug:faers:guselkumab"]["rank"])

    def test_glp1_ppi_and_copper_are_excluded_through_the_ndc_class(self):
        ndc = {"source": r.NDC_URL, "classes": {"TIRZEPATIDE": ["GLP-1 Receptor Agonist"], "SEMAGLUTIDE": ["GLP-1 Receptor Agonist"],
                                                 "LIRAGLUTIDE": ["GLP-1 Receptor Agonist"], "DULAGLUTIDE": ["GLP-1 Receptor Agonist"],
                                                 "OMEPRAZOLE": ["Proton Pump Inhibitor"], "OMEPRAZOLE MAGNESIUM": ["Proton Pump Inhibitor"]}}
        units, _ = build(self.inputs(ndc))
        self.check(units)
        self.assertIn("epc_class", {l["basis"] for l in units["drug:faers:tirzepatide"]["mdl_status"]["links"]})
        self.assertIn("brand_active_ingredient", {l["basis"] for l in units["drug:faers:copper"]["mdl_status"]["links"]})

    def test_reviewed_list_excludes_them_when_no_class_is_available(self):
        units, _ = build(self.inputs(None))
        self.check(units)
        self.assertIn("reviewed_class_member", {l["basis"] for l in units["drug:faers:oral-semaglutide"]["mdl_status"]["links"]})

    def test_wording_and_status_never_claim_that_no_mdl_exists(self):
        units, _ = build(self.inputs(None))
        self.assertNotIn("no mdl exists", r.CAVEAT.lower())
        self.assertIn("No MDL linked", r.CAVEAT)
        self.assertEqual({u["mdl_status"]["status"] for u in units.values()} - {"pending_mdl", "terminated_mdl", "none_linked"}, set())

    def test_mdl_centralized_after_the_pending_report_counts_as_pending(self):
        inp = Inputs(hearing_orders=[{"id": "matter:2026-09-24:3194:A", "title": "MDL 3194 — In re: Abbott Laboratories Spinal Cord Stimulator Products Liability Litigation",
                                      "source_url": "https://www.jpml.uscourts.gov/n.pdf",
                                      "item": {"kind": "matter", "cells": {"type": "Products Liability"},
                                               "matter": {"mdl": 3194, "outcome": "granted", "session": "2026-09-24",
                                                          "title": "IN RE: ABBOTT LABORATORIES SPINAL CORD STIMULATOR PRODUCTS LIABILITY LITIGATION",
                                                          "evidence": {"url": "https://www.jpml.uscourts.gov/o.pdf", "date": "2026-10-02"}}}}])
        _, radar = build(inp)
        self.assertEqual(radar.ctx.mdl[3194]["status"], "pending")
        self.assertTrue(radar.ctx.mdl[3194]["after_report"])
        lane = next(l for l in radar.lanes if l["mdl"] == 3194)
        self.assertEqual(lane["status"], "centralized")
        self.assertNotIn("jpml:3194", {u["unit_id"] for u in radar.units})


class UnitTest(unittest.TestCase):
    def test_identical_subjects_are_one_unit_listing_every_spelling(self):
        inp = Inputs()
        for slug, g in [("estradiol-transdermal", "ESTRADIOL TRANSDERMAL"), ("estradiol-51571e", "ESTRADIOL,"), ("estradiol-gel-0.1", "ESTRADIOL GEL 0.1%")]:
            inp.add_drug(slug, g, 6261, 3 * 3624, tag="same")
        units, _ = build(inp)
        estr = [u for u in units.values() if u["kind"] == "drug"]
        self.assertEqual(len(estr), 1)
        self.assertEqual(len(estr[0]["identifiers"]["faers_subjects"]), 3)
        self.assertEqual(estr[0]["components"][0]["observed"], 6261)

    def test_components_reconcile_and_rank_by_families_then_points(self):
        inp = Inputs()
        inp.add_drug("pimavanserin-tartrate", "PIMAVANSERIN TARTRATE", 9726, 3 * 6528, serious=6125, sbase=3 * 3200, deaths=1962, dbase=3 * 1300)
        inp.add_drug("flat", "FLATAMINE", 1000, 3000)
        units, _ = build(inp)
        for u in units.values():
            pts, fams = r.totals(u["components"])
            self.assertEqual(u["points"], pts)
            self.assertEqual(u["families_present"], len(fams))
        p, f = units["drug:faers:pimavanserin-tartrate"], units["drug:faers:flat"]
        self.assertLess(p["rank"], f["rank"])
        self.assertGreaterEqual(p["families_present"], 2)

    def test_post_filing_surge_is_flagged_for_depo_provera(self):
        inp = Inputs()
        sid = inp.add_drug("medroxyprogesterone-acetate", "MEDROXYPROGESTERONE ACETATE", 11_876, 3 * 1_779)
        inp.mdl_links = [{"mdl": 3140, "subject_id": sid, "relation": "named_product", "basis": "title_names_product",
                          "title_source_url": "https://www.jpml.uscourts.gov/x.pdf"}]
        units, _ = build(inp)
        u = units["drug:faers:medroxyprogesterone-acetate"]
        self.assertEqual(u["mdl_status"]["status"], "pending_mdl")
        self.assertIn("post_filing_surge", {f["key"] for f in u["flags"]})

    def test_quality_terms_flag_and_missing_terms_stay_not_recorded(self):
        inp = Inputs()
        sid = inp.add_drug("estradiol", "ESTRADIOL", 8784, 3 * 5446)
        q = lambda p, rows: {"subject_id": sid, "period": p, "limit_n": 25, "returned": 25, "rows": rows}  # noqa: E731
        inp.term_quarters = [q(p, [["DEVICE ADHESION ISSUE", 200], ["PRODUCT ADHESION ISSUE", 300], ["NAUSEA", 50]]) for p in ("2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2")] + \
            [q(p, [["PRODUCT ADHESION ISSUE", 180], ["NAUSEA", 60]]) for p in ("2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2")]
        units, _ = build(inp)
        u = units["drug:faers:estradiol"]
        terms = {t["term"]: t for t in u["top_rising_terms"]}
        self.assertIsNone(terms["DEVICE ADHESION ISSUE"]["prior"])  # outside the stored top N: Not recorded, never 0
        self.assertEqual(terms["PRODUCT ADHESION ISSUE"]["prior"], 720)
        self.assertIn("quality_driver", {f["key"] for f in u["flags"]})


class SecTest(unittest.TestCase):
    def filing(self, text):
        return [{"id": "10k:1", "source_url": "https://www.sec.gov/x.htm", "filing": {"company": "X CORP", "filed": "2026-02-01"},
                 "paragraphs": [{"section": "Note 12", "text": text}]}]

    def test_patent_only_paragraph_scores_zero(self):
        self.assertEqual(r.sec_hits(["OXBRYTA"], self.filing("Paragraph IV certification: generic makers filed ANDAs for Oxbryta; we sued for patent infringement.")), [])
        self.assertEqual(r.sec_hits(["IMPELLA"], self.filing("Impella patent litigation (MDL-style coordination) continues.")), [])

    def test_products_liability_paragraph_scores(self):
        hits = r.sec_hits(["MOUNJARO"], self.filing("Product liability lawsuits allege that Mounjaro caused gastroparesis."))
        self.assertEqual(len(hits), 1)
        self.assertIn("Mounjaro", hits[0]["excerpt"])
        self.assertEqual(r.sec_hits(["ZETIA"], self.filing("In re Zetia antitrust litigation, MDL 2836, continues.")), [])


class VehicleTest(unittest.TestCase):
    def test_sienna_seat_complaints_are_flagged_recall_driven(self):
        inp = Inputs()
        inp.nhtsa_windows.append({"scope": "unit", "make": "TOYOTA", "model": "SIENNA HYBRID", "component": "SEATS", "recent": 217, "prior": 8,
                                  "recent_severe": 3, "prior_severe": 0, "recent_deaths": 1, "prior_deaths": 0, "recent_injured": 2,
                                  "prior_injured": 0, "months": [0] * 12 + [18] * 12})
        inp.recalls = [{"id": "25V668000", "source_url": "https://www.nhtsa.gov/recalls?nhtsaId=25V668000",
                        "item": {"cells": {"date": "2025-10-07", "component": "SEATS:MID/REAR ASSEMBLY"},
                                 "recall": {"campaign": "25V668000", "vehicles": ["TOYOTA SIENNA HYBRID 2025"], "components": ["SEATS:MID/REAR ASSEMBLY"]}}}]
        inp.investigations = [{"id": "RQ26002", "source_url": "https://www.nhtsa.gov/?nhtsaId=RQ26002",
                               "item": {"investigation": {"action": "RQ26002", "opened": "2026-01-26", "closed": None,
                                                          "vehicles": ["MAZDA CX-90 2024–2025"], "components": ["STEERING"]}}}]
        units, _ = build(inp)
        u = units["vehicle:toyota-sienna-hybrid-seats"]
        self.assertIn("recall_preceded_surge", {f["key"] for f in u["flags"]})
        c = next(c for c in u["components"] if c["family"] == "C")
        self.assertEqual(c["points"], 1)  # the recall; the Mazda query is another vehicle
        deaths = next(c for c in u["components"] if c["metric"].startswith("Deaths"))
        self.assertEqual(deaths["points"], 0)  # no deaths in the baseline: not rated, never a ratio against zero

    def test_vehicle_keys_and_components_match_exactly(self):
        self.assertEqual(r.vehicle_key("TESLA MODEL Y 2021–2023"), "TESLA MODEL Y")
        self.assertEqual(r.vehicle_key("MAZDA CX-90 PLUG-IN HYBRID 2024"), "MAZDA CX-90 PLUG-IN HYBRID")
        self.assertTrue(r.component_matches("ELECTRICAL SYSTEM", "ELECTRICAL SYSTEM: INSTRUMENT CLUSTER/PANEL"))
        self.assertFalse(r.component_matches("ELECTRICAL SYSTEM", "ENGINE"))
        self.assertFalse(r.component_matches("SEAT BELTS", "SEATS:MID/REAR ASSEMBLY"))

    def test_air_bag_units_are_treated_as_in_the_takata_mdl(self):
        inp = Inputs()
        inp.nhtsa_windows.append({"scope": "unit", "make": "HYUNDAI", "model": "PALISADE", "component": "AIR BAGS", "recent": 500, "prior": 20,
                                  "recent_severe": 10, "prior_severe": 1, "recent_deaths": 0, "prior_deaths": 0, "recent_injured": 3,
                                  "prior_injured": 0, "months": [1] * 24})
        inp.terminated = [{"id": "t2599", "title": "Takata", "item": {"history": {"mdl": 2599}}}]
        units, _ = build(inp)
        u = units["vehicle:hyundai-palisade-air-bags"]
        self.assertNotEqual(u["mdl_status"]["status"], "none_linked")


class MdlMapTest(unittest.TestCase):
    def test_new_mdls_carry_explicit_jpml_evidence(self):
        for m in (3194, 3195, 3199):
            ev = mdl_map.JPML_ORDERS[m]
            self.assertEqual(ev["dataset"], "mdl_intel_hearing_orders")
            self.assertTrue(ev["record_id"].startswith(f"matter:2026-09-24:{m}:"))
            self.assertTrue(ev["order_url"].startswith("https://www.jpml.uscourts.gov/"))
        for e in mdl_map.MDLS_SINCE_PENDING_REPORT:
            self.assertEqual(mdl_map.check_tokens(e, mdl_map.JPML_ORDERS[e["mdl"]]["title"]), [], e["mdl"])
            self.assertNotIn(e["mdl"], {x["mdl"] for x in mdl_map.MDLS})
        self.assertIn(3199, mdl_map.NOT_MAPPED)
        talc = next(e for e in mdl_map.MDLS if e["mdl"] == 2738)
        title = "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation"
        self.assertEqual(mdl_map.check_tokens(talc, title), [])
        self.assertNotIn(2738, mdl_map.NOT_MAPPED)

    def test_mass_tort_rows_for_new_mdls_use_jpml_evidence_and_never_a_zero_count(self):
        import json
        import tempfile
        from pathlib import Path
        import build_mass_tort_signals as m
        mapping = json.loads((Path(m.__file__).parent / "mass_tort_products.json").read_text())["mdls"]
        with tempfile.TemporaryDirectory() as d:
            for mdl in (3194, 3195):
                (Path(d) / f"{mdl}.json").write_text(json.dumps({"event_total": 10, "events_by_year": {"2025": 4}, "top_terms": []}))
            rows, missing = m.build_rows(mapping, {}, {}, d, only={3194, 3195, 3199})
        self.assertEqual(missing, [])
        by = {r["id"]: r for r in rows}
        self.assertEqual(set(by), {"3194", "3195", "3199"})
        for mdl in ("3194", "3195", "3199"):
            lit = by[mdl]["item"]["litigation"]
            self.assertIsNone(lit["pending"])  # not yet in a JPML pending report: absent, never 0
            self.assertEqual(lit["jpml_evidence"]["dataset"], "mdl_intel_hearing_orders")
            self.assertTrue(lit["jpml_evidence"]["order_url"].endswith(f"MDL-{mdl}-Transfer_Order-9-26.pdf"))
        self.assertEqual(by["3199"]["item"]["signal"]["product_kind"], "consumer")
        self.assertIsNone(by["3199"]["item"]["signal"]["event_total"])
        self.assertEqual(by["3199"]["item"]["signal"]["product"], "Apple AirTag")
        with self.assertRaises(SystemExit):
            m.main(["--only", "3194"])  # a publish replaces the whole dataset: --only is dry-run only

    def test_titles_with_orders_never_overrides_the_snapshot(self):
        t = mdl_map.titles_with_orders({"3194": {"title": "pending report title"}})
        self.assertEqual(t["3194"]["title"], "pending report title")
        self.assertEqual(t["3195"]["status"], "centralized_after_report")


if __name__ == "__main__":
    unittest.main()
