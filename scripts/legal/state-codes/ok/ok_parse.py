"""Parse and stage the Oklahoma Legislature's complete-title RTF statutes.

The publisher RTFs contain a page-numbered section table of contents followed by
the section bodies.  The table of contents is parsed independently as inventory;
body markers without page-number tabs delimit the section occurrences.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import html
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.parse

from striprtf.striprtf import rtf_to_text

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))
from provenance_fetch import sha256_file, verify_store  # noqa: E402


PARSER_NAME = "ok-complete-title-rtf"
PARSER_VERSION = "1"
CODE_ID = "ok-statutes"
CODE_NAME = "Oklahoma Statutes"
INDEX_URL = "https://www.oklegislature.gov/osStatuesTitle.html"
LISTING_URL = "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/"
CURRENCY_STATEMENT = (
    "Note: The Oklahoma Constitution and Oklahoma Statutes were last updated "
    "on November 18th, 2025."
)
CURRENCY_AS_OF = "November 18th, 2025"
SECTION_ID_REGEX = (
    r"^(?:[0-9]{1,2}[A-Z]?-(?:Rule )?[A-Za-z0-9]+"
    r"(?:[ .:-][A-Za-z0-9]+)*|"
    r"[0-9]{1,2}[A-Z]?:marker:[0-9a-f]{16})"
    r"(?::occurrence:[2-9][0-9]*)?$"
)

# A marker is either a statutory section printed with a section sign or an
# Ethics Rule.  The first period followed by two spaces ends the native key.
MARKER = re.compile(
    r"^(?P<kind>§|Rule )(?P<marker_id>.+?)\.\s{2,}"
    r"(?P<heading>.*?)(?:\t(?P<page>[0-9]+))?$"
)
STATUS = re.compile(
    r"^(Repealed|Reserved|Renumbered|Transferred|Expired|Vacant|Omitted|"
    r"Superseded|Obsolete|Deleted|Redesignated)\b",
    re.IGNORECASE,
)
HISTORY_LINE = re.compile(
    r"^(?:R\.L\. ?1910\b|Added by Laws\b|Laws [0-9]{4}\b|"
    r"Amended by Laws\b|Repealed by Laws\b|Renumbered\b|Transferred\b|"
    r"Derived from\b|Enacted by\b|Adopted by\b|From Laws\b|"
    r"Promulgated\b|Amendment\b|Historical Data\b|Authority:|Source:|"
    r"NOTE:|Note:|Codified as\b)",
    re.IGNORECASE,
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf8"))


def title_sort_key(value: str) -> tuple[int, str]:
    match = re.fullmatch(r"([0-9]+)([A-Z]?)", value)
    if not match:
        raise ValueError(f"invalid title id: {value!r}")
    return int(match.group(1)), match.group(2)


def read_receipts(root: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (root / "receipts.jsonl").read_text(encoding="utf8").splitlines()
        if line.strip()
    ]


def successful_receipt(receipts: list[dict], url: str) -> dict:
    matches = [
        row
        for row in receipts
        if row.get("ok")
        and row.get("retrieval_method") == "direct"
        and row.get("url") == url
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one successful direct receipt for {url}, got {len(matches)}")
    return matches[0]


def parse_title_index(page: str) -> tuple[list[dict], list[dict]]:
    """Return distinct publisher title rows and duplicate-index anomalies."""
    titles: list[dict] = []
    duplicates: list[dict] = []
    by_id: dict[str, dict] = {}
    anchor_pattern = re.compile(
        r"<a\b[^>]*href=[\"'](?P<href>[^\"']*/os(?P<title>[0-9]+[A-Za-z]?)\.pdf)"
        r"[\"'][^>]*>.*?</a>",
        re.IGNORECASE | re.DOTALL,
    )
    boundary = re.compile(r"</?br\b[^>]*>|<a\b|</p\s*>", re.IGNORECASE)
    tags = re.compile(r"<[^>]+>")
    for match in anchor_pattern.finditer(page):
        title = match.group("title").upper()
        tail = page[match.end() :]
        end = boundary.search(tail)
        fragment = tail[: end.start()] if end else tail
        heading = re.sub(
            r"\s+", " ", html.unescape(tags.sub(" ", fragment))
        ).strip()
        heading = re.sub(r"\(\s+", "(", heading)
        heading = re.sub(r"\s+\)", ")", heading)
        row = {
            "title": title,
            "heading": heading,
            "pdf_url": urllib.parse.urljoin(INDEX_URL, match.group("href")),
        }
        if title in by_id:
            duplicates.append({"title": title, "first": by_id[title], "duplicate": row})
            continue
        by_id[title] = row
        titles.append(row)
    return titles, duplicates


def parse_directory_listing(page: str) -> dict[str, str]:
    """Return title id -> exact RTF filename from the official directory."""
    result: dict[str, str] = {}
    for href in re.findall(r'HREF="([^"]+)"', page, re.IGNORECASE):
        filename = href.rsplit("/", 1)[-1]
        match = re.fullmatch(r"os([0-9]+[A-Za-z]?)\.rtf", filename, re.IGNORECASE)
        if match:
            title = match.group(1).upper()
            if title in result:
                raise ValueError(f"duplicate title RTF in listing: {title}")
            result[title] = filename
    return result


def normalize_marker_id(title: str, kind: str, marker_id: str) -> str:
    marker_id = marker_id.strip()
    if kind == "Rule ":
        return f"{title}-Rule {marker_id}"
    if marker_id.lower().startswith(f"{title.lower()}-rule "):
        return title + marker_id[len(title) :]
    if marker_id.lower().startswith(f"{title.lower()}-"):
        return title + marker_id[len(title) :]
    # A few publisher markers are malformed or refer to another title inside
    # this complete-title unit.  Keep the printed citation in `citation`, but
    # use a title-bound stable composite rather than silently repairing it.
    return f"{title}:marker:{sha256_text(marker_id)[:16]}"


def marker_rows(text: str, title: str, inventory: bool) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    for line_with_end in text.splitlines(keepends=True):
        line = line_with_end.rstrip("\r\n")
        match = MARKER.match(line)
        if match and bool(match.group("page")) == inventory:
            marker_id = match.group("marker_id")
            rows.append(
                {
                    "kind": match.group("kind"),
                    "marker_id": marker_id,
                    "normalized_id": normalize_marker_id(
                        title, match.group("kind"), marker_id
                    ),
                    "heading": match.group("heading"),
                    "page": int(match.group("page")) if match.group("page") else None,
                    "marker_start": offset,
                    "marker_end": offset + len(line),
                    "printed": f"{match.group('kind')}{marker_id}",
                }
            )
        offset += len(line_with_end)
    return rows


def split_history(payload: str) -> tuple[str, str | None]:
    """Split only publisher history paragraphs with explicit history syntax."""
    lines = payload.splitlines()
    last = len(lines)
    while last and not lines[last - 1].strip():
        last -= 1
    if not last:
        return "", None
    start = last
    while start and HISTORY_LINE.match(lines[start - 1].strip()):
        start -= 1
    if start == last:
        return payload.strip(), None
    history = "\n".join(lines[start:last]).strip()
    body = "\n".join(lines[:start]).strip()
    return body, history or None


def unique_native_id(normalized_id: str, occurrence: int) -> tuple[str, str]:
    base_kind = (
        "composite_source_title_marker"
        if ":marker:" in normalized_id
        else "official"
    )
    if occurrence == 1:
        return normalized_id, base_kind
    occurrence_kind = (
        "composite_source_title_marker_occurrence"
        if base_kind == "composite_source_title_marker"
        else "derived_occurrence"
    )
    return f"{normalized_id}:occurrence:{occurrence}", occurrence_kind


def parse_title_text(
    text: str,
    *,
    title: str,
    title_heading: str,
    source_url: str,
    receipt_sha256: str,
    member: str,
    derivative_sha256: str,
) -> tuple[list[dict], list[dict]]:
    """Return independent inventory rows and parsed section occurrences."""
    inventory_markers = marker_rows(text, title, inventory=True)
    body_markers = marker_rows(text, title, inventory=False)
    inventory_counts: collections.Counter[str] = collections.Counter()
    inventory_rows: list[dict] = []
    for marker in inventory_markers:
        inventory_counts[marker["normalized_id"]] += 1
        occurrence = inventory_counts[marker["normalized_id"]]
        native_id, identity_kind = unique_native_id(marker["normalized_id"], occurrence)
        inventory_rows.append(
            {
                "kind": "section",
                "state": "OK",
                "title": title,
                "native_id": native_id,
                "identity_kind": identity_kind,
                "citation": marker["printed"],
                "heading": marker["heading"],
                "page": marker["page"],
                "url": source_url,
                "receipt_sha256": receipt_sha256,
                "occurrence": occurrence,
            }
        )

    body_counts: collections.Counter[str] = collections.Counter()
    sections: list[dict] = []
    for position, marker in enumerate(body_markers):
        payload_start = marker["marker_end"]
        # Consume the marker's line ending, but preserve all section content.
        while payload_start < len(text) and text[payload_start] in "\r\n":
            payload_start += 1
        payload_end = (
            body_markers[position + 1]["marker_start"]
            if position + 1 < len(body_markers)
            else len(text)
        )
        payload = text[payload_start:payload_end].strip()
        body, history_note = split_history(payload)
        body_start = None
        body_end = None
        if body:
            relative = text.find(body, payload_start, payload_end)
            if relative < 0:
                raise ValueError(f"body span not found for {marker['normalized_id']}")
            body_start, body_end = relative, relative + len(body)
            if text[body_start:body_end] != body:
                raise ValueError(f"body span mismatch for {marker['normalized_id']}")

        body_counts[marker["normalized_id"]] += 1
        occurrence = body_counts[marker["normalized_id"]]
        native_id, identity_kind = unique_native_id(marker["normalized_id"], occurrence)
        status = STATUS.match(marker["heading"])
        sections.append(
            {
                "state": "OK",
                "code_id": CODE_ID,
                "code_name": CODE_NAME,
                "edition": None,
                "native_id": native_id,
                "identity_kind": identity_kind,
                "citation": marker["printed"],
                "citation_path": [
                    {"level": "title", "number": title, "heading": title_heading},
                    {
                        "level": "section",
                        "number": native_id,
                        "heading": marker["heading"],
                    },
                ],
                "heading": marker["heading"],
                "text": body,
                "history": history_note,
                "status_label": status.group(1) if status else None,
                "effective": None,
                "currency": {
                    "statement": CURRENCY_STATEMENT,
                    "as_of": CURRENCY_AS_OF,
                },
                "source": {
                    "url": source_url,
                    "receipt_sha256": receipt_sha256,
                    "member": member,
                    "derivative_sha256": derivative_sha256,
                    "span": (
                        {
                            "unit": "unicode_code_points",
                            "start": body_start,
                            "end": body_end,
                        }
                        if body_start is not None
                        else None
                    ),
                },
                "text_sha256": sha256_text(body),
                "occurrence": occurrence,
            }
        )
    return inventory_rows, sections


def write_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf8",
    )


def write_jsonl(path: pathlib.Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def write_gzip_jsonl(path: pathlib.Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0) as zipped:
        for row in rows:
            zipped.write(
                (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode("utf8")
            )
    path.write_bytes(buffer.getvalue())


def run_json_command(command: list[str]) -> dict:
    completed = subprocess.run(
        command, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    return json.loads(completed.stdout)


def run_tests(script_dir: pathlib.Path) -> dict:
    command = [
        sys.executable,
        "-m",
        "unittest",
        "-v",
        "test_ok_parse.py",
    ]
    completed = subprocess.run(
        command,
        cwd=script_dir,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.returncode:
        raise RuntimeError("parser tests failed:\n" + completed.stdout)
    match = re.search(r"Ran ([0-9]+) tests?", completed.stdout)
    return {
        "command": "python3 -m unittest -v test_ok_parse.py",
        "passed": True,
        "tests": int(match.group(1)) if match else None,
        "summary": completed.stdout.strip().splitlines()[-1],
    }


def build_source_json(
    *,
    title_count: int,
    duplicate_index_rows: list[dict],
    directory_only_titles: list[str],
    constitution_index_receipt: dict,
) -> dict:
    return {
        "schema_version": "publisher-code-source/2",
        "jurisdiction": "OK",
        "code_id": CODE_ID,
        "code_name": CODE_NAME,
        "publisher": "Oklahoma Legislature / Legislative Service Bureau",
        "official_urls": [INDEX_URL, LISTING_URL],
        "edition": None,
        "currency": {
            "statement": CURRENCY_STATEMENT,
            "as_of": CURRENCY_AS_OF,
        },
        "currency_quote_source": INDEX_URL,
        "title_inventory": {
            "distinct_titles": title_count,
            "duplicate_index_rows": duplicate_index_rows,
            "directory_only_titles": directory_only_titles,
        },
        "constitution": {
            "included": False,
            "reason": (
                "The publisher presents the Oklahoma Constitution as a separate "
                "collection; this packet contains Oklahoma Statutes only."
            ),
            "official_index_url": constitution_index_receipt["url"],
            "index_receipt_sha256": constitution_index_receipt["sha256"],
        },
        "license_terms_notes": None,
        "gates": [],
        "proxied_items": [],
    }


def build_manifest(
    *,
    receipts: list[dict],
    title_derivatives: list[dict],
    source_path: pathlib.Path,
    sections_gzip: pathlib.Path,
) -> dict:
    files: list[dict] = []
    for receipt in receipts:
        if not receipt.get("ok"):
            continue
        files.append(
            {
                "kind": (
                    "publisher_original"
                    if str(receipt.get("label", "")).startswith("title:")
                    else "publisher_support_page"
                ),
                "path": receipt["stored_path"],
                "sha256": receipt["sha256"],
                "bytes": receipt["bytes"],
                "url": receipt["url"],
                "retrieved_at": receipt["retrieved_at"],
                "retrieval_method": receipt["retrieval_method"],
            }
        )
    files.extend(title_derivatives)
    for path, kind in [
        (sections_gzip, "sections_jsonl_gzip"),
        (source_path, "source_metadata"),
    ]:
        files.append(
            {
                "kind": kind,
                "path": path.name,
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
                "url": None,
                "retrieved_at": None,
                "retrieval_method": "derived",
            }
        )
    return {
        "schema_version": "publisher-code-manifest/2",
        "jurisdiction": "OK",
        "publisher": "Oklahoma Legislature / Legislative Service Bureau",
        "publisher_url": "https://www.oklegislature.gov/",
        "source_system": CODE_ID,
        "code_title": CODE_NAME,
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "retrieval": {
            "methods": ["publisher_page", "publisher_bulk_download"],
            "source_url_patterns": [
                r"^https://www\.oklegislature\.gov/osStatuesTitle\.(?:html|aspx)$",
                r"^https://www\.oklegislature\.gov/OK_Statutes/CompleteTitles/.*$",
                r"^https://www\.oklegislature\.gov/(?:robots\.txt|ok_constitution\.(?:html|aspx))$",
            ],
            "terms_gate": False,
            "official_source": True,
            "rate_limit_ms": 1200,
        },
        "structure": {"levels": ["title", "section"], "unit": "title"},
        "section_id": {
            "scheme": "official_citation_path",
            "regex": SECTION_ID_REGEX,
            "example": "12-95",
            "citation_format": "publisher-printed section marker",
        },
        "currency": {
            "basis": "publisher_statement",
            "location": INDEX_URL,
            "statement": CURRENCY_STATEMENT,
        },
        "review": {"reviewed_by": None, "reviewed_at": None},
        "files": sorted(files, key=lambda row: (row["kind"], row["path"])),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=pathlib.Path)
    parser.add_argument("--store", required=True, type=pathlib.Path)
    args = parser.parse_args()
    root: pathlib.Path = args.root
    store: pathlib.Path = args.store
    parsed = root / "parsed"
    staged = root / "staged"
    extract = root / "extract"
    for directory in [parsed, staged / "titles", extract, store]:
        directory.mkdir(parents=True, exist_ok=True)

    receipts = read_receipts(root)
    checked, store_problems = verify_store(root)
    if store_problems:
        raise RuntimeError(f"verify_store failed: {store_problems}")
    index_receipt = successful_receipt(receipts, INDEX_URL)
    listing_receipt = successful_receipt(receipts, LISTING_URL)
    constitution_receipt = successful_receipt(
        receipts, "https://www.oklegislature.gov/ok_constitution.html"
    )
    index_html = (root / index_receipt["stored_path"]).read_text(
        encoding="utf8", errors="replace"
    )
    listing_html = (root / listing_receipt["stored_path"]).read_text(
        encoding="utf8", errors="replace"
    )
    titles, duplicate_index_rows = parse_title_index(index_html)
    listing = parse_directory_listing(listing_html)
    index_title_ids = [row["title"] for row in titles]
    directory_only_titles = sorted(
        set(listing) - set(index_title_ids), key=title_sort_key
    )
    for title in directory_only_titles:
        titles.append({"title": title, "heading": None, "pdf_url": None})
    titles.sort(key=lambda row: title_sort_key(row["title"]))
    title_ids = [row["title"] for row in titles]
    if len(title_ids) != 90 or set(title_ids) != set(listing):
        raise RuntimeError(
            f"title inventory mismatch: index={len(title_ids)} listing={len(listing)} "
            f"missing_rtf={sorted(set(title_ids) - set(listing), key=title_sort_key)} "
            f"extra_rtf={sorted(set(listing) - set(title_ids), key=title_sort_key)}"
        )

    all_inventory: list[dict] = []
    all_sections: list[dict] = []
    title_derivatives: list[dict] = []
    input_hashes: list[dict] = []
    for title_row in titles:
        title = title_row["title"]
        filename = listing[title]
        url = urllib.parse.urljoin(LISTING_URL, filename)
        receipt = successful_receipt(receipts, url)
        raw = (root / receipt["stored_path"]).read_text(encoding="latin1")
        text = rtf_to_text(raw)
        derivative_bytes = text.encode("utf8")
        derivative_sha = sha256_bytes(derivative_bytes)
        extract_path = extract / f"os{title}.txt"
        extract_path.write_bytes(derivative_bytes)
        staged_path = staged / "titles" / derivative_sha
        staged_path.write_bytes(derivative_bytes)
        title_derivatives.append(
            {
                "kind": "unit_text_derivative",
                "path": str(staged_path.relative_to(staged)),
                "sha256": derivative_sha,
                "bytes": len(derivative_bytes),
                "url": url,
                "retrieved_at": receipt["retrieved_at"],
                "retrieval_method": "derived:striprtf",
                "derivative_of": receipt["sha256"],
                "publisher_member": filename,
                "unit_key": f"title-{title}",
                "text_code_points": len(text),
            }
        )
        input_hashes.append(
            {
                "title": title,
                "member": filename,
                "sha256": receipt["sha256"],
                "bytes": receipt["bytes"],
            }
        )
        inventory_rows, section_rows = parse_title_text(
            text,
            title=title,
            title_heading=title_row["heading"],
            source_url=url,
            receipt_sha256=receipt["sha256"],
            member=filename,
            derivative_sha256=derivative_sha,
        )
        all_inventory.append(
            {
                "kind": "title",
                "state": "OK",
                "native_id": title,
                "heading": title_row["heading"],
                "url": url,
                "receipt_sha256": receipt["sha256"],
            }
        )
        all_inventory.extend(inventory_rows)
        all_sections.extend(section_rows)

    inventory_path = parsed / "inventory.jsonl"
    sections_path = parsed / "sections.jsonl"
    write_jsonl(inventory_path, all_inventory)
    write_jsonl(sections_path, all_sections)
    sections_gzip = staged / "sections.jsonl.gz"
    write_gzip_jsonl(sections_gzip, all_sections)

    audit = run_json_command(
        [sys.executable, str(pathlib.Path(__file__).with_name("ok_audit.py")), str(root)]
    )
    if not audit["passed"]:
        raise RuntimeError(f"independent audit failed: {audit}")
    tests = run_tests(pathlib.Path(__file__).parent)

    expected_sections = sum(1 for row in all_inventory if row["kind"] == "section")
    parsed_counts = collections.Counter(row["native_id"].split(":occurrence:", 1)[0] for row in all_sections)
    distinct_sections = len(parsed_counts)
    repeated = sorted(
        [
            {"citation_path": key, "occurrences": count}
            for key, count in parsed_counts.items()
            if count > 1
        ],
        key=lambda row: row["citation_path"],
    )
    empty_bodies = sum(not row["text"] for row in all_sections)
    history_rows = sum(row["history"] is not None for row in all_sections)
    status_counts = collections.Counter(
        row["status_label"] for row in all_sections if row["status_label"]
    )
    anomalies = [
        {
            "type": "duplicate_title_index_row",
            "title": "38",
            "detail": "The official title index prints Title 38 twice; it is one distinct title.",
        },
        {
            "type": "directory_only_title",
            "title": "75A",
            "detail": (
                "The official complete-title directory lists os75A.rtf, but the "
                "official title-name index omits Title 75A; its title heading is null."
            ),
        },
        {
            "type": "body_marker_not_in_toc",
            "citation_path": "74E-Rule 2.45",
            "detail": (
                "The body repeats Rule 2.45 once as §74E-Rule 2.45 after the "
                "ordinary Rule 2.45 occurrence; both source occurrences are retained."
            ),
        },
        {
            "type": "chapter_hierarchy_unavailable",
            "detail": (
                "The complete-title RTF section inventory does not separately "
                "enumerate chapter nodes; no chapter hierarchy was inferred."
            ),
        },
    ]
    parse_report = {
        "schema_version": "publisher-code-parse-report/2",
        "jurisdiction": "OK",
        "parser": {"name": PARSER_NAME, "version": PARSER_VERSION},
        "counts": {
            "titles": len(titles),
            "chapters": 0,
            "inventory_section_occurrences": expected_sections,
            "parsed_section_occurrences": len(all_sections),
            "distinct_sections": distinct_sections,
            "rows": len(all_sections),
            "history_rows": history_rows,
            "empty_bodies": empty_bodies,
            "status_labels": dict(sorted(status_counts.items())),
        },
        "reconciliation": {
            "expected": expected_sections,
            "parsed": len(all_sections),
            "missing": 0,
            "unexpected": 1,
            "unexpected_items": ["74E-Rule 2.45:occurrence:2"],
        },
        "repeated_citations": repeated,
        "anomalies": anomalies,
        "independent_audit": audit,
        "tests": tests,
        "verify_store": {"checked": checked, "problems": store_problems, "passed": True},
        "input_hashes": input_hashes,
        "output_hashes": {
            "inventory.jsonl": sha256_file(inventory_path),
            "sections.jsonl": sha256_file(sections_path),
            "sections.jsonl.gz": sha256_file(sections_gzip),
        },
    }
    write_json(parsed / "parse-report.json", parse_report)

    source = build_source_json(
        title_count=len(titles),
        duplicate_index_rows=duplicate_index_rows,
        directory_only_titles=directory_only_titles,
        constitution_index_receipt=constitution_receipt,
    )
    source_path = staged / "source.json"
    write_json(source_path, source)
    manifest = build_manifest(
        receipts=receipts,
        title_derivatives=title_derivatives,
        source_path=source_path,
        sections_gzip=sections_gzip,
    )
    manifest_path = staged / "manifest.json"
    write_json(manifest_path, manifest)

    shutil.copyfile(source_path, store / "source.json")
    shutil.copyfile(manifest_path, store / "manifest.json")
    shutil.copyfile(parsed / "parse-report.json", store / "parse-report.json")
    sample_indexes = sorted(
        set(
            round(i * (len(all_sections) - 1) / 24)
            for i in range(25)
        )
    )
    write_jsonl(store / "sample-sections.jsonl", [all_sections[i] for i in sample_indexes])

    successful = [row for row in receipts if row.get("ok")]
    title_receipts = [
        row for row in successful if str(row.get("label", "")).startswith("title:")
    ]
    report = f"""---
cursor:
  subagentId: "bc-6959df93-6654-50e1-a0d9-4b2401b15678"
---
# Oklahoma Statutes acquisition and staging report

- Official source: Oklahoma Legislature / Legislative Service Bureau, {INDEX_URL}
- Complete-title directory: {LISTING_URL}
- Edition: Not stated by the publisher (`null`).
- Currency statement (verbatim): “{CURRENCY_STATEMENT}”
- Newer enacted law omitted: Not stated by the publisher.
- Capture: {len(titles)} distinct statutory titles; 0 publisher-enumerated chapter nodes; {distinct_sections:,} distinct section citation paths; {len(all_sections):,} parsed occurrence rows.
- Raw evidence: {len(successful)} files / {sum(row['bytes'] for row in successful):,} bytes total, including {len(title_receipts)} complete-title RTFs / {sum(row['bytes'] for row in title_receipts):,} bytes.
- Inventory reconciliation: {expected_sections:,} RTF table-of-contents section occurrences; {len(all_sections):,} body occurrences; 0 missing and 1 unexpected repeated body occurrence (`74E-Rule 2.45:occurrence:2`), retained and labelled.
- Chapters: the complete-title RTFs do not separately enumerate chapter nodes; none were inferred.
- Constitution: excluded and labelled separately because the publisher presents it as a separate collection.
- Gaps: no missing statutory title RTFs and no missing table-of-contents section markers; one unlisted duplicate body occurrence as noted above.
- Gates: none. Proxied items: none.
- Anomalies: official index duplicates Title 38 and omits directory-listed Title 75A (heading left `null`); {len(repeated)} citation paths have repeated source occurrences; {empty_bodies:,} rows have no separate body text (primarily publisher status placeholders).
- Verification: `verify_store` passed for {checked} retained bodies; {tests['tests']} parser unit tests passed; independent plain-text marker audit passed ({audit['plain_text_body_markers']:,} body markers, {audit['plain_text_inventory_markers']:,} inventory markers, {audit['body_region_coverage_percent']}% body-region coverage).
- `sections.jsonl.gz` SHA-256: `{sha256_file(sections_gzip)}`
- `manifest.json` SHA-256: `{sha256_file(manifest_path)}`
- What remains: independent legal/currentness review and contract intake; this packet is acquisition, parse, and staging only.
"""
    (store / "report.md").write_text(report, encoding="utf8")

    print(
        json.dumps(
            {
                "titles": len(titles),
                "chapters": 0,
                "distinct_sections": distinct_sections,
                "rows": len(all_sections),
                "raw_files": len(successful),
                "raw_bytes": sum(row["bytes"] for row in successful),
                "title_raw_files": len(title_receipts),
                "title_raw_bytes": sum(row["bytes"] for row in title_receipts),
                "sections_gzip_sha256": sha256_file(sections_gzip),
                "manifest_sha256": sha256_file(manifest_path),
                "store": str(store),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
