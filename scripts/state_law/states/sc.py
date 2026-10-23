"""South Carolina — South Carolina Code of Laws, Legislative Services Agency (scstatehouse.gov).

Source: `https://www.scstatehouse.gov/code/statmast.php` (states "The South Carolina Code on the General Assembly's
website is now current through the 2026 Session of the General Assembly.") lists the titles
(`/code/title<N>.php`); each title page lists its chapters (`/code/t<NN>c<NNN>.php`), one HTML page per chapter.
robots.txt disallows only image/dashboard paths and two named bots.

Parsing (`sc-chapter-html/1`): the chapter body (`div#contentsection`) is a flat run of centered hierarchy lines
(`CHAPTER 3` / `Limitation of Civil Actions`, `ARTICLE 5` / name), bold `SECTION 15-3-530.` spans followed by the
catchline, `<br>`-separated paragraphs, and a `HISTORY:` line that ends each section's text. Notes printed after the
history (Editor's Note, Effect of Amendment, Code Commissioner's Note, Cross References) are not kept.
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

MASTER_URL = "https://www.scstatehouse.gov/code/statmast.php"
BASE = "https://www.scstatehouse.gov"
PARSER = "sc-chapter-html/1"
SECTION_LINE = re.compile(r"^SECTION\s+([0-9][0-9A-Za-z]*(?:-[0-9A-Za-z.]+)+)\.\s*(.*)$", re.S)
HIER = re.compile(r"^(CHAPTER|ARTICLE|SUBARTICLE|PART|SUBPART|SUBCHAPTER|DIVISION|SUBDIVISION)\s+(\S+)$", re.I)
NOTE = re.compile(r"^(Editor's Note|Effect of Amendment|Code Commissioner's Note|Cross[- ]References|"
                  r"Editor's Notes|Code Commissioner's Notes|Effect of Amendments|Library References|Note:)", re.I)
LEVELS = {"chapter": "chapter", "article": "article", "subarticle": "subarticle", "part": "part", "subpart": "subpart",
          "subchapter": "subchapter", "division": "division", "subdivision": "subdivision"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="SC", code_name="Code of Laws of South Carolina, 1976",
        publisher="South Carolina Legislature (Legislative Services Agency)", publisher_url=MASTER_URL,
        official_source=True, access="html", hosts=("www.scstatehouse.gov",),
        codes=(lib.Code("SCC", "Code of Laws of South Carolina", "S.C. Code Ann. § {n}",
                        patterns=((r"^s\.c\. code(?: ann\.)?(?: of laws)?\s*§\s*([0-9][0-9a-z]*-[0-9a-z.\-]+)$", r"\1"),
                                  (r"^s\.c\.c\.?\s*§?\s*([0-9][0-9a-z]*-[0-9a-z.\-]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The site states the "
                    "online Code is unofficial; robots.txt disallows only image and dashboard paths."),
        update_cadence="Updated after each legislative session (statmast.php currency line); re-run each summer "
                       "after the session's acts are codified, and quarterly.")


META = _meta()


def _lines(content: str):
    """[(kind, text)] for the chapter body: 'center', 'bold', 'line'."""
    content = re.sub(r"(?is)<table\b.*?</table>", lambda m: "<br />" + m.group(0).replace("\n", " ") + "<br />", content)
    out = []
    for piece in re.split(r"<br\s*/?>|(?=<div\b)|</div>", content):
        if not piece.strip():
            continue
        center = re.match(r'\s*<div style="(?:font-weight: bold; )?text-align: center;">(.*)$', piece, re.S)
        if center:
            out.append(("center", sb.strip_tags(center.group(1))))
            continue
        bold = re.match(r'\s*<span style="font-weight: bold;">(.*?)</span>(.*)$', piece, re.S)
        if bold:
            out.append(("bold", sb.one_line(sb.strip_tags(bold.group(1))) + " " + sb.one_line(sb.strip_tags(bold.group(2)))))
            continue
        if "<table" in piece:
            out.append(("line", sb.strip_tags(re.sub(r"</t[dh]>", " </td>", piece))))
            continue
        text = sb.strip_tags(piece)
        if text:
            out.append(("line", text))
    return out


def parse_chapter(raw: bytes):
    page = raw.decode("utf-8", errors="replace")
    start = page.find('id="contentsection"')
    if start < 0:
        raise ValueError("no contentsection")
    start = page.find(">", start) + 1
    end = page.find('<div class="mainwidepanel', start)
    end = page.find("<!-- mainwidepanel", start) if end < 0 else end
    content = page[start:end if end > 0 else len(page)]
    lines = _lines(content)
    hier: dict[str, tuple] = {}
    order = ["chapter", "subchapter", "article", "subarticle", "part", "subpart", "division", "subdivision"]
    pending = None
    sections, cur, mode = [], None, None
    for kind, text in lines:
        one = sb.one_line(text)
        if kind == "center":
            m = HIER.match(one)
            if m:
                if cur:
                    sections.append(cur)
                    cur = None
                level = LEVELS[m.group(1).lower()]
                for child in order[order.index(level):]:
                    hier.pop(child, None)
                hier[level] = (m.group(2), None, m.group(1).title())
                pending = level
            elif pending and not cur:
                number, _, label = hier[pending]
                hier[pending] = (number, one, label)
                pending = None
            elif cur is not None and mode == "text":
                cur["lines"].append(text)
            continue
        pending = None
        m = SECTION_LINE.match(one) if kind == "bold" else None
        if m:
            if cur:
                sections.append(cur)
            cur = {"number": m.group(1), "heading": m.group(2).strip() or None, "lines": [], "history": None,
                   "path": [(lvl, hier[lvl][0], hier[lvl][2], hier[lvl][1]) for lvl in order if lvl in hier]}
            mode = "text"
            continue
        if cur is None:
            continue
        if one.startswith("HISTORY:"):
            cur["history"] = one[len("HISTORY:"):].strip() or None
            mode = "notes"
            continue
        if mode == "text":
            if NOTE.match(one):
                mode = "notes"
                continue
            cur["lines"].append(text)
    if cur:
        sections.append(cur)
    for s in sections:
        s["text"] = sb.ws("\n".join(s["lines"]))
    return sections


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]   # e.g. t15c003
    master = ctx.fetch(MASTER_URL)
    page = lib.norm_ws(lib.html_text(master.body))
    m = re.search(r"The South Carolina Code on the General Assembly's website is now current through the \d{4} Session "
                  r"of the General Assembly\.", page)
    ctx.edition(edition_label="Code of Laws of South Carolina, 1976", currency_statement=m.group(0) if m else None,
                currency_source_url=MASTER_URL)
    titles = []
    for t in re.findall(r'href="(/code/title[0-9A-Za-z]+\.php)"', master.text()):
        if t not in titles:
            titles.append(t)
    for title_path in titles:
        if only and not any(o.startswith("t" + title_path.split("title")[1].split(".")[0] + "c") for o in only):
            continue
        tpage = ctx.fetch(BASE + title_path)
        tm = re.search(r"Title\s+(\S+)\s+-\s+([^<]+)<", tpage.text())
        title_no = re.search(r"title([0-9A-Za-z]+)\.php", title_path).group(1)
        title_head = sb.one_line(_html.unescape(tm.group(2))) if tm else None
        chapters = []
        for c in re.findall(r'href="(/code/t[0-9A-Za-z]+c[0-9A-Za-z]+\.php)"', tpage.text()):
            if c not in chapters:
                chapters.append(c)
        for chapter_path in chapters:
            key = chapter_path.rsplit("/", 1)[1][:-4]
            if only and key not in only:
                continue
            fetched = ctx.fetch(BASE + chapter_path)
            sections = parse_chapter(fetched.body)
            counts: dict[str, int] = {}
            for s in sections:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in sections:
                status = sb.status_kwargs(s["heading"], s["text"])
                if status is None:
                    ctx.log(f"S.C. Code § {s['number']}: no text and no marker; skipped")
                    continue
                heading = s["heading"]
                if status["status"] != "in_force" and status["status_marker"] == heading:
                    heading = None
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                path = [{"level": "title", "label": "Title", "number": title_no, "heading": title_head}]
                path += [{"level": lvl, "label": label, "number": num, "heading": head}
                         for lvl, num, label, head in s["path"]]
                ctx.section(code="SCC", number=s["number"], heading=heading, text=s["text"], path=path,
                            source=fetched, history=s["history"], version_index=index_, **status)
                if not ctx.want_more():
                    return
