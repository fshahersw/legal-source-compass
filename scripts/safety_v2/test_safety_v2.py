"""Offline tests of the safety/1 builders' pure parts (no network, no credentials).

  python3 -I -m unittest discover -s scripts/safety_v2 -p 'test_*.py'
"""
import gzip
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as c  # noqa: E402
import mdl_map  # noqa: E402
import nhtsa_complaints as nh  # noqa: E402
import neiss_cases as ne  # noqa: E402
import openfda_build as ob  # noqa: E402
import osha_build as osb  # noqa: E402
import open_payments_build as opb  # noqa: E402


class CommonTests(unittest.TestCase):
    def test_public_url_strips_keys(self):
        self.assertEqual(c.public_url("https://api.fda.gov/drug/event.json?search=x&api_key=SECRET&count=y"),
                         "https://api.fda.gov/drug/event.json?search=x&count=y")
        self.assertEqual(c.public_url("https://x.example/a?api_key=K"), "https://x.example/a")

    def test_openfda_query_keeps_plus_and_encodes_spaces(self):
        u = c.openfda_query("device/event.json", search='device.brand_name:"bair hugger"+AND+event_type:"Death"', count="date_received")
        self.assertEqual(u, 'https://api.fda.gov/device/event.json?search=device.brand_name:"bair%20hugger"+AND+event_type:"Death"&count=date_received')

    def test_day_counts_to_months(self):
        got = c.day_counts_to_months([{"time": "20240105", "count": 2}, {"time": "20240131", "count": 3},
                                      {"time": "20240201", "count": 1}, {"time": "00100817", "count": 9}])
        self.assertEqual(got, {"2024-01": 5, "2024-02": 1})

    def test_months_and_quarters(self):
        self.assertEqual(c.month_add("2024-11", 3), "2025-02")
        self.assertEqual(c.month_span("2024-11", "2025-01"), ["2024-11", "2024-12", "2025-01"])
        self.assertEqual(c.quarter_of("2024-05"), "2024-Q2")
        self.assertEqual(c.quarter_bounds("2024-Q1"), ("20240101", "20240331"))
        self.assertEqual(c.quarter_bounds("2024-Q4"), ("20241001", "20241231"))

    def test_chunk_writer_never_splits_a_group_and_indexes_sha(self):
        with tempfile.TemporaryDirectory() as d:
            w = c.ChunkWriter(d, "series-t", max_rows=3)
            w.add_group([{"a": 1}, {"a": 2}])
            w.add_group([{"a": 3}, {"a": 4}])
            res = w.close()
            self.assertEqual([ch["rows"] for ch in res["chunks"]], [2, 2])
            rows, sha = c.read_chunk(Path(d) / res["chunks"][0]["file"])
            self.assertEqual(rows, [{"a": 1}, {"a": 2}])
            self.assertEqual(sha, res["chunks"][0]["sha256"])
            with self.assertRaises(ValueError):
                c.ChunkWriter(d, "x", max_rows=1).add_group([{"a": 1}, {"a": 2}])


class MdlMapTests(unittest.TestCase):
    def test_every_entry_has_tokens_basis_and_one_search(self):
        seen = set()
        for e in mdl_map.MDLS:
            self.assertNotIn(e["mdl"], seen)
            seen.add(e["mdl"])
            self.assertTrue(e["tokens"])
            self.assertIn(e["basis"], ("title_names_product", "title_names_brand", "title_names_class",
                                       "title_names_manufacturer_and_device", "title_names_vehicle_and_component"))
            n = sum(1 for k in ("names", "epc", "maude", "caers", "nhtsa") if e.get(k))
            self.assertGreaterEqual(n, 1, e["mdl"])
            self.assertNotIn(e["mdl"], mdl_map.NOT_MAPPED)

    def test_tokens_must_be_in_the_title(self):
        e = {"mdl": 1, "tokens": ["Taxotere", "Docetaxel"]}
        self.assertEqual(mdl_map.check_tokens(e, "IN RE: Taxotere (Docetaxel) Products Liability Litigation"), [])
        self.assertEqual(mdl_map.check_tokens(e, "IN RE: Taxotere Products Liability Litigation"), ["Docetaxel"])

    def test_faers_search_uses_only_the_title_names(self):
        e = {"names": ["Taxotere"], "epc": [], "reactions": []}
        self.assertEqual(mdl_map.faers_search(e), '(patient.drug.openfda.generic_name:"taxotere"+patient.drug.openfda.brand_name:"taxotere"'
                         '+patient.drug.medicinalproduct:"taxotere")')
        e = {"epc": ["GLP-1 Receptor Agonist"], "reactions": ["Optic ischaemic neuropathy"]}
        self.assertEqual(mdl_map.faers_search(e), '(patient.drug.openfda.pharm_class_epc:"GLP-1 Receptor Agonist")'
                         '+AND+patient.reaction.reactionmeddrapt:("Optic ischaemic neuropathy")')

    def test_snapshot_titles_cover_every_entry_when_present(self):
        path = c.BUILD / "mdl" / "titles.json"
        if not path.exists():
            self.skipTest("titles snapshot not built")
        titles = json.loads(path.read_text())
        for e in mdl_map.MDLS:
            self.assertEqual(mdl_map.check_tokens(e, titles[str(e["mdl"])]["title"]), [], e["mdl"])


class OpenfdaTests(unittest.TestCase):
    def test_last_complete_month(self):
        self.assertEqual(ob.last_complete_month([{"time": "20260630", "count": 1}]), "2026-06")
        self.assertEqual(ob.last_complete_month([{"time": "20260915", "count": 1}]), "2026-08")

    def test_series_row_zero_fills_the_window(self):
        row = ob.series_row("mdl:1", "faers_reports", "reports", "openfda_faers", "https://u", "m", {"2024-01": 2, "2024-03": 5}, "2024-01", "2024-04")
        self.assertEqual(row["vals"], [2, 0, 5, 0])
        self.assertEqual((row["coverage_from"], row["coverage_to"]), ("2024-01", "2024-04"))

    def test_windows_from_days(self):
        days = {"20240101": 10, "20240102": 15, "20240103": 30, "20240104": 1}
        self.assertEqual(ob.windows_from_days(days, cap=25), [("20240101", "20240102", 25), ("20240103", "20240103", 30), ("20240104", "20240104", 1)])

    def test_search_fields_and_query_split(self):
        self.assertEqual(ob.search_fields('recalling_firm:"philips"+AND+product_code:("BZD"+"CBK")'), ["product_code", "recalling_firm"])
        self.assertEqual(ob.search_fields('(patient.drug.openfda.generic_name:"a: b")+AND+receivedate:[20200101+TO+20200131]'),
                         ["patient.drug.openfda.generic_name", "receivedate"])
        self.assertEqual(ob.search_fields("_exists_:product_code"), [])
        u = c.openfda_query("device/enforcement.json", search='recalling_firm:"philips respironics"', count="report_date")
        self.assertEqual(ob.split_query(u), ("device/enforcement.json", 'recalling_firm:"philips respironics"'))
        self.assertEqual(ob.split_query(c.openfda_query("drug/event.json", count="receivedate")), ("drug/event.json", None))

    def test_no_match_is_zero_only_when_every_field_exists(self):
        class FakeHttp:
            def __init__(self):
                self.urls = []

            def request(self, url):
                self.urls.append(url)
                if "_exists_:product_code" in url and "device/enforcement" in url:
                    return 404, b""
                if "_exists_:" in url:
                    return 200, b'{"results": [{}]}'
                return 404, b""  # every real query: no matches

        run = ob.Run.__new__(ob.Run)
        run.http, run.key, run.state, run.done = FakeHttp(), "K", {}, set()
        import threading
        run.lock = threading.RLock()
        ok = c.openfda_query("device/recall.json", search='recalling_firm:"philips"+AND+product_code:"BZD"', count="event_date_initiated")
        self.assertEqual(run.get(ok)[0], None)  # a true zero: both fields exist on device/recall
        bad = c.openfda_query("device/enforcement.json", search='recalling_firm:"philips"+AND+product_code:"BZD"', count="report_date")
        with self.assertRaises(ob.FieldMissing):
            run.get(bad)
        probes = [u for u in run.http.urls if "_exists_" in u]
        run.get(ok)
        self.assertEqual(len([u for u in run.http.urls if "_exists_" in u]), len(probes))  # probes are cached
        self.assertTrue(all("api_key=K" in u for u in run.http.urls))

    def test_prefix_search_escapes_spaces_not_hyphens(self):
        f = "patient.drug.openfda.generic_name.exact"
        self.assertEqual(ob.prefix_search(f, "A"), f + ":A*")
        self.assertEqual(ob.prefix_search(f, "A "), f + ":A\\ *")
        self.assertEqual(ob.prefix_search(f, "L-"), f + ":L-*")
        self.assertNotIn("?", ob.prefix_search(f, "A B "))
        u = c.openfda_query("drug/event.json", search=ob.prefix_search(f, "A "), count=f, limit=1000)
        self.assertIn("generic_name.exact:A\\%20*&count=", u)

    def test_named_product_link_tokens_are_words_of_the_title(self):
        self.assertEqual(ob.title_tokens_for("Varenicline", "IN RE: Chantix (Varenicline) PL", ["Chantix", "Varenicline"]),
                         ["Varenicline"])
        self.assertEqual(ob.title_tokens_for("Heparin Sodium", "Heparin PL", ["Heparin"]), ["Heparin"])
        self.assertEqual(ob.title_tokens_for("Heparinoid", "Heparin PL", ["Heparin"]), [])
        self.assertEqual(ob.title_tokens_for("Aspirin", "Heparin PL", ["Heparin"]), [])

    def test_display_label_fits_the_subject_label_bound(self):
        self.assertEqual(ob.display_label("ASPIRIN"), "ASPIRIN")
        name = ", ".join(f"INGREDIENT NUMBER {i}" for i in range(40))
        label = ob.display_label(name)
        self.assertLessEqual(len(label), 300)
        self.assertTrue(label.endswith("…"))
        self.assertTrue(name.startswith(label[:-1]))
        self.assertFalse(label[:-1].endswith(","))
        self.assertEqual(len(ob.display_label("X" * 400)), 300)

    def test_maude_record_keeps_published_text_and_drops_placeholders(self):
        r = {"report_number": "1234567-2020-00001", "mdr_report_key": "99", "date_received": "20200105", "event_type": "Injury",
             "device": [{"brand_name": "X", "manufacturer_d_name": "M", "device_report_product_code": "DQX", "model_number": "*"}],
             "product_problems": ["Break"], "patient": [{"patient_problems": ["Pain", "Pain"]}],
             "mdr_text": [{"text_type_code": "Description of Event or Problem", "text": "IT BROKE."},
                          {"text_type_code": "Additional Manufacturer Narrative", "text": "EVALUATED."}]}
        rec = ob.maude_record(r, "2026-10-23")
        self.assertEqual(rec["event_text"], "IT BROKE.")
        self.assertEqual(rec["manufacturer_narrative"], "[Additional Manufacturer Narrative] EVALUATED.")
        self.assertEqual(rec["model_numbers"], [])
        self.assertEqual(rec["patient_problems"], ["Pain"])
        self.assertEqual(rec["date_received"], "2020-01-05")


class NhtsaTests(unittest.TestCase):
    def line(self, odino="11633477", make="TESLA", model="MODEL Y", comp="AIR BAGS:FRONTAL", text="THE TAKATA INFLATOR RUPTURED",
             crash="Y", fire="N", vin="5YJ3E1EA1", operator="JANE DOE"):
        f = [""] * 51
        f[nh.IX["ODINO"]], f[nh.IX["MAKETXT"]], f[nh.IX["MODELTXT"]], f[nh.IX["YEARTXT"]] = odino, make, model, "2021"
        f[nh.IX["COMPDESC"]], f[nh.IX["CDESCR"]], f[nh.IX["CRASH"]], f[nh.IX["FIRE"]] = comp, text, crash, fire
        f[nh.IX["LDATE"]], f[nh.IX["VIN"]], f[nh.IX["VEHICLE_OPERATOR"]], f[nh.IX["INJURED"]] = "20250102", vin, operator, "1"
        f[nh.IX["CITY"]], f[nh.IX["DEALER_TEL"]] = "AUSTIN", "555-0100"
        return "\t".join(f)

    def test_rows_group_by_odino_without_withheld_fields(self):
        rows = list(nh.parse_rows([self.line(), self.line(comp="STEERING")]))
        cpl = nh.group_complaints(rows)[11633477]
        self.assertEqual([i["component"] for i in cpl["items"]], ["AIR BAGS:FRONTAL", "STEERING"])
        flat = json.dumps(cpl)
        for withheld in ("5YJ3E1EA1", "JANE DOE", "AUSTIN", "555-0100"):
            self.assertNotIn(withheld, flat)
        self.assertTrue(cpl["crash"])
        self.assertEqual(cpl["injured"], 1)

    def test_rule_matching(self):
        cpl = nh.group_complaints(list(nh.parse_rows([self.line()])))[11633477]
        self.assertTrue(nh.matches({"text": ["TAKATA"], "component": ["AIR BAGS"]}, cpl))
        self.assertFalse(nh.matches({"text": ["TAKATA"], "component": ["ENGINE"]}, cpl))
        self.assertFalse(nh.matches({"make": ["KIA"]}, cpl))
        self.assertFalse(nh.matches({"make": ["TESLA"], "fire": True}, cpl))

    def test_series_only_from_complete_contiguous_reads(self):
        self.assertEqual(nh.series_window(["2020-2024", "2025-2026"], "2025-06-12", True), ("2020-01", "2025-05"))
        self.assertEqual(nh.series_window(["2025-2026"], "2025-06-12", True), ("2025-01", "2025-05"))
        self.assertIsNone(nh.series_window(["2025-2026"], "2025-06-12", False))  # --limit: partial, unsorted read
        self.assertIsNone(nh.series_window(["2015-2019", "2025-2026"], "2025-06-12", True))  # gap 2020-2024
        self.assertIsNone(nh.series_window(["2025-2026"], "2025-01-03", True))  # nothing complete yet

    def test_decode_falls_back_to_cp1252(self):
        self.assertEqual(nh.decode("it’s".encode("utf-8")), "it’s")
        self.assertEqual(nh.decode(b"it\x92s"), "it’s")


class NeissTests(unittest.TestCase):
    HEADER = ("CPSC_Case_Number\tTreatment_Date\tAge\tSex\tRace\tOther_Race\tHispanic\tBody_Part\tDiagnosis\tOther_Diagnosis\t"
              "Body_Part_2\tDiagnosis_2\tOther_Diagnosis_2\tDisposition\tLocation\tFire_Involvement\tProduct_1\tProduct_2\tProduct_3\t"
              "Alcohol\tDrug\tNarrative_1\tStratum\tPSU\tWeight")

    def write(self, d, body):
        p = Path(d) / "neiss2099.tsv.gz"
        with gzip.open(p, "wb") as f:
            f.write((self.HEADER + "\r\n" + body).encode("cp1252"))
        return p

    def test_split_record_is_rejoined_without_separator(self):
        first = "250102066\t01/01/2025\t47\t2\t2\t\t2\t36\t59\t\t\t\t\t1\t0\t0\t4076\t1807\t0\t0\t0\tFELL AND"
        rest = " HIT LEG\tM\t200\t46.4246"
        with tempfile.TemporaryDirectory() as d:
            p = self.write(d, first + "\r\n" + rest + "\r\n")
            stats = {"rejoined": 0, "narrative_tabs_merged": 0, "fragments_skipped": 0}
            rows = list(ne.records(p, stats))
            self.assertEqual(stats["rejoined"], 1)
            rec = ne.parse(rows[0], 2025)
            self.assertEqual(rec["narrative"], "FELL AND HIT LEG")
            self.assertEqual(rec["weight"], 46.4246)
            self.assertEqual(rec["treatment_date"], "2025-01-01")
            self.assertEqual(rec["product_1"], 4076)


class OshaAndPaymentsTests(unittest.TestCase):
    def test_osha_value_parsing(self):
        self.assertEqual(osb.d("2020-10-22 00:00:00+00:00"), "2020-10-22")
        self.assertIsNone(osb.d("NaT"))
        self.assertEqual(osb.i("5241.0"), 5241)
        self.assertIsNone(osb.i("nan"))
        self.assertEqual(osb.money("4500.00"), "4500.00")
        self.assertIsNone(osb.money("x"))
        self.assertIsNone(osb.s("nan"))

    def test_open_payments_cents(self):
        self.assertEqual(opb.cents("353.80999999999995"), "353.81")
        self.assertEqual(opb.cents(1186.65), "1186.65")


if __name__ == "__main__":
    unittest.main()
