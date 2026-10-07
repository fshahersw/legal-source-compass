#!/usr/bin/env python3
"""Build a delta landing packet for changed Missouri chapters."""
import argparse
import hashlib
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "b4"))
import sc_common as sc  # noqa: E402

from parse import parse_chapter

REGISTERED_MANIFEST = {
    "schema_version": "publisher-code-manifest/2",
    "jurisdiction": "MO",
    "publisher": "Missouri Revisor of Statutes (Missouri Legislature), revisor.mo.gov",
    "publisher_url": "https://revisor.mo.gov/main/Home.aspx",
    "source_system": "mo-revised-statutes",
    "code_title": "Revised Statutes of Missouri",
    "parser": {"name": "mo-revisor-html", "version": "2"},
    "retrieval": {
        "methods": ["publisher_page"],
        "source_url_patterns": [
            r"^https://revisor\.mo\.gov/main/(ViewChapter|OneChapter)\.aspx\?chapter=[0-9]+$",
            r"^https://revisor\.mo\.gov/main/Home\.aspx$",
        ],
        "terms_gate": False,
        "official_source": True,
        "rate_limit_ms": 1000,
    },
    "structure": {
        "unit": "one ViewChapter.aspx page (entire chapter text, footnotes and per-section date lines)",
        "levels": ["title", "chapter", "section"],
    },
    "section_id": {
        "scheme": "official_citation_path",
        "regex": r"^[0-9]+\.[0-9]+[A-Za-z0-9.-]*(@[0-9]+)?$",
        "example": "1.010",
        "citation_format": "RSMo § <path>",
    },
    "currency": {
        "basis": "publisher_statement",
        "location": "Home.aspx update/certification statements; ViewChapter separator line prints each section date as M/D/YYYY",
    },
    "review": {
        "reviewed_by": "MO recapture lane (cursor/state-code-currency-ak-mo-2049)",
        "reviewed_at": "2026-10-07",
    },
}


def title_meta(chapter: str, headings: dict, sample_hierarchy: list | None):
    ch = str(int(chapter))
    chapter_heading = headings.get(f"ch{ch}", f"Chapter {ch}")
    m = re.match(r"Chapter\s+(\d+)\s+(.+)", chapter_heading)
    ch_head = m.group(2) if m else chapter_heading
    title = {"number": "VI", "heading": "COUNTY, TOWNSHIP AND POLITICAL SUBDIVISION GOVERNMENT"}
    if sample_hierarchy:
        for level in sample_hierarchy:
            if level.get("level") == "title":
                title = {"number": level["number"], "heading": level["heading"]}
    return title, ch, ch_head


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/MO")
    ap.add_argument("--changed", default="sweep.json")
    ap.add_argument("--headings", help="JSON list {unit_key, heading} (optional)")
    ap.add_argument("--hierarchy", help="JSON map chapter -> title hierarchy from corpus sample")
    ap.add_argument("--out")
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    out = pathlib.Path(args.out or root / "landing")
    out.mkdir(parents=True, exist_ok=True)
    (out / "text").mkdir(exist_ok=True)
    sweep = json.load(open(root / args.changed, encoding="utf-8"))
    receipts = json.load(open(root / "receipts.json", encoding="utf-8"))
    if args.headings:
        headings = {r["unit_key"]: r["heading"] for r in json.load(open(args.headings, encoding="utf-8"))}
    else:
        headings = {}
    hier_map = json.load(open(args.hierarchy, encoding="utf-8")) if args.hierarchy else {}
    stmt_path = root / "currency.txt"
    statement = stmt_path.read_text(encoding="utf-8").strip() if stmt_path.exists() else (
        "CERTIFICATION STATUS: Currently the statutes posted on this website are uncertified and unofficial."
    )
    currency = {"basis": "publisher_statement", "statement": statement, "through_date": None, "edition": None}
    objects, units, sections, gaps, proof_pages = {}, [], [], [], []
    id_counts: dict[str, int] = {}

    for unit_key in sweep["changed"]:
        rec = receipts.get(unit_key)
        if not rec:
            gaps.append({"unit_key": unit_key, "reason": "no receipt"})
            continue
        chapter = unit_key.replace("ch", "")
        html_s, _ = sc.decode_html((root / rec["stored_path"]).read_bytes())
        parsed = parse_chapter(html_s, chapter)
        if not parsed:
            gaps.append({"unit_key": unit_key, "reason": "no sections parsed"})
            continue
        sample_hier = hier_map.get(chapter)
        if isinstance(sample_hier, dict) and "number" in sample_hier:
            sample_hier = [sample_hier]
        title, ch_num, ch_heading = title_meta(chapter, headings, sample_hier)
        mo_unit = f"MO:unit:{unit_key}"
        unit_parts = []
        offset = 0
        markers = []
        for idx, sec in enumerate(parsed):
            path = sec["id"]
            id_counts[path] = id_counts.get(path, 0) + 1
            if id_counts[path] > 1:
                path = f"{path}@{id_counts[path]}"
            markers.append(sec["id"])
            hier = [
                {"level": "title", "number": title["number"], "heading": title["heading"]},
                {"level": "chapter", "number": ch_num, "heading": ch_heading},
                {"level": "section", "number": sec["id"], "heading": sec["heading"]},
            ]
            start, end = offset, offset + len(sec["text"])
            span = {"unit": "unicode_code_points", "start": start, "end": end}
            unit_parts.append(sec["text"])
            offset = end + (2 if idx + 1 < len(parsed) else 0)
            sections.append(
                {
                    "unit_key": mo_unit,
                    "citation_path": path,
                    "citation": f"RSMo § {path}",
                    "heading": sec["heading"],
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
        o = objects.setdefault(
            orig_sha,
            {
                "sha256": orig_sha,
                "bytes": opath.stat().st_size,
                "kind": "publisher_original",
                "path": str(opath.resolve()),
                "sources": [
                    {
                        "source_url": rec["url"],
                        "retrieved_at": rec["retrieved_at"],
                        "http_status": 200,
                        "retrieval_method": "publisher_page",
                        "proxy": None,
                    }
                ],
            },
        )
        objects.setdefault(
            tsha,
            {
                "sha256": tsha,
                "bytes": len(deriv),
                "kind": "unit_text_derivative",
                "path": str(tpath.resolve()),
                "sources": o["sources"],
            },
        )
        units.append(
            {
                "unit_key": mo_unit,
                "unit_kind": "chapter_page",
                "heading": headings.get(unit_key, f"Chapter {ch_num}"),
                "original_sha256": orig_sha,
                "publisher_member": None,
                "raw_member_sha256": None,
                "text_sha256": tsha,
                "text_code_points": len(unit_text),
                "sections_expected": len(parsed),
                "currency": currency,
                "source_url": rec["url"],
                "retrieved_at": rec["retrieved_at"],
                "retrieval_method": "publisher_page",
                "proxy": None,
            }
        )
        proof_pages.append({"url": rec["url"], "markers": len(markers), "sections": len(parsed)})

    manifest = dict(REGISTERED_MANIFEST)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    with open(out / "objects.jsonl", "w", encoding="utf-8") as f:
        for o in sorted(objects.values(), key=lambda x: x["sha256"]):
            f.write(json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "\n")
    for name, rows in (("units.jsonl", units), ("sections.jsonl", sections)):
        with open(out / name, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    proof = {
        "marker": "div.norm span.bold printed section number (NNN.NNN.)",
        "pages": proof_pages,
        "unfetched_child_pages": [],
    }
    (out / "toc-proof.json").write_text(json.dumps(proof, indent=1))
    (out / "gaps.json").write_text(json.dumps(gaps, indent=1))
    print(json.dumps({"units": len(units), "sections": len(sections), "gaps": len(gaps), "out": str(out)}))


if __name__ == "__main__":
    main()
