import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("tx-build-browse-release.py")
spec = importlib.util.spec_from_file_location("tx_browse_release", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def raw(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha(value):
    return hashlib.sha256(value).hexdigest()


class BrowseReleaseTests(unittest.TestCase):
    def make_candidate(self, base: pathlib.Path):
        candidate = base / "candidate"
        candidate.mkdir(parents=True)
        text_path = base / "parsed" / "chapter.txt"
        text_path.parent.mkdir(parents=True)
        text = "§ 3.10. A😀B\n§ 3.10. A😀B\n"
        text_bytes = text.encode("utf-8")
        text_path.write_bytes(text_bytes)
        text_sha = sha(text_bytes)
        coverage_claim = {"artifacts": {"parsedSummary": {"value": {"currency": module.PUBLISHER_COVERAGE_CLAIM}}}}
        audit_path = base / "independent-audit.json"
        audit_raw = raw(coverage_claim)
        audit_path.write_bytes(audit_raw)
        module.EDITION_AUDIT_SHA256 = sha(audit_raw)
        chapter_id = "AG:AG.1.htm"
        section_rows = [
            {"id": f"{chapter_id}:3.10:1", "title": "§ 3.10. A😀B", "citation": "AG:3.10", "occurrence": 1,
             "hierarchy": {}, "text_span": {"start": 0, "end": 12, "unit": "unicode_code_points"},
             "text_sha256": "1" * 64, "source_url": "https://statutes.capitol.texas.gov/Docs/AG/htm/AG.1.htm#3.10",
             "captured_at": "2026-10-05T12:00:00Z", "payload_sha256": "2" * 64},
            {"id": f"{chapter_id}:3.10:2", "title": "§ 3.10. A😀B", "citation": "AG:3.10", "occurrence": 2,
             "hierarchy": {}, "text_span": {"start": 13, "end": 25, "unit": "unicode_code_points"},
             "text_sha256": "3" * 64, "source_url": "https://statutes.capitol.texas.gov/Docs/AG/htm/AG.1.htm#3.10",
             "captured_at": "2026-10-05T12:00:00Z", "payload_sha256": "4" * 64},
        ]
        files = {
            "codes.json": {"schema_version": module.SOURCE_SCHEMA, "codes": [
                {"code": "AG", "code_name": "Agriculture Code", "chapter_count": 1, "section_count": 2,
                 "index_path": "hierarchy/codes/AG.json"}]},
            "hierarchy/codes/AG.json": {"code": "AG", "chapters": [
                {"id": chapter_id, "index_path": "hierarchy/chapters/chapter.json"}]},
            "hierarchy/chapters/chapter.json": {"id": chapter_id, "title": "Agriculture Code", "publisher_member": "AG.1.htm",
                "captured_at": "2026-10-05T12:00:00Z", "source_url": "https://tcss.legis.texas.gov/resources/Zips/AG.htm.zip",
                "text_asset_sha256": text_sha,
                "section_count": 2, "section_shards": [{"path": "hierarchy/sections/chapter.json", "sections": 2}]},
            "hierarchy/sections/chapter.json": {"chapter_identity": chapter_id, "text_asset_sha256": text_sha,
                "sections": section_rows},
        }
        inventory = []
        for rel, value in files.items():
            path = candidate / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            content = raw(value)
            path.write_bytes(content)
            inventory.append({"path": rel, "bytes": len(content), "sha256": sha(content)})
        hierarchy_bytes = b"".join(raw(item) + b"\n" for item in sorted(inventory, key=lambda item: item["path"]))
        (candidate / "hierarchy-assets.jsonl").write_bytes(hierarchy_bytes)
        recs = [
            {"entity_type": "code-chapter-document", "id": chapter_id,
             "source_data": {"publisher_filename_legacy_hint": True}},
            {"entity_type": "code-section-occurrence", "id": section_rows[0]["id"]},
            {"entity_type": "code-section-occurrence", "id": section_rows[1]["id"]},
        ]
        records_bytes = b"".join(raw(row) + b"\n" for row in recs)
        (candidate / "records.jsonl").write_bytes(records_bytes)
        text_assets_bytes = (raw({"sha256": text_sha, "bytes": len(text_bytes), "path": str(text_path)}) + b"\n")
        (candidate / "text-assets.jsonl").write_bytes(text_assets_bytes)
        (candidate / "hierarchy-assets.jsonl").write_bytes(hierarchy_bytes)
        (candidate / "codes.json").write_bytes(raw(files["codes.json"]))
        manifest = {
            "schema_version": module.SOURCE_SCHEMA, "jurisdiction": "TX", "code_count": 1,
            "chapter_text_assets": 1, "record_counts": {"code-chapter-document": 1, "code-section-occurrence": 2},
            "codes_index_sha256": sha((candidate / "codes.json").read_bytes()),
            "record_index_sha256": sha(records_bytes), "text_asset_index_sha256": sha(text_assets_bytes),
            "hierarchy_asset_inventory_sha256": sha(hierarchy_bytes), "hierarchy_asset_count": len(inventory),
            "registered": False, "published": False, "ready": False, "current_law_verified": False,
            "calculation_activation_allowed": False,
        }
        (candidate / "manifest.json").write_bytes(raw(manifest))
        return candidate, chapter_id, text_sha

    def test_packs_stable_refs_and_preserves_occurrences_and_legacy_hint(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            candidate, chapter_id, text_sha = self.make_candidate(base)
            output = base / "release"
            manifest = module.build_release(candidate, output)
            self.assertFalse(manifest["chapter_text_assets_copied"])
            self.assertFalse(manifest["published"])
            assets = [json.loads(line) for line in (output / "assets.jsonl").read_bytes().splitlines()]
            self.assertTrue(all(item["file"].startswith("state-codes/tx/browse-v1/") for item in assets))
            self.assertFalse(any(".tx-browse-release-" in item["file"] for item in assets))
            code = json.loads((output / "state-codes/tx/browse-v1/codes/AG.json").read_bytes())
            chapter = code["chapters"][0]
            self.assertEqual(chapter["id"], chapter_id)
            self.assertTrue(chapter["legacy_filename_variant"])
            self.assertEqual(chapter["text"]["sha256"], text_sha)
            ref = chapter["section_shards"][0]
            shard = json.loads((output / ref["file"]).read_bytes())
            occurrences = [row for row in shard["sections"] if row["chapter_id"] == chapter_id]
            self.assertEqual([row["occurrence"] for row in occurrences], [1, 2])
            self.assertEqual([row["citation"] for row in occurrences], ["AG:3.10", "AG:3.10"])

    def test_changed_candidate_bytes_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            candidate, _, _ = self.make_candidate(base)
            with (candidate / "hierarchy/sections/chapter.json").open("ab") as stream:
                stream.write(b" ")
            with self.assertRaisesRegex(ValueError, "hierarchy inventory|hierarchy bytes/hash"):
                module.build_release(candidate, base / "release")

    def test_existing_output_and_invalid_source_gates_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            candidate, _, _ = self.make_candidate(base)
            output = base / "release"
            output.mkdir()
            with self.assertRaises(FileExistsError):
                module.build_release(candidate, output)
            output.rmdir()
            manifest_path = candidate / "manifest.json"
            manifest = json.loads(manifest_path.read_bytes())
            manifest["current_law_verified"] = True
            manifest_path.write_bytes(raw(manifest))
            with self.assertRaisesRegex(ValueError, "gate unexpectedly changed"):
                module.build_release(candidate, output)


if __name__ == "__main__":
    unittest.main()
