#!/usr/bin/env python3
"""Parse California pubinfo archive LAW_SECTION_TBL rows + LOB XML into a staging packet."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

PARSER = "california-pubinfo-xml/1"
SECTION_FIELDS = (
    "ID",
    "LAW_CODE",
    "SECTION_NUM",
    "OP_STATUES",
    "OP_CHAPTER",
    "OP_SECTION",
    "EFFECTIVE_DATE",
    "LAW_SECTION_VERSION_ID",
    "DIVISION",
    "TITLE",
    "PART",
    "CHAPTER",
    "ARTICLE",
    "HISTORY",
    "LOB_PATH",
    "ACTIVE_FLG",
    "TRANS_UID",
    "TRANS_UPDATE",
)
TOC_SECTION_FIELDS = (
    "ID",
    "LAW_CODE",
    "NODE_TREEPATH",
    "SECTION_NUM",
    "SECTION_ORDER",
    "TITLE",
    "OP_STATUES",
    "OP_CHAPTER",
    "OP_SECTION",
    "TRANS_UID",
    "TRANS_UPDATE",
    "LAW_SECTION_VERSION_ID",
    "SEQ_NUM",
)


def sha256_hex(data) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def encode_line(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def read_tab_rows(zf: zipfile.ZipFile, member: str) -> list[list[str]]:
    raw = zf.read(member)
    text = raw.decode("utf-8", "replace")
    return list(csv.reader(io.StringIO(text), delimiter="\t", quotechar="`"))


def xml_plain_text(xml_bytes: bytes) -> str:
    root = ET.fromstring(xml_bytes)
    parts = []
    if root.text and root.text.strip():
        parts.append(root.text.strip())
    for elem in root.iter():
        if elem is not root and elem.text and elem.text.strip():
            parts.append(elem.text.strip())
        if elem.tail and elem.tail.strip():
            parts.append(elem.tail.strip())
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def citation_path(law_code: str, section_num: str, global_occurrence: int) -> str:
    base = f"{law_code}:{section_num}"
    return base if global_occurrence == 1 else f"{base}~{global_occurrence}"


def section_url(law_code: str, section_num: str) -> str:
    return (
        "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml"
        f"?lawCode={law_code}&sectionNum={section_num}"
    )


def hierarchy_row(level: str, number: str | None, heading: str | None) -> dict:
    return {"level": level, "number": number or None, "heading": heading or None}


def parse_archive(root: str, parsed_name: str) -> dict:
    root = os.path.abspath(root)
    receipts = os.path.join(root, "receipts")
    archive_receipts = sorted(
        f for f in os.listdir(receipts) if re.fullmatch(r"pubinfo_\d{4}\.zip\.json", f)
    )
    if not archive_receipts:
        raise SystemExit("No pubinfo archive receipt; run ca-acquire.py first")
    archive_receipt = json.load(open(os.path.join(receipts, archive_receipts[-1]), encoding="utf-8"))
    zip_path = os.path.join(root, archive_receipt["raw_file"])
    if not os.path.isfile(zip_path):
        raise SystemExit("Archive file missing: " + zip_path)

    out = os.path.join(root, parsed_name)
    os.makedirs(out, exist_ok=True)
    failures_path = os.path.join(out, "parse-failures.jsonl")

    required = ("LAW_SECTION_TBL.dat", "LAW_TOC_SECTIONS_TBL.dat", "CODES_TBL.dat")
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        missing = [m for m in required if m not in names]
        if missing:
            raise SystemExit("Archive missing members: " + ", ".join(missing))

        codes = {}
        for row in read_tab_rows(zf, "CODES_TBL.dat"):
            if len(row) < 2:
                continue
            codes[row[0].strip()] = row[1].strip()

        toc_rows = []
        toc_heading_by_version: dict[str, str] = {}
        for row in read_tab_rows(zf, "LAW_TOC_SECTIONS_TBL.dat"):
            if len(row) < len(TOC_SECTION_FIELDS):
                continue
            rec = dict(zip(TOC_SECTION_FIELDS, row))
            toc_rows.append(rec)
            vid = (rec.get("LAW_SECTION_VERSION_ID") or "").strip()
            title = (rec.get("TITLE") or "").strip()
            if vid and title and vid not in toc_heading_by_version:
                toc_heading_by_version[vid] = title

        lob_index = {n.upper(): n for n in names if n.upper().endswith(".LOB")}

        cite_global: dict[str, int] = {}
        sections = []
        failures = []
        for row in read_tab_rows(zf, "LAW_SECTION_TBL.dat"):
            if len(row) < len(SECTION_FIELDS):
                failures.append({"reason": "short_row", "columns": len(row)})
                continue
            rec = dict(zip(SECTION_FIELDS, row))
            law_code = rec["LAW_CODE"].strip()
            section_num = rec["SECTION_NUM"].strip()
            lob_key = rec["LOB_PATH"].strip().upper()
            lob_member = lob_index.get(lob_key)
            if not lob_member:
                failures.append({"id": rec["ID"], "reason": "missing_lob", "lob": rec["LOB_PATH"]})
                continue
            try:
                xml_bytes = zf.read(lob_member)
                text = xml_plain_text(xml_bytes)
            except ET.ParseError as exc:
                failures.append({"id": rec["ID"], "reason": "xml_parse_error", "error": str(exc)})
                continue
            except Exception as exc:
                failures.append({"id": rec["ID"], "reason": "lob_read_error", "error": str(exc)})
                continue

            base = f"{law_code}:{section_num}"
            cite_global[base] = cite_global.get(base, 0) + 1
            path = citation_path(law_code, section_num, cite_global[base])
            hierarchy = []
            for level, key in (
                ("division", "DIVISION"),
                ("title", "TITLE"),
                ("part", "PART"),
                ("chapter", "CHAPTER"),
                ("article", "ARTICLE"),
            ):
                val = (rec.get(key) or "").strip()
                if val:
                    hierarchy.append(hierarchy_row(level, val, None))
            vid = rec["LAW_SECTION_VERSION_ID"].strip()
            heading = toc_heading_by_version.get(vid) or None
            hierarchy.append(hierarchy_row("section", path.split("~", 1)[0], heading))

            sections.append(
                {
                    "id": rec["ID"].strip(),
                    "law_code": law_code,
                    "section_num": section_num,
                    "citation_path": path,
                    "citation": f"{law_code} § {section_num}",
                    "heading": heading,
                    "text": text,
                    "text_sha256": sha256_hex(text),
                    "history": (rec.get("HISTORY") or "").strip() or None,
                    "active_flg": (rec.get("ACTIVE_FLG") or "").strip(),
                    "law_section_version_id": rec["LAW_SECTION_VERSION_ID"].strip(),
                    "hierarchy": hierarchy,
                    "source_url": section_url(law_code, section_num),
                    "lob_member": lob_member,
                    "lob_sha256": sha256_hex(xml_bytes),
                }
            )

    with open(os.path.join(out, "sections.jsonl"), "wb") as handle:
        for s in sections:
            handle.write(encode_line(s))
    with open(os.path.join(out, "toc-sections.jsonl"), "wb") as handle:
        for t in toc_rows:
            handle.write(encode_line(t))
    json.dump(codes, open(os.path.join(out, "codes.json"), "w"), indent=2, sort_keys=True)

    if failures:
        with open(failures_path, "w", encoding="utf-8") as handle:
            for f in failures:
                handle.write(json.dumps(f) + "\n")

    version_ids_section = {s["law_section_version_id"] for s in sections}
    version_ids_toc = {t["LAW_SECTION_VERSION_ID"].strip() for t in toc_rows if t.get("LAW_SECTION_VERSION_ID")}
    summary = {
        "schema_version": "california-pubinfo-parse-summary/1",
        "parser": {"name": PARSER, "version": "1"},
        "archive_sha256": archive_receipt["sha256"],
        "code_table_rows": len(codes),
        "law_section_tbl_rows": len(sections) + len(failures),
        "sections_parsed": len(sections),
        "parse_failures": len(failures),
        "toc_section_rows": len(toc_rows),
        "toc_version_ids": len(version_ids_toc),
        "section_version_ids": len(version_ids_section),
        "toc_rows_missing_section_version_id": sum(1 for t in toc_rows if not (t.get("LAW_SECTION_VERSION_ID") or "").strip()),
        "sections_with_empty_text": sum(1 for s in sections if not s["text"].strip()),
        "unique_citation_paths": len({s["citation_path"] for s in sections}),
    }
    json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))
    if failures:
        return summary
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default="/tmp/sc4/ca")
    ap.add_argument("parsed", nargs="?", default="parsed-pubinfo-20261007")
    a = ap.parse_args()
    summary = parse_archive(a.root, a.parsed)
    return 1 if summary.get("parse_failures") else 0


if __name__ == "__main__":
    sys.exit(main())
