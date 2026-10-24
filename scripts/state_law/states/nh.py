"""New Hampshire — Revised Statutes Annotated (statute text), New Hampshire General Court (gencourt.state.nh.us).

Source: the General Court's RSA pages; each chapter is printed whole on a "merged" page
`https://www.gencourt.state.nh.us/rsa/html/<TITLE>/<ch>/<ch>-mrg.htm` (e.g. `.../LII/508/508-mrg.htm`). The pages
print no currency line.

On 2026-10-23 www.gencourt.state.nh.us answered with a redirect (301) to gc.nh.gov, and gc.nh.gov closed the
connection without an HTTP answer, so a live run is refused (Blocked) and the live enumeration is not proven here. The
project's retained originals (1,314 merged chapter pages captured 2026-10-06) are re-parsed with
`--option source=retained`.

Parsing (`nh-merged-chapter/1`): `<h1>` "TITLE LII<br>ACTIONS, ..." and `<h2>` "Chapter 508<br>LIMITATION OF ACTIONS"
are the hierarchy; each `<h3>Section 508:4</h3>` starts a section; its bold line `508:4 Personal Actions. –` gives
number and catchline; `<codesect>` is the text (one line per `<br>`-separated paragraph); `<sourcenote>` "Source. ..."
is the history (label dropped). A catchline that is a marker with an empty `<codesect>`
(`508:4-a Repealed by 1965, 241:3, eff. Aug. 31, 1965.`) is a status entry.
"""
from __future__ import annotations

import html as _html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://www.gencourt.state.nh.us"
ROOT = SITE + "/rsa/html/"
PARSER = "nh-merged-chapter/1"
BLOCK = re.compile(r"<center>\s*<h3>\s*Section\s+([^<]+?)\s*</h3>\s*</center>", re.I)
BOLD = re.compile(r"<b>\s*(.*?)\s*</b>", re.I | re.S)


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NH", code_name="New Hampshire Revised Statutes Annotated (statute text)",
        publisher="New Hampshire General Court", publisher_url=ROOT + "indexes/default.html", official_source=True,
        access="html", hosts=("www.gencourt.state.nh.us", "gc.nh.gov"),
        codes=(lib.Code("RSA", "Revised Statutes Annotated", "N.H. Rev. Stat. Ann. § {n}",
                        patterns=((r"^n\.h\. rev\. stat\.(?: ann\.)?\s*§?\s*([0-9]+(?:-[a-z]+)?:[0-9a-z\-]+)$", r"\1"),
                                  (r"^rsa\s*(?:§\s*)?([0-9]+(?:-[a-z]+)?:[0-9a-z\-]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The host closed connections "
                    "from this network on 2026-10-23; retained originals of 2026-10-06 are re-parsed."),
        update_cadence="Chapters are republished as session laws take effect; re-run after each effective-date wave.")


META = _meta()


def _lines(fragment: str) -> list[str]:
    out = []
    for part in re.split(r"<br\s*/?>|</?p\b[^>]*>", fragment, flags=re.I):
        text = sb.one_line(_html.unescape(re.sub(r"<[^>]+>", "", part)))     # inline <i>/<b> join their words
        if text:
            out.append(text)
    return out


def _head(tag: str, page: str):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", page, re.I | re.S)
    if not m:
        return None, None
    parts = _lines(m.group(1))
    if not parts:
        return None, None
    first = re.match(r"^(?:TITLE|Chapter)\s+(\S+)$", parts[0], re.I)
    return (first.group(1) if first else None), (" ".join(parts[1:]) or None)


def parse_chapter(raw: bytes):
    page = raw.decode("utf-8", errors="strict") if _is_utf8(raw) else raw.decode("cp1252", errors="replace")
    title = _head("h1", page)
    chapter = _head("h2", page)
    starts = list(BLOCK.finditer(page))
    sections = []
    for i, m in enumerate(starts):
        block = page[m.end():starts[i + 1].start() if i + 1 < len(starts) else len(page)]
        bold = BOLD.search(block)
        head = sb.one_line(_html.unescape(re.sub(r"<[^>]+>", " ", bold.group(1)))) if bold else ""
        head = re.sub(r"\s*[–\u0096]\s*$", "", head)
        number = sb.one_line(m.group(1))
        heading = head[len(number):].strip() if head.startswith(number) else head or None
        code = re.search(r"<codesect>(.*?)</codesect>", block, re.I | re.S)
        note = re.search(r"<sourcenote>(.*?)</sourcenote>", block, re.I | re.S)
        history = " ".join(_lines(note.group(1))) if note else ""
        history = re.sub(r"^Source\.\s*", "", history).strip() or None
        sections.append({"number": number, "heading": heading or None,
                         "text": "\n".join(_lines(code.group(1))) if code else "", "history": history})
    return {"title": title, "chapter": chapter, "sections": sections}


def _is_utf8(raw: bytes) -> bool:
    try:
        raw.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    retained = getattr(ctx, "retained", None)
    if retained is None:
        raise lib.Blocked("www.gencourt.state.nh.us redirects to gc.nh.gov, which closed the connection on 2026-10-23; "
                          "re-parse the retained chapter pages (2026-10-06): --option source=retained")
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    ctx.edition(edition_label="New Hampshire Revised Statutes Annotated", currency_statement=None,
                currency_source_url=None)
    urls = [u for u in retained.urls(ROOT) if u.endswith("-mrg.htm")]
    urls.sort(key=lambda u: sb.natural_key(u.rsplit("/", 1)[1][:-8]))
    ctx.log(f"{len(urls)} retained chapter pages")
    ctx.prefetch(urls)  # retained runs: read ahead
    for url in urls:
        if only and url.rsplit("/", 1)[1][:-8] not in only:
            continue
        fetched = ctx.get(url)
        parsed = parse_chapter(fetched.body)
        path = [{"level": "title", "label": "Title", "number": parsed["title"][0], "heading": parsed["title"][1]},
                {"level": "chapter", "label": "Chapter", "number": parsed["chapter"][0],
                 "heading": parsed["chapter"][1]}]
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"RSA {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            ctx.section(code="RSA", number=s["number"], heading=heading, text=s["text"], path=path, source=fetched,
                        history=s["history"], version_index=index_, **status)
            if not ctx.want_more():
                return
