#!/usr/bin/env python3
"""Convert a batch-B-style staged state (/tmp/sc/<ST>/parsed + staged + receipts.jsonl) into the
normalized landing packet read by land_publisher_code_v2.py.

Gaps are recorded, never filled: sections with empty text, sections whose original has no HTTP 200
receipt, sections without a derivative, and duplicate citation paths beyond what the occurrence suffix
resolves are written to landing/gaps.jsonl and are not landed.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys

METHOD = {"direct": "publisher_page", "bulk": "publisher_bulk_download", "zip_member": "publisher_zip_member",
          "api": "publisher_api"}


def jl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--root")
    ap.add_argument("--regex", required=True, help="section_id regex for citation_path (use '#<n>' for repeats)")
    ap.add_argument("--example", required=True)
    ap.add_argument("--publisher", required=True)
    ap.add_argument("--publisher-url", required=True)
    ap.add_argument("--code-title", required=True)
    ap.add_argument("--source-system", required=True)
    ap.add_argument("--parser", required=True, help="name/version, e.g. ne-rs-html/1")
    ap.add_argument("--url-pattern", action="append", required=True)
    ap.add_argument("--unit-kind", default="chapter")
    ap.add_argument("--currency-location", required=True)
    ap.add_argument("--citation-format", required=True)
    ap.add_argument("--structure-unit", required=True)
    ap.add_argument("--reviewed-by", default="batch-c lead (Cursor agent)")
    ap.add_argument("--sections", help="override sections.jsonl path")
    ap.add_argument("--placeholders-as-printed-line", action="store_true",
                    help="empty-body placeholders (repealed/transferred...) land with the printed heading line as text (as batch B did); default records them as gaps")
    ap.add_argument("--member-from", default="source.member",
                    choices=("source.member", "title", "id-chapter"),
                    help="how to key staged unit derivatives (default source.member)")
    a = ap.parse_args()
    st = a.state.upper()
    root = a.root or f"/tmp/sc/{st}"
    out = os.path.join(root, "landing")
    os.makedirs(out, exist_ok=True)
    manifest_doc = json.load(open(os.path.join(root, "staged/manifest.json")))
    deriv = {d["member"]: d for d in manifest_doc["derivatives"]}
    receipts = {}
    for r in jl(os.path.join(root, "receipts.jsonl")):
        if r.get("ok") and r.get("status") == 200 and r.get("sha256"):
            receipts.setdefault(r["sha256"], []).append(r)
    name, version = a.parser.split("/")
    rx = re.compile(a.regex)
    assert rx.match(a.example), "example must match regex"

    def row_member(row):
        if a.member_from == "source.member":
            return row["source"]["member"]
        if a.member_from == "title":
            for item in row.get("citation_path") or []:
                if item.get("level") == "title":
                    return str(item.get("number"))
            return None
        title = chapter = None
        for item in row.get("citation_path") or []:
            if item.get("level") == "title":
                title = item.get("number")
            elif item.get("level") == "chapter":
                chapter = item.get("number")
        if title is None or chapter is None:
            return None
        return "%s-%s" % (title, chapter)

    gaps = collections.Counter()
    gap_rows = open(os.path.join(out, "gaps.jsonl"), "w", encoding="utf-8")
    sections, units, levels = [], {}, []
    seen = collections.Counter()
    currency_stmt = set()
    for s in jl(a.sections or os.path.join(root, "parsed/sections.jsonl")):
        src = s["source"]
        member, orig = row_member(s), src["receipt_sha256"]

        def gap(kind):
            gaps[kind] += 1
            gap_rows.write(json.dumps({"kind": kind, "native_id": s["native_id"], "citation": s["citation"], "member": member,
                                       "source_url": src["url"]}, ensure_ascii=False) + "\n")
        if not s["text"]:
            if a.placeholders_as_printed_line and s.get("heading"):
                s = dict(s, text=s["heading"])
                gaps["placeholder_landed_as_printed_line"] += 1
            else:
                gap("empty_text"); continue
        if "\x00" in s["text"]:
            gap("nul_in_text"); continue
        if orig not in receipts:
            gap("original_without_http_200_receipt"); continue
        if member is None:
            gap("no_unit_member"); continue
        if member not in deriv:
            gap("no_unit_derivative"); continue
        key = f"{member}" if True else ""
        ukey = f"{member}:{orig[:12]}"
        d = deriv[member]
        if ukey not in units:
            r = receipts[orig][0]
            body = open(os.path.join(root, "staged", d["path"]), "rb").read()
            units[ukey] = {"unit_key": ukey, "unit_kind": a.unit_kind, "heading": None, "original_sha256": orig,
                           "publisher_member": None, "raw_member_sha256": None, "text_sha256": d["sha256"],
                           "text_code_points": len(body.decode("utf-8")), "sections_expected": 0,
                           "currency": None, "source_url": r["url"], "retrieved_at": r["retrieved_at"],
                           "retrieval_method": METHOD.get(r.get("method_hint", "direct"), "publisher_page"), "proxy": None,
                           "_deriv": d, "_user_agents": sorted({x.get("user_agent", "") for x in receipts[orig]})}
        cp = s["native_id"]
        seen[cp] += 1
        if seen[cp] > 1:
            cp = f"{cp}#{seen[cp]}"
        if not rx.match(cp):
            gap("citation_path_fails_manifest_regex"); continue
        cur = s.get("currency") or {}
        stmt = cur.get("statement") or ""
        as_of = cur.get("as_of")
        through = as_of if isinstance(as_of, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) else None
        currency = {"basis": "publisher_statement" if stmt else "none", "statement": stmt, "through_date": through,
                    "edition": s.get("edition")}
        currency_stmt.add(stmt)
        hier = [{"level": h["level"], "number": h.get("number"), "heading": h.get("heading")} for h in s["citation_path"]]
        for h in hier:
            if h["level"] not in levels:
                levels.append(h["level"])
        sections.append({"unit_key": ukey, "citation_path": cp, "citation": s["citation"], "heading": s["heading"] or None,
                         "text": s["text"], "hierarchy": hier, "history": s.get("history"),
                         "status_note": s.get("status_label"), "span": None, "currency": currency})
        units[ukey]["sections_expected"] += 1
        units[ukey]["currency"] = units[ukey]["currency"] or currency
    gap_rows.close()
    if "section" in levels:
        levels.remove("section")
    levels.append("section")

    # objects: every original and derivative used by a landed unit
    objects = {}
    for u in units.values():
        o = u["original_sha256"]
        if o not in objects:
            rs = receipts[o]
            body_path = os.path.join(root, rs[0]["stored_path"])
            srcs = {}
            for r in rs:
                srcs[(r["url"], r["retrieved_at"])] = {"source_url": r["url"], "retrieved_at": r["retrieved_at"],
                                                         "http_status": 200, "retrieval_method": "publisher_page", "proxy": None}
            objects[o] = {"sha256": o, "bytes": rs[0]["bytes"], "kind": "publisher_original", "path": body_path,
                          "sources": list(srcs.values())[:50]}
        d = u["_deriv"]
        if d["sha256"] not in objects:
            objects[d["sha256"]] = {"sha256": d["sha256"], "bytes": d["bytes"], "kind": "unit_text_derivative",
                                    "path": os.path.join(root, "staged", d["path"]),
                                    "sources": [{"source_url": u["source_url"], "retrieved_at": u["retrieved_at"],
                                                 "http_status": 200, "http_status": 200, "retrieval_method": "publisher_page", "proxy": None}]}
    for o in objects.values():
        assert hashlib.sha256(open(o["path"], "rb").read()).hexdigest() == o["sha256"], o["path"]

    manifest = {
        "schema_version": "publisher-code-manifest/2", "jurisdiction": st, "publisher": a.publisher,
        "publisher_url": a.publisher_url, "source_system": a.source_system, "code_title": a.code_title,
        "parser": {"name": name, "version": version},
        "retrieval": {"methods": ["publisher_page"], "source_url_patterns": a.url_pattern, "terms_gate": False,
                      "official_source": True, "rate_limit_ms": 1000},
        "structure": {"levels": levels, "unit": a.structure_unit},
        "section_id": {"scheme": "official_citation_path", "regex": a.regex, "example": a.example,
                       "citation_format": a.citation_format},
        "currency": {"basis": "publisher_statement", "location": a.currency_location},
        "review": {"reviewed_by": a.reviewed_by, "reviewed_at": __import__("datetime").date.today().isoformat()},
    }
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    with open(os.path.join(out, "objects.jsonl"), "w", encoding="utf-8") as f:
        for o in objects.values():
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    with open(os.path.join(out, "units.jsonl"), "w", encoding="utf-8") as f:
        for u in units.values():
            u = {k: v for k, v in u.items() if not k.startswith("_")}
            u["currency"] = u["currency"] or {"basis": "none", "statement": "", "through_date": None, "edition": None}
            f.write(json.dumps(u, ensure_ascii=False) + "\n")
    with open(os.path.join(out, "sections.jsonl"), "w", encoding="utf-8") as f:
        for s in sections:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    rep = {"state": st, "units": len(units), "sections": len(sections), "objects": len(objects),
           "object_bytes": sum(o["bytes"] for o in objects.values()), "gaps": dict(gaps),
           "currency_statements": sorted(currency_stmt), "levels": levels}
    json.dump(rep, open(os.path.join(out, "packet-report.json"), "w"), indent=1)
    print(json.dumps(rep))


if __name__ == "__main__":
    sys.exit(main())
