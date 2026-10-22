"""Parse sec.gov enforcement listings (litigation releases, administrative proceedings) and litigation-release pages.

Pure functions, no network. Values come only from the labelled table cells / page body; absent values stay None.
"""
import html
import re

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean(fragment):
    if fragment is None:
        return None
    text = html.unescape(_TAG.sub(" ", fragment)).replace("\xa0", " ")
    text = _WS.sub(" ", text).strip()
    return text or None


def _subfield(row, name):
    m = re.search(
        r'<div class="view-table_subfield view-table_subfield_' + re.escape(name) + r'">\s*<span class="view-table_subfield_label">.*?</span>\s*<span class="view-table_subfield_value">(.*?)</span>\s*</div>',
        row, re.S)
    return m.group(1) if m else None


def parse_listing(text, base="https://www.sec.gov"):
    """Rows of an SEC litigation-release or administrative-proceeding listing table."""
    out = []
    for row in re.findall(r'<tr class="pr-list-page-row">(.*?)</tr>', text, re.S):
        date = re.search(r'<time datetime="([0-9T:\-Z+]+)"', row)
        resp = re.search(r"<div class='release-view__respondents'>(.*?)</div>", row, re.S)
        links = re.findall(r"<a href='([^']+)'>(.*?)</a>", resp.group(1), re.S) if resp else []
        respondents_html = resp.group(1) if resp else ""
        url = links[0][0] if links else None
        if url and url.startswith("/"):
            url = base + url
        see_also = []
        sa = _subfield(row, "see_also")
        if sa:
            for href, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', sa, re.S):
                see_also.append({"label": clean(label), "url": base + href if href.startswith("/") else href})
        out.append({
            "date": date.group(1)[:10] if date else None,
            "datetime": date.group(1) if date else None,
            "respondents": clean(respondents_html),
            "url": url,
            "release_number": clean(_subfield(row, "release_number")),
            "file_number": clean(_subfield(row, "file_number")),
            "see_also": see_also,
        })
    return out


def last_page(text):
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", text)]
    return max(pages) if pages else 0


def release_body(text):
    """Body HTML of a litigation-release page (the field--name-body block), or None."""
    m = re.search(r'<div class="clearfix text-formatted usa-prose field field--name-body[^"]*"[^>]*>(.*?)</div>\s*</div>\s*</div>\s*</div>', text, re.S)
    if m:
        return m.group(1)
    m = re.search(r'field--name-body[^>]*>(.*?)</div>', text, re.S)
    return m.group(1) if m else None


def body_text(body_html):
    """Block-aware plain text: headings and paragraphs become separate lines."""
    if body_html is None:
        return None
    t = re.sub(r"</(h[1-6]|p|li|div|tr)>", "\n", body_html)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = html.unescape(_TAG.sub(" ", t)).replace("\xa0", " ")
    lines = [_WS.sub(" ", line).strip() for line in t.split("\n")]
    return "\n".join(line for line in lines if line)


def page_title(text):
    m = re.search(r'<h1 class="page-title__heading">(.*?)</h1>', text, re.S)
    return clean(m.group(1)) if m else None


def resources(text, base="https://www.sec.gov"):
    m = re.search(r'field--name-field-see-also[^>]*>(.*?)</ul>', text, re.S)
    if not m:
        return []
    out = []
    for href, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', m.group(1), re.S):
        out.append({"label": clean(label), "url": base + href if href.startswith("/") else href})
    return out
