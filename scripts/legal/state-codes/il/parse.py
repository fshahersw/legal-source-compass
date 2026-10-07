#!/usr/bin/env python3
"""Parse Illinois ILCS act pages (ilga.gov Articles / View Entire Act HTML)."""
import re
from html import unescape

CIT_LINE = re.compile(
    r"^\((\d+ ILCS [^)]+)\)(?:\s+\((from [^)]+)\))?(?:\s+\((was [^)]+)\))?$"
)
HEAD_LINE = re.compile(r"^\((\d+ ILCS [^)]+)\s+heading\)\s*(.+)$")
TEXT_VERSION = re.compile(r"^\(Text of Section from (.+)\)$")
SOURCE_LINE = re.compile(r"^\(Source:.+\)\.?$")
SEC_LINE = re.compile(r"^Sec\.\s")
NOTICE_RE = re.compile(
    r"Updating the database of the Illinois Compiled Statutes \(ILCS\) is an ongoing process\.[^<]*",
    re.I,
)
H2_RE = re.compile(
    r"<h2>\s*([^<(]+?)\s*\((\d+ ILCS [^/)]+/)[^)]*\)\s*([^<]+?)\s*</h2>",
    re.I | re.S,
)


def html_to_lines(html: str) -> list[str]:
    m = re.search(r'class="billtext-host"(.*)', html, re.I | re.S)
    chunk = m.group(1) if m else html
    chunk = re.sub(r"<script[^>]*>.*?</script>", "", chunk, flags=re.I | re.S)
    chunk = re.sub(r"<!--.*?-->", "", chunk, flags=re.S)
    chunk = re.sub(r"<br\s*/?>", "\n", chunk, flags=re.I)
    chunk = re.sub(r"</p>", "\n", chunk, flags=re.I)
    text = re.sub(r"<[^>]+>", "", chunk)
    text = unescape(text)
    lines = []
    for ln in text.splitlines():
        ln = re.sub(r"[\t\xa0]+", " ", ln).strip()
        if not ln or ln == "Footer" or ln == ">":
            continue
        lines.append(ln)
    return lines


def currency_statement(html: str) -> str:
    m = NOTICE_RE.search(html)
    if not m:
        return "Updating the database of the Illinois Compiled Statutes (ILCS) is an ongoing process."
    return re.sub(r"\s+", " ", m.group(0)).strip()


def act_meta(html: str, url: str) -> dict:
    h2 = H2_RE.search(html)
    chapter_heading = chapter_number = act_number = act_heading = None
    if h2:
        chapter_heading = re.sub(r"\s+", " ", h2.group(1)).strip()
        act_number = h2.group(2).rstrip("/")
        act_heading = re.sub(r"\s+", " ", h2.group(3)).strip()
    act_id = None
    m = re.search(r"ActID=(\d+)", url)
    if m:
        act_id = m.group(1)
    if act_number:
        chapter_number = act_number.split()[0]
    return {
        "act_id": act_id,
        "chapter": {"number": chapter_number, "heading": chapter_heading},
        "act_number": act_number,
        "act_heading": act_heading,
    }


def path_for(citation: str, occurrence: int) -> str:
    return citation if occurrence == 1 else f"{citation}~{occurrence}"


def _paragraphs(lines: list[str]) -> list[str]:
    if not lines:
        return []
    paras: list[str] = []
    cur = [lines[0]]
    for ln in lines[1:]:
        prev = cur[-1]
        if (
            prev.rstrip().endswith(".")
            and len(prev) > 30
            and (
                (ln[:1].isupper() and not ln.startswith("("))
                or re.match(r"^\([a-z]\)", ln)
            )
        ):
            paras.append(re.sub(r"  +", " ", " ".join(cur)))
            cur = [ln]
        else:
            cur.append(ln)
    paras.append(re.sub(r"  +", " ", " ".join(cur)))
    return paras


def _section_text(prefix: list[str], body: list[str]) -> str:
    paras = _paragraphs(body)
    return "\n".join(prefix + paras)


def _section_context(headings: list[dict]) -> list[dict]:
    part = art = None
    for h in reversed(headings):
        n = h["number"]
        if art is None and n.startswith("Art."):
            art = h
        elif part is None and ("Pt." in n or n.startswith("Tit.")):
            part = h
        if art and part:
            break
    out = []
    if part:
        out.append(part)
    if art:
        out.append(art)
    return out


def parse_act(html: str) -> tuple[list[dict], list[dict]]:
    """Return (context_headings, sections). Each section: citation, text, history, context, status_note."""
    lines = html_to_lines(html)
    headings: list[dict] = []
    sections: list[dict] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        hm = HEAD_LINE.match(ln)
        if hm:
            key = hm.group(1)
            rest = hm.group(2).strip()
            num = re.sub(r"\s+", " ", key.split("/", 1)[-1])
            headings.append({"number": num, "heading": rest})
            i += 1
            continue
        cm = CIT_LINE.match(ln)
        if not cm:
            i += 1
            continue
        citation = cm.group(1).strip()
        if citation.endswith("/"):
            i += 1
            continue
        prefix = []
        if cm.group(3):
            prefix.append(f"({cm.group(3)})")
        i += 1
        while i < len(lines) and TEXT_VERSION.match(lines[i]):
            prefix.append(lines[i])
            i += 1
        if i >= len(lines) or not SEC_LINE.match(lines[i]):
            continue
        body = []
        while i < len(lines):
            if SOURCE_LINE.match(lines[i]):
                history = lines[i]
                i += 1
                break
            if CIT_LINE.match(lines[i]) or HEAD_LINE.match(lines[i]):
                history = None
                break
            body.append(lines[i])
            i += 1
        else:
            history = None
        text = _section_text(prefix, body)
        if not text.strip():
            continue
        sections.append(
            {
                "citation": citation,
                "text": text,
                "history": history,
                "status_note": None,
                "context": _section_context(headings),
            }
        )
    return headings, sections


def page_for_act(receipts: dict, url: str):
    """Match make_packets il(): find receipt and parsed sections for an act URL."""
    rec = receipts.get(url)
    if rec is None:
        return None, []
    html = rec["html"]
    _, sections = parse_act(html)
    docs = [{"kind": "section", **s} for s in sections]
    return rec, docs
