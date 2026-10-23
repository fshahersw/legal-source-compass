"""North Dakota — North Dakota Century Code, Legislative Council (ndlegis.gov).

Source: the Century Code contents page
`https://ndlegis.gov/general-information/north-dakota-century-code/index.html` (~9.5 MB: every title, chapter and
section, each section linked to its chapter PDF `https://ndlegis.gov/cencode/t<title>c<chapter>.pdf#nameddest=...`)
and the chapter PDFs themselves. robots.txt allows /cencode/ and the contents page. The publisher prints no
code-wide currency line; each chapter PDF's own CreationDate (pdfinfo) is kept on its source record as
`pdf_created`.

Parsing (`nd-chapter-pdf/1`) reuses the reviewed parser `scripts/enrichment/state_statutes/parse_nd.py`
(state_code_nd build, 2026-10-19: 29,116 rows, 0 verification failures): `pdftotext -layout` lines, footers dropped;
each section starts at "<number>. <catchline>." in contents order and must match the contents name word for word.
Text keeps the PDF's printed lines. A heading that is a status ("Repealed by S.L. 2019, ch. 123, § 4.") with no
text is a status entry. The Century Code PDFs print no per-section history lines.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "enrichment" / "state_statutes"))
import _statb as sb  # noqa: E402
import parse_nd  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

INDEX = "https://ndlegis.gov/general-information/north-dakota-century-code/index.html"
SITE = "https://ndlegis.gov"
PARSER = "nd-chapter-pdf/1"
SCRATCH = Path(__file__).resolve().parents[3] / "private" / "acq" / "w1025_stat-b" / "tmp"


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="ND", code_name="North Dakota Century Code", publisher="North Dakota Legislative Branch (Legislative Council)",
        publisher_url=INDEX, official_source=True, access="pdf", hosts=("ndlegis.gov",),
        codes=(lib.Code("NDCC", "North Dakota Century Code", "N.D. Cent. Code § {n}",
                        patterns=((r"^n\.?d\.?c\.?c\.?\s*(?:§\s*)?([0-9]+(?:\.[0-9]+)?-[0-9]+(?:\.[0-9]+)?-[0-9.]+)$", r"\1"),
                                  (r"^n\.d\. cent\. code\s*§\s*([0-9]+(?:\.[0-9]+)?-[0-9]+(?:\.[0-9]+)?-[0-9.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt allows /cencode/ "
                    "and the contents page."),
        update_cadence="Chapter PDFs are regenerated after each session's acts take effect (PDF CreationDate per "
                       "chapter); re-run each August and after special sessions.")


META = _meta()


def pdf_lines_raw(pdf_bytes: bytes):
    """parse_nd.pdf_lines without its hyphen substitution: (lines, pdf CreationDate)."""
    import os
    import subprocess
    import tempfile

    SCRATCH.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".pdf", dir=SCRATCH, delete=False) as handle:
        handle.write(pdf_bytes)
        path = handle.name
    try:
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], check=True, capture_output=True,
                             timeout=120).stdout
        info = subprocess.run(["pdfinfo", "-isodates", path], check=True, capture_output=True,
                              timeout=60).stdout.decode("utf-8", "replace")
    finally:
        os.unlink(path)
    m = re.search(r"^CreationDate:\s+(\d{4}-\d{2}-\d{2})", info, re.M)
    lines = []
    for raw in out.decode("utf-8").replace("\f", "\n").split("\n"):
        line = parse_nd.WS.sub(" ", raw).strip()
        if line and not parse_nd.FOOTER.match(line):
            lines.append(line)
    return lines, (m.group(1) if m else None)


def restore(value: str | None, raw_text: str) -> str | None:
    """The publisher's own characters for a string parse_nd normalised (U+2011 non-breaking hyphen -> '-')."""
    if not value or "-" not in value:
        return value
    pattern = "".join("[-\u2011]" if ch == "-" else ("\\s+" if ch == " " else re.escape(ch)) for ch in value)
    m = re.search(pattern, raw_text)
    return m.group(0) if m else value


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    index = ctx.get(INDEX)
    ctx.edition(edition_label="North Dakota Century Code", currency_statement=None, currency_source_url=None)
    titles = parse_nd.parse_index(index.text())
    del index
    SCRATCH.mkdir(parents=True, exist_ok=True)
    ctx.log(f"{len(titles)} titles in the contents page")
    for title in titles:
        title_step = {"level": "title", "label": "Title", "number": title["number"], "heading": title["caption"]}
        for chapter in title["chapters"]:
            if only and chapter["number"] not in only:
                continue
            if not chapter["pdf"] or not chapter["sections"]:
                continue
            fetched = ctx.get(SITE + chapter["pdf"])
            raw_lines, created = pdf_lines_raw(fetched.body)
            lines = [line.replace("\u2011", "-") for line in raw_lines]   # parse_nd matches numbers on ASCII hyphens
            where = {id(line): i for i, line in enumerate(lines)}
            raw_text = " ".join(raw_lines)
            sections, errors = parse_nd.split_sections(lines, chapter["sections"])
            for err in errors:
                ctx.log(f"chapter {chapter['number']}: {err}")
            path = [title_step, {"level": "chapter", "label": "Chapter", "number": chapter["number"],
                                 "heading": chapter["caption"]}]
            counts: dict[str, int] = {}
            for s in sections.values():
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for key, s in sections.items():
                # back to the publisher's characters (non-breaking hyphens) for stored text and heading
                text = "\n".join(raw_lines[where[id(line)]] if id(line) in where else line for line in s["lines"])
                s["heading"] = restore(s["heading"], raw_text)
                status = sb.status_kwargs(s["heading"], text)
                if status is None:
                    ctx.log(f"N.D.C.C. {s['number']}: no text and no marker; skipped")
                    continue
                heading = s["heading"]
                if status["status"] != "in_force" and status["status_marker"] == heading:
                    heading = None
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                number = s["number"]   # contents number; a misprinted PDF number stays in the PDF only
                ctx.section(code="NDCC", number=number, heading=heading, text=text, path=path,
                            source=dict(fetched.source(), pdf_created=created,
                                        display_url=f"{SITE}{chapter['pdf']}#nameddest={s['number'].replace('.', 'p')}"),
                            version_index=index_, **status)
                if not ctx.want_more():
                    return
