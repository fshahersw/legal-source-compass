"""Diagnostic: show the keys (and one example) of the work documents and constitution states (read-only)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

WORK = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")


def main():
    docs = fetchlib.load_json(os.path.join(WORK, "documents.json"))["documents"]
    print("documents keys:", sorted({k for d in docs for k in d}))
    print(json.dumps({k: v for k, v in docs[0].items() if not isinstance(v, (list, dict)) or k in ("raw_paths", "parts")}, ensure_ascii=False)[:800])
    states = fetchlib.load_json(os.path.join(WORK, "constitutions.json"))["states"]
    print("constitution keys:", sorted({k for s in states for k in s}))
    ex = next(s for s in states if s["state"] == "NY")
    print(json.dumps({k: (v[:3] if isinstance(v, list) else v) for k, v in ex.items()}, ensure_ascii=False)[:1200])


if __name__ == "__main__":
    main()
