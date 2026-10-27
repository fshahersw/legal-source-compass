#!/usr/bin/env python3
"""Build the keyword-release plan for document-titles/2026-10-27.1 from local snapshots. No network, no credentials.

Owner decision 2026-10-27 ("dont withhold any data. If its accurate and valuable, USE IT"): the 64 court_documents titles that run
dc2371a4 (document-titles/2026-10-06.1) withheld with reason policy_withheld, only because the first-page wording mentions sealed,
restricted, in camera, ex parte or redacted material, are re-derived with exactly the same title rules (derive_titles.py) minus that
keyword rule. A row is held back only on explicit evidence from its own source; these are files the courts publish on their own websites
and none carries a court- or provider-reported seal or restriction (checked: no corpus_ingest.local_pdf_asset_occurrences row for any of
their 60 distinct SHA-256 values).

Inputs:
  --rows FILE         court_documents rows (JSONL: id, title, source_url, item, detail) currently titled "<file name> (title not recorded)"
  --artifacts FILE    corpus_artifacts rows for them (JSON list: route, sha256, object_key, bytes, mime, filename, ready)
  --first-pages FILE  extract-first-pages.py output for the same ids (SHA-256 verified against corpus_artifacts)
Outputs (to --out-dir): plan.jsonl (rows for corpus_admin_title_projection_v1 'plan' in a keyword_release run), document-map.csv, stats.json
"""
import argparse, csv, hashlib, json, os, re, sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive_titles as D
from build_plan import file_name_from_url

SUFFIX = " (title not recorded)"
# Audit only: the wording the former rule matched. It no longer withholds anything; it is reported so the release shows what was matched.
FORMER_KEYWORD_RE = re.compile(r"\b(?:sealed|under seal|restricted|in camera|ex parte|redact(?:ed|ion|ions))\b", re.I)
# Accuracy review of the 64 derived titles (2026-10-27): a derived title listed here is not the document's title, so the row keeps its
# "(title not recorded)" label with the given reason. Keyed by record id AND the exact derived string, so it applies to nothing else.
REVIEWED_NOT_TITLES = {
    # Virginia form CC-1640 instructions: the emphasised block is the generic "Using This Revisable PDF Form" label; the form's own name
    # ("COVER SHEET – PETITION FOR APPOINTMENT OF GUARDIAN AND/OR CONSERVATOR") is set smaller and is not what the rules pick.
    ("court-expansion-artifact:caf33c348ef6225260d1b50d", "Using This Revisable PDF Form"): "heading_is_instructions_label",
}


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def former_keywords(lines, title):
    text = " ".join([title or ""] + [l["t"] for l in lines[:60]])
    return sorted({m.group(0).lower() for m in FORMER_KEYWORD_RE.finditer(text)})


def build(rows, arts, fps):
    plan, dmap, stats = [], [], Counter()
    for r in sorted(rows, key=lambda x: x["id"]):
        stats["rows"] += 1
        title_now = r["title"] or ""
        if not title_now.endswith(SUFFIX):
            stats["skipped:title_is_not_title_not_recorded"] += 1
            continue
        art = arts.get(r["id"])
        fp = fps.get(r["id"])
        fname = file_name_from_url(r.get("source_url")) or title_now[: -len(SUFFIX)].strip() or None
        sha = art["sha256"] if art else None
        if not fp or fp.get("status") != "ok" or not fp.get("sha256_verified") or not sha or fp.get("sha256") != sha:
            stats["skipped:first_page_not_verified"] += 1
            continue
        title, method, reason = D.title_from_first_page(fp["lines"], fp.get("page_h"))
        text_hash = sha256("\n".join(l["t"] for l in fp["lines"]))
        kws = former_keywords(fp["lines"], title)
        stats["former_keyword_rule_matched" if kws else "former_keyword_rule_not_matched"] += 1
        held = REVIEWED_NOT_TITLES.get((r["id"], title))
        if held:
            title, method, reason = None, None, held
        if title:
            row = {"dataset": "court_documents", "id": r["id"], "old_title": title_now, "new_title": title, "method": method, "reason": None,
                   "source_id": f"corpus-originals:{sha}", "source_text_sha256": text_hash, "file_name": fname}
        else:
            row = {"dataset": "court_documents", "id": r["id"], "old_title": title_now, "new_title": title_now, "method": "not_recorded", "reason": reason,
                   "source_id": f"corpus-originals:{sha}", "source_text_sha256": None, "file_name": fname}
        plan.append(row)
        stats[f"method:{row['method']}" + (f":{row['reason']}" if row["reason"] else "")] += 1
        dmap.append({"id": r["id"], "file_name": fname or "Not recorded", "sha256": sha, "source_url": r.get("source_url") or "Not recorded",
                     "title_before": title_now, "title_after": row["new_title"], "method": row["method"], "reason": row["reason"] or "",
                     "former_keyword_matches": ";".join(kws) or "-", "doc_type": ((r.get("item") or {}).get("cells") or {}).get("doc_type") or "Not recorded"})
    return plan, dmap, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--first-pages", required=True)
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    rows = [json.loads(l) for l in open(a.rows, encoding="utf-8") if l.strip()]
    arts = {x["route"].rsplit("/", 1)[-1]: x for x in json.load(open(a.artifacts, encoding="utf-8"))}
    fps = {x["id"]: x for x in (json.loads(l) for l in open(a.first_pages, encoding="utf-8") if l.strip())}
    plan, dmap, stats = build(rows, arts, fps)
    with open(os.path.join(a.out_dir, "plan.jsonl"), "w", encoding="utf-8") as f:
        for p in plan:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out_dir, "document-map.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(dmap[0].keys()) if dmap else ["id"])
        w.writeheader()
        w.writerows(dmap)
    json.dump(dict(sorted(stats.items())), open(os.path.join(a.out_dir, "stats.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(dict(sorted(stats.items())), indent=1))


if __name__ == "__main__":
    main()
