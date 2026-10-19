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
NUMBER = re.compile(r"^\d+[A-Z]?\.\d+[A-Z]?\.\d+[0-9A-Za-z]*$")
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
    return {"h1": h1, "caption": h2, "chapters": table_rows(_table_after(tree, "Chapters"))}


def _section(span):
    anchor = span.xpath(".//a[@name]")
    number = anchor[0].get("name") if anchor else None
    divs = [d for d in span if d.tag == "div"]
    cite_line, heading, paragraphs, history = None, None, [], None
    stage = "cite"
    for div in divs:
        text = clean(div.text_content())
        h3 = div.find("h3")
        if text.upper() == "NOTES:" or (h3 is not None and clean(h3.text_content()).upper() == "NOTES:"):
            break
        if stage == "cite" and h3 is not None:
            # The cite heading starts with the page's "PDF" button (an <a class="btn">), which is not citation text.
            buttons = "".join(clean(a.text_content()) for a in h3.xpath(".//a[contains(@class,'btn')]"))
            cite_line, stage = clean(text[len(buttons):] if buttons and text.startswith(buttons) else text), "heading"
        elif stage == "heading" and h3 is not None:
            heading, stage = text, "body"
        elif stage == "body" and "margin-top:15pt" in (div.get("style") or "").replace(" ", "") and text.startswith("["):
            history, stage = text, "done"
        elif stage == "body":
            children = [c for c in div if c.tag in ("div", "table", "p")]
            if children:
                paragraphs.extend(t for t in (clean(c.text_content()) for c in children) if t)
            elif text:
                paragraphs.append(text)
    return {"number": number, "cite_line": cite_line, "heading": heading, "paragraphs": paragraphs, "history": history}


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
        section = _section(span)
        if not section["number"] or not NUMBER.match(section["number"]):
            out["errors"].append({"error": "section without a valid anchor", "text": clean(span.text_content())[:120]})
            continue
        if section["cite_line"] != f"RCW {section['number']}" and not (section["cite_line"] or "").startswith(f"RCW {section['number']}"):
            out["errors"].append({"number": section["number"], "error": f"cite line {section['cite_line']!r}"})
            continue
        effective = EFFECTIVE.search(section["heading"] or "")
        section["version_note"] = effective.group(0).strip(" .") if effective else None
        out["sections"].append(section)
    return out
