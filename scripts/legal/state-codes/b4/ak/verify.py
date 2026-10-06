"""Verify Alaska staging packet: receipt checksums and section span hashes."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ak")
    a = ap.parse_args()
    work = a.work
    arc = Archive(work)
    bad_receipts = []
    for r in arc.index.values():
        if r.get("state") != "complete":
            continue
        try:
            arc.read(r)
        except SystemExit:
            bad_receipts.append(r["url"])
    pkt = os.path.join(work, "packet")
    ch_text_dir = os.path.join(pkt, "chapter-text")
    bad_spans = []
    sections = []
    with open(os.path.join(pkt, "sections.jsonl")) as f:
        for line in f:
            sections.append(json.loads(line))
    chapters = {json.loads(l)["native_id"]: json.loads(l) for l in open(os.path.join(pkt, "chapters.jsonl"))}
    for s in sections:
        ch = chapters[s["chapter_native_id"]]
        text = open(os.path.join(ch_text_dir, ch["text_sha256"] + ".txt"), encoding="utf-8").read()
        frag = text[s["start"] : s["end"]]
        if sha256_hex(frag) != s["text_sha256"]:
            bad_spans.append(s["citation_path"])
    out = {
        "receipt_checksum_failures": bad_receipts,
        "span_hash_failures": bad_spans,
        "sections_checked": len(sections),
    }
    print(json.dumps(out, indent=1))
    path = os.path.join(work, "verify.json")
    json.dump(out, open(path, "w"), indent=1)
    if bad_receipts or bad_spans:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
