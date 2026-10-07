#!/usr/bin/env python3
"""Build a landing packet for changed Illinois acts from /tmp/sc/IL2 sweep output.

    build_packet.py --root /tmp/sc/IL2 --changed sweep.json --out /tmp/sc/IL2/landing
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import urllib.parse

from parse import act_meta, currency_statement, parse_act, path_for

REGISTERED_MANIFEST = {
    "schema_version": "publisher-code-manifest/2",
    "jurisdiction": "IL",
    "publisher": "Illinois General Assembly (ilga.gov)",
    "publisher_url": "https://www.ilga.gov/",
    "source_system": "il-compiled-statutes",
    "code_title": "Illinois Compiled Statutes",
    "parser": {"name": "il-ilcs-act-pages", "version": "3"},
    "retrieval": {
        "methods": ["publisher_page"],
        "source_url_patterns": [
            r"^https://www\.ilga\.gov/Legislation/ILCS/Articles\?ActID=[0-9]+&ChapterID=[0-9]+&Chapter=[^&#]+&MajorTopic=[^&#]+$",
            r"^https://www\.ilga\.gov/legislation/ILCS/details\?[^#]+&ChapAct=FullText$",
            r"^https://www\.ilga\.gov/Legislation/ILCS/Chapters$",
            r"^https://www\.ilga\.gov/Legislation/ILCS/Acts\?ChapterID=[0-9]+&ChapterNumber=[0-9]+&Chapter=[^&#]+&MajorTopic=[^&#]+$",
            r"^https://www\.ilga\.gov/robots\.txt$",
            r"^https://www\.ilga\.gov/Disclaimers$",
        ],
        "terms_gate": False,
        "official_source": True,
        "rate_limit_ms": 10000,
    },
    "structure": {
        "unit": "one act: its Articles page, or the 'View Entire Act' page (details?...&ChapAct=FullText) for acts shown as an article index",
        "levels": ["chapter", "act", "heading", "section"],
    },
    "section_id": {
        "scheme": "official_citation_path",
        "regex": r"^[0-9]+ ILCS [0-9]+(\.[0-9]+)?/[A-Za-z0-9][-A-Za-z0-9 .,;:'()*&§~]{0,120}$",
        "example": "720 ILCS 5/1-1",
        "citation_format": "<chapter> ILCS <act>/<section> as printed, e.g. 720 ILCS 5/1-1; a repeated citation in one run keeps '~<occurrence>'",
    },
    "currency": {
        "basis": "publisher_statement",
        "location": "Notice above the statute text on every Articles / View Entire Act page ('Updating the database of the ILCS is an ongoing process...')",
    },
    "review": {
        "reviewed_by": "IL recapture lane (cursor/state-code-currency-ak-mo-2049)",
        "reviewed_at": "2026-10-07",
    },
}


def load_receipts(root: pathlib.Path) -> dict[str, dict]:
    by_label = {}
    for line in open(root / "receipts.jsonl", encoding="utf-8"):
        r = json.loads(line)
        if not r.get("ok"):
            continue
        label = r.get("label", "")
        if label.startswith("act:"):
            key = label.split(":", 1)[1]
            by_label[key] = r
    return by_label


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/IL2")
    ap.add_argument("--changed", default="sweep.json")
    ap.add_argument("--out")
    ap.add_argument("--manifest", help="registered manifest.json (defaults to corpus-registered IL manifest)")
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    out = pathlib.Path(args.out or root / "landing")
    out.mkdir(parents=True, exist_ok=True)
    (out / "text").mkdir(exist_ok=True)
    sweep = json.load(open(root / args.changed))
    units_meta = {u["unit_key"]: u for u in json.load(open(root / "stored_units.json"))}
    receipts = load_receipts(root)
    stmt = None
    objects, units, sections, gaps, proof_pages = {}, [], [], [], []
    cite_counts: dict[str, int] = {}

    for unit_key in sweep["changed"]:
        rec = receipts.get(unit_key)
        meta = units_meta.get(unit_key)
        if not rec or not meta:
            gaps.append({"unit_key": unit_key, "reason": "missing receipt or metadata"})
            continue
        path = root / rec["stored_path"]
        html = path.read_text(encoding="utf-8", errors="replace")
        if stmt is None:
            stmt = currency_statement(html)
        currency = {"basis": "publisher_statement", "statement": stmt, "through_date": None, "edition": None}
        act = act_meta(html, rec["url"])
        _, parsed = parse_act(html)
        if meta.get("heading"):
            m = re.match(r"(\d+ ILCS [^/.]+)[/.]?\s*(.+)", meta["heading"])
            if m:
                act["act_number"] = act.get("act_number") or m.group(1).strip()
                act["act_heading"] = act.get("act_heading") or m.group(2).strip().rstrip(".")
                act["chapter"]["number"] = act["chapter"].get("number") or m.group(1).split()[0]
        if parsed and not act.get("act_number"):
            cit = parsed[0]["citation"]
            act["act_number"] = " ".join(cit.split()[:2])
            act["chapter"]["number"] = cit.split()[0]
        if not parsed:
            gaps.append({"unit_key": unit_key, "url": rec["url"], "reason": "no sections parsed"})
            continue
        unit_parts = []
        section_rows = []
        offset = 0
        local_counts: dict[str, int] = {}
        markers = []
        for idx, sec in enumerate(parsed):
            local_counts[sec["citation"]] = local_counts.get(sec["citation"], 0) + 1
            cite_counts[sec["citation"]] = cite_counts.get(sec["citation"], 0) + 1
            path_c = path_for(sec["citation"], local_counts[sec["citation"]])
            markers.append(sec["citation"])
            hier = [
                {"level": "chapter", "number": act["chapter"]["number"], "heading": act["chapter"]["heading"]},
                {"level": "act", "number": act["act_number"], "heading": act["act_heading"]},
            ]
            hier += [{"level": "heading", "number": c["number"], "heading": c["heading"]} for c in sec["context"]]
            hier.append({"level": "section", "number": sec["citation"].split("/", 1)[1], "heading": None})
            start = offset
            end = start + len(sec["text"])
            span = {"unit": "unicode_code_points", "start": start, "end": end}
            unit_parts.append(sec["text"])
            offset = end + (2 if idx + 1 < len(parsed) else 0)
            section_rows.append(
                {
                    "unit_key": unit_key,
                    "citation_path": path_c,
                    "citation": sec["citation"],
                    "heading": None,
                    "text": sec["text"],
                    "hierarchy": hier,
                    "history": sec["history"],
                    "status_note": sec["status_note"],
                    "span": span,
                    "currency": currency,
                }
            )
        unit_text = "\n\n".join(unit_parts)
        deriv = unit_text.encode("utf-8")
        tsha = hashlib.sha256(deriv).hexdigest()
        tpath = out / "text" / f"{tsha}.txt"
        if not tpath.exists():
            tpath.write_bytes(deriv)
        orig_sha = rec["sha256"]
        opath = root / rec["stored_path"]
        method = "proxied_fetch" if str(rec.get("retrieval_method", "")).startswith("proxied") else "publisher_page"
        proxy = None
        if method == "proxied_fetch":
            proxy = rec.get("retrieval_method", "").split(":", 1)[-1]

        def add_object(sha, size, kind, fpath, rec):
            o = objects.setdefault(
                sha,
                {"sha256": sha, "bytes": size, "kind": kind, "path": str(fpath.resolve()), "sources": []},
            )
            src = {
                "source_url": rec["url"],
                "retrieved_at": rec["retrieved_at"],
                "http_status": 200,
                "retrieval_method": method,
                "proxy": proxy,
            }
            if src not in o["sources"]:
                o["sources"].append(src)

        add_object(orig_sha, rec["bytes"], "publisher_original", opath, rec)
        add_object(tsha, len(deriv), "unit_text_derivative", tpath, rec)
        units.append(
            {
                "unit_key": unit_key,
                "unit_kind": "act_page",
                "heading": meta.get("heading"),
                "original_sha256": orig_sha,
                "publisher_member": None,
                "raw_member_sha256": None,
                "text_sha256": tsha,
                "text_code_points": len(unit_text),
                "sections_expected": len(section_rows),
                "currency": currency,
                "source_url": rec["url"],
                "retrieved_at": rec["retrieved_at"],
                "retrieval_method": method,
                "proxy": proxy,
            }
        )
        sections.extend(section_rows)
        proof_pages.append({"url": rec["url"], "markers": len(markers), "sections": len(section_rows)})

    manifest = json.load(open(args.manifest, encoding="utf-8")) if args.manifest else dict(REGISTERED_MANIFEST)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    with open(out / "objects.jsonl", "w", encoding="utf-8") as f:
        for o in sorted(objects.values(), key=lambda x: x["sha256"]):
            f.write(json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "\n")
    for name, rows in (("units.jsonl", units), ("sections.jsonl", sections)):
        with open(out / name, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    proof = {
        "marker": "Printed (N ILCS act/section) citation line immediately above each Sec. block",
        "pages": proof_pages,
        "unfetched_child_pages": [],
    }
    (out / "toc-proof.json").write_text(json.dumps(proof, indent=1))
    (out / "gaps.json").write_text(json.dumps(gaps, indent=1))
    print(
        json.dumps(
            {
                "changed_acts": len(sweep["changed"]),
                "units": len(units),
                "sections": len(sections),
                "gaps": len(gaps),
                "objects": len(objects),
                "out": str(out),
            }
        )
    )


if __name__ == "__main__":
    main()
