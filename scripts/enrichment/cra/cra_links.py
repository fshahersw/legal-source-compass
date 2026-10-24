"""List PDF links (absolute) found in fetched HTML pages.

    python3 -I -B scripts/enrichment/cra/cra_links.py <page url> [...]
"""
from __future__ import annotations

import html
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402

HREF = re.compile(r'href\s*=\s*"([^"]+)"', re.I)


def pdf_links(page_url: str, text: str) -> list[tuple[str, str]]:
    """(absolute url, anchor text) for every link whose path ends in .pdf, in page order, de-duplicated."""
    out, seen = [], set()
    for m in re.finditer(r'<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>(.*?)</a>', text, re.I | re.S):
        href = html.unescape(m.group(1)).strip()
        absu = urllib.parse.urljoin(page_url, href)
        if urllib.parse.urlsplit(absu).path.lower().endswith(".pdf") and absu not in seen:
            seen.add(absu)
            label = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
            out.append((absu, label))
    return out


if __name__ == "__main__":
    man = cra_fetch.load_manifest()
    for u in sys.argv[1:]:
        row = man[u]
        text = cra_fetch.read(row).decode("utf-8", "replace")
        print("==", u)
        for link, label in pdf_links(row.get("final_url") or u, text):
            print(link, "|", label[:90])
