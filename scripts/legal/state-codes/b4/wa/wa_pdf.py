"""Extract RCW sections from official Complete Chapter PDF text."""
import re

from sc_common import collapse

# Body sections begin with "RCW <title.chapter.section>  <heading>.  <text>"
SECTION_START = re.compile(
    r"(?:^|\n)RCW\s+(\d+[A-Z]?(?:\.\d+[A-Z]?){1,2})\s{1,}(.+)$",
    re.M,
)
HISTORY = re.compile(r"\[[^\]]+\]\s*$")


def pdf_to_text(body: bytes) -> str:
    try:
        import pymupdf

        with pymupdf.open(stream=body, filetype="pdf") as document:
            return "".join(page.get_text("text") for page in document)
    except Exception:
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(body)
            f.flush()
            return subprocess.run(
                ["pdftotext", "-layout", f.name, "-"],
                capture_output=True,
                text=True,
                check=True,
                timeout=180,
            ).stdout


def split_sections(pdf_text: str, toc_ids: list[str] | None = None) -> list[dict]:
    """Return sections in document order with citation, heading, and body text as published."""
    matches = list(SECTION_START.finditer(pdf_text))
    if not matches:
        return []
    # Skip index preamble: first body RCW line should match a TOC id when provided
    start_idx = 0
    if toc_ids:
        toc_set = {x.upper() for x in toc_ids}
        for i, m in enumerate(matches):
            if m.group(1).upper() in toc_set:
                start_idx = i
                break
    out = []
    for i, m in enumerate(matches[start_idx:], start=start_idx):
        cite = m.group(1).upper()
        rest = m.group(2).strip()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(pdf_text)
        block = pdf_text[m.start() : end].strip()
        # heading ends at first ".  " after cite line content
        hm = re.match(r"RCW\s+" + re.escape(cite) + r"\s+(.+?)\.\s{2,}(.+)", block, re.S)
        if hm:
            heading = collapse(hm.group(1))
            body = collapse(hm.group(2))
            text = f"RCW {cite} {heading}. {body}"
        else:
            heading = ""
            text = collapse(block)
        hist = None
        hm2 = HISTORY.search(rest)
        if hm2:
            hist = collapse(hm2.group(0))
        out.append(
            {
                "section_id": cite,
                "heading": heading or None,
                "text": text,
                "history": hist,
            }
        )
    return out
