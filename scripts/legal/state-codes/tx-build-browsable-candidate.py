"""Build a private, browse-shaped derivative of the frozen Texas v3 intake packet.

This does not publish records, alter packet evidence, certify current law, or enable
calculator use. Chapter text stays in hash-named files; section rows keep exact
Unicode-code-point spans into those files rather than duplicating chapter text.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
from collections import Counter
from typing import Any

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tx_packet_helpers", SCRIPT_DIR / "tx-prepare-packet.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Texas packet helper could not be loaded")
packet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packet)

SOURCE_SYSTEM = "texas-legislature-code"
DATASET_ID = "texas_code"
PARSER = "texas-publisher-html/5"
SCHEMA = "texas-code-browsable-candidate/1"
EXPECTED_MANIFEST_SHA256 = "87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da"
EXPECTED_ASSETS_SHA256 = "e6344040af3af086b121f55ffa03d2d7622d0d9f3323d3178f3a95121c044198"
EXPECTED_COUNTS = {"code-chapter-document": 4993, "code-section-occurrence": 121902}
MAX_HIERARCHY_FILE_BYTES = 900_000


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_bytes())


def checked_source_asset(
    record: dict[str, Any],
    asset_by_sha: dict[str, dict[str, Any]],
    *,
    require_texas_source: bool = True,
) -> dict[str, Any]:
    """Resolve the exact archive source reference for one intake row."""
    data = record.get("data")
    provenance = record.get("provenance")
    if not isinstance(data, dict) or not isinstance(provenance, dict):
        raise ValueError("Source record data and provenance are required")
    code = data.get("code")
    source_url = provenance.get("source_url")
    source_sha = provenance.get("source_sha256")
    if not isinstance(code, str) or not isinstance(source_sha, str):
        raise ValueError("Texas code and source digest are required")
    expected_url = f"https://tcss.legis.texas.gov/resources/Zips/{code}.htm.zip"
    if require_texas_source and source_url != expected_url:
        raise ValueError("Publisher archive URL does not match the exact code")
    asset = asset_by_sha.get(source_sha)
    if not asset or asset.get("kind") != "publisher_archive":
        raise ValueError("Exact publisher archive asset is absent")
    references = asset.get("source_references")
    if not isinstance(references, list) or not any(
        ref.get("code") == code
        and ref.get("source_url") == source_url
        and ref.get("sha256") == source_sha
        and ref.get("bytes") == asset.get("bytes")
        and ref.get("retrieved_at") == provenance.get("retrieved_at")
        and ref.get("http_status") == 200
        and ref.get("publication_allowed") is False
        for ref in references
        if isinstance(ref, dict)
    ):
        raise ValueError("Publisher receipt does not pin this source record")
    return asset


def section_text(text: str, span: Any, expected_sha256: str) -> str:
    """Slice using Python Unicode code points, matching the parser's span unit."""
    if not isinstance(span, dict) or span.get("unit") != "unicode_code_points":
        raise ValueError("Section span must use unicode_code_points")
    start, end = span.get("start"), span.get("end")
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        raise ValueError("Section span is outside the chapter text")
    excerpt = text[start:end]
    if sha(excerpt.encode("utf-8")) != expected_sha256:
        raise ValueError("Section span text hash mismatch")
    return excerpt


def browse_record(
    record: dict[str, Any],
    *,
    asset_by_sha: dict[str, dict[str, Any]],
    chapters: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Map one immutable intake occurrence to a compact browse index row."""
    data = record.get("data")
    provenance = record.get("provenance")
    if not isinstance(data, dict) or not isinstance(provenance, dict):
        raise ValueError("Source record is incomplete")
    if (
        record.get("schema_version") != "publisher-code-evidence/1"
        or record.get("source_system") != SOURCE_SYSTEM
        or data.get("jurisdiction") != "TX"
        or data.get("publisher_native_entity") is not False
        or data.get("public_projection_allowed") is not False
        or data.get("current_law_verified") is not False
        or data.get("calculation_activation_allowed") is not False
        or provenance.get("parser") != PARSER
        or provenance.get("record_hash_codec") != "canonical-integer-jsonb/1"
        or packet.sha(packet.canonical(data)) != provenance.get("record_sha256")
    ):
        raise ValueError("Evidence row identity, version, or legal gate changed")
    checked_source_asset(record, asset_by_sha)
    entity_type = record.get("entity_type")
    native_id = record.get("native_id")
    if not isinstance(native_id, str) or not native_id or len(native_id) > 512:
        raise ValueError("Exact publisher native ID required")

    if entity_type == "code-chapter-document":
        if (
            native_id != f"{data.get('code')}:{data.get('publisher_member')}"
            or data.get("identity_kind") != "publisher_code_and_member_filename"
            or data.get("text_sha256") not in asset_by_sha
            or asset_by_sha[data["text_sha256"]].get("kind") != "chapter_text_derivative"
            or asset_by_sha[data["text_sha256"]].get("bytes") != data.get("text_bytes")
        ):
            raise ValueError("Chapter native identity or text asset mismatch")
        title = data.get("code_name") or native_id
        subtitle = data.get("publisher_member")
        text_asset_sha256 = data["text_sha256"]
        span = None
        text_sha256 = data["text_sha256"]
        chapter_identity = native_id
        occurrence = None
        citation = None
        hierarchy = None
        publisher_url = provenance["source_url"]
    elif entity_type == "code-section-occurrence":
        chapter_identity = data.get("chapter_identity")
        chapter = chapters.get(chapter_identity)
        if not chapter:
            raise ValueError("Section references an absent exact chapter identity")
        chapter_data = chapter["data"]
        text_asset_sha256 = data.get("text_derivative_sha256")
        if (
            text_asset_sha256 != chapter_data.get("text_sha256")
            or provenance.get("source_sha256") != chapter_data.get("archive_sha256")
            or provenance.get("raw_member_sha256") != chapter_data.get("raw_member_sha256")
            or data.get("chapter_identity") != chapter["native_id"]
            or data.get("code") != chapter_data.get("code")
            or data.get("text_span", {}).get("unit") != "unicode_code_points"
            or native_id
            != f"{chapter_identity}:{data.get('native_section_anchor')}:{data.get('occurrence')}"
            or type(data.get("occurrence")) is not int
            or data["occurrence"] < 1
            or data.get("native_citation_key")
            != f"{data.get('code')}:{data.get('native_section_anchor')}"
        ):
            raise ValueError("Section identity, version, or parent span mismatch")
        section_text(chapter["text"], data["text_span"], data.get("text_sha256", ""))
        title = data.get("citation_heading") or native_id
        subtitle = f"{chapter_data.get('code_name') or data.get('code')} · {chapter_data.get('publisher_member')}"
        span = data["text_span"]
        text_sha256 = data["text_sha256"]
        occurrence = data["occurrence"]
        citation = data.get("native_citation_key")
        hierarchy = data.get("hierarchy")
        publisher_url = data.get("publisher_section_url") or provenance["source_url"]
        if data.get("publisher_section_url") is not None:
            expected_section_url = (
                "https://statutes.capitol.texas.gov/Docs/"
                f"{data.get('code')}/htm/{chapter_data.get('publisher_member')}"
                f"#{data.get('native_section_anchor')}"
            )
            if not isinstance(data.get("publisher_section_url"), str) or data["publisher_section_url"].casefold() != expected_section_url.casefold():
                raise ValueError("Section source URL does not match its exact publisher identity")
    else:
        raise ValueError("Unexpected publisher entity type")

    return {
        "schema_version": SCHEMA,
        "dataset": DATASET_ID,
        "id": native_id,
        "title": title,
        "subtitle": subtitle,
        "jurisdiction": "TX",
        "record_type": "chapter" if entity_type == "code-chapter-document" else "section",
        "entity_type": entity_type,
        "code": data.get("code"),
        "code_name": data.get("code_name") or (chapters.get(chapter_identity, {}).get("data", {}).get("code_name")),
        "publisher_member": provenance.get("publisher_member"),
        "chapter_identity": chapter_identity,
        "citation": citation,
        "occurrence": occurrence,
        "hierarchy": hierarchy,
        "source_url": publisher_url,
        "captured_at": provenance.get("retrieved_at"),
        "source_as_of": provenance.get("source_as_of"),
        "parser": provenance.get("parser"),
        "source_sha256": provenance.get("source_sha256"),
        "raw_member_sha256": provenance.get("raw_member_sha256"),
        "payload_sha256": provenance.get("record_sha256"),
        "text_asset_sha256": text_asset_sha256,
        "text_sha256": text_sha256,
        "text_span": span,
        "source_data": data,
        "source_provenance": provenance,
    }


def _within(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def verify_pins(manifest_bytes: bytes, assets_bytes: bytes, manifest_sha256: str, assets_sha256: str) -> None:
    if sha(manifest_bytes) != manifest_sha256:
        raise ValueError("Input manifest SHA-256 pin mismatch")
    if sha(assets_bytes) != assets_sha256:
        raise ValueError("Input assets SHA-256 pin mismatch")


def compact_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_hierarchy_file(
    path: pathlib.Path,
    value: Any,
    inventory: list[dict[str, Any]],
    candidate_root: pathlib.Path,
) -> None:
    raw = compact_json(value)
    if len(raw) > MAX_HIERARCHY_FILE_BYTES:
        raise ValueError(f"Hierarchy shard exceeds {MAX_HIERARCHY_FILE_BYTES} bytes")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    inventory.append({"path": path.relative_to(candidate_root).as_posix(), "bytes": len(raw), "sha256": sha(raw)})


def partition_sections(
    chapter_identity: str,
    text_asset_sha256: str,
    sections: list[dict[str, Any]],
    max_bytes: int = MAX_HIERARCHY_FILE_BYTES,
) -> list[list[dict[str, Any]]]:
    """Split a chapter's compact section index into bounded JSON pages."""
    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for section in sections:
        candidate = current + [section]
        wrapper = {
            "schema_version": SCHEMA,
            "chapter_identity": chapter_identity,
            "text_asset_sha256": text_asset_sha256,
            "sections": candidate,
        }
        if len(compact_json(wrapper)) > max_bytes:
            if not current:
                raise ValueError("One section index row exceeds shard limit")
            chunks.append(current)
            current = [section]
            if len(compact_json({**wrapper, "sections": current})) > max_bytes:
                raise ValueError("One section index row exceeds shard limit")
        else:
            current = candidate
    if current or not chunks:
        chunks.append(current)
    return chunks


def build_candidate(packet_dir: pathlib.Path, source_root: pathlib.Path, output_dir: pathlib.Path) -> dict[str, Any]:
    packet_dir = packet_dir.resolve()
    source_root = source_root.resolve()
    output_dir = output_dir.resolve()
    expected_root = pathlib.Path("private/audit-2026-10-05/full-state-codes/tx").resolve()
    if source_root != expected_root or not _within(packet_dir, source_root):
        raise ValueError("Only the pinned private Texas source evidence tree is allowed")
    if not _within(output_dir, source_root) or output_dir == source_root or output_dir.exists():
        raise ValueError("Output must be a new private directory under the Texas evidence tree")
    if output_dir.name in {"raw", "parsed-v5", "private-intake-v3"}:
        raise ValueError("Output may not overwrite source evidence")

    manifest_bytes = (packet_dir / "manifest.json").read_bytes()
    assets_bytes = (packet_dir / "assets.json").read_bytes()
    verify_pins(manifest_bytes, assets_bytes, EXPECTED_MANIFEST_SHA256, EXPECTED_ASSETS_SHA256)
    manifest = json.loads(manifest_bytes)
    assets = json.loads(assets_bytes)
    if (
        manifest.get("schema_version") != "publisher-code-private-packet/1"
        or manifest.get("source_system") != SOURCE_SYSTEM
        or manifest.get("parser") != PARSER
        or manifest.get("published") is not False
        or manifest.get("registered") is not False
        or manifest.get("cloud_verified") is not False
        or manifest.get("counts") != EXPECTED_COUNTS
        or len(manifest.get("batches", [])) != 254
        or manifest.get("assets", {}).get("sha256") != EXPECTED_ASSETS_SHA256
    ):
        raise ValueError("Input packet is not the frozen Texas v3 scope")
    if len(assets) != 5023 or sum(a.get("bytes", 0) for a in assets) != 165260936:
        raise ValueError("Input asset inventory differs from frozen packet scope")
    asset_by_sha = {a.get("sha256"): a for a in assets if isinstance(a, dict)}
    if len(asset_by_sha) != len(assets):
        raise ValueError("Duplicate or invalid content-addressed assets")

    # Verify each retained whole source object and derivative before producing any browsable row.
    for asset in assets:
        rel = pathlib.Path(asset.get("path", ""))
        file_path = rel.resolve() if rel.is_absolute() else (source_root / rel).resolve()
        if file_path.is_symlink() or not _within(file_path, source_root) or not file_path.is_file():
            raise ValueError("Asset path escapes the private Texas source tree")
        raw = file_path.read_bytes()
        if len(raw) != asset.get("bytes") or sha(raw) != asset.get("sha256"):
            raise ValueError("Source or derivative asset hash/length mismatch")

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = pathlib.Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", suffix=".tmp", dir=output_dir.parent))
    try:
        chapter_rows: dict[str, dict[str, Any]] = {}
        seen: set[tuple[str, str]] = set()
        counts: Counter[str] = Counter()
        codes: set[str] = set()
        code_chapters: dict[str, list[dict[str, Any]]] = {}
        sections_by_chapter: dict[str, list[dict[str, Any]]] = {}
        text_assets_written: set[str] = set()
        records_path = temp_dir / "records.jsonl"
        text_assets_path = temp_dir / "text-assets.jsonl"
        with records_path.open("wb") as records_out, text_assets_path.open("wb") as text_out:
            for batch_index, batch in enumerate(manifest["batches"]):
                filename = batch.get("file")
                if not isinstance(filename, str) or pathlib.PurePath(filename).name != filename:
                    raise ValueError("Unsafe packet batch filename")
                batch_path = (packet_dir / filename).resolve()
                if not _within(batch_path, packet_dir) or batch_path.is_symlink():
                    raise ValueError("Batch path escapes packet directory")
                batch_bytes = batch_path.read_bytes()
                if len(batch_bytes) != batch.get("bytes") or sha(batch_bytes) != batch.get("sha256"):
                    raise ValueError(f"Batch {batch_index} hash/length mismatch")
                rows = json.loads(batch_bytes)
                if not isinstance(rows, list) or len(rows) != batch.get("records"):
                    raise ValueError(f"Batch {batch_index} row count mismatch")
                for row in rows:
                    key = (row.get("entity_type", ""), row.get("native_id", ""))
                    if key in seen:
                        raise ValueError("Duplicate native record identity in packet")
                    seen.add(key)
                    counts[key[0]] += 1
                    data = row.get("data", {})
                    code = data.get("code")
                    if isinstance(code, str):
                        codes.add(code)
                    checked_source_asset(row, asset_by_sha)
                    if key[0] == "code-chapter-document":
                        text_sha = data.get("text_sha256")
                        asset = asset_by_sha.get(text_sha)
                        if not asset or asset.get("kind") != "chapter_text_derivative":
                            raise ValueError("Chapter text derivative reference is missing")
                        text_path_value = pathlib.Path(asset["path"])
                        text_path = text_path_value if text_path_value.is_absolute() else source_root / text_path_value
                        text = text_path.read_bytes().decode("utf-8", errors="strict")
                        identity = row["native_id"]
                        if identity in chapter_rows:
                            raise ValueError("Duplicate chapter identity")
                        chapter_rows[identity] = {"native_id": identity, "data": row["data"], "text": text}
                        code = data["code"]
                        code_chapters.setdefault(code, []).append({
                            "id": identity,
                            "title": data.get("code_name") or identity,
                            "publisher_member": data.get("publisher_member"),
                            "text_asset_sha256": text_sha,
                            "expected_section_count": data.get("section_occurrences"),
                            "captured_at": row["provenance"].get("retrieved_at"),
                            "source_url": row["provenance"].get("source_url"),
                        })
                        if text_sha not in text_assets_written:
                            text_ref = {
                                "sha256": text_sha,
                                "bytes": asset["bytes"],
                                "encoding": "utf-8",
                                "path": str(text_path.relative_to(pathlib.Path.cwd())),
                                "source_asset_kind": asset["kind"],
                                "source_references": asset["source_references"],
                            }
                            text_out.write((json.dumps(text_ref, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
                            text_assets_written.add(text_sha)
                    elif key[0] == "code-section-occurrence" and row.get("data", {}).get("chapter_identity") not in chapter_rows:
                        raise ValueError("Packet must contain parent chapter before its section occurrences")

                    browse = browse_record(row, asset_by_sha=asset_by_sha, chapters=chapter_rows)
                    records_out.write((json.dumps(browse, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
                    if key[0] == "code-section-occurrence":
                        sections_by_chapter.setdefault(browse["chapter_identity"], []).append({
                            "id": browse["id"],
                            "title": browse["title"],
                            "citation": browse["citation"],
                            "occurrence": browse["occurrence"],
                            "hierarchy": browse["hierarchy"],
                            "text_span": browse["text_span"],
                            "text_sha256": browse["text_sha256"],
                            "source_url": browse["source_url"],
                            "captured_at": browse["captured_at"],
                            "payload_sha256": browse["payload_sha256"],
                        })

        if dict(counts) != EXPECTED_COUNTS:
            raise ValueError("Projected row totals do not match frozen packet counts")

        hierarchy_inventory: list[dict[str, Any]] = []
        code_summaries: list[dict[str, Any]] = []
        for code in sorted(code_chapters):
            chapters_for_code = sorted(code_chapters[code], key=lambda c: c["id"])
            code_name = chapters_for_code[0]["title"]
            code_chapter_entries: list[dict[str, Any]] = []
            code_section_count = 0
            for chapter in chapters_for_code:
                chapter_id = chapter["id"]
                section_rows = sections_by_chapter.get(chapter_id, [])
                expected_count = chapter["expected_section_count"]
                if type(expected_count) is not int or expected_count != len(section_rows):
                    raise ValueError(f"Section occurrence count does not match chapter {chapter_id}")
                chapter_key = sha(chapter_id.encode("utf-8"))
                section_shards = partition_sections(chapter_id, chapter["text_asset_sha256"], section_rows)
                section_paths: list[dict[str, Any]] = []
                for index, shard in enumerate(section_shards):
                    path = f"hierarchy/sections/{chapter_key}-{index + 1:03d}.json"
                    write_hierarchy_file(temp_dir / path, {
                        "schema_version": SCHEMA,
                        "chapter_identity": chapter_id,
                        "text_asset_sha256": chapter["text_asset_sha256"],
                        "sections": shard,
                    }, hierarchy_inventory, temp_dir)
                    section_paths.append({"path": path, "sections": len(shard)})
                chapter_index_path = f"hierarchy/chapters/{chapter_key}.json"
                chapter_index = {
                    "schema_version": SCHEMA,
                    "id": chapter_id,
                    "code": code,
                    "title": chapter["title"],
                    "publisher_member": chapter["publisher_member"],
                    "captured_at": chapter["captured_at"],
                    "source_url": chapter["source_url"],
                    "text_asset_sha256": chapter["text_asset_sha256"],
                    "section_count": len(section_rows),
                    "section_shards": section_paths,
                }
                write_hierarchy_file(temp_dir / chapter_index_path, chapter_index, hierarchy_inventory, temp_dir)
                code_chapter_entries.append({
                    "id": chapter_id,
                    "title": chapter["title"],
                    "publisher_member": chapter["publisher_member"],
                    "text_asset_sha256": chapter["text_asset_sha256"],
                    "section_count": len(section_rows),
                    "index_path": chapter_index_path,
                })
                code_section_count += len(section_rows)
            code_index_path = f"hierarchy/codes/{code}.json"
            write_hierarchy_file(temp_dir / code_index_path, {
                "schema_version": SCHEMA,
                "jurisdiction": "TX",
                "code": code,
                "code_name": code_name,
                "chapter_count": len(code_chapter_entries),
                "section_count": code_section_count,
                "chapters": code_chapter_entries,
            }, hierarchy_inventory, temp_dir)
            code_summaries.append({
                "code": code,
                "code_name": code_name,
                "chapter_count": len(code_chapter_entries),
                "section_count": code_section_count,
                "index_path": code_index_path,
            })
        codes_index = {"schema_version": SCHEMA, "jurisdiction": "TX", "codes": code_summaries}
        codes_index_raw = compact_json(codes_index)
        if len(codes_index_raw) > MAX_HIERARCHY_FILE_BYTES:
            raise ValueError("Root Texas code listing exceeds shard limit")
        (temp_dir / "codes.json").write_bytes(codes_index_raw)
        hierarchy_inventory.append({"path": "codes.json", "bytes": len(codes_index_raw), "sha256": sha(codes_index_raw)})
        hierarchy_inventory_raw = b"".join(compact_json(item) + b"\n" for item in sorted(hierarchy_inventory, key=lambda item: item["path"]))
        (temp_dir / "hierarchy-assets.jsonl").write_bytes(hierarchy_inventory_raw)
        output_manifest = {
            "schema_version": SCHEMA,
            "dataset": DATASET_ID,
            "jurisdiction": "TX",
            "source_system": SOURCE_SYSTEM,
            "parser": PARSER,
            "source_packet_manifest_sha256": sha(manifest_bytes),
            "source_assets_manifest_sha256": sha(assets_bytes),
            "record_counts": dict(counts),
            "code_count": len(codes),
            "chapter_text_assets": len(text_assets_written),
            "record_index_sha256": sha(records_path.read_bytes()),
            "text_asset_index_sha256": sha(text_assets_path.read_bytes()),
            "hierarchy_asset_count": len(hierarchy_inventory),
            "hierarchy_asset_inventory_sha256": sha(hierarchy_inventory_raw),
            "codes_index_sha256": sha(codes_index_raw),
            "source_text_assets_copied": False,
            "registered": False,
            "published": False,
            "ready": False,
            "current_law_verified": False,
            "calculation_activation_allowed": False,
            "scope_note": "Captured publisher archive content; completeness, current legal effect, and calculator applicability are not certified by this candidate.",
        }
        manifest_out = temp_dir / "manifest.json"
        manifest_out.write_bytes(packet.canonical(output_manifest))
        temp_dir.rename(output_dir)
        return output_manifest
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def main() -> None:
    parser_arg = argparse.ArgumentParser(description=__doc__)
    parser_arg.add_argument("--source-root", default="private/audit-2026-10-05/full-state-codes/tx")
    parser_arg.add_argument("--packet-dir", default="private/audit-2026-10-05/full-state-codes/tx/private-intake-v3")
    parser_arg.add_argument("--output-dir", required=True, help="New private candidate directory; existing paths are rejected")
    args = parser_arg.parse_args()
    result = build_candidate(pathlib.Path(args.packet_dir), pathlib.Path(args.source_root), pathlib.Path(args.output_dir))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
