import json
import os
import pathlib
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import land_publisher_code_v2 as L  # noqa: E402

CUR = {"basis": "publisher_statement", "statement": "Current through 2025", "through_date": "2025-12-31", "edition": "2025"}


def write_packet(root, parent_archive=None):
    manifest = {"schema_version": "publisher-code-manifest/2", "jurisdiction": "ZZ", "source_system": "zz-code",
                "parser": {"name": "zz-parser", "version": "1"}}
    unit = {"unit_key": "c1", "unit_kind": "chapter", "heading": None, "original_sha256": "a" * 64,
            "publisher_member": None, "raw_member_sha256": None, "text_sha256": "b" * 64, "text_code_points": 9,
            "sections_expected": 1, "currency": CUR, "source_url": "https://example.gov/c1",
            "retrieved_at": "2026-10-06T00:00:00Z", "retrieval_method": "publisher_page", "proxy": None}
    if parent_archive:
        unit["parent_archive_sha256"] = parent_archive
    section = {"unit_key": "c1", "citation_path": "1-2", "citation": "ZZ Code 1-2", "heading": None, "text": "Text \u00e9",
               "hierarchy": [{"level": "section", "number": "1-2", "heading": None}], "history": None,
               "status_note": None, "span": None, "currency": CUR}
    for name, row in (("manifest.json", manifest), ("units.jsonl", unit), ("sections.jsonl", section)):
        with open(os.path.join(root, name), "w", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")
    return manifest


class LanderTest(unittest.TestCase):
    def test_canonical_hash_is_sorted_and_compact(self):
        self.assertEqual(L.canon({"b": 1, "a": [None, True]}), '{"a":[null,true],"b":1}')

    def test_rows_bind_unit_original_and_gates(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = write_packet(root)
            units, sections = L.build_rows(root, "c" * 64, manifest)
        self.assertEqual(units[0]["native_id"], "ZZ:unit:c1")
        self.assertEqual(units[0]["provenance"]["source_as_of"], "2025-12-31")
        self.assertNotIn("parent_archive_sha256", units[0]["data"])
        data = sections[0]["data"]
        self.assertEqual((data["text_code_points"], data["unit_id"]), (6, "ZZ:unit:c1"))
        self.assertFalse(data["public_projection_allowed"] or data["calculation_activation_allowed"])
        self.assertEqual(sections[0]["provenance"]["record_sha256"], L.sha(data))

    def test_zip_member_unit_keeps_parent_archive_hash(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = write_packet(root, parent_archive="d" * 64)
            units, _ = L.build_rows(root, "c" * 64, manifest)
        self.assertEqual(units[0]["data"]["parent_archive_sha256"], "d" * 64)

    def test_batches_respect_row_cap_and_run_ids_are_deterministic(self):
        sizes = [len(b) for b in L.batches([{"i": i} for i in range(1201)])]
        self.assertEqual(sizes, [500, 500, 201])
        a = str(uuid.uuid5(L.NS, "ZZ:" + "c" * 64))
        self.assertEqual(a, str(uuid.uuid5(L.NS, "ZZ:" + "c" * 64)))

    def test_preflight_requires_http_status_text_and_toc_proof(self):
        with tempfile.TemporaryDirectory() as root:
            text = "Text é"
            deriv = os.path.join(root, "unit.txt")
            with open(deriv, "w", encoding="utf-8") as handle:
                handle.write(text)
            digest = L.sha(text.encode("utf-8"))
            original = "a" * 64
            objects = [
                {"sha256": original, "bytes": 4, "kind": "publisher_original", "path": deriv,
                 "sources": [{"source_url": "https://example.gov/c1", "retrieved_at": "2026-10-06T00:00:00Z",
                              "retrieval_method": "publisher_page", "proxy": None}]},
                {"sha256": digest, "bytes": len(text.encode("utf-8")), "kind": "unit_text_derivative", "path": deriv,
                 "sources": [{"source_url": "https://example.gov/c1", "retrieved_at": "2026-10-06T00:00:00Z",
                              "http_status": 200, "retrieval_method": "publisher_page", "proxy": None}]},
            ]
            with open(os.path.join(root, "objects.jsonl"), "w", encoding="utf-8") as handle:
                for row in objects:
                    handle.write(json.dumps(row) + "\n")
            write_packet(root)
            with open(os.path.join(root, "units.jsonl"), encoding="utf-8") as handle:
                unit = json.loads(handle.read())
            unit["text_sha256"] = digest
            unit["text_code_points"] = len(text)
            with open(os.path.join(root, "units.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(json.dumps(unit) + "\n")
            with self.assertRaisesRegex(RuntimeError, "http_status"):
                L.preflight_packet(root)
            objects[0]["sources"][0]["http_status"] = 200
            with open(os.path.join(root, "objects.jsonl"), "w", encoding="utf-8") as handle:
                for row in objects:
                    handle.write(json.dumps(row) + "\n")
            with self.assertRaisesRegex(RuntimeError, "toc-proof"):
                L.preflight_packet(root)
            proof = {"marker": "section id", "pages": [{"url": "https://example.gov/c1", "markers": 1, "sections": 1}],
                     "unfetched_child_pages": ["https://example.gov/c1/sc01"]}
            with open(os.path.join(root, "toc-proof.json"), "w", encoding="utf-8") as handle:
                json.dump(proof, handle)
            with self.assertRaisesRegex(RuntimeError, "unfetched"):
                L.preflight_packet(root)
            proof["unfetched_child_pages"] = []
            proof["pages"][0]["markers"] = 0
            with open(os.path.join(root, "toc-proof.json"), "w", encoding="utf-8") as handle:
                json.dump(proof, handle)
            with self.assertRaisesRegex(RuntimeError, "mismatch"):
                L.preflight_packet(root)
            proof["pages"][0]["markers"] = 1
            with open(os.path.join(root, "toc-proof.json"), "w", encoding="utf-8") as handle:
                json.dump(proof, handle)
            self.assertEqual(L.preflight_packet(root)["toc_pages"], 1)

    def test_multicode_flag_uses_the_v3_register_open_and_finish_and_never_a_review(self):
        calls = []

        class FakeCloud:
            def rpc(self, name, args):
                calls.append(name)
                if name.startswith("corpus_publisher_code_register_manifest"):
                    return {"manifest_sha256": args["p_manifest"]["_sha"]}
                return {"ok": True, "matched": len(args.get("p_rows", [])), "verified": True}

        with tempfile.TemporaryDirectory() as root:
            text = "Text"
            deriv = os.path.join(root, "unit.txt")
            with open(deriv, "w", encoding="utf-8") as handle:
                handle.write(text)
            digest = L.sha(text.encode("utf-8"))
            src = [{"source_url": "https://example.gov/c1", "retrieved_at": "2026-10-06T00:00:00Z", "http_status": 200,
                    "retrieval_method": "publisher_page", "proxy": None}]
            with open(os.path.join(root, "objects.jsonl"), "w", encoding="utf-8") as handle:
                for row in ({"sha256": "a" * 64, "bytes": 4, "kind": "publisher_original", "path": deriv, "sources": src},
                            {"sha256": digest, "bytes": 4, "kind": "unit_text_derivative", "path": deriv, "sources": src}):
                    handle.write(json.dumps(row) + "\n")
            manifest = write_packet(root)
            with open(os.path.join(root, "units.jsonl"), encoding="utf-8") as handle:
                unit = json.loads(handle.read())
            unit["text_sha256"], unit["text_code_points"] = digest, len(text)
            with open(os.path.join(root, "units.jsonl"), "w", encoding="utf-8") as handle:
                handle.write(json.dumps(unit) + "\n")
            with open(os.path.join(root, "toc-proof.json"), "w", encoding="utf-8") as handle:
                json.dump({"marker": "x", "pages": [{"url": "https://example.gov/c1", "markers": 1, "sections": 1}],
                           "unfetched_child_pages": []}, handle)
            manifest["_sha"] = L.sha(manifest)
            with open(os.path.join(root, "manifest.json"), "w", encoding="utf-8") as handle:
                json.dump(manifest, handle)
            for flag, suffix in (([], "_v2"), (["--multicode"], "_v3")):
                calls.clear()
                saved = (L.Cloud, L.put_object, sys.argv)
                try:
                    L.Cloud = FakeCloud
                    L.put_object = lambda cloud, o: {"bytes": o["bytes"]}
                    sys.argv = ["land", root, "--execute"] + flag
                    with self.assertRaises(AssertionError):
                        L.main()
                finally:
                    L.Cloud, L.put_object, sys.argv = saved
                self.assertEqual(calls[0], "corpus_publisher_code_register_manifest" + suffix)

    def test_sb_key_uses_apikey_header_only(self):
        os.environ["EXTERNAL_SUPABASE_URL"] = "https://x.supabase.co"
        os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_test"
        self.assertEqual(L.Cloud().h, {"apikey": "sb_secret_test"})
        os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"] = "eyJ.jwt.key"
        self.assertIn("Authorization", L.Cloud().h)

    def test_large_objects_use_resumable_path(self):
        calls = []

        class Resp:
            def __init__(self, status, headers=None):
                self.status_code, self.headers, self.text = status, headers or {}, ""

        class Session:
            def post(self, url, **kw):
                calls.append(("POST", url, kw["headers"]["Upload-Length"]))
                return Resp(201, {"Location": url + "/abc"})

            def patch(self, url, data, **kw):
                calls.append(("PATCH", len(data), kw["headers"]["Upload-Offset"]))
                return Resp(204, {"Upload-Offset": str(int(kw["headers"]["Upload-Offset"]) + len(data))})

        cloud = L.Cloud.__new__(L.Cloud)
        cloud.url, cloud.h, cloud.s = "https://x.supabase.co", {"apikey": "k"}, Session()
        with tempfile.NamedTemporaryFile() as handle:
            handle.write(b"x" * (L.TUS_CHUNK + 10))
            handle.flush()
            status, _ = L.tus_upload(cloud, "state-codes/sha256/aa/aa", handle.name, "application/pdf")
        self.assertEqual(status, 201)
        self.assertEqual([c[0] for c in calls], ["POST", "PATCH", "PATCH"])
        self.assertEqual(calls[2][2], str(L.TUS_CHUNK))


if __name__ == "__main__":
    unittest.main()
