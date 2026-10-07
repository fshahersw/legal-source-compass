"""Verify archived receipts and staged packet spans."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def main(work="/tmp/sc4/sd"):
    arc = Archive(work)
    bad_receipts = []
    for url, rec in arc.index.items():
        if rec.get("state") != "complete":
            continue
        try:
            arc.read(rec)
        except SystemExit:
            bad_receipts.append(url)
    sec_path = os.path.join(work, "packet", "sections.jsonl")
    bad_spans = []
    if os.path.exists(sec_path):
        ch_text_dir = os.path.join(work, "packet", "chapter-text")
        ch_by_id = {}
        with open(os.path.join(work, "packet", "chapters.jsonl")) as f:
            for line in f:
                ch = json.loads(line)
                ch_by_id[ch["native_id"]] = ch
        with open(sec_path) as f:
            for line in f:
                s = json.loads(line)
                ch = ch_by_id[s["chapter_native_id"]]
                with open(os.path.join(ch_text_dir, ch["text_sha256"] + ".txt"), encoding="utf-8") as tf:
                    text = tf.read()
                frag = text[s["start"] : s["end"]]
                if sha256_hex(frag) != s["text_sha256"]:
                    bad_spans.append(s["citation_path"])
    inv = json.load(open(os.path.join(work, "inventory.json"))) if os.path.exists(os.path.join(work, "inventory.json")) else {}
    out = {
        "receipt_rehash_failures": bad_receipts,
        "span_failures": bad_spans,
        "complete_receipts": sum(1 for r in arc.index.values() if r.get("state") == "complete"),
        "inventory_sections": inv.get("section_count"),
        "routes": {
            "direct": sum(1 for r in arc.index.values() if r.get("route") == "direct" and r.get("state") == "complete"),
            "firecrawl": sum(
                1 for r in arc.index.values() if r.get("route") == "firecrawl" and r.get("state") == "complete"
            ),
        },
    }
    path = os.path.join(work, "verify.json")
    json.dump(out, open(path, "w"), indent=1)
    print(json.dumps(out))
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    main(ap.parse_args().work)
