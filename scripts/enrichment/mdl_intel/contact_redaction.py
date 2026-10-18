"""Remove counsel contact details from court-page text (owner decision 2026-10-03: counsel shown without contact fields).

Kept: names, firm names, roles exactly as printed. Removed, by explicit pattern only:
  - e-mail addresses (with an optional "Email:" label)
  - NANP phone / fax numbers, e.g. (212) 584-0700, 419-841-9623, 212.584.0700, +1 212 584 0700 (optional label/extension)
  - "Suite / Ste. / P.O. Box / Nth Floor / #1400" fragments
  - street addresses: from a street number (or a spelled "One".."Ten") up to the next "State ZIP" (a 4-digit number
    directly after "Month dd," is a date, not a street number)
  - any remaining "City, ST 12345"
  - whole lines that start with a street number, "Suite", "Ste." or "P.O. Box"
In sentences (quotes) each removal leaves the marker "[contact removed]" so the edit is visible; in counsel blocks the
contact text is dropped and the block is marked "contact lines removed".
"""
import re

STATE = r"(?:[A-Z]{2}|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)"
ZIP = r"\d{5}(?:-\d{4})?"
LABEL = r"(?:(?:Phone|Tel(?:ephone)?|Fax|Facsimile|Direct(?: Dial)?|Main|Office|Cell|Mobile)\s*[:.]?\s*)"
MARK = "\x00"

RE_EMAIL = re.compile(r"(?:E-?mail\s*:?\s*)?(?:mailto:)?[\w.+'-]+@[\w-]+(?:\.[\w-]+)+", re.I)
RE_PHONE = re.compile(rf"{LABEL}?(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{{3}}\)\s?|\d{{3}}[\s.-])\d{{3}}[\s.-]\d{{4}}(?:\s*(?:ext\.?|x)\s*\d{{1,5}})?(?![\d-])", re.I)
RE_SUITE = re.compile(r"\b(?:Suite|Ste\.?)\s*#?\s*\d[\w-]*|\b\d+(?:st|nd|rd|th)\s+(?:Floor|Fl\.?)|(?<![\w#])#\s?\d{2,6}\b", re.I)
RE_PO = re.compile(r"\bP\.?\s?O\.?\s*Box\s+\d+", re.I)
RE_STREET = re.compile(
    rf"(?:#?\s?(?<!\d, )(?<!\d,)\b\d{{1,6}}[A-Z]?|\b(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten))\s+[A-Z0-9](?:(?!\bNo\.|\bOrder\b|\bCounsel\b)[^@\x00]){{2,140}}?,?\s+{STATE},?\s+{ZIP}\b"
)
RE_CITY_ZIP = re.compile(rf"\b[A-Z][a-z]+(?:\s[A-Z][a-z]+){{0,2}},\s*{STATE}\s+{ZIP}\b")
RE_LINE_START = re.compile(r"^\s*(?:\d{1,6}\s+[A-Za-z]|Suite\b|Ste\.?\s|P\.?\s?O\.?\s*Box\b)", re.I)
RE_ORPHAN_LABEL = re.compile(r"\b(?:Phone|Tel(?:ephone)?|Fax|Facsimile|E-?mail|Direct Dial)\s*:|\b(?:Ste\.|Suite|P\.?\s?O\.?\s*Box)(?=\s*(?:\x00|$))", re.I)


def redact(text: str, marker: str | None = None):
    """Return (clean_text, removed). With a marker, each removed span is replaced by it (runs collapse to one)."""
    if not text:
        return text, False
    original = " ".join(text.split())
    out = original
    for pattern in (RE_EMAIL, RE_PHONE, RE_STREET, RE_PO, RE_SUITE, RE_CITY_ZIP, RE_ORPHAN_LABEL):
        out = pattern.sub(f" {MARK} ", out)
    removed = MARK in out
    out = re.sub(rf"{MARK}(?:[\s.,;:()]*{MARK})*", MARK, out)
    out = re.sub(rf"\(\s*{MARK}\s*\)", MARK, out)
    out = out.replace(MARK, f" {marker} " if marker else " ")
    out = re.sub(r"\s+([,;.)])", r"\1", out)
    out = re.sub(r"([.,;])(?:\s*[.,;])+", r"\1", out)
    out = " ".join(out.split()).strip(" ,;")
    return out, removed


def redact_lines(lines):
    """Drop lines that start with a street number / Suite / P.O. Box, redact the rest; drop lines left empty."""
    kept, removed = [], False
    for line in lines:
        if RE_LINE_START.match(line):
            removed = True
            continue
        clean, changed = redact(line)
        removed = removed or changed
        if len(clean.strip(" .,;")) >= 2:
            kept.append(clean)
        else:
            removed = True
    return kept, removed
