"""New Jersey — New Jersey Statutes, Office of Legislative Services (pub.njleg.gov bulk download).

Source: `https://pub.njleg.gov/statutes/STATUTES-TEXT.zip` ("New Jersey state statutes in plain text and rich text
format", rebuilt every weekday at 2 AM per the directory's `_READ_ME.txt`; robots.txt `Allow: /`). The archive holds
two members: `STATUTES.TXT` (cp1252 plain text, ~84 MB) and `STATUTES.RTF` (~95 MB). The TXT opens with the
publisher's currency line, e.g. `NEW JERSEY GENERAL AND PERMANENT STATUTES` / `(UPDATED THROUGH  P.L.2026, c.50, and
J.R.1)`.

Parsing (`nj-txt-rtf/1`): the RTF marks title headings with paragraph style `\\s2` and section headings with `\\s3`;
each styled heading is bound, in order, to the identical line at the start of a TXT paragraph (a body sentence that
merely quotes a heading can never delimit a section). A section runs from its heading to the next styled heading.
Trailing paragraphs that are the publisher's credit lines (`L.1942, c. 72, ...`, `Amended by L...`, `Source: ...`)
are the history; the rest is text. A leading restatement of the section number in the body (`1:1-2.  Unless ...`)
is dropped from `text` (the number is the section's own designation). Chapters are not printed as headings in the
statutes file, so the hierarchy is the printed TITLE line plus the chapter number taken from the section number.

Sample runs keep, as the section's source, the exact TXT bytes of its title (member `STATUTES.TXT` sliced at the
publisher's title boundaries, sha256 over those unchanged bytes) so the exact-text proof works without keeping the
84 MB member.
"""
from __future__ import annotations

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

ARCHIVE_URL = "https://pub.njleg.gov/statutes/STATUTES-TEXT.zip"
PARSER = "nj-txt-rtf/1"
PARAGRAPH = re.compile(r"\\pard\s+\\s([23])\s+(.*?)(?=\\par[\s}])", re.S)
CITATION = re.compile(r"^(?:C\.)?((?:[0-9][0-9A-Za-z.]*|App\.A):[0-9][0-9A-Za-z.:\-]*?(?:\([0-9A-Za-z]+\))?)(?:[.,]?(?=\s|$))")
TITLE = re.compile(r"^(?:TITLE\s+(\d+[A-Z]?)\b|APPENDIX\s+(A)\b)\s*(.*)$", re.S)
HISTORY = re.compile(r"^(L\.\s?\d{4}|Amended\b|amended \d{4}|Source:|Repealed\b|Supplemented\b|Renumbered\b|"
                     r"Recompiled\b|Deleted\b|Derived from\b)")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="NJ", code_name="New Jersey Statutes", publisher="New Jersey Legislature, Office of Legislative Services",
        publisher_url="https://pub.njleg.gov/statutes/", official_source=True, access="bulk",
        hosts=("pub.njleg.gov",),
        codes=(lib.Code("NJSA", "New Jersey Statutes", "N.J. Stat. Ann. § {n}",
                        patterns=((r"^n\.?j\.?s\.?a\.?\s*(?:§\s*)?([0-9][0-9a-z.]*:[0-9][0-9a-z.:\-]*)$", r"\1"),
                                  (r"^n\.j\. stat\.(?: ann\.)?\s*§\s*([0-9][0-9a-z.]*:[0-9][0-9a-z.:\-]*)$", r"\1"),
                                  (r"^n\.j\.s\.\s*([0-9][0-9a-z.]*:[0-9][0-9a-z.:\-]*)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). OLS publishes the "
                    "statutes as a weekday-rebuilt bulk download; robots.txt allows all paths."),
        update_cadence="Rebuilt every weekday at 2 AM (publisher _READ_ME.txt); re-run weekly or monthly.")


META = _meta()


def decode_heading(fragment: str) -> str:
    """Only the RTF controls observed in OLS heading styles; anything else fails closed."""
    fragment = re.sub(r"\{\\\*\\bkmk(?:start|end) [^}]*\}", "", fragment)
    fragment = fragment.replace("\r", "").replace("\n", "")
    tokens = re.compile(r"\\'([0-9a-fA-F]{2})|\\([A-Za-z]+)(-?\d+)? ?|\\([^A-Za-z])|([{}])")

    def replace(match):
        if match[1]:
            return bytes([int(match[1], 16)]).decode("cp1252", errors="strict")
        if match[2] in {"b", "i", "fs", "cf", "ul", "ulnone", "plain"}:
            return ""
        if match[2] == "tab":
            return "\t"
        if match[2] == "line":
            return "\n"
        if match[4] in {"{", "}", "\\"}:
            return match[4]
        if match[5]:
            return ""
        raise ValueError(f"unsupported RTF heading control {match[0]!r}")

    return tokens.sub(replace, fragment).strip()


def bind_headings(text: str, rtf: str):
    """Styled RTF headings -> positions of the same lines in the TXT, in order."""
    cursor, out = 0, []
    for match in PARAGRAPH.finditer(rtf):
        heading = decode_heading(match[2])
        if not heading:
            continue
        first = heading.split("\n")[0].strip()
        start = text.find(first, cursor)
        while start >= 0 and text[text.rfind("\n", 0, start) + 1:start].strip():
            start = text.find(first, start + 1)
        if start < 0:
            raise ValueError(f"RTF heading not found in TXT after offset {cursor}: {first[:80]!r}")
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", start)
        line_end = len(text) if line_end < 0 else line_end
        cursor = line_end
        kind = "title" if match[1] == "2" else "section"
        out.append({"kind": kind, "start": line_start, "end_head": line_end, "line": text[line_start:line_end].strip()})
    return out


def split_section(head_line: str, body: str):
    m = CITATION.match(head_line)
    if not m:
        return None
    number = m.group(1)
    heading = head_line[m.end():].strip(" .\t") or None
    if heading and head_line.rstrip().endswith("."):
        heading = head_line[m.end():].strip(" \t")
        heading = heading or None
    paras = [p for p in re.split(r"\n[ \t]*\n", body) if p.strip()]
    history = []
    while paras and HISTORY.match(paras[-1].strip()):
        history.insert(0, sb.one_line(paras.pop()))
    lines = sb.ws("\n".join(paras))
    lead = re.match(r"^(?:C\.)?" + re.escape(number) + r"\.?\s+", lines)
    if lead:
        lines = lines[lead.end():]
    return {"number": number, "heading": heading, "text": lines, "history": " ".join(history) or None}


def parse(text: str, rtf: str):
    """Yield ('title', info) and ('section', info) in document order. `text` is the decoded TXT with LF newlines."""
    heads = bind_headings(text, rtf)
    titles = [h for h in heads if h["kind"] == "title"]
    for i, h in enumerate(heads):
        end = heads[i + 1]["start"] if i + 1 < len(heads) else len(text)
        if h["kind"] == "title":
            m = TITLE.match(h["line"])
            if not m:
                raise ValueError(f"unrecognized title heading {h['line'][:60]!r}")
            t_end = next((t["start"] for t in titles if t["start"] > h["start"]), len(text))
            yield "title", {"number": m.group(1) or "App.A", "heading": sb.one_line(m.group(3)) or None,
                            "start": h["start"], "end": t_end}
            continue
        body = text[h["end_head"]:end]
        sec = split_section(h["line"], body)
        if sec is None:
            yield "anomaly", {"line": h["line"], "start": h["start"]}
            continue
        sec["start"] = h["start"]
        yield "section", sec


def acquire(ctx):
    import io as _io

    members = {}
    with ctx.stream(ARCHIVE_URL) as handle:
        for name, body in lib.iter_zip_members(handle, want=lambda n: n.upper() in ("STATUTES.TXT", "STATUTES.RTF")):
            members[name.upper()] = body
    archive_src = dict(ctx.stream_source)
    raw_txt = members.pop("STATUTES.TXT")
    rtf = members.pop("STATUTES.RTF").decode("cp1252", errors="strict")
    # The TXT is cp1252 with CRLF; keep byte offsets by decoding per title slice later.
    text = raw_txt.decode("cp1252", errors="strict").replace("\r\n", "\n")
    header = text[:400].split("\n\n")[0]
    ctx.edition(edition_label=sb.one_line(header.split("\n")[0]) or None, currency_statement=sb.one_line(header),
                currency_source_url=ARCHIVE_URL)
    # map LF offsets back to CRLF byte offsets: cp1252 is one byte per char, CRLF -> LF removed one byte per line
    newline_pos = [m.start() for m in re.finditer("\n", text)]
    import bisect

    def byte_offset(pos: int) -> int:
        return pos + bisect.bisect_left(newline_pos, pos)

    events = list(parse(text, rtf))
    del rtf
    counts: dict[str, int] = {}
    for kind, info in events:
        if kind == "section":
            counts[info["number"]] = counts.get(info["number"], 0) + 1
    seen: dict[str, int] = {}
    title_src = None
    title_path = None
    for kind, info in events:
        if kind == "title":
            a, b = byte_offset(info["start"]), byte_offset(info["end"])
            title_bytes = raw_txt[a:b]
            title_src = ctx.member(archive_src, f"STATUTES.TXT[{a}:{b}] title {info['number']}", title_bytes).source()
            title_path = {"level": "title", "label": "Title", "number": info["number"], "heading": info["heading"]}
            continue
        if kind == "anomaly":
            ctx.log(f"unmapped styled heading kept out of sections: {info['line'][:80]!r}")
            continue
        if title_src is None:
            raise ValueError("section before the first title")
        status = sb.status_kwargs(info["heading"], info["text"])
        if status is None:
            ctx.log(f"heading without text or status marker skipped: {info['number']} {info['heading']!r}")
            continue
        index = None
        if counts[info["number"]] > 1:
            seen[info["number"]] = seen.get(info["number"], 0) + 1
            index = seen[info["number"]]
        chapter = info["number"].split(":", 1)[1].split("-", 1)[0] if ":" in info["number"] else None
        path = [title_path] + ([{"level": "chapter", "label": "Chapter", "number": chapter, "heading": None}]
                               if chapter else [])
        ctx.section(code="NJSA", number=info["number"], heading=info["heading"], text=info["text"], path=path,
                    source=title_src, history=info["history"], version_index=index, **status,
                    version=None)
        if not ctx.want_more():
            return
