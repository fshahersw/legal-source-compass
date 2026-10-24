"""Vermont — Vermont Statutes Online, Vermont General Assembly (legislature.vermont.gov).

Source: `https://legislature.vermont.gov/statutes/` (titles `/statutes/title/<t>`), each title page lists its chapters
(`/statutes/chapter/<t>/<ccc>`), and `https://legislature.vermont.gov/statutes/fullchapter/<t>/<ccc>` prints a whole
chapter. Every page carries the publisher's notice, kept verbatim as the currency statement: "The Statutes below now
include the actions of the 2026 session of the General Assembly. NOTE: The Vermont Statutes Online is an unofficial
copy of the Vermont Statutes Annotated that is provided as a convenience." robots.txt asks for `Crawl-delay: 30`
(honored: ~2,200 requests, about 19 hours for a full run).

Parsing (`vt-fullchapter/1`): each `<li><div>` holds one section: the bold `§ 512. Assault and battery; ...` line
(number, catchline), then its paragraphs; the session-law parenthetical the publisher appends to the last paragraph
(`(Amended 1967, No. 32, § 2, eff. March 16, 1967; ...)`) is the history. Section numbers are unique only within a
title, so the number is `<title>:<section>` (`12:512`, cited `Vt. Stat. Ann. tit. 12, § 512`). A heading that is a
marker (`§ 595. Repealed. 1971, No. 185 ...`) is a status entry.
"""
from __future__ import annotations

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

SITE = "https://legislature.vermont.gov"
INDEX = SITE + "/statutes/"
PARSER = "vt-fullchapter/1"
HEAD = re.compile(r"^§+\s*([0-9]+[a-zA-Z]?(?:-[0-9]+[a-zA-Z]?)?(?:\.[0-9]+)?[a-z]?)\.\s*(.*)$", re.S)
HISTORY_START = re.compile(r"^\((?:Added|Amended|\d{4}|Derived|Formerly|Recodified|Repealed|P\.L\.|R\.\s?\d|G\.L\.|V\.S\.|"
                           r"Redesignated|Renumbered|Former)")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="VT", code_name="Vermont Statutes", publisher="Vermont General Assembly", publisher_url=INDEX,
        official_source=True, access="html", hosts=("legislature.vermont.gov",),
        codes=(lib.Code("VSA", "Vermont Statutes Annotated (statute text)", "Vt. Stat. Ann. tit. {t}, § {s}",
                        patterns=((r"^vt\. stat\. ann\.,? tit\.\s*([0-9]+[a-z]?),?\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"),
                                  (r"^([0-9]+[a-z]?)\s*v\.\s?s\.\s?a\.\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"))),),
        parser=PARSER, min_interval_s=30.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The publisher calls the "
                    "online statutes an unofficial convenience copy of the V.S.A.; robots.txt: Crawl-delay 30."),
        update_cadence="Updated after each session ('now include the actions of the <year> session'); re-run each "
                       "summer after the update notice changes.")


META = _meta()


def split_history(text: str):
    stripped = text.rstrip()
    if not stripped.endswith(")"):
        return text, None
    depth = 0
    for i in range(len(stripped) - 1, -1, -1):
        ch = stripped[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                candidate = stripped[i:]
                if HISTORY_START.match(candidate) and (i == 0 or stripped[i - 1] in " \t\n"):
                    return stripped[:i].rstrip(), candidate
                return text, None
    return text, None


def parse_fullchapter(raw: bytes):
    doc = lxml_html.fromstring(raw.decode("utf-8", errors="replace"))
    crumbs = [sb.one_line(a.text_content()) for a in doc.xpath('//*[contains(@class,"statute-br")]//a | '
                                                               '//*[contains(@class,"statute-br")]//li')]
    out = []
    for div in doc.xpath("//li/div"):
        paras = div.xpath("./p")
        if not paras or not paras[0].xpath("./b"):
            continue
        m = HEAD.match(sb.one_line(paras[0].text_content()))
        if not m:
            continue
        lines = [sb.one_line(sb.el_text(p)) for p in paras[1:]]
        lines = [x for x in lines if x]
        for table in div.xpath("./table"):
            t = sb.el_text(table)
            if t:
                lines.append(t)
        body = "\n".join(lines)
        text, history = split_history(body)
        out.append({"number": m.group(1), "heading": m.group(2).strip() or None, "text": text,
                    "history": history})
    return {"crumbs": crumbs, "sections": out}


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]   # e.g. 12/023
    index = ctx.get(INDEX, fallback_fresh=True)
    page = lib.norm_ws(lib.html_text(index.body))
    m = re.search(r"The Statutes below now include the actions of the \d{4} session of the General Assembly\.\s*NOTE: "
                  r"The Vermont Statutes Online is an unofficial copy of the Vermont Statutes Annotated that is provided "
                  r"as a convenience\.", page)
    ctx.edition(edition_label="Vermont Statutes Online", currency_statement=m.group(0) if m else None,
                currency_source_url=INDEX if m else None)
    titles = list(dict.fromkeys(re.findall(r'href="/statutes/title/([0-9A-Za-z]+)"', index.text())))
    for title in titles:
        if only and not any(o.split("/")[0] == title for o in only):
            continue
        tpage = ctx.get(f"{SITE}/statutes/title/{title}", fallback_fresh=True)
        thead = None
        th = re.search(r'<h2 class="statute-header">(.*?)</h2>', tpage.text(), re.S)
        if th:
            thead = re.sub(r"^Title\s+\S+\s*:\s*", "", sb.strip_tags(th.group(1))) or None
        chapters = []
        for ch, name in re.findall(rf'href="/statutes/chapter/{re.escape(title)}/([0-9A-Za-z]+)"[^>]*>(.*?)</a>',
                                   tpage.text(), re.S):
            if ch not in [c[0] for c in chapters]:
                chapters.append((ch, sb.one_line(re.sub(r"<[^>]+>", " ", name)) or None))
        ctx.prefetch(f"{SITE}/statutes/fullchapter/{title}/{c}" for c, _n in chapters)  # retained runs: read ahead
        for chapter, name in chapters:
            if only and f"{title}/{chapter}" not in only:
                continue
            fetched = ctx.get(f"{SITE}/statutes/fullchapter/{title}/{chapter}", fallback_fresh=True)
            parsed = parse_fullchapter(fetched.body)
            path = [{"level": "title", "label": "Title", "number": title, "heading": thead},
                    {"level": "chapter", "label": "Chapter", "number": chapter.lstrip("0") or chapter,
                     "heading": re.sub(r"^Chapter\s+\S+\s*:\s*", "", sb.one_line(name or "")) or None}]
            counts: dict[str, int] = {}
            for s in parsed["sections"]:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in parsed["sections"]:
                status = sb.status_kwargs(s["heading"], s["text"])
                if status is None:
                    ctx.log(f"{title} V.S.A. § {s['number']}: no text and no marker; skipped")
                    continue
                heading = s["heading"]
                if status["status"] != "in_force" and status["status_marker"] == heading:
                    heading = None
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                ctx.section(code="VSA", number=f"{title}:{s['number']}", heading=heading, text=s["text"], path=path,
                            source=fetched,
                            history=s["history"], version_index=index_, **status)
                if not ctx.want_more():
                    return
