"""New Mexico — New Mexico Statutes Annotated 1978, New Mexico Compilation Commission (nmonesource.com).

Source: NMOneSource, the Compilation Commission's official site: the chapter list
`https://nmonesource.com/nmos/nmsa/en/nav_date.do?iframe=true&page=<n>` (25 chapters per page, "Chapter 37 -
Limitation of Actions; Abatement and Revivor", item id) and one PDF per chapter at
`https://nmonesource.com/nmos/nmsa/en/<id>/1/document.do`. The page prints "Website last modified: <date>". robots.txt
disallows only two named items. The chapter PDFs are the annotated compilation; only statute text, catchlines and
"History:" lines are kept — the ANNOTATIONS blocks (compiler's notes, cross references, case notes) are not.

Parsing (`nm-chapter-pdf/1`): `pdftotext -layout`; `ARTICLE n` + name lines are hierarchy; a section starts at a
line at the left margin `37-1-8. Actions against sureties; injuries to person or reputation.` whose number belongs to
the chapter (inside an ANNOTATIONS block only after a blank line); indented lines start text paragraphs, unindented
lines continue them; `History:` starts the history (to the next blank line); `ANNOTATIONS` ends the section's text.
A catchline that is only a marker ("Recompiled.", "Repealed.") is a status entry (Recompiled -> renumbered).

nmonesource.com answered HTTP 403 on 2026-10-23 after a few requests (recorded, not retried). The project's retained
chapter PDFs (captured 2026-10-06: 81 unannotated `nmsa-unanno` + 84 annotated) are re-parsed with
`--option source=retained`; chapter number and name then come from each PDF's own "CHAPTER n" header.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://nmonesource.com"
NAV = SITE + "/nmos/nmsa/en/nav_date.do?iframe=true"
PARSER = "nm-chapter-pdf/1"
HEAD = re.compile(r"^(\d+[A-Z]?-\d+[A-Z]?-\d+(?:\.\d+)*[A-Z]?)\.\s+(\S.*)$")
ARTICLE = re.compile(r"^(ARTICLE|PART)\s+(\d+[A-Z]?(?:\.\d+)?)$")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NM", code_name="New Mexico Statutes Annotated 1978 (statute text)",
        publisher="New Mexico Compilation Commission (NMOneSource)", publisher_url=SITE + "/nmos/nmsa/en/nav_date.do",
        official_source=True, access="pdf", hosts=("nmonesource.com",),
        codes=(lib.Code("NMSA", "New Mexico Statutes Annotated 1978", "N.M. Stat. Ann. § {n}",
                        patterns=((r"^n\.m\. stat\.(?: ann\.)?\s*§\s*([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9.]+[a-z]?)(?:\s*\(\d{4}\))?$", r"\1"),
                                  (r"^(?:§\s*)?([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9.]+[a-z]?),?\s*nmsa(?:\s*1978)?$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020); the Commission's "
                    "annotations are not kept. robots.txt disallows only two named items."),
        update_cadence="Chapter PDFs are republished after each session's compilation ('Website last modified'); "
                       "re-run each summer and quarterly.")


META = _meta()


def pdf_lines(body: bytes) -> list[str]:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(body)
        handle.flush()
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", handle.name, "-"], capture_output=True,
                             check=True, timeout=300).stdout
    return out.decode("utf-8", errors="replace").replace("\f", "\n").split("\n")


def parse_chapter(lines: list[str], chapter: str):
    sections, cur, mode = [], None, None
    article = None
    pending_article = None
    blank_before = True
    para: list[str] = []

    def end_para():
        if cur is not None and para:
            target = cur["history"] if mode == "history" else cur["lines"]
            target.append(" ".join(para))
        para.clear()

    for raw in lines:
        line = sb.one_line(raw)
        if not line:
            end_para()
            if mode == "history":
                mode = "after"
            blank_before = True
            continue
        indented = raw.startswith(" ")
        am = ARTICLE.match(line) if not indented else None
        if am and mode not in ("text", "heading"):
            end_para()
            pending_article = (am.group(1).title(), am.group(2))
            blank_before = True
            continue
        if pending_article and not indented and not HEAD.match(line):
            article = (pending_article[0], pending_article[1], line)   # the line after "ARTICLE n" is its name
            pending_article = None
            blank_before = True                                         # an article heading ends annotations
            continue
        pending_article = None
        hm = HEAD.match(line) if not indented else None
        if hm and hm.group(1).split("-")[0] == chapter and (mode != "annotations" or blank_before):
            end_para()
            if cur:
                sections.append(cur)
            heading = hm.group(2).strip()
            cur = {"number": hm.group(1), "heading": heading, "lines": [], "history": [], "article": article}
            mode = "heading"
            blank_before = False
            continue
        blank_before = False
        if cur is None:
            continue
        if mode == "heading":
            if not indented and not line.startswith("History:") and line != "ANNOTATIONS":
                cur["heading"] = cur["heading"] + " " + line      # catchline wrapped onto the next line
                continue
            mode = "text"
        if line == "ANNOTATIONS":
            end_para()
            mode = "annotations"
            continue
        if mode in ("annotations", "after"):
            if mode == "after" and line.startswith("History:"):
                mode = "history"
            else:
                continue
        if line.startswith("History:"):
            end_para()
            mode = "history"
            para.append(line[len("History:"):].strip())
            continue
        if mode == "text" and indented and para:
            end_para()
        para.append(line)
    end_para()
    if cur:
        sections.append(cur)
    for s in sections:
        s["text"] = "\n".join(s["lines"])
        s["history"] = " ".join(s["history"]) or None
    return sections


def list_items(nav_html: str):
    import html as _html

    out = []
    for item, label in re.findall(r'href="/nmos/nmsa/en/item/(\d+)/index\.do"[^>]*>(.*?)</a>', nav_html, re.S):
        text = sb.one_line(_html.unescape(re.sub(r"<[^>]+>", " ", label)))
        m = re.match(r"^Chapter\s+(\d+[A-Z]?)\s+-\s+(.*)$", text)
        if m and item not in [o[0] for o in out]:
            out.append((item, m.group(1), m.group(2)))
    return out


CHAPTER_HEAD = re.compile(r"^CHAPTER\s+(\d+[A-Z]?)$")


def chapter_header(lines: list[str]):
    """(chapter number, chapter name) from the PDF's own centred header: "CHAPTER 46B" then the name line(s)."""
    for i, raw in enumerate(lines[:12]):
        m = CHAPTER_HEAD.match(sb.one_line(raw))
        if m:
            name = []
            for nxt in lines[i + 1:i + 4]:
                t = sb.one_line(nxt)
                if not t or not nxt.startswith(" ") or ARTICLE.match(t):
                    break
                name.append(t)
            return m.group(1), " ".join(name) or None
    return None, None


def _emit(ctx, fetched, sections, chapter, name):
    counts: dict[str, int] = {}
    for s in sections:
        counts[s["number"]] = counts.get(s["number"], 0) + 1
    seen: dict[str, int] = {}
    for s in sections:
        status = sb.status_kwargs(s["heading"], s["text"])
        if status is None:
            ctx.log(f"NMSA {s['number']}: no text and no marker; skipped")
            continue
        heading = s["heading"]
        if status["status"] != "in_force" and status["status_marker"] == heading:
            heading = None
        index_ = None
        if counts[s["number"]] > 1:
            seen[s["number"]] = seen.get(s["number"], 0) + 1
            index_ = seen[s["number"]]
        path = [{"level": "chapter", "label": "Chapter", "number": chapter, "heading": name}]
        if s["article"]:
            label, num, head = s["article"]
            path.append({"level": label.lower(), "label": label, "number": num, "heading": head})
        ctx.section(code="NMSA", number=s["number"], heading=heading, text=s["text"], path=path, source=fetched,
                    history=s["history"], version_index=index_, **status)
        if not ctx.want_more():
            return False
    return True


def _acquire_retained(ctx, only):
    """Re-parse the retained chapter PDFs (captured 2026-10-06; nmonesource.com answered 403 on 2026-10-23). The
    unannotated compilation (`nmsa-unanno`) is preferred; an annotated chapter PDF is used only for a chapter that has
    no unannotated capture (its ANNOTATIONS blocks are dropped as in the live path). No currency line was retained,
    so the edition states none."""
    ctx.edition(edition_label="New Mexico Statutes Annotated 1978", currency_statement=None, currency_source_url=None)
    done: set[str] = set()
    for collection in ("nmsa-unanno", "nmsa"):
        urls = [u for u in ctx.retained.urls(f"{SITE}/nmos/{collection}/en/") if u.endswith("/1/document.do")]
        ctx.log(f"{len(urls)} retained {collection} chapter PDFs")
        for url in urls:
            fetched = ctx.get(url, method="publisher_bulk")
            lines = pdf_lines(fetched.body)
            chapter, name = chapter_header(lines)
            if chapter is None:
                ctx.log(f"{url}: no CHAPTER header printed; skipped")
                continue
            if chapter in done or (only and chapter not in only):
                continue
            done.add(chapter)
            if not _emit(ctx, fetched, parse_chapter(lines, chapter), chapter, name):
                return


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    if getattr(ctx, "retained", None) is not None:
        return _acquire_retained(ctx, only)
    first = ctx.get(NAV)
    page = lib.norm_ws(lib.html_text(first.body))
    m = re.search(r"Website last modified: \d{1,2}/\d{1,2}/\d{4}", page)
    ctx.edition(edition_label="New Mexico Statutes Annotated 1978", currency_statement=m.group(0) if m else None,
                currency_source_url=NAV if m else None)
    items = list_items(first.text())
    pages = sorted({int(p) for p in re.findall(r"nav_date\.do\?page=(\d+)", first.text())})
    for p in pages:
        if only and all(c in [i[1] for i in items] for c in only):
            break
        items.extend(i for i in list_items(ctx.get(f"{SITE}/nmos/nmsa/en/nav_date.do?page={p}&iframe=true").text())
                     if i[0] not in [x[0] for x in items])
    if only:
        items = [i for i in items if i[1] in only]
    ctx.log(f"{len(items)} chapters listed")
    for item, chapter, name in items:
        fetched = ctx.get(f"{SITE}/nmos/nmsa/en/{item}/1/document.do", method="publisher_bulk")
        if not _emit(ctx, fetched, parse_chapter(pdf_lines(fetched.body), chapter), chapter, name):
            return
