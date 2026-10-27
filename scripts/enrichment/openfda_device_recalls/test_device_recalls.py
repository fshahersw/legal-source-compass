"""Offline tests for the openFDA device recall rows (synthetic records shaped like the 2026-10-27 bulk export)."""
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import build_device_recalls as build  # noqa: E402
import recall_rows as rr  # noqa: E402

BULK = "https://download.open.fda.gov/device/recall/device-recall-0001-of-0001.json.zip"

RAW = {
    "cfres_id": "222683",
    "product_res_number": "Z-0129-2027",
    "event_date_initiated": "2026-09-17",
    "event_date_posted": "2026-10-20",
    "recall_status": "Open, Classified",
    "res_event_number": "99835",
    "product_code": "CBK",
    "k_numbers": ["K162877"],
    "product_description": "V+Pro \nModel Number: PRT-01185-000; Model Number: PRT-01185-001. used for ventilatory support.",
    "code_info": "All Serial Numbers: PRT-01185-000 -UDI: 00855573007877",
    "firm_fei_number": "3013095415",
    "recalling_firm": "Ventec Life Systems, Inc.",
    "address_1": "22002 26th Ave Se",
    "city": "Bothell",
    "state": "WA",
    "postal_code": "98021-4903",
    "additional_info_contact": "React Health \n844-698-6276",
    "reason_for_recall": "Ventilator's internal flow transducer cable connector may disconnect.",
    "root_cause_description": "Under Investigation by firm",
    "action": "On September 17, 2026, the firm issued a notification.",
    "product_quantity": "39,568 units",
    "distribution_pattern": "Distribution US nationwide including Puerto Rico.",
    "openfda": {
        "k_number": ["K011957", "K993167"],
        "registration_number": ["3010088563"],
        "fei_number": ["3010088563"],
        "device_name": "Ventilator, Continuous, Facility Use",
        "medical_specialty_description": "Anesthesiology",
        "regulation_number": "868.5895",
        "device_class": "2",
    },
}


def make(**changes):
    raw = json.loads(json.dumps(RAW))
    for key, value in changes.items():
        if value is None:
            raw.pop(key, None)
        else:
            raw[key] = value
    return rr.row(raw, bulk_url=BULK, export_date="2026-10-27")


class Rows(unittest.TestCase):
    def test_exact_keys_and_source_url(self):
        row = make()
        self.assertEqual(row["dataset"], "agency_safety_openfda_device_recalls")
        self.assertEqual(row["id"], "openfda:device/recall:Z-0129-2027")
        self.assertEqual(row["source_url"], "https://api.fda.gov/device/recall.json?search=product_res_number:%22Z-0129-2027%22")
        f = row["filters"]
        self.assertEqual(f["recall_number"], "Z-0129-2027")
        self.assertEqual(f["event_id"], "99835")
        self.assertEqual(f["product_code"], ["CBK"])
        self.assertEqual(f["k_numbers"], ["K162877"])
        self.assertEqual(f["cfres_id"], "222683")
        self.assertEqual(f["_listing"], ["yes"])
        rec = row["item"]["recall"]
        self.assertEqual(rec["root_cause_description"], "Under Investigation by firm")
        self.assertEqual(rec["recall_status"], "Open, Classified")
        self.assertEqual(rec["event_date_initiated"], "2026-09-17")
        urls = [link["url"] for link in row["detail"]["links"]]
        self.assertIn("https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=222683", urls)
        self.assertIn(BULK, urls)

    def test_private_and_bulky_fields_are_not_published(self):
        blob = json.dumps(make())
        for value in ("22002 26th Ave Se", "98021-4903", "844-698-6276", "00855573007877", "issued a notification", "K011957", "3010088563"):
            self.assertNotIn(value, blob)
        # the harmonized product-code fields are kept, labelled as openFDA's
        self.assertIn("Ventilator, Continuous, Facility Use", blob)

    def test_missing_values_read_not_recorded(self):
        row = make(event_date_posted=None, k_numbers=None, cfres_id=None, product_code=None)
        facts = dict((label, value) for label, value in row["detail"]["facts"])
        self.assertEqual(facts["Posted by FDA"], "Not recorded")
        self.assertEqual(facts["510(k) numbers"], "Not recorded")
        self.assertEqual(facts["Product code"], "Not recorded")
        self.assertNotIn("cfres_id", row["filters"])
        self.assertEqual(row["filters"]["product_code"], [])
        self.assertEqual(len(row["detail"]["links"]), 2)

    def test_keying_error_dates_are_kept_raw_not_corrected(self):
        row = make(event_date_initiated="0010-08-17")
        rec = row["item"]["recall"]
        self.assertIsNone(rec["event_date_initiated"])
        self.assertEqual(rec["event_date_initiated_raw"], "0010-08-17")
        self.assertIsNone(row["item"]["sort_date"])
        self.assertEqual(row["filters"]["year"], [])
        facts = dict(row["detail"]["facts"])
        self.assertEqual(facts["Recall initiated (firm)"], "0010-08-17 (as published; not a usable date)")

    def test_pma_and_product_code_join_keys(self):
        row = make(pma_numbers=["P970004/S9", "P970004S012", "N17752"], product_code="--")
        self.assertEqual(row["filters"]["pma_numbers"], ["P970004", "N17752"])
        self.assertEqual(row["item"]["recall"]["pma_numbers"], ["P970004/S9", "P970004S012", "N17752"])
        self.assertEqual(row["filters"]["product_code"], [])
        self.assertEqual(row["item"]["cells"]["product_code"], "--")

    def test_slash_recall_number_is_percent_encoded_in_the_url(self):
        row = make(product_res_number="Z-316/318-3")
        self.assertEqual(row["id"], "openfda:device/recall:Z-316/318-3")
        self.assertTrue(row["source_url"].endswith("product_res_number:%22Z-316%2F318-3%22"))

    def test_firm_norm_matches_enforcement_rule(self):
        self.assertEqual(rr.firm_norm("A L Kauffman & Sons Co. DBA Kauffman's Fruit Farm and Market"),
                         "A L KAUFFMAN AND SONS CO DBA KAUFFMANS FRUIT FARM AND MARKET")
        self.assertEqual(rr.firm_id(rr.firm_norm("3M Company/3m Espe Dental Products")),
                         "firm:3m-company-3m-espe-dental-products")

    def test_long_text_is_capped_and_flagged(self):
        row = make(reason_for_recall="x" * (rr.TEXT_CAP + 50))
        facts = dict(row["detail"]["facts"])
        self.assertEqual(len(facts["Reason for recall"]), rr.TEXT_CAP)
        self.assertIn("reason_for_recall", facts["Shortened here"])
        self.assertNotIn("reason_for_recall", row["item"]["recall"])


class Build(unittest.TestCase):
    def _acq(self, records, *, tamper=False):
        tmp = tempfile.mkdtemp()
        raw_dir = os.path.join(tmp, "raw", "device_recall")
        os.makedirs(raw_dir)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("device-recall-0001-of-0001.json", json.dumps({"meta": {}, "results": records}))
        data = buf.getvalue()
        path = os.path.join(raw_dir, "device-recall-0001-of-0001.json.zip")
        with open(path, "wb") as fh:
            fh.write(data)
        manifest = {"export_date": "2026-10-27", "partitions": [{
            "url": BULK, "file": "device-recall-0001-of-0001.json.zip", "records_listed": len(records),
            "sha256": "0" * 64 if tamper else hashlib.sha256(data).hexdigest()}]}
        with open(os.path.join(raw_dir, "manifest.json"), "w") as fh:
            json.dump(manifest, fh)
        return tmp

    def test_builds_newest_first_with_exact_summary(self):
        older = dict(RAW, product_res_number="Z-0001-2020", cfres_id="1", event_date_initiated="2020-01-02", res_event_number="1")
        acq = self._acq([older, RAW])
        _, rows, summary = build.build(acq)
        self.assertEqual([r["id"] for r in rows], ["openfda:device/recall:Z-0129-2027", "openfda:device/recall:Z-0001-2020"])
        self.assertEqual(summary["records"], 2)
        self.assertEqual(summary["recall_events"], 2)
        self.assertEqual(summary["by_initiation_year"], {"2020": 1, "2026": 1})
        self.assertEqual(build.digest(rows), build.digest(build.build(acq)[1]))

    def test_refuses_a_file_that_does_not_match_its_manifest(self):
        with self.assertRaises(SystemExit):
            build.build(self._acq([RAW], tamper=True))

    def test_refuses_duplicate_recall_numbers(self):
        with self.assertRaises(SystemExit):
            build.build(self._acq([RAW, RAW]))


if __name__ == "__main__":
    unittest.main()
