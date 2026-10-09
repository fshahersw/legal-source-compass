#!/usr/bin/env python3
"""Build publisher-code-manifest/2 landing packet from California pubinfo parse output."""
import argparse
import csv
import io
from collections import Counter
import hashlib
from pathlib import Path
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import sc_common as sc  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from to_landing import manifest_from_config, unit_key, write  # noqa: E402
from common.publisher_xml import xml_plain_text


def clean_hierarchy(rows: list) -> list:
    out = []
    for row in rows:
        number = row.get("number")
        if number in (None, "", "NULL"):
            number = None
        heading = row.get("heading")
        if heading in ("", "NULL"):
            heading = None
        if row["level"] != "section" and number is None and heading is None:
            continue
        out.append({"level": row["level"], "number": number, "heading": heading})
    return out


def archive_receipt(root: str) -> dict:
    receipts = os.path.join(root, "receipts")
    names = sorted(f for f in os.listdir(receipts) if re.fullmatch(r"pubinfo_\d{4}\.zip\.json", f))
    if not names:
        raise SystemExit("missing pubinfo archive receipt")
    return json.loads(Path(receipts, names[-1]).read_text(encoding="utf-8"))


def convert(root: str, parsed_name: str, cfg: dict) -> dict:
    root = os.path.abspath(root)
    parsed = os.path.join(root, parsed_name)
    out = os.path.join(root, "landing")
    if os.path.exists(out):
        raise FileExistsError("Landing output exists; choose a fresh versioned root")
    members_dir = os.path.join(root, "members")
    text_dir = os.path.join(root, "section-text")
    os.makedirs(members_dir, exist_ok=True)
    os.makedirs(text_dir, exist_ok=True)

    receipt = archive_receipt(root)
    zip_path = os.path.join(root, receipt["raw_file"])
    archive_hash = hashlib.sha256()
    with open(zip_path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            archive_hash.update(chunk)
    if os.path.getsize(zip_path) != receipt["bytes"] or archive_hash.hexdigest() != receipt["sha256"]:
        raise ValueError("Archive bytes differ from the retained acquisition receipt")
    summary = json.loads(Path(parsed, "summary.json").read_text(encoding="utf-8"))
    if summary.get("archive_sha256") != receipt["sha256"] or summary.get("parse_failures") != 0:
        raise ValueError("Parsed snapshot does not match this archive or has parse failures")
    os.makedirs(out)
    manifest = manifest_from_config(cfg)
    manifest["parser"] = {"name": "california-pubinfo-xml", "version": "2"}
    manifest["review"] = {
        "reviewed_by": "automated structural checks only; operative-law review pending",
        "reviewed_at": receipt["retrieved_at"][:10],
    }
    # Export-year and capture time are not a legislative-through date.
    dflt = {"basis": "none", "through_date": None,
            "edition": os.path.basename(zip_path),
            "statement": "Compilation-through date not established; publisher export " + os.path.basename(zip_path) + " captured " + receipt["retrieved_at"]}
    manifest["currency"] = {"basis": "none", "location": "Archive label and acquisition receipt only; operative-law review pending"}
    regex = re.compile(cfg["section_id"]["regex"])
    objects: dict = {}
    units = []
    secs = []
    gaps = []

    zip_src = {
        "source_url": receipt["source_url"],
        "retrieved_at": receipt["retrieved_at"],
        "http_status": 200,
        "retrieval_method": "publisher_bulk_download",
        "proxy": None,
    }
    archive_sha = receipt["sha256"]
    if archive_sha not in objects:
        objects[archive_sha] = {
            "sha256": archive_sha,
            "bytes": receipt["bytes"],
            "kind": "publisher_original",
            "path": os.path.abspath(zip_path),
            "sources": [zip_src],
        }

    lob_names = {}
    with zipfile.ZipFile(zip_path) as zf, open(os.path.join(parsed, "sections.jsonl"), encoding="utf-8") as parsed_rows:
        lob_names = {n.upper(): n for n in zf.namelist() if n.upper().endswith(".LOB")}

        table = csv.reader(io.StringIO(zf.read("LAW_SECTION_TBL.dat").decode("utf-8", "strict")), delimiter="\t", quotechar="`")
        occurrences = Counter()
        seen_unit_keys = set()
        for line in parsed_rows:
            sec = json.loads(line)
            raw_row = next(table, None)
            if raw_row is None or len(raw_row) < 18:
                raise ValueError("Parsed section has no complete corresponding publisher table row")
            checks = {"id": 0, "law_code": 1, "section_num": 2, "law_section_version_id": 7}
            if any(sec.get(field) != raw_row[index].strip() for field, index in checks.items()):
                raise ValueError("Section identity/citation differs from original publisher table")
            if sec.get("lob_member", "").upper() != raw_row[14].strip().upper():
                raise ValueError("Section LOB identity differs from publisher table")
            base_path = raw_row[1].strip() + ":" + raw_row[2].strip()
            occurrences[base_path] += 1
            expected_path = base_path + ("~" + str(occurrences[base_path]) if occurrences[base_path] > 1 else "")
            if sec.get("citation_path") != expected_path:
                raise ValueError("Citation occurrence differs from publisher table order")
            text = sec["text"]
            if not str(text or "").strip():
                gaps.append({"citation_path": sec["citation_path"], "reason": "no printed text"})
                continue
            path = sec["citation_path"]
            if not regex.search(path):
                raise SystemExit(f"citation_path {path!r} does not match manifest regex")
            lob_member = sec["lob_member"]
            lob_key = lob_member.upper()
            if lob_key not in lob_names:
                raise SystemExit("missing LOB in archive: " + lob_member)
            raw = zf.read(lob_names[lob_key])
            if sc.sha256_hex(raw) != sec["lob_sha256"]:
                raise SystemExit("LOB hash mismatch: " + sec["id"])
            if xml_plain_text(raw) != text:
                raise ValueError("Parsed section text does not reproduce the original XML member")
            member_path = os.path.join(members_dir, sec["lob_sha256"] + ".lob")
            if not os.path.exists(member_path):
                with open(member_path, "wb") as handle:
                    handle.write(raw)
            page_url = sec["source_url"]
            # The display URL is constructed, not a successful HTTP capture.
            member_src = {**zip_src, "retrieval_method": "publisher_zip_member"}
            if sec["lob_sha256"] not in objects:
                objects[sec["lob_sha256"]] = {
                    "sha256": sec["lob_sha256"],
                    "bytes": len(raw),
                    "kind": "publisher_original",
                    "path": os.path.abspath(member_path),
                    "sources": [member_src],
                }
            text_path = os.path.join(text_dir, sec["text_sha256"] + ".txt")
            if not os.path.exists(text_path):
                with open(text_path, "w", encoding="utf-8") as handle:
                    handle.write(text)
            body = Path(text_path).read_text(encoding="utf-8")
            if sc.sha256_hex(body) != sec["text_sha256"]:
                raise SystemExit("section text hash mismatch: " + sec["id"])
            if sec["text_sha256"] not in objects:
                objects[sec["text_sha256"]] = {
                    "sha256": sec["text_sha256"],
                    "bytes": len(body.encode("utf-8")),
                    "kind": "unit_text_derivative",
                    "path": os.path.abspath(text_path),
                    "sources": [member_src],
                }
            uid = unit_key(sec["id"])
            if uid in seen_unit_keys:
                raise ValueError("Duplicate normalized source unit identity")
            seen_unit_keys.add(uid)
            units.append(
                {
                    "unit_key": uid,
                    "unit_kind": cfg.get("unit_kind", "page"),
                    "heading": sec.get("heading"),
                    "original_sha256": sec["lob_sha256"],
                    "parent_archive_sha256": archive_sha,
                    "publisher_member": lob_member,
                    "raw_member_sha256": sec["lob_sha256"],
                    "text_sha256": sec["text_sha256"],
                    "text_code_points": len(body),
                    "sections_expected": 1,
                    "currency": {
                        "basis": dflt["basis"],
                        "statement": dflt["statement"],
                        "through_date": dflt["through_date"],
                        "edition": dflt["edition"],
                    },
                    "source_url": receipt["source_url"],
                    "retrieved_at": receipt["retrieved_at"],
                    "retrieval_method": "publisher_zip_member",
                    "proxy": None,
                }
            )
            cur = {
                "basis": dflt["basis"],
                "statement": dflt["statement"],
                "through_date": dflt["through_date"],
                "edition": dflt["edition"],
            }
            secs.append(
                {
                    "unit_key": uid,
                    "citation_path": path,
                    "citation": sec["citation"],
                    "heading": sec.get("heading"),
                    "text": text,
                    "hierarchy": clean_hierarchy(sec.get("hierarchy") or []),
                    "history": sec.get("history"),
                    "status_note": None if sec.get("active_flg") == "Y" else f"active_flg={sec.get('active_flg')}",
                    "span": {"unit": "unicode_code_points", "start": 0, "end": len(text)},
                    "currency": cur,
                    "source_url": receipt["source_url"],
                    "publisher_display_url": page_url,
                }
            )

        if next(table, None) is not None:
            raise ValueError("Publisher table contains sections absent from the parsed snapshot")
        if len(secs) + len(gaps) != summary["sections_parsed"]:
            raise ValueError("Parsed section count differs from retained summary")

    pats = [re.compile(x) for x in manifest["retrieval"]["source_url_patterns"]]
    for obj in objects.values():
        for src in obj["sources"]:
            if not any(p.search(src["source_url"]) for p in pats):
                raise SystemExit("source URL not covered by manifest patterns: " + src["source_url"])
    Path(out, "manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    write(os.path.join(out, "objects.jsonl"), sorted(objects.values(), key=lambda o: o["sha256"]))
    write(os.path.join(out, "units.jsonl"), units)
    write(os.path.join(out, "sections.jsonl"), secs)
    Path(out, "gaps.json").write_text(json.dumps(gaps,indent=2)+"\n",encoding="utf-8")
    proof = {"marker": "Original LAW_SECTION_TBL rows matched in sequence by id, citation, version and LOB member; not operative-law certification",
             "pages": [{"url":receipt["source_url"],"markers":sum(occurrences.values()),"sections":len(secs)}],
             "unfetched_child_pages":[]}
    Path(out, "toc-proof.json").write_text(json.dumps(proof,indent=2)+"\n",encoding="utf-8")
    Path(out, "release-holds.json").write_text(json.dumps({"publication_allowed":False,"calculation_activation_allowed":False,
        "holds":[{"code":"operative_law_currency_pending"},{"code":"independent_publisher_review_pending"}]},indent=2)+"\n",encoding="utf-8")
    return {"landing": out, "objects": len(objects), "units": len(units), "sections": len(secs), "gaps_no_text": len(gaps)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc4/ca")
    ap.add_argument("--parsed", default="parsed-pubinfo-20261007")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "landing.json"))
    a = ap.parse_args()
    print(json.dumps(convert(a.root, a.parsed, json.load(open(a.config, encoding="utf-8")))))


if __name__ == "__main__":
    main()
