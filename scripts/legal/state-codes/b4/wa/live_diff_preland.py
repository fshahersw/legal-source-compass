"""20-section live publisher diff from staged packet (direct fetch only, no landing)."""
import argparse
import json
import os
import random
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "..", "common"))
sys.path.insert(0, os.path.join(_HERE, ".."))
import sc_common as sc  # noqa: E402
from review_publisher_code_v2 import live_text, squash  # noqa: E402


def load_chapter_texts(work: str):
    ch_by = {}
    with open(os.path.join(work, "packet", "chapters.jsonl"), encoding="utf-8") as f:
        for line in f:
            ch = json.loads(line)
            ch_by[ch["native_id"]] = ch
    texts = {}
    for ch in ch_by.values():
        tpath = os.path.join(work, "packet", "chapter-text", ch["text_sha256"] + ".txt")
        texts[ch["native_id"]] = open(tpath, encoding="utf-8").read()
    return ch_by, texts


def section_text(texts, s):
    return texts[s["chapter_native_id"]][s["start"] : s["end"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wa")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    _, texts = load_chapter_texts(a.work)
    secs = []
    for line in open(os.path.join(a.work, "packet", "sections.jsonl"), encoding="utf-8"):
        s = json.loads(line)
        t = section_text(texts, s)
        if not t.strip():
            continue
        s = dict(s)
        s["_text"] = t
        secs.append(s)
    rnd = random.Random(a.seed)
    sample = rnd.sample(secs, min(a.n, len(secs)))
    arc = sc.Archive(os.path.join(a.work, "live_diff_archive"), min_interval=1.0)
    results = []
    for s in sample:
        live_url = s.get("source_url") or ""
        rec = arc.fetch(live_url, accept="application/pdf,*/*", route="direct", min_bytes=100)
        row = {
            "citation_path": s["citation_path"],
            "citation": s["citation"],
            "url": live_url,
            "live_status": rec.get("http_status"),
            "route": rec.get("route"),
        }
        if rec.get("state") != "complete":
            row.update(ok=False, why="live fetch failed")
        else:
            live = squash(live_text(arc.read(rec), live_url))
            cite = s.get("citation") or ""
            row["citation_ok"] = bool(cite) and squash(cite) in live
            heading = s.get("heading") or ""
            row["heading_ok"] = (not heading) or squash(heading) in live
            row["text_ok"] = squash(s["_text"]) in live
            row["ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]
        results.append(row)
    live_ok = sum(1 for r in results if r.get("ok"))
    out = {
        "state": "WA",
        "sampled": len(results),
        "live_ok": live_ok,
        "live_diff_score": f"{live_ok}/{len(results)}",
        "seed": a.seed,
        "pool_with_text": len(secs),
        "results": results,
    }
    op = a.out or os.path.join(a.work, "live_diff_preland.json")
    json.dump(out, open(op, "w"), indent=1)
    print(json.dumps({"live_diff_score": out["live_diff_score"], "path": op}))
    if live_ok != len(results):
        raise SystemExit("live diff failed")


if __name__ == "__main__":
    main()
