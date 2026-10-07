"""Shared helpers for New Hampshire RSA (gencourt.state.nh.us / gc.nh.gov). Stdlib only."""
import os
import re
import urllib.parse

BASE = "https://www.gencourt.state.nh.us/rsa/html/"

ANCHOR = re.compile(r'<a\s+href="([^"]*)"[^>]*>(.*?)</a>', re.S | re.I)
CHAPTER_TOC = re.compile(r'href="(NHTOC-[^"]+\.htm)"', re.I)
TITLE_TOC = re.compile(r'href="(NHTOC/NHTOC-[^"]+\.htm)"', re.I)
MRG_HREF = re.compile(r'href="(\.\./[^"]+-mrg\.htm)"', re.I)
SECTION_HREF = re.compile(r'href="(\.\./([^"]+)/(\d+(?:-[A-Z])?)-(\d+(?:-[a-z])?)\.htm)"', re.I)
SECTION_LINE = re.compile(
    r'<a\s+href="[^"]+">\s*Section:\s*([\d]+(?:-[A-Z])?:[\d]+(?:-[a-z])?)\s*(.*?)\s*</a>',
    re.S | re.I,
)


def grab(arc, url, **kw):
    """Archive.fetch with Firecrawl fallback on 403/406 when key is set."""
    rec = arc.fetch(url, accept="text/html,*/*", **kw)
    if rec.get("state") != "complete" and rec.get("http_status") in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, accept="text/html,*/*", **kw)
    return rec


def abs_url(relative, from_dir="NHTOC/"):
    """Resolve relative href from a page under BASE."""
    return urllib.parse.urljoin(BASE + from_dir, relative)


def mrg_path_from_chapter_toc_html(html):
    m = MRG_HREF.search(html)
    if not m:
        return None
    return m.group(1).replace("../", "")


def chapter_key_from_mrg_path(path):
    """e.g. I/1/1-mrg.htm -> I/1; XIX-A/227-G/227-G-mrg.htm -> XIX-A/227-G"""
    parts = path.split("/")
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return path.replace("-mrg.htm", "")


def section_id_from_parts(chapter_num, section_num):
    return f"{chapter_num}:{section_num}"
