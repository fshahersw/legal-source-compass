"""Diagnostic: insights whose quote runs across a running page header/footer line of its document (read-only)."""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
import insights as INS  # noqa: E402


def main():
    work = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")
    docs = {d["id"]: d for d in fetchlib.load_json(os.path.join(work, "documents.json"))["documents"]}
    data = fetchlib.load_json(os.path.join(work, "insights.json"))
    cache = {}
    hits = []
    total = 0
    for r in data["documents"]:
        d = docs.get(r["doc"]) or {}
        if not d.get("text_path"):
            continue
        if r["doc"] not in cache:
            cache[r["doc"]] = INS.running_lines(fetchlib.open_text(d["text_path"]).read())
        for i in r.get("kept") or []:
            total += 1
            if INS.crosses_running_line(i["quote"], cache[r["doc"]]):
                hits.append((r["doc"], i["quote"][:160].replace("\n", " | ")))
    print(json.dumps({"insights": total, "crossing_running_lines": len(hits), "by_doc": Counter(h[0] for h in hits).most_common(10)}))
    for h in hits[:12]:
        print(h)


if __name__ == "__main__":
    main()
