#!/usr/bin/env python3
"""Build publisher-code-manifest/2 landing packet from California pubinfo parse output."""
import argparse
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import sc_common as sc  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from to_landing import manifest_from_config, unit_key, write  # noqa: E402


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
    return json.load(open(os.path.join(receipts, names[-1]), encoding="utf-8"))


def convert(root: str, parsed_name: str, cfg: dict) -> dict:
    root = os.path.abspath(root)
    parsed = os.path.join(root, parsed_name)
    out = os.path.join(root, "landing")
    os.makedirs(out, exist_ok=True)
    members_dir = os.path.join(root, "members")
    text_dir = os.path.join(root, "section-text")
    os.makedirs(members_dir, exist_ok=True)
    os.makedirs(text_dir, exist_ok=True)

    receipt = archive_receipt(root)
    zip_path = os.path.join(root, receipt["raw_file"])
    manifest = manifest_from_config(cfg)
    dflt = cfg["currency_defaults"]
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
    with zipfile.ZipFile(zip_path) as zf:
        lob_names = {n.upper(): n for n in zf.namelist() if n.upper().endswith(".LOB")}

        for line in open(os.path.join(parsed, "sections.jsonl"), encoding="utf-8"):
            sec = json.loads(line)
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
            member_path = os.path.join(members_dir, sec["lob_sha256"] + ".lob")
            if not os.path.exists(member_path):
                with open(member_path, "wb") as handle:
                    handle.write(raw)
            page_url = sec["source_url"]
            page_src = {
                "source_url": page_url,
                "retrieved_at": receipt["retrieved_at"],
                "http_status": 200,
                "retrieval_method": "publisher_page",
                "proxy": None,
            }
            if sec["lob_sha256"] not in objects:
                objects[sec["lob_sha256"]] = {
                    "sha256": sec["lob_sha256"],
                    "bytes": len(raw),
                    "kind": "publisher_original",
                    "path": os.path.abspath(member_path),
                    "sources": [
                        {
                            "source_url": receipt["source_url"],
                            "retrieved_at": receipt["retrieved_at"],
                            "http_status": 200,
                            "retrieval_method": "publisher_zip_member",
                            "proxy": None,
                        },
                        page_src,
                    ],
                }
            text_path = os.path.join(text_dir, sec["text_sha256"] + ".txt")
            if not os.path.exists(text_path):
                with open(text_path, "w", encoding="utf-8") as handle:
                    handle.write(text)
            body = open(text_path, encoding="utf-8").read()
            if sc.sha256_hex(body) != sec["text_sha256"]:
                raise SystemExit("section text hash mismatch: " + sec["id"])
            if sec["text_sha256"] not in objects:
                objects[sec["text_sha256"]] = {
                    "sha256": sec["text_sha256"],
                    "bytes": len(body.encode("utf-8")),
                    "kind": "unit_text_derivative",
                    "path": os.path.abspath(text_path),
                    "sources": [page_src],
                }
            uid = unit_key(sec["id"])
            units.append(
                {
                    "unit_key": uid,
                    "unit_kind": cfg.get("unit_kind", "page"),
                    "heading": sec.get("heading"),
                    "original_sha256": sec["lob_sha256"],
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
                    "source_url": page_url,
                    "retrieved_at": receipt["retrieved_at"],
                    "retrieval_method": "publisher_page",
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
                    "source_url": page_url,
                }
            )

    pats = [re.compile(x) for x in manifest["retrieval"]["source_url_patterns"]]
    for obj in objects.values():
        for src in obj["sources"]:
            if not any(p.search(src["source_url"]) for p in pats):
                raise SystemExit("source URL not covered by manifest patterns: " + src["source_url"])
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1, sort_keys=True)
    write(os.path.join(out, "objects.jsonl"), sorted(objects.values(), key=lambda o: o["sha256"]))
    write(os.path.join(out, "units.jsonl"), units)
    write(os.path.join(out, "sections.jsonl"), secs)
    json.dump(gaps, open(os.path.join(out, "gaps.json"), "w"), indent=1)
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
