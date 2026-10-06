#!/usr/bin/env python3
"""Turn retained govinfo section pages into `uscode-section-text/1` ingest envelopes (offline).

Reads --work/usc_targets.json + usc_acquisition.json + usc_raw/*, writes --work/usc_packets/{entities.jsonl,batches/,resolution.json,manifest.json}.
Each target is classified once: acquired | granule_not_found | identity_mismatch | not_acquired. A page whose own documentid disagrees
with the section the citation named is never admitted.
"""
import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ecfr_text_lib import normalize_section_number, sha256_hex  # noqa: E402
from uscode_text_lib import build_entity, parse_section_page  # noqa: E402

MAX_BATCH_ROWS = 300
MAX_BATCH_BYTES = 1_500_000


def identity_ok(parsed, target):
    """The page's own documentid must name the cited section: equal, or a govinfo range/bracketed granule that starts at it."""
    if parsed["title_number"] != str(target["title"]):
        return False
    have = normalize_section_number(parsed["section_number"]).lstrip("[")
    want = normalize_section_number(target["section"])
    return have == want or have.startswith(want + "_to_") or have.startswith(want + ",_")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    a = ap.parse_args()
    work = a.work
    targets = json.load(open(os.path.join(work, "usc_targets.json")))
    man = {}
    for name in sorted(os.listdir(work)):
        if name == "usc_acquisition.json" or (name.startswith("usc_acquisition.shard") and name.endswith(".json")):
            for key, e in json.load(open(os.path.join(work, name)))["granules"].items():
                if key not in man or e["state"] == "complete":
                    man[key] = e
    entities, resolution = [], []
    for t in targets:
        row = {"title": t["title"], "section": t["section"], "granule": t["granule"]}
        e = man.get(t["granule"])
        if not e:
            row["status"] = "not_acquired"
        elif e["state"] == "not_found":
            row["status"] = "granule_not_found"
        elif e["state"] != "complete":
            row["status"] = "not_acquired"
        else:
            raw = open(os.path.join(work, e["file"]), "rb").read()
            if sha256_hex(raw) != e["sha256"]:
                raise SystemExit("retained original failed checksum: " + t["granule"])
            parsed = parse_section_page(raw)
            if not identity_ok(parsed, t):
                row["status"] = "identity_mismatch"
                row["page_document_id"] = parsed["document_id"]
            else:
                ent = build_entity(parsed=parsed, target=t, raw_sha256=e["sha256"], raw_bytes_len=e["bytes"], source_url=e["url"],
                                   retrieved_at=e["retrieved_at"], http_status=e["http_status"], route=e["route"])
                entities.append(ent)
                row["status"] = "acquired"
                row["native_id"] = ent["native_id"]
        resolution.append(row)
    entities.sort(key=lambda x: x["native_id"].encode("utf-8"))
    if len({x["native_id"] for x in entities}) != len(entities):
        raise SystemExit("duplicate native ids")
    out = os.path.join(work, "usc_packets")
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
        for ent in entities:
            line = json.dumps(ent, ensure_ascii=False, separators=(",", ":"))
            f.write(line + "\n")
            n = len(line.encode("utf-8")) + 1
            if cur and (len(cur) >= MAX_BATCH_ROWS or size + n > MAX_BATCH_BYTES):
                flush()
            cur.append(ent)
            size += n
    flush()
    summary = {
        "schema_version": "uscode-section-text/1", "targets": len(resolution),
        "status": dict(sorted(collections.Counter(r["status"] for r in resolution).items())),
        "entities": len(entities), "batches": len(batches),
        "editions": sorted({e["data"]["edition"] for e in entities}),
        "current_through_dates": sorted({e["data"]["current_through"] for e in entities}),
        "titles": len({e["data"]["title_number"] for e in entities}),
        "repealed_or_transferred": sum(1 for e in entities if e["data"]["repealed"]),
        "text_empty": sum(1 for e in entities if not e["data"]["text"]),
        "proxied_fetch": sum(1 for e in entities if e["data"]["proxied_fetch"]),
        "entity_bytes": sum(len(json.dumps(e, ensure_ascii=False)) for e in entities),
        "entities_sha256": sha256_hex("\n".join(e["native_id"] + ":" + e["provenance"]["record_sha256"] for e in entities)),
    }
    json.dump(resolution, open(os.path.join(out, "resolution.json"), "w"))
    json.dump({"summary": summary, "batches": batches}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
