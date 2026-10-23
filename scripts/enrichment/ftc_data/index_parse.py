"""Parse the FTC's Data Spotlight and policy-report listing pages (ftc.gov Drupal views) into index items.

Pure functions over HTML text: no network, no private/ reads. Text is returned as the page shows it (whitespace collapsed);
a summary the page itself cuts off with "..." is kept cut off. Nothing is summarised, rewritten or completed.
"""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

BASE = "https://www.ftc.gov"
SIZE = re.compile(r"\(\s*([\d.,]+\s*[KMG]?B)\s*\)", re.I)


def text_of(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node is not None else ""


def absolute(href, base=BASE):
    return urljoin(base + "/", href) if href else None


def file_links(node):
    out = []
    for a in node.select(".file a"):
        href = absolute(a.get("href"))
        if not href:
            continue
        size = None
        span = a.find_next_sibling("span", class_="file-size")
        if span is not None:
            m = SIZE.search(text_of(span))
            size = m.group(1) if m else None
        out.append({"title": text_of(a), "url": href, "size": size})
    return out


def parse_views_listing(html):
    """Items of a listing page built from `.views-row` articles (Data Spotlight, Commission and Staff Reports, ...)."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    items = []
    for row in main.select(".views-row"):
        title_a = row.select_one(".node-title a")
        title_el = title_a if title_a is not None else row.select_one(".node-title")
        if title_el is None or not text_of(title_el):
            continue  # an empty banner row, not a report
        time_el = row.select_one("time")
        body = row.select_one(".field--name-body .field__item")
        if body is None and title_a is None:
            body = row.find("p")  # the economic issue papers layout carries its abstract in a bare paragraph
        press = [{"title": text_of(a), "url": absolute(a.get("href"))} for a in row.select(".field--name-field-press-releases a")]
        series = row.select_one(".field--name-field-blog .field__item")
        iso = (time_el.get("datetime") or "")[:10] if time_el is not None else ""
        items.append(
            {
                "title": text_of(title_el),
                "url": absolute(title_a.get("href")) if title_a is not None else None,
                "date_display": text_of(time_el) or None,
                "date_iso": iso if re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso) else None,
                "summary": text_of(body) or None,
                "series_label": text_of(series) or None,
                "files": file_links(row),
                "press_releases": press,
            }
        )
    return items


def parse_pager(html):
    """(displaying_text, last_page_index) from a listing page: 'Displaying 1 - 20 of 559' and the highest ?page=N link."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    m = re.search(r"Displaying\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)", text_of(main))
    pages = [int(x) for a in main.select("a[href]") for x in re.findall(r"[?&]page=(\d+)", a["href"])]
    return (m.group(0) if m else None), (max(pages) if pages else 0), (int(m.group(3)) if m else None)


def parse_file_sections(html):
    """Files grouped under the headings of a page that lists reports as files only (HSR annual reports, FTC annual reports).

    Returns [{"section": heading text, "title": file link text, "url": ..., "size": ...}] in page order. Headings of the
    site's menus are skipped."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    skip = {"Reports Menu", "Reports", "Policy Menu"}
    section = None
    out = []
    for node in main.descendants:
        name = getattr(node, "name", None)
        if name in ("h2", "h3", "h4"):
            heading = text_of(node)
            if heading and heading not in skip:
                section = heading
        elif name == "a" and node.find_parent(class_="file") is not None and node.get("href"):
            span = node.find_next_sibling("span", class_="file-size")
            m = SIZE.search(text_of(span)) if span is not None else None
            out.append({"section": section, "title": text_of(node), "url": absolute(node["href"]), "size": m.group(1) if m else None})
    return out


def slug(text, limit=70):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:limit].strip("-") or "item"


def page_slug(url):
    """Last path segment of an ftc.gov item URL, for stable record ids."""
    path = (url or "").split("?")[0].rstrip("/")
    return slug(path.rsplit("/", 1)[-1], 90)


def parse_contributors(html):
    """The Consumer Sentinel 'Data Contributors' page: organisations that share complaints with the Network, and entities that
    refer complaints to the FTC, each exactly as listed (one name per line of the page, in page order).

    Returns {"contributors": [...], "referrers": [...], "intro": str, "referrers_intro": str}. A list is empty when its
    lead-in sentence is absent."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    body = main.select_one(".field--name-body") or main
    paragraphs = body.find_all("p")
    lead_contrib = lead_refer = None
    for i, p in enumerate(paragraphs):
        t = text_of(p)
        if lead_contrib is None and t.startswith("The Consumer Sentinel Network allows law enforcement"):
            lead_contrib = i
        if lead_refer is None and t.startswith("In addition, the following entities refer complaints"):
            lead_refer = i

    def names(i):
        if i is None or i + 1 >= len(paragraphs):
            return []
        lines = [re.sub(r"\s+", " ", x).strip() for x in paragraphs[i + 1].get_text("\n").split("\n")]
        return [x for x in lines if x]

    return {
        "contributors": names(lead_contrib),
        "referrers": names(lead_refer),
        "intro": text_of(paragraphs[lead_contrib]) if lead_contrib is not None else "",
        "referrers_intro": text_of(paragraphs[lead_refer]) if lead_refer is not None else "",
    }
