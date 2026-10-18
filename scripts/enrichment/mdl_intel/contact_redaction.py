"""Remove counsel contact details from court-page text (owner decision 2026-10-03: counsel shown without contact fields).

Kept: names, firm names, roles exactly as printed. Removed, by explicit pattern only:
  - e-mail addresses (with an optional "Email:" label)
  - NANP phone / fax numbers, e.g. (212) 584-0700, 419-841-9623, 212.584.0700, +1 212 584 0700 (optional label/extension)
  - "Suite / Ste. / P.O. Box / Post Office Box / Nth Floor" fragments, and a unit number printed right after a street
    word and a comma ("Druid Hills Road, #100"); a bare "#22" elsewhere is a document number ("CMO #22", "Doc # 671")
    and stays
  - a contact-field label whose value the page gives as "Not Available" / "N/A" ("Facsimile: Not Available")
  - street addresses: from a street number (or a spelled "One".."Ten") up to the next "State ZIP" (a 4-digit number
    directly after "Month dd," is a date, not a street number)
  - any remaining "City, ST 12345" (also "St. Paul, MN 55101")
  - a short line printed directly above a street / Suite line when it carries a number or ends with a comma (a
    building name: "Terminus 200", "Renaissance at Colony Park,"); when that line is a firm name followed by the
    building ("GREENBERG TRAURIG, LLP Terminus 200") only the building is dropped
  - whole lines that start with a street number, "Suite", "Ste.", "P.O. Box" / "Post Office Box", or a spelled
    number followed by a street name ("One Court Street"); whole lines that are only "City, State" with the state
    spelled out ("Naples, Florida"), or only a contact-field label ("Telephone", "Email", "Name and Address", "Tel.:")
    — counsel blocks are split one line per page element, so an address can span several lines
In sentences (quotes) each removal leaves the marker "[contact removed]" so the edit is visible; in counsel blocks the
contact text is dropped and the block is marked "contact lines removed", except in a sentence that points at the
removed contact ("… may be sent to <e-mail>."), which keeps the marker so it does not read as complete.
"""
import re

MARKER = "[contact removed]"
# What is left of a counsel-block line whose removed contact was the object of the sentence ("… may be sent to.").
RE_DANGLING = re.compile(r"(?:\b(?:to|at|via|or|and|contact|e-?mail|call|reach|write)|:)\s*[.;,]?$", re.I)
# A counsel-block line left holding only a contact-field label once its number/address was removed ("Ph.:", "Ph,:").
RE_LABEL_LEFT = re.compile(
    r"^(?:ph|phone|tel|telephone|fax|telefax|facsimile|e-?mail|cell|mobile|direct(?:\s+dial)?|office|main|address)\s*[.,]?\s*:?\s*[.,;]?$",
    re.I,
)

STATE = r"(?:[A-Z]{2}|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)"
ZIP = r"\d{5}(?:-\d{4})?"
LABEL = r"(?:(?:Phone|Tel(?:ephone|efax)?|Fax|Facsimile|Direct(?: Dial)?|Main|Office|Cell|Mobile)\s*[:;.]?\s*)"
MARK = "\x00"

RE_EMAIL = re.compile(r"(?:E-?mail\s*:?\s*)?(?:mailto:)?[\w.+'-]+@[\w-]+(?:\.[\w-]+)+", re.I)
RE_PHONE = re.compile(rf"{LABEL}?(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{{3}}\)\s?|\d{{3}}[\s./-])\d{{3}}[\s.-]\d{{4}}(?:\s*(?:ext\.?|x)\s*\d{{1,5}})?(?![\d-])", re.I)
# No bare "#NN" alternative: on court pages "#22" is a document number ("CMO #22", "Doc # 671"), not a suite.
RE_SUITE = re.compile(r"\b(?:Suite|Ste\.?)\s*#?\s*\d[\w-]*|\b\d+(?:st|nd|rd|th)\.?\s+(?:Floor|Fl\.?)", re.I)
# A unit number directly after a street word and a comma ("1932 North Druid Hills Road, #100"): group 1 is kept.
RE_UNIT = re.compile(
    r"(\b(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Plaza|Court|Ct|Parkway|Pkwy|Square|Sq|"
    r"Center|Centre|Circle|Highway|Hwy|Terrace)\.?\s?,\s?)#\s?\d{1,6}\b",
    re.I,
)
# A contact-field label whose value the page prints as unavailable ("Facsimile: Not Available").
RE_NA_FIELD = re.compile(r"\b(?:Phone|Tel(?:ephone|efax|\.)?|Fax|Facsimile|E-?mail|Cell|Mobile|Direct Dial)\s*[:;]\s*(?:Not Available|N/A|None)\b\.?", re.I)
RE_PO = re.compile(r"\bP\.?\s?O\.?\s*Box\s+\d+|\bPost\s+Office\s+Box\s+\d+", re.I)
RE_STREET = re.compile(
    rf"(?:#?\s?(?<!\d, )(?<!\d,)\b\d{{1,6}}[A-Z]?|\b(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten))\s+[A-Z0-9](?:(?!\bNo\.|\bOrder\b|\bCounsel\b)[^@\x00]){{2,140}}?,?\s+{STATE},?\s+{ZIP}\b"
)
RE_CITY_ZIP = re.compile(rf"\b(?:(?:St|Mt|Ft|Pt)\.\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+){{0,2}},\s*{STATE}\s+{ZIP}\b")
SPELLED = r"(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)"
STREET_WORD = r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Plaza|Court|Ct|Parkway|Pkwy|Square|Sq|Center|Centre|Circle|Highway|Hwy|Terrace)"
RE_LINE_START = re.compile(
    rf"^\s*(?:\d{{1,6}}\s+(?:[A-Za-z]|\d{{1,3}}\s?(?:st|nd|rd|th)\b)|Suite\b|Ste\.?\s|P\.?\s?O\.?\s*Box\b|Post\s+Office\s+Box\b"
    rf"|(?-i:{SPELLED}\s+(?:[A-Z][\w.'-]*\s+){{0,4}}{STREET_WORD}\b))",
    re.I,
)
FULL_STATE = STATE.replace("[A-Z]{2}|", "")
CITY = r"(?:(?:St|Mt|Ft|Pt)\.\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}"
RE_CITY_STATE_LINE = re.compile(rf"^{CITY},\s*{FULL_STATE}\.?$")  # "Naples, Florida"
RE_CITY_ZIP_LINE = re.compile(rf"^{CITY},?\s*{STATE}\.?\s+\d{{5,6}}(?:-\d{{4}})?$")  # "Irvine CA 92606", "Houston, TX 770606"
RE_PREMISES_LINE = re.compile(r"^(?-i:(?:[A-Z][\w.'&-]*\s+(?:and\s+)?){0,4})(?:Floors?|Bldg\.?|Building|Tower)\.?$", re.I)  # "Third and Fourth Floor"
RE_LABEL_LINE = re.compile(
    r"^(?:name\s+and\s+address|address|telephone|phone|tel\.?|fax|telefax|facsimile|e-?mail(?:\s+address)?)\s*[:;]?"
    r"(?:\s*(?:not available|n/a|none)\.?)?$",
    re.I,
)
RE_ORPHAN_LABEL = re.compile(
    r"\b(?:Phone|Tel(?:ephone|efax|\.)?|Fax|Facsimile|E-?mail|Direct Dial)\s*:|\b(?:Ste\.|Suite|P\.?\s?O\.?\s*Box)(?=\s*(?:\x00|$))"
    r"|\((?:fax|facsimile|phone|tel\.?|telephone|cell|mobile|direct|office|main)\)",
    re.I,
)
# A firm name with its building printed on the same line, directly above the street line ("GREENBERG TRAURIG, LLP
# Terminus 200"): group 1 (the firm, through its entity suffix) is kept.
RE_FIRM_BUILDING = re.compile(
    r"^(.*?\b(?:LLP|L\.L\.P\.|LLC|L\.L\.C\.|PLLC|P\.A\.|P\.C\.|PC|LTD|Ltd\.|Inc\.))[,\s]+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}\s+\d{1,5}$"
)


def redact(text: str, marker: str | None = None):
    """Return (clean_text, removed). With a marker, each removed span is replaced by it (runs collapse to one)."""
    if not text:
        return text, False
    original = " ".join(text.split())
    out = original
    for pattern in (RE_EMAIL, RE_PHONE, RE_STREET, RE_PO, RE_SUITE, RE_UNIT, RE_CITY_ZIP, RE_NA_FIELD, RE_ORPHAN_LABEL):
        out = pattern.sub(lambda m: (m.group(1) if pattern is RE_UNIT else "") + f" {MARK} ", out)
    removed = MARK in out
    out = re.sub(rf"{MARK}(?:[\s.,;:()]*{MARK})*", MARK, out)
    out = re.sub(rf"\(\s*{MARK}\s*\)", MARK, out)
    out = out.replace(MARK, f" {marker} " if marker else " ")
    out = re.sub(r"\s+([,;.)])", r"\1", out)
    out = re.sub(r"([.,;])(?:\s*[.,;])+", r"\1", out)
    out = " ".join(out.split()).strip(" ,;")
    return out, removed


def redact_lines(lines):
    """Drop lines that start with a street number / Suite / P.O. Box (or a spelled street number), lines that are only
    'City, State' or a contact-field label, redact the rest; drop lines left empty. A line left ending on a word that
    introduced the removed contact ('sent to', 'contact', 'Email:') is redacted with the visible MARKER instead."""
    kept, removed = [], False
    bares = [" ".join(line.split()) for line in lines]
    for i, line in enumerate(lines):
        bare = bares[i]
        next_is_street = i + 1 < len(bares) and bool(RE_LINE_START.match(bares[i + 1]))
        firm = RE_FIRM_BUILDING.match(bare) if next_is_street and not RE_LINE_START.match(bare) else None
        if firm:
            line, bare, removed = firm.group(1), firm.group(1), True  # the firm stays; the building after it is address
        if (RE_LINE_START.match(bare) or RE_CITY_STATE_LINE.match(bare) or RE_CITY_ZIP_LINE.match(bare) or RE_LABEL_LINE.match(bare)
                or RE_PREMISES_LINE.match(bare) or (next_is_street and len(bare) <= 40 and (re.search(r"\d", bare) or bare.endswith(",")))):
            removed = True  # the last rule: a building printed above its street line ("Terminus 200", "Renaissance at Colony Park,")
            continue
        clean, changed = redact(line)
        if changed and RE_LABEL_LEFT.match(clean.strip()):
            removed = True  # nothing left but the label of the removed contact field
            continue
        if changed and RE_DANGLING.search(clean):
            clean = redact(line, marker=MARKER)[0]
        removed = removed or changed
        if len(clean.strip(" .,;")) >= 2:
            kept.append(clean)
        else:
            removed = True
    return kept, removed
