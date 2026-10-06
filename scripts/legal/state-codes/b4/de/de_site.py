"""Delaware Code Online URL patterns and page structure helpers (stdlib only)."""
import re

BASE = "https://delcode.delaware.gov/"
CHAPTER_INDEX_RE = re.compile(
    r"https://delcode\.delaware\.gov/title(\d+)/(c[^/]+)/index\.html$"
)
UNIT_URL_RE = re.compile(
    r"https://delcode\.delaware\.gov/title(\d+)/(c[^/]+)(?:/([^/]+))?/index\.html$"
)
CHILD_HREF_RE = re.compile(
    r"(?:\.\./)*title(\d+)/(c[^/]+)/([^/]+)/index\.html", re.I
)
SECTION_HEAD_RE = re.compile(r'class="SectionHead"', re.I)
ANCHOR = re.compile(r'<a\s+href="([^"]*)"[^>]*>', re.S | re.I)


def clean_href(h):
    return re.sub(r"\s+", "", (h or "").replace("&#xA;", ""))


def section_head_count(html):
    return len(SECTION_HEAD_RE.findall(html or ""))


def child_page_urls(html, title_num, chap_slug):
    """Official sub-pages under one chapter (subchapters, etc.)."""
    out = []
    t, c = str(title_num), chap_slug
    for h in ANCHOR.findall(html or ""):
        h = clean_href(h)
        m = CHILD_HREF_RE.search(h)
        if not m or m.group(1) != t or m.group(2) != c:
            continue
        slug = m.group(3)
        if slug.lower() == "index.html":
            continue
        out.append(f"{BASE}title{t}/{c}/{slug}/index.html")
    return list(dict.fromkeys(out))


def is_chapter_index(html, title_num, chap_slug):
    return section_head_count(html) == 0 and bool(child_page_urls(html, title_num, chap_slug))


def parse_unit_url(url):
    m = UNIT_URL_RE.match(url)
    if not m:
        return None
    return {
        "title_num": m.group(1),
        "chap_slug": m.group(2),
        "sub_slug": m.group(3),
    }


def chap_num_from_slug(chap_slug):
    rest = chap_slug[1:] if chap_slug.startswith("c") else chap_slug
    if rest.isdigit():
        return str(int(rest))
    return rest
