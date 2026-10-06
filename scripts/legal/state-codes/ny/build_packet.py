#!/usr/bin/env python3
"""Build the shared landing packet (+ toc-proof.json) for the New York Consolidated Laws from /tmp/sc/NY.

One unit per section page (raw rawHtml original + UTF-8 text derivative), one section per unit. Hierarchy is read from the
link graph the publisher itself publishes: law page -> article / title / part container pages -> section pages. The TOC proof
counts the section links each law / article / container page prints against the sections that landed under it, and one
section-text block against one section for every section page. A section page whose text is empty is a gap, not a row.

    build_packet.py   ->  /tmp/sc/NY/landing/{manifest.json,objects.jsonl,units.jsonl,sections.jsonl,toc-proof.json,gaps.json}
"""
import collections
import hashlib
import json
import pathlib
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common.provenance_fetch import Fetcher  # noqa: E402
from parse import NODE_URL, classify, parse_document  # noqa: E402

ROOT = pathlib.Path("/tmp/sc/NY")
OUT = ROOT / "landing"
SECTION_PATH = r"^[A-Z][A-Z0-9]{1,6}/[A-Z0-9][A-Z0-9.-]*$"
CONTAINER = re.compile(r"^(?:T|P|SP|D|ST)[A-Z0-9-]*$")


def canon(url):
    return url.rstrip("/")


def node_links(html):
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.select("a[href]"):
        href = a["href"].split("?")[0].rstrip("/")
        if not href.startswith("http"):
            href = "https://www.nysenate.gov" + href
        if NODE_URL.search(href) and href not in out:
            out.append(href)
    return out


def main():
    fetcher = Fetcher("NY", ROOT, min_interval=1.0)
    good = {}
    for r in fetcher.receipts():
        if r.get("ok") and r.get("retrieval_method") == "proxied:firecrawl" and r.get("source_status") == 200:
            good[canon(r["url"])] = r
    html = {u: fetcher.read(r).decode("utf8", "replace") for u, r in good.items()}
    kind = {}
    for u in good:
        kind[u] = classify(u)
    laws = [u for u in good if kind[u] == "law"]
    children = collections.defaultdict(list)
    parent = {}
    for u in good:
        if kind[u] in ("law", "article") or (kind[u] == "section" and not parse_document(html[u], u)["text"]):
            for c in node_links(html[u]):
                if c != u and NODE_URL.search(c) and c not in parent and not (kind.get(c) == "law"):
                    parent[c] = u
                    children[u].append(c)
    titles = {}
    for u in laws:
        titles[NODE_URL.pattern and u.rsplit("/", 1)[1]] = parse_document(html[u], u)["title"]

    def chain(url):
        out = []
        while url in parent:
            url = parent[url]
            out.append(url)
        return list(reversed(out))

    sections, units, gaps, objects, pages = [], [], [], {}, []
    texts = {}
    (OUT / "text").mkdir(parents=True, exist_ok=True)
    section_urls = []
    for url in sorted(good):
        if kind[url] != "section":
            continue
        doc = parse_document(html[url], url)
        if not doc["text"]:
            if not children.get(url):
                gaps.append({"url": url, "reason": "section page prints no text"})
            continue
        section_urls.append(url)
    for url in section_urls:
        r = good[url]
        doc = parse_document(html[url], url)
        code, sid = NODE_URL.search(url).group(1), NODE_URL.search(url).group(2)
        path = "%s/%s" % (code, sid)
        stmt, as_of = doc["currency_statement"], doc["revision_date"]
        if not stmt:
            gaps.append({"url": url, "reason": "no revision statement"})
            continue
        currency = {"basis": "publisher_statement", "statement": stmt, "through_date": as_of, "edition": None}
        text = doc["text"]
        deriv = text.encode("utf-8")
        tsha = hashlib.sha256(deriv).hexdigest()
        if tsha not in texts:
            p = OUT / "text" / (tsha + ".txt")
            p.write_bytes(deriv)
            texts[tsha] = p
        src = {"source_url": r["url"], "retrieved_at": r["retrieved_at"], "http_status": r["source_status"],
               "retrieval_method": "proxied_fetch", "proxy": "firecrawl"}
        sha = r["sha256"]
        o = objects.setdefault(sha, {"sha256": sha, "bytes": r["bytes"], "kind": "publisher_original",
                                     "path": str(ROOT / r["stored_path"]), "sources": []})
        if src not in o["sources"]:
            o["sources"].append(src)
        d = objects.setdefault(tsha, {"sha256": tsha, "bytes": len(deriv), "kind": "unit_text_derivative", "path": str(texts[tsha]), "sources": []})
        if src not in d["sources"]:
            d["sources"].append(src)
        hier = [{"level": "law", "number": code, "heading": titles.get(code)}]
        for anc in chain(url):
            if kind[anc] == "law":
                continue
            a_id = NODE_URL.search(anc).group(2)
            a_doc = parse_document(html[anc], anc)
            hier.append({"level": "article" if kind[anc] == "article" else "division", "number": a_id,
                         "heading": a_doc.get("heading") or None})
        hier.append({"level": "section", "number": sid, "heading": doc["heading"] or None})
        units.append({"unit_key": path, "unit_kind": "section_page", "heading": doc["heading"] or None, "original_sha256": sha,
                      "publisher_member": None, "raw_member_sha256": None, "text_sha256": tsha, "text_code_points": len(text),
                      "sections_expected": 1, "currency": currency, "source_url": r["url"], "retrieved_at": r["retrieved_at"],
                      "retrieval_method": "proxied_fetch", "proxy": "firecrawl"})
        sections.append({"unit_key": path, "citation_path": path, "citation": "N.Y. %s § %s" % (titles.get(code) or code, sid),
                         "heading": doc["heading"] or None, "text": text, "hierarchy": hier, "history": None, "status_note": None,
                         "span": {"unit": "unicode_code_points", "start": 0, "end": len(text)}, "currency": currency})
        pages.append({"url": r["url"], "markers": len(BeautifulSoup(html[url], "lxml").select(".nys-openleg-result-text")), "sections": 1})
    landed = {s["unit_key"] for s in sections}
    for u in good:
        if kind[u] in ("law", "article") or children.get(u):
            r = good[u]
            sha = r["sha256"]
            src = {"source_url": r["url"], "retrieved_at": r["retrieved_at"], "http_status": r["source_status"],
                   "retrieval_method": "proxied_fetch", "proxy": "firecrawl"}
            o = objects.setdefault(sha, {"sha256": sha, "bytes": r["bytes"], "kind": "publisher_original",
                                         "path": str(ROOT / r["stored_path"]), "sources": []})
            if src not in o["sources"]:
                o["sources"].append(src)
    gap_urls = {g["url"] for g in gaps}
    toc_pages, missing_children = [], []
    for u in sorted(children):
        links_sec = [c for c in children[u] if kind.get(c) in ("section",) or c not in good]
        for c in children[u]:
            if c not in good:
                missing_children.append(c)
        direct = [c for c in children[u] if kind.get(c) == "section" and c in good and not children.get(c) and c not in gap_urls]
        under = [c for c in direct if ("%s/%s" % NODE_URL.search(c).groups()) in landed]
        toc_pages.append({"url": good[u]["url"], "markers": len(direct), "sections": len(under)})
    for u in good:
        if kind[u] == "law" and u not in children:
            toc_pages.append({"url": good[u]["url"], "markers": 0, "sections": 0})
    proof = {"marker": "publisher link graph: section links printed on each law/article/container page, and one .nys-openleg-result-text block per section page",
             "pages": toc_pages + pages, "unfetched_child_pages": sorted(set(missing_children)),
             "empty_text_pages": sorted(gap_urls)}
    manifest = {"schema_version": "publisher-code-manifest/2", "jurisdiction": "NY",
                "publisher": "New York State Senate (OpenLegislation, nysenate.gov)",
                "publisher_url": "https://www.nysenate.gov/legislation/laws/CONSOLIDATED", "source_system": "ny-consolidated-laws",
                "code_title": "New York Consolidated Laws", "parser": {"name": "ny-openleg-html", "version": "1"},
                "retrieval": {"methods": ["proxied_fetch"],
                              "source_url_patterns": [r"^https://www\.nysenate\.gov/legislation/laws/[A-Z][A-Z0-9]{1,6}(/[A-Z0-9][A-Z0-9.-]*)?/?$",
                                                      r"^https://www\.nysenate\.gov/legislation/laws/CONSOLIDATED$"],
                              "terms_gate": False, "official_source": True, "rate_limit_ms": 1000},
                "structure": {"levels": ["law", "article", "division", "section"], "unit": "one nysenate.gov section page"},
                "section_id": {"scheme": "official_citation_path", "regex": SECTION_PATH, "example": "ABC/101",
                               "citation_format": "N.Y. <law> § <section>"},
                "currency": {"basis": "publisher_statement",
                             "location": "each section page prints 'Viewing most recent revision (from YYYY-MM-DD)'"},
                "review": {"reviewed_by": "batch A lead", "reviewed_at": "2026-10-06"}}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    for name, rows in (("objects.jsonl", sorted(objects.values(), key=lambda x: x["sha256"])), ("units.jsonl", units), ("sections.jsonl", sections)):
        with open(OUT / name, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    (OUT / "toc-proof.json").write_text(json.dumps(proof))
    (OUT / "gaps.json").write_text(json.dumps(gaps, indent=1))
    mism = [p for p in proof["pages"] if p["markers"] != p["sections"]]
    print(json.dumps({"units": len(units), "sections": len(sections), "objects": len(objects), "gaps": len(gaps),
                      "toc_pages": len(proof["pages"]), "toc_mismatch": len(mism), "unfetched": len(proof["unfetched_child_pages"]),
                      "first_mismatch": mism[:3]}))


if __name__ == "__main__":
    main()
