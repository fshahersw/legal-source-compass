"""Parse New York Senate OpenLegislation law HTML (www.nysenate.gov/legislation/laws).

The publisher's own revision line is kept verbatim. A date is recorded only when
that line already contains YYYY-MM-DD.
"""
import re
from html import unescape

from bs4 import BeautifulSoup

LAW_URL = re.compile(r"https://www\.nysenate\.gov/legislation/laws/([A-Z][A-Z0-9]{1,6})/?$")
NODE_URL = re.compile(r"https://www\.nysenate\.gov/legislation/laws/([A-Z][A-Z0-9]{1,6})/([A-Z0-9][A-Z0-9.-]*)/?$")
ARTICLE = re.compile(r"^A\d+(?:-[A-Z])?$")
REVISION = re.compile(r"Viewing most recent revision \(from (\d{4}-\d{2}-\d{2})\)")


def classify(url):
    if LAW_URL.search(url):
        return "law"
    match = NODE_URL.search(url)
    if not match:
        return None
    return "article" if ARTICLE.match(match.group(2)) else "section"


def _heading_after(soup, prefix):
    for heading in soup.find_all("h2"):
        if _text(heading).upper().startswith(prefix):
            nxt = heading.find_next("h3")
            return _text(nxt)
    return ""


def _text(node):
    if node is None:
        return ""
    return unescape(re.sub(r"\s+", " ", node.get_text(" ", strip=True))).strip()


def revision(soup):
    node = soup.select_one(".nys-openleg-history-published")
    statement = _text(node)
    found = REVISION.search(statement)
    return statement, (found.group(1) if found else None)


def links(soup, kind):
    found = []
    for anchor in soup.select("a[href]"):
        href = anchor["href"].split("?")[0].rstrip("/")
        if not href.startswith("http"):
            href = "https://www.nysenate.gov" + href
        if classify(href) == kind and href not in found:
            found.append(href)
    return found


def parse_document(html, url):
    soup = BeautifulSoup(html, "lxml")
    kind = classify(url)
    statement, as_of = revision(soup)
    code = (LAW_URL.search(url) or NODE_URL.search(url))
    code = code.group(1) if code else None
    base = {"url": url, "kind": kind, "code": code, "currency_statement": statement or None, "revision_date": as_of}
    if kind == "law":
        base["articles"] = links(soup, "article")
        base["title"] = _text(soup.select_one("h1")) or _text(soup.select_one("h2"))
        return base
    if kind == "article":
        base["sections"] = links(soup, "section")
        base["heading"] = _text(soup.select_one("h3"))
        return base
    text_node = soup.select_one(".nys-openleg-result-text")
    base.update({
        "section": NODE_URL.search(url).group(2),
        "heading": _heading_after(soup, "SECTION"),
        "location": _text(soup.select_one(".nys-openleg-result-title-location")),
        "text": _text(text_node),
    })
    return base
