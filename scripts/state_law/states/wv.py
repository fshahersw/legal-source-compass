"""West Virginia — West Virginia Code, West Virginia Legislature (code.wvlegislature.gov).

Source: `https://code.wvlegislature.gov/` (chapter selector: every `CHAPTER n.` with its name; the page states "These
West Virginia Code sections are updated regularly as new legislation takes effect"), each chapter page
`https://code.wvlegislature.gov/<ch>/` (article list), and the site's own "Display all Article N Sections" call:
POST `https://code.wvlegislature.gov/wp-admin/admin-ajax.php` with `action=get_all_sections&chp=<ch>&art=<art>`, which
returns every section of an article as JSON `{"html": "<h4>§55-2-12. ...</h4><p>...</p>..."}`. robots.txt explicitly
allows /wp-admin/admin-ajax.php. One request per article instead of one per section.

Parsing (`wv-article-ajax/1`): each `<h4>§55-2-12. Personal actions not otherwise provided for.</h4>` starts a
section; the following `<p>` elements are its text. The online code prints no history lines. A heading-only entry
whose catchline is a marker ("Repealed.") is a status entry.
"""
from __future__ import annotations

import html as _html
import json
import re
import sys
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://code.wvlegislature.gov"
AJAX = SITE + "/wp-admin/admin-ajax.php"
PARSER = "wv-article-ajax/1"
HEAD = re.compile(r"^§\s?(\d+[A-Z]?-\d+[A-Z]?-\d+[a-z]?(?:\.\d+)?[a-z]?)\.\s*(.*)$", re.S)


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="WV", code_name="West Virginia Code", publisher="West Virginia Legislature", publisher_url=SITE + "/",
        official_source=True, access="api", hosts=("code.wvlegislature.gov",),
        codes=(lib.Code("WVC", "West Virginia Code", "W. Va. Code § {n}",
                        patterns=((r"^w\.\s?va\. code(?: ann\.)?\s*§\s*([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9a-z.]+)$", r"\1"),
                                  (r"^wv code\s*§\s*([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9a-z.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt allows "
                    "/wp-admin/admin-ajax.php, the endpoint the site's own 'Display all sections' button calls."),
        update_cadence="Sections are updated as new legislation takes effect (publisher statement); re-run after "
                       "each session's effective date (90 days after passage) and quarterly.")


META = _meta()


def parse_article(html_fragment: str):
    root = lxml_html.fragment_fromstring(html_fragment, create_parent="div")
    out, cur = [], None
    for el in root:
        if not isinstance(el.tag, str):
            continue
        if el.tag == "h4":
            m = HEAD.match(sb.one_line(el.text_content()))
            if m:
                if cur:
                    out.append(cur)
                cur = {"number": m.group(1), "heading": m.group(2).strip() or None, "lines": []}
                continue
        if cur is not None:
            text = sb.el_text(el)
            if text:
                cur["lines"].append(text)
    if cur:
        out.append(cur)
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [a.strip() for a in options.get("articles", "").split(",") if a.strip()]   # e.g. 55-2
    home = ctx.fetch(SITE + "/")
    page = lib.norm_ws(lib.html_text(home.body))
    m = re.search(r"These West Virginia Code sections are updated regularly as new legislation takes effect\.", page)
    ctx.edition(edition_label="West Virginia Code", currency_statement=m.group(0) if m else None,
                currency_source_url=SITE + "/")
    chapters = []
    for value, label in re.findall(r"<option value='([0-9A-Z]+)'>(CHAPTER[^<]*)</option>", home.text()):
        if value not in [c[0] for c in chapters]:
            chapters.append((value, re.sub(r"^CHAPTER\s+\S+?\.\s*", "", sb.one_line(_html.unescape(label))) or None))
    for chapter, chapter_name in chapters:
        if only and not any(a.split("-")[0] == chapter for a in only):
            continue
        cpage = ctx.fetch(f"{SITE}/{chapter}/")
        articles = []
        for key, label in re.findall(rf"<a href='/({re.escape(chapter)}-[0-9A-Z]+)/'>([^<]*)</a>", cpage.text()):
            if key not in [a[0] for a in articles]:
                articles.append((key, re.sub(r"^ARTICLE\s+\S+?\.\s*", "", sb.one_line(_html.unescape(label))) or None))
        for key, article_name in articles:
            if only and key not in only:
                continue
            art = key.split("-", 1)[1]
            fetched = ctx.fetch(AJAX, method="publisher_api", data=f"action=get_all_sections&chp={chapter}&art={art}".encode(),
                                headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                         "X-Requested-With": "XMLHttpRequest", "Referer": f"{SITE}/{key}/"})
            sections = parse_article(json.loads(fetched.body)["html"])
            path = [{"level": "chapter", "label": "Chapter", "number": chapter, "heading": chapter_name},
                    {"level": "article", "label": "Article", "number": art, "heading": article_name}]
            counts: dict[str, int] = {}
            for s in sections:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in sections:
                text = "\n".join(s["lines"])
                status = sb.status_kwargs(s["heading"], text)
                if status is None:
                    ctx.log(f"W. Va. Code § {s['number']}: no text and no marker; skipped")
                    continue
                heading = s["heading"]
                if status["status"] != "in_force" and status["status_marker"] == heading:
                    heading = None
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                source = dict(fetched.source(), request=f"POST action=get_all_sections&chp={chapter}&art={art}",
                              display_url=f"{SITE}/{s['number'].upper()}/")
                ctx.section(code="WVC", number=s["number"], heading=heading, text=text, path=path, source=source,
                            version_index=index_, **status)
                if not ctx.want_more():
                    return
