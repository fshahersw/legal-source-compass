"""Parse archived Rhode Island General Laws HTML into a staging packet."""

import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, write_packet  # noqa: E402

H3_CITE = re.compile(r"R\.I\.\s*Gen\.\s*Laws\s*§\s*([0-9A-Z.]+(?:-[0-9A-Z.]+)*)", re.I)
SEC_HEAD = re.compile(
    r"<p[^>]*>\s*<b>\s*§\s*&nbsp;([0-9A-Z.-]+)\.\s*&nbsp;([^<]*)</b>\s*</p>",
    re.S | re.I,
)
HIST = re.compile(r"History of Section\.<br\s*/?>(.*?)</p>", re.S | re.I)
CH_HEAD = re.compile(r"<h2>\s*<center>\s*Chapter\s+([^<]+)<br\s*/?>\s*([^<]+)", re.S | re.I)


def strip_tags(s):
    return collapse(re.sub(r"(?s)<[^>]+>", " ", s))


def extract_history(block):
    m = HIST.search(block)
    if not m:
        return None
    return collapse(html_mod.unescape(re.sub(r"<br\s*/?>", " ", m.group(1))))


def extract_effective(history):
    if not history:
        return None
    m = re.search(r"effective\s+([^.;]+(?:\d{4})?[^.;]*)", history, re.I)
    return m.group(0).strip() if m else None


def status_from_heading(heading, toc_label):
    h = (heading or "").strip().lower()
    if h in ("repealed.", "repealed"):
        return "Repealed"
    if toc_label and "repealed" in toc_label.lower():
        return "Repealed"
    if "reserved" in h:
        return "Reserved"
    return None


def section_body_text(block):
    """Section text as published: § line plus body paragraphs, excluding history."""
    parts = []
    hm = SEC_HEAD.search(block)
    if hm:
        num, head = hm.group(1), strip_tags(hm.group(2))
        parts.append(f"§ {num}. {head}".strip())
    else:
        m3 = H3_CITE.search(block)
        if m3:
            parts.append(f"§ {m3.group(1)}.")
    body = HIST.split(block)[0]
    if hm:
        body = body[hm.end() :]
    for para in re.findall(r"<p[^>]*>(.*?)</p>", body, re.S | re.I):
        if "History of Section" in para:
            continue
        if H3_CITE.search(para) and not SEC_HEAD.search(para):
            continue
        t = html_text(para)
        if not t:
            continue
        if re.match(r"^R\.I\.\s*Gen\.\s*Laws\s*§", t, re.I):
            continue
        if parts and t.strip().startswith("§") and collapse(t).startswith(collapse(parts[0])):
            continue
        if t and (not parts or t != parts[0]):
            parts.append(t)
    return "\n".join(parts).strip()


def parse_section_html(raw, meta):
    page, _ = decode_html(raw)
    history = extract_history(page)
    hm = SEC_HEAD.search(page)
    heading = strip_tags(hm.group(2)) if hm else None
    cite_num = meta.get("citation_number")
    if not cite_num:
        m3 = H3_CITE.search(page)
        cite_num = m3.group(1) if m3 else None
    text = section_body_text(page)
    toc = meta.get("toc_label") or ""
    status = status_from_heading(heading, toc)
    if status == "Repealed" and not text:
        text = f"§ {cite_num}. Repealed." if cite_num else "Repealed."
    return {
        "citation_number": cite_num,
        "heading": heading,
        "text": text,
        "history": history,
        "effective": extract_effective(history),
        "status_label": status,
    }


def citation_path_for(number, occurrence_index):
    if occurrence_index:
        return f"{number}@{occurrence_index}"
    return number


def build_hierarchy(title, chapter, section_number, section_heading):
    return [
        {"level": "title", "number": title["title_key"], "heading": title.get("heading")},
        {
            "level": "chapter",
            "number": chapter.get("chapter_number") or chapter["chapter_key"],
            "heading": chapter.get("heading"),
        },
        {"level": "section", "number": section_number, "heading": section_heading},
    ]


def run(work):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    edition = {
        "statement": "R.I. Gen. Laws",
        "publisher_pages": "No edition date or current-through statement located on captured index or section pages.",
    }
    chapters_out = []
    sections_out = []
    cite_counts = {}
    sep = "\n\n"
    for title in inv["titles"]:
        for chapter in title["chapters"]:
            if chapter.get("fetch_failed"):
                continue
            sec_list = chapter.get("sections") or []
            if not sec_list:
                continue
            native_id = chapter["chapter_key"]
            parts = []
            raw_shas = []
            src_urls = []
            chapter_sections = []
            for sec in sec_list:
                url = sec["section_url"]
                rec = arc.index.get(url)
                if not rec or rec.get("state") != "complete":
                    continue
                raw_shas.append(rec["sha256"])
                src_urls.append(url)
                raw = arc.read(rec)
                file_id = sec["section_href"].replace(".htm", "").replace(".HTM", "")
                parsed = parse_section_html(raw, {"citation_number": file_id, "toc_label": sec.get("toc_label")})
                num = parsed["citation_number"] or file_id
                prev = cite_counts.get(num, 0)
                cite_counts[num] = prev + 1
                if parts:
                    parts.append(sep)
                start = len("".join(parts))
                parts.append(parsed["text"])
                end = len("".join(parts))
                citation_printed = f"§ {num}."
                path = citation_path_for(num, prev)
                chapter_sections.append(
                    {
                        "chapter_native_id": native_id,
                        "state": "RI",
                        "citation_path": path,
                        "citation": citation_printed,
                        "number": num,
                        "heading": parsed["heading"],
                        "hierarchy": build_hierarchy(title, chapter, num, parsed["heading"]),
                        "history": parsed["history"],
                        "status_label": parsed["status_label"],
                        "edition": edition["statement"],
                        "currency": {"statement": None, "as_of": None},
                        "effective": parsed["effective"],
                        "start": start,
                        "end": end,
                        "source_url": url,
                        "source_receipt_sha256": rec["sha256"],
                    }
                )
            if not parts:
                continue
            ch_text = "".join(parts)
            chapters_out.append(
                {
                    "native_id": native_id,
                    "state": "RI",
                    "path": build_hierarchy(title, chapter, None, None)[:-1],
                    "heading": chapter.get("heading"),
                    "text": ch_text,
                    "raw_sha256s": list(dict.fromkeys(raw_shas)),
                    "source_urls": list(dict.fromkeys(src_urls)),
                }
            )
            sections_out.extend(chapter_sections)
    man = write_packet(
        work,
        "RI",
        source={
            "publisher": "Rhode Island General Assembly",
            "base_url": inv["source_root_url"],
            "system": "ri-statutes-web",
        },
        edition=edition,
        chapters=chapters_out,
        sections=sections_out,
        extra={"code_title": "Rhode Island General Laws"},
    )
    return man, chapters_out, sections_out, inv


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ri")
    a = ap.parse_args()
    man, *_ = run(a.work)
    print(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
