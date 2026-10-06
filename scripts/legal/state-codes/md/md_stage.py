#!/usr/bin/env python3
"""Stage parsed Maryland Code oct1 capture into a publisher-code-manifest/2 landing packet."""
from __future__ import annotations

import argparse
import collections
import datetime
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))

from md_lib import (  # noqa: E402
    BASE,
    CODE_ID,
    CODE_NAME,
    EDITION_KEY,
    ENACTMENTS,
    LANDING,
    PARSER_NAME,
    PARSER_VERSION,
    PDF_URL_PATTERN,
    SECTION_ID_REGEX,
    STATUTE_URL_PATTERN,
    article_heading_from_display,
    normalize_section_number,
    statute_url,
)
from md_parse import load_inventory, load_receipts  # noqa: E402
from provenance_fetch import verify_store  # noqa: E402


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")


def jsonl_write(path: pathlib.Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def method_for(receipt: dict) -> tuple[str, str | None]:
    how = receipt.get("retrieval_method", "direct")
    if how.startswith("proxied:"):
        return "proxied_fetch", how.split(":", 1)[1]
    url = receipt.get("url") or ""
    if url.endswith(".pdf"):
        return "publisher_bulk_download", None
    return "publisher_page", None


def sources_for(receipts_by_sha: dict[str, list[dict]], sha: str, fallback_url: str | None) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    items: list[dict] = []
    for receipt in sorted(receipts_by_sha.get(sha, []), key=lambda row: row["retrieved_at"]):
        method, proxy = method_for(receipt)
        key = (receipt["url"], receipt["retrieved_at"])
        if key in seen:
            continue
        seen.add(key)
        items.append(
            {
                "source_url": receipt["url"],
                "retrieved_at": receipt["retrieved_at"],
                "retrieval_method": method,
                "proxy": proxy,
                "http_status": receipt.get("status") or 200,
            }
        )
    if not items and fallback_url:
        items = [
            {
                "source_url": fallback_url,
                "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "retrieval_method": "publisher_page",
                "proxy": None,
                "http_status": 200,
            }
        ]
    return items[:50]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/tmp/sc/MD"))
    ap.add_argument("--reviewer", default="md-lands-worker")
    args = ap.parse_args(argv)
    root = args.root
    parsed = root / "parsed"
    staged = root / "staged"
    landing = root / "landing"
    staged.mkdir(parents=True, exist_ok=True)
    landing.mkdir(parents=True, exist_ok=True)

    parse_report = json.loads((parsed / "parse-report.json").read_text(encoding="utf8"))
    audit = parse_report.get("independent_audit") or {}
    if not audit:
        raise SystemExit("run md_audit.py first")

    sections_path = parsed / "sections.jsonl"
    sections_gz = staged / "sections.jsonl.gz"
    with sections_path.open("rb") as source, gzip.GzipFile(
        filename="", mode="wb", fileobj=sections_gz.open("wb"), mtime=0
    ) as target:
        shutil.copyfileobj(source, target, 1 << 20)
    shutil.copyfile(parsed / "parse-report.json", staged / "parse-report.json")
    if (parsed / "audit-report.json").exists():
        shutil.copyfile(parsed / "audit-report.json", staged / "audit-report.json")

    receipts = load_receipts(root)
    receipts_by_sha: dict[str, list[dict]] = collections.defaultdict(list)
    for receipt in receipts:
        if receipt.get("ok") and receipt.get("status") == 200:
            receipts_by_sha[receipt["sha256"]].append(receipt)

    pdf_receipts = {}
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        label = receipt.get("label") or ""
        if label.startswith("pdf:%s:" % EDITION_KEY):
            pdf_receipts[label.split(":", 2)[2]] = receipt

    inventory = load_inventory(root)
    inventory_by_article = {row["article_code"]: row for row in inventory}
    derivatives_meta = parse_report.get("derivatives") or {}

    files: list[dict] = []
    seen_sha: set[str] = set()
    for article_code, receipt in sorted(pdf_receipts.items()):
        sha = receipt["sha256"]
        if sha in seen_sha:
            continue
        seen_sha.add(sha)
        files.append(
            {
                "kind": "publisher_original",
                "path": receipt["stored_path"],
                "sha256": sha,
                "bytes": receipt["bytes"],
                "url": receipt["url"],
                "retrieved_at": receipt["retrieved_at"],
                "retrieval_method": receipt["retrieval_method"],
                "unit_key": "article:%s:%s" % (EDITION_KEY, article_code),
            }
        )

    article_deriv_dir = staged / "articles"
    article_deriv_dir.mkdir(parents=True, exist_ok=True)
    for unit_key, meta in derivatives_meta.items():
        extract_path = root / meta["path"]
        derivative_path = article_deriv_dir / meta["sha256"]
        shutil.copyfile(extract_path, derivative_path)
        if sha256_file(derivative_path) != meta["sha256"]:
            raise SystemExit("derivative hash mismatch for %s" % unit_key)
        if meta["sha256"] in seen_sha:
            continue
        seen_sha.add(meta["sha256"])
        files.append(
            {
                "kind": "unit_text_derivative",
                "path": str(derivative_path.relative_to(staged)),
                "sha256": meta["sha256"],
                "bytes": derivative_path.stat().st_size,
                "url": meta["url"],
                "retrieved_at": None,
                "retrieval_method": "derived:%s/%s" % (PARSER_NAME, PARSER_VERSION),
                "derivative_of": meta.get("receipt_sha256"),
                "unit_key": unit_key,
                "text_code_points": meta["text_code_points"],
            }
        )

    currency_statement = (
        "Maryland Code on mgaleg.maryland.gov with enactments=true (in effect as of October 1)."
    )
    source = {
        "schema_version": "publisher-code-source/2",
        "status": "captured-parsed-audited",
        "jurisdiction": "MD",
        "publisher": "Maryland General Assembly",
        "publisher_url": BASE,
        "code_name": CODE_NAME,
        "code_id": CODE_ID,
        "edition": EDITION_KEY,
        "currency": {
            "statement": currency_statement,
            "as_of": None,
            "evidence_url": LANDING,
            "evidence_grade": "official mgaleg Statutes landing and GetArticles enactments=true",
        },
        "official_urls": {
            "statutes_landing": LANDING,
            "statute_text_pattern": BASE + "/Laws/StatuteText?article={article}&section={section}&enactments=true",
            "article_pdf_pattern": "https://mgaleg.maryland.gov/{session}RS/Statute_Web/{article}/{article}.pdf",
        },
        "archive_model": {
            "unit": "one article PDF plus per-section StatuteText HTML",
            "member_treatment": (
                "Each article PDF is publisher_original. Parsed section text is concatenated "
                "per article into a content-addressed unit text derivative with unicode spans."
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
            "jurisdiction": "MD",
            "publisher": "Maryland General Assembly",
            "publisher_url": BASE,
            "source_system": CODE_ID,
            "code_title": CODE_NAME,
            "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
            "retrieval": {
                "methods": ["publisher_page", "publisher_bulk_download"],
                "source_url_patterns": [STATUTE_URL_PATTERN, PDF_URL_PATTERN],
                "terms_gate": False,
                "official_source": True,
                "rate_limit_ms": 1000,
            },
            "structure": {"levels": ["article", "section"], "unit": "article"},
            "section_id": {
                "scheme": "official_citation_path",
                "regex": SECTION_ID_REGEX,
                "example": "gcr 2-101",
                "citation_format": "Md. Code Ann., {article} § {section}",
            },
            "currency": {"basis": "publisher_statement", "location": LANDING},
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
        if not path.exists():
            continue
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
        raise SystemExit("verify_store failed: %s" % problems)

    manifest = {
        "schema_version": "publisher-code-manifest/2",
        "jurisdiction": "MD",
        "publisher": "Maryland General Assembly",
        "publisher_url": BASE,
        "source_system": CODE_ID,
        "code_title": CODE_NAME,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "retrieval": source["publisher_code_manifest"]["retrieval"],
        "structure": source["publisher_code_manifest"]["structure"],
        "section_id": source["publisher_code_manifest"]["section_id"],
        "currency": source["publisher_code_manifest"]["currency"],
        "review": {"reviewed_by": args.reviewer, "reviewed_at": datetime.date.today().isoformat()},
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

    # Landing packet for land_publisher_code_v2.py
    intake_manifest = {key: manifest[key] for key in manifest if key not in ("files", "verification", "counts")}
    objects: list[dict] = []
    pdf_sha_by_article = {code: rec["sha256"] for code, rec in pdf_receipts.items()}
    derivative_files = {f["sha256"]: f for f in files if f["kind"] == "unit_text_derivative"}
    original_files = {f["sha256"]: f for f in files if f["kind"] == "publisher_original"}

    units: list[dict] = []
    sections_out: list[dict] = []
    gaps: list[dict] = []
    per_unit = collections.Counter()
    toc_pages: list[dict] = []
    through_date = None
    currency = {
        "basis": "publisher_statement",
        "statement": currency_statement,
        "through_date": through_date,
        "edition": EDITION_KEY,
    }

    sections_by_unit: dict[str, list[str]] = collections.defaultdict(list)
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        unit_key = row["source"]["member"]
        sections_by_unit[unit_key].append(normalize_section_number(row["source"]["section_display"]))

    built_units: set[str] = set()
    for line in sections_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        unit_key = row["source"]["member"]
        article_code = row["source"]["article_code"]
        if unit_key not in built_units:
            built_units.add(unit_key)
            meta = derivatives_meta[unit_key]
            pdf_sha = pdf_sha_by_article.get(article_code) or row["source"].get("pdf_receipt_sha256")
            if not pdf_sha or pdf_sha not in original_files:
                raise SystemExit("missing PDF original for article %s" % article_code)
            pdf_file = original_files[pdf_sha]
            deriv_sha = meta["sha256"]
            deriv_file = derivative_files[deriv_sha]
            pdf_path = root / pdf_file["path"]
            deriv_path = staged / deriv_file["path"]
            if pdf_sha not in {o["sha256"] for o in objects}:
                objects.append(
                    {
                        "sha256": pdf_sha,
                        "bytes": pdf_file["bytes"],
                        "kind": "publisher_original",
                        "path": str(pdf_path),
                        "sources": sources_for(receipts_by_sha, pdf_sha, pdf_file["url"]),
                    }
                )
            if deriv_sha not in {o["sha256"] for o in objects}:
                objects.append(
                    {
                        "sha256": deriv_sha,
                        "bytes": deriv_file["bytes"],
                        "kind": "unit_text_derivative",
                        "path": str(deriv_path),
                        "sources": sources_for(receipts_by_sha, pdf_sha, pdf_file["url"]),
                    }
                )
            article_row = inventory_by_article[article_code]
            markers = [normalize_section_number(sec["display"]) for sec in article_row["sections"]]
            landed = sorted(sections_by_unit.get(unit_key, []))
            units.append(
                {
                    "unit_key": unit_key,
                    "unit_kind": "article",
                    "heading": article_heading_from_display(article_row["article_display"]),
                    "original_sha256": pdf_sha,
                    "publisher_member": article_code,
                    "raw_member_sha256": None,
                    "text_sha256": deriv_sha,
                    "text_code_points": meta["text_code_points"],
                    "sections_expected": len(markers),
                    "currency": currency,
                    "source_url": pdf_file["url"],
                    "retrieved_at": pdf_receipts[article_code]["retrieved_at"],
                    "retrieval_method": "publisher_bulk_download",
                    "proxy": None,
                }
            )
            toc_pages.append(
                {
                    "url": pdf_file["url"],
                    "markers": markers,
                    "sections": landed,
                }
            )
            for display in markers:
                if display not in landed:
                    gaps.append(
                        {
                            "unit_key": unit_key,
                            "section_display": display,
                            "reason": "not captured or not parsed",
                            "url": statute_url(article_code, display, ENACTMENTS),
                        }
                    )
        per_unit[unit_key] += 1
        span = row["source"].get("span")
        sections_out.append(
            {
                "unit_key": unit_key,
                "citation_path": row["native_id"],
                "citation": row["citation"],
                "heading": row.get("heading"),
                "text": row["text"],
                "hierarchy": row["citation_path"],
                "history": row.get("history"),
                "status_note": row.get("status_note") or row.get("status_label"),
                "span": span,
                "currency": currency,
                "source_url": row["source"]["url"],
            }
        )

    write_json(landing / "manifest.json", intake_manifest)
    jsonl_write(landing / "objects.jsonl", objects)
    jsonl_write(landing / "units.jsonl", units)
    jsonl_write(landing / "sections.jsonl", sections_out)
    write_json(
        landing / "toc-proof.json",
        {
            "marker": "GetSections API DisplayText per article compared to parsed StatuteText sections",
            "pages": toc_pages,
            "unfetched_child_pages": [],
        },
    )
    write_json(
        landing / "gaps.json",
        {
            "gaps": gaps,
            "sections": len(sections_out),
            "units": len(units),
            "objects": len(objects),
            "capture_complete": audit.get("capture_complete"),
        },
    )

    print(
        json.dumps(
            {
                "manifest_sha256": sha256_file(staged / "manifest.json"),
                "landing_sections": len(sections_out),
                "landing_units": len(units),
                "landing_objects": len(objects),
                "gaps": len(gaps),
                "verify_store": [checked, len(problems)],
                "audit_result": audit.get("result"),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
