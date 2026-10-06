#!/usr/bin/env python3
"""Turn retained eCFR part responses into `ecfr-section-text/1` ingest envelopes for every cited CFR section.

Offline: reads --work/raw, acquisition.json, targets.json and hier_sections.jsonl; writes --work/packets/*.
Each target is classified exactly once: acquired | reserved_in_ecfr | part_not_in_ecfr | section_not_in_ecfr | title_unavailable.
"""
import argparse
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ecfr_text_lib import (  # noqa: E402
    build_entity, normalize_section_number, parse_section_fragment, section_fragments, sha256_hex,
)

MAX_BATCH_ROWS = 400
MAX_BATCH_BYTES = 1_500_000


def hierarchy_paths(work):
    idx = {}
    p = os.path.join(work, "hier_sections.jsonl")
    if not os.path.exists(p):
        return idx
    with open(p) as f:
        for line in f:
            r = json.loads(line)
            path = r["id"][len("ecfr:node:"):]
            m = re.match(r"title-(\d+)/(?:.*/)?part-([^/]+)/(?:.*/)?section-(.+)$", path)
            if m:
                idx[(m.group(1), m.group(2), normalize_section_number(m.group(3)))] = path
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    args = ap.parse_args()
    work = args.work
    man = json.load(open(os.path.join(work, "acquisition.json")))
    targets = json.load(open(os.path.join(work, "targets.json")))["cfr"]
    hier = hierarchy_paths(work)
    titles = man["titles"]["by_number"]

    part_cache = {}

    def load_part(title, part):
        key = f"title-{title}-part-{part}"
        e = man["parts"].get(key)
        if not e:
            return None, "not_attempted"
        if e["state"] != "complete":
            return None, e["state"]
        if key not in part_cache:
            raw = open(os.path.join(work, e["file"]), "rb").read()
            if sha256_hex(raw) != e["sha256"]:
                raise SystemExit("retained original failed checksum: " + key)
            frags = collections.defaultdict(list)
            for number, start, end, frag in section_fragments(raw):
                frags[normalize_section_number(number)].append((start, end, frag))
            part_cache[key] = (e, raw, frags)
        return part_cache[key], None

    entities, resolution = [], []
    for t in targets:
        title, part, section = t["title"], t["part"], t["section"]
        row = {"title": title, "part": part, "section": section, "from": t["from"]}
        meta = titles.get(title)
        if not meta or meta.get("reserved"):
            row["status"] = "title_unavailable"
            resolution.append(row)
            continue
        loaded, why = load_part(title, part)
        if loaded is None:
            row["status"] = "part_not_in_ecfr" if why == "not_found" else "part_not_acquired:" + str(why)
            resolution.append(row)
            continue
        e, raw, frags = loaded
        found = frags.get(normalize_section_number(section))
        if not found:
            row["status"] = "section_not_in_ecfr"
            resolution.append(row)
            continue
        if len(found) != 1:
            row["status"] = "ambiguous_section"
            resolution.append(row)
            continue
        start, end, frag = found[0]
        parsed = parse_section_fragment(frag)
        ent = build_entity(
            title=title, part=part, section_number=section, parsed=parsed, raw_sha256=e["sha256"], raw_bytes_len=e["bytes"],
            start=start, end=end, fragment=frag, as_of=e["as_of"], title_meta=meta, source_url=e["url"],
            retrieved_at=e["retrieved_at"], http_status=e["http_status"],
            hierarchy_native_id=hier.get((title, part, normalize_section_number(section))),
        )
        row["status"] = "reserved_in_ecfr" if ent["data"]["reserved"] else "acquired"
        row["native_id"] = ent["native_id"]
        resolution.append(row)
        entities.append(ent)

    entities.sort(key=lambda e: e["native_id"].encode("utf-8"))
    if len({e["native_id"] for e in entities}) != len(entities):
        raise SystemExit("duplicate native ids")
    out = os.path.join(work, "packets")
    os.makedirs(os.path.join(out, "batches"), exist_ok=True)
    for stale in os.listdir(os.path.join(out, "batches")):
        os.remove(os.path.join(out, "batches", stale))
    batches, cur, size = [], [], 0

    def flush():
        nonlocal cur, size
        if not cur:
            return
        name = f"batch-{len(batches):05d}.json"
        body = json.dumps(cur, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(out, "batches", name), "w", encoding="utf-8") as f:
            f.write(body)
        batches.append({"name": name, "records": len(cur), "bytes": len(body.encode("utf-8")), "sha256": sha256_hex(body),
                        "first": cur[0]["native_id"], "last": cur[-1]["native_id"]})
        cur, size = [], 0

    with open(os.path.join(out, "entities.jsonl"), "w", encoding="utf-8") as f:
        for e in entities:
            line = json.dumps(e, ensure_ascii=False, separators=(",", ":"))
            f.write(line + "\n")
            n = len(line.encode("utf-8")) + 1
            if cur and (len(cur) >= MAX_BATCH_ROWS or size + n > MAX_BATCH_BYTES):
                flush()
            cur.append(e)
            size += n
    flush()

    status_counts = collections.Counter(r["status"] for r in resolution)
    by_origin = collections.defaultdict(collections.Counter)
    for r in resolution:
        for o in r["from"]:
            by_origin[o][r["status"]] += 1
    summary = {
        "schema_version": "ecfr-section-text/1",
        "targets": len(resolution),
        "status": dict(sorted(status_counts.items())),
        "by_origin": {k: dict(sorted(v.items())) for k, v in sorted(by_origin.items())},
        "entities": len(entities),
        "batches": len(batches),
        "as_of_dates": sorted({e["data"]["as_of"] for e in entities}),
        "entities_sha256": sha256_hex("\n".join(e["native_id"] + ":" + e["provenance"]["record_sha256"] for e in entities)),
        "hierarchy_linked": sum(1 for e in entities if e["data"]["hierarchy_native_id"]),
        "text_empty": sum(1 for e in entities if not e["data"]["text"]),
        "with_non_text_elements": sum(1 for e in entities if e["data"]["non_text_elements"]),
    }
    json.dump(resolution, open(os.path.join(out, "resolution.json"), "w"))
    json.dump({"summary": summary, "batches": batches}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
