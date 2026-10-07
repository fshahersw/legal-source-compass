"""Parse archived NH RSA merged chapter HTML into staging packet rows."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

from nh_lib import BASE, chapter_key_from_mrg_path  # noqa: E402

SECTION_SPLIT = re.compile(r"<center>\s*<h3>\s*Section\s+([\d]+(?:-[A-Z])?:[\d]+(?:-[a-z])?)\s*</h3>\s*</center>", re.I)
BODY = re.compile(r"<body[^>]*>(.*)</body>", re.S | re.I)
SOURCENOTE = re.compile(r"<sourcenote>(.*?)</sourcenote>", re.S | re.I)
CODESECT = re.compile(r"<codesect>(.*?)</codesect>", re.S | re.I)
BOLD_LINE = re.compile(r"<b>\s*([^<]+?)\s*</b>", re.S | re.I)
REPEALED = re.compile(r"\bRepealed\b", re.I)


def _strip_comments(html):
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


def parse_title_chapter(body_html):
    t = re.search(r"<h1[^>]*>(.*?)</h1>", body_html, re.S | re.I)
    c = re.search(r"<h2[^>]*>(.*?)</h2>", body_html, re.S | re.I)
    title = html_text(t.group(1)) if t else ""
    chapter = html_text(c.group(1)) if c else ""
    tm = re.match(r"TITLE\s+(\S+)\s+(.*)", title, re.I)
    title_num = tm.group(1) if tm else title
    title_heading = tm.group(2).strip() if tm else ""
    cm = re.match(r"Chapter\s+(\S+)\s+(.*)", chapter, re.I)
    ch_num = cm.group(1) if cm else chapter
    ch_heading = cm.group(2).strip() if cm else ""
    return title_num, title_heading, ch_num, ch_heading


def parse_mrg_html(html, source_url, receipt_sha):
    html = _strip_comments(html)
    m = BODY.search(html)
    body = m.group(1) if m else html
    title_num, title_heading, ch_num, ch_heading = parse_title_chapter(body)
    intro_bits = []
    if title_num or title_heading:
        intro_bits.append(collapse(f"{title_num} {title_heading}".strip()))
    if ch_num or ch_heading:
        intro_bits.append(collapse(f"Chapter {ch_num} {ch_heading}".strip()))
    intro = "\n\n".join(intro_bits)

    parts = SECTION_SPLIT.split(body)
    preamble = parts[0]
    sections = []
    i = 1
    while i < len(parts):
        cit = parts[i]
        chunk = parts[i + 1] if i + 1 < len(parts) else ""
        i += 2
        bold = BOLD_LINE.search(chunk)
        printed = collapse(bold.group(1)) if bold else cit
        heading = printed
        if ":" in printed:
            _, _, rest = printed.partition(":")
            rest = rest.strip()
            if rest.endswith("–") or rest.endswith("-") or rest.endswith("\u2013"):
                rest = rest[:-1].strip()
            heading = rest
        codes = CODESECT.search(chunk)
        body_txt = html_text(codes.group(1)) if codes else ""
        sn = SOURCENOTE.search(chunk)
        history = html_text(sn.group(1)) if sn else None
        if history:
            history = collapse(history)
        status = None
        if REPEALED.search(printed) or REPEALED.search(body_txt) or (history and REPEALED.search(history)):
            status = collapse(printed) if REPEALED.search(printed) else "Repealed"
        sec_lines = [f"Section {cit}", printed]
        if body_txt:
            sec_lines.append(body_txt)
        if history:
            sec_lines.append(history)
        sec_text = "\n".join(sec_lines)
        sections.append(
            {
                "citation_path": cit,
                "citation": cit,
                "heading": heading,
                "history": history,
                "status_label": status,
                "text": sec_text,
                "printed_line": printed,
            }
        )

    hierarchy_base = [
        {"level": "title", "number": title_num, "heading": title_heading},
        {"level": "chapter", "number": ch_num, "heading": ch_heading},
    ]

    chapter_text = ""
    sec_rows = []
    for idx, s in enumerate(sections):
        if idx == 0:
            if intro:
                chapter_text = intro + "\n\n" + s["text"]
                start = len(intro) + 2
            else:
                chapter_text = s["text"]
                start = 0
        else:
            start = len(chapter_text) + 2
            chapter_text = chapter_text + "\n\n" + s["text"]
        end = start + len(s["text"])
        sec_rows.append(
            {
                "chapter_native_id": None,
                "citation_path": s["citation_path"],
                "citation": s["citation"],
                "hierarchy": hierarchy_base + [{"level": "section", "number": s["citation_path"], "heading": s["heading"]}],
                "heading": s["heading"],
                "history": s["history"],
                "status_label": s["status_label"],
                "edition": None,
                "currency": {"statement": None, "as_of": None},
                "effective": None,
                "start": start,
                "end": end,
                "source_url": source_url,
                "source_receipt_sha256": receipt_sha,
            }
        )

    return {
        "title_num": title_num,
        "title_heading": title_heading,
        "chapter_num": ch_num,
        "chapter_heading": ch_heading,
        "chapter_text": chapter_text,
        "sections": sec_rows,
        "parsed_section_count": len(sec_rows),
    }


def run_parse(work, state="NH"):
    arc = Archive(work)
    mrg_paths = json.load(open(os.path.join(work, "mrg_paths.json")))
    chapters = []
    sections = []
    parse_errors = []
    for mp in mrg_paths:
        url = BASE + mp
        rec = arc.index.get(url)
        if not rec or rec.get("state") != "complete":
            parse_errors.append({"mrg": mp, "error": "not_archived"})
            continue
        html = decode_html(arc.read(rec))[0]
        try:
            parsed = parse_mrg_html(html, url, rec["sha256"])
        except Exception as e:
            parse_errors.append({"mrg": mp, "error": str(e)[:200]})
            continue
        native_id = chapter_key_from_mrg_path(mp)
        for s in parsed["sections"]:
            s["chapter_native_id"] = native_id
            s["state"] = state
        sections.extend(parsed["sections"])
        chapters.append(
            {
                "native_id": native_id,
                "path": [
                    {"type": "title", "number": parsed["title_num"], "heading": parsed["title_heading"]},
                    {"type": "chapter", "number": parsed["chapter_num"], "heading": parsed["chapter_heading"]},
                ],
                "heading": parsed["chapter_heading"],
                "text": parsed["chapter_text"],
                "raw_sha256s": [rec["sha256"]],
                "source_urls": [url],
            }
        )
    man = write_packet(
        work,
        state,
        source={"system": "nh-rsa-html", "base_url": BASE},
        edition=None,
        chapters=chapters,
        sections=sections,
        extra={"parse_errors": len(parse_errors)},
    )
    json.dump(parse_errors, open(os.path.join(work, "parse_errors.json"), "w"), indent=1)
    return man, parse_errors


if __name__ == "__main__":
    run_parse(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sc4/nh")
