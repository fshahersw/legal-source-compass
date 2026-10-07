"""Rebuild inventory.json from completed Statute/* receipts (resume helper)."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

STATUTE_RE = re.compile(r"/api/Statutes/Statute/([^/?#]+)$")


def main(work="/tmp/sc4/sd"):
    arc = Archive(work)
    meta = json.load(open(os.path.join(work, "meta.json")))
    nodes = []
    chapters = []
    sections = []
    for url in sorted(arc.index.keys()):
        m = STATUTE_RE.search(url)
        if not m:
            continue
        rec = arc.index[url]
        if rec.get("state") != "complete":
            continue
        data = json.loads(arc.read(rec))
        node = {
            "statute": data.get("Statute"),
            "type": data.get("Type"),
            "statute_id": data.get("StatuteId"),
            "catchline": (data.get("CatchLine") or "").strip() or None,
            "title": data.get("Title"),
            "chapter": data.get("Chapter"),
            "repealed": data.get("Repealed"),
            "previous": data.get("Previous"),
            "next": data.get("Next"),
            "source_url": url,
            "receipt_sha256": rec["sha256"],
        }
        nodes.append(node)
        if data.get("Type") == "Chapter":
            chapters.append(
                {
                    "statute": data.get("Statute"),
                    "title": data.get("Title"),
                    "catchline": node["catchline"],
                    "statute_id": data.get("StatuteId"),
                }
            )
        elif data.get("Type") == "Section":
            cit = data.get("Statute") or ""
            sections.append(
                {
                    "statute": cit,
                    "title_slug": cit.split("-")[0] if cit else None,
                    "title": data.get("Title"),
                    "chapter": data.get("Chapter"),
                    "catchline": node["catchline"],
                    "statute_id": data.get("StatuteId"),
                    "repealed": data.get("Repealed"),
                }
            )
    inv = {
        "nodes": nodes,
        "chapters": chapters,
        "sections": sections,
        "section_count": len(sections),
        "chapter_count": len(chapters),
        "node_count": len(nodes),
        "failed": [],
        "last_statutes_effective_date": meta.get("last_statutes_effective_date"),
        "rebuilt_from_archive": True,
    }
    path = os.path.join(work, "inventory.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=1)
    print(json.dumps({"nodes": len(nodes), "sections": len(sections), "path": path}))


if __name__ == "__main__":
    main()
