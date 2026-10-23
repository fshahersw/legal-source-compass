"""Connecticut — Legislative Commissioners' Office, General Statutes of Connecticut (cga.ct.gov), state-law/1.

The current text is the publisher's revision (/current/pub/: "Revised to January 1, 2025") read together with its
Supplement (/<year>/sup/: "2026 Supplement … intended to be used in conjunction with the General Statutes …"): a
section printed in the supplement replaces the revision's text (the supplement holds the versions amended, added or
repealed since the revision). Pages: titles.htm -> title_NN.htm -> chap_NNN.htm. A chapter page prints each section
as <p><span class="catchln" id="sec_52-577">Sec. 52-577. Catchline.</span> text</p>, further <p> paragraphs, then
`source` paragraphs (kept as history) and `history`, `cross-ref`, `annotation` paragraphs (editorial; dropped).
"Secs. x to y." range entries (reserved/repealed ranges) are not single sections and are ledgered, not emitted.
The host omits its intermediate certificate (completed from scripts/state_law/certs/; verification stays on).
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "www.cga.ct.gov"
PUB = f"https://{HOST}/current/pub/"
SUP_YEAR = "2026"
SUP = f"https://{HOST}/{SUP_YEAR}/sup/"

META = lib.StateMeta(
    state="CT",
    code_name="General Statutes of Connecticut",
    publisher="Connecticut General Assembly — Legislative Commissioners' Office (cga.ct.gov)",
    publisher_url=PUB + "titles.htm",
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="ct-cga-chapters/1",
    min_interval_s=1.0,
    codes=(lib.Code("CGS", "General Statutes of Connecticut", "Conn. Gen. Stat. § {n}",
                    lib.alias_patterns(["Conn. Gen. Stat.", "Conn. Gen. Stat. Ann.", "C.G.S.", "CGS", "General Statutes",
                                        "Gen. Stat."])),),
    terms_note=("General Statutes published by the Legislative Commissioners' Office: a biennial revision plus the "
                "annual supplement; both statements are quoted. Annotations, cross references and history notes are not kept."),
    update_cadence="Supplement each January (new revision in odd years); re-check each January and after special sessions.",
)

CATCH_RE = re.compile(r"^Sec\.\s+([0-9A-Za-z][0-9A-Za-z.\-]*?)\.\s*(.*)$")
DROP = ("history", "cross-ref", "annotation", "front-note", "nav", "toc", "chap", "part")


def chapter_sections(page: lib.Fetched) -> list[dict]:
    root = lxml_html.document_fromstring(page.body)
    out: list[dict] = []
    current = None
    for p in root.iter("p"):
        cls = (p.get("class") or "").strip()
        span = next((s for s in p.iter("span") if "catchln" in (s.get("class") or "")), None)
        if span is not None:
            label = lib.norm_ws(span.text_content())
            m = CATCH_RE.match(label)
            if not m:
                out.append({"range": label})
                current = None
                continue
            span_text = lib.norm_ws(span.text_content())
            whole = lib.html_text(lxml_html.tostring(p, encoding="unicode"))
            first = lib.norm_ws(whole[len(span_text):]) if whole.startswith(span_text) else whole
            current = {"number": m.group(1), "heading": m.group(2) or None, "paras": [first] if first else [],
                       "history": []}
            out.append(current)
            continue
        if current is None:
            continue
        text = lib.html_text(lxml_html.tostring(p, encoding="unicode"))
        if not text:
            continue
        if cls.startswith("source"):
            current["history"].append(text)
        elif cls == "" or cls.startswith("text"):
            if current["history"]:
                continue  # body never resumes after the source note
            current["paras"].append(text)
        elif any(cls.startswith(d) for d in DROP):
            continue
    return out


def title_heading(flat: str) -> tuple[str | None, str | None]:
    m = re.search(r"TITLE\s+([0-9A-Za-z]+)\*?\s*\n([^\n]+)", flat)
    return (m.group(1), lib.norm_ws(m.group(2))) if m else (None, None)


def chapter_heading(flat: str) -> tuple[str | None, str | None]:
    m = re.search(r"CHAPTER\s+([0-9A-Za-z]+)\*?\s*\n([^\n]+)", flat)
    return (m.group(1), lib.norm_ws(m.group(2))) if m else (None, None)


def acquire(ctx: lib.RunContext) -> None:
    titles_page = ctx.get(PUB + "titles.htm", fallback_fresh=True)
    flat = lib.html_text(titles_page.body)
    base_stmt = re.search(r"Revised to [A-Z][a-z]+ \d{1,2}, \d{4}", flat)
    sup_page = ctx.get(SUP + "titles.htm", fallback_fresh=True)
    sup_flat = lib.html_text(sup_page.body)
    sup_stmt = re.search(r"Note: This \d{4} Supplement is intended to be used in conjunction with[^\n]*", sup_flat)
    def masthead(text: str) -> str | None:
        """The publisher's own title block, verbatim, up to "(Prepared under the direction …)"."""
        head = text.split("(Prepared under", 1)[0] if "(Prepared under" in text else ""
        return lib.norm_ws(head) or None

    statement = "\n".join(x for x in (masthead(flat), masthead(sup_flat), sup_stmt.group(0) if sup_stmt else None) if x)
    ctx.edition(edition_label=f"Revision of {base_stmt.group(0)[11:]} with the {SUP_YEAR} Supplement" if base_stmt else None,
                currency_statement=statement or None, currency_source_url=PUB + "titles.htm")
    sup_chapters = set(re.findall(r'href="(chap_[0-9a-z]+\.htm)"', " ".join(
        ctx.get(SUP + t, fallback_fresh=True).text() for t in dict.fromkeys(re.findall(r'href="(title_[0-9a-z]+\.htm)"', sup_page.text()))
    ))) if ctx.sample is None else {"chap_926.htm"}
    titles = list(dict.fromkeys(re.findall(r'href="(title_[0-9a-z]+\.htm)"', titles_page.text())))
    if ctx.sample is not None:
        titles = ["title_52.htm"]
    for title_file in titles:
        if not ctx.want_more():
            break
        tpage = ctx.get(PUB + title_file, fallback_fresh=True)
        t_no, t_head = title_heading(lib.html_text(tpage.body))
        chapters = list(dict.fromkeys(re.findall(r'href="(chap_[0-9a-z]+\.htm)"', tpage.text())))
        if ctx.sample is not None:
            chapters = ["chap_926.htm"]
        for chap_file in chapters:
            if not ctx.want_more():
                break
            cpage = ctx.get(PUB + chap_file, fallback_fresh=True)
            c_no, c_head = chapter_heading(lib.html_text(cpage.body))
            path = [{"level": "title", "label": "Title", "number": t_no or title_file[6:-4].lstrip("0"), "heading": t_head},
                    {"level": "chapter", "label": "Chapter", "number": c_no or chap_file[5:-4], "heading": c_head}]
            replaced: dict[str, tuple[dict, lib.Fetched]] = {}
            if chap_file in sup_chapters:
                spage = ctx.get(SUP + chap_file, fallback_fresh=True)
                for item in chapter_sections(spage):
                    if "number" in item:
                        replaced[item["number"]] = (item, spage)
            for item in chapter_sections(cpage):
                if not ctx.want_more():
                    break
                if "range" in item:
                    ctx._rejects.write({"state": "CT", "code": "CGS", "number": None, "reason": f"range entry: {item['range'][:200]}",
                                        "source_url": cpage.url, "source_sha256": cpage.sha256})
                    continue
                use, page = replaced.pop(item["number"], (item, cpage))
                ctx.section(code="CGS", number=use["number"], heading=use["heading"], text="\n".join(use["paras"]),
                            history="\n".join(use["history"]) or None, source=page, path=path)
            for number, (use, page) in replaced.items():  # sections added by the supplement
                if not ctx.want_more():
                    break
                ctx.section(code="CGS", number=number, heading=use["heading"], text="\n".join(use["paras"]),
                            history="\n".join(use["history"]) or None, source=page, path=path)
