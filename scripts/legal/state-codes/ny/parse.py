"""Parse New York Senate OpenLegislation law pages (www.nysenate.gov/legislation/laws), parser ny-openleg-html/2.

Every page prints its own table of contents as `ul.nys-openleg-items-container > li.nys-openleg-result-item-container`
entries ("SECTION 2-A Release of ...", "ARTICLE 2 ...", "RULE 3211 ..."). A leaf page (SECTION or RULE headline) prints
its text in one `.nys-openleg-result-text` block; `<br>` is the publisher's line break and is kept as a newline.
The publisher's revision line is kept verbatim; a date is recorded only when that line already contains YYYY-MM-DD.
"""
import re
import urllib.parse

from bs4 import BeautifulSoup

BASE = "https://www.nysenate.gov"
INDEX = BASE + "/legislation/laws/CONSOLIDATED"
NODE_URL = re.compile(r"^https://www\.nysenate\.gov/legislation/laws/([A-Z][A-Z0-9]{1,6})(?:/([^/?#]+))?$")
REVISION = re.compile(r"Viewing most recent revision \(from (\d{4}-\d{2}-\d{2})\)")
LEAF_TYPES = ("SECTION", "RULE")
NOT_FOUND = "The requested entry could not be found."


def canon(href):
    href = href.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    if href.startswith("/"):
        href = BASE + href
    return urllib.parse.unquote(href)


def split_url(url):
    match = NODE_URL.match(url)
    return (match.group(1), match.group(2)) if match else (None, None)


def _text(node):
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def toc_entries(soup):
    """The publisher's own child entries on this page, in printed order: [(url, label, type)]."""
    out = []
    for item in soup.select("ul.nys-openleg-items-container li.nys-openleg-result-item-container"):
        anchor = item.find("a", href=True)
        if anchor is None:
            continue
        label = _text(anchor)
        word = label.split(" ", 1)[0].upper() if label else ""
        out.append((canon(anchor["href"]), label, word))
    return out


def section_text(node):
    for br in node.find_all("br"):
        br.replace_with("\n")
    return node.get_text().replace("\r\n", "\n").strip()


def parse_page(html, url):
    soup = BeautifulSoup(html, "lxml")
    law, node = split_url(url)
    published = soup.select_one(".nys-openleg-history-published")
    statement = _text(published) or None
    found = REVISION.search(statement or "")
    headline = _text(soup.select_one(".nys-openleg-result-title-headline"))
    head_word = headline.split(" ", 1)[0].upper() if headline else ""
    blocks = soup.select(".nys-openleg-result-text")
    page = {
        "url": url,
        "law": law,
        "node": node,
        "not_found": NOT_FOUND in soup.get_text(" ", strip=True) and not headline,
        "statute_page": soup.select_one(".nys-openleg-statute-container") is not None,
        "headline": headline or None,
        "type": head_word or None,
        "number": headline.split(" ", 1)[1].strip() if " " in headline else None,
        "heading": _text(soup.select_one(".nys-openleg-result-title-short")) or None,
        "location": _text(soup.select_one(".nys-openleg-result-title-location")) or None,
        "currency_statement": statement,
        "revision_date": found.group(1) if found else None,
        "toc": toc_entries(soup),
        "text_blocks": len(blocks),
        "text": section_text(blocks[0]) if blocks else "",
        "pager": [a["href"] for a in soup.select(".nys-openleg-result-container a[href*='page=']")],
    }
    page["leaf"] = page["type"] in LEAF_TYPES
    return page
