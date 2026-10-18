"""Offline tests for the fda_adverse_events stream (synthetic fixtures, no network).

Run: cd scripts/enrichment/fda_adverse_events && python3 -B -m unittest -v test_fda_adverse_events
"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import fae_common as fc  # noqa: E402
import build_fda_adverse_events as b  # noqa: E402


def day(y, md="0115"):
    return f"{y}{md}"


class UrlAndPlan(unittest.TestCase):
    def test_expression_kept_term_for_term(self):
        expr = 'device.brand_name:"BAIR HUGGER"+AND+device.manufacturer_d_name:("SORIN"+"LIVANOVA")'
        self.assertEqual(fc.enc_expr(expr), 'device.brand_name:%22BAIR%20HUGGER%22+AND+device.manufacturer_d_name:(%22SORIN%22+%22LIVANOVA%22)')

    def test_phrase_encodes_reserved_characters(self):
        self.assertEqual(fc.phrase("Vit/Min & Diet+"), "%22Vit%2FMin%20%26%20Diet%2B%22")

    def test_url_shape(self):
        self.assertEqual(fc.build_url("drug/event.json", "serious:1", "receivedate"),
                         "https://api.fda.gov/drug/event.json?search=serious:1&count=receivedate")
        self.assertEqual(fc.build_url("food/event.json", None, "outcomes.exact", 100),
                         "https://api.fda.gov/food/event.json?count=outcomes.exact&limit=100")

    def test_plan_keys_unique_and_cover_every_product_kind(self):
        products = [{"mdl": 1, "kind": "drug", "faers": 'patient.drug.openfda.generic_name:"x"'},
                    {"mdl": 2, "kind": "device", "maude": 'device.brand_name:"Y"'},
                    {"mdl": 3, "kind": "cosmetic", "caers": 'products.name_brand:"Z"'},
                    {"mdl": 4, "kind": "food", "caers": None},
                    {"mdl": 5, "kind": "vehicle"}]
        specs = fc.phase1_specs(products)
        keys = [s["key"] for s in specs]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertIn("faers_1_age_years_lt65", keys)
        self.assertIn("maude_2_year_malfunction", keys)
        self.assertIn("caers_3_reactions", keys)
        self.assertFalse(any(k.startswith(("caers_4_", "faers_5_", "maude_5_")) for k in keys))
        age = next(s for s in specs if s["key"] == "faers_1_age_years_ge65")["url"]
        self.assertIn("+AND+patient.patientonsetageunit:801+AND+patient.patientonsetage:[65+TO+99999]", age)
        self.assertTrue(all("limit=1000" not in s["url"] for s in specs))  # no-key limit is 100

    def test_caers_ranked_choice(self):
        ind = [{"term": f"I{i}", "count": 100 - i} for i in range(12)] + [{"term": "Cosmetics", "count": 1}]
        brands = [{"term": "EXEMPTION 4", "count": 999}] + [{"term": f"B{i}", "count": 50 - i} for i in range(12)]
        industries, names = fc.choose_caers_ranked(ind, brands)
        self.assertEqual(industries[-1], "Cosmetics")
        self.assertEqual(len(industries), fc.CAERS_TOP_INDUSTRIES + 1)
        self.assertNotIn("EXEMPTION 4", names)
        self.assertEqual(names[0], "B0")


class Parsing(unittest.TestCase):
    def test_results_of_zero_versus_not_recorded(self):
        self.assertEqual(fc.results_of(404, {"error": {"code": "NOT_FOUND", "message": "No matches found!"}}), [])
        with self.assertRaises(fc.NotRecorded):
            fc.results_of(404, {"error": {"code": "NOT_FOUND", "message": "Nothing to count"}})
        with self.assertRaises(fc.NotRecorded):
            fc.results_of(403, {"error": {"code": "API_KEY_MISSING", "message": "No api_key was supplied."}})
        with self.assertRaises(fc.NotRecorded):
            fc.results_of(500, {"error": {"code": "SERVER_ERROR"}})
        self.assertEqual(fc.results_of(200, {"results": [{"term": 1, "count": 2}]}), [{"term": 1, "count": 2}])

    def test_daily_to_years(self):
        res = [{"time": "20031231", "count": 2}, {"time": "20040101", "count": 3}, {"time": "20041231", "count": 4}]
        self.assertEqual(fc.daily_to_years(res), {2003: 2, 2004: 7})
        self.assertEqual(fc.max_date(res), "20041231")
        with self.assertRaises(ValueError):
            fc.daily_to_years([{"time": "2004-01-01", "count": 1}])

    def test_year_series_fills_empty_years_and_counts_before(self):
        ys = {2001: 5, 2004: 1, 2006: 2}
        self.assertEqual(fc.year_series(ys, 2004, 2007), [(2004, 1), (2005, 0), (2006, 2), (2007, 0)])
        self.assertEqual(fc.before(ys, 2004), 5)


class Aggregation(unittest.TestCase):
    def test_coded_mix_not_recorded_and_unknown_codes(self):
        mix = fc.coded_mix([{"term": 2, "count": 6}, {"term": 1, "count": 3}, {"term": 9, "count": 1}], fc.SEX, 12)
        by = {m["label"]: m for m in mix}
        self.assertEqual(by["Female"]["count"], 6)
        self.assertEqual(by["Unknown (coded 0)"]["count"], 0)
        self.assertEqual(by["Other code 9"]["count"], 1)
        self.assertEqual(by["Not recorded"]["count"], 2)
        self.assertAlmostEqual(by["Female"]["share"], 0.5)
        with self.assertRaises(ValueError):
            fc.coded_mix([{"term": 1, "count": 20}], fc.SEX, 12)

    def test_coded_mix_unknown_total_is_not_recorded(self):
        mix = fc.coded_mix([{"term": 1, "count": 3}], fc.SEX, None)
        self.assertIsNone(mix[-1]["count"])
        self.assertEqual(fc.pct(mix[-1]["share"]), "Not recorded")

    def test_age_bucket_boundaries(self):
        res = [{"term": t, "count": 1} for t in (0, 2.9, 3, 11.5, 12, 17, 18, 64.999, 65, 85.5, 86, 120, 121, 999)]
        buckets, total = fc.age_buckets(res)
        self.assertEqual(total, 14)
        self.assertEqual([x["count"] for x in buckets], [2, 2, 2, 2, 2, 2, 2])

    def test_shares_and_yoy(self):
        self.assertEqual(fc.share(1, 4), 0.25)
        self.assertIsNone(fc.share(1, 0))
        self.assertIsNone(fc.share(None, 4))
        self.assertEqual(fc.yoy(150, 100), 0.5)
        self.assertIsNone(fc.yoy(150, 0))
        self.assertEqual(fc.pct(0.12345), "12.3%")
        self.assertEqual(fc.num(None), "Not recorded")

    def test_merge_case_variants_and_top_terms(self):
        res = [{"term": "Nausea", "count": 5}, {"term": "Diarrhoea", "count": 4}, {"term": "DIARRHOEA", "count": 3},
               {"term": "Rash", "count": 6}]
        top = fc.top_terms(res, 20, n=2)
        self.assertEqual(top[0]["term"], "Diarrhoea")
        self.assertEqual(top[0]["count"], 7)
        self.assertEqual(top[0]["variants"], ["Diarrhoea", "DIARRHOEA"])
        self.assertEqual(top[1]["term"], "Rash")
        self.assertEqual(top[0]["share_of_reports"], 0.35)
        self.assertEqual(top[0]["rank"], 1)


class CompanyMatch(unittest.TestCase):
    PROFILES = [("0000885725", "BOSTON SCIENTIFIC CORP"), ("0001613103", "Medtronic plc"), ("0000101462", "UNITED REFINING CO"),
                ("0001040270", "UNITED REFINING CO /PA/"), ("0000066740", "3M CO"), ("0000010795", "BECTON DICKINSON & CO")]

    def setUp(self):
        self.idx = fc.company_index(self.PROFILES)

    def test_unique_exact_match_after_normalisation(self):
        self.assertEqual(fc.match_company("BOSTON SCIENTIFIC CORPORATION", self.idx), ("matched", "0000885725"))
        self.assertEqual(fc.match_company("3M COMPANY", self.idx), ("matched", "0000066740"))
        self.assertEqual(fc.match_company("Becton, Dickinson and Co.", self.idx), ("matched", "0000010795"))

    def test_non_match_keeps_legal_form_and_subsidiaries_apart(self):
        self.assertEqual(fc.match_company("MEDTRONIC", self.idx), ("unmatched", None))
        self.assertEqual(fc.match_company("MEDTRONIC, INC.", self.idx), ("unmatched", None))
        self.assertEqual(fc.match_company("BOSTON SCIENTIFIC NEUROMODULATION", self.idx), ("unmatched", None))

    def test_ambiguous_match_is_not_linked(self):
        status, ciks = fc.match_company("United Refining Co.", self.idx)
        self.assertEqual(status, "ambiguous")
        self.assertEqual(ciks, ["0000101462", "0001040270"])


def write_fixture(tmp, responses):
    """responses: {key: (status, payload)} -> raw files + manifest in tmp; returns a builder Store."""
    raw = tmp / "openfda"
    raw.mkdir()
    lines = []
    for key, (status, payload) in responses.items():
        body = json.dumps(payload).encode()
        (raw / f"{key}.json").write_bytes(body)
        lines.append(json.dumps({"key": key, "url": f"https://api.fda.gov/test?{key}", "path": f"openfda/{key}.json",
                                 "sha256": hashlib.sha256(body).hexdigest(), "status": status, "retrieved_at": "2026-10-18T00:00:00Z"}))
    (tmp / "_manifest.jsonl").write_text("\n".join(lines) + "\n")
    return b.Store(raw_dir=raw, manifest=tmp / "_manifest.jsonl", root=tmp)


def ok(results):
    return 200, {"meta": {"last_updated": "2026-07-30"}, "results": results}


def dates(counts):
    return ok([{"time": day(y), "count": n} for y, n in counts.items() if n])


class BuilderRows(unittest.TestCase):
    def faers_fixture(self, tmp, with_sex=True):
        nat_years = {2003: 1, **{y: 100 for y in range(2004, 2026)}, 2026: 40}
        r = {"faers_nat_year_all": ok([{"time": day(y, "0601") if y == 2026 else day(y), "count": n} for y, n in nat_years.items()]),
             "faers_nat_year_serious": dates({y: 50 for y in range(2004, 2027)}),
             "faers_nat_year_death": dates({y: 5 for y in range(2004, 2027)}),
             "faers_nat_sex": ok([{"term": 2, "count": 1000}, {"term": 1, "count": 900}])}
        for c in fc.QUALIFICATION:
            r[f"faers_nat_year_q{c}"] = dates({y: 10 for y in range(2004, 2027)})
        r.update({
            "faers_9_year_all": dates({2024: 10, 2025: 20}),
            "faers_9_year_serious": dates({2024: 4, 2025: 10}),
            "faers_9_year_death": (404, {"error": {"code": "NOT_FOUND", "message": "No matches found!"}}),
            "faers_9_year_lawyer": dates({2025: 5}),
            "faers_9_pt_all": ok([{"term": "Nausea", "count": 9}, {"term": "NAUSEA", "count": 2}, {"term": "Rash", "count": 5}]),
            "faers_9_pt_recent": ok([{"term": "Rash", "count": 4}]),
            "faers_9_qual": ok([{"term": 5, "count": 20}, {"term": 4, "count": 5}]),
            "faers_9_agegroup": ok([{"term": 5, "count": 3}]),
            "faers_9_age_years_lt65": ok([{"term": 40, "count": 6}, {"term": 2, "count": 1}]),
            "faers_9_age_years_ge65": ok([{"term": 70, "count": 4}]),
        })
        if with_sex:
            r["faers_9_sex"] = ok([{"term": 2, "count": 18}, {"term": 1, "count": 10}])
        else:
            r["faers_9_sex"] = (404, {"error": {"code": "NOT_FOUND", "message": "Nothing to count"}})
        return write_fixture(tmp, r)

    def test_national_and_product_rows(self):
        with tempfile.TemporaryDirectory() as d:
            store = self.faers_fixture(Path(d))
            gaps = []
            nat = b.faers_national(store, gaps)
            self.assertEqual(gaps, [])
            self.assertEqual((nat["last"], nat["partial"], nat["last_complete"], nat["through"]), (2026, True, 2025, "2026-06-01"))
            self.assertEqual(nat["totals"]["before_2004"], 1)
            rows = b.faers_national_rows(store, nat)
            self.assertEqual([r["id"] for r in rows][-2:], ["2026", "all_years"])
            p2025 = rows[-3]["item"]["point"]
            self.assertEqual((p2025["reports"], p2025["serious_share"], p2025["lawyer_share"], p2025["reporter_not_recorded"]), (100, 0.5, 0.1, 50))
            self.assertTrue(rows[-2]["item"]["point"]["partial"])
            self.assertIsNone(rows[-2]["item"]["point"]["yoy"])
            entry = {"mdl": 9, "product": "Testamab", "kind": "drug", "faers": 'patient.drug.openfda.generic_name:"testamab"'}
            row = b.faers_product(store, entry, nat, {9: "IN RE: Testamab"})
            item = row["item"]
            s2025 = next(p for p in item["series"] if p["year"] == 2025)
            self.assertEqual(s2025["share_of_national"], 0.2)  # 20 / 100, computed
            self.assertEqual(s2025["deaths"], 0)  # "No matches found!" is a true zero
            self.assertEqual(item["totals"], {"reports": 30, "before_2004": 0, "serious": 14, "deaths": 0, "lawyer": 5})
            self.assertEqual(item["top_reactions_all"][0], {"term": "Nausea", "count": 11, "variants": ["Nausea", "NAUSEA"], "rank": 1, "share_of_reports": round(11 / 30, 6)})
            self.assertEqual(item["age_years_total"], 11)
            self.assertEqual(item["age_not_in_years"], 19)
            self.assertEqual(item["yoy_latest_complete"], 1.0)
            self.assertEqual(item["reporters"][-1], {"code": None, "label": "Not recorded", "count": 5, "share": round(5 / 30, 6)})
            self.assertIn({"url": "/matters/lens/9", "label": "MDL 9 lens: IN RE: Testamab"}, row["item"]["links"])
            self.assertFalse(any(l["url"].startswith("/companies/") for l in row["item"]["links"]))
            self.assertIn("not incidence", row["detail"]["qualification"])
            self.assertEqual(row["filters"]["lawyer_band"], ["10–25%"])

    def test_not_recorded_path(self):
        with tempfile.TemporaryDirectory() as d:
            store = self.faers_fixture(Path(d), with_sex=False)
            nat = b.faers_national(store, [])
            entry = {"mdl": 9, "product": "Testamab", "kind": "drug", "faers": 'patient.drug.openfda.generic_name:"testamab"'}
            row = b.faers_product(store, entry, nat, {})
            self.assertIsNone(row["item"]["sex"])
            facts = dict(row["detail"]["facts"])
            self.assertEqual(facts["Patient sex"], "Not recorded")
            self.assertIn("faers_9_sex: openFDA HTTP 404: Nothing to count", facts["Not recorded"])
            self.assertEqual(facts["MDL"], "9 — Not recorded")

    def test_device_row_company_link_only_on_unique_exact_match(self):
        with tempfile.TemporaryDirectory() as d:
            nat_all = {y: 1000 for y in range(1992, 2026)}
            nat_all[2026] = 300
            r = {"maude_nat_year_all": ok([{"time": day(y, "0930") if y == 2026 else day(y), "count": n} for y, n in nat_all.items()]),
                 "maude_nat_year_death": dates({2025: 10}), "maude_nat_year_injury": dates({2025: 100}),
                 "maude_nat_year_malfunction": dates({2025: 800}),
                 "maude_nat_event_type": ok([{"term": "Malfunction", "count": 800}, {"term": "", "count": 5}]),
                 "maude_7_year_all": dates({2024: 4, 2025: 10}), "maude_7_year_death": dates({2025: 1}),
                 "maude_7_year_injury": dates({2025: 6}), "maude_7_year_malfunction": dates({2024: 4, 2025: 2}),
                 "maude_7_event_type": ok([{"term": "Injury", "count": 6}, {"term": "Malfunction", "count": 6}, {"term": "Death", "count": 1}]),
                 "maude_7_problems_all": ok([{"term": "Fracture", "count": 3}]),
                 "maude_7_problems_recent": ok([{"term": "Fracture", "count": 3}]),
                 "maude_7_manufacturers": ok([{"term": "BOSTON SCIENTIFIC CORPORATION", "count": 9}, {"term": "UNITED REFINING CO.", "count": 3},
                                              {"term": "BOSTON SCIENTIFIC NEUROMODULATION", "count": 2}])}
            store = write_fixture(Path(d), r)
            mnat = b.maude_national(store, [])
            self.assertEqual((mnat["last"], mnat["partial"], mnat["through"]), (2026, True, "2026-09-30"))
            idx = fc.company_index(CompanyMatch.PROFILES)
            entry = {"mdl": 7, "product": "Stim", "kind": "device", "maude": 'device.brand_name:"STIM"'}
            row, stats = b.device_product(store, entry, mnat, {}, idx)
            self.assertEqual({k: stats[k] for k in ("names", "matched", "ambiguous", "unmatched")}, {"names": 3, "matched": 1, "ambiguous": 1, "unmatched": 1})
            co = [l["url"] for l in row["item"]["links"] if l["url"].startswith("/companies/")]
            self.assertEqual(co, ["/companies/0000885725"])
            s2025 = next(p for p in row["item"]["series"] if p["year"] == 2025)
            self.assertEqual((s2025["death"], s2025["injury"], s2025["malfunction"], s2025["other_or_unclassified"]), (1, 6, 2, 1))
            self.assertEqual(s2025["share_of_national"], 0.01)
            self.assertEqual(row["item"]["series"][0]["year"], 2024)  # series starts at the product's first year
            self.assertEqual(mnat["event_mix"][-1]["label"], "Field absent")

    def maude_fixture(self, tmp, product_total_2025, names):
        nat_all = {y: 1000 for y in range(1992, 2026)}
        nat_all[2026] = 300
        r = {"maude_nat_year_all": ok([{"time": day(y, "0930") if y == 2026 else day(y), "count": n} for y, n in nat_all.items()]),
             "maude_nat_year_death": dates({2025: 10}), "maude_nat_year_injury": dates({2025: 100}),
             "maude_nat_year_malfunction": dates({2025: 800}),
             "maude_nat_event_type": ok([{"term": "Malfunction", "count": 800}]),
             "maude_7_year_all": dates({2025: product_total_2025}), "maude_7_year_death": dates({2025: 1}),
             "maude_7_year_injury": dates({2025: 6}), "maude_7_year_malfunction": dates({2025: 2}),
             "maude_7_event_type": ok([{"term": "Injury", "count": 6}]),
             "maude_7_problems_all": ok([{"term": "Fracture", "count": 3}]),
             "maude_7_problems_recent": ok([{"term": "Fracture", "count": 3}]),
             "maude_7_manufacturers": ok([{"term": n, "count": c} for n, c in names])}
        return write_fixture(tmp, r)

    def test_company_links_need_a_real_share_of_the_reports(self):
        entry = {"mdl": 7, "product": "Stim", "kind": "device", "maude": 'device.brand_name:"STIM"'}
        cidx = fc.company_index(CompanyMatch.PROFILES)
        ridx = fc.manufacturer_record_index([("maude-sec-0000885725", "BOSTON SCIENTIFIC CORP"), ("maude-100000005674", "BOSTON SCIENTIFIC CORPORATION"),
                                             ("maude-100000000001", "ACME INC"), ("maude-100000000002", "ACME, INC."), ("maude-sec-0000000003", "ACME INC")])
        with tempfile.TemporaryDirectory() as d:  # 3 of 10,000 reports under the matched name: below the 1% minimum
            store = self.maude_fixture(Path(d), 10000, [("OTHER MAKER", 9997), ("BOSTON SCIENTIFIC CORPORATION", 3)])
            row, stats = b.device_product(store, entry, b.maude_national(store, []), {}, cidx, ridx)
            self.assertEqual([l["url"] for l in row["item"]["links"] if l["url"].startswith(("/companies/", "/records/company_adverse"))], [])
            self.assertEqual((stats["matched"], stats["linked_companies"], stats["linked_records"], stats["withheld_below_min_share"]), (1, 0, 0, 3))  # 1 SEC registrant + 2 records
            kept = next(x for x in row["item"]["manufacturers"] if x["name"] == "BOSTON SCIENTIFIC CORPORATION")
            # A withheld link also takes the identifiers off the manufacturer list, so no reader can rebuild the coincidental association from them.
            self.assertNotIn("cik", kept)
            self.assertNotIn("company_adverse_manufacturers", kept)
            for ident in ("0000885725", "maude-100000005674", "maude-sec-0000885725"):
                self.assertIn(ident, kept["links_withheld"])
            self.assertIn("not evidence that the company makes the product", kept["links_withheld"])
        with tempfile.TemporaryDirectory() as d:  # 9 of 10 reports: linked to the SEC registrant and to both source records
            store = self.maude_fixture(Path(d), 10, [("BOSTON SCIENTIFIC CORPORATION", 9), ("ACME INC", 1)])
            row, stats = b.device_product(store, entry, b.maude_national(store, []), {}, cidx, ridx)
            urls = [l["url"] for l in row["item"]["links"] if l["url"].startswith(("/companies/", "/records/company_adverse"))]
            self.assertEqual(urls, ["/companies/0000885725", "/records/company_adverse_manufacturers/maude-100000005674",
                                    "/records/company_adverse_manufacturers/maude-sec-0000885725",
                                    "/records/company_adverse_manufacturers/maude-sec-0000000003"])  # ACME INC: 1 of 10 reports, one SEC-source record
            acme = next(x for x in row["item"]["manufacturers"] if x["name"] == "ACME INC")  # SEC source has one ACME INC, open_payments has two
            self.assertEqual(acme["company_adverse_manufacturers"], ["maude-sec-0000000003"])
            self.assertEqual(acme["company_adverse_manufacturers_ambiguous_sources"], ["open_payments"])
            self.assertEqual(acme["match"], "unmatched")  # not an SEC profile name

    def test_manufacturer_record_index_ambiguity_is_per_source(self):
        idx = fc.manufacturer_record_index([("maude-1", "Foo, Inc."), ("maude-2", "FOO INC"), ("maude-sec-0000000009", "Foo Inc")])
        self.assertEqual(fc.match_manufacturer_records("FOO INC.", idx), (["maude-sec-0000000009"], ["open_payments"]))
        self.assertEqual(fc.match_manufacturer_records("FOO INTERNATIONAL INC", idx), ([], []))
        self.assertEqual(fc.record_source("maude-sec-0000000009"), "sec")

    def test_alternate_search_only_when_recorded_search_matches_nothing(self):
        saved = dict(fc.ALT_FAERS)
        fc.ALT_FAERS[9] = {"key": "9alt", "faers": 'patient.drug.medicinalproduct:("TESTAMAB")', "why": "test reason"}
        try:
            with tempfile.TemporaryDirectory() as d:
                store = self.faers_fixture(Path(d))  # MDL 9 has 30 reports under the recorded search
                entry = {"mdl": 9, "product": "Testamab", "kind": "drug", "faers": 'patient.drug.openfda.generic_name:"testamab"'}
                self.assertIsNone(b.pick_alt(store, entry))
            with tempfile.TemporaryDirectory() as d:
                nat_years = {y: 100 for y in range(2004, 2026)}
                r = {"faers_nat_year_all": dates({**nat_years, 2026: 40}), "faers_nat_year_serious": dates({2025: 50}),
                     "faers_nat_year_death": dates({2025: 5}), "faers_nat_sex": ok([{"term": 2, "count": 1}]),
                     "faers_9_year_all": (404, {"error": {"code": "NOT_FOUND", "message": "No matches found!"}}),
                     "faers_9alt_year_all": dates({2024: 8, 2025: 12}), "faers_9alt_year_serious": dates({2025: 3}),
                     "faers_9alt_year_death": dates({2025: 1}), "faers_9alt_year_lawyer": dates({2025: 2}),
                     "faers_9alt_pt_all": ok([{"term": "Hearing loss", "count": 9}]), "faers_9alt_pt_recent": ok([{"term": "Hearing loss", "count": 9}]),
                     "faers_9alt_qual": ok([{"term": 4, "count": 2}]), "faers_9alt_sex": ok([{"term": 2, "count": 12}]),
                     "faers_9alt_agegroup": ok([{"term": 5, "count": 1}]),
                     "faers_9alt_age_years_lt65": ok([{"term": 50, "count": 4}]), "faers_9alt_age_years_ge65": ok([{"term": 70, "count": 1}])}
                for c in fc.QUALIFICATION:
                    r[f"faers_nat_year_q{c}"] = dates({2025: 10})
                store = write_fixture(Path(d), r)
                entry = {"mdl": 9, "product": "Testamab", "kind": "drug", "faers": 'patient.drug.openfda.generic_name:"testamab"'}
                alt = b.pick_alt(store, entry)
                self.assertEqual(alt["key"], "9alt")
                nat = b.faers_national(store, [])
                row = b.faers_product(store, entry, nat, {9: "IN RE: Testamab"}, alt)
                it, facts = row["item"], dict(row["detail"]["facts"])
                self.assertEqual((it["search_basis"], it["recorded_search_reports"], it["totals"]["reports"]), ("alternate", 0, 20))
                self.assertEqual(it["search_used"], 'patient.drug.medicinalproduct:("TESTAMAB")')
                self.assertIn("not the search recorded in mass_tort_products.json", facts["Search used for these figures"])
                self.assertIn("Alternate search", row["item"]["badges"])
                self.assertTrue(any("matches no reports" in l["label"] for l in it["links"]))
                self.assertEqual(row["source_url"], "https://api.fda.gov/test?faers_9alt_year_all")
            with tempfile.TemporaryDirectory() as d:  # an alternate that also matches nothing never replaces the recorded search
                none = (404, {"error": {"code": "NOT_FOUND", "message": "No matches found!"}})
                store = write_fixture(Path(d), {"faers_9_year_all": none, "faers_9alt_year_all": none})
                self.assertIsNone(b.pick_alt(store, entry))
        finally:
            fc.ALT_FAERS.clear()
            fc.ALT_FAERS.update(saved)

    def test_incomplete_age_range_is_not_recorded_rather_than_undercounted(self):
        with tempfile.TemporaryDirectory() as d:
            full = ok([{"term": float(a), "count": 1} for a in range(fc.AGE_TERM_LIMIT)])
            store = write_fixture(Path(d), {"faers_9_age_years_lt65": full, "faers_9_age_years_ge65": ok([{"term": 70, "count": 1}])})
            gaps = []
            self.assertEqual(b.age_in_years(store, 9, gaps), (None, None))
            self.assertIn("range may be incomplete", gaps[0])


class CaersRows(unittest.TestCase):
    def test_rankings_placeholder_and_missing_search(self):
        r = {"caers_nat_year_all": ok([{"time": day(y, "0331") if y == 2026 else day(y), "count": n} for y, n in
                                       {2003: 1, 2023: 50, 2024: 60, 2025: 100, 2026: 10}.items()]),
             "caers_nat_year_death": dates({2025: 4}),
             "caers_nat_outcomes": ok([{"term": "Hospitalization", "count": 30}, {"term": "Death", "count": 4}]),
             "caers_nat_industry": ok([{"term": "Cosmetics", "count": 80}, {"term": "Nuts/Edible Seed", "count": 40}]),
             "caers_nat_brand": ok([{"term": "EXEMPTION 4", "count": 99}, {"term": "FISH OIL", "count": 12}]),
             "caers_ind_cosmetics_year_all": dates({2024: 30, 2025: 50}),
             "caers_ind_nuts-edible-seed_year_all": dates({2025: 40}),
             "caers_brand_fish-oil_year_all": dates({2025: 12}),
             "caers_5_year_all": dates({2024: 2, 2025: 6}), "caers_5_outcomes": ok([{"term": "Death", "count": 1}]),
             "caers_5_reactions": ok([{"term": "ALOPECIA", "count": 5}, {"term": "Alopecia", "count": 1}]),
             "caers_5_industry": ok([{"term": "Cosmetics", "count": 8}]), "caers_5_brands": ok([{"term": "RELAX", "count": 8}])}
        products = [{"mdl": 5, "kind": "cosmetic", "product": "Relaxer", "caers": 'products.name_brand:"RELAX"'},
                    {"mdl": 6, "kind": "food", "product": "Baby food", "caers": None}, {"mdl": 7, "kind": "drug", "product": "Skipped"}]
        with tempfile.TemporaryDirectory() as d:
            store = write_fixture(Path(d), r)
            nat = b.caers_national(store, [])
            self.assertEqual((nat["last"], nat["partial"], nat["last_complete"], nat["before"]), (2026, True, 2025, 1))
            rows = {x["id"]: x for x in b.caers_rows(store, nat, products, {5: "IN RE: Relaxer"}, [])}
            self.assertIn("industry-cosmetics", rows)
            self.assertIn("product-fish-oil", rows)
            self.assertFalse(any("exemption-4" in i for i in rows))  # placeholder brand never becomes a product row
            self.assertNotIn("mdl-7", rows)
            self.assertEqual(rows["year-2026"]["item"]["point"]["yoy"], None)
            self.assertEqual(rows["year-2025"]["item"]["point"]["yoy"], round((100 - 60) / 60, 6))
            self.assertEqual(rows["mdl-5"]["item"]["total"], 8)
            self.assertEqual(rows["mdl-5"]["item"]["top_reactions"][0]["count"], 6)  # ALOPECIA + Alopecia merged
            self.assertEqual(rows["mdl-5"]["item"]["series"][-2]["share_of_national"], round(6 / 100, 6))
            self.assertIn({"url": "/matters/lens/5", "label": "MDL 5 lens: IN RE: Relaxer"}, rows["mdl-5"]["item"]["links"])
            self.assertFalse(any(l["url"].startswith("/companies/") for l in rows["mdl-5"]["item"]["links"]))
            nr = rows["mdl-6"]
            self.assertEqual(nr["item"]["cells"]["reports"], "Not recorded")
            self.assertIsNone(nr["item"]["search"])
            self.assertEqual(nr["item"]["series"], [])
            self.assertTrue(all("not incidence" in x["detail"]["qualification"] for x in rows.values()))


if __name__ == "__main__":
    unittest.main()
