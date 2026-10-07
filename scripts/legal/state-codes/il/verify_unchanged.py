#!/usr/bin/env python3
"""Prove il-ilcs-act-pages/1 reproduces stored corpus rows on byte-identical act pages."""
import json
import os
import pathlib
import sys

import requests

from parse import parse_act

ROOT = pathlib.Path("/tmp/sc/IL2")


def corpus_sections(act_key: str) -> dict[str, dict]:
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/")
    key = os.environ["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    uid = f"IL:unit:{act_key}"
    q = (
        "select data->>'citation_path' as path, data->>'text' as text, data->>'history' as history "
        "from corpus_ingest.entities where source_system='il-compiled-statutes' "
        f"and entity_type='code-section' and data->>'unit_id'='{uid}'"
    )
    r = requests.post(f"{url}/rest/v1/rpc/execute_sql", headers=h, json={"query": q}, timeout=120)
    if r.status_code >= 400:
        # fallback: direct SQL via rpc if available
        raise RuntimeError(r.text[:300])
    rows = r.json() if r.text.strip().startswith("[") else []
    return {row["path"]: row for row in rows}


def receipt_for(unit_key: str) -> dict:
    for line in open(ROOT / "receipts.jsonl"):
        r = json.loads(line)
        if r.get("label") == f"act:{unit_key}":
            return r
    raise KeyError(unit_key)


def main():
    sweep = json.load(open(ROOT / "sweep.json"))
    sample = sweep["unchanged"][:5]
    bad = []
    for unit_key in sample:
        rec = receipt_for(unit_key)
        html = (ROOT / rec["stored_path"]).read_text(encoding="utf-8", errors="replace")
        _, parsed = parse_act(html)
        paths = {}
        for i, sec in enumerate(parsed, 1):
            from parse import path_for

            paths[path_for(sec["citation"], i if sec["citation"] not in paths else paths.get(sec["citation"], 0) + 1)] = sec
        # recount properly
        counts = {}
        parsed_map = {}
        for sec in parsed:
            counts[sec["citation"]] = counts.get(sec["citation"], 0) + 1
            parsed_map[path_for(sec["citation"], counts[sec["citation"]])] = sec
        stored = corpus_sections(unit_key)
        if set(parsed_map) != set(stored):
            bad.append({"unit": unit_key, "reason": "path_set", "missing": sorted(set(stored) - set(parsed_map))[:5]})
            continue
        for path, row in stored.items():
            p = parsed_map[path]
            if (p["text"], (p["history"] or None)) != (row["text"], row["history"]):
                bad.append({"unit": unit_key, "path": path, "stored_head": row["text"][:80], "parsed_head": p["text"][:80]})
    print(json.dumps({"sampled": len(sample), "bad": bad[:20], "ok": len(sample) - len({b['unit'] for b in bad if b.get('unit')})}))


if __name__ == "__main__":
    main()
