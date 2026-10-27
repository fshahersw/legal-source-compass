"""Offline tests for fjc_idb_mdl_cases (mdl_cases.py) and corpus_writer.publish_jsonl. No network: the writer's HTTP calls are faked."""
import hashlib
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import corpus_writer as writer  # noqa: E402
import mdl_cases as mc  # noqa: E402

# Shape and values of a stored corpus_ingest.entities row (courtlistener / fjc-integrated-database, native id 23114088).
ENTITY = {
    "native_id": "23114088",
    "payload_sha256": "3026e47321a0262f47c6a37ea37cb2ab6dbe2df0d6f5a649b33a4da21eb05e39",
    "source_as_of": "2026-09-30",
    "retrieved_at": "2026-10-02 08:35:57.527+00",
    "review_status": "source_metadata",
    "data": {
        "id": "23114088", "title": "", "office": "1", "origin": "1", "pro_se": "0", "section": "1332", "version": None, "judgment": "0",
        "defendant": "NATIONAL FOOTBALL LEAGU, ET AL", "plaintiff": "WALLACE", "circuit_id": "ca11", "date_filed": "2012-06-04",
        "subsection": "", "disposition": "10", "district_id": "gand", "class_action": None, "jurisdiction": "4", "year_of_tape": "2012",
        "date_transfer": None, "docket_number": "1201931", "dataset_source": "9", "nature_of_suit": "360", "amount_received": "0",
        "date_terminated": "2012-06-26", "monetary_demand": "0", "transfer_office": "", "transfer_origin": "", "nature_of_offense": "",
        "county_of_residence": "13121", "nature_of_judgement": "0", "procedural_progress": "1", "arbitration_at_filing": "",
        "diversity_of_residence": "15", "transfer_docket_number": "", "arbitration_at_termination": "",
        "termination_class_action_status": None, "multidistrict_litigation_docket_number": "2323",
    },
    "provenance": {"source_url": mc.SOURCE_URL, "source_as_of": "2026-09-30", "source_sha256": mc.SOURCE_SHA256,
                   "record_sha256": "3026e47321a0262f47c6a37ea37cb2ab6dbe2df0d6f5a649b33a4da21eb05e39", "selection_reasons": ["explicit_fjc_mdl_number"]},
}
LK = {"nos": {"360": "Other Personal Injury", "444": "Code 444 (not in the codebook)"}, "courts": {"gand": "District Court, N.D. Georgia"},
      "mdls": {"2323": "IN RE: National Football League Players' Concussion Injury Litigation"}, "fjc_civil_mdls": {"mdl:2323"}}


def pending(**over):
    e = json.loads(json.dumps(ENTITY))
    e["data"].update({"date_terminated": None, "year_of_tape": "2099", "disposition": None, "judgment": None, "nature_of_judgement": None,
                      "amount_received": None, "procedural_progress": None, **over})
    return e


def fact(rec, label):
    return dict((k, v) for k, v in rec["detail"]["facts"])[label]


class HelperTests(unittest.TestCase):
    def test_mdl_number_only_positive_whole_numbers(self):
        self.assertEqual(mc.mdl_number("2885"), "2885")
        self.assertEqual(mc.mdl_number("02885"), "2885")
        for bad in (None, "", "-8", "0", "000", "28A5", "MDL 2885"):
            self.assertIsNone(mc.mdl_number(bad), bad)

    def test_docket_forms(self):
        self.assertEqual(mc.docket_display("1201931"), "12-01931")
        self.assertIsNone(mc.docket_display("12019"))
        self.assertEqual(mc.cl_docket_core("1:12-cv-01931"), "1201931")
        self.assertEqual(mc.cl_docket_core("2:15-cv-4236"), "1504236")
        self.assertEqual(mc.cl_docket_core("3:19-cv-00123-MCR-GRJ"), "1900123")
        self.assertIsNone(mc.cl_docket_core(""))
        self.assertIsNone(mc.cl_docket_core(None))

    def test_docket_link_needs_fk_court_and_number(self):
        idx = {"23114088": {"record_id": "cl:dockets:1", "native_id": "1", "court_id": "gand", "docket_number": "1:12-cv-01931"}}
        self.assertEqual(mc.docket_link("23114088", "gand", "1201931", idx)["record_id"], "cl:dockets:1")
        self.assertIsNone(mc.docket_link("23114088", "gamd", "1201931", idx))  # court differs
        self.assertIsNone(mc.docket_link("23114088", "gand", "1201932", idx))  # number differs
        self.assertIsNone(mc.docket_link("999", "gand", "1201931", idx))  # no FK
        blank = {"23114088": {**idx["23114088"], "docket_number": ""}}
        self.assertIsNone(mc.docket_link("23114088", "gand", "1201931", blank))  # docket number not recorded

    def test_amounts(self):
        self.assertEqual(mc.thousands(None), mc.NR)
        self.assertEqual(mc.thousands("-8"), mc.NR)
        self.assertEqual(mc.thousands("75"), "75 (thousands of dollars, as recorded)")
        self.assertIn("filler or for an unknown amount", mc.thousands("9999", received=True))
        self.assertIn("highest value", mc.thousands("9999"))

    def test_nos_label_unknown_code(self):
        self.assertEqual(mc.nos_label(360, LK["nos"]), "360 Other Personal Injury")
        self.assertEqual(mc.nos_label(444, LK["nos"]), "Code 444 (not in the codebook)")
        self.assertEqual(mc.nos_label(999, LK["nos"]), "Code 999 (not in the codebook)")
        self.assertEqual(mc.nos_label(None, LK["nos"]), mc.NR)

    def test_fiscal_year(self):
        self.assertEqual(mc.fiscal_year("2012-06-04"), 2012)
        self.assertEqual(mc.fiscal_year("2012-10-01"), 2013)
        self.assertIsNone(mc.fiscal_year(None))


class RecordTests(unittest.TestCase):
    def test_terminated_record_decodes_codes_and_keeps_provenance(self):
        idx = {"23114088": {"record_id": "cl:dockets:6", "native_id": "6", "court_id": "gand", "docket_number": "1:12-cv-01931"}}
        rec = mc.build_record(ENTITY, LK, idx)
        self.assertEqual(rec["id"], "fjc:23114088")
        self.assertEqual(rec["dataset"], "fjc_idb_mdl_cases")
        self.assertEqual(rec["title"], "WALLACE v. NATIONAL FOOTBALL LEAGU, ET AL")
        self.assertEqual(rec["source_url"], mc.SOURCE_URL)
        self.assertEqual(fact(rec, "Origin"), "Original proceeding")
        self.assertEqual(fact(rec, "Jurisdiction"), "Diversity of citizenship")
        self.assertEqual(fact(rec, "Disposition"), "Multidistrict litigation transfer (Transferred or remanded)")
        self.assertEqual(fact(rec, "Judgment for"), mc.NR)  # codebook: 0 is missing
        self.assertEqual(fact(rec, "Nature of judgment"), "No monetary award")
        self.assertEqual(fact(rec, "Procedural progress at termination"), "No court action (before issue joined)")
        self.assertEqual(fact(rec, "Pro se parties"), "No pro se party")
        self.assertEqual(fact(rec, "Status in this IDB file"), "Terminated 2012-06-26")
        self.assertEqual(fact(rec, "IDB docket number"), "12-01931")
        self.assertEqual(fact(rec, "MDL title (JPML record, exact number)"), LK["mdls"]["2323"])
        self.assertIn("FJC IDB (historical)", rec["item"]["badges"])
        self.assertIn("Not JPML membership", rec["item"]["badges"])
        urls = [l["url"] for l in rec["item"]["links"]]
        self.assertIn("/matters/2323", urls)
        self.assertIn("/records/fjc_civil_mdls/mdl:2323", urls)
        self.assertIn("/courts/gand", urls)
        self.assertIn("/records/cl_docket_metadata/cl:dockets:6", urls)
        self.assertIn("https://www.courtlistener.com/docket/6/", urls)
        self.assertEqual(rec["filters"]["docket_linked"], ["yes"])
        self.assertEqual(rec["filters"]["mdl"], ["2323"])
        self.assertEqual(rec["filters"]["_listing"], ["yes"])
        self.assertEqual(rec["detail"]["provenance"]["payload_sha256"], ENTITY["payload_sha256"])
        self.assertEqual(rec["detail"]["provenance"]["record_sha256"], ENTITY["provenance"]["record_sha256"])
        self.assertEqual(fact(rec, "Linked docket (exact)"), "1:12-cv-01931 (CourtListener docket 6)")
        self.assertEqual(fact(rec, "MDL (IDB field MDLDOCK)"), "2323 - FJC IDB (historical); not JPML membership")
        self.assertEqual(rec["item"]["profile"]["codes"]["disposition_code"], 10)

    def test_other_snapshot_is_refused(self):
        e = json.loads(json.dumps(ENTITY))
        e["provenance"]["source_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            mc.build_record(e, LK, {})

    def test_pending_record_and_no_links_without_exact_evidence(self):
        lk = {**LK, "mdls": {}, "fjc_civil_mdls": set(), "courts": {}}
        rec = mc.build_record(pending(), lk, {})
        self.assertEqual(fact(rec, "Status in this IDB file"), "Pending in this IDB file (tape year 2099)")
        self.assertEqual(fact(rec, "IDB tape year"), "2099 (pending case record)")
        labels = [k for k, _ in rec["detail"]["facts"]]
        for absent in ("Disposition", "Amount received", "Judgment for", "Transferred: date papers received", "Class action alleged"):
            self.assertNotIn(absent, labels)  # termination facts only for terminated rows; optional facts only when recorded
        self.assertEqual(fact(rec, "Linked docket (exact)"), mc.NR)
        self.assertEqual(fact(rec, "MDL title (JPML record, exact number)"), mc.NR)
        self.assertEqual(rec["filters"]["status"], ["pending"])
        self.assertEqual(rec["filters"]["docket_linked"], ["no"])
        internal = [l["url"] for l in rec["item"]["links"] if l["url"].startswith("/")]
        self.assertEqual(internal, [])  # no JPML record, no FJC totals record, no court lookup, no docket: no internal link

    def test_parties_missing_and_class_action(self):
        rec = mc.build_record(pending(plaintiff="", defendant=None, class_action="t", termination_class_action_status="3"), LK, {})
        self.assertEqual(rec["title"], "Plaintiff not recorded v. Defendant not recorded")
        self.assertEqual(fact(rec, "Class action alleged"), "Yes (class action alleged)")
        self.assertEqual(fact(rec, "Class action at termination"), "Class certification granted")

    def test_row_without_mdl_number_is_refused(self):
        e = pending(multidistrict_litigation_docket_number="")
        with self.assertRaises(ValueError):
            mc.build_record(e, LK, {})

    def test_listing_block_lists_filters(self):
        block = mc.listing_block({"2323": "NFL"}, {"gand": "District Court, N.D. Georgia"})
        names = [f["name"] for f in block["filters"]]
        self.assertEqual(names[0], "q")
        for n in ("mdl", "court_id", "status", "origin", "nos_group", "disposition_group", "docket_linked"):
            self.assertIn(n, names)


class PublishJsonlTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.stored = 0
        self._call, self._count = writer._call, writer._count

        def fake_call(method, path, body=None, prefer="return=minimal"):
            self.calls.append((method, path, body))
            if method == "POST" and path == "corpus_records":
                self.stored += len(body)

        writer._call = fake_call
        writer._count = lambda dataset: self.stored

    def tearDown(self):
        writer._call, writer._count = self._call, self._count

    def write_rows(self, rows):
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as h:
            for r in rows:
                h.write(json.dumps(r) + "\n")
        self.addCleanup(os.remove, path)
        return path

    def test_same_digest_as_publish_and_batches_with_ordinals(self):
        rows = [{"dataset": "x", "id": f"r{i}", "title": str(i)} for i in range(1203)]
        path = self.write_rows(rows)
        count = writer.publish_jsonl("x", "X", path, listing_block={"columns": []}, summary={})
        self.assertEqual(count, 1203)
        expected = hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()
        catalog = self.calls[0]
        self.assertEqual(catalog[1], "corpus_datasets")
        self.assertEqual(catalog[2][0]["manifest_sha256"], expected)
        self.assertEqual(catalog[2][0]["ready"], False)
        self.assertEqual(self.calls[1][0:2], ("DELETE", "corpus_records?dataset=eq.x"))
        posts = [c for c in self.calls if c[0] == "POST" and c[1] == "corpus_records"]
        self.assertEqual([len(p[2]) for p in posts], [500, 500, 203])
        self.assertEqual(posts[2][2][-1]["ordinal"], 1202)
        self.assertEqual(self.calls[-1][0], "PATCH")
        self.assertTrue(self.calls[-1][2]["ready"])

    def test_bad_rows_write_nothing(self):
        for rows in ([{"dataset": "x", "id": "a"}, {"dataset": "x", "id": "a"}], [{"dataset": "y", "id": "a"}], [{"dataset": "x", "id": ""}]):
            self.calls.clear()
            with self.assertRaises(ValueError):
                writer.publish_jsonl("x", "X", self.write_rows(rows), listing_block={}, summary={})
            self.assertEqual(self.calls, [])

    def test_count_mismatch_leaves_dataset_not_ready(self):
        writer._count = lambda dataset: 1
        with self.assertRaises(RuntimeError):
            writer.publish_jsonl("x", "X", self.write_rows([{"dataset": "x", "id": "a"}, {"dataset": "x", "id": "b"}]), listing_block={}, summary={})
        self.assertNotIn("PATCH", [c[0] for c in self.calls])


if __name__ == "__main__":
    unittest.main()
