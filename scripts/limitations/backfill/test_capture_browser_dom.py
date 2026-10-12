import json
from pathlib import Path
import tempfile
import unittest

from capture_browser_dom import digest, ingest, load_receipt


class BrowserReceiptTests(unittest.TestCase):
    def fixture(self, root, raw=None, text=None):
        raw = raw or '<section class="doc-content"><h2>12-3-456. Synthetic provision.</h2><p>Current through synthetic session.</p><p>Test text only.</p></section>'
        text = text or "12-3-456. Synthetic provision.\nCurrent through synthetic session.\nTest text only."
        raw_bytes, text_bytes = raw.encode(), text.encode()
        (root / "capture.html").write_bytes(raw_bytes)
        (root / "capture.txt").write_bytes(text_bytes)
        receipt = {"id": "TN-fixture".lower(), "url": "https://advance.lexis.com/documentpage/?title=12-3-456.+Synthetic&pddocfullpath=/shared/document/statutes-legislation/urn:contentItem:synthetic", "method": "public-browser-rendered-dom-fragment", "selector": "section.doc-content", "http_status": None, "retrieved_at": "2026-10-12T00:00:00.000Z", "raw_file": "capture.html", "text_file": "capture.txt", "raw_sha256": digest(raw_bytes), "text_sha256": digest(text_bytes), "raw_bytes": len(raw_bytes), "text_bytes": len(text_bytes)}
        path = root / "receipt.json"
        path.write_text(json.dumps(receipt), encoding="utf-8")
        return path

    def test_preserves_exact_bytes_and_does_not_invent_http_status(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = self.fixture(root)
            meta = ingest(path, root / "out", "TN", "12-3-456", "tn-synthetic-v2")
            self.assertIsNone(meta["status"])
            self.assertEqual((root / "out/captures/TN/tn-synthetic-v2.raw").read_bytes(), (root / "capture.html").read_bytes())
            with self.assertRaisesRegex(ValueError, "already exists"):
                ingest(path, root / "out", "TN", "12-3-456", "tn-synthetic-v2")

    def test_hash_consistent_truncated_html_cannot_claim_complete_body_text(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.fixture(Path(folder), raw='<section class="doc-content"><h2>12-3-456. Synthetic provision.</h2></section>')
            with self.assertRaisesRegex(ValueError, "does not exactly match"):
                load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")

    def test_layout_only_breadcrumb_spacing_does_not_change_observed_text(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.fixture(Path(folder), text="12-3-456. Synthetic provision.Current through synthetic session.Test text only.")
            meta, _ = load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")
            self.assertIn("no non-whitespace character differs", meta["textProof"])

    def test_changed_period_in_text_is_rejected_even_with_matching_receipt_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.fixture(Path(folder), text="12-3-456. Synthetic provision. Current through synthetic session. Changed words.")
            with self.assertRaisesRegex(ValueError, "does not exactly match"):
                load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")

    def test_wrong_section_state_and_parent_filename_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.fixture(Path(folder))
            for state, section in [("MS", "12-3-456"), ("TN", "12-3-789")]:
                with self.assertRaises(ValueError):
                    load_receipt(path, state, section, "tn-synthetic-v2")
            receipt = json.loads(path.read_bytes())
            receipt["raw_file"] = "../capture.html"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "basename"):
                load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")

    def test_next_navigation_still_requires_exact_visible_section_with_native_urn(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.fixture(Path(folder))
            receipt = json.loads(path.read_bytes())
            receipt["url"] = receipt["url"].replace("title=12-3-456.+Synthetic&", "")
            path.write_text(json.dumps(receipt), encoding="utf-8")
            load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")
            with self.assertRaisesRegex(ValueError, "heading"):
                load_receipt(path, "TN", "12-3-789", "tn-synthetic-v2")

    def test_cross_reference_is_not_the_native_provision_heading(self):
        with tempfile.TemporaryDirectory() as folder:
            raw = '<section class="doc-content"><h2>12-3-789. Other provision.</h2><p>Current through synthetic session.</p><p>See 12-3-456 for another provision.</p></section>'
            text = '12-3-789. Other provision.\nCurrent through synthetic session.\nSee 12-3-456 for another provision.'
            path = self.fixture(Path(folder), raw=raw, text=text)
            with self.assertRaisesRegex(ValueError, "heading"):
                load_receipt(path, "TN", "12-3-456", "tn-synthetic-v2")


if __name__ == "__main__":
    unittest.main()
