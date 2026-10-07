"""Acquire South Dakota Codified Laws (SDCL) JSON from sdlegislature.gov (official API).

Phases:
  meta      — title list, effective-date string, Statutes SPA shell page
  inventory — walk the published Next chain from the first title through the code (archives each JSON)
  fetch     — alias for inventory (resumable via Archive index)

Usage: python3 acquire.py [--work /tmp/sc4/sd] [--phase meta|inventory|fetch|all]
"""
import argparse
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

API = "https://sdlegislature.gov/api/Statutes"
STATUTES_HOME = "https://sdlegislature.gov/Statutes"


def statute_url(citation: str) -> str:
    return f"{API}/Statute/{urllib.parse.quote(str(citation), safe='-.')}"


def grab(arc: Archive, url: str, accept="application/json,*/*", **kw):
    rec = arc.fetch(url, accept=accept, **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, accept=accept, **kw)
    return rec


def fetch_meta(arc: Archive) -> dict:
    grab(arc, STATUTES_HOME, accept="text/html,application/xhtml+xml,*/*")
    titles_rec = grab(arc, f"{API}/Title", accept="application/json")
    eff_rec = grab(arc, f"{API}/LastStatuesEffectiveDate", accept="application/json")
    titles = json.loads(arc.read(titles_rec))
    eff_raw = arc.read(eff_rec).decode("utf-8").strip()
    try:
        effective_date = json.loads(eff_raw)
    except json.JSONDecodeError:
        effective_date = eff_raw
    meta = {
        "source_home": STATUTES_HOME,
        "api_title_list_url": f"{API}/Title",
        "api_effective_date_url": f"{API}/LastStatuesEffectiveDate",
        "title_count": len(titles),
        "last_statutes_effective_date": effective_date,
        "titles": titles,
    }
    with open(os.path.join(arc.work, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    return meta


def build_inventory(arc: Archive, meta: dict) -> dict:
    titles = sorted(meta["titles"], key=lambda t: int(t["Title"]))
    start = titles[0]["Statute"]
    inv_path = os.path.join(arc.work, "inventory.json")
    partial = {"nodes": [], "chapters": [], "sections": [], "failed": []}
    if os.path.exists(inv_path):
        partial = json.load(open(inv_path))
    seen = {n["statute"] for n in partial["nodes"]}
    cur = start
    if partial["nodes"]:
        cur = partial["nodes"][-1].get("next")
    failed = list(partial.get("failed") or [])
    while cur:
        if cur in seen:
            break
        url = statute_url(cur)
        rec = grab(arc, url, accept="application/json")
        if rec["state"] != "complete":
            failed.append({"statute": cur, "url": url, "http_status": rec.get("http_status")})
            break
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
        partial["nodes"].append(node)
        seen.add(cur)
        if data.get("Type") == "Chapter":
            partial["chapters"].append(
                {
                    "statute": data.get("Statute"),
                    "title": data.get("Title"),
                    "catchline": node["catchline"],
                    "statute_id": data.get("StatuteId"),
                }
            )
        elif data.get("Type") == "Section":
            cit = data.get("Statute") or ""
            partial["sections"].append(
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
        cur = data.get("Next")
        if len(partial["nodes"]) % 25 == 0:
            with open(inv_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        **partial,
                        "section_count": len(partial["sections"]),
                        "chapter_count": len(partial["chapters"]),
                        "node_count": len(partial["nodes"]),
                        "failed": failed,
                        "last_statutes_effective_date": meta.get("last_statutes_effective_date"),
                    },
                    f,
                    indent=1,
                )
            print(len(partial["nodes"]), "sections", len(partial["sections"]), "cur", cur, flush=True)

    inv = {
        **partial,
        "section_count": len(partial["sections"]),
        "chapter_count": len(partial["chapters"]),
        "node_count": len(partial["nodes"]),
        "failed": failed,
        "last_statutes_effective_date": meta.get("last_statutes_effective_date"),
        "currency_statement": meta.get("last_statutes_effective_date"),
    }
    with open(inv_path, "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=1)
    # checkpoint also written above every 25 nodes
    with open(os.path.join(arc.work, "section_urls.jsonl"), "w", encoding="utf-8") as f:
        for s in partial["sections"]:
            f.write(json.dumps({"url": statute_url(s["statute"]), "citation": s["statute"]}) + "\n")
    return inv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--phase", default="all", choices=("all", "meta", "inventory", "fetch"))
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    meta = None
    if a.phase in ("all", "meta"):
        meta = fetch_meta(arc)
        print("meta titles", meta["title_count"], "effective", meta["last_statutes_effective_date"], flush=True)
    if a.phase in ("all", "inventory", "fetch"):
        if meta is None:
            meta_path = os.path.join(a.work, "meta.json")
            if not os.path.exists(meta_path):
                raise SystemExit("run meta phase first")
            meta = json.load(open(meta_path))
        inv = build_inventory(arc, meta)
        print(
            "inventory nodes",
            inv["node_count"],
            "chapters",
            inv["chapter_count"],
            "sections",
            inv["section_count"],
            "failed",
            len(inv["failed"]),
            flush=True,
        )


if __name__ == "__main__":
    main()
