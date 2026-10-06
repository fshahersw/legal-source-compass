"""Independent verification for Delaware Code staging packet."""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def verify(work):
    arc = Archive(work)
    pkt = os.path.join(work, "packet")
    problems = []
    stats = {"raw_complete": 0, "raw_bad_hash": 0, "sections": 0, "chapters": 0}

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

    inv_path = os.path.join(work, "inventory.json")
    inventory = json.load(open(inv_path)) if os.path.isfile(inv_path) else []
    toc_mismatches = []
    for row in inventory:
        if row["toc_count"] != row["parsed_count"]:
            toc_mismatches.append(
                {
                    "url": row["url"],
                    "toc": row["toc_count"],
                    "parsed": row["parsed_count"],
                    "toc_ids": row.get("toc_ids"),
                    "parsed_ids": row.get("parsed_ids"),
                }
            )

    ch_by_id = {}
    for line in open(os.path.join(pkt, "chapters.jsonl")):
        ch = json.loads(line)
        ch_by_id[ch["native_id"]] = ch
        stats["chapters"] += 1

    span_errors = []
    empty_bodies = []
    for line in open(os.path.join(pkt, "sections.jsonl")):
        s = json.loads(line)
        stats["sections"] += 1
        ch = ch_by_id.get(s["chapter_native_id"])
        if not ch:
            span_errors.append({"citation_path": s["citation_path"], "error": "missing chapter"})
            continue
        text_path = os.path.join(pkt, "chapter-text", ch["text_sha256"] + ".txt")
        text = open(text_path, encoding="utf-8").read()
        slice_ = text[s["start"] : s["end"]]
        if sha256_hex(slice_) != s["text_sha256"]:
            span_errors.append({"citation_path": s["citation_path"], "error": "span hash"})
        if not slice_.strip() and not s.get("status_label"):
            empty_bodies.append(s["citation_path"])

    failed_acquire = []
    fp = os.path.join(work, "acquire_failed.json")
    if os.path.isfile(fp):
        failed_acquire = json.load(open(fp))

    out = {
        "ok": not problems and not span_errors and not failed_acquire,
        "stats": stats,
        "toc_mismatches": toc_mismatches,
        "span_errors": span_errors[:50],
        "empty_bodies": empty_bodies[:50],
        "raw_problems": problems[:50],
        "acquire_failed": failed_acquire,
        "inventory_chapters": len(inventory),
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
