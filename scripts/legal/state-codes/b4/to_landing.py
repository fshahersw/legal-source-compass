#!/usr/bin/env python3
"""Convert a batch-4 staged packet (sc_common.write_packet) into the shared landing packet for
scripts/legal/state-codes/common/land_publisher_code_v2.py (spec: internal/state-codes/batch-c/LANDING-PACKET.md).

    to_landing.py --work /tmp/sc4/nh --config scripts/legal/state-codes/b4/nh/landing.json

landing.json carries the reviewed publisher-code-manifest/2 fields plus `currency_defaults` {basis, statement, through_date, edition}
(used when a section has no own currency) and optional `unit_kind`, `default_method`, `method_rules` [{pattern, method}].
Output: <work>/landing/{manifest,objects,units,sections}.jsonl|json. Sections with no printed text are listed in landing/gaps.json
and never invented. Repeated official citations get an occurrence suffix `~N` (the manifest regex must allow it).
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import sc_common as sc  # noqa: E402


def method_for(cfg, url, route):
    if route != "direct":
        return "proxied_fetch", route
    for rule in cfg.get("method_rules", []):
        if re.search(rule["pattern"], url):
            return rule["method"], None
    return cfg.get("default_method", "publisher_page"), None


def unit_key(cid):
    return re.sub(r"[^A-Za-z0-9._:-]+", "_", cid)[:300]


def manifest_from_config(cfg):
    return {"schema_version": "publisher-code-manifest/2", "jurisdiction": cfg["jurisdiction"], "publisher": cfg["publisher"],
            "publisher_url": cfg["publisher_url"], "source_system": cfg["source_system"], "code_title": cfg["code_title"],
            "parser": cfg["parser"],
            "retrieval": {"methods": cfg.get("methods", ["publisher_page"]), "source_url_patterns": cfg["source_url_patterns"],
                          "terms_gate": False, "official_source": True, "rate_limit_ms": cfg.get("rate_limit_ms", 1000)},
            "structure": cfg["structure"], "section_id": cfg["section_id"], "currency": cfg["currency"], "review": cfg["review"]}


def write(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")


def convert(work, cfg):
    pk = os.path.join(work, "packet")
    chapters = [json.loads(x) for x in open(os.path.join(pk, "chapters.jsonl"), encoding="utf-8")]
    sections = [json.loads(x) for x in open(os.path.join(pk, "sections.jsonl"), encoding="utf-8")]
    arc = sc.Archive(work)
    by_sha = {}
    for r in arc.index.values():
        if r.get("state") == "complete":
            by_sha.setdefault(r["sha256"], r)
    out = os.path.join(work, "landing")
    os.makedirs(out, exist_ok=True)
    manifest = manifest_from_config(cfg)
    dflt = cfg["currency_defaults"]
    objects, units, secs, gaps = {}, [], [], []
    text = {}
    empty_units = set()
    for c in chapters:
        if c["text_codepoints"] == 0:
            empty_units.add(c["native_id"])
            gaps.append({"unit": c["native_id"], "reason": "chapter page has no extractable text; a source unit needs a non-empty text derivative"})
            continue
        shas = c["raw_sha256s"]
        if len(shas) != 1:
            raise SystemExit(f"{c['native_id']}: a unit must come from exactly one retained original; split it")
        raw = by_sha[shas[0]]
        for u in c.get("source_urls") or []:
            r = arc.index.get(u)
            if r and r.get("state") == "complete" and r["sha256"] == shas[0]:
                raw = r
                break
        method, proxy = method_for(cfg, raw["url"], raw["route"])
        src = {"source_url": raw["url"], "retrieved_at": raw["retrieved_at"], "http_status": 200, "retrieval_method": method, "proxy": proxy}
        orig = objects.setdefault(shas[0], {"sha256": shas[0], "bytes": raw["bytes"], "kind": "publisher_original",
                                            "path": os.path.abspath(os.path.join(work, raw["file"])), "sources": []})
        if src not in orig["sources"]:
            orig["sources"].append(src)
        tpath = os.path.abspath(os.path.join(pk, "chapter-text", c["text_sha256"] + ".txt"))
        body = open(tpath, encoding="utf-8").read()
        if sc.sha256_hex(body) != c["text_sha256"] or len(body) != c["text_codepoints"]:
            raise SystemExit("chapter text failed hash/length: " + c["native_id"])
        text[c["native_id"]] = body
        o = objects.setdefault(c["text_sha256"], {"sha256": c["text_sha256"], "bytes": len(body.encode("utf-8")), "kind": "unit_text_derivative",
                                                  "path": tpath, "sources": []})
        if src not in o["sources"]:
            o["sources"].append(src)
        units.append({"unit_key": unit_key(c["native_id"]), "unit_kind": cfg.get("unit_kind", "page"), "heading": c.get("heading"),
                      "original_sha256": shas[0], "publisher_member": c.get("publisher_member"), "raw_member_sha256": c.get("raw_member_sha256"),
                      "text_sha256": c["text_sha256"], "text_code_points": c["text_codepoints"], "sections_expected": c.get("sections_expected"),
                      "currency": {"basis": dflt["basis"], "statement": dflt["statement"], "through_date": dflt["through_date"], "edition": dflt["edition"]},
                      "source_url": raw["url"], "retrieved_at": raw["retrieved_at"], "retrieval_method": method, "proxy": proxy})
    regex = re.compile(cfg["section_id"]["regex"])
    seen = {}
    for s in sections:
        if s["chapter_native_id"] in empty_units:
            raise SystemExit("section staged inside an empty chapter: " + s["citation_path"])
        t = text[s["chapter_native_id"]][s["start"]:s["end"]]
        if sc.sha256_hex(t) != s["text_sha256"]:
            raise SystemExit("section span hash mismatch: " + s["citation_path"])
        if not t.strip() or "\x00" in t:
            gaps.append({"citation_path": s["citation_path"], "reason": "no printed text" if not t.strip() else "NUL in text"})
            continue
        path = s["citation_path"]
        seen[path] = seen.get(path, 0) + 1
        if seen[path] > 1:
            path = f"{path}~{seen[path]}"
        if not regex.search(path):
            raise SystemExit(f"citation_path {path!r} does not match the manifest regex")
        scur = s.get("currency") or {}
        stmt = scur.get("statement") or dflt["statement"]
        cur = {"basis": dflt["basis"] if stmt else "none", "statement": stmt or "", "through_date": scur.get("as_of") or dflt["through_date"],
               "edition": s.get("edition") or dflt["edition"]}
        if cur["basis"] == "none":
            cur["through_date"] = None
        span = {"unit": "unicode_code_points", "start": s["start"], "end": s["end"]} if s["end"] - s["start"] == len(t) else None
        secs.append({"unit_key": unit_key(s["chapter_native_id"]), "citation_path": path, "citation": s["citation"], "heading": s.get("heading"),
                     "text": t, "hierarchy": s["hierarchy"], "history": s.get("history"), "status_note": s.get("status_label"),
                     "span": span, "currency": cur})
    pats = [re.compile(x) for x in manifest["retrieval"]["source_url_patterns"]]
    for o in objects.values():
        for src in o["sources"]:
            if not any(p.search(src["source_url"]) for p in pats):
                raise SystemExit("source URL not covered by the manifest patterns: " + src["source_url"])
            if src["retrieval_method"] not in manifest["retrieval"]["methods"]:
                raise SystemExit("retrieval method not declared in the manifest: " + src["retrieval_method"])
    if not re.search(manifest["section_id"]["regex"], manifest["section_id"]["example"]):
        raise SystemExit("section_id example does not match its regex")
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1, sort_keys=True)
    write(os.path.join(out, "objects.jsonl"), sorted(objects.values(), key=lambda o: o["sha256"]))
    write(os.path.join(out, "units.jsonl"), units)
    write(os.path.join(out, "sections.jsonl"), secs)
    json.dump(gaps, open(os.path.join(out, "gaps.json"), "w"), indent=1)
    return {"landing": out, "objects": len(objects), "units": len(units), "sections": len(secs), "gaps_no_text": len(gaps)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    ap.add_argument("--config", required=True)
    a = ap.parse_args()
    print(json.dumps(convert(a.work, json.load(open(a.config)))))


if __name__ == "__main__":
    main()
