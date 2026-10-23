"""Independent checks of the ecfr_full build (writes private/build/ecfr_full/verify_report.json).

  python3 -I -B scripts/enrichment/ecfr_full/verify_ecfr_full.py [--sample 300] [--seed 20261022] [--offline]

1. Row integrity: unique ids, every row's text lines match its layout (table rows have the declared cell count),
   source_url and title present.
2. Counts per title against the eCFR structure API at the same "up to date as of" date: sections, appendices, parts,
   reserved sections.
3. Hierarchy coverage: the published ecfr_hierarchy (2026-09-30 snapshot) must equal the eCFR structure for
   2026-09-30 (per-title md5 of native ids from a read-only corpus query, lookups/hierarchy_hashes.json); every
   section/appendix node in it must have a row with text here, or an explained reason (reserved, graphics only,
   notes only, removed after the snapshot per the eCFR versions, no body in the source).
4. Second fetch path: N random sections/appendices (plus the sections the GovInfo XML prints twice) re-read from the
   eCFR API `full` endpoint at the same date and compared word for word (body and notes) with the stored text.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import random
import sys
import urllib.parse
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import acquire  # noqa: E402
import ecfr_parse as ep  # noqa: E402
import fetchlib as fl  # noqa: E402
from build_ecfr_full import BUILD, flatten, native_path, titles_snapshot  # noqa: E402

HIER_DATE = "2026-09-30"


def load_rows():
    path = os.path.join(BUILD, "ecfr_sections_full.rows.jsonl.gz")
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


def integrity(row: dict) -> str | None:
    if not row.get("title") or not str(row.get("source_url", "")).startswith("https://"):
        return "missing title or source_url"
    layout = row["detail"].get("layout") or []
    lines = row["text"].split("\n") if layout else []  # one layout block with an empty line (a graphic) is text ""
    need = 0
    for entry in layout:
        if entry[0] == "t":
            for k, spec in enumerate(entry[1]):
                cells = spec if isinstance(spec, int) else len(spec)
                if need + k >= len(lines) or len(lines[need + k].split("\t")) != cells:
                    return f"table row {need + k} cell count differs from layout"
            need += len(entry[1])
        else:
            need += 1
    if need != len(lines) or (not layout and row["text"] != ""):
        return f"layout covers {need} lines, text has {len(lines)}"
    return None


def words(s: str) -> list[str]:
    return s.split()


def first_diff(a: list[str], b: list[str]) -> dict:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return {"at_word": i, "stored": " ".join(a[max(0, i - 8): i + 8]), "api": " ".join(b[max(0, i - 8): i + 8])}
    return {"at_word": min(len(a), len(b)), "stored_words": len(a), "api_words": len(b)}


def api_item(title: str, as_of: str, part: str | None, kind: str, ident: str) -> tuple[dict | None, dict]:
    q = {}
    if part:
        q["part"] = part
    q["section" if kind == "section" else "appendix"] = ident
    url = f"https://www.ecfr.gov/api/versioner/v1/full/{as_of}/title-{title}.xml?{urllib.parse.urlencode(q)}"
    rel = "verify/" + hashlib.sha256(url.encode()).hexdigest()[:24] + ".xml.gz"
    man = fl.read_manifest()
    if fl.exists(rel, man):
        body = fl.load(rel)
    else:
        status, body, ctype = fl.get(url, accept="application/xml")
        fl.save(url, rel, body, status, ctype, {"purpose": "verify second path"})
    stats = ep.Stats()
    items = [obj for kind_, obj, _ in ep.iter_title(io.BytesIO(body), stats) if kind_ == "item"]
    return (items, {"url": url, "bytes": len(body)})


def main(argv: list[str]) -> None:
    n_sample = int(argv[argv.index("--sample") + 1]) if "--sample" in argv else 300
    seed = int(argv[argv.index("--seed") + 1]) if "--seed" in argv else 20261022
    offline = "--offline" in argv
    snap, _ = titles_snapshot()
    titles = {str(x["number"]): x for x in snap["titles"] if not x["reserved"]}
    report: dict = {"failures": [], "explained": Counter()}
    fails = report["failures"]

    # 1 + gather
    ids: set[str] = set()
    by_title = defaultdict(Counter)
    by_ident: dict[tuple[str, str, str], dict] = {}
    candidates: list[dict] = []
    for row in load_rows():
        d = row["detail"]
        if row["id"] in ids:
            fails.append({"check": "integrity", "id": row["id"], "problem": "duplicate id"})
        ids.add(row["id"])
        prob = integrity(row)
        if prob:
            fails.append({"check": "integrity", "id": row["id"], "problem": prob})
        t = d["title_number"]
        by_title[t][d["kind"]] += 1
        if d["kind"] != "part":
            if d.get("reserved"):
                by_title[t][d["kind"] + "_reserved"] += 1
            info = {"id": row["id"], "kind": d["kind"], "reserved": d.get("reserved"), "layout": len(d.get("layout") or []),
                    "has_text": bool(row["text"].strip()), "graphics": sum(1 for e in d.get("layout") or [] if e[0] == "g"),
                    "notes": [n[0] for n in d.get("notes") or []], "part": d.get("part"), "identifier": d["identifier"],
                    "title": t, "native_id": d["native_id"]}
            by_ident[(t, d["kind"], d["identifier"])] = info
            if row["text"].strip() and not d.get("reserved"):
                candidates.append({**info, "text": row["text"], "notes_text": [n[1] for n in d.get("notes") or []]})
    report["rows"] = len(ids)

    # 2 counts vs structure
    count_rows = []
    for t, meta in sorted(titles.items(), key=lambda kv: int(kv[0])):
        s = json.loads(fl.load(f"api/structure/{meta['up_to_date_as_of']}/title-{t}.json.gz"))
        leaves, parts = flatten(s)
        exp = Counter(lf["node"]["type"] for lf in leaves)
        exp_res = Counter(lf["node"]["type"] for lf in leaves if lf["node"].get("reserved"))
        got = by_title[t]
        r = {"title": t, "as_of": meta["up_to_date_as_of"], "sections": [got["section"], exp["section"]],
             "appendices": [got["appendix"], exp["appendix"]], "parts": [got["part"], len(parts)],
             "reserved_sections": [got["section_reserved"], exp_res["section"]]}
        count_rows.append(r)
        if got["section"] != exp["section"] or got["appendix"] != exp["appendix"] or got["part"] != len(parts) or \
                got["section_reserved"] != exp_res["section"]:
            fails.append({"check": "counts", **r})
    report["counts"] = count_rows
    report["count_totals"] = {"sections": sum(r["sections"][0] for r in count_rows), "sections_api": sum(r["sections"][1] for r in count_rows),
                              "appendices": sum(r["appendices"][0] for r in count_rows), "appendices_api": sum(r["appendices"][1] for r in count_rows),
                              "parts": sum(r["parts"][0] for r in count_rows), "parts_api": sum(r["parts"][1] for r in count_rows)}

    # 3 hierarchy coverage
    hashes = json.load(open(os.path.join(BUILD, "lookups", "hierarchy_hashes.json")))
    want = {(r["title"], r["kind"]): r for r in hashes["rows"]}
    removed_after: dict[tuple[str, str], str] = {}
    for t in titles:
        for rel in acquire.version_pages(int(t)):
            for v in json.loads(fl.load(rel))["content_versions"]:
                if v["removed"] and HIER_DATE < v["date"] <= titles[t]["up_to_date_as_of"]:
                    removed_after[(t, v["identifier"])] = v["date"]
    hier = {"nodes": 0, "with_text": 0, "explained": Counter(), "unexplained": []}
    for t in sorted(titles, key=int):
        s = json.loads(fl.load(f"api/structure/{HIER_DATE}/title-{t}.json.gz"))
        leaves, _ = flatten(s)
        for kind in ("section", "appendix"):
            nids = sorted((native_path(lf["path"], kind, lf["node"]["identifier"]) for lf in leaves if lf["node"]["type"] == kind),
                          key=lambda x: x.encode("utf-8"))
            h = hashlib.md5("\n".join(nids).encode("utf-8")).hexdigest()
            w = want.get((t, kind))
            if (w is None and nids) or (w is not None and (w["count"] != len(nids) or w["md5_native_ids"] != h)):
                fails.append({"check": "hierarchy_equals_structure", "title": t, "kind": kind, "structure_count": len(nids),
                              "hierarchy_count": w and w["count"], "md5_equal": bool(w) and w["md5_native_ids"] == h})
        for lf in leaves:
            node = lf["node"]
            kind, ident = node["type"], node["identifier"]
            hier["nodes"] += 1
            info = by_ident.get((t, kind, ident))
            if info is None:
                if (t, ident) in removed_after:
                    hier["explained"]["removed after the 2026-09-30 snapshot (eCFR versions)"] += 1
                else:
                    hier["unexplained"].append({"title": t, "kind": kind, "identifier": ident, "reason": "no row"})
                continue
            if info["has_text"]:
                hier["with_text"] += 1
            elif info["reserved"] or node.get("reserved"):
                hier["explained"]["reserved (heading only)"] += 1
            elif info["graphics"]:
                hier["explained"]["graphics only (no text in the source)"] += 1
            elif info["notes"]:
                hier["explained"]["notes only (" + "/".join(sorted(set(info["notes"]))) + ")"] += 1
            elif info["layout"] == 0:
                hier["explained"]["heading only in the source (no body, not marked reserved)"] += 1
            else:
                hier["unexplained"].append({"title": t, "kind": kind, "identifier": ident, "reason": "empty text with layout"})
    hier["explained"] = dict(hier["explained"])
    report["hierarchy"] = hier
    for u in hier["unexplained"]:
        fails.append({"check": "hierarchy_text", **u})

    # 4 second path
    rng = random.Random(seed)
    sample = rng.sample(candidates, min(n_sample, len(candidates)))
    extra = [c for c in candidates if (c["title"], c["identifier"]) in {("7", "1221.128"), ("48", "849.504-70")}]
    second = {"compared": 0, "identical_body": 0, "identical_notes": 0, "mismatches": [], "errors": []}
    if not offline:
        for c in sample + extra:
            t = c["title"]
            try:
                items, meta = api_item(t, titles[t]["up_to_date_as_of"], c["part"], c["kind"], c["identifier"])
            except fl.FetchError as e:
                second["errors"].append({"id": c["id"], "error": str(e)[:200]})
                fails.append({"check": "second_path_fetch", "id": c["id"], "error": str(e)[:200]})
                continue
            if not items:
                second["errors"].append({"id": c["id"], "error": "no item in API response"})
                fails.append({"check": "second_path_empty", "id": c["id"]})
                continue
            api_lines, api_notes = [], []
            for it in items:  # a section printed across volumes comes back in pieces
                api_lines.extend(it["lines"])
                api_notes.extend(n[1] for n in it["notes"])
            second["compared"] += 1
            a, b = words(c["text"]), words("\n".join(api_lines))
            body_ok = a == b
            notes_ok = words(" ".join(c["notes_text"])) == words(" ".join(api_notes))
            second["identical_body"] += body_ok
            second["identical_notes"] += notes_ok
            if not body_ok or not notes_ok:
                m = {"id": c["id"], "url": meta["url"], "body_equal": body_ok, "notes_equal": notes_ok}
                if not body_ok:
                    m["body_diff"] = first_diff(a, b)
                if not notes_ok:
                    m["notes_diff"] = first_diff(words(" ".join(c["notes_text"])), words(" ".join(api_notes)))
                second["mismatches"].append(m)
                fails.append({"check": "second_path_words", **m})
    report["second_path"] = {**second, "sample_size": len(sample), "seed": seed, "extra_checked": [c["id"] for c in extra]}
    report["failure_count"] = len(fails)
    with open(os.path.join(BUILD, "verify_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, default=dict)
    print(json.dumps({"rows": report["rows"], "count_totals": report["count_totals"], "hierarchy": {k: v for k, v in hier.items() if k != "unexplained"},
                      "hierarchy_unexplained": len(hier["unexplained"]),
                      "second_path": {k: v for k, v in report["second_path"].items() if k not in ("mismatches", "errors", "extra_checked")},
                      "failures": len(fails), "failure_checks": Counter(f["check"] for f in fails)}, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main(sys.argv[1:])
