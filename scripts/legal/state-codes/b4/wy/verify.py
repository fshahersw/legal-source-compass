"""Verification for staged Wyoming packet."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, sha256_hex  # noqa: E402


def verify_spans(work):
    pkt = os.path.join(work, "packet")
    chapters = {}
    for line in open(os.path.join(pkt, "chapters.jsonl")):
        r = json.loads(line)
        sha = r["text_sha256"]
        with open(os.path.join(pkt, "chapter-text", sha + ".txt"), encoding="utf-8") as f:
            chapters[r["native_id"]] = f.read()
    bad = []
    for line in open(os.path.join(pkt, "sections.jsonl")):
        s = json.loads(line)
        ch = chapters[s["chapter_native_id"]]
        frag = ch[s["start"] : s["end"]]
        if sha256_hex(frag) != s["text_sha256"] or len(frag) != s["end"] - s["start"]:
            bad.append(s["citation_path"])
        if len(frag) == 0 and not s.get("status_label"):
            bad.append("empty:" + s["citation_path"])
    return bad


def verify_receipts(work):
    arc = Archive(work)
    bad = []
    for r in arc.index.values():
        if r.get("state") != "complete":
            continue
        try:
            arc.read(r)
        except SystemExit:
            bad.append(r["url"])
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wy")
    a = ap.parse_args()
    report = {
        "receipt_failures": verify_receipts(a.work),
        "span_failures": verify_spans(a.work),
    }
    path = os.path.join(a.work, "verify.json")
    json.dump(report, open(path, "w"), indent=2)
    print(json.dumps({k: len(v) for k, v in report.items()}))


if __name__ == "__main__":
    main()
