import hashlib
import importlib.util
import json
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).with_name("tx-build-browsable-candidate.py")
spec = importlib.util.spec_from_file_location("tx_browse_candidate", SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sample_context():
    text = "Preamble 🏛\nSec. 1. FIRST. First body.\nSec. 1. SECOND. Second body."
    source_sha = "a" * 64
    raw_sha = "b" * 64
    text_sha = sha(text.encode("utf-8"))
    archive = {
        "kind": "publisher_archive",
        "bytes": 777,
        "source_references": [
            {
                "code": "CP",
                "source_url": "https://tcss.legis.texas.gov/resources/Zips/CP.htm.zip",
                "sha256": source_sha,
                "bytes": 777,
                "retrieved_at": "2026-10-05T15:00:00Z",
                "http_status": 200,
                "publication_allowed": False,
            }
        ],
    }
    text_asset = {
        "kind": "chapter_text_derivative",
        "bytes": len(text.encode("utf-8")),
        "source_references": [
            {
                "chapter_identity": "CP:cp.16.htm",
                "archive_sha256": source_sha,
                "raw_member_sha256": raw_sha,
                "parser": builder.PARSER,
            }
        ],
    }
    assets = {source_sha: archive, text_sha: text_asset}
    chapter_data = {
        "jurisdiction": "TX",
        "code": "CP",
        "code_name": "Civil Practice and Remedies Code",
        "publisher_member": "cp.16.htm",
        "identity_kind": "publisher_code_and_member_filename",
        "publisher_native_entity": False,
        "public_projection_allowed": False,
        "current_law_verified": False,
        "calculation_activation_allowed": False,
        "archive_sha256": source_sha,
        "raw_member_sha256": raw_sha,
        "text_sha256": text_sha,
        "text_bytes": len(text.encode("utf-8")),
    }
    chapter = {
        "schema_version": "publisher-code-evidence/1",
        "source_system": builder.SOURCE_SYSTEM,
        "entity_type": "code-chapter-document",
        "native_id": "CP:cp.16.htm",
        "data": chapter_data,
        "provenance": {
            "parser": builder.PARSER,
            "record_hash_codec": "canonical-integer-jsonb/1",
            "record_sha256": builder.packet.sha(builder.packet.canonical(chapter_data)),
            "source_url": "https://tcss.legis.texas.gov/resources/Zips/CP.htm.zip",
            "source_sha256": source_sha,
            "publisher_member": "cp.16.htm",
            "raw_member_sha256": raw_sha,
            "retrieved_at": "2026-10-05T15:00:00Z",
            "source_as_of": None,
        },
    }
    chapter_context = {chapter["native_id"]: {"native_id": chapter["native_id"], "data": chapter_data, "text": text}}
    return text, assets, chapter, chapter_context


def section_row(text, chapter, *, occurrence, start, end):
    excerpt_sha = sha(text[start:end].encode("utf-8"))
    data = {
        "jurisdiction": "TX",
        "code": "CP",
        "publisher_native_entity": False,
        "public_projection_allowed": False,
        "current_law_verified": False,
        "calculation_activation_allowed": False,
        "identity_kind": "publisher_member_anchor_occurrence",
        "chapter_identity": chapter["native_id"],
        "native_citation_key": "CP:16.001",
        "native_section_anchor": "16.001",
        "occurrence": occurrence,
        "citation_heading": f"Sec. 16.001. Occurrence {occurrence}.",
        "publisher_section_url": "https://statutes.capitol.texas.gov/Docs/CP/htm/cp.16.htm#16.001",
        "identity_evidence": "publisher_heading_link",
        "anchor_whitespace_anomaly": False,
        "publisher_filename_legacy_hint": False,
        "hierarchy": {"CHAPTER": "CHAPTER 16. LIMITATIONS"},
        "text_sha256": excerpt_sha,
        "text_derivative_sha256": chapter["data"]["text_sha256"],
        "text_span": {"unit": "unicode_code_points", "start": start, "end": end},
        "archive_sha256": chapter["data"]["archive_sha256"],
    }
    return {
        "schema_version": "publisher-code-evidence/1",
        "source_system": builder.SOURCE_SYSTEM,
        "entity_type": "code-section-occurrence",
        "native_id": f"{chapter['native_id']}:16.001:{occurrence}",
        "data": data,
        "provenance": {
            "parser": builder.PARSER,
            "record_hash_codec": "canonical-integer-jsonb/1",
            "record_sha256": builder.packet.sha(builder.packet.canonical(data)),
            "source_url": chapter["provenance"]["source_url"],
            "source_sha256": chapter["provenance"]["source_sha256"],
            "publisher_member": chapter["provenance"]["publisher_member"],
            "raw_member_sha256": chapter["provenance"]["raw_member_sha256"],
            "retrieved_at": chapter["provenance"]["retrieved_at"],
            "source_as_of": None,
        },
    }


class TexasBrowsableCandidateTest(unittest.TestCase):
    def test_spans_use_unicode_codepoints_and_are_hash_pinned(self):
        text, _, chapter, _ = sample_context()
        start = text.index("Sec. 1.")
        end = text.index("\n", start)
        excerpt = builder.section_text(text, {"unit": "unicode_code_points", "start": start, "end": end}, sha(text[start:end].encode("utf-8")))
        self.assertEqual(excerpt, "Sec. 1. FIRST. First body.")
        with self.assertRaisesRegex(ValueError, "text hash mismatch"):
            builder.section_text(text, {"unit": "unicode_code_points", "start": start, "end": end}, "0" * 64)
        with self.assertRaisesRegex(ValueError, "outside"):
            builder.section_text(text, {"unit": "unicode_code_points", "start": 0, "end": len(text) + 1}, "0" * 64)

    def test_repeated_native_anchor_occurrences_remain_distinct(self):
        text, assets, chapter, chapters = sample_context()
        first_start = text.index("Sec. 1. FIRST.")
        first_end = text.index("\n", first_start)
        second_start = text.index("Sec. 1. SECOND.")
        first = section_row(text, chapter, occurrence=1, start=first_start, end=first_end)
        second = section_row(text, chapter, occurrence=2, start=second_start, end=len(text))
        a = builder.browse_record(first, asset_by_sha=assets, chapters=chapters)
        b = builder.browse_record(second, asset_by_sha=assets, chapters=chapters)
        self.assertEqual(a["citation"], b["citation"])
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual((a["occurrence"], b["occurrence"]), (1, 2))
        self.assertEqual(a["text_asset_sha256"], b["text_asset_sha256"])
        self.assertEqual(a["text_span"]["unit"], "unicode_code_points")

    def test_exact_archive_identity_and_false_legal_gates_are_required(self):
        text, assets, chapter, chapters = sample_context()
        projected = builder.browse_record(chapter, asset_by_sha=assets, chapters=chapters)
        self.assertEqual(projected["id"], "CP:cp.16.htm")
        self.assertEqual(projected["source_url"], chapter["provenance"]["source_url"])
        self.assertFalse(projected["source_data"]["public_projection_allowed"])
        self.assertFalse(projected["source_data"]["current_law_verified"])
        self.assertFalse(projected["source_data"]["calculation_activation_allowed"])
        changed = json.loads(json.dumps(chapter))
        changed["provenance"]["source_url"] = "https://example.test/CP.zip"
        with self.assertRaisesRegex(ValueError, "URL does not match"):
            builder.checked_source_asset(changed, assets)
        changed = json.loads(json.dumps(chapter))
        changed["data"]["public_projection_allowed"] = True
        changed["provenance"]["record_sha256"] = builder.packet.sha(builder.packet.canonical(changed["data"]))
        with self.assertRaisesRegex(ValueError, "legal gate changed"):
            builder.browse_record(changed, asset_by_sha=assets, chapters=chapters)

    def test_section_parent_version_and_occurrence_identity_are_pinned(self):
        text, assets, chapter, chapters = sample_context()
        start = text.index("Sec. 1. FIRST.")
        end = text.index("\n", start)
        section = section_row(text, chapter, occurrence=1, start=start, end=end)
        changed = json.loads(json.dumps(section))
        changed["data"]["text_derivative_sha256"] = "0" * 64
        changed["provenance"]["record_sha256"] = builder.packet.sha(builder.packet.canonical(changed["data"]))
        with self.assertRaisesRegex(ValueError, "identity, version, or parent"):
            builder.browse_record(changed, asset_by_sha=assets, chapters=chapters)
        changed = json.loads(json.dumps(section))
        changed["data"]["publisher_section_url"] = "https://example.test/not-the-publisher"
        changed["provenance"]["record_sha256"] = builder.packet.sha(builder.packet.canonical(changed["data"]))
        with self.assertRaisesRegex(ValueError, "source URL does not match"):
            builder.browse_record(changed, asset_by_sha=assets, chapters=chapters)
        changed = json.loads(json.dumps(section))
        changed["native_id"] = changed["native_id"].rsplit(":", 1)[0] + ":9"
        with self.assertRaisesRegex(ValueError, "identity, version, or parent"):
            builder.browse_record(changed, asset_by_sha=assets, chapters=chapters)

    def test_manifest_and_assets_sha_pins_fail_closed(self):
        manifest = b'{"scope":"pinned"}'
        assets = b'[]'
        builder.verify_pins(manifest, assets, sha(manifest), sha(assets))
        with self.assertRaisesRegex(ValueError, "manifest SHA"):
            builder.verify_pins(manifest, assets, "0" * 64, sha(assets))
        with self.assertRaisesRegex(ValueError, "assets SHA"):
            builder.verify_pins(manifest, assets, sha(manifest), "0" * 64)

    def test_section_hierarchy_pages_stay_bounded_and_ordered(self):
        rows = [{"id": f"CP:chapter:16.00{i}:1", "title": "Section " + str(i) + " x" * 80} for i in range(1, 9)]
        pages = builder.partition_sections("CP:chapter", "c" * 64, rows, max_bytes=500)
        self.assertGreater(len(pages), 1)
        self.assertEqual([row for page in pages for row in page], rows)
        for page in pages:
            wrapper = {
                "schema_version": builder.SCHEMA,
                "chapter_identity": "CP:chapter",
                "text_asset_sha256": "c" * 64,
                "sections": page,
            }
            self.assertLessEqual(len(builder.compact_json(wrapper)), 500)


if __name__ == "__main__":
    unittest.main()
