"""Stage parsed Oregon ORS into a publisher-code-manifest/2 packet."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

from provenance_fetch import verify_store  # noqa: E402
from or_lib import (  # noqa: E402
    BASE,
    CODE_ID,
    CODE_NAME,
    EDITION,
    INDEX_URL,
    PARSER_NAME,
    PARSER_VERSION,
    SECTION_ID_REGEX,
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/OR"))
    args = ap.parse_args(argv)
    root = args.root
    parsed = root / "parsed"
    staged = root / "staged"
    chapters_dir = staged / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)

    parse_report = json.loads((parsed / "parse-report.json").read_text(encoding="utf8"))
    audit = parse_report.get("independent_audit") or {}
    if audit.get("result") != "passed":
        raise SystemExit(f"audit not passed: {audit.get('result')}")

    sections_path = parsed / "sections.jsonl"
    sections_gz = staged / "sections.jsonl.gz"
    with sections_path.open("rb") as source, gzip.GzipFile(
        filename="", mode="wb", fileobj=sections_gz.open("wb"), mtime=0
    ) as target:
        shutil.copyfileobj(source, target, 1 << 20)

    shutil.copyfile(parsed / "parse-report.json", staged / "parse-report.json")
    shutil.copyfile(parsed / "audit-report.json", staged / "audit-report.json")

    receipts = [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]
    files: list[dict] = []
    seen_sha: set[str] = set()
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        sha = receipt["sha256"]
        if sha in seen_sha:
            continue
        seen_sha.add(sha)
        label = receipt.get("label") or ""
        if label == "chapter-html":
            kind = "publisher_original"
        elif label == "ors-index":
            kind = "publisher_support_page"
        else:
            kind = "publisher_support_page"
        files.append(
            {
                "kind": kind,
                "path": receipt["stored_path"],
                "sha256": sha,
                "bytes": receipt["bytes"],
                "url": receipt["url"],
                "retrieved_at": receipt["retrieved_at"],
                "retrieval_method": receipt["retrieval_method"],
            }
        )

    derivative_meta = parse_report.get("derivatives") or {}
    for chapter, meta in derivative_meta.items():
        extract_path = root / meta["path"]
        derivative_path = chapters_dir / meta["sha256"]
        shutil.copyfile(extract_path, derivative_path)
        if sha256_file(derivative_path) != meta["sha256"]:
            raise SystemExit(f"derivative hash mismatch for chapter {chapter}")
        files.append(
            {
                "kind": "unit_text_derivative",
                "path": str(derivative_path.relative_to(staged)),
                "sha256": meta["sha256"],
                "bytes": derivative_path.stat().st_size,
                "url": meta["url"],
                "retrieved_at": None,
                "retrieval_method": "derived:chapter-html-text",
                "derivative_of": meta["receipt_sha256"],
                "unit_key": f"chapter-{chapter}",
                "text_code_points": meta["text_code_points"],
            }
        )

    source = {
        "schema_version": "publisher-code-source/2",
        "status": "captured-parsed-audited",
        "jurisdiction": "OR",
        "publisher": "Oregon Legislative Assembly",
        "publisher_url": BASE,
        "code_name": CODE_NAME,
        "code_id": CODE_ID,
        "edition": EDITION,
        "currency": {
            "statement": (
                "2025 Oregon Revised Statutes on oregonlegislature.gov. The publisher "
                "notes that 2025 special-session and 2026 regular-session changes may be "
                "omitted from the 2025 edition HTML."
            ),
            "as_of": None,
            "evidence_url": INDEX_URL,
            "evidence_grade": "official ORS index page and chapter HTML edition banners",
        },
        "official_urls": {
            "ors_index": INDEX_URL,
            "ors_chapter_pattern": BASE + "/bills_laws/ors/ors{chapter_padded}.html",
        },
        "archive_model": {
            "unit": "one chapter HTML page",
            "member_treatment": (
                "Each chapter HTML page is retained as publisher_original. Parsed section "
                "text is represented by a content-addressed chapter text derivative."
            ),
        },
        "licence_terms": {
            "terms_gate": False,
            "accepted": False,
            "note": "Public official pages required no terms acceptance, key, or login.",
        },
        "gates": [],
        "proxied_items": [],
        "publisher_code_manifest": {
            "schema_version": "publisher-code-manifest/2",
            "jurisdiction": "OR",
            "publisher": "Oregon Legislative Assembly",
            "publisher_url": BASE,
            "source_system": CODE_ID,
            "code_title": CODE_NAME,
            "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
            "retrieval": {
                "methods": ["publisher_page"],
                "source_url_patterns": [
                    r"^https://www\.oregonlegislature\.gov/bills_laws/ors/ors\d{3}[a-z]*\.html$"
                ],
                "terms_gate": False,
                "official_source": True,
                "rate_limit_ms": 1000,
            },
            "structure": {"levels": ["title", "chapter", "section"], "unit": "chapter"},
            "section_id": {
                "scheme": "official_citation_path",
                "regex": SECTION_ID_REGEX,
                "example": "12.010",
                "citation_format": "ORS {citation_path}",
            },
            "currency": {"basis": "publisher_statement", "location": INDEX_URL},
            "review": {"reviewed_by": None, "reviewed_at": None},
        },
    }
    write_json(staged / "source.json", source)

    for name, kind in [
        ("sections.jsonl.gz", "sections_jsonl_gzip"),
        ("source.json", "source_metadata"),
        ("parse-report.json", "parse_report"),
        ("audit-report.json", "audit_report"),
    ]:
        path = staged / name
        files.append(
            {
                "kind": kind,
                "path": name,
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
                "url": None,
                "retrieved_at": None,
                "retrieval_method": "derived",
            }
        )

    checked, problems = verify_store(root)
    if problems:
        raise SystemExit(f"verify_store failed: {problems}")

    manifest = {
        "schema_version": "publisher-code-manifest/2",
        "jurisdiction": "OR",
        "publisher": "Oregon Legislative Assembly",
        "publisher_url": BASE,
        "source_system": CODE_ID,
        "code_title": CODE_NAME,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "retrieval": source["publisher_code_manifest"]["retrieval"],
        "structure": source["publisher_code_manifest"]["structure"],
        "section_id": source["publisher_code_manifest"]["section_id"],
        "currency": source["publisher_code_manifest"]["currency"],
        "review": {"reviewed_by": None, "reviewed_at": None},
        "files": sorted(files, key=lambda row: (row["kind"], row["path"])),
        "verification": {
            "verify_store_checked_unique_bodies": checked,
            "verify_store_problems": problems,
            "independent_audit": audit,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "counts": parse_report["counts"],
    }
    write_json(staged / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "manifest_sha256": sha256_file(staged / "manifest.json"),
                "sections_gzip_sha256": sha256_file(sections_gz),
                "files": len(files),
                "rows": parse_report["counts"]["rows"],
                "verify_store": [checked, len(problems)],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
