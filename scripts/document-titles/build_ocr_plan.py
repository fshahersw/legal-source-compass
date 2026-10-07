#!/usr/bin/env python3
"""Build the OCR-stage plan for rows applied in the first run as "<file name> (title not recorded)" with reason no_text_layer.

  build_ocr_plan.py --plan plan.jsonl --ocr ocr-first-pages.jsonl --out-dir DIR
Writes ocr-plan.jsonl (same row shape as plan.jsonl), ocr-stats.json and ocr-samples.json. No network, no credentials.
"""
import argparse, hashlib, json, os, random, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive_titles as D


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--ocr", required=True)
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    v1 = {}
    for l in open(a.plan):
        p = json.loads(l)
        if p["dataset"] == "court_documents" and p["method"] == "not_recorded" and p["reason"] == "no_text_layer":
            v1[p["id"]] = p
    ocr = {}
    for l in open(a.ocr):
        d = json.loads(l)
        ocr[d["id"]] = d
    out, stats, samples = [], Counter(), defaultdict(list)
    for pid, p in sorted(v1.items()):
        d = ocr.get(pid)
        title = method = None
        text_hash = None
        if d is None:
            reason = "ocr_not_run"
        elif d["status"] != "ok":
            reason = "ocr_no_text" if d["status"] == "ocr_no_text" else "ocr_" + d["status"]
        else:
            title, method, reason = D.title_from_ocr_first_page(d["lines"], d.get("page_h"))
            text_hash = hashlib.sha256("\n".join(l["t"] for l in d["lines"]).encode("utf-8")).hexdigest()
        row = {"dataset": "court_documents", "id": pid, "old_title": p["new_title"], "source_id": p["source_id"], "file_name": p["file_name"]}
        if title:
            row.update(new_title=title, method=method, reason=None, source_text_sha256=text_hash)
            stats[method] += 1
            samples[method].append({"id": pid, "title": title, "file": p["file_name"]})
        else:
            row.update(new_title=p["new_title"], method="not_recorded", reason=reason, source_text_sha256=None)
            stats["not_recorded:" + reason] += 1
        out.append(row)
    with open(os.path.join(a.out_dir, "ocr-plan.jsonl"), "w") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    json.dump(dict(stats), open(os.path.join(a.out_dir, "ocr-stats.json"), "w"), indent=1)
    random.seed(20261007)
    json.dump({k: random.sample(v, min(40, len(v))) for k, v in samples.items()}, open(os.path.join(a.out_dir, "ocr-samples.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps(dict(stats), indent=1), len(out))


if __name__ == "__main__":
    main()
