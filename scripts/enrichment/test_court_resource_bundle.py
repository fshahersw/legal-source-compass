import copy
import json
import tempfile
import unittest
from pathlib import Path
from build_court_resource_bundle import build_bundle, json_bytes, sha, verified_captures, verify_bundle
from capture_court_resources import extract_page, save_immutable


class CourtResourceBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        raw = b'<a href="/actual-rules">Civil Local Rules</a><a href="/forms">Forms</a>'
        extracted, text = extract_page(raw, "https://court.example/")
        text = text.encode("utf-8")
        receipt = {"court_id": "example", "court_name": "Example Court", "source_record": "test-fixture:example", "source_url": "https://court.example/", "final_url": "https://court.example/", "identity_reviewed": True, "status": "captured", "publication": "not_published", "retrieved_at": "2026-10-12T18:00:00Z", "response_sha256": sha(raw), "response_bytes": len(raw), "text_sha256": sha(text), **extracted}
        receipt_bytes = json_bytes(receipt)
        self.receipt_hash = sha(receipt_bytes)
        save_immutable(self.root / "raw" / f'{sha(raw)}.raw', raw)
        save_immutable(self.root / "text" / f'{sha(text)}.txt', text)
        save_immutable(self.root / "receipts" / f'{self.receipt_hash}.json', receipt_bytes)
        self.review = {"schema": "court-resource-review/1", "release": "test", "reviewer": "test reviewer", "reviewed_at": "2026-10-12T19:00:00Z", "decisions": [{"receipt_sha256": self.receipt_hash, "court_id": "example", "court_system": "Federal", "url": "https://court.example/actual-rules", "label": "Civil Local Rules", "kind": "rules", "decision": "approve", "note": "Reviewed exact fixture anchor"}]}

    def tearDown(self):
        self.temp.cleanup()

    def test_build_preserves_exact_observed_link_and_capture_hash(self):
        bundle = build_bundle(verified_captures(self.root), self.review)
        self.assertEqual(len(bundle["resources"]), 1)
        row = bundle["resources"][0]
        self.assertEqual(row["url"], self.review["decisions"][0]["url"])
        self.assertEqual(row["provenance"]["receiptSha256"], self.receipt_hash)
        self.assertEqual(row["review"]["decision"], "approved")

    def test_rejects_unreviewed_or_changed_identity_and_anchor(self):
        for field, value in (("decision", "hold"), ("court_id", "other"), ("url", "https://court.example/guessed-rules"), ("label", "Rewritten label"), ("note", ""), ("kind", "unreviewed")):
            review = copy.deepcopy(self.review)
            review["decisions"][0][field] = value
            with self.assertRaises(ValueError, msg=field):
                build_bundle(verified_captures(self.root), review)

    def test_rejects_corrupt_response_and_receipt(self):
        raw_path = next((self.root / "raw").glob("*.raw"))
        raw_path.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            verified_captures(self.root)

    def test_rejects_duplicate_reviewed_destinations(self):
        review = copy.deepcopy(self.review)
        review["decisions"].append(copy.deepcopy(review["decisions"][0]))
        with self.assertRaises(ValueError):
            build_bundle(verified_captures(self.root), review)

    def test_rebuild_rejects_a_bundle_that_changes_reviewed_provenance(self):
        captures = verified_captures(self.root)
        bundle = build_bundle(captures, self.review)
        self.assertEqual(verify_bundle(captures, self.review, bundle), 1)
        bundle["resources"][0]["provenance"]["sourceRecord"] = "changed"
        with self.assertRaises(ValueError):
            verify_bundle(captures, self.review, bundle)

    def test_hash_consistent_receipt_cannot_invent_an_anchor_missing_from_raw_source(self):
        path = self.root / "receipts" / f"{self.receipt_hash}.json"
        receipt = json.loads(path.read_bytes())
        receipt["anchors"][0]["url"] = "https://court.example/invented"
        encoded = json_bytes(receipt)
        path.unlink()
        save_immutable(self.root / "receipts" / f"{sha(encoded)}.json", encoded)
        with self.assertRaisesRegex(ValueError, "not observed"):
            verified_captures(self.root)


if __name__ == "__main__":
    unittest.main()
