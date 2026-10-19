"""Parse Revised Code of Washington pages from app.leg.wa.gov (Office of the Code Reviser).

Title page (default.aspx?Cite=9A): <h1>Title 9A RCW</h1>, <h2>WASHINGTON CRIMINAL CODE</h2>, a "Chapters" table.
Chapter page (default.aspx?cite=9A.32&full=true): <h1>Chapter 9A.32 RCW</h1>, <h2>HOMICIDE</h2>, a "Sections" table
(the chapter's contents), then span#ContentPlaceHolder1_dlSectionContent with one <span> per section: an anchor
named by the section number, "RCW 9A.32.010" and the catchline in <h3>s, the text paragraphs (one <div> each), the
bracketed history "[1997 c 196 s 3; ...]", then optional "NOTES:" (Code Reviser annotations, not kept).

Page structure as documented in open-us-law scripts/state_scrapers/.../wa/statutes/scrapeWA.py (Apache-2.0,
Vaquill AI); this parser is a separate implementation over the full-chapter page. Text is the publisher's own
words: tags removed, non-breaking spaces as spaces, whitespace runs collapsed; nothing is added.
"""
import re

import lxml.html

WS = re.compile(r"[ \t\r\n    ]+")
# 9A.32.030, 43.21C.010 and the Uniform Commercial Code's 62A.2-101, 62A.9A-102, 62A.5-1013.
NUMBER = re.compile(r"^\d+[A-Z]?\.\d+[A-Z]?[.-]\d+[0-9A-Za-z]*$")
EFFECTIVE = re.compile(r"\((Effective|Expires|Contingent)[^()]*\)\s*\.?$", re.I)


def clean(text):
    return WS.sub(" ", text or "").strip()


def _tree(html):
    return lxml.html.fromstring(html)


def page_heading(tree):
    h1 = tree.xpath("//h1")
    h2 = tree.xpath("//h2")
    return clean(h1[0].text_content()) if h1 else "", clean(h2[0].text_content()) if h2 else ""


def _table_after(tree, label):
    for h3 in tree.xpath("//h3[contains(@class,'list-heading')]"):
        if clean(h3.text_content()).lower() == label.lower():
            table = h3.getnext()
            while table is not None and table.tag != "table":
                table = table.getnext()
            return table
    return None


def table_rows(table):
    """[(cite, caption)] from a Chapters/Sections listing table."""
    rows = []
    if table is None:
        return rows
    for tr in table.iter("tr"):
        tds = tr.findall("td")
        if len(tds) < 2:
            continue
        cite = clean(tds[-2].text_content())
        caption = clean(tds[-1].text_content())
        if cite:
            rows.append((cite, caption))
    return rows


def parse_title_page(html):
    tree = _tree(html)
    h1, h2 = page_heading(tree)
    table = _table_after(tree, "Chapters")
    if table is not None:
        return {"h1": h1, "caption": h2, "chapters": table_rows(table)}
    # Title 62A (Uniform Commercial Code) lists its articles in a table with no "Chapters" heading.
    for candidate in tree.xpath("//div[@id='contentWrapper']//table"):
        rows = table_rows(candidate)
        if rows and all(re.match(r"^\d+[A-Z]?\.\d+[A-Z]?$", cite) for cite, _ in rows):
            return {"h1": h1, "caption": h2, "chapters": rows}
    return {"h1": h1, "caption": h2, "chapters": []}


def _cite_text(div):
    """The "RCW <number>" text of a cite heading, without the page's "PDF" button (an <a class="btn">)."""
    h3 = div.find("h3")
    if h3 is None:
        return None
    # A cite heading carries the page's PDF button; a catchline that merely starts with "RCW" does not.
    buttons = h3.xpath(".//a[contains(@class,'btn')]")
    if not buttons:
        return None
    text = clean(div.text_content())
    label = "".join(clean(a.text_content()) for a in buttons)
    text = clean(text[len(label):] if text.startswith(label) else text)
    return text if text.startswith("RCW ") else None


def _sections(span):
    """Every version printed in one section span (a span can hold two versions, e.g. '(as amended by 1989 c 175)'
    and '(as amended by 1989 c 372)', each with its own cite heading)."""
    anchor = span.xpath(".//a[@name]")
    number = anchor[0].get("name") if anchor else None
    versions = []
    cur = None
    stage = "cite"
    for div in (d for d in span if d.tag == "div"):
        text = clean(div.text_content())
        h3 = div.find("h3")
        cite = _cite_text(div)
        if cite is not None:
            cur = {"number": number, "cite_line": cite, "heading": None, "paragraphs": [], "history": None}
            versions.append(cur)
            stage = "heading"
            continue
        if cur is None or stage == "notes":
            continue
        if text.upper() == "NOTES:" or (h3 is not None and clean(h3.text_content()).upper() == "NOTES:"):
            stage = "notes"  # Code Reviser notes run until the next version's cite heading
        elif stage == "heading" and h3 is not None:
            cur["heading"], stage = text, "body"
        elif stage == "body" and "margin-top:15pt" in (div.get("style") or "").replace(" ", "") and text.startswith("["):
            cur["history"], stage = text, "done"
        elif stage == "body":
            children = [c for c in div if c.tag in ("div", "table", "p")]
            if children:
                cur["paragraphs"].extend(t for t in (clean(c.text_content()) for c in children) if t)
            elif text:
                cur["paragraphs"].append(text)
    return versions or [{"number": number, "cite_line": None, "heading": None, "paragraphs": [], "history": None}]


def parse_chapter_page(html):
    tree = _tree(html)
    h1, h2 = page_heading(tree)
    out = {"h1": h1, "caption": h2, "toc": table_rows(_table_after(tree, "Sections")), "sections": [], "errors": []}
    holder = tree.xpath("//span[@id='ContentPlaceHolder1_dlSectionContent']")
    if not holder:
        return out
    for span in holder[0]:
        if span.tag != "span":
            continue
        for section in _sections(span):
            if section["cite_line"] is None:
                # Part/article headings inside a chapter carry an anchor (e.g. 11.130.000009) but no "RCW" cite line.
                out.setdefault("part_headings", []).append({"anchor": section["number"], "text": clean(span.text_content())[:120]})
                continue
            if not section["number"] or not NUMBER.match(section["number"]):
                out["errors"].append({"error": "section without a valid anchor", "text": clean(span.text_content())[:120]})
                continue
            if section["cite_line"] != f"RCW {section['number']}":
                out["errors"].append({"number": section["number"], "error": f"cite line {section['cite_line']!r}"})
                continue
            effective = EFFECTIVE.search(section["heading"] or "")
            amended = re.search(r"\(as amended by [^()]+\)", section["heading"] or "")
            notes = [m.group(0).strip(" .") for m in (amended, effective) if m]
            section["version_note"] = "; ".join(notes) or None
            out["sections"].append(section)
    return out
