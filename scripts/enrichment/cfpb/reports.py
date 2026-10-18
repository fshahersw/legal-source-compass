"""Parse the CFPB research-report catalog pages (Wagtail filterable list) into report entries, as published.

Each <article class="o-post-preview"> yields: title, url (absolute), published date, category labels (meta header item
group), description (the list's preview text, unchanged apart from whitespace collapsing and HTML entity decoding) and
topic tags (label + slug). Nothing is inferred: a missing element stays None / [].
"""
import html
import re

SITE = "https://www.consumerfinance.gov"
ARTICLE = re.compile(r'<article class="o-post-preview"[^>]*>(.*?)</article>', re.S)
GROUP = re.compile(r'<div class="m-meta-header__item-group">(.*?)</div>', re.S)
GROUP_ITEM = re.compile(r'<span class="m-meta-header__item">(.*?)</span>', re.S)
TIME = re.compile(r'<time datetime="([^"]+)">(.*?)</time>', re.S)
TITLE = re.compile(r'<h3 class="o-post-preview__title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
DESC = re.compile(r'<div class="o-post-preview__description">(.*?)</div>', re.S)
TOPIC = re.compile(r'<a href="\?topics=([^"&]+)" class="a-tag-topic">.*?<span class="a-tag-topic__text">(.*?)</span>', re.S)
TOTAL = re.compile(r'(\d[\d,]*) filtered results')
PAGES = re.compile(r'(\d+) out of (\d+) total pages')
TAGS = re.compile(r"<[^>]+>")


def clean(fragment):
    if fragment is None:
        return None
    text = html.unescape(TAGS.sub(" ", fragment))
    text = " ".join(text.split())
    return text or None


def unique(values):
    """Drop repeats, keeping first-seen order (a catalog entry can list the same category tag twice)."""
    seen = set()
    return [v for v in values if not (v in seen or seen.add(v))]


def absolute(href):
    href = html.unescape(href.strip())
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return SITE + (href if href.startswith("/") else "/" + href)


def parse_article(block):
    title_match = TITLE.search(block)
    group = GROUP.search(block)
    listed = [c for c in (clean(item) for item in GROUP_ITEM.findall(group.group(1))) if c] if group else []
    categories = unique(listed)
    time_match = TIME.search(block)
    desc = DESC.search(block)
    return {
        "title": clean(title_match.group(2)) if title_match else None,
        "url": absolute(title_match.group(1)) if title_match else None,
        "date": time_match.group(1)[:10] if time_match else None,
        "date_label": clean(time_match.group(2)) if time_match else None,
        "categories": categories,
        "category_tags_repeated": len(listed) - len(categories),
        "description": clean(desc.group(1)) if desc else None,
        "topics": [{"slug": slug, "label": clean(label)} for slug, label in TOPIC.findall(block)],
    }


def parse_page(text):
    """Return (entries, declared_total_results, declared_total_pages) for one catalog page."""
    total = TOTAL.search(text)
    pages = PAGES.search(text)
    entries = [parse_article(block) for block in ARTICLE.findall(text)]
    return entries, (int(total.group(1).replace(",", "")) if total else None), (int(pages.group(2)) if pages else None)


def slug_from_url(url):
    path = url.split("://", 1)[-1].split("/", 1)[-1] if "://" in url else url
    parts = [p for p in path.split("?")[0].split("/") if p]
    return parts[-1] if parts else None
