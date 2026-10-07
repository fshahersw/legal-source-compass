#!/usr/bin/env python3
"""Expand RI staged packet (chapter units with many section pages) into one publisher page per unit for to_landing."""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import write_packet  # noqa: E402


def prepare(work: str, source_packet: str | None = None) -> dict:
    pk = source_packet or os.path.join(work, "packet-chapter")
    if not os.path.isdir(pk):
        pk = os.path.join(work, "packet")
    sections = [json.loads(line) for line in open(os.path.join(pk, "sections.jsonl"), encoding="utf-8")]
    ch_text = {}
    for line in open(os.path.join(pk, "chapters.jsonl"), encoding="utf-8"):
        c = json.loads(line)
        with open(os.path.join(pk, "chapter-text", c["text_sha256"] + ".txt"), encoding="utf-8") as handle:
            ch_text[c["native_id"]] = handle.read()
    chapters, secs = [], []
    for s in sections:
        body = ch_text[s["chapter_native_id"]][s["start"] : s["end"]]
        uid = s["citation_path"]
        chapters.append(
            {
                "native_id": uid,
                "state": "RI",
                "path": s["hierarchy"][:-1],
                "heading": s.get("heading"),
                "text": body,
                "raw_sha256s": [s["source_receipt_sha256"]],
                "source_urls": [s["source_url"]],
                "sections_expected": 1,
            }
        )
        secs.append(
            {
                **{k: v for k, v in s.items() if k not in ("start", "end", "chapter_native_id")},
                "chapter_native_id": uid,
                "start": 0,
                "end": len(body),
            }
        )
    man = json.load(open(os.path.join(pk, "manifest.json"), encoding="utf-8"))
    landing_work = os.path.join(work, "landing-units-work")
    if os.path.isdir(landing_work):
        shutil.rmtree(landing_work)
    staged = write_packet(
        landing_work,
        "RI",
        source=man["source"],
        edition=man["edition"],
        chapters=chapters,
        sections=secs,
        extra={"code_title": man.get("code_title", "Rhode Island General Laws"), "derived_from": "packet-chapter"},
    )
    pkt_out = os.path.join(landing_work, "packet")
    return {"packet_landing": pkt_out, **staged}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/ri"
    print(json.dumps(prepare(work), indent=1))
