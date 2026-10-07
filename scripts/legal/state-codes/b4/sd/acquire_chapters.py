"""Parallel SDCL acquisition by chapter (official Statute/{title-chapter} JSON bundles).

Replaces the slow Next-chain section walk in acquire.py for inventory + raw capture.
Discovery: for each title in meta.json, binary-search the highest chapter number T-N that returns Type=Chapter.
Fetch: 4–6 workers; Archive enforces >=1s spacing per host across threads.

Usage:
  python3 acquire_chapters.py [--work /tmp/sc4/sd] [--workers 5] [--phase discover|fetch|inventory|all]
"""
import argparse
import concurrent.futures
import json
import os
import sys
import threading
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from chapter_html import (  # noqa: E402
    catchlines_from_html,
    section_citations_from_html,
    title_chapter_from_citation,
)

API = "https://sdlegislature.gov/api/Statutes"
STATUTES_HOME = "https://sdlegislature.gov/Statutes"


def statute_url(citation: str) -> str:
    return f"{API}/Statute/{urllib.parse.quote(str(citation), safe='-.')}"


def grab(arc: Archive, url: str, accept="application/json,*/*", **kw):
    rec = arc.fetch(url, accept=accept, **kw)
    if rec["state"] != "complete" and rec.get("http_status") in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
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


def _chapter_ok(arc: Archive, citation: str) -> bool:
    url = statute_url(citation)
    rec = arc.index.get(url)
    if rec and rec.get("state") == "complete":
        data = json.loads(arc.read(rec))
        return data.get("Type") == "Chapter"
    rec = grab(arc, url, accept="application/json")
    if rec["state"] != "complete":
        return False
    data = json.loads(arc.read(rec))
    return data.get("Type") == "Chapter"


def max_chapter_for_title(arc: Archive, title_num: int, hi_cap: int = 512) -> int:
    lo, hi = 1, hi_cap
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _chapter_ok(arc, f"{title_num}-{mid}"):
            lo = mid
        else:
            hi = mid - 1
    if lo >= 1 and _chapter_ok(arc, f"{title_num}-{lo}"):
        return lo
    return 0


def discover_chapter_citations(arc: Archive, meta: dict, workers: int = 5) -> list[str]:
    path = os.path.join(arc.work, "chapter_citations.json")
    if os.path.exists(path):
        cached = json.load(open(path))
        if cached.get("citations"):
            return cached["citations"]

    titles = sorted({int(t["Title"]) for t in meta["titles"]})
    lock = threading.Lock()
    by_title = {}

    def one(title_num: int):
        mx = max_chapter_for_title(arc, title_num)
        with lock:
            by_title[title_num] = mx
        print(f"title {title_num} chapters 1..{mx}", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, titles))

    citations = []
    for title_num in sorted(by_title):
        for ch in range(1, by_title[title_num] + 1):
            citations.append(f"{title_num}-{ch}")

    doc = {
        "discovery_method": "binary_search_statute_title_chapter",
        "title_chapter_max": by_title,
        "chapter_count": len(citations),
        "citations": citations,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    return citations


def fetch_chapters(arc: Archive, citations: list[str], workers: int = 5) -> dict:
    failed = []
    done = 0
    lock = threading.Lock()

    def one(citation: str):
        nonlocal done
        url = statute_url(citation)
        old = arc.index.get(url)
        if old and old.get("state") == "complete":
            with lock:
                done += 1
            return None
        rec = grab(arc, url, accept="application/json")
        err = None
        if rec["state"] != "complete":
            err = {"statute": citation, "url": url, "http_status": rec.get("http_status")}
        else:
            data = json.loads(arc.read(rec))
            if data.get("Type") != "Chapter":
                err = {"statute": citation, "url": url, "reason": "not_chapter", "type": data.get("Type")}
        with lock:
            done += 1
            if done % 25 == 0 or done == len(citations):
                print(f"fetch {done}/{len(citations)}", flush=True)
        return err

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for err in ex.map(one, citations):
            if err:
                failed.append(err)

    summary = {"chapter_targets": len(citations), "failed": failed}
    with open(os.path.join(arc.work, "chapter_fetch.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    return summary


def build_inventory(arc: Archive, meta: dict, citations: list[str]) -> dict:
    nodes = []
    chapters = []
    sections = []
    failed = []

    for citation in citations:
        url = statute_url(citation)
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            failed.append({"statute": citation, "url": url, "reason": "not_archived"})
            continue
        data = json.loads(arc.read(rec))
        if data.get("Type") != "Chapter":
            failed.append({"statute": citation, "url": url, "reason": "wrong_type", "type": data.get("Type")})
            continue
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
            "from_chapter_bundle": True,
        }
        nodes.append(node)
        chapters.append(
            {
                "statute": data.get("Statute"),
                "title": data.get("Title"),
                "catchline": node["catchline"],
                "statute_id": data.get("StatuteId"),
            }
        )
        html = data.get("Html") or ""
        catch_by = catchlines_from_html(html)
        for sec_cit in section_citations_from_html(html):
            t_num, ch_num = title_chapter_from_citation(sec_cit)
            sections.append(
                {
                    "statute": sec_cit,
                    "title_slug": sec_cit.split("-")[0] if sec_cit else None,
                    "title": t_num if t_num is not None else data.get("Title"),
                    "chapter": ch_num if ch_num is not None else data.get("Chapter"),
                    "catchline": catch_by.get(sec_cit),
                    "statute_id": None,
                    "repealed": None,
                    "from_chapter_bundle": True,
                }
            )

    inv = {
        "nodes": nodes,
        "chapters": chapters,
        "sections": sections,
        "section_count": len(sections),
        "chapter_count": len(chapters),
        "node_count": len(nodes),
        "failed": failed,
        "last_statutes_effective_date": meta.get("last_statutes_effective_date"),
        "currency_statement": meta.get("last_statutes_effective_date"),
        "inventory_source": "chapter_parallel",
    }
    inv_path = os.path.join(arc.work, "inventory.json")
    with open(inv_path, "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=1)
    with open(os.path.join(arc.work, "section_urls.jsonl"), "w", encoding="utf-8") as f:
        for s in sections:
            f.write(json.dumps({"url": statute_url(s["statute"]), "citation": s["statute"]}) + "\n")
    return inv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--phase", default="all", choices=("all", "discover", "fetch", "inventory", "meta"))
    a = ap.parse_args()
    if a.workers < 1 or a.workers > 8:
        raise SystemExit("--workers must be between 1 and 8")
    arc = Archive(a.work, min_interval=1.0)
    meta = None
    if a.phase in ("all", "meta"):
        meta_path = os.path.join(a.work, "meta.json")
        if a.phase == "meta" or not os.path.exists(meta_path):
            meta = fetch_meta(arc)
        else:
            meta = json.load(open(meta_path))
    citations = None
    if a.phase in ("all", "discover", "fetch", "inventory"):
        if meta is None:
            meta = json.load(open(os.path.join(a.work, "meta.json")))
        if a.phase in ("all", "discover"):
            citations = discover_chapter_citations(arc, meta, workers=a.workers)
            print("discovered chapters", len(citations), flush=True)
        else:
            cache = os.path.join(a.work, "chapter_citations.json")
            if not os.path.exists(cache):
                raise SystemExit("run discover first")
            citations = json.load(open(cache))["citations"]
    if a.phase in ("all", "fetch") and citations:
        summ = fetch_chapters(arc, citations, workers=a.workers)
        print("fetch failed", len(summ["failed"]), flush=True)
    if a.phase in ("all", "inventory") and citations:
        inv = build_inventory(arc, meta, citations)
        print(
            "inventory chapters",
            inv["chapter_count"],
            "sections",
            inv["section_count"],
            "failed",
            len(inv["failed"]),
            flush=True,
        )


if __name__ == "__main__":
    main()
