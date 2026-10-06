#!/usr/bin/env python3
"""Read-only census of live `open_us_law` dependents that need official-source text.

Reads public.corpus_records through PostgREST (service role from the environment), writes working caches and
`census.json` / `targets.json` into --work (outside the repository). Never writes to the database.
"""
import argparse
import collections
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import pgrest  # noqa: E402
from ecfr_text_lib import normalize_section_number, parse_oul_source_id  # noqa: E402

OUL_ID = re.compile(r"oul:[0-9a-f]{64}")


def cached(path, producer):
    if os.path.exists(path):
        with open(path) as f:
            return [json.loads(line) for line in f]
    rows = list(producer())
    with open(path + ".tmp", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    os.replace(path + ".tmp", path)
    return rows


def hierarchy_index(work):
    path = os.path.join(work, "hier_sections.jsonl")

    def produce():
        yield from pgrest.select_all("ecfr_hierarchy", "id,t:filters->>title_number", extra="&filters->>node_type=eq.section")

    idx = {}
    for r in cached(path, produce):
        p = r["id"][len("ecfr:node:"):]
        m = re.match(r"title-(\d+)/(?:.*/)?part-([^/]+)/(?:.*/)?section-(.+)$", p)
        if m:
            idx[(m.group(1), m.group(3))] = p
    return idx


def oul_metadata(work, ids):
    path = os.path.join(work, "oul_meta.jsonl")
    if os.path.exists(path):
        with open(path) as f:
            return {r["id"]: r for r in map(json.loads, f)}
    out = {}
    uniq = sorted(ids)
    for i in range(0, len(uniq), 80):
        q = "corpus_records?dataset=eq.open_us_law&id=in.(" + ",".join(uniq[i:i + 80]) + ")&select=id,title,filters,metadata:detail->metadata"
        rows, _ = pgrest.request(q)
        for r in rows:
            out[r["id"]] = r
    with open(path, "w") as f:
        for r in out.values():
            f.write(json.dumps(r) + "\n")
    return out


def classify_oul(meta):
    """CFR / US Code / state statute / other from the publisher's own native record, never from caption heuristics."""
    m = (meta or {}).get("metadata") or {}
    sid = m.get("source_id") or ""
    pr = m.get("publisher_record") or {}
    if sid.startswith("CFR_"):
        return "cfr"
    if sid.startswith("USC_"):
        return "usc"
    if str(pr.get("jurisdiction", "")).upper() not in ("", "US"):
        return "state_statute"
    return "other"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", help="write a copy of census.json here (for example a report folder)")
    args = ap.parse_args()
    os.makedirs(args.work, exist_ok=True)

    sections = cached(os.path.join(args.work, "sections.jsonl"), lambda: pgrest.select_all(
        "federal_regulations_sections", "id,title,item,detail,filters", page=500))
    citations = cached(os.path.join(args.work, "citations.jsonl"), lambda: pgrest.select_all(
        "citation_index", "id,title,item,detail", page=1000))
    hier = hierarchy_index(args.work)

    cen = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    slice_total = len(sections)
    with_oul = []
    oul_per_row = collections.Counter()
    mismatched_source_id = []
    cfr_targets = {}
    for r in sections:
        i = r["item"]
        found = set(OUL_ID.findall(json.dumps(r["detail"])))
        if found:
            with_oul.append(r["id"])
        oul_per_row[len(found)] += 1
        for t in r["detail"].get("texts") or []:
            sid = t.get("publisher_source_id")
            if sid:
                tt, pp = parse_oul_source_id(sid)
                expect = "CFR_T%s_P%s_S%s" % (i["title"], i["part"], re.sub(r"[^0-9A-Za-z]", "_", i["section"]))
                if not sid.startswith(expect) or tt != str(i["title"]) or pp != str(i["part"]):
                    mismatched_source_id.append([r["id"], sid])
        key = (str(i["title"]), str(i["part"]), normalize_section_number(i["section"]))
        cfr_targets.setdefault(key, {"title": key[0], "part": key[1], "section": key[2], "from": set()})["from"].add("federal_regulations_sections")
    slice_keys = set(cfr_targets)
    slice_unique = {(t, s) for t, _, s in slice_keys}

    links = {}
    cit_ids = set()
    for r in citations:
        found = set(OUL_ID.findall(json.dumps(r)))
        if found:
            if len(found) != 1:
                raise SystemExit("citation_index row with several oul targets: " + r["id"])
            links[r["id"]] = found.pop()
            cit_ids.add(links[r["id"]])
    meta = oul_metadata(args.work, cit_ids)
    cit_cls = collections.Counter()
    cit_links = {}
    usc_targets = {}
    unresolved_oul = 0
    for cid, oid in links.items():
        m = meta.get(oid)
        if not m:
            unresolved_oul += 1
            cit_cls["oul_record_missing"] += 1
            continue
        k = classify_oul(m)
        cit_cls[k] += 1
        pr = (m["metadata"] or {}).get("publisher_record") or {}
        sid = m["metadata"].get("source_id")
        tt, pp = parse_oul_source_id(sid)
        entry = {"oul_id": oid, "class": k, "source_id": sid, "citation": pr.get("citation"), "title": tt, "part": pp,
                 "section": normalize_section_number(str(pr.get("section_number", ""))) or None}
        cit_links[cid] = entry
        if k == "cfr":
            key = (tt, pp, entry["section"])
            cfr_targets.setdefault(key, {"title": tt, "part": pp, "section": entry["section"], "from": set()})["from"].add("citation_index")
        elif k == "usc":
            key = (tt, entry["section"])
            usc_targets.setdefault(key, {"title": tt, "section": entry["section"], "from": set()})["from"].add("citation_index")

    cfr_cit_sections = {(v["title"], v["section"]) for v in cit_links.values() if v["class"] == "cfr"}
    cen.update({
        "federal_regulations_sections": {
            "rows": slice_total,
            "rows_with_open_us_law_target": len(with_oul),
            "oul_targets_per_row": dict(sorted(oul_per_row.items())),
            "distinct_cfr_sections": len(slice_unique),
            "distinct_cfr_parts": len({(t, p) for t, p, _ in slice_keys}),
            "publisher_source_id_disagreeing_with_row_citation": len(mismatched_source_id),
            "sections_present_in_ecfr_hierarchy_snapshot": sum(1 for t, s in slice_unique if (t, s) in hier),
            "sections_absent_from_ecfr_hierarchy_snapshot": sum(1 for t, s in slice_unique if (t, s) not in hier),
        },
        "citation_index": {
            "rows": len(citations),
            "rows_with_open_us_law_target": len(links),
            "distinct_open_us_law_targets": len(cit_ids),
            "classification": dict(cit_cls),
            "cfr_distinct_sections": len(cfr_cit_sections),
            "cfr_sections_also_in_federal_regulations_sections": len(cfr_cit_sections & slice_unique),
            "cfr_sections_outside_federal_regulations_sections": len(cfr_cit_sections - slice_unique),
            "usc_distinct_sections": len(usc_targets),
            "usc_distinct_titles": len({t for t, _ in usc_targets}),
        },
        "cfr_targets_total_sections": len(cfr_targets),
        "cfr_targets_total_parts": len({(v["title"], v["part"]) for v in cfr_targets.values()}),
    })
    with open(os.path.join(args.work, "targets.json"), "w") as f:
        json.dump({
            "cfr": [dict(v, **{"from": sorted(v["from"])}) for v in sorted(cfr_targets.values(), key=lambda v: (int(v["title"]), v["part"], v["section"]))],
            "usc": [dict(v, **{"from": sorted(v["from"])}) for v in sorted(usc_targets.values(), key=lambda v: (int(v["title"]), v["section"]))],
            "citation_links": cit_links,
        }, f)
    out = json.dumps(cen, indent=1, sort_keys=True)
    with open(os.path.join(args.work, "census.json"), "w") as f:
        f.write(out + "\n")
    if args.out:
        with open(args.out, "w") as f:
            f.write(out + "\n")
    print(out)


if __name__ == "__main__":
    main()
