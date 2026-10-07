#!/usr/bin/env python3
"""Resolve NJ citations to official LIS statute HTML pages via direct xhitlist search."""
import html as html_mod
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
GATEWAY = "https://lis.njleg.state.nj.us/nxt/gateway.dll"
CITE_IN_TITLE = re.compile(
    r"^((?:[0-9][0-9A-Za-z.]*|App\.A):[0-9][0-9A-Za-z.:\-]*(?:\([0-9A-Za-z]+\))?)"
)


def squash(text: str) -> str:
    text = html_mod.unescape(text or "")
    return re.sub(r"\s+", "", text)


def xhitlist_items(citation: str, max_hits: int = 10) -> list[dict]:
    query = f"[Rank 100][Domain: {citation}] {citation}"
    params = {
        "f": "xhitlist",
        "vid": "Publish:10.1048/Enu",
        "xhitlist_x": "advanced",
        "xhitlist_s": "relevance-weight",
        "xhitlist_mh": str(max_hits),
        "xhitlist_sel": "title;path",
        "xhitlist_vpc": "first",
        "xhitlist_vps": str(max_hits),
        "xhitlist_q": query,
    }
    url = GATEWAY + "?" + urllib.parse.urlencode(params)
    root = ET.fromstring(_fetch_bytes(url).decode("utf-8", errors="replace"))
    items = []
    for item in root.findall("item"):
        title_el = item.find("title")
        path_el = item.find("path")
        if title_el is None or path_el is None or not (path_el.text or "").strip():
            continue
        title = html_mod.unescape((title_el.text or "").strip())
        path = path_el.text.strip()
        match = CITE_IN_TITLE.match(title)
        if not match:
            continue
        items.append(
            {
                "citation": match.group(1).rstrip("."),
                "title": title,
                "path": path,
                "url": f"{GATEWAY}/{path}",
            }
        )
    return items


def resolve(citation: str, occurrence: int = 1, heading: str = "", max_hits: int = 10) -> dict | None:
    cite = citation.rstrip(".")
    items: list[dict] = []
    for mh in (max_hits,) if max_hits > 10 else (10, 30, 50):
        items = [row for row in xhitlist_items(cite, mh) if row["citation"].rstrip(".") == cite]
        if items:
            break
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    head = squash(heading)
    for row in items:
        if squash(row["title"]) == head:
            return row
    if occurrence <= len(items):
        return items[occurrence - 1]
    return items[0]


def lis_html_to_text(page: str) -> str:
    page = re.sub(r"<script[\s\S]*?</script>", " ", page, flags=re.I)
    page = re.sub(r"<style[\s\S]*?</style>", " ", page, flags=re.I)
    chunks: list[str] = []
    for match in re.finditer(r"Normal-Level[^>]*>([\s\S]*?)</div>", page):
        chunk = match.group(1)
        chunk = re.sub(r"<br\s*/?>", "\n", chunk, flags=re.I)
        chunk = re.sub(r"<[^>]+>", " ", chunk)
        chunk = chunk.replace('">', " ").replace("&quot;", " ")
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if chunk:
            chunks.append(chunk)
    if chunks:
        return " ".join(chunks)
    page = re.sub(r"<br\s*/?>", "\n", page, flags=re.I)
    page = re.sub(r"<[^>]+>", " ", page)
    page = page.replace('">', " ").replace("&quot;", " ")
    return re.sub(r"\s+", " ", page).strip()


def _fetch_bytes(url: str, attempts: int = 5) -> bytes:
    import time

    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.5 * (i + 1))
    raise last


def fetch_page(url: str) -> str:
    return _fetch_bytes(url).decode("utf-8", errors="replace")
