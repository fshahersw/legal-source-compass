import tempfile
import unittest
from pathlib import Path
from capture_court_resources import extract_page, safe_web_url, save_immutable


class CourtResourceEvidenceTests(unittest.TestCase):
    def test_only_observed_anchors_are_candidates(self):
        raw = b'''<h1>Court</h1><a href="/forms?type=civil&amp;year=2026">Civil <b>forms</b></a><a href="/actual">Local Rules</a><a href="javascript:alert(1)">Forms</a><script>"<a href='/fake'>Rules</a>"</script><a href="/reform">Reforming justice</a>'''
        extracted, text = extract_page(raw, "https://court.example/")
        self.assertEqual([a["url"] for a in extracted["anchors"]], ["https://court.example/forms?type=civil&year=2026", "https://court.example/actual"])
        self.assertEqual(extracted["anchors"][0]["label"], "Civil forms")
        self.assertNotIn("<b>", text)
        self.assertNotIn("/fake", text)

    def test_private_credentials_and_non_web_destinations_are_rejected(self):
        for url in ("http://court.example/", "https://user:pass@court.example/", "https://127.0.0.1/", "https://[::1]/", "https://localhost/", "file:///etc/passwd", "https://court.example/forms ", "https://court.example/local\nrules"):
            self.assertIsNone(safe_web_url(url))

    def test_malformed_observed_anchor_is_preserved_for_review_but_not_safe_to_publish(self):
        extracted, _ = extract_page(b'<a href="https://court.example/filing ">E-Filing</a>', "https://court.example/")
        self.assertEqual(extracted["anchors"][0]["href_as_published"], "https://court.example/filing ")
        self.assertIsNone(safe_web_url(extracted["anchors"][0]["url"]))

    def test_immutable_capture_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "capture.raw"
            save_immutable(path, b"original response")
            save_immutable(path, b"original response")
            with self.assertRaises(ValueError):
                save_immutable(path, b"replacement response")
            self.assertEqual(path.read_bytes(), b"original response")


if __name__ == "__main__":
    unittest.main()
