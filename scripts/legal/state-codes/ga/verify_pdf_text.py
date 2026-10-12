"""Independent comparison of a pinned third-party extraction with its original PDF pages.

This writes comparison evidence only. PDF text extraction order is not proof of legal
effect, and a mismatch is retained rather than silently correcting a source record.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata

import pypdf


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).replace("\u00ad", ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", type=Path, required=True)
    ap.add_argument("--pdfs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--resume-ledger", type=Path,
                    help="Reuse complete, source-bound comparison rows from an interrupted local run")
    args = ap.parse_args()
    raw = args.bulk.read_bytes()
    if digest(raw) != "5cc3304062371359a814c144b68105e0fa56a74992561e418b44bef6980ee3a5":
        raise ValueError("Unreviewed bulk version")
    args.out.mkdir(parents=True, exist_ok=True)
    groups = defaultdict(list)
    for ordinal, line in enumerate(gzip.decompress(raw).decode("utf-8").splitlines(), 1):
        record = json.loads(line)
        groups[record["text_source"]["sha256"]].append((ordinal, record))
    retained = {}
    if args.resume_ledger:
        for line in args.resume_ledger.read_text(encoding="utf-8").splitlines():
            evidence = json.loads(line)
            ordinal = evidence["ordinal"]
            if ordinal in retained or not isinstance(ordinal, int):
                raise ValueError("Duplicate or invalid retained comparison identity")
            retained[ordinal] = evidence
        expected_ordinals = {ordinal for rows in groups.values() for ordinal, _ in rows}
        if not set(retained).issubset(expected_ordinals):
            raise ValueError("Retained comparison does not belong to the pinned release")
    counts = Counter()
    source_reports = []
    with (args.out / "row-comparisons.jsonl").open("x", encoding="utf-8", newline="\n") as output:
        for sha, rows in sorted(groups.items()):
            path = args.pdfs / "raw" / (sha + ".pdf")
            if digest(path.read_bytes()) != sha:
                raise ValueError("Original PDF checksum mismatch")
            reader = pypdf.PdfReader(path)
            pages = {}
            used_pages = {page for _, row in rows for page in range(row["text_source"]["page_start"], row["text_source"]["page_end"] + 1)}
            pending_pages = {page for ordinal, row in rows if ordinal not in retained
                             for page in range(row["text_source"]["page_start"], row["text_source"]["page_end"] + 1)}
            for page in sorted(used_pages):
                if page < 1 or page > len(reader.pages):
                    raise ValueError("Pinned source page outside original PDF")
                if page in pending_pages:
                    pages[page] = reader.pages[page - 1].extract_text()
            local = Counter()
            for ordinal, row in rows:
                source = row["text_source"]
                if ordinal in retained:
                    evidence = retained[ordinal]
                    expected = {"ordinal": ordinal, "citation": row["citation"], "source_sha256": sha,
                                "page_start": source["page_start"], "page_end": source["page_end"],
                                "text_sha256": digest(row["text"].encode()), "source_status": row["status"],
                                "effective_qualifier": row["effective_qualifier"]}
                    if any(evidence.get(key) != value for key, value in expected.items()) or not re.fullmatch(
                            r"[a-f0-9]{64}", evidence.get("extracted_pages_sha256", "")):
                        raise ValueError("Retained comparison source binding mismatch")
                    status = evidence.get("comparison")
                    if status not in {"publisher_status_without_body", "whole_body_normalized_substring",
                                      "whole_body_line_hyphen_join", "unresolved_pdf_text_order_or_content"}:
                        raise ValueError("Unknown retained comparison outcome")
                    if (status == "publisher_status_without_body") != (not normalized(row["text"])):
                        raise ValueError("Retained empty-body status mismatch")
                    output.write(json.dumps(evidence, ensure_ascii=False) + "\n")
                    counts[status] += 1
                    local[status] += 1
                    continue
                extracted = "\n".join(pages[p] for p in range(source["page_start"], source["page_end"] + 1))
                body = normalized(row["text"])
                pdf_text = normalized(extracted)
                # A direct normalized substring is stronger than inferred semantic similarity.
                # Do not discard words, punctuation, paragraph labels or statutory numbers.
                if not body:
                    status = "publisher_status_without_body"
                elif body in pdf_text:
                    status = "whole_body_normalized_substring"
                elif normalized(row["text"]) in normalized(re.sub(r"(?<=\w)-\s*\n(?=\w)", "", extracted)):
                    status = "whole_body_line_hyphen_join"
                else:
                    status = "unresolved_pdf_text_order_or_content"
                evidence = {"ordinal": ordinal, "citation": row["citation"], "source_sha256": sha,
                            "page_start": source["page_start"], "page_end": source["page_end"],
                            "text_sha256": digest(row["text"].encode()),
                            "extracted_pages_sha256": digest(extracted.encode()), "comparison": status,
                            "source_status": row["status"], "effective_qualifier": row["effective_qualifier"]}
                output.write(json.dumps(evidence, ensure_ascii=False) + "\n")
                counts[status] += 1
                local[status] += 1
            source_reports.append({"sha256": sha, "pdf_pages": len(reader.pages), "used_pages": len(used_pages), "records": len(rows), "comparisons": dict(local)})
            print(json.dumps({"pdfs": len(source_reports), "records": sum(counts.values()), "comparisons": dict(counts)}), flush=True)
    report = {"schema_version": "ga-independent-pdf-text-comparison/1", "bulk_sha256": digest(raw),
              "extractor": "pypdf/" + pypdf.__version__, "normalization": "Unicode NFKC, whitespace and soft-hyphen removal; separate explicit line-hyphen comparison",
              "records": sum(counts.values()), "comparisons": dict(counts), "sources": source_reports,
              "row_ledger_sha256": digest((args.out / "row-comparisons.jsonl").read_bytes()),
              "resumed_comparisons": len(retained),
              "resume_ledger_sha256": digest(args.resume_ledger.read_bytes()) if args.resume_ledger else None,
              "qualification": "Unresolved comparisons require review. Matched text does not establish completeness, legal effect or currency.",
              "publication_allowed": False, "current_law_verified": False}
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"complete": True, "records": report["records"], "comparisons": report["comparisons"]}))


if __name__ == "__main__":
    main()
