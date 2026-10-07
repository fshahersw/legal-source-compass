#!/usr/bin/env python3
"""Expand ME staged packet (chapter-merged units) into one section HTML page per landing unit."""
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
        hist = (s.get("history") or "").strip()
        if hist:
            trimmed = body.rstrip()
            if trimmed.endswith(hist):
                body = trimmed[: -len(hist)].rstrip()
            elif hist in trimmed:
                body = trimmed.split(hist, 1)[0].rstrip()
        uid = s["citation_path"]
        chapters.append(
            {
                "native_id": uid,
                "state": "ME",
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
        "ME",
        source=man.get("source", "https://legislature.maine.gov/statutes/homepage.html"),
        edition=man.get("edition", "Maine Revised Statutes"),
        chapters=chapters,
        sections=secs,
        extra={"derived_from": "packet-chapter", "currency": man.get("currency")},
    )
    return {"packet_landing": os.path.join(landing_work, "packet"), **staged}


if __name__ == "__main__":
    work = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/me"
    print(json.dumps(prepare(work), indent=1))
