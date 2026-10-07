#!/usr/bin/env python3
"""Build publisher-code-manifest/2 landing packet from Texas parsed ZIP HTML output."""
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

LEVEL_ORDER = ("TITLE", "SUBTITLE", "CHAPTER", "SUBCHAPTER", "ARTICLE")


def chapter_page_url(code: str, member: str) -> str:
    return f"https://statutes.capitol.texas.gov/Docs/{code}/htm/{member}"


def hierarchy_list(code: str, anchor: str, heading: str, labels: dict) -> list:
    out = []
    for key in LEVEL_ORDER:
        if key in labels:
            out.append({"level": key.lower(), "number": None, "heading": labels[key]})
    out.append({"level": "section", "number": f"{code}:{anchor}", "heading": heading})
    return out


def citation_path(code: str, anchor: str, occurrence: int) -> str:
    base = f"{code}:{anchor}"
    return base if occurrence == 1 else f"{base}~{occurrence}"


def convert(root: str, parsed_name: str, cfg: dict):
    root = os.path.abspath(root)
    parsed = os.path.join(root, parsed_name)
    out = os.path.join(root, "landing")
    os.makedirs(out, exist_ok=True)
    members_dir = os.path.join(root, "members")
    os.makedirs(members_dir, exist_ok=True)
    manifest = manifest_from_config(cfg)
    dflt = cfg["currency_defaults"]
    regex = re.compile(cfg["section_id"]["regex"])
    chapters = [json.loads(x) for x in open(os.path.join(parsed, "chapters.jsonl"), encoding="utf-8")]
    sections = [json.loads(x) for x in open(os.path.join(parsed, "sections.jsonl"), encoding="utf-8")]
    objects: dict = {}
    units = []
    secs = []
    gaps = []
    texts: dict = {}
    member_cache: dict = {}

    def member_bytes(code: str, member: str, archive_path: str) -> bytes:
        key = (archive_path, member)
        if key not in member_cache:
            with zipfile.ZipFile(os.path.join(root, archive_path)) as zf:
                member_cache[key] = zf.read(member)
        return member_cache[key]

    for ch in chapters:
        receipt = json.loads(open(os.path.join(root, "receipts", ch["code"] + ".json"), encoding="utf-8").read())
        archive_path = receipt["raw_file"]
        raw = member_bytes(ch["code"], ch["publisher_member"], archive_path)
        if sc.sha256_hex(raw) != ch["raw_member_sha256"]:
            raise SystemExit("raw member hash mismatch: " + ch["id"])
        member_path = os.path.join(members_dir, ch["raw_member_sha256"] + ".htm")
        if not os.path.exists(member_path):
            with open(member_path, "wb") as handle:
                handle.write(raw)
        archive_sha = receipt["sha256"]
        archive_abs = os.path.abspath(os.path.join(root, archive_path))
        zip_src = {
            "source_url": receipt["source_url"],
            "retrieved_at": receipt["retrieved_at"],
            "http_status": 200,
            "retrieval_method": "publisher_bulk_download",
            "proxy": None,
        }
        if archive_sha not in objects:
            objects[archive_sha] = {
                "sha256": archive_sha,
                "bytes": receipt["bytes"],
                "kind": "publisher_original",
                "path": archive_abs,
                "sources": [zip_src],
            }
        page_url = chapter_page_url(ch["code"], ch["publisher_member"])
        page_src = {
            "source_url": page_url,
            "retrieved_at": receipt["retrieved_at"],
            "http_status": 200,
            "retrieval_method": "publisher_page",
            "proxy": None,
        }
        if ch["raw_member_sha256"] not in objects:
            objects[ch["raw_member_sha256"]] = {
                "sha256": ch["raw_member_sha256"],
                "bytes": len(raw),
                "kind": "publisher_original",
                "path": os.path.abspath(member_path),
                "sources": [page_src],
            }
        text_path = os.path.abspath(os.path.join(root, ch["text_file"]))
        body = open(text_path, encoding="utf-8").read()
        if sc.sha256_hex(body) != ch["text_sha256"]:
            raise SystemExit("chapter text hash mismatch: " + ch["id"])
        texts[ch["id"]] = body
        if ch["text_sha256"] not in objects:
            objects[ch["text_sha256"]] = {
                "sha256": ch["text_sha256"],
                "bytes": len(body.encode("utf-8")),
                "kind": "unit_text_derivative",
                "path": text_path,
                "sources": [page_src],
            }
        units.append(
            {
                "unit_key": unit_key(ch["id"]),
                "unit_kind": cfg.get("unit_kind", "page"),
                "heading": ch.get("code_name"),
                "original_sha256": ch["raw_member_sha256"],
                "publisher_member": ch["publisher_member"],
                "raw_member_sha256": ch["raw_member_sha256"],
                "text_sha256": ch["text_sha256"],
                "text_code_points": len(body),
                "sections_expected": ch.get("section_occurrences"),
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

    for sec in sections:
        ch = next(c for c in chapters if c["id"] == sec["chapter_id"])
        text = texts[sec["chapter_id"]]
        slice_ = text[sec["text_start"] : sec["text_end"]]
        if sc.sha256_hex(slice_) != sec["text_sha256"]:
            raise SystemExit("section span mismatch: " + sec["id"])
        if not slice_.strip():
            gaps.append({"citation_path": sec["id"], "reason": "no printed text"})
            continue
        anchor = sec["native_section_anchor"].strip()
        path = citation_path(ch["code"], anchor, sec["occurrence"])
        if not regex.search(path):
            raise SystemExit(f"citation_path {path!r} does not match manifest regex")
        live_url = sec["source_url"] or chapter_page_url(ch["code"], ch["publisher_member"])
        if live_url and "#" not in live_url:
            live_url = f"{chapter_page_url(ch['code'], ch['publisher_member'])}#{anchor}"
        cur = {
            "basis": dflt["basis"],
            "statement": dflt["statement"],
            "through_date": dflt["through_date"],
            "edition": dflt["edition"],
        }
        secs.append(
            {
                "unit_key": unit_key(sec["chapter_id"]),
                "citation_path": path,
                "citation": path.split("~", 1)[0],
                "heading": sec["citation_heading"],
                "text": slice_,
                "hierarchy": hierarchy_list(
                    ch["code"], anchor, sec["citation_heading"], sec.get("hierarchy") or {}
                ),
                "history": None,
                "status_note": None,
                "span": {"unit": "unicode_code_points", "start": sec["text_start"], "end": sec["text_end"]},
                "currency": cur,
                "source_url": live_url,
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
    ap.add_argument("--root", default="/tmp/sc4/tx")
    ap.add_argument("--parsed", default="parsed-v5-20261007")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "landing.json"))
    a = ap.parse_args()
    print(json.dumps(convert(a.root, a.parsed, json.load(open(a.config, encoding="utf-8")))))


if __name__ == "__main__":
    main()
