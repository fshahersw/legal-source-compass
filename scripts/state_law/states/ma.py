"""Massachusetts — General Court (malegislature.gov) General Laws, via the Legislature's public JSON API.

/api/Parts -> /api/Parts/<P> (chapters) -> /api/Chapters/<C> (sections, IsRepealed) -> /api/Chapters/<C>/Sections/<S>
(Name = catchline, Text = "Section N. …" with \\r\\n paragraph breaks, IsRepealed). robots.txt allows everything.
The site prints: "NOTICE: This is NOT the official version of the General Laws of Massachusetts…" and "This site
includes all amendments to the General Laws passed before <date>…" (kept verbatim as the currency statement).
"""
from __future__ import annotations

import html as _html
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

HOST = "malegislature.gov"
API = f"https://{HOST}/api"
INDEX = f"https://{HOST}/Laws/GeneralLaws"

META = lib.StateMeta(
    state="MA",
    code_name="General Laws of Massachusetts",
    publisher="Massachusetts General Court (malegislature.gov)",
    publisher_url=INDEX,
    official_source=True,
    access="api",
    hosts=(HOST,),
    parser="ma-malegislature-api/1",
    min_interval_s=1.0,
    codes=(lib.Code("MGL", "General Laws", "Mass. Gen. Laws ch. {t}, § {s}", (
        lib.Pattern(r"(?:mass\.?\s?gen\.?\s?laws(?:\s?ann\.?)?|m\.?\s?g\.?\s?l\.?(?:\s?a\.?)?|g\.?\s?l\.?|alm\s?gl)\s?(?:c\.|ch\.|chapter)\s?([0-9]+[a-z]{0,2}),?\s?§\s?([0-9a-z][0-9a-z.\-]*)", r"\1:\2"),
    )),),
    terms_note=("Public JSON API of the General Court; the site states it is not the official version (the official "
                "edition is printed every two years)."),
    update_cadence="Periodically (site states amendments passed before a stated date); re-check monthly.",
)

PREFIX_RE = re.compile(r"^\s*Section\s+([0-9A-Za-z][0-9A-Za-z.\-]*)\.\s*")


def _json(fetched: lib.Fetched):
    return json.loads(fetched.body.decode("utf-8"))


def section_record(ctx: lib.RunContext, part: dict, chapter: dict, ref: dict) -> None:
    url = ref.get("Details") or f"{API}/Chapters/{chapter['Code']}/Sections/{ref['Code']}"
    fetched = ctx.fetch(url, method="publisher_api", headers={"Accept": "application/json"})
    data = _json(fetched)
    raw = (data.get("Text") or "").replace("\r\n", "\n").replace("\r", "\n")
    match = PREFIX_RE.match(raw)
    text = raw[match.end():] if match and match.group(1) == data.get("Code") else raw
    if re.search(r"<[a-zA-Z/][^>]*>", text):  # a few sections carry HTML (tables); render it, keeping line breaks
        text = lib.html_text(text.replace("\n", "<br>"))
    else:
        paragraphs = [lib.norm_ws(_html.unescape(p)) for p in re.split(r"\n\s*\n|\n", text)]
        text = "\n".join(p for p in paragraphs if p)
    status = marker = None
    if data.get("IsRepealed") is True:
        status = "repealed"
        marker = lib.classify_status(data.get("Name"), text)[1] or (data.get("Name") if "repeal" in (data.get("Name") or "").lower() else None)
        if marker is None:
            marker = "IsRepealed: true"
    path = [
        {"level": "part", "label": "Part", "number": part["Code"], "heading": part.get("Name")},
        {"level": "chapter", "label": "Chapter", "number": chapter["Code"], "heading": chapter.get("Name")},
    ]
    ctx.section(code="MGL", number=f"{chapter['Code']}:{data['Code']}", heading=data.get("Name"), text=text,
                source=fetched, path=path, status=status, status_marker=marker,
                status_basis="publisher_marker" if status else None)


SAMPLE = {"III": {"260"}, "I": {"93A"}}


def acquire(ctx: lib.RunContext) -> None:
    index = ctx.fetch(INDEX)
    flat = lib.html_text(index.body)
    notice = re.search(r"NOTICE: This is NOT the official version[^\n]*", flat)
    through = re.search(r"This site includes all amendments to the General Laws passed before[^\n]*", flat)
    ctx.edition(edition_label=None,
                currency_statement="\n".join(m.group(0) for m in (through, notice) if m) or None,
                currency_source_url=INDEX)
    parts = _json(ctx.fetch(f"{API}/Parts", method="publisher_api", headers={"Accept": "application/json"}))
    for part_ref in parts:
        if ctx.sample is not None and part_ref["Code"] not in SAMPLE:
            continue
        if not ctx.want_more():
            break
        part = _json(ctx.fetch(f"{API}/Parts/{part_ref['Code']}", method="publisher_api", headers={"Accept": "application/json"}))
        for chapter_ref in part.get("Chapters", []):
            if ctx.sample is not None and chapter_ref["Code"] not in SAMPLE[part_ref["Code"]]:
                continue
            if not ctx.want_more():
                break
            chapter = _json(ctx.fetch(f"{API}/Chapters/{chapter_ref['Code']}", method="publisher_api",
                                      headers={"Accept": "application/json"}))
            for section in chapter.get("Sections", []):
                if not ctx.want_more():
                    break
                section_record(ctx, part, chapter, section)
