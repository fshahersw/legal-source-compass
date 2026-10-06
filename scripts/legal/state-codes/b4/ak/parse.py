"""Parse archived Alaska Statutes chapter print HTML into a staging packet."""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, decode_html, sha256_hex, write_packet  # noqa: E402

STATE = "AK"
BASE = "https://www.akleg.gov/basis/statutes.asp"
SECTION_NAME = re.compile(r"^(\d{2})\.(\d{2})\.(\d{3})$")
CHAPTER_NAME = re.compile(r"^(\d{2})\.(\d{2})$")
SEC_LINE = re.compile(
    r"Sec\.\s*([\d.]+)\.\s+(.*?)(?:\s*<BR\s*/?>|\s*</b>)",
    re.I | re.S,
)
BRACKET_STATUS = re.compile(r"\[([^\]]+)\]\s*$")


def ak_fragment_text(fragment: str) -> str:
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", fragment)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    s = html_mod.unescape(s)
    lines = [collapse(x) for x in s.split("\n")]
    return "\n".join(x for x in lines if x)


def parse_chapter_html(raw: bytes, chapter_id: str, source_url: str, receipt_sha: str):
    page, _ = decode_html(raw)
    chapter_heading = None
    mch = re.search(
        rf'<a\s+name="{re.escape(chapter_id)}"[^>]*>\s*</a>\s*<h6>(.*?)</h6>',
        page,
        re.I | re.S,
    )
    if mch:
        chapter_heading = ak_fragment_text(mch.group(1))

    parts = re.split(r'<a\s+name="([^"]+)"[^>]*>\s*</a>', page, flags=re.I)
    # parts[0] is preamble; then alternating name, content
    parsed = []
    chapter_only_text = None
    if not any(SECTION_NAME.match(parts[j].strip()) for j in range(1, len(parts), 2)):
        mco = re.search(
            rf'<a\s+name="{re.escape(chapter_id)}"[^>]*>\s*</a>(.*?)(?:</div>|$)',
            page,
            re.I | re.S,
        )
        if mco:
            chapter_only_text = ak_fragment_text(mco.group(1))

    i = 1
    while i + 1 < len(parts):
        name = parts[i].strip()
        chunk = parts[i + 1]
        i += 2
        if not SECTION_NAME.match(name):
            continue
        sm = SEC_LINE.search(chunk)
        if not sm:
            continue
        sec_num = sm.group(1).rstrip(".")
        head_rest = sm.group(2)
        head_rest = re.sub(r"(?is)<[^>]+>", " ", head_rest)
        head_rest = html_mod.unescape(head_rest)
        heading_full = collapse(head_rest)
        status = None
        heading = heading_full
        bm = BRACKET_STATUS.search(heading_full)
        if bm:
            status = bm.group(1).strip()
            heading = collapse(heading_full[: bm.start()])
        body_start = sm.end()
        body_html = chunk[body_start:]
        body = ak_fragment_text(body_html)
        sec_line = f"Sec. {sec_num}. {heading_full}".strip()
        if body:
            text = sec_line + "\n" + body
        else:
            text = sec_line
        parsed.append(
            {
                "number": sec_num,
                "heading": heading or None,
                "heading_full": heading_full,
                "status_label": status,
                "text": text,
                "source_url": f"{BASE}#{sec_num}",
                "receipt_sha": receipt_sha,
            }
        )
    return chapter_heading, parsed, chapter_only_text


def hierarchy(chapter_id: str, chapter_heading: str | None, sec: dict):
    t, ch, _ = sec["number"].split(".")
    return [
        {"level": "title", "number": t, "heading": None},
        {"level": "chapter", "number": chapter_id, "heading": chapter_heading},
        {"level": "section", "number": sec["number"], "heading": sec["heading"]},
    ]


def citation_path(number: str, occ: int) -> str:
    return f"{number}@{occ}" if occ > 1 else number


def stage(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    meta = inv.get("meta") or {}
    edition = meta.get("edition_heading") or "Alaska Statutes 2025"
    currency = {
        "statement": meta.get("legislature_line"),
        "as_of": None,
    }
    chapters_out = []
    sections_out = []
    mismatches = []
    missing_body = []

    for ch_row in inv["chapters"]:
        ch = ch_row["chapter"]
        secs_inv = ch_row["sections"]
        rel = f"chapter/{ch.replace('.', '_')}.html"
        url = f"{BASE}?media=print&secStart={secs_inv[0]}&secEnd={secs_inv[-1]}" if secs_inv else None
        rec = None
        for r in arc.index.values():
            if r.get("file") == os.path.join("raw", rel):
                rec = r
                break
        if not rec or rec.get("state") != "complete":
            if secs_inv:
                mismatches.append({"chapter": ch, "reason": "missing raw chapter html"})
            continue
        raw = arc.read(rec)
        ch_heading, parsed, chapter_only = parse_chapter_html(raw, ch, url or BASE, rec["sha256"])
        if len(parsed) != len(secs_inv):
            mismatches.append(
                {
                    "chapter": ch,
                    "toc_sections": len(secs_inv),
                    "parsed": len(parsed),
                    "toc": secs_inv,
                    "parsed_nums": [p["number"] for p in parsed],
                }
            )

        if not parsed and chapter_only:
            chapters_out.append(
                {
                    "native_id": ch,
                    "path": [
                        {"type": "title", "number": ch.split(".")[0], "heading": None},
                        {"type": "chapter", "number": ch, "heading": ch_heading},
                    ],
                    "heading": ch_heading,
                    "text": chapter_only,
                    "raw_sha256s": [rec["sha256"]],
                    "source_urls": [url] if url else [],
                    "no_sections_official": True,
                }
            )
            continue

        blocks = []
        occ_by = {}
        for p in parsed:
            occ_by[p["number"]] = occ_by.get(p["number"], 0) + 1
            blocks.append((p, occ_by[p["number"]], p["text"]))

        ch_text = "\n\n".join(b[2] for b in blocks)
        pos = 0
        offsets = []
        for i, (p, occ, block) in enumerate(blocks):
            if i:
                pos += 2
            start = pos
            end = start + len(block)
            offsets.append((p, occ, start, end))
            pos = end

        native_id = ch
        chapters_out.append(
            {
                "native_id": native_id,
                "path": [
                    {"type": "title", "number": ch.split(".")[0], "heading": None},
                    {"type": "chapter", "number": ch, "heading": ch_heading},
                ],
                "heading": ch_heading,
                "text": ch_text,
                "raw_sha256s": [rec["sha256"]],
                "source_urls": [url] if url else [],
            }
        )

        for p, occ, start, end in offsets:
            if not p["text"].strip() and not p["status_label"]:
                missing_body.append(p["number"])
            cit = f"AS {p['number']}"
            if p["heading"]:
                cit = f"AS {p['number']}. {p['heading']}"
            sections_out.append(
                {
                    "state": STATE,
                    "chapter_native_id": native_id,
                    "citation_path": citation_path(p["number"], occ),
                    "citation": cit,
                    "hierarchy": hierarchy(ch, ch_heading, p),
                    "heading": p["heading"],
                    "history": p["status_label"] if p["status_label"] and "SLA" in p["status_label"] else None,
                    "status_label": p["status_label"],
                    "edition": edition,
                    "currency": currency,
                    "effective": None,
                    "start": start,
                    "end": end,
                    "source_url": p["source_url"],
                    "source_receipt_sha256": p["receipt_sha"],
                }
            )

    man = write_packet(
        work,
        STATE,
        source={"publisher": "Alaska State Legislature", "base_url": BASE},
        edition=edition,
        chapters=chapters_out,
        sections=sections_out,
        extra={"currency": currency, "inventory_meta": meta},
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ak")
    a = ap.parse_args()
    r = stage(a.work)
    print(json.dumps({k: r[k] for k in ("chapters", "sections", "mismatches")}, indent=1))


if __name__ == "__main__":
    main()
