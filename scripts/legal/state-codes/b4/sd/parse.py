"""Parse archived SDCL statute JSON into staging packet rows."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive, collapse, html_text, sha256_hex, write_packet  # noqa: E402

from chapter_html import section_html_fragments  # noqa: E402

STATE = "SD"
EDITION = "South Dakota Codified Laws"
SOURCE = "https://sdlegislature.gov/Statutes"

SOURCE_RE = re.compile(r"(?is)Source:\s*(.*)")
REPEALED_RE = re.compile(r"(?i)\brepealed\b|\btransferred\b|\bsuperseded\b|\breserved\b|\bexpired\b")


def parse_section_html(html: str, citation: str, catchline: str | None):
    """Return heading_line, body, history, status_label from section Html fragment."""
    if not html:
        return None
    text = html_text(html)
    if not text:
        return None
    heading_line = None
    m = re.search(rf"^{re.escape(citation)}\.?\s*(.*)", text, re.M)
    if m:
        heading_line = collapse(f"{citation}. {m.group(1).split(chr(10))[0]}")
    elif catchline:
        heading_line = collapse(f"{citation}. {catchline}")
    else:
        heading_line = citation
    history = None
    sm = SOURCE_RE.search(text)
    if sm:
        history = collapse("Source: " + sm.group(1))
        body_text = text[: sm.start()]
    else:
        body_text = text
    body_lines = []
    for line in body_text.split("\n"):
        line = collapse(line)
        if not line or line.startswith(citation):
            continue
        if line == catchline or (catchline and line == collapse(catchline)):
            continue
        body_lines.append(line)
    body = "\n".join(body_lines).strip()
    status_label = None
    combined = " ".join(
        x
        for x in ((catchline or ""), (heading_line or ""), (body or ""), (history or ""))
        if x
    )
    if REPEALED_RE.search(combined):
        for word in ("Repealed", "Transferred", "Superseded", "Reserved", "Expired"):
            if word.lower() in combined.lower():
                status_label = word
                break
    return {
        "heading_line": heading_line,
        "body": body or None,
        "history": history,
        "status_label": status_label,
    }


def load_section_payload(arc: Archive, citation: str, ch_stat: str):
    """Section JSON receipt, or a slice from the archived chapter bundle."""
    url = f"https://sdlegislature.gov/api/Statutes/Statute/{citation}"
    rec = arc.index.get(url)
    if rec and rec.get("state") == "complete":
        data = json.loads(arc.read(rec))
        if data.get("Type") == "Section":
            return data, url, rec["sha256"]
    ch_url = f"https://sdlegislature.gov/api/Statutes/Statute/{ch_stat}"
    ch_rec = arc.index.get(ch_url)
    if not ch_rec or ch_rec.get("state") != "complete":
        return None, url, None
    ch_data = json.loads(arc.read(ch_rec))
    if ch_data.get("Type") != "Chapter":
        return None, url, None
    frag = section_html_fragments(ch_data.get("Html") or "").get(citation)
    if not frag:
        return None, url, None
    inv_path = os.path.join(arc.work, "inventory.json")
    catch = None
    repealed = None
    if os.path.exists(inv_path):
        inv = json.load(open(inv_path))
        for s in inv.get("sections") or []:
            if s.get("statute") == citation:
                catch = s.get("catchline")
                repealed = s.get("repealed")
                break
    data = {
        "Type": "Section",
        "Statute": citation,
        "CatchLine": catch,
        "Html": frag,
        "Repealed": repealed,
        "Title": ch_data.get("Title"),
        "Chapter": ch_data.get("Chapter"),
    }
    return data, ch_url, ch_rec["sha256"]


def parse_section_json(data: dict, url: str, receipt_sha: str):
    if data.get("Type") != "Section":
        return None
    citation = data.get("Statute")
    catchline = (data.get("CatchLine") or "").strip() or None
    parsed = parse_section_html(data.get("Html") or "", citation, catchline)
    if not parsed:
        return None
    if data.get("Repealed") and not parsed.get("status_label"):
        parsed["status_label"] = "Repealed"
    return {
        "number": citation,
        "heading": catchline,
        **parsed,
        "url": url,
        "receipt_sha": receipt_sha,
        "statute_id": data.get("StatuteId"),
        "title": data.get("Title"),
        "chapter": data.get("Chapter"),
    }


def chapter_from_citation(citation: str) -> tuple[int, str]:
    parts = citation.split("-")
    if len(parts) < 3:
        raise ValueError(citation)
    title_num = int(parts[0])
    ch_stat = "-".join(parts[:-1])
    return title_num, ch_stat


def chapter_native_id(title: int, chapter_statute: str) -> str:
    return f"SDCL/{title}/{chapter_statute}"


def build_hierarchy(title_num: int, title_catch: str | None, ch_statute: str, ch_catch: str | None, parsed: dict):
    hier = [
        {"level": "title", "number": str(title_num), "heading": title_catch},
        {"level": "chapter", "number": ch_statute, "heading": ch_catch},
        {"level": "section", "number": parsed["number"], "heading": parsed["heading"]},
    ]
    return hier


def citation_path(hier, occurrence: int) -> str:
    parts = []
    for h in hier:
        if h["level"] == "section":
            parts.append(h["number"])
        else:
            parts.append(f"{h['level'][0].upper()}{h['number']}")
    base = "/".join(parts)
    return base if occurrence == 1 else f"{base}#{occurrence}"


def currency_from_meta(meta: dict) -> dict:
    eff = meta.get("last_statutes_effective_date")
    statement = None
    as_of = None
    if eff:
        statement = f"Last statutes effective date published by SD Legislature API: {eff}"
        m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(eff))
        if m:
            as_of = m.group(1)
    return {"statement": statement, "as_of": as_of}


def stage(work: str):
    arc = Archive(work)
    inv = json.load(open(os.path.join(work, "inventory.json")))
    meta = json.load(open(os.path.join(work, "meta.json")))
    currency = currency_from_meta(meta)
    title_catch = {int(t["Title"]): (t.get("CatchLine") or "").strip() or None for t in meta["titles"]}
    chapters_by_key = {}
    for ch in inv["chapters"]:
        key = (int(ch["title"]), ch["statute"])
        chapters_by_key[key] = ch
    sections_by_ch = {}
    for s in inv["sections"]:
        t_num, ch_stat = chapter_from_citation(s["statute"])
        sections_by_ch.setdefault((t_num, ch_stat), []).append(s)

    chapters_out = []
    sections_out = []
    mismatches = []
    missing_body = []

    for (t_num, ch_stat), sec_list in sorted(sections_by_ch.items(), key=lambda x: (x[0][0], x[0][1])):
        ch_meta = chapters_by_key.get((t_num, ch_stat), {"statute": ch_stat, "catchline": None})
        parsed_secs = []
        raw_shas = []
        source_urls = []
        for s in sorted(sec_list, key=lambda x: x["statute"]):
            loaded = load_section_payload(arc, s["statute"], ch_stat)
            data, url, receipt_sha = loaded
            if not data:
                missing_body.append({"citation": s["statute"], "reason": "not archived"})
                continue
            parsed = parse_section_json(data, url, receipt_sha)
            if not parsed:
                missing_body.append({"citation": s["statute"], "reason": "parse failed"})
                continue
            if not parsed.get("body") and not parsed.get("status_label") and not s.get("repealed"):
                missing_body.append({"citation": s["statute"], "reason": "empty body"})
            parsed_secs.append(parsed)
            raw_shas.append(receipt_sha)
            source_urls.append(url)

        if not parsed_secs:
            continue

        blocks = []
        occ_by = {}
        for p in parsed_secs:
            occ_by[p["number"]] = occ_by.get(p["number"], 0) + 1
            occ = occ_by[p["number"]]
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

        native_id = chapter_native_id(t_num, ch_stat)
        chapters_out.append(
            {
                "native_id": native_id,
                "path": [
                    {"type": "title", "number": str(t_num), "heading": title_catch.get(t_num)},
                    {"type": "chapter", "number": ch_stat, "heading": ch_meta.get("catchline")},
                ],
                "heading": ch_meta.get("catchline"),
                "text": ch_text,
                "raw_sha256s": list(dict.fromkeys(raw_shas)),
                "source_urls": source_urls,
            }
        )

        for p, occ, start, end in offsets:
            hier = build_hierarchy(t_num, title_catch.get(t_num), ch_stat, ch_meta.get("catchline"), p)
            cit = f"{p['number']}"
            if p["heading"]:
                cit = f"{p['number']}. {p['heading']}"
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
                }
            )

        if len(parsed_secs) != len(sec_list):
            mismatches.append(
                {"chapter": ch_stat, "title": t_num, "inventory": len(sec_list), "parsed": len(parsed_secs)}
            )

    man = write_packet(
        work,
        STATE,
        source=SOURCE,
        edition=EDITION,
        chapters=chapters_out,
        sections=sections_out,
        extra={"currency": currency, "last_statutes_effective_date": meta.get("last_statutes_effective_date")},
    )
    report = {
        "chapters": len(chapters_out),
        "sections": len(sections_out),
        "mismatches": mismatches,
        "missing_body": missing_body,
        "manifest": man,
    }
    with open(os.path.join(work, "REPORT.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    return report


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    a = ap.parse_args()
    r = stage(a.work)
    print(json.dumps({"chapters": r["chapters"], "sections": r["sections"], "mismatches": len(r["mismatches"])}))


if __name__ == "__main__":
    main()
