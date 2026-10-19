"""Review aid: summarise the work files (documents per status, sections per document, samples).

  python3 -I -B scripts/enrichment/court_rules/peek_work.py [doc_id ...]
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
WORK = os.path.join(ROOT, "private", "build", "court_rules", "work")


def main(argv):
    docs = json.load(open(os.path.join(WORK, "documents.json")))["documents"]
    secs = [json.loads(l) for l in open(os.path.join(WORK, "sections.jsonl"), encoding="utf-8")]
    per = Counter(s["doc"] for s in secs)
    sizes = Counter()
    for s in secs:
        sizes[s["doc"]] += len(s["text"])
    if not argv:
        print("documents", len(docs), "sections", len(secs), "text chars", sum(sizes.values()))
        big = sorted(secs, key=lambda s: -len(s["text"]))[:8]
        print("largest sections:", [(s["id"], s["label"], len(s["text"])) for s in big])
        for d in docs:
            if d.get("status") != "text":
                print("  ", d["id"], d.get("status"), d.get("url"))
        return
    for doc_id in argv:
        d = next(x for x in docs if x["id"] == doc_id)
        print(json.dumps({k: v for k, v in d.items() if k not in ("text_path",)}, indent=0)[:900])
        for s in [s for s in secs if s["doc"] == doc_id][:12]:
            print(f"   {s['id']} p{s['page']} {s['label'][:24]:24} | {s['title'][:60]} | {len(s['text'])} | {s['source_url'][-50:]}")


if __name__ == "__main__":
    main(sys.argv[1:])
