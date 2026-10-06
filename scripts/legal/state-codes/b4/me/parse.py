"""Parse archived Maine Revised Statutes HTML into staging packet rows."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

STATE = "ME"
EDITION = "Maine Revised Statutes"

HEADING_RE = re.compile(r'<h3\s+class="heading_section">\s*(.*?)</h3>', re.S | re.I)
SECTION_BLOCK_RE = re.compile(
    r'<div class="col-sm-12 MRSSection[^"]*">(.*?)</div>\s*</div>\s*</div>',
    re.S | re.I,
)
QHISTORY_RE = re.compile(r'<div class="qhistory">(.*?)</div>', re.S | re.I)
BHISTORY_RE = re.compile(r'<span class="bhistory">(.*?)</span>', re.S | re.I)
DOCINFO_RE = re.compile(r'<div class="docinfo[^"]*">\s*(.*?)\s*</div>', re.S | re.I)
TITLE_TOC_RE = re.compile(r'<div class="MRSTitle toc">(.*?)</div>', re.S | re.I)
CHAPTER_TOC_RE = re.compile(r'<div class="MRSChapter toc">(.*?)</div>', re.S | re.I)
STATUS_CLASS_RE = re.compile(r'MRSSection\s+status_(\w+)', re.I)
SEC_NUM_RE = re.compile(r"§\s*([0-9]+(?:-[A-Z0-9]+)?)\s*\.?\s*(.*)", re.S)


def parse_title_chapter_from_page(page):
    title_h = TITLE_TOC_RE.search(page)
    ch_h = CHAPTER_TOC_RE.search(page)
    return (
        collapse(html_text(title_h.group(1))) if title_h else None,
        collapse(html_text(ch_h.group(1))) if ch_h else None,
    )


def parse_section_page(page, url):
    """Return dict with heading, number, body, history, status_label, effective_bits or None if not a section."""
    block_m = SECTION_BLOCK_RE.search(page)
    if not block_m:
        return None
    block = block_m.group(0)
    status_m = STATUS_CLASS_RE.search(block)
    status_label = status_m.group(1) if status_m else None
    if status_label == "current":
        status_label = None
    hm = HEADING_RE.search(block)
    if not hm:
        return None
    heading_line = collapse(html_text(hm.group(1)))
    num_m = SEC_NUM_RE.match(heading_line.replace("\u00a0", " "))
    if not num_m:
        return None
    number = num_m.group(1)
    heading = collapse(num_m.group(2)) or None
    body_html = block
    body_html = HEADING_RE.sub("", body_html, count=1)
    body_html = QHISTORY_RE.sub("", body_html)
    body_html = re.sub(r'<span class="bhistory">.*?</span>', "", body_html, flags=re.S | re.I)
    body_parts = []
    for m in re.finditer(r'<div class="mrs-text[^"]*">(.*?)</div>', body_html, re.S | re.I):
        body_parts.append(collapse(html_text(m.group(1))))
    body = "\n".join(p for p in body_parts if p)
    inline_hist = [collapse(html_text(m.group(1))) for m in BHISTORY_RE.finditer(block)]
    qh = QHISTORY_RE.search(block)
    history = None
    if qh:
        history = collapse(html_text(qh.group(1)))
    elif inline_hist:
        history = " ".join(inline_hist)
    docinfo = None
    dm = DOCINFO_RE.search(page)
    if dm:
        docinfo = collapse(html_text(dm.group(1)))
    return {
        "number": number,
        "heading": heading,
        "heading_line": heading_line,
        "body": body,
        "history": history,
        "status_label": status_label,
        "docinfo": docinfo,
        "url": url,
    }


def title_chapter_numbers(heading):
    if not heading:
        return None, None
    m = re.match(r"Title\s+([^:]+):\s*(.*)", heading, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, heading


def chapter_numbers(heading):
    if not heading:
        return None, None
    m = re.match(r"Chapter\s+([^:]+):\s*(.*)", heading, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    m2 = re.match(r"Title\s+\d+[^,]*,\s*Chapter\s+([^:]+):\s*(.*)", heading, re.I)
    if m2:
        return m2.group(1).strip(), m2.group(2).strip()
    return None, heading


def part_numbers(heading):
    if not heading:
        return None, None
    m = re.match(r"Part\s+([^:]+):\s*(.*)", heading, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, heading


def build_hierarchy(ch_meta, parsed):
    hier = []
    tnum, thead = title_chapter_numbers(ch_meta.get("title_heading") or parsed.get("title_heading"))
    if tnum:
        hier.append({"level": "title", "number": tnum, "heading": thead})
    pnum, phead = part_numbers(ch_meta.get("part_heading"))
    if pnum:
        hier.append({"level": "part", "number": pnum, "heading": phead})
    cnum, chead = chapter_numbers(ch_meta.get("chapter_heading"))
    if cnum:
        hier.append({"level": "chapter", "number": cnum, "heading": chead})
    hier.append({"level": "section", "number": parsed["number"], "heading": parsed["heading"]})
    return hier


def citation_path(hier, occurrence):
    parts = []
    for h in hier:
        if h["level"] == "title":
            parts.append(f"Title {h['number']}")
        elif h["level"] == "part":
            parts.append(f"Part {h['number']}")
        elif h["level"] == "chapter":
            parts.append(f"Chapter {h['number']}")
        elif h["level"] == "section":
            parts.append(f"§{h['number']}")
    base = "/".join(parts)
    return base if occurrence == 1 else f"{base}#{occurrence}"


def parse_currency(currency_blocks):
    statement = currency_blocks[0] if currency_blocks else None
    as_of = None
    if statement:
        m = re.search(r"current through\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})", statement, re.I)
        if m:
            import datetime

            try:
                as_of = datetime.datetime.strptime(m.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
            except ValueError:
                pass
    return {"statement": statement, "as_of": as_of}


def stage(work):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    currency = parse_currency(inv.get("currency_blocks") or [])
    chapters_out = []
    sections_out = []
    mismatches = []
    missing_body = []

    for ch in inv["chapters"]:
        sec_list = ch.get("sections") or []
        if not sec_list:
            mismatches.append({"chapter": ch["chapter_url"], "reason": "no sections in inventory"})
            continue
        parsed_secs = []
        raw_shas = []
        source_urls = []
        for s in sec_list:
            url = s["url"]
            rec = arc.index.get(url)
            if not rec or rec.get("state") != "complete":
                missing_body.append({"url": url, "reason": "not archived"})
                continue
            page = decode_html(arc.read(rec))[0]
            parsed = parse_section_page(page, url)
            if not parsed:
                missing_body.append({"url": url, "reason": "parse failed"})
                continue
            parsed["receipt_sha"] = rec["sha256"]
            parsed_secs.append(parsed)
            raw_shas.append(rec["sha256"])
            source_urls.append(url)

        if not parsed_secs:
            continue

        blocks = []
        occ_by_num = {}
        for p in parsed_secs:
            occ_by_num[p["number"]] = occ_by_num.get(p["number"], 0) + 1
            occ = occ_by_num[p["number"]]
            block = p["heading_line"]
            if p["body"]:
                block = block + "\n" + p["body"]
            if p["history"]:
                block = block + "\n" + p["history"]
            blocks.append((p, occ, block))

        ch_text = "\n\n".join(b[2] for b in blocks)
        offsets = []
        pos = 0
        for i, (p, occ, block) in enumerate(blocks):
            if i:
                pos += 2
            start = pos
            end = start + len(block)
            offsets.append((p, occ, start, end))
            pos = end

        native_id = f"{ch['slug']}/{ch['chapter_file']}"
        chapters_out.append(
            {
                "native_id": native_id,
                "path": [
                    {"type": "title", "number": ch["slug"], "heading": ch.get("title_heading")},
                    {"type": "chapter", "number": ch.get("chapter_file"), "heading": ch.get("chapter_heading")},
                ],
                "heading": ch.get("chapter_heading"),
                "text": ch_text,
                "raw_sha256s": list(dict.fromkeys(raw_shas)),
                "source_urls": source_urls,
            }
        )

        for p, occ, start, end in offsets:
            hier = build_hierarchy(ch, p)
            cit = f"§{p['number']}"
            if p["heading"]:
                cit = f"§{p['number']}. {p['heading']}"
            sections_out.append(
                {
                    "state": STATE,
                    "chapter_native_id": native_id,
                    "citation_path": citation_path(hier, occ),
                    "citation": cit,
                    "hierarchy": hier,
                    "heading": p["heading"],
                    "history": p["history"],
                    "status_label": p["status_label"],
                    "edition": EDITION,
                    "currency": currency,
                    "effective": None,
                    "start": start,
                    "end": end,
                    "source_url": p["url"],
                    "source_receipt_sha256": p["receipt_sha"],
                    "occurrence": occ,
                    "page_extracted": p.get("docinfo"),
                }
            )

        inv_count = len(sec_list)
        if len(parsed_secs) != inv_count:
            mismatches.append(
                {
                    "chapter": ch["chapter_url"],
                    "toc_sections": inv_count,
                    "parsed": len(parsed_secs),
                }
            )

    man = write_packet(
        work,
        STATE,
        source=inv["source"],
        edition=EDITION,
        chapters=chapters_out,
        sections=sections_out,
        extra={"currency": currency},
    )
    report = {
        "chapters": len(chapters_out),
        "sections": len(sections_out),
        "mismatches": mismatches,
        "missing_body": missing_body,
        "manifest": man,
    }
    with open(os.path.join(work, "REPORT.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/me")
    a = ap.parse_args()
    r = stage(a.work)
    print(json.dumps({"chapters": r["chapters"], "sections": r["sections"], "mismatches": len(r["mismatches"])}))


if __name__ == "__main__":
    main()
