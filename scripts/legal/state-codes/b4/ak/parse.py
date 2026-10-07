"""Parse archived Alaska Statutes chapter print HTML into a staging packet."""
import argparse
import html as html_mod
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, sha256_hex, write_packet  # noqa: E402

STATE = "AK"
BASE = "https://www.akleg.gov/basis/statutes.asp"
SECTION_ANCHOR = re.compile(r"^(\d{2})\.(\d{2})\.(\d+(?:[a-zA-Z])?)$")
CHAPTER_ANCHOR = re.compile(r"^(\d{2})\.(\d{2})$")
ANCHOR_SPLIT = re.compile(r'<a\s+name="([^"]+)"[^>]*>\s*</a>', re.I)
BRACKET_STATUS = re.compile(r"\[([^\]]+)\]")


def decode_ak(raw: bytes) -> tuple[str, str]:
    """Alaska BASIS print pages are Windows-1252 / ISO-8859-1; prefer cp1252 for curly quotes."""
    for enc in ("cp1252", "latin-1", "utf-8"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace"), "utf-8-replace"


def ak_fragment_text(fragment: str) -> str:
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", fragment)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    s = html_mod.unescape(s)
    lines = [collapse(x) for x in s.split("\n")]
    return "\n".join(x for x in lines if x)


def section_anchors_in_page(page: str) -> list[str]:
    """Publisher section anchors in document order (includes duplicate names)."""
    out = []
    for m in ANCHOR_SPLIT.finditer(page):
        name = m.group(1).strip()
        if SECTION_ANCHOR.match(name):
            out.append(name)
    return out


def first_status_label(text: str) -> str | None:
    m = BRACKET_STATUS.search(text)
    return m.group(1).strip() if m else None


def heading_from_header(header: str, anchor: str) -> str | None:
    """Best-effort heading after the section number(s) on the printed line."""
    h = header
    for prefix in (r"Secs?\.\s*", r"§§?\s*"):
        h = re.sub(prefix, "", h, count=1, flags=re.I)
    h = re.sub(r"^[\d.\s,a-zA-Z—\-–]+", "", h).strip()
    h = re.sub(r"\[[^\]]+\]\s*$", "", h).strip()
    return h or None


def split_header_body(chunk: str) -> tuple[str, str]:
    chunk = chunk.lstrip()
    m = re.search(r"</b>", chunk, re.I)
    if m:
        return chunk[: m.start()], chunk[m.end() :]
    m2 = re.search(r"(?i)<br\s*/?>", chunk)
    if m2:
        return chunk[: m2.start()], chunk[m2.end() :]
    return chunk, ""


def parse_chapter_html(raw: bytes, chapter_id: str, source_url: str, receipt_sha: str):
    page, _ = decode_ak(raw)
    chapter_heading = None
    mch = re.search(
        rf'<a\s+name="{re.escape(chapter_id)}"[^>]*>\s*</a>\s*<h6>(.*?)</h6>',
        page,
        re.I | re.S,
    )
    if mch:
        chapter_heading = ak_fragment_text(mch.group(1))

    parts = ANCHOR_SPLIT.split(page)
    parsed = []
    occ: dict[str, int] = {}
    i = 1
    while i + 1 < len(parts):
        name = parts[i].strip()
        chunk = parts[i + 1]
        i += 2
        if not SECTION_ANCHOR.match(name):
            continue
        occ[name] = occ.get(name, 0) + 1
        header_html, body_html = split_header_body(chunk)
        header = ak_fragment_text(header_html)
        body = ak_fragment_text(body_html)
        if header and body:
            text = header + "\n" + body
        else:
            text = header or body
        status = first_status_label(text)
        parsed.append(
            {
                "anchor": name,
                "number": name,
                "occurrence": occ[name],
                "heading": heading_from_header(header, name),
                "header_line": header,
                "status_label": status,
                "text": text,
                "source_url": f"{BASE}#{name}",
                "receipt_sha": receipt_sha,
            }
        )

    chapter_only_text = None
    if not parsed:
        mco = re.search(
            rf'<a\s+name="{re.escape(chapter_id)}"[^>]*>\s*</a>(.*?)(?:</div>\s*$|</div>)',
            page,
            re.I | re.S,
        )
        if mco:
            chapter_only_text = ak_fragment_text(mco.group(1))

    return chapter_heading, parsed, chapter_only_text, section_anchors_in_page(page)


def hierarchy(chapter_id: str, chapter_heading: str | None, sec: dict):
    parts = sec["anchor"].split(".")
    t, ch = parts[0], f"{parts[0]}.{parts[1]}"
    return [
        {"level": "title", "number": t, "heading": None},
        {"level": "chapter", "number": chapter_id, "heading": chapter_heading},
        {"level": "section", "number": sec["anchor"], "heading": sec["heading"]},
    ]


def citation_path_for(anchor: str, occurrence: int) -> str:
    return f"{anchor}@{occurrence}" if occurrence > 1 else anchor


def citation_as_printed(sec: dict) -> str:
    line = sec["header_line"] or ""
    if line.lower().startswith(("sec", "§")):
        cit = line
    else:
        cit = f"AS {sec['anchor']}" + (f". {sec['heading']}" if sec.get("heading") else "")
    if len(cit) > 400:
        cit = cit[:397] + "..."
    return cit


def reconcile_chapter(
    ch: str, page_anchors: list[str], staged_anchors: list[str], staged_paths: list[str], toc: list[str]
) -> dict | None:
    from collections import Counter

    pa = page_anchors
    sa = staged_anchors
    page_vs_staged = pa != sa
    toc_vs_page = Counter(toc) != Counter(pa)
    if not page_vs_staged and not toc_vs_page and len(toc) == len(pa):
        return None
    return {
        "chapter": ch,
        "page_anchor_count": len(pa),
        "staged_anchor_count": len(sa),
        "toc_line_count": len(toc),
        "page_anchors": pa,
        "staged_anchors": sa,
        "staged_citation_paths": staged_paths,
        "toc_sections": toc,
        "page_vs_staged": page_vs_staged,
        "toc_vs_page": toc_vs_page,
        "toc_duplicates": [k for k, v in Counter(toc).items() if v > 1],
        "anchor_duplicates": [k for k, v in Counter(pa).items() if v > 1],
    }


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
    reconcile = []
    missing_body = []
    before_sections = 0
    pkt_path = os.path.join(work, "packet", "sections.jsonl")
    if os.path.exists(pkt_path):
        before_sections = sum(1 for _ in open(pkt_path))

    for ch_row in inv["chapters"]:
        ch = ch_row["chapter"]
        secs_inv = ch_row["sections"]
        rel = f"chapter/{ch.replace('.', '_')}.html"
        url = (
            f"{BASE}?media=print&secStart={secs_inv[0]}&secEnd={secs_inv[-1]}"
            if secs_inv
            else f"{BASE}?media=print&secStart={ch}&secEnd={ch}"
        )
        rec = next((r for r in arc.index.values() if r.get("file") == os.path.join("raw", rel)), None)
        if not rec or rec.get("state") != "complete":
            if secs_inv or not secs_inv:
                reconcile.append(
                    {
                        "chapter": ch,
                        "reason": "missing raw chapter html",
                        "toc_line_count": len(secs_inv),
                    }
                )
            continue
        raw = arc.read(rec)
        ch_heading, parsed, chapter_only, page_anchors = parse_chapter_html(
            raw, ch, url, rec["sha256"]
        )

        staged_paths = []
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
                    "source_urls": [url],
                    "no_sections_official": True,
                    "page_section_anchors": page_anchors,
                }
            )
            rec_row = reconcile_chapter(ch, page_anchors, [], staged_paths, secs_inv)
            if rec_row:
                reconcile.append(rec_row)
            continue

        blocks = [(p, p["text"]) for p in parsed]
        ch_text = "\n\n".join(b[1] for b in blocks)
        if "\ufffd" in ch_text:
            missing_body.append({"chapter": ch, "issue": "U+FFFD in chapter text"})

        pos = 0
        offsets = []
        for i, (p, block) in enumerate(blocks):
            if i:
                pos += 2
            start = pos
            end = start + len(block)
            offsets.append((p, start, end))
            pos = end
            staged_paths.append(citation_path_for(p["anchor"], p["occurrence"]))

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
                "source_urls": [url],
                "page_section_anchors": page_anchors,
            }
        )

        for p, start, end in offsets:
            if not p["text"].strip() and not p["status_label"]:
                missing_body.append(p["anchor"])
            sections_out.append(
                {
                    "state": STATE,
                    "chapter_native_id": native_id,
                    "citation_path": citation_path_for(p["anchor"], p["occurrence"]),
                    "citation": citation_as_printed(p),
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

        staged_anchors = [p["anchor"] for p in parsed]
        rec_row = reconcile_chapter(ch, page_anchors, staged_anchors, staged_paths, secs_inv)
        if rec_row:
            reconcile.append(rec_row)

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
        "before_sections": before_sections,
        "after_sections": len(sections_out),
        "chapters": len(chapters_out),
        "sections": len(sections_out),
        "reconcile_diff_chapters": len(reconcile),
        "reconcile": reconcile,
        "missing_body": missing_body,
        "manifest": man,
    }
    with open(os.path.join(work, "reconcile.json"), "w") as f:
        json.dump(reconcile, f, indent=1)
    with open(os.path.join(work, "REPORT.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/ak")
    a = ap.parse_args()
    r = stage(a.work)
    print(
        json.dumps(
            {
                "before_sections": r["before_sections"],
                "after_sections": r["after_sections"],
                "reconcile_diff_chapters": r["reconcile_diff_chapters"],
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
