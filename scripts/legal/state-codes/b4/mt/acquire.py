"""Acquire the Montana Code Annotated from the official MCA site (mca.legmt.gov), in parallel.

Every page (home, help, title/chapter/part indexes and every section page) is retained verbatim through
sc_common.Archive (sha256 + retrieval time + status + route + user agent in receipts.jsonl). A 200 body that is not
an MCA page (bot-defense interstitial, truncated body) is re-fetched; only a page carrying the publisher's own
content markers counts as captured.

    python3 acquire.py --work /tmp/sc4/mt --workers 12 [--phase all|inventory|fetch]

Outputs: <work>/inventory.json (full official TOC: titles, chapters/articles, parts, section links, reserved lines),
<work>/acquire_failed.json (URLs never captured).
"""
import argparse
import concurrent.futures
import html as html_mod
import json
import os
import re
import sys
import threading
import time
import urllib.parse

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import sc_common as sc  # noqa: E402

BASE = "https://mca.legmt.gov/bills/mca/"
HOME = BASE + "index.html"
HELP = BASE + "help.html"

LINK_RE = re.compile(r'<a\b[^>]*href="\./([^"#]+)"[^>]*>(.*?)</a>', re.S | re.I)
RESERVED_RE = re.compile(r'<span[^>]*class="[^"]*\breserved\b[^"]*"[^>]*>(.*?)</span>', re.S | re.I)
TOC_BLOCK_RE = {
    "home": re.compile(r'<div class="title-toc-content">(.*?)</div>', re.S | re.I),
    "title": re.compile(r'<div class="chapter-toc-content">(.*?)</div>', re.S | re.I),
    "chapter": re.compile(r'<div class="part-toc-content">(.*?)</div>', re.S | re.I),
    "part": re.compile(r'<div class="section-toc-content">(.*?)</div>', re.S | re.I),
}
CHILD_RE = {
    "home": re.compile(r"^title_\w+/chapters_index\.html$", re.I),
    "title": re.compile(r"^(?:chapter|article)_\w+/parts_index\.html$", re.I),
    "chapter": re.compile(r"^part_\w+/sections_index\.html$", re.I),
    "part": re.compile(r"^section_\w+/[\w-]+\.html$", re.I),
}
CHILD_LEVEL = {"home": "title", "title": "chapter", "chapter": "part", "part": "section"}
LI_RE = re.compile(r"<li\b[^>]*>(.*?)</li>", re.S | re.I)
CITATION_RE = re.compile(r'<span class="citation">(.*?)</span>', re.S | re.I)


def norm(s):
    return sc.collapse(html_mod.unescape(re.sub(r"<[^>]+>", " ", s or "")))


def valid(level, text):
    if 'class="mca-content' not in text or "</html>" not in text.lower():
        return False
    if level == "section":
        return 'class="section-doc"' in text
    return bool(TOC_BLOCK_RE[level].search(text)) if level in TOC_BLOCK_RE else True


class McaArchive(sc.Archive):
    """sc_common.Archive over one persistent keep-alive connection per worker thread.

    The MCA front end stalls new TCP connections when many open per second, so connections are reused rather than
    opened per request. Redirects are followed by hand exactly as in sc_common (hops recorded in the receipt)."""

    _local = threading.local()

    def _session(self):
        s = getattr(self._local, "s", None)
        if s is None:
            s = self._local.s = requests.Session()
        return s

    def _http(self, url, accept="*/*", timeout=60, extra=None, ua=None):
        hops = []
        cur = url
        for _ in range(self.max_redirects + 1):
            self._wait(urllib.parse.urlparse(cur).hostname)
            h = {"User-Agent": ua or self.ua, "Accept": accept, "Accept-Encoding": "gzip"}
            h.update(extra or {})
            try:
                r = self._session().get(cur, headers=h, timeout=(15, timeout), allow_redirects=False)
                body = r.content
            except requests.RequestException as e:
                self._local.s = None
                raise ConnectionError(str(e)[:200]) from e
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("Location"):
                hops.append({"status": r.status_code, "location": r.headers["Location"]})
                cur = urllib.parse.urljoin(cur, r.headers["Location"])
                continue
            meta = {"final_url": cur, "redirects": hops, "content_type": r.headers.get("Content-Type"),
                    "etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}
            if r.status_code != 200:
                meta["retry_after"] = r.headers.get("Retry-After")
            return r.status_code, body, meta
        return 310, b"", {"final_url": cur, "redirects": hops, "error": "too many redirects"}

    def capture(self, url, level, tries=6):
        rec = self.fetch(url, accept="text/html,*/*")
        for attempt in range(tries):
            if rec.get("state") == "complete" and valid(level, sc.decode_html(self.read(rec))[0]):
                return rec, True
            if rec.get("state") != "complete" and rec.get("http_status") == 404:
                return rec, False
            time.sleep(min(60, 3 * 2 ** attempt))
            rec = self.fetch(url, accept="text/html,*/*", force=True, user_agent="browser" if attempt else None)
        return rec, False


def toc_entries(level, text):
    """Every line of the page's own TOC block: linked children plus unlinked (reserved) lines."""
    block = TOC_BLOCK_RE[level].search(text)
    out = []
    for li in LI_RE.findall(block.group(1) if block else ""):
        link = LINK_RE.search(li)
        if link and CHILD_RE[level].match(link.group(1)):
            cit = CITATION_RE.search(link.group(2))
            out.append({"href": link.group(1), "label": norm(link.group(2)),
                        "citation": norm(cit.group(1)) if cit else None})
        else:
            out.append({"href": None, "label": norm(li),
                        "reserved": bool(RESERVED_RE.search(li)), "unlinked_html": li.strip()[:500]})
    return out


def join(page_url, href):
    return page_url.rsplit("/", 1)[0] + "/" + href


def build_inventory(arc, workers):
    for u in (HOME, HELP):
        rec, ok = arc.capture(u, "home" if u == HOME else "help")
        if not ok:
            raise SystemExit("home/help not captured: %s %s" % (u, rec.get("http_status")))
    pages = {}
    failed = []
    frontier = [(HOME, "home", None)]
    while frontier:
        level = frontier[0][1]
        print("inventory level", level, len(frontier), flush=True)
        with concurrent.futures.ThreadPoolExecutor(workers) as ex:
            results = list(ex.map(lambda item: (item, arc.capture(item[0], item[1])), frontier))
        nxt = []
        for (url, lvl, parent), (rec, ok) in results:
            if not ok:
                failed.append({"url": url, "level": lvl, "http_status": rec.get("http_status")})
                continue
            text = sc.decode_html(arc.read(rec))[0]
            entries = toc_entries(lvl, text)
            for e in entries:
                if e["href"]:
                    e["url"] = join(url, e["href"])
            pages[url] = {"url": url, "level": lvl, "parent": parent, "sha256": rec["sha256"], "entries": entries}
            if CHILD_LEVEL[lvl] != "section":
                nxt.extend((e["url"], CHILD_LEVEL[lvl], url) for e in entries if e.get("url"))
        frontier = nxt
    home_text = sc.decode_html(arc.read(arc.index[HOME]))[0]
    h1 = re.search(r"<h1>\s*(Montana Code Annotated\s+\d{4})\s*</h1>\s*<p><strong>(.*?)</strong></p>", home_text, re.S | re.I)
    sections = [{"url": e["url"], "toc_page": p["url"], "citation_toc": e["citation"], "toc_label": e["label"]}
                for p in pages.values() if p["level"] == "part" for e in p["entries"] if e.get("url")]
    inventory = {
        "source_base": BASE,
        "home_sha256": arc.index[HOME]["sha256"],
        "edition": {"edition": norm(h1.group(1)) if h1 else None, "statement": norm(h1.group(2)) if h1 else None},
        "pages": list(pages.values()),
        "sections": sections,
        "index_failures": failed,
        "counts": {lvl: sum(1 for p in pages.values() if p["level"] == lvl) for lvl in ("home", "title", "chapter", "part")},
    }
    inventory["counts"]["section_links"] = len(sections)
    inventory["counts"]["unique_section_urls"] = len({s["url"] for s in sections})
    with open(os.path.join(arc.work, "inventory.json"), "w") as f:
        json.dump(inventory, f, indent=1)
    print(json.dumps({"counts": inventory["counts"], "edition": inventory["edition"], "index_failures": len(failed)}), flush=True)
    return inventory


def fetch_sections(arc, workers, inventory=None):
    inventory = inventory or json.load(open(os.path.join(arc.work, "inventory.json")))
    urls = list(dict.fromkeys(s["url"] for s in inventory["sections"]))
    done = [0]
    failed = []
    t0 = time.time()

    def one(u):
        rec, ok = arc.capture(u, "section")
        done[0] += 1
        if done[0] % 500 == 0:
            rate = done[0] / max(1, time.time() - t0)
            print("sections %d/%d failed %d %.1f/s" % (done[0], len(urls), len(failed), rate), flush=True)
        if not ok:
            failed.append({"url": u, "http_status": rec.get("http_status")})

    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, urls))
    with open(os.path.join(arc.work, "acquire_failed.json"), "w") as f:
        json.dump(failed, f, indent=1)
    print("fetch done", len(urls), "failed", len(failed), flush=True)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/mt")
    ap.add_argument("--phase", default="all", choices=("all", "inventory", "fetch"))
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--min-interval", type=float, default=0.03, help="seconds between request starts to the host")
    a = ap.parse_args()
    arc = McaArchive(a.work, min_interval=a.min_interval)
    inv = None
    if a.phase in ("all", "inventory"):
        inv = build_inventory(arc, a.workers)
    if a.phase in ("all", "fetch"):
        fetch_sections(arc, a.workers, inv)


if __name__ == "__main__":
    main()
