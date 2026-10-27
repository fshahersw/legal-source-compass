"""Offline tests for the case-level FJC IDB projection (idb_case_level.py) and corpus_writer.publish_jsonl. No network."""
import hashlib
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
import idb_case_level as cl  # noqa: E402

PROV = {"source_url": "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2",
        "source_as_of": "2026-09-30", "record_sha256": "ab" * 32}


def entity(native="100", **over):
    data = {
        "id": native, "office": "1", "origin": "13", "pro_se": "0", "title": "28", "section": "1332", "subsection": "",
        "judgment": None, "defendant": "ACME CORP", "plaintiff": "DOE", "circuit_id": "ca11", "date_filed": "2020-01-02",
        "disposition": None, "district_id": "flnd", "class_action": None, "jurisdiction": "4", "year_of_tape": "2099",
        "date_transfer": None, "docket_number": "2000001", "dataset_source": "9", "nature_of_suit": "365",
        "amount_received": None, "date_terminated": None, "monetary_demand": "0", "transfer_office": "", "transfer_origin": "",
        "nature_of_judgement": None, "procedural_progress": None, "arbitration_at_filing": "", "transfer_docket_number": "",
        "termination_class_action_status": None, "multidistrict_litigation_docket_number": "2885",
    }
    data.update(over)
    return {"native_id": native, "data": data, "provenance": PROV, "source_as_of": "2026-09-30", "payload_sha256": "cd" * 32}


LK = {
    "nos": {365: "Personal Injury - Product Liability", 367: "Health Care / Pharma"},
    "district_state": {"flnd": "FL", "njd": "NJ"},
    "mdl_ids": {"mdl:2885", "mdl:2738"},
    "docket_by_idb": {"200": "cl:dockets:555"},
    "latest_filed": {"9": "2021-06-30"},
}


def fact(rec, label):
    return dict(map(tuple, rec["detail"]["facts"]))[label]


class ProjectionTests(unittest.TestCase):
    def test_pending_record_shape_and_labels(self):
        rec = cl.project(entity(), LK)
        self.assertEqual(rec["dataset"], "fjc_idb_civil_cases")
        self.assertEqual(rec["id"], "idb:100")
        self.assertEqual(rec["title"], "DOE v. ACME CORP")
        self.assertEqual(rec["state"], "FL")
        self.assertEqual(rec["source_url"], PROV["source_url"])
        self.assertIn("FJC IDB (historical)", rec["item"]["badges"])
        self.assertEqual(rec["filters"]["status"], ["pending"])
        self.assertEqual(rec["filters"]["disposition_group"], ["Pending"])
        self.assertEqual(rec["item"]["cells"]["disposition"], "Not terminated in this file")
        self.assertEqual(rec["item"]["cells"]["origin"], "Multidistrict litigation originating in the district (from July 1, 2016)")
        self.assertEqual(rec["item"]["cells"]["nos"], "365 Personal Injury - Product Liability")
        self.assertIn("not current JPML membership", fact(rec, "MDL docket number"))
        self.assertIn("latest filing date in these records 2021-06-30", fact(rec, "FJC file"))
        self.assertEqual(fact(rec, "Class action alleged"), "Not recorded")
        self.assertEqual(fact(rec, "Monetary demand"), "0 thousand dollars (as recorded)")

    def test_terminated_record_decodes_with_codebook_only(self):
        rec = cl.project(entity(date_terminated="2021-03-01", disposition="13", procedural_progress="5", nature_of_judgement="0",
                                judgment="0", amount_received="9999", class_action="t", termination_class_action_status="3"), LK)
        self.assertEqual(rec["filters"]["status"], ["terminated"])
        self.assertEqual(fact(rec, "Disposition"), "Dismissed: settled (code 13)")
        self.assertEqual(rec["filters"]["disposition_group"], ["Dismissed"])
        self.assertEqual(fact(rec, "Nature of judgment"), "No monetary award (code 0)")
        # JUDGMENT 0 is not in the codebook table: shown as Not recorded with the raw code, never guessed
        self.assertEqual(fact(rec, "Judgment for"), "Not recorded (code 0)")
        self.assertEqual(rec["item"]["cells"]["judgment_for"], "Not recorded")
        self.assertIn("9,999 is the field's largest value", fact(rec, "Amount received"))
        self.assertEqual(fact(rec, "Class action alleged"), "Yes (CLASSACT = 1)")
        self.assertEqual(fact(rec, "Class action status at termination"), "Class certification granted (code 3)")
        self.assertIn("Class action alleged", rec["item"]["badges"])

    def test_unknown_codes_and_missing_values_are_not_recorded(self):
        rec = cl.project(entity(origin="77", nature_of_suit="999", plaintiff="", defendant=None, jurisdiction=None), LK)
        self.assertEqual(rec["item"]["cells"]["origin"], "Not recorded")
        self.assertEqual(fact(rec, "Origin"), "Not recorded (code 77)")
        self.assertEqual(rec["filters"]["origin"], [])
        self.assertEqual(rec["item"]["cells"]["nos"], "999 Not recorded")
        self.assertEqual(rec["title"], "Not recorded v. Not recorded")
        self.assertEqual(fact(rec, "Jurisdiction"), "Not recorded")

    def test_links_are_exact_only(self):
        linked = cl.project(entity(native="200"), LK)
        urls = [l["url"] for l in linked["item"]["links"]]
        self.assertIn("/records/cl_docket_metadata/cl:dockets:555", urls)
        self.assertIn("https://www.courtlistener.com/docket/555/", urls)
        self.assertIn("/records/fjc_civil_mdls/mdl:2885", urls)
        self.assertEqual(linked["filters"]["linked_docket"], ["yes"])
        unlinked = cl.project(entity(native="201", multidistrict_litigation_docket_number="9999"), LK)
        urls = [l["url"] for l in unlinked["item"]["links"]]
        self.assertFalse(any(u.startswith("/records/cl_docket_metadata/") for u in urls))
        self.assertFalse(any(u.startswith("/records/fjc_civil_mdls/") for u in urls))
        self.assertEqual(unlinked["filters"]["linked_docket"], ["no"])

    def test_transfer_fields_shown_as_recorded(self):
        rec = cl.project(entity(date_transfer="2019-05-01", transfer_office="3", transfer_docket_number="1900123", transfer_origin="6"), LK)
        self.assertEqual(fact(rec, "Transfer date / office / docket / origin code (as recorded)"), "2019-05-01 / 3 / 1900123 / 6")
        self.assertEqual(rec["filters"]["transferred"], ["yes"])

    def test_sort_key_orders_by_mdl_court_date(self):
        a = cl.project(entity(native="1", multidistrict_litigation_docket_number="2738", district_id="njd"), LK)
        b = cl.project(entity(native="2"), LK)
        self.assertLess(cl.sort_key(a), cl.sort_key(b))


class BuilderTests(unittest.TestCase):
    def test_build_end_to_end_offline(self):
        import build_fjc_idb_cases as b

        tables = {
            "fjc_civil_nos": [{"id": "nos:365", "name": "Personal Injury - Product Liability"}, {"id": "group:product", "name": "x"}],
            "fjc_civil_districts": [{"id": "flnd", "state": "FL"}, {"id": "njd", "state": "NJ"}],
            "fjc_civil_mdls": [{"id": "mdl:2885"}, {"id": "mdl:2738"}],
            "cl_docket_metadata": [{"id": "cl:dockets:1", "idb": "200"}, {"id": "cl:dockets:2", "idb": "300"}, {"id": "cl:dockets:3", "idb": "300"}],
        }
        ents = [entity("300"), entity("200", multidistrict_litigation_docket_number="2738", district_id="njd"),
                entity("100", date_terminated="2021-01-01", disposition="13")]

        def fake_keyset(table, select, filters, key, profile=None):
            if table == "entities":
                return iter(ents)
            return iter(tables[filters.split("=eq.", 1)[1]])

        out = tempfile.mkdtemp()
        with mock.patch.object(b, "keyset", side_effect=fake_keyset), mock.patch.object(b, "OUT", out), mock.patch.object(b, "ROOT", out):
            lk = b.lookups()
            self.assertEqual(lk["docket_by_idb"], {"200": "cl:dockets:1"})  # "300" is carried by two docket records: no link
            self.assertEqual(lk["nos"], {365: "Personal Injury - Product Liability"})
            manifest = b.build(lk)
            listing, summary = b.listing_and_summary(manifest, lk)
        self.assertEqual(manifest["records"], 3)
        self.assertEqual(manifest["stats"]["linked_docket=yes"], 1)
        self.assertEqual(manifest["stats"]["status=terminated"], 1)
        with open(os.path.join(out, manifest["file"]), encoding="utf-8") as handle:
            rows = [json.loads(line) for line in handle]
        self.assertEqual([r["id"] for r in rows], ["idb:200", "idb:100", "idb:300"])  # MDL 2738 first, then 2885 by filing date and id
        expected = hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()
        self.assertEqual(manifest["records_sha256"], expected)
        self.assertEqual(summary["ambiguous_docket_links_dropped"], 1)
        self.assertEqual([o["value"] for o in listing["filters"][1]["options"]], ["2738", "2885"])


class PublishJsonlTests(unittest.TestCase):
    def _file(self, rows):
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        self.addCleanup(os.remove, path)
        return path

    def test_duplicate_or_foreign_rows_stop_before_any_write(self):
        calls = []
        with mock.patch.object(writer, "_call", side_effect=lambda *a, **k: calls.append(a)):
            with self.assertRaises(ValueError):
                writer.publish_jsonl("d", "D", self._file([{"id": "a"}, {"id": "a"}]), listing_block={}, summary={})
            with self.assertRaises(ValueError):
                writer.publish_jsonl("d", "D", self._file([{"id": "a", "dataset": "other"}]), listing_block={}, summary={})
        self.assertEqual(calls, [])

    def test_digest_matches_publish_and_batches_with_ordinals(self):
        rows = [{"id": f"r{i}", "title": str(i)} for i in range(1203)]
        posted = []

        def fake_call(method, path, body=None, prefer=""):
            if method == "POST" and path == "corpus_records":
                posted.extend(body)

        with mock.patch.object(writer, "_call", side_effect=fake_call), mock.patch.object(writer, "_count", return_value=1203):
            count = writer.publish_jsonl("d", "D", self._file(rows), listing_block={}, summary={})
        self.assertEqual(count, 1203)
        self.assertEqual([r["ordinal"] for r in posted], list(range(1203)))
        expected = hashlib.sha256("\n".join(json.dumps({**r, "dataset": "d"}, sort_keys=True) for r in rows).encode()).hexdigest()
        with mock.patch.object(writer, "_call") as call, mock.patch.object(writer, "_count", return_value=1203):
            writer.publish_jsonl("d", "D", self._file(rows), listing_block={}, summary={})
        self.assertEqual(call.call_args_list[0].args[2][0]["manifest_sha256"], expected)

    def test_count_mismatch_leaves_dataset_not_ready(self):
        calls = []
        with mock.patch.object(writer, "_call", side_effect=lambda *a, **k: calls.append(a)), mock.patch.object(writer, "_count", return_value=1):
            with self.assertRaises(RuntimeError):
                writer.publish_jsonl("d", "D", self._file([{"id": "a"}, {"id": "b"}]), listing_block={}, summary={})
        self.assertFalse(any(c[0] == "PATCH" for c in calls))


if __name__ == "__main__":
    unittest.main()
