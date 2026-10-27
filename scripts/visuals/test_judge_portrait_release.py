"""Offline tests for the judge portrait release packet (synthetic index, no network, no database).

cd scripts/visuals && python3 -B -m unittest -v test_judge_portrait_release
"""
import copy
import hashlib
import io
import json
import unittest

import judge_portrait_release as jpr

INDEX = [
    {"path": "kearney-mark-1963", "person": 1719, "license": "Work of Federal Government", "hash": "a" * 64,
     "source": "https://en.wikipedia.org/wiki/File:Judge_Kearney.jpg", "artist": None, "date_created": None},
    {"path": "moore-roy-1947", "person": 3649, "license": None, "hash": "b" * 64, "source": "Alabama Court Website",
     "artist": None, "date_created": None},
    {"path": "group-ohio-2015-06-19", "person": 0, "license": None, "hash": "c" * 64, "source": "Ohio court website"},
]
J1, J2 = "f0097aac0d7ac2f2a0b554349755b7c6", "ac559d72dd70225915e4518026aa2d6f"
CANDIDATES = {"release": [
    {"judge_id": J1, "name": "Mark A. Kearney", "person": 1719, "path": "kearney-mark-1963", "basis": "fjc_id",
     "evidence": "FJC id 3572 on both sides", "pre_item_md5": "1" * 32, "pre_detail_md5": "2" * 32},
    {"judge_id": J2, "name": "Roy S. Moore", "person": 3649, "path": "moore-roy-1947",
     "basis": "crosswalk:exact_name_same_state", "evidence": "only record with this name", "pre_item_md5": "3" * 32,
     "pre_detail_md5": "4" * 32},
]}


class RouteTests(unittest.TestCase):
    def test_route_matches_the_stored_scheme(self):
        # corpus_artifacts has kearney-mark-1963.jpeg at this route (read 2026-10-27).
        self.assertEqual(jpr.route_for("kearney-mark-1963"), "/supplement-files/judge_portraits/portrait-d2f6061cef6c3ca62921")
        self.assertEqual(jpr.route_for("owen-priscilla-1954-10-04"), "/supplement-files/judge_portraits/portrait-e76b9821f954a1f31d4f")

    def test_object_key_is_content_addressed(self):
        self.assertEqual(jpr.object_key("ab" + "0" * 62), "ab/ab" + "0" * 62)


class CreditTests(unittest.TestCase):
    def test_federal_credit_matches_existing_wording(self):
        self.assertEqual(jpr.credit("Work of Federal Government"),
                         "Portrait: Free Law Project judicial portrait collection; recorded as a work of federal government.")

    def test_unrecorded_licence_is_said_plainly(self):
        self.assertIn("licence not recorded", jpr.credit(None))

    def test_unknown_licence_string_is_refused(self):
        with self.assertRaises(ValueError):
            jpr.credit("CC BY-NC 4.0")

    def test_source_url_and_label(self):
        self.assertEqual(jpr.source_fields("https://example.gov/x")["photo_source"], "https://example.gov/x")
        self.assertEqual(jpr.source_fields("Alabama Court Website"),
                         {"photo_source": None, "photo_source_label": "Alabama Court Website"})
        self.assertEqual(jpr.source_fields(None)["photo_source_label"], "Not recorded")


class PlanTests(unittest.TestCase):
    def test_plan_rows(self):
        rows = jpr.plan(INDEX, CANDIDATES)
        self.assertEqual([r["judge_id"] for r in rows], [J1, J2])
        self.assertTrue(rows[0]["stored"])
        self.assertFalse(rows[1]["stored"])
        self.assertIsNone(rows[1]["licence"])
        self.assertEqual(rows[1]["photo_source_label"], "Alabama Court Website")

    def test_person_mismatch_is_refused(self):
        bad = copy.deepcopy(CANDIDATES)
        bad["release"][1]["person"] = 9999
        with self.assertRaises(ValueError):
            jpr.plan(INDEX, bad)

    def test_group_photo_person_zero_is_refused(self):
        bad = {"release": [{"judge_id": J2, "name": "x", "person": 0, "path": "group-ohio-2015-06-19",
                            "basis": "crosswalk:exact_name_same_state", "evidence": "x"}]}
        with self.assertRaises(ValueError):
            jpr.plan(INDEX, bad)

    def test_name_only_basis_is_refused(self):
        bad = copy.deepcopy(CANDIDATES)
        bad["release"][1]["basis"] = "crosswalk:compatible_name_same_court"
        with self.assertRaises(ValueError):
            jpr.plan(INDEX, bad)

    def test_duplicate_judge_is_refused(self):
        bad = copy.deepcopy(CANDIDATES)
        bad["release"][1]["judge_id"] = J1
        with self.assertRaises(ValueError):
            jpr.plan(INDEX, bad)


class SqlTests(unittest.TestCase):
    def manifest(self):
        rows = jpr.plan(INDEX, CANDIDATES)
        for r in rows:
            r["fetched_sha256"] = "f" * 64
            r["derived_sha256"] = jpr.STORED.get(r["path"], {}).get("sha256", "e" * 64)
            r["derived_bytes"] = 1234
        return {"rows": rows, "sha256": "0" * 64, "legacy_catalog_row": json.dumps({"id": "judge_portraits"})}

    def test_apply_only_fills_empty_photos_and_inserts_new_files(self):
        apply, rollback = jpr.render_sql(self.manifest())
        self.assertEqual(apply.count("insert into public.corpus_artifacts"), 1)
        self.assertIn("'moore-roy-1947.jpeg'", apply)
        self.assertNotIn("'kearney-mark-1963.jpeg'", apply)  # already stored: reused, not re-inserted
        self.assertEqual(apply.count("coalesce(item->>'photo_url', '') = ''"), 2)
        self.assertIn("begin;", apply)
        self.assertTrue(apply.rstrip().endswith("commit;"))
        self.assertIn("imported_records = 0", apply)

    def test_rollback_restores_pre_state_and_catalog_row(self):
        _, rollback = jpr.render_sql(self.manifest())
        self.assertIn("'{\"photo_url\": \"\", \"photo_provenance\": null}'::jsonb", rollback)
        self.assertIn("delete from public.corpus_artifacts", rollback)
        self.assertIn("jsonb_populate_record(null::public.corpus_datasets", rollback)
        self.assertIn("'" + "1" * 32 + "'", rollback)

    def test_quotes_are_escaped(self):
        self.assertEqual(jpr.sql_text("O'Neill"), "'O''Neill'")
        self.assertEqual(jpr.sql_json({"a": "O'Neill"}), "'{\"a\": \"O''Neill\"}'::jsonb")


class DeriveTests(unittest.TestCase):
    def test_derive_bounds_and_format(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        buf = io.BytesIO()
        Image.new("RGB", (600, 900), (120, 90, 60)).save(buf, "JPEG")
        derived, size, original = jpr.derive(buf.getvalue())
        self.assertEqual(original, (600, 900))
        self.assertLessEqual(size[0], 224)
        self.assertLessEqual(size[1], 288)
        self.assertEqual(Image.open(io.BytesIO(derived)).format, "JPEG")
        self.assertEqual(len(hashlib.sha256(derived).hexdigest()), 64)

    def test_non_jpeg_is_refused(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        buf = io.BytesIO()
        Image.new("RGB", (100, 100)).save(buf, "PNG")
        with self.assertRaises(ValueError):
            jpr.derive(buf.getvalue())


if __name__ == "__main__":
    unittest.main()
