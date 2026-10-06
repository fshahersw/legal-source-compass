"""Network-free parser for official govinfo U.S. Code section pages (`uscode-section-text/1`).

A govinfo section page carries its own identity in HTML comments (`documentid:<title>_<section>`, `currentthrough:YYYYMMDD`)
and delimits fields with `<!-- field-start:NAME -->` / `<!-- field-end:NAME -->`. Only those delimiters and the page's own
header spans are used; nothing is inferred from the Open US Law record that named the page.
"""
import html
import re
from html.parser import HTMLParser

from ecfr_text_lib import record_sha256, sha256_hex

SCHEMA_VERSION = "uscode-section-text/1"
SOURCE_SYSTEM = "uscode"
ENTITY_TYPE = "section-text"
RAW_PREFIX = "uscode-text/sha256"

BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "li", "table", "caption", "ul", "ol", "br", "blockquote"}


def raw_object_key(sha):
    return f"{RAW_PREFIX}/{sha[:2]}/{sha}.htm"


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = [""]
        self.cell = False

    def handle_starttag(self, tag, attrs):
        if tag in BLOCK:
            self.out.append("")
        elif tag in ("td", "th"):
            if self.out[-1].strip():
                self.out[-1] += " | "

    def handle_endtag(self, tag):
        if tag in BLOCK and tag != "br":
            self.out.append("")

    def handle_data(self, data):
        self.out[-1] += data


def html_to_lines(fragment):
    p = _Text()
    p.feed(fragment)
    p.close()
    lines = []
    for raw in p.out:
        line = re.sub(r"\s+", " ", raw.replace("\u00a0", " ")).strip()
        if line:
            lines.append(line)
    return lines


def field(text, name):
    """All top-level occurrences of a field's inner HTML (non-nested names only)."""
    return [m.group(1) for m in re.finditer(rf"<!-- field-start:{re.escape(name)} -->(.*?)<!-- field-end:{re.escape(name)} -->", text, re.S)]


def parse_section_page(raw):
    text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
    doc = re.search(r"documentid:(\S+)", text)
    through = re.search(r"currentthrough:(\d{8})", text)
    if not doc or not through:
        raise ValueError("page lacks its identity comment")
    title, _, section = doc.group(1).partition("_")
    if not title.isdigit() or not section:
        raise ValueError("unexpected documentid " + doc.group(1))
    spans = [html.unescape(re.sub(r"<[^>]+>", "", s)).strip() for s in re.findall(r'<span style="[^"]*">(.*?)</span>', text, re.S)]
    spans = [re.sub(r"\s+", " ", s) for s in spans if s]
    edition_label = next((s for s in spans if re.match(r"^United States Code, \d{4} Edition$", s)), None)
    edition = re.search(r"(\d{4})", edition_label or "")
    hierarchy = [s for s in spans[2:] if not s.startswith("Sec.") and not s.startswith("From the U.S. Government")]
    head_name = next((n for n in re.findall(r"field-start:(\w*head)\b", text)), None)
    if head_name is None:
        raise ValueError("page has no head field")
    heading_html = (field(text, head_name) or [""])[0]
    heading = " ".join(html_to_lines(heading_html))
    statute = [ln for frag in field(text, "statute") for ln in html_to_lines(frag)]
    credit = [ln for frag in field(text, "sourcecredit") for ln in html_to_lines(frag)]
    notes_frag = field(text, "notes")
    notes_lines = [ln for frag in notes_frag for ln in html_to_lines(frag)]
    note_kinds = sorted(set(re.findall(r"field-start:([\w-]+-note)\b", "".join(notes_frag))))
    footnotes = [" ".join(html_to_lines(f)) for f in field(text, "footnote")]
    repeal = [ln for frag in field(text, "repealsummary") for ln in html_to_lines(frag)]
    d = through.group(1)
    return {
        "document_id": doc.group(1), "title_number": title, "section_number": section,
        "edition": edition.group(1) if edition else None, "edition_label": edition_label,
        "current_through": f"{d[:4]}-{d[4:6]}-{d[6:]}",
        "hierarchy": hierarchy, "head_kind": head_name, "heading": heading,
        "repealed": head_name != "head",
        "text": "\n".join(statute), "source_credit": "\n".join(credit) or None,
        "notes_text": "\n".join(notes_lines) or None, "note_kinds": note_kinds,
        "footnotes": footnotes, "repeal_summary": "\n".join(repeal) or None,
    }


def build_entity(*, parsed, target, raw_sha256, raw_bytes_len, source_url, retrieved_at, http_status, route):
    proxied = route != "direct"
    text = parsed["text"]
    data = {
        "title_number": parsed["title_number"],
        "section_number": parsed["section_number"],
        "document_id": parsed["document_id"],
        "heading": parsed["heading"],
        "head_kind": parsed["head_kind"],
        "repealed": parsed["repealed"],
        "text": text,
        "text_sha256": sha256_hex(text),
        "text_length": len(text),
        "source_credit": parsed["source_credit"],
        "repeal_summary": parsed["repeal_summary"],
        "notes_text": parsed["notes_text"],
        "note_kinds": parsed["note_kinds"],
        "footnotes": parsed["footnotes"],
        "hierarchy": parsed["hierarchy"],
        "edition": parsed["edition"],
        "edition_label": parsed["edition_label"],
        "current_through": parsed["current_through"],
        "granule_id": target["granule"],
        "package_id": target["package"],
        "govinfo_details_url": f"https://www.govinfo.gov/app/details/{target['package']}/{target['granule']}",
        "raw_response_sha256": raw_sha256,
        "raw_response_bytes": raw_bytes_len,
        "proxied_fetch": proxied,
        "temporal_basis": "United States Code edition as published by GPO; current_through is the edition currency date printed on the page, not a legal effective date",
    }
    provenance = {
        "record_sha256": record_sha256(data),
        "source_url": source_url,
        "source_sha256": raw_sha256,
        "source_as_of": parsed["current_through"],
        "retrieved_at": retrieved_at,
        "http_status": http_status,
        "route": route,
        "derivation": "plain-text projection of the retained govinfo section page; field delimiters from the page itself",
        "hash_kind": "canonical-integer-jsonb/1",
        "raw_object_key": raw_object_key(raw_sha256),
    }
    return {
        "schema_version": SCHEMA_VERSION, "source_system": SOURCE_SYSTEM, "entity_type": ENTITY_TYPE,
        "native_id": f"title-{parsed['title_number']}/section-{parsed['section_number']}",
        "data": data, "provenance": provenance,
    }
