"""Pennsylvania — Pennsylvania Consolidated Statutes, Legislative Data Processing Center (palegis.us).

Source: the consolidated statutes index `https://www.palegis.us/statutes/consolidated` lists the titles; each title is
one HTML document served to the page's iframe at
`https://www.palegis.us/statutes/consolidated/view-statute?50&iFrame=true&txtType=HTM&ttl=<n>` (the URL the
publisher's own page script loads). robots.txt only restricts a UserWay scanner and `/cfdocs/`. Only the Consolidated
Statutes (Pa.C.S.) are a code; unconsolidated acts (P.S.) are session-law acts, not covered here. The publisher prints
no code-wide currency line; each title document carries a `revised` meta stamp, kept on every source record.

Parsing (`pa-title-html/1`): the publisher marks structure with hidden comment divs: `<TT>c<SEC>s` starts a section,
`<TT>c<SEC>v` starts its notes block, `<TT>c<SEC>h` starts a division header block, `<TT>cc` ends the title's table
of contents, `<TT>cax` starts the appendix of supplementary provisions (not code sections; not parsed). Division
blocks print `CHAPTER 55` / `LIMITATION OF TIME` (plus tables of contents and "Enactment." notes, which are skipped).
A section block is `§ 5524.  Two year limitation.` followed by its text lines. From the notes block only the
enactment/amendment parenthetical (`(July 9, 1976, P.L.586, No.142, eff. June 27, 1978)`) is kept as history; cross
references and editor's notes are dropped.
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

INDEX_URL = "https://www.palegis.us/statutes/consolidated"
TITLE_URL = "https://www.palegis.us/statutes/consolidated/view-statute?50&iFrame=true&txtType=HTM&ttl={}"
PARSER = "pa-title-html/1"
BLOCK = re.compile(r'<div class="Comment">([^<]*)</div>|<p\b[^>]*>(.*?)</p>|<table\b.*?</table>', re.S)
ROW = re.compile(r"<tr\b.*?</tr>", re.S)
CELL = re.compile(r"<t[dh]\b.*?</t[dh]>", re.S)
MARKER = re.compile(r"^(\d{2})c([0-9A-Za-z.\-]+?)([svh])$")
DIVISION = re.compile(r"^(TITLE|PART|SUBPART|ARTICLE|SUBARTICLE|CHAPTER|SUBCHAPTER|DIVISION|SUBDIVISION)\s+"
                      r"([0-9]+[A-Z]?(?:\.[0-9]+)?|[IVXLCDM]+[A-Z]?|[A-Z](?:-[0-9]+)?)$")
SECTION = re.compile(r"^§\s?([0-9]+[A-Za-z]?(?:\.[0-9A-Za-z]+)*(?:-[A-Z0-9]+)?)\.(?:\s+(.*))?$")
HISTORY = re.compile(r"^\((?:[A-Z][a-z]{2,4}\.?\s+\d{1,2},\s+\d{4}|\d{4}),?\s+P\.\s?L\.")
REVISED = re.compile(r'<meta name="revised" content="([^"]*)"')
LEVELS = {"TITLE": "title", "PART": "part", "SUBPART": "subpart", "ARTICLE": "article", "SUBARTICLE": "subarticle",
          "CHAPTER": "chapter", "SUBCHAPTER": "subchapter", "DIVISION": "division", "SUBDIVISION": "subdivision"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="PA", code_name="Pennsylvania Consolidated Statutes",
        publisher="Pennsylvania General Assembly, Legislative Data Processing Center", publisher_url=INDEX_URL,
        official_source=True, access="html", hosts=("www.palegis.us",),
        codes=(lib.Code("PACS", "Pennsylvania Consolidated Statutes", "{t} Pa. Cons. Stat. § {s}",
                        patterns=((r"^([0-9]+)\s*pa\.\s?c\.\s?s\.?(?:a\.)?\s*§?\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"),
                                  (r"^([0-9]+)\s*pa\. cons\. stat\.(?: ann\.)?\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt restricts only "
                    "a UserWay scanner and /cfdocs/. Unconsolidated statutes (Purdon's P.S.) are not part of this code."),
        update_cadence="Title documents are regenerated after acts are codified (per-title 'revised' stamp); re-run "
                       "monthly.")


META = _meta()


def _squash(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", " ", fragment)
    return sb.one_line(_html.unescape(re.sub(r"<[^>]+>", "", fragment)))


def tokens(document: str):
    body = document[document.find("<body"):]
    out = []
    for m in BLOCK.finditer(body):
        if m.group(1) is not None:
            out.append(("M", m.group(1).strip()))
        elif m.group(2) is not None:
            out.append(("P", _squash(m.group(2))))
        else:
            for row in ROW.findall(m.group(0)):
                out.append(("P", " ".join(_squash(c) for c in CELL.findall(row)).strip()))
    return out


def parse_title(raw: bytes):
    document = raw.decode("utf-8", errors="replace")
    revised = REVISED.search(document)
    items = tokens(document)
    start = next((i for i, (k, v) in enumerate(items) if k == "M" and v.endswith("cc")), None)
    if start is None:
        raise ValueError("no end-of-contents marker")
    divisions: list[tuple] = []          # stack of (LEVEL, number, heading)
    title_heading = None
    sections = []
    current = None
    mode = None
    i = start + 1
    while i < len(items):
        kind, value = items[i]
        if kind == "M":
            if value.endswith("ax"):
                break                      # appendix: supplementary provisions, not code sections
            m = MARKER.match(value)
            mode = m.group(3) if m else None
            if mode in ("s", "h") and current:
                sections.append(current)
                current = None
            i += 1
            continue
        if mode == "h":
            dm = DIVISION.match(value)
            if dm:
                label, number = dm.group(1), dm.group(2)
                heading_lines = []
                j = i + 1
                while j < len(items) and items[j][0] == "P" and items[j][1] and \
                        not DIVISION.match(items[j][1]) and items[j][1] not in ("Sec.", "Chapter", "Part", "Subchapter"):
                    heading_lines.append(items[j][1])
                    j += 1
                heading = " ".join(heading_lines) or None
                if label == "TITLE":
                    title_heading = heading
                else:
                    depth = [d[0] for d in divisions]
                    if label in depth:
                        divisions = divisions[:depth.index(label)]
                    divisions.append((label, number, heading))
                i = j
                continue
        elif mode == "s":
            sm = SECTION.match(value) if current is None else None
            if sm:
                current = {"number": sm.group(1), "heading": (sm.group(2) or "").strip() or None, "lines": [],
                           "history": [], "path": list(divisions)}
            elif current is not None and value:
                current["lines"].append(value)
        elif mode == "v" and current is not None:
            if value and HISTORY.match(value):
                current["history"].append(value)
        i += 1
    if current:
        sections.append(current)
    return {"revised": revised.group(1) if revised else None, "title_heading": title_heading, "sections": sections}


def list_titles(index_html: str):
    seen, out = set(), []
    for t in re.findall(r"view-statute\?txtType=HTM&(?:amp;)?ttl=(\d+)", index_html):
        n = str(int(t))
        # ttl=0 is the Constitution of Pennsylvania served by the same viewer: not a title of Pa.C.S. (its article
        # sections would collide as "0:1", "0:23"); the constitution is kept in its own dataset
        if n == "0":
            continue
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("titles", "").split(",") if c.strip()]
    index = ctx.get(INDEX_URL)
    ctx.edition(edition_label="Pennsylvania Consolidated Statutes", currency_statement=None,
                currency_source_url=None)
    titles = list_titles(index.text())
    if only:
        titles = [t for t in titles if t in only]
    ctx.log(f"{len(titles)} titles listed")
    for title in titles:
        fetched = ctx.get(TITLE_URL.format(title))
        parsed = parse_title(fetched.body)
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            text = "\n".join(s["lines"])
            status = sb.status_kwargs(s["heading"], text)
            if status is None:
                ctx.log(f"{title} Pa.C.S. § {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            path = [{"level": "title", "label": "Title", "number": title, "heading": parsed["title_heading"]}]
            path += [{"level": LEVELS[label], "label": label.title(), "number": num, "heading": head}
                     for label, num, head in s["path"]]
            source = dict(fetched.source(), page_revised=parsed["revised"])
            ctx.section(code="PACS", number=f"{title}:{s['number']}", heading=heading, text=text, path=path,
                        source=source, history="\n".join(s["history"]) or None, version_index=index_, **status)
            if not ctx.want_more():
                return
