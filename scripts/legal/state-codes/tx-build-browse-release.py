"""Pack the verified private Texas browsing candidate into compact app snapshots.

Text bodies remain referenced by their existing SHA-256 storage objects. This
script creates only small hierarchy/index files and does not register or publish
anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import shutil
import tempfile
from typing import Any

SCHEMA = "texas-code-browse-release/1"
MAX_FILE_BYTES = 900_000
SOURCE_SCHEMA = "texas-code-browsable-candidate/1"
EDITION_AUDIT_SHA256 = "ff7b6dae5ce5081ea78b3287f8d3f5dc788d7e3e383c4806b1446e39b30b939d"
PUBLISHER_COVERAGE_CLAIM = "Publisher states statutes through 89th 2nd Called Session (2025); constitutional amendments through November 2025. Not independently certified current."


def compact(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def digest_file(path: pathlib.Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_bytes())


def _inside(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return not path.is_symlink()
    except ValueError:
        return False


def verify_candidate(candidate_dir: pathlib.Path, manifest: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, bool]]:
    """Verify the candidate's pinned indexes and every referenced hierarchy file."""
    required_hashes = {
        "codes.json": manifest.get("codes_index_sha256"),
        "records.jsonl": manifest.get("record_index_sha256"),
        "text-assets.jsonl": manifest.get("text_asset_index_sha256"),
        "hierarchy-assets.jsonl": manifest.get("hierarchy_asset_inventory_sha256"),
    }
    for filename, expected in required_hashes.items():
        path = candidate_dir / filename
        if not path.is_file() or path.is_symlink() or digest_file(path) != expected:
            raise ValueError(f"Candidate index hash mismatch: {filename}")
    inventory = [json.loads(line) for line in (candidate_dir / "hierarchy-assets.jsonl").read_bytes().splitlines()]
    if len(inventory) != manifest.get("hierarchy_asset_count"):
        raise ValueError("Candidate hierarchy file count mismatch")
    seen: set[str] = set()
    for row in inventory:
        rel = row.get("path")
        if not isinstance(rel, str) or rel in seen:
            raise ValueError("Candidate hierarchy contains a duplicate or invalid path")
        seen.add(rel)
        path = candidate_dir / pathlib.PurePosixPath(rel)
        if not _inside(path, candidate_dir) or not path.is_file():
            raise ValueError(f"Candidate hierarchy path is missing or unsafe: {rel}")
        raw = path.read_bytes()
        if len(raw) != row.get("bytes") or digest(raw) != row.get("sha256") or len(raw) > MAX_FILE_BYTES:
            raise ValueError(f"Candidate hierarchy bytes/hash mismatch: {rel}")
    if "codes.json" not in seen:
        raise ValueError("Candidate hierarchy does not pin its root code list")
    chapter_hints: dict[str, bool] = {}
    counts = {"code-chapter-document": 0, "code-section-occurrence": 0}
    with (candidate_dir / "records.jsonl").open("rb") as record_file:
        for line in record_file:
            row = json.loads(line)
            kind = row.get("entity_type")
            if kind not in counts:
                raise ValueError("Candidate record has an unexpected entity type")
            counts[kind] += 1
            if kind == "code-chapter-document":
                native_id = row.get("id")
                if not isinstance(native_id, str) or native_id in chapter_hints:
                    raise ValueError("Candidate chapter native IDs are duplicate or invalid")
                hint = row.get("source_data", {}).get("publisher_filename_legacy_hint")
                if isinstance(hint, bool) and hint:
                    chapter_hints[native_id] = True
    if counts != manifest.get("record_counts"):
        raise ValueError("Candidate record counts do not match the pinned manifest")
    text_rows: dict[str, dict[str, Any]] = {}
    text_index = candidate_dir / "text-assets.jsonl"
    for line in text_index.read_bytes().splitlines():
        row = json.loads(line)
        sha = row.get("sha256")
        if not isinstance(sha, str) or len(sha) != 64 or sha in text_rows:
            raise ValueError("Candidate text asset index has duplicate/invalid SHA-256")
        path = pathlib.Path(row.get("path", ""))
        source_root = candidate_dir.parent
        if not _inside(path, source_root) or not path.is_file():
            raise ValueError("Candidate text derivative path is missing or outside the Texas packet")
        raw = path.read_bytes()
        if len(raw) != row.get("bytes") or digest(raw) != sha:
            raise ValueError("Candidate chapter text derivative failed hash verification")
        text_rows[sha] = row
    if len(text_rows) != manifest.get("chapter_text_assets"):
        raise ValueError("Candidate chapter text asset count mismatch")
    return text_rows, chapter_hints


def write_json(path: pathlib.Path, value: Any, logical_file: str) -> dict[str, Any]:
    raw = compact(value)
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError(f"Packed browse file exceeds {MAX_FILE_BYTES} bytes: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return {"file": logical_file, "bytes": len(raw), "sha256": digest(raw)}


def _pack_section_shards(
    code: str,
    chapters: list[dict[str, Any]],
    candidate_root: pathlib.Path,
    output_root: pathlib.Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pack section rows across chapters while keeping each snapshot bounded."""
    packed_files: list[dict[str, Any]] = []
    chapter_refs: dict[str, list[dict[str, Any]]] = {chapter["id"]: [] for chapter in chapters}
    current: list[dict[str, Any]] = []
    current_chapters: dict[str, int] = {}
    shard_number = 0

    def flush() -> None:
        nonlocal current, current_chapters, shard_number
        if not current:
            return
        shard_number += 1
        rel = f"state-codes/tx/browse-v1/sections/{code}-{shard_number:04d}.json"
        path = output_root / rel
        meta = write_json(path, {
            "schema_version": SCHEMA,
            "jurisdiction": "TX",
            "code": code,
            "sections": current,
        }, rel)
        meta["section_count"] = len(current)
        packed_files.append(meta)
        for chapter_id, count in current_chapters.items():
            chapter_refs[chapter_id].append({"file": rel, "sha256": meta["sha256"], "bytes": meta["bytes"], "count": count})
        current = []
        current_chapters = {}

    for chapter in chapters:
        hierarchy_path = candidate_root / chapter["_candidate_index_path"]
        chapter_index = read_json(hierarchy_path)
        if chapter_index.get("id") != chapter.get("id") or chapter_index.get("text_asset_sha256") != chapter.get("text", {}).get("sha256"):
            raise ValueError("Chapter index identity/text pin mismatch")
        rows: list[dict[str, Any]] = []
        for ref in chapter_index.get("section_shards", []):
            shard = read_json(candidate_root / ref["path"])
            if shard.get("chapter_identity") != chapter["id"] or shard.get("text_asset_sha256") != chapter.get("text", {}).get("sha256"):
                raise ValueError("Section source shard parent identity mismatch")
            if len(shard.get("sections", [])) != ref.get("sections"):
                raise ValueError("Section source shard count mismatch")
            for row in shard["sections"]:
                if not isinstance(row.get("id"), str) or not row["id"].startswith(chapter["id"] + ":"):
                    raise ValueError("Section row does not belong to exact chapter")
                rows.append({"chapter_id": chapter["id"], **row})
        if len(rows) != chapter_index.get("section_count"):
            raise ValueError("Chapter section total mismatch")
        heading_key = "ARTICLE" if code == "CN" else "CHAPTER"
        headings = {
            row.get("hierarchy", {}).get(heading_key)
            for row in rows
            if isinstance(row.get("hierarchy"), dict) and isinstance(row.get("hierarchy", {}).get(heading_key), str)
        }
        if rows and len(headings) == 1 and all(
            isinstance(row.get("hierarchy"), dict) and row.get("hierarchy", {}).get(heading_key) in headings
            for row in rows
        ):
            chapter["title"] = next(iter(headings))
        else:
            chapter["title"] = chapter["publisher_member"]
        trial = current + rows
        trial_raw = compact({"schema_version": SCHEMA, "jurisdiction": "TX", "code": code, "sections": trial})
        if current and len(trial_raw) > MAX_FILE_BYTES:
            flush()
            trial = rows
            trial_raw = compact({"schema_version": SCHEMA, "jurisdiction": "TX", "code": code, "sections": trial})
        if len(trial_raw) > MAX_FILE_BYTES:
            # A single very large chapter can be split safely by contiguous rows.
            cursor = 0
            while cursor < len(rows):
                lo, hi = cursor + 1, len(rows)
                best = cursor
                while lo <= hi:
                    mid = (lo + hi) // 2
                    chunk = rows[cursor:mid]
                    raw = compact({"schema_version": SCHEMA, "jurisdiction": "TX", "code": code, "sections": chunk})
                    if len(raw) <= MAX_FILE_BYTES:
                        best = mid
                        lo = mid + 1
                    else:
                        hi = mid - 1
                if best == cursor:
                    raise ValueError("One section metadata row exceeds the shard limit")
                current = rows[cursor:best]
                current_chapters = {chapter["id"]: best - cursor}
                flush()
                cursor = best
        else:
            current = trial
            current_chapters[chapter["id"]] = len(rows)
    flush()

    for chapter in chapters:
        chapter["section_shards"] = chapter_refs[chapter["id"]]
    return packed_files, chapters


def build_release(candidate_dir: pathlib.Path, output_dir: pathlib.Path) -> dict[str, Any]:
    candidate_dir = candidate_dir.resolve()
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError("Output path already exists; choose a new candidate directory")
    source_manifest = read_json(candidate_dir / "manifest.json")
    if source_manifest.get("schema_version") != SOURCE_SCHEMA or source_manifest.get("jurisdiction") != "TX":
        raise ValueError("Verified Texas browse candidate required")
    for gate in ("registered", "published", "ready", "current_law_verified", "calculation_activation_allowed"):
        if source_manifest.get(gate) is not False:
            raise ValueError(f"Candidate gate unexpectedly changed: {gate}")
    text_rows, chapter_hints = verify_candidate(candidate_dir, source_manifest)
    edition_audit_path = candidate_dir.parent / "independent-audit.json"
    if not edition_audit_path.is_file() or digest_file(edition_audit_path) != EDITION_AUDIT_SHA256:
        raise ValueError("Pinned Texas publisher coverage audit is absent or changed")
    edition_audit = read_json(edition_audit_path)
    if edition_audit.get("artifacts", {}).get("parsedSummary", {}).get("value", {}).get("currency") != PUBLISHER_COVERAGE_CLAIM:
        raise ValueError("Publisher coverage statement does not match its pinned audit")
    codes_index = read_json(candidate_dir / "codes.json")
    if len(codes_index.get("codes", [])) != source_manifest.get("code_count"):
        raise ValueError("Candidate code index count mismatch")

    temp = pathlib.Path(tempfile.mkdtemp(prefix=".tx-browse-release-", dir=output_dir.parent))
    try:
        packed_inventory: list[dict[str, Any]] = []
        public_codes = []
        chapter_count = section_count = 0
        referenced_text_shas: set[str] = set()
        for code in codes_index["codes"]:
            code_index = read_json(candidate_dir / code["index_path"])
            chapters: list[dict[str, Any]] = []
            for source_chapter in code_index.get("chapters", []):
                index_path = candidate_dir / source_chapter["index_path"]
                chapter = read_json(index_path)
                if chapter.get("id") != source_chapter.get("id"):
                    raise ValueError("Candidate chapter listing/index mismatch")
                text_sha = chapter.get("text_asset_sha256")
                if not isinstance(text_sha, str) or len(text_sha) != 64:
                    raise ValueError("Chapter text SHA-256 is missing")
                referenced_text_shas.add(text_sha)
                chapters.append({
                    "id": chapter["id"],
                    "_candidate_index_path": source_chapter["index_path"],
                    "title": chapter["title"],
                    "publisher_member": chapter["publisher_member"],
                    "captured_at": chapter["captured_at"],
                    "source_url": chapter["source_url"],
                    "text": {
                        "file": f"state-codes/tx/text/{text_sha}.txt",
                        "sha256": text_sha,
                        "bytes": None,
                    },
                    "section_count": chapter["section_count"],
                    "section_shards": [],
                })
                if chapter["id"] in chapter_hints:
                    chapters[-1]["legacy_filename_variant"] = True
            for chapter in chapters:
                chapter["text"]["bytes"] = text_rows.get(chapter["text"]["sha256"], {}).get("bytes")
                if chapter["text"]["bytes"] is None or chapter["text"]["bytes"] > 16 * 1024 * 1024:
                    raise ValueError("Chapter text size missing or above private snapshot limit")
            section_files, chapters = _pack_section_shards(code["code"], chapters, candidate_dir, temp)
            packed_inventory.extend(section_files)
            for chapter in chapters:
                chapter.pop("_candidate_index_path", None)
            chapter_rel = f"state-codes/tx/browse-v1/codes/{code['code']}.json"
            chapter_meta = write_json(temp / chapter_rel, {
                "schema_version": SCHEMA,
                "jurisdiction": "TX",
                "code": code["code"],
                "code_name": code["code_name"],
                "captured_content_note": "Publisher-captured code text; current legal effect is not certified.",
                "chapters": chapters,
            }, chapter_rel)
            packed_inventory.append(chapter_meta)
            public_codes.append({
                "code": code["code"],
                "code_name": code["code_name"],
                "chapter_count": len(chapters),
                "section_count": sum(chapter["section_count"] for chapter in chapters),
                "file": chapter_rel,
                "sha256": chapter_meta["sha256"],
                "bytes": chapter_meta["bytes"],
            })
            chapter_count += len(chapters)
            section_count += sum(chapter["section_count"] for chapter in chapters)

        codes_rel = "state-codes/tx/browse-v1/codes.json"
        if referenced_text_shas != set(text_rows):
            raise ValueError("Candidate chapter references do not exactly match its text asset index")
        codes_meta = write_json(temp / codes_rel, {
            "schema_version": SCHEMA,
            "jurisdiction": "TX",
            "source_system": "texas-legislature-code",
            "parser": "texas-publisher-html/5",
            "scope_note": "Publisher-captured code text. Coverage and current legal effect are not certified.",
            "publisher_coverage_claim": PUBLISHER_COVERAGE_CLAIM,
            "coverage_claim_evidence": {
                "private_audit_sha256": EDITION_AUDIT_SHA256,
                "statement_scope": "Publisher coverage statement retained in the independent capture audit; it is not an independent currentness finding.",
            },
            "codes": public_codes,
        }, codes_rel)
        packed_inventory.append(codes_meta)
        inventory_raw = b"".join(compact(item) + b"\n" for item in sorted(packed_inventory, key=lambda item: item["file"]))
        (temp / "assets.jsonl").write_bytes(inventory_raw)
        release_manifest = {
            "schema_version": SCHEMA,
            "jurisdiction": "TX",
            "candidate_manifest_sha256": digest((candidate_dir / "manifest.json").read_bytes()),
            "candidate_hierarchy_sha256": source_manifest["hierarchy_asset_inventory_sha256"],
            "codes_file": codes_rel,
            "codes_sha256": codes_meta["sha256"],
            "code_count": len(public_codes),
            "chapter_count": chapter_count,
            "section_count": section_count,
            "metadata_asset_count": len(packed_inventory),
            "metadata_assets_sha256": digest(inventory_raw),
            "publisher_coverage_claim_sha256": digest(PUBLISHER_COVERAGE_CLAIM.encode("utf-8")),
            "chapter_text_assets_referenced": len(text_rows),
            "chapter_text_assets_copied": False,
            "registered": False,
            "published": False,
            "ready": False,
            "current_law_verified": False,
            "calculation_activation_allowed": False,
        }
        (temp / "release-manifest.json").write_bytes(compact(release_manifest))
        temp.rename(output_dir)
        return release_manifest
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    print(json.dumps(build_release(pathlib.Path(args.candidate_dir), pathlib.Path(args.output_dir)), sort_keys=True))


if __name__ == "__main__":
    main()
