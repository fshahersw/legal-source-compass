"""Independent verification for Delaware Code staging packet."""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, decode_html, sha256_hex  # noqa: E402

from de_site import UNIT_URL_RE, section_head_count  # noqa: E402


def verify(work):
    arc = Archive(work)
    pkt = os.path.join(work, "packet")
    problems = []
    stats = {
        "raw_complete": 0,
        "raw_bad_hash": 0,
        "sections_staged": 0,
        "content_units": 0,
        "section_heads_html_total": 0,
    }

    for rec in arc.index.values():
        if rec.get("state") != "complete":
            continue
        stats["raw_complete"] += 1
        path = os.path.join(work, rec["file"])
        if not os.path.isfile(path):
            problems.append({"kind": "missing_raw", "url": rec["url"]})
            continue
        with open(path, "rb") as f:
            b = f.read()
        if sha256_hex(b) != rec["sha256"]:
            stats["raw_bad_hash"] += 1
            problems.append({"kind": "raw_hash_mismatch", "url": rec["url"]})

    inv_doc = json.load(open(os.path.join(work, "inventory.json"))) if os.path.isfile(os.path.join(work, "inventory.json")) else {}
    inventory = inv_doc.get("content_units", inv_doc if isinstance(inv_doc, list) else [])
    skipped = inv_doc.get("skipped", [])

    per_page_mismatches = []
    for row in inventory:
        stats["section_heads_html_total"] += row.get("section_heads_html", 0)
        if row.get("section_heads_html") != row.get("parsed_count"):
            per_page_mismatches.append(row)

    ch_by_id = {}
    for line in open(os.path.join(pkt, "chapters.jsonl")):
        ch = json.loads(line)
        ch_by_id[ch["native_id"]] = ch
        stats["content_units"] += 1
        if not ch.get("text_codepoints") and not ch.get("text_sha256"):
            problems.append({"kind": "empty_unit", "native_id": ch["native_id"]})

    span_errors = []
    empty_bodies = []
    for line in open(os.path.join(pkt, "sections.jsonl")):
        s = json.loads(line)
        stats["sections_staged"] += 1
        ch = ch_by_id.get(s["chapter_native_id"])
        if not ch:
            span_errors.append({"citation_path": s["citation_path"], "error": "missing unit"})
            continue
        text_path = os.path.join(pkt, "chapter-text", ch["text_sha256"] + ".txt")
        text = open(text_path, encoding="utf-8").read()
        slice_ = text[s["start"] : s["end"]]
        if sha256_hex(slice_) != s["text_sha256"]:
            span_errors.append({"citation_path": s["citation_path"], "error": "span hash"})
        if not slice_.strip() and not s.get("status_label"):
            empty_bodies.append(s["citation_path"])

    # Independent recount on every staged source URL
    independent_heads = 0
    for row in inventory:
        rec = arc.index.get(row["url"])
        if rec:
            html = decode_html(arc.read(rec))[0]
            independent_heads += section_head_count(html)

    failed_acquire = json.load(open(os.path.join(work, "acquire_failed.json"))) if os.path.isfile(os.path.join(work, "acquire_failed.json")) else []

    out = {
        "ok": (
            not problems
            and not span_errors
            and not per_page_mismatches
            and not failed_acquire
            and stats["sections_staged"] == stats["section_heads_html_total"]
            and stats["sections_staged"] == independent_heads
        ),
        "stats": stats,
        "per_page_section_head_mismatches": per_page_mismatches[:50],
        "section_total_match": stats["sections_staged"] == independent_heads,
        "span_errors": span_errors[:50],
        "empty_bodies": empty_bodies[:50],
        "raw_problems": problems[:50],
        "acquire_failed": failed_acquire,
        "skipped_index_pages": len([x for x in skipped if x.get("kind") == "chapter_index"]),
        "content_units_in_inventory": len(inventory),
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    a = ap.parse_args()
    r = verify(a.work)
    out_path = os.path.join(a.work, "verify_result.json")
    json.dump(r, open(out_path, "w"), indent=1)
    print(json.dumps(r, indent=1))


if __name__ == "__main__":
    main()
