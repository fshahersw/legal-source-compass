import json
import hashlib
from pathlib import Path
import unittest
from law_id_crosswalk import candidate, build_crosswalk, lawid

def record(**extra):
    return dict(source_system="publisher_test", native_id="publisher-1",
                source_url="https://leg.example.gov/section/1", source_sha256="a" * 64,
                jurisdiction="mt", corpus="statutes", publisher_hierarchy=["title 10", "chapter 1", "part 10"],
                section_number="10-1-1001", hierarchy_complete=True, identity_reviewed=True, **extra)

class CrosswalkTests(unittest.TestCase):
    def test_vendored_files_match_pinned_source_bytes(self):
        root = Path(__file__).resolve().parents[1] / "vendor/open-law-id"
        pin = json.loads((root / "PINNED.json").read_text(encoding="utf8"))
        self.assertEqual(pin["commit"], "75f69acf4386fa7e198a33e3f93a58a0fe836774")
        for entry in pin["files"]:
            raw = (root / entry["file"]).read_bytes()
            with self.subTest(file=entry["file"]):
                self.assertEqual(len(raw), entry["bytes"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["sha256"])

    def test_preserves_native_identity_and_holds_for_publication(self):
        row = candidate(record())
        self.assertEqual(row["native_id"], "publisher-1")
        self.assertEqual(row["law_id"], "us1:mt/statutes/title-10/chapter-1/part-10/10-1-1001")
        self.assertFalse(row["publication_allowed"])
        self.assertFalse(row["calculation_activation_allowed"])

    def test_refuses_unreviewed_or_partial_path(self):
        for field in ("hierarchy_complete", "identity_reviewed"):
            row = record()
            row[field] = False
            with self.assertRaises(ValueError):
                candidate(row)

    def test_never_infers_version_from_date(self):
        with self.assertRaisesRegex(ValueError, "EXPRESSION"):
            candidate(record(point_in_time="2026-10-12"))

    def test_conflicting_native_id_or_hash_is_held(self):
        for field, value in (("native_id", "publisher-2"), ("source_sha256", "b"*64)):
            other = record()
            other[field] = value
            report = build_crosswalk([record(), other])
            self.assertEqual(report["candidates"], [])
            self.assertEqual(len(report["held"]), 2)

    def test_exact_duplicate_is_deduplicated(self):
        self.assertEqual(len(build_crosswalk([record(), record()])["candidates"]), 1)

    def test_reverse_native_identity_conflict_is_held(self):
        other = {**record(), "section_number": "10-1-1002"}
        report = build_crosswalk([record(), other])
        self.assertEqual(report["candidates"], [])
        self.assertEqual(len(report["held"]), 2)

    def test_unregistered_components_are_held(self):
        for field, value in (("jurisdiction", "made up"), ("corpus", "invented"), ("publisher_kind", "banana")):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "INVALID_LAW_ID"):
                candidate({**record(), field: value})

    def test_malformed_records_are_held(self):
        report = build_crosswalk([None, "not an object", [], {**record(), "source_url": None}])
        self.assertEqual(len(report["held"]), 4)
        self.assertEqual(report["candidates"], [])

    def test_upstream_mint_conformance(self):
        path = Path(__file__).resolve().parents[1] / "vendor/open-law-id/conformance/conformance.json"
        cases = json.loads(path.read_text(encoding="utf8"))
        for item in cases["mint"]:
            with self.subTest(item["name"]):
                if "error" in item:
                    with self.assertRaises(ValueError):
                        lawid.mint(**item["mint"])
                else:
                    self.assertEqual(lawid.mint(**item["mint"]), item["expect"])
        for item in cases["refuse"]:
            with self.subTest(item["name"]), self.assertRaises(ValueError):
                lawid.mint(**item["mint"])
        for item in cases["parse"]:
            with self.subTest(item["name"]):
                self.assertEqual(lawid.validate(item["parse"]), item["valid"])

if __name__ == "__main__":
    unittest.main()
