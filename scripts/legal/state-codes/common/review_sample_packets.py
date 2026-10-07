#!/usr/bin/env python3
"""Turn a corpus review-sample export into one sample packet per code for review_publisher_code_v2.py.

The export is one JSON object {samples, neighbors, units, manifests} (see review_sample_export.sql), either bare or inside
the SQL tool's text wrapper. Each packet gets manifest.json, units.jsonl, sections.jsonl (the sampled rows) and
neighbors.jsonl (the next sibling sections of each sampled row's unit, by span). Report-only: nothing is written back.

    review_sample_packets.py export.json --out /tmp/review-samples
"""
import argparse
import json
import os
from collections import defaultdict


def load_export(path):
    raw = open(path, encoding="utf-8").read()
    try:
        doc = json.loads(raw)
    except ValueError:
        doc = None
    if isinstance(doc, dict) and "samples" in doc:
        return doc
    text = doc["result"] if isinstance(doc, dict) and "result" in doc else raw
    start, end = text.find("[{"), text.rfind("}]")
    rows = json.loads(text[start:end + 2])
    return rows[0]["packet"]


def section_row(data, provenance):
    return {"unit_key": data.get("unit_id"), "citation_path": data["citation_path"], "citation": data.get("citation"),
            "heading": data.get("heading"), "text": data["text"], "hierarchy": data.get("hierarchy") or [],
            "history": data.get("history"), "status_note": data.get("status_note"), "span": data.get("span"),
            "currency": data.get("currency"), "source_url": provenance.get("source_url")}


def build(export, out):
    by_code = defaultdict(lambda: {"sections": [], "units": [], "neighbors": [], "manifest": None})
    for m in export.get("manifests") or []:
        by_code[m["source_system"]]["manifest"] = m["manifest"]
    for s in export.get("samples") or []:
        by_code[s["source_system"]]["sections"].append(section_row(s["data"], s["provenance"]))
    for u in export.get("units") or []:
        d, p = u["data"], u["provenance"]
        by_code[u["source_system"]]["units"].append({
            "unit_key": u["native_id"], "unit_kind": d.get("unit_kind"), "heading": d.get("heading"),
            "publisher_member": d.get("publisher_member"), "source_url": p.get("source_url"),
            "retrieval_method": p.get("retrieval_method"), "proxy": p.get("proxy"), "original_sha256": d.get("original_sha256")})
    seen = set()
    for n in export.get("neighbors") or []:
        key = (n["source_system"], n["native_id"])
        if key in seen:
            continue
        seen.add(key)
        by_code[n["source_system"]]["neighbors"].append({
            "unit_key": n["unit_id"], "citation_path": n["citation_path"], "heading": n.get("heading"),
            "text_head": n.get("text_head"), "hierarchy": n.get("hierarchy") or [], "span": n.get("span")})
    summary = {}
    for code, p in sorted(by_code.items()):
        d = os.path.join(out, code)
        os.makedirs(d, exist_ok=True)
        if p["manifest"] is None:
            raise SystemExit(f"{code}: no manifest in the export")
        json.dump(p["manifest"], open(os.path.join(d, "manifest.json"), "w"), ensure_ascii=False, indent=1)
        for name in ("units", "sections", "neighbors"):
            with open(os.path.join(d, name + ".jsonl"), "w", encoding="utf-8") as f:
                for row in p[name]:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
        missing = {s["unit_key"] for s in p["sections"]} - {u["unit_key"] for u in p["units"]}
        if missing:
            raise SystemExit(f"{code}: sampled sections reference units not in the export: {sorted(missing)[:3]}")
        summary[code] = {k: len(p[k]) for k in ("sections", "units", "neighbors")}
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    print(json.dumps(build(load_export(a.export), a.out), indent=1))


if __name__ == "__main__":
    main()
