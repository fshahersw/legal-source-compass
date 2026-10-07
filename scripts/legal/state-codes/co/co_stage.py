"""Stage parsed Colorado CRS into a publisher-code-manifest/2 packet."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))
from provenance_fetch import verify_store  # noqa: E402

from co_parse import (  # noqa: E402
    BASE,
    CODE_ID,
    CODE_NAME,
    CONTENT,
    CURRENCY,
    EDITION,
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
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/CO"))
    args = ap.parse_args(argv)
    root = args.root
    parsed = root / "parsed"
    staged = root / "staged"
    titles_dir = staged / "titles"
    titles_dir.mkdir(parents=True, exist_ok=True)

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
        if receipt.get("label") == "crs-download":
            kind = "publisher_original"
        elif receipt.get("label") == "official-page":
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
    for member, meta in derivative_meta.items():
        extract_path = root / meta["path"]
        derivative_path = titles_dir / meta["sha256"]
        shutil.copyfile(extract_path, derivative_path)
        if sha256_file(derivative_path) != meta["sha256"]:
            raise SystemExit(f"derivative hash mismatch for {member}")
        files.append(
            {
                "kind": "unit_text_derivative",
                "path": str(derivative_path.relative_to(staged)),
                "sha256": meta["sha256"],
                "bytes": derivative_path.stat().st_size,
                "url": meta["url"],
                "retrieved_at": None,
                "retrieval_method": "derived:title-htm-text",
                "derivative_of": meta["receipt_sha256"],
                "unit_key": f"title-{meta['title']}",
                "text_code_points": meta["text_code_points"],
            }
        )

    source = {
        "schema_version": "publisher-code-source/2",
        "status": "captured-parsed-audited",
        "jurisdiction": "CO",
        "publisher": "Colorado Office of Legislative Legal Services",
        "publisher_url": CONTENT,
        "code_name": CODE_NAME,
        "code_id": CODE_ID,
        "edition": EDITION,
        "currency": {
            **CURRENCY,
            "evidence_url": CONTENT
            + "/agencies/office-legislative-legal-services/2026-crs-titles-download",
            "evidence_grade": "publisher download page",
        },
        "official_urls": {
            "landing": "https://leg.colorado.gov/laws/colorado-revised-statutes",
            "data_page": CONTENT
            + "/agencies/office-legislative-legal-services/colorado-revised-statutes-data",
            "download_page": CONTENT
            + "/agencies/office-legislative-legal-services/2026-crs-titles-download",
            "bulk_base": BASE,
        },
        "archive_model": {
            "unit": "one official title HTM file",
            "member_treatment": (
                "Each crs2026-title-NN.htm file is retained as publisher_original. Parsed section "
                "text is represented by a content-addressed title text derivative."
            ),
        },
        "licence_terms": {
            "terms_gate": False,
            "accepted": False,
            "note": "Public official downloads required no terms acceptance, key, or login.",
        },
        "gates": [],
        "proxied_items": [],
        "publisher_code_manifest": {
            "schema_version": "publisher-code-manifest/2",
            "jurisdiction": "CO",
            "publisher": "Colorado Office of Legislative Legal Services",
            "publisher_url": CONTENT,
            "source_system": CODE_ID,
            "code_title": CODE_NAME,
            "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
            "retrieval": {
                "methods": ["publisher_page", "publisher_bulk_download"],
                "source_url_patterns": [
                    r"^https://olls\.info/crs/crs2026-.*\.(?:htm|zip)$",
                    r"^https://content\.leg\.colorado\.gov/agencies/office-legislative-legal-services/.*$",
                ],
                "terms_gate": False,
                "official_source": True,
                "rate_limit_ms": 1000,
            },
            "structure": {"levels": ["title", "article", "part", "subpart", "section"], "unit": "title"},
            "section_id": {
                "scheme": "official_citation_path",
                "regex": SECTION_ID_REGEX,
                "example": "1-1-101",
                "citation_format": "Colo. Rev. Stat. § {citation_path}",
            },
            "currency": {
                "basis": "publisher_statement",
                "location": CONTENT
                + "/agencies/office-legislative-legal-services/2026-crs-titles-download",
            },
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
        "jurisdiction": "CO",
        "publisher": "Colorado Office of Legislative Legal Services",
        "publisher_url": CONTENT,
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
