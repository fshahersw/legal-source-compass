"""Independent verification for NH RSA staging packet."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def verify(work):
    arc = Archive(work)
    packet = os.path.join(work, "packet")
    issues = []
    # (c) receipt hashes
    for url, rec in arc.index.items():
        if rec.get("state") == "complete":
            try:
                arc.read(rec)
            except SystemExit:
                issues.append({"kind": "receipt_hash", "url": url})

    chapters = {}
    with open(os.path.join(packet, "chapters.jsonl")) as f:
        for line in f:
            c = json.loads(line)
            chapters[c["native_id"]] = c
    chapter_text = {}
    for c in chapters.values():
        p = os.path.join(packet, "chapter-text", c["text_sha256"] + ".txt")
        with open(p, encoding="utf-8") as tf:
            chapter_text[c["native_id"]] = tf.read()

    span_issues = []
    with open(os.path.join(packet, "sections.jsonl")) as f:
        sec_rows = [json.loads(line) for line in f]
    for s in sec_rows:
        ch = chapter_text[s["chapter_native_id"]]
        slice_ = ch[s["start"] : s["end"]]
        if sha256_hex(slice_) != s["text_sha256"]:
            span_issues.append(s["citation_path"])
        if not slice_.strip() and not s.get("status_label"):
            span_issues.append(f"empty:{s['citation_path']}")

    # (b) TOC vs parsed per chapter
    toc_mismatch = []
    if os.path.exists(os.path.join(work, "inventory.jsonl")):
        from collections import Counter

        toc_counts = Counter()
        with open(os.path.join(work, "inventory.jsonl")) as f:
            for line in f:
                r = json.loads(line)
                if r.get("chapter_key"):
                    toc_counts[r["chapter_key"]] += 1
        parsed_counts = Counter(s["chapter_native_id"] for s in sec_rows)
        for ck in sorted(set(toc_counts) | set(parsed_counts)):
            if toc_counts[ck] != parsed_counts[ck]:
                toc_mismatch.append(
                    {"chapter_key": ck, "toc": toc_counts[ck], "parsed": parsed_counts[ck]}
                )

    report = {
        "receipt_hash_failures": len([i for i in issues if i["kind"] == "receipt_hash"]),
        "span_hash_failures": len(span_issues),
        "span_issues_sample": span_issues[:20],
        "toc_mismatches": toc_mismatch,
        "sections": len(sec_rows),
        "chapters": len(chapters),
    }
    json.dump(report, open(os.path.join(work, "verify_report.json"), "w"), indent=1)
    return report


if __name__ == "__main__":
    print(json.dumps(verify(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nh"), indent=1))
