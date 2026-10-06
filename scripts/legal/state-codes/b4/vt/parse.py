"""Parse archived Vermont Statutes Online HTML into a staging packet."""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, html_text, sha256_hex, write_packet  # noqa: E402

STATUTES = "https://legislature.vermont.gov/statutes/"
ALERT = re.compile(r'<div class="alert alert-warning">\s*(.*?)</div>', re.S | re.I)
TITLE_HEAD = re.compile(
    r'<h2 class="statute-title"><a[^>]*>Title\s*<span class="dirty">([^<]*)</span>\s*:\s*<span class="caps">\s*(.*?)\s*</span>',
    re.S | re.I,
)
CH_HEAD = re.compile(
    r'<h3 class="statute-chapter"><a[^>]*>(?:Article|Chapter)\s*<span class="dirty">\s*([^<]*)\s*</span>\s*:\s*<span class="caps">\s*(.*?)\s*</span>',
    re.S | re.I,
)
DETAIL = re.compile(r'<ul class="item-list statutes-detail">(.*?)</ul>', re.S | re.I)
LI = re.compile(r"<li\b.*?</li>", re.S | re.I)
SEC_HEAD = re.compile(r"<b>\s*§\s*([^<]+?)\.\s*(.*?)\s*</b>", re.S | re.I)
HISTORY_TAIL = re.compile(
    r"\((?:Added|Amended|Repealed|Renumbered|Transferred|Expired|Reserved)[^)]*\)\.?\s*$",
    re.I,
)
CON_ART = re.compile(r"<p><strong>\s*(Article\s+\d+\..*?|§\s*\d+\..*?)\s*</strong></p>", re.S | re.I)


def publisher_currency(html):
    m = ALERT.search(html)
    if not m:
        return {"statement": None, "as_of": None}
    stmt = collapse(html_text(m.group(1)))
    return {"statement": stmt or None, "as_of": None}


def parse_title_chapter_heads(html):
    t = TITLE_HEAD.search(html)
    c = CH_HEAD.search(html)
    title_num = collapse(t.group(1)) if t else ""
    title_head = collapse(t.group(2)) if t else ""
    ch_num = collapse(c.group(1)) if c else ""
    ch_head = collapse(c.group(2)) if c else ""
    return title_num, title_head, ch_num, ch_head


def section_header_parts(header_line):
    m = re.match(r"§\s*(.+?)\.\s*(.*)", header_line.strip(), re.S)
    if not m:
        return header_line.strip(), ""
    return collapse(m.group(1)), collapse(m.group(2))


def extract_history(text):
    notes = []
    for line in text.split("\n"):
        ln = line.strip()
        while ln:
            m = HISTORY_TAIL.search(ln)
            if not m:
                break
            notes.insert(0, collapse(m.group(0)))
            ln = ln[: m.start()].strip()
    hist = " ".join(notes) if notes else None
    status = None
    if hist:
        low = hist.lower()
        if "repealed" in low:
            status = "Repealed"
        elif "expired" in low:
            status = "Expired"
        elif "reserved" in low:
            status = "Reserved"
        elif "transferred" in low:
            status = "Transferred"
    return hist, status


def citation_display(title_num, sec_num):
    sec = sec_num.replace("—", "-").replace("–", "-")
    return f"{title_num} V.S.A. § {sec}"


def parse_fullchapter(html, *, title, chapter, source_url, receipt_sha):
    cur = publisher_currency(html)
    tnum, thead, cnum, chead = parse_title_chapter_heads(html)
    if not tnum:
        tnum = title
    if not cnum:
        cnum = chapter
    dm = DETAIL.search(html)
    if not dm:
        return []
    sections = []
    for li in LI.findall(dm.group(1)):
        hm = SEC_HEAD.search(li)
        if not hm:
            continue
        num, head = section_header_parts(f"§ {hm.group(1)}. {hm.group(2)}")
        body = html_text(li)
        if not body:
            continue
        hist, status = extract_history(body)
        cite = citation_display(tnum, num)
        sections.append(
            {
                "number": num,
                "heading": head or None,
                "citation": cite,
                "text": body,
                "history": hist,
                "status_label": status,
                "source_url": source_url,
                "source_receipt_sha256": receipt_sha,
                "currency": cur,
                "title_num": tnum,
                "title_heading": thead,
                "chapter_num": cnum,
                "chapter_heading": chead,
            }
        )
    return sections


def parse_constitution(html, *, source_url, receipt_sha):
    cur = publisher_currency(html)
    main = re.search(r'id="main-content".*?>(.*)</div>\s*<div class="sidebar">', html, re.S | re.I)
    if not main:
        return []
    block = main.group(1)
    block = re.sub(r'<div class="print-top.*?</div>', "", block, flags=re.S)
    block = re.sub(r'<h2>The Vermont Statutes Online</h2>.*?alert-warning">.*?</div>', "", block, flags=re.S)
    parts = re.split(r"(?=<p><strong>)", block)
    sections = []
    for part in parts:
        m = CON_ART.search(part)
        if not m:
            continue
        label = collapse(html_text(m.group(1)))
        body = html_text(part)
        if not body:
            continue
        num_m = re.match(r"(?:Article\s+(\d+)|§\s*(\d+))", label, re.I)
        num = (num_m.group(1) or num_m.group(2) or label) if num_m else label
        cite = f"Vt. Const. {label}" if label.lower().startswith("article") else f"Vt. Const. § {num}"
        sections.append(
            {
                "number": str(num),
                "heading": label,
                "citation": cite,
                "text": body,
                "history": None,
                "status_label": None,
                "source_url": source_url,
                "source_receipt_sha256": receipt_sha,
                "currency": cur,
                "title_num": "CONSTITUTION",
                "title_heading": "Constitution of the State of Vermont",
                "chapter_num": "0",
                "chapter_heading": None,
            }
        )
    return sections


def load_toc(work):
    path = os.path.join(work, "inventory.jsonl")
    by_ch = {}
    if not os.path.exists(path):
        return by_ch
    with open(path) as f:
        for line in f:
            row = json.loads(line)
            key = (row["title"], row["chapter"])
            by_ch[key] = [x["section_key"] for x in row.get("toc", [])]
    return by_ch


def build_packet(work):
    arc = Archive(work)
    toc_by_ch = load_toc(work)
    currency_stmt = None
    chapters_out = []
    sections_out = []
    seen_citation = {}

    def add_sections(parsed, native_id, raw_sha, urls, toc_keys):
        nonlocal currency_stmt
        if not parsed:
            return
        if parsed[0].get("currency", {}).get("statement") and not currency_stmt:
            currency_stmt = parsed[0]["currency"]["statement"]
        text_parts = []
        span_rows = []
        for i, s in enumerate(parsed):
            key = toc_keys[i] if toc_keys and i < len(toc_keys) else s["number"]
            citation_path = f"{s['title_num']}/{s['chapter_num']}/{key}"
            if citation_path in seen_citation:
                seen_citation[citation_path] += 1
                citation_path = f"{citation_path}#{seen_citation[citation_path]}"
            else:
                seen_citation[citation_path] = 0
            start = sum(len(p) + (2 if j else 0) for j, p in enumerate(text_parts))
            text_parts.append(s["text"])
            end = start + len(s["text"])
            span_rows.append((s, start, end, citation_path))
        chapter_text = "\n\n".join(text_parts)
        chapters_out.append(
            {
                "native_id": native_id,
                "path": [
                    {"level": "title", "number": parsed[0]["title_num"], "heading": parsed[0]["title_heading"] or None},
                    {"level": "chapter", "number": parsed[0]["chapter_num"], "heading": parsed[0]["chapter_heading"] or None},
                ],
                "heading": parsed[0]["chapter_heading"] or parsed[0]["chapter_num"],
                "text": chapter_text,
                "raw_sha256s": [raw_sha],
                "source_urls": urls,
            }
        )
        for s, start, end, citation_path in span_rows:
            sections_out.append(
                {
                    "chapter_native_id": native_id,
                    "state": "VT",
                    "citation_path": citation_path,
                    "citation": s["citation"],
                    "hierarchy": [
                        {"level": "title", "number": s["title_num"], "heading": s["title_heading"] or None},
                        {"level": "chapter", "number": s["chapter_num"], "heading": s["chapter_heading"] or None},
                        {"level": "section", "number": s["number"], "heading": s["heading"]},
                    ],
                    "number": s["number"],
                    "heading": s["heading"],
                    "start": start,
                    "end": end,
                    "history": s["history"],
                    "status_label": s["status_label"],
                    "edition": None,
                    "currency": s["currency"],
                    "effective": None,
                    "source_url": s["source_url"],
                    "source_receipt_sha256": s["source_receipt_sha256"],
                }
            )

    for url, rec in sorted(arc.index.items()):
        if rec.get("state") != "complete" or "/fullchapter/" not in url:
            continue
        m = re.search(r"/fullchapter/([^/]+)/([^/]+)$", url)
        if not m:
            continue
        title, chapter = m.group(1), m.group(2)
        html = decode_html(arc.read(rec))[0]
        parsed = parse_fullchapter(html, title=title, chapter=chapter, source_url=url, receipt_sha=rec["sha256"])
        add_sections(parsed, f"{title}/{chapter}", rec["sha256"], [url], toc_by_ch.get((title, chapter)))

    const_url = STATUTES + "constitution-of-the-state-of-vermont"
    if const_url in arc.index and arc.index[const_url].get("state") == "complete":
        rec = arc.index[const_url]
        html = decode_html(arc.read(rec))[0]
        parsed = parse_constitution(html, source_url=const_url, receipt_sha=rec["sha256"])
        add_sections(parsed, "CONSTITUTION", rec["sha256"], [const_url], None)

    man = write_packet(
        work,
        "VT",
        source={"publisher": "Vermont General Assembly", "base_url": STATUTES, "code": "V.S.A."},
        edition=None,
        chapters=chapters_out,
        sections=sections_out,
        extra={"currency_statement": currency_stmt},
    )
    return man, chapters_out, sections_out


def verify(work, chapters_out, sections_out):
    arc = Archive(work)
    bad_hash = []
    for rec in arc.index.values():
        if rec.get("state") == "complete":
            try:
                arc.read(rec)
            except SystemExit:
                bad_hash.append(rec["url"])
    toc_by_ch = load_toc(work)
    mismatches = []
    by_ch = {}
    for s in sections_out:
        by_ch.setdefault(s["chapter_native_id"], []).append(s)
    for (title, ch), toc in toc_by_ch.items():
        nid = f"{title}/{ch}"
        got = len(by_ch.get(nid, []))
        url = f"https://legislature.vermont.gov/statutes/fullchapter/{title}/{ch}"
        rec = arc.index.get(url)
        if rec and rec.get("state") == "complete":
            html = decode_html(arc.read(rec))[0]
            toc_count = len(SEC_HEAD.findall(html))
            if got != toc_count:
                mismatches.append({"chapter": nid, "page_markers": toc_count, "parsed": got, "inventory_toc": len(toc)})
        elif got != len(toc):
            mismatches.append({"chapter": nid, "parsed": got, "inventory_toc": len(toc), "note": "no fullchapter archived"})
    ch_text = {}
    for c in chapters_out:
        with open(os.path.join(work, "packet", "chapter-text", sha256_hex(c["text"]) + ".txt"), encoding="utf-8") as f:
            ch_text[c["native_id"]] = f.read()
    span_bad = []
    for s in sections_out:
        t = ch_text[s["chapter_native_id"]][s["start"] : s["end"]]
        if sha256_hex(t) != s.get("text_sha256", sha256_hex(t)):
            span_bad.append(s["citation_path"])
    return {"receipt_hash_failures": bad_hash, "toc_mismatches": mismatches, "span_failures": span_bad[:20], "span_failure_count": len(span_bad)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/vt")
    a = ap.parse_args()
    man, ch, sec = build_packet(a.work)
    v = verify(a.work, ch, sec)
    arc = Archive(a.work)
    routes = {"direct": 0, "firecrawl": 0}
    raw_bytes = 0
    for r in arc.index.values():
        if r.get("state") == "complete":
            routes[r.get("route", "direct")] = routes.get(r.get("route", "direct"), 0) + 1
            raw_bytes += r.get("bytes", 0)
    report = {
        "source_url": STATUTES,
        "manifest": man,
        "verification": v,
        "counts": {
            "chapters": len(ch),
            "sections": len(sec),
            "receipts_complete": sum(1 for r in arc.index.values() if r.get("state") == "complete"),
            "raw_bytes": raw_bytes,
            "routes": routes,
        },
    }
    with open(os.path.join(a.work, "REPORT.json"), "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps({"chapters": len(ch), "sections": len(sec), "mismatches": len(v["toc_mismatches"])}, indent=1))


if __name__ == "__main__":
    main()
