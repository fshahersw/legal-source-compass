"""20-section live publisher diff from staged packet (no landing, no --apply).

Usage:
  python3 live_diff_preland.py --work /tmp/sc4/sd [--n 20] [--seed 20261007]
"""
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


def load_chapter_texts(work: str) -> tuple[dict, dict]:
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


def section_text(texts: dict, s: dict) -> str:
    return texts[s["chapter_native_id"]][s["start"] : s["end"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--out", default=None, help="JSON results path (default <work>/live_diff_preland.json)")
    ap.add_argument(
        "--replay",
        default=None,
        help="Repeat the citation_path list from a prior live_diff_preland.json (ignores --n/--seed sampling)",
    )
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
    if a.replay:
        prev = json.load(open(a.replay))
        by_path = {s["citation_path"]: s for s in secs}
        sample = []
        for row in prev["results"]:
            s = by_path.get(row["citation_path"])
            if not s:
                raise SystemExit(f"replay missing citation_path {row['citation_path']}")
            sample.append(s)
    else:
        rnd = random.Random(a.seed)
        sample = rnd.sample(secs, min(a.n, len(secs)))
    arc = sc.Archive(os.path.join(a.work, "live_diff_archive"), min_interval=1.0)
    results = []
    for s in sample:
        live_url = s.get("source_url") or ""
        rec = arc.fetch(live_url, accept="application/json,*/*", min_bytes=0)
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
            number = s["hierarchy"][-1].get("number") or ""
            row["citation_ok"] = bool(number) and squash(number) in live
            heading = s.get("heading") or ""
            row["heading_ok"] = (not heading) or squash(heading) in live
            row["text_ok"] = squash(s["_text"]) in live
            row["ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]
        results.append(row)
    live_ok = sum(1 for r in results if r.get("ok"))
    out = {
        "state": "SD",
        "sampled": len(results),
        "live_ok": live_ok,
        "live_diff_score": f"{live_ok}/{len(results)}",
        "seed": a.seed,
        "pool_with_text": len(secs),
        "results": results,
    }
    path = a.out or os.path.join(a.work, "live_diff_preland.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(json.dumps({"live_ok": live_ok, "sampled": len(results), "live_diff_score": out["live_diff_score"]}))
    return 0 if live_ok == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
