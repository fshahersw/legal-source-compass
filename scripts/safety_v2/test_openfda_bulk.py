"""Offline tests of openfda_bulk.py (no network, no credentials).

  python -I -m unittest discover -s scripts/safety_v2 -p 'test_*.py'
"""
import argparse
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import openfda_build as ob  # noqa: E402
import openfda_bulk as b  # noqa: E402


def export_text(records, meta=True):
    head = '{"meta": {"disclaimer": "x", "results": {"total": %d}},\n' % len(records) if meta else "{"
    return head + '"results": [\n' + ",\n".join(json.dumps(r) for r in records) + "\n]}"


def faers(day, generics, pts, serious="2", death=None, **flags):
    r = {"receivedate": day, "serious": serious,
         "patient": {"drug": [{"openfda": {"generic_name": g}} if g else {} for g in generics],
                     "reaction": [{"reactionmeddrapt": p} for p in pts]}}
    if death:
        r["seriousnessdeath"] = death
    r.update(flags)
    return r


class StreamTests(unittest.TestCase):
    def test_results_are_streamed_across_small_blocks(self):
        recs = [{"a": i, "s": "] , [ } {", "n": {"x": [1, 2, {"y": "]"}]}} for i in range(50)]
        got = list(b.iter_results(io.StringIO(export_text(recs)), block=7))
        self.assertEqual(got, recs)

    def test_empty_results_and_truncated_file(self):
        self.assertEqual(list(b.iter_results(io.StringIO('{"meta": {}, "results": []}'), block=3)), [])
        with self.assertRaises(ValueError):
            list(b.iter_results(io.StringIO('{"meta": {}, "results": [{"a": 1}, {"a": '), block=5))
        with self.assertRaises(ValueError):
            list(b.iter_results(io.StringIO('{"meta": {}}')))

    def test_zip_member(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.json.zip"
            with zipfile.ZipFile(p, "w") as z:
                z.writestr("x.json", export_text([{"a": 1}, {"a": 2}]))
            self.assertEqual(list(b.iter_zip_results(p)), [{"a": 1}, {"a": 2}])


class SearchTests(unittest.TestCase):
    def test_tokens_follow_the_word_break_rules(self):
        self.assertEqual(b.tokens("C.R. BARD, INC."), ["c.r", "bard", "inc"])
        self.assertEqual(b.tokens("M2A-MAGNUM"), ["m2a", "magnum"])
        self.assertEqual(b.tokens("LFIT™ V40®"), ["lfit", "v40"])
        self.assertEqual(b.tokens("1,000 UNITS"), ["1,000", "units"])
        self.assertEqual(b.tokens("M/L TAPER"), ["m", "l", "taper"])
        self.assertEqual(b.tokens(None), [])

    def test_group_searches_parse_and_match_phrases_inside_one_value(self):
        node = b.parse_search('(device.brand_name:"m2a"+device.brand_name:"magnum")+AND+device.manufacturer_d_name:"biomet"')
        hit = {"device": [{"brand_name": "M2A-MAGNUM HEAD", "manufacturer_d_name": "BIOMET ORTHOPEDICS"}]}
        miss = {"device": [{"brand_name": "M2A-MAGNUM HEAD", "manufacturer_d_name": "ZIMMER"}]}
        self.assertTrue(b.matches(node, b.device_fields(hit)))
        self.assertFalse(b.matches(node, b.device_fields(miss)))
        # devices are not nested: the brand on one device and the maker on another still match
        split = {"device": [{"brand_name": "MAGNUM"}, {"manufacturer_d_name": "BIOMET INC"}]}
        self.assertTrue(b.matches(node, b.device_fields(split)))
        phrase = b.parse_search('device.brand_name:"sprint fidelis"')
        self.assertTrue(b.matches(phrase, b.device_fields({"device": [{"brand_name": "SPRINT FIDELIS 6949"}]})))
        self.assertFalse(b.matches(phrase, b.device_fields({"device": [{"brand_name": "FIDELIS SPRINT"}]})))
        self.assertFalse(b.matches(phrase, b.device_fields({"device": [{"brand_name": "SPRINT"}, {"brand_name": "FIDELIS"}]})))
        codes = b.parse_search('device.manufacturer_d_name:"philips"+AND+device.device_report_product_code:("BZD"+"CBK")')
        self.assertTrue(b.matches(codes, b.device_fields({"device": [{"manufacturer_d_name": "PHILIPS RS NORTH AMERICA",
                                                                       "device_report_product_code": "CBK"}]})))
        self.assertFalse(b.matches(codes, b.device_fields({"device": [{"manufacturer_d_name": "PHILIPS",
                                                                        "device_report_product_code": "MNT"}]})))

    def test_every_mdl_device_search_parses_and_ambiguous_ones_fail(self):
        import mdl_map
        n = 0
        for e in mdl_map.MDLS:
            if e["kind"] == mdl_map.DEVICE and e.get("maude"):
                b.parse_search(e["maude"])
                n += 1
        self.assertGreaterEqual(n, 31)
        with self.assertRaises(ValueError):
            b.parse_search('device.brand_name:"a"+device.brand_name:"b"+AND+device.brand_name:"c"')
        with self.assertRaises(ValueError):
            b.parse_search('recalling_firm:"x"')

    def test_prefilter_never_drops_a_match(self):
        groups = {0: b.parse_search('device.brand_name:"c-qur"+AND+device.manufacturer_d_name:"atrium"')}
        dev = [{"brand_name": "C-QUR MESH", "manufacturer_d_name": "ATRIUM MEDICAL"}]
        self.assertTrue(b._may_match(dev, groups))
        self.assertFalse(b._may_match([{"brand_name": "OTHER", "manufacturer_d_name": "X"}], groups))


class CountTests(unittest.TestCase):
    def test_faers_counts_each_report_once_per_product(self):
        targets = {"ASPIRIN": 0, "IBUPROFEN": 1}
        recs = [
            faers("20240105", [["ASPIRIN"], ["ASPIRIN", "IBUPROFEN"]], ["Nausea", "Nausea", "Death"], serious="1", death="1"),
            faers("20240220", [["ASPIRIN"]], ["Rash"], serious="2", death="2"),
            faers("2024XX01", [["ASPIRIN"]], ["Rash"], serious="1"),  # implausible date: totals and 'all' only
            faers("20230601", [["OTHER"]], ["Rash"]),
            faers("20240310", [None], ["Rash"]),
        ]
        agg = b.count_faers(recs, targets, {0: "year"})
        self.assertEqual(agg["records"], 5)
        self.assertEqual(agg["max_date"], "20240310")
        self.assertEqual(agg["totals"], {"0": 3, "1": 1})
        s = agg["series"]["0"]
        self.assertEqual(s["2024-01"][:3], [1, 1, 1])  # reports, serious, death
        self.assertEqual(s["2024-02"][:3], [1, 0, 0])  # serious "2" and seriousnessdeath "2" are not "1"
        self.assertNotIn("1", agg["bd"])  # IBUPROFEN has no breakdown grain
        bd = agg["bd"]["0"]
        self.assertEqual(bd["all"], {"Nausea": [1, 1], "Death": [1, 1], "Rash": [2, 1]})
        self.assertEqual(bd["2024"], {"Nausea": [1, 1], "Death": [1, 1], "Rash": [1, 0]})

    def test_maude_counts_codes_groups_and_event_types(self):
        groups = {2: b.parse_search('device.brand_name:"bair hugger"')}
        recs = [
            {"date_received": "20240115", "event_type": "Injury", "product_problems": ["Overheating", "Overheating"],
             "patient": [{"patient_problems": ["Burn"]}, {"patient_problems": ["Burn", "Pain"]}],
             "device": [{"device_report_product_code": "DWJ", "brand_name": "BAIR HUGGER 750", "manufacturer_d_name": "3M"}]},
            {"date_received": "20240420", "event_type": "Death", "product_problems": ["Fire"],
             "device": [{"device_report_product_code": "DTK", "manufacturer_d_name": "COOK INC"},
                        {"device_report_product_code": "DTK", "manufacturer_d_name": "COOK INC"}]},
            {"date_received": "20240421", "event_type": "Malfunction", "device": [{"device_report_product_code": "ZZZ"}]},
        ]
        agg = b.count_maude(recs, {"DWJ": 0, "DTK": 1}, groups)
        self.assertEqual(agg["series"]["0"], {"2024-01": [1, 0, 1, 0]})
        self.assertEqual(agg["series"]["1"], {"2024-04": [1, 1, 0, 0]})
        self.assertEqual(agg["series"]["2"], {"2024-01": [1, 0, 1, 0]})
        self.assertEqual(agg["bd"]["0"]["patient_problem"], {"Burn": 1, "Pain": 1})
        self.assertEqual(agg["bd"]["1"]["manufacturer"], {"COOK INC": 1})
        self.assertEqual(agg["bq"]["2"], {"2024-Q1": {"Overheating": 1}})
        self.assertNotIn("1", agg["bq"])


class ReduceTests(unittest.TestCase):
    def test_top_terms_order_ties_and_returned(self):
        counts = {"B": [5, 1], "A": [5, 2], "C": [1, 0], "D": [9, 9]}
        terms, returned = b.top_terms(counts, 3)
        self.assertEqual([t for t, _n, _s in terms], ["D", "A", "B"])
        self.assertEqual(returned, 3)
        terms, returned = b.top_terms({"x": 2}, 25)
        self.assertEqual((terms, returned), ([("x", 2, None)], 1))
        long = {"Z" * 600: [3, 0], "Z" * 500 + "Y": [2, 0]}
        terms, _ = b.top_terms(long, 10)
        self.assertEqual(len(terms), 1)
        self.assertEqual(terms[0][1], 3)

    def test_breakdown_row_matches_the_loader_contract(self):
        row = b.breakdown_row("faers:x", "meddra_pt", "2024", {"A": [3, 1], "B": [2, 2]}, 25, "https://u", "t", True)
        self.assertEqual((row["terms"], row["vals"], row["serious"], row["returned"]), (["A", "B"], [3, 2], [1, 2], 2))
        self.assertTrue(all(s <= v for s, v in zip(row["serious"], row["vals"])))
        empty = b.breakdown_row("faers:x", "meddra_pt", "all", {}, 1000, "https://u", "t", True)
        self.assertNotIn("serious", empty)
        self.assertEqual((empty["terms"], empty["returned"]), ([], 0))

    def test_series_rows_open_at_the_first_report_month(self):
        months = {"2003-12": [9, 9], "2004-02": [2, 1], "2004-04": [1, 0], "2026-07": [5, 5]}
        rows = b.series_rows("faers:x", months, [("faers_reports", 0, "reports"), ("faers_serious", 1, "serious")],
                             "2004-01", "2026-06", "openfda_faers", lambda n: f"https://u/{n}", "m", "t", only={"faers_serious"})
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["series"], r["coverage_from"], r["coverage_to"]), ("faers_serious", "2004-02", "2026-06"))
        self.assertEqual(r["vals"][:3], [1, 0, 0])
        self.assertEqual(len(r["vals"]), (2026 - 2004) * 12 + 5)
        self.assertEqual(b.series_rows("s", {"2026-07": [1]}, [("a", 0, "u")], "2004-01", "2026-06", "x",
                                       lambda n: "https://u", "m", "t"), [])

    def test_periods_with_reports_only(self):
        months = {"2022-03": [1], "2024-01": [2], "2026-02": [1]}
        self.assertEqual(b.periods_for(months, "2022-03", "2026-06", "year"), ["2022", "2024"])
        self.assertEqual(b.periods_for(months, "2022-03", "2026-06", "quarter"), ["2022-Q1", "2024-Q1", "2026-Q1"])
        self.assertEqual(b.last_complete_month("20260630"), "2026-06")
        self.assertEqual(b.last_complete_month("20260929"), "2026-08")

    def test_faers_ids_follow_the_subject_builder(self):
        uni = [[1, 10, "IBUPROFEN TABLET, FILM COATED"], [2, 9, "IBUPROFEN TABLET, FILM-COATED"], [3, 8, "ASPIRIN"]]
        ids = b.faers_ids(uni)
        self.assertEqual(ids[0], "faers:ibuprofen-tablet-film-coated")
        self.assertTrue(ids[1].startswith("faers:ibuprofen-tablet-film-coated-") and len(ids[1]) > len(ids[0]))
        self.assertEqual(ids[2], "faers:aspirin")

    def test_validation_sample_is_deterministic(self):
        rows = [{"k": str(i)} for i in range(50)]
        a = b.sample(rows, 5, lambda r: r["k"])
        self.assertEqual(a, b.sample(list(reversed(rows)), 5, lambda r: r["k"]))
        self.assertEqual(len(a), 5)

    def test_compare_window(self):
        row = {"coverage_from": "2024-01", "coverage_to": "2024-03", "vals": [1, 0, 2]}
        self.assertEqual(b.compare_window(row, {"2024-01": [1], "2024-03": [2]}, 0), [])
        self.assertEqual(b.compare_window(row, {"2024-01": [1]}, 0), [("2024-03", 2, 0)])


class NdcTests(unittest.TestCase):
    def test_keys_join_on_the_exact_name_and_keep_the_stored_fields(self):
        recs = [
            {"generic_name": "Tirzepatide", "application_number": "NDA215866",
             "openfda": {"pharm_class_epc": ["GLP-1 Receptor Agonist [EPC]"]}},
            {"generic_name": "tirzepatide ", "application_number": "NDA217806", "openfda": {}},
            {"generic_name": "Tirzepatide Injection", "application_number": "NDA999999"},
            {"generic_name": "Copper", "application_number": "NDA018680"},
            {"generic_name": "Pantoprazole", "application_number": "ANDA077619",
             "pharm_class": ["Proton Pump Inhibitor [EPC]", "Proton Pump Inhibitors [MoA]"]},
            {"generic_name": "", "application_number": "X"},
        ]
        keys = b.ndc_keys(recs)
        self.assertEqual(keys["TIRZEPATIDE"]["products"], 2)
        prods = [{"id": "faers:tirzepatide", "generic_name": "TIRZEPATIDE", "rank": 72, "reports_total": 160663},
                 {"id": "faers:copper", "generic_name": "COPPER", "rank": 364, "reports_total": 42852},
                 {"id": "faers:x", "generic_name": "UNLISTED", "rank": 9, "reports_total": 1}]
        rows = b.subject_key_rows(prods, keys, "2026-10-27", "2026-10-23")
        self.assertEqual([r["id"] for r in rows], ["faers:tirzepatide", "faers:copper"])
        t = rows[0]
        self.assertEqual(t["keys"]["application_numbers"], ["NDA215866", "NDA217806"])
        self.assertEqual(t["keys"]["pharm_class_epc"], ["GLP-1 Receptor Agonist [EPC]"])
        self.assertEqual(t["keys"]["generic_name"], "TIRZEPATIDE")
        self.assertEqual(t["search"], {"faers": 'patient.drug.openfda.generic_name.exact:"TIRZEPATIDE"'})
        self.assertEqual((t["rank"], t["reports_total"], t["as_of"], t["label"]), (72, 160663, "2026-10-23", "TIRZEPATIDE"))
        self.assertNotIn("pharm_class_epc", rows[1]["keys"])
        self.assertEqual(keys["PANTOPRAZOLE"]["pharm_class_epc"], {"Proton Pump Inhibitor [EPC]"})


class KeylessTests(unittest.TestCase):
    def test_run_requires_a_key_unless_keyless(self):
        old = os.environ.pop("DATA_GOV_API_KEY", None)
        try:
            with tempfile.TemporaryDirectory() as d:
                ns = argparse.Namespace(outdir=d, interval=0.5, max_requests=1, chunk_rows=10)
                with self.assertRaises(SystemExit):
                    ob.Run(ns, "x")
                ns.keyless = True
                run = ob.Run(ns, "x")
                self.assertIsNone(run.key)
        finally:
            if old is not None:
                os.environ["DATA_GOV_API_KEY"] = old


if __name__ == "__main__":
    unittest.main()
