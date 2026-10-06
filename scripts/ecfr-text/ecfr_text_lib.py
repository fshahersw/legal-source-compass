"""Shared, network-free helpers for the official eCFR section-text acquisition.

Nothing here reads credentials or touches a database. The text contract is
`ecfr-section-text/1`: one entity per eCFR section, native identity
`title-<T>/part-<P>/section-<S>`, derived from a retained raw eCFR Versioner
response (sha256 + byte range of the exact `<DIV8>` fragment).
"""
import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET

SCHEMA_VERSION = "ecfr-section-text/1"
SOURCE_SYSTEM = "ecfr"
ENTITY_TYPE = "section-text"
API_ROOT = "https://www.ecfr.gov/api/versioner/v1"
HUMAN_ROOT = "https://www.ecfr.gov/current"
RAW_PREFIX = "ecfr-text/sha256"

# Inline markup stays inside the surrounding line; everything else is a block (own line).
INLINE_TAGS = {"I", "B", "E", "SU", "FR", "SUB", "SUP", "AC", "PRTPAGE", "FTREF", "BU", "TI", "ITAG", "SPAN", "A", "STRIKE", "U"}
NON_TEXT_TAGS = {"GID", "MID", "IMG", "FIGURE", "MATH", "FGR"}
NOTE_TAGS = {"CITA", "SECAUTH", "EDNOTE", "EFFDNOT"}

_DASHES = str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2212": "-"})


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def canonical_json(value):
    """Matches corpus_ingest.canonical_integer_jsonb_v1 for integer-domain JSON."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def record_sha256(data):
    assert_integer_domain(data)
    return sha256_hex(canonical_json(data))


def assert_integer_domain(value):
    if value is None or type(value) in (bool, int):
        return
    if type(value) is str:
        if "\x00" in value or any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("NUL or surrogate in string")
        return
    if type(value) is list:
        for v in value:
            assert_integer_domain(v)
        return
    if type(value) is dict:
        for k, v in value.items():
            if type(k) is not str:
                raise ValueError("non-string key")
            assert_integer_domain(k)
            assert_integer_domain(v)
        return
    raise ValueError("unsupported JSON type " + type(value).__name__)


def normalize_section_number(value):
    """Section identifiers compared with unicode dashes folded and a leading section sign removed."""
    s = (value or "").translate(_DASHES).strip()
    s = re.sub(r"^\u00a7+\s*", "", s)
    return re.sub(r"\s+", " ", s)


def section_native_id(title, part, section):
    return f"title-{title}/part-{part}/section-{normalize_section_number(section)}"


def human_url(title, section):
    return f"{HUMAN_ROOT}/title-{title}/section-{normalize_section_number(section)}"


def part_url(as_of, title, part):
    return f"{API_ROOT}/full/{as_of}/title-{title}.xml?part={part}"


def section_url(as_of, title, part, section):
    return f"{API_ROOT}/full/{as_of}/title-{title}.xml?part={part}&section={section}"


def raw_object_key(sha):
    return f"{RAW_PREFIX}/{sha[:2]}/{sha}.xml"


def _collapse(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _has_block_child(elem):
    return any(c.tag not in INLINE_TAGS for c in elem)


def _lines(elem, out):
    if elem.tag in NOTE_TAGS or elem.tag == "HEAD":
        return
    if elem.tag == "GPOTABLE":
        for row in elem.iter("ROW"):
            cells = [_collapse("".join(c.itertext())) for c in row if c.tag in ("ENT", "TH", "TD")]
            if any(cells):
                out.append(" | ".join(cells))
        return
    if not _has_block_child(elem):
        line = _collapse("".join(elem.itertext()))
        if line:
            out.append(line)
        return
    lead = _collapse(elem.text)
    if lead:
        out.append(lead)
    for child in elem:
        if child.tag in INLINE_TAGS:
            line = _collapse("".join(child.itertext()))
            if line:
                out.append(line)
        else:
            _lines(child, out)
        tail = _collapse(child.tail)
        if tail:
            out.append(tail)


def parse_section_fragment(fragment):
    """Plain-text projection of one `<DIV8 TYPE="SECTION">` fragment (str). Text only; notes kept apart."""
    root = ET.fromstring(fragment)
    heading = _collapse("".join(root.find("HEAD").itertext())) if root.find("HEAD") is not None else ""
    lines = []
    for child in root:
        if child.tag in INLINE_TAGS:
            line = _collapse("".join(child.itertext()))
            if line:
                lines.append(line)
        else:
            _lines(child, lines)
    notes = {}
    for tag in ("CITA", "SECAUTH", "EDNOTE", "EFFDNOT"):
        vals = [_collapse("".join(e.itertext())) for e in root.iter(tag)]
        if vals:
            notes[tag] = vals
    non_text = sorted({e.tag for e in root.iter() if e.tag in NON_TEXT_TAGS})
    return {
        "number": root.get("N", ""),
        "heading": heading,
        "text": "\n".join(lines),
        "source_note": "\n".join(notes.get("CITA", [])) or None,
        "authority_note": "\n".join(notes.get("SECAUTH", [])) or None,
        "editorial_notes": notes.get("EDNOTE", []) + notes.get("EFFDNOT", []),
        "non_text_elements": non_text,
    }


_SECTION_OPEN = re.compile(r'<DIV8\b[^>]*\bTYPE="SECTION"[^>]*>')


def section_fragments(raw):
    """Yield (number, start, end, fragment) for every section in a raw part response (bytes -> str decode utf-8)."""
    text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
    for m in _SECTION_OPEN.finditer(text):
        end = text.find("</DIV8>", m.end())
        if end < 0:
            raise ValueError("unterminated DIV8 section")
        end += len("</DIV8>")
        n = re.search(r'\bN="([^"]*)"', m.group(0))
        yield (html.unescape(n.group(1)) if n else ""), m.start(), end, text[m.start():end]


def is_reserved(heading, text):
    h = heading.lower()
    return "[reserved]" in h or (not text and "[removed]" in h)


def build_entity(*, title, part, section_number, parsed, raw_sha256, raw_bytes_len, start, end, fragment, as_of,
                 title_meta, source_url, retrieved_at, http_status, hierarchy_native_id=None, raw_object=None):
    """Return the ingest envelope for one section. `fragment` is hashed as retained bytes (utf-8)."""
    frag_bytes = fragment.encode("utf-8")
    text = parsed["text"]
    data = {
        "title_number": str(title),
        "part_number": str(part),
        "section_number": normalize_section_number(section_number),
        "heading": parsed["heading"],
        "reserved": is_reserved(parsed["heading"], text),
        "text": text,
        "text_sha256": sha256_hex(text),
        "text_length": len(text),
        "source_note": parsed["source_note"],
        "authority_note": parsed["authority_note"],
        "editorial_notes": parsed["editorial_notes"],
        "non_text_elements": parsed["non_text_elements"],
        "fragment_sha256": sha256_hex(frag_bytes),
        "fragment_bytes": len(frag_bytes),
        "raw_response_sha256": raw_sha256,
        "raw_response_bytes": raw_bytes_len,
        "as_of": as_of,
        "title_latest_amended_on": title_meta.get("latest_amended_on"),
        "title_latest_issue_date": title_meta.get("latest_issue_date"),
        "title_up_to_date_as_of": title_meta.get("up_to_date_as_of"),
        "title_name": title_meta.get("name"),
        "hierarchy_native_id": hierarchy_native_id,
        "ecfr_url": human_url(title, section_number),
        "temporal_basis": "eCFR point-in-time text as of the stated date; not a legal effective date, not the annual CFR edition",
    }
    native_id = section_native_id(title, part, section_number)
    provenance = {
        "record_sha256": record_sha256(data),
        "source_url": source_url,
        "source_sha256": raw_sha256,
        "source_as_of": as_of,
        "retrieved_at": retrieved_at,
        "http_status": http_status,
        "derivation": "plain-text projection of the retained eCFR Versioner XML section fragment",
        "hash_kind": "canonical-integer-jsonb/1",
        "raw_object_key": raw_object_key(raw_sha256) if raw_object is None else raw_object,
        "fragment_char_range": [start, end],
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "source_system": SOURCE_SYSTEM,
        "entity_type": ENTITY_TYPE,
        "native_id": native_id,
        "data": data,
        "provenance": provenance,
    }


def parse_oul_source_id(source_id):
    """`CFR_T21_P1_S1_1` -> ('21','1'); `USC_T18_C95_S1956` -> ('18', None). Native publisher id only."""
    m = re.match(r"^CFR_T(\d+)_P(.+?)_S", source_id or "")
    if m:
        return m.group(1), m.group(2).replace("_", "-")
    m = re.match(r"^USC_T(\d+)_", source_id or "")
    if m:
        return m.group(1), None
    return None, None
