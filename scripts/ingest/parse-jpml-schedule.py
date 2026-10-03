#!/usr/bin/env python
"""Parse a JPML order / conditional transfer order PDF and emit its schedule rows as JSON (stdout).

Evidence parser for the Seeger Weiss matter registry (contract sw-matter-registry/1).
It never infers: every row is a literal row of the document's schedule; rows carry the page and row
ordinal so the evidence can be re-checked against the PDF. Output also records the document sha256.

Usage: python parse-jpml-schedule.py <file.pdf> [--source-url URL]

Formats handled
  A  prose "SCHEDULE A": district heading lines ("Southern District of Alabama") then
     "CAPTION, C.A. No. 1:22-00268" (caption may wrap onto the previous line)
  B  CTO table "SCHEDULE CTO-N - TAG-ALONG ACTIONS": rows "<DIST> <DIV> <YY-NNNNN> <caption>" (DIST = JPML district code)
"""
import hashlib
import json
import re
import sys

import fitz  # PyMuPDF

HY = re.compile('[‐-―−�­]')
# Some JPML PDFs encode the hyphen with an unmapped glyph (seen as U+FFFD, U+00ED ...): accept any 0-2 non-digit,
# non-space, non-colon characters between the two digit groups of a civil action number.
SEQ = r'(\d{1,2}):(\d{2})\s*[^\d\s:]{0,2}\s*(\d{3,6})'
DIRS = {'northern': 'N', 'southern': 'S', 'eastern': 'E', 'western': 'W', 'middle': 'M', 'central': 'C'}
STATE_CODE = {
    'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar', 'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de',
    'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id', 'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks', 'kentucky': 'ky',
    'louisiana': 'la', 'maine': 'me', 'maryland': 'md', 'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms', 'missouri': 'mo',
    'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc',
    'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok', 'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd',
    'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut', 'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv', 'wisconsin': 'wi', 'wyoming': 'wy',
}
SPECIAL = {'district of columbia': 'dcd', 'district of puerto rico': 'prd', 'district of the virgin islands': 'vid', 'district of guam': 'gud',
           'district of the northern mariana islands': 'nmid', 'district of north dakota': 'ndd'}


def heading_to_court(h):
    s = re.sub(r'\s+', ' ', h.strip().lower())
    if s in SPECIAL:
        return SPECIAL[s]
    m = re.match(r'^(northern|southern|eastern|western|middle|central) district of (.+)$', s)
    if m and m.group(2) in STATE_CODE:
        return STATE_CODE[m.group(2)] + DIRS[m.group(1)].lower() + 'd'
    m = re.match(r'^district of (.+)$', s)
    if m and m.group(1) in STATE_CODE:
        return STATE_CODE[m.group(1)] + 'd'
    return None


VALID_COURTS = set('''akd almd alnd alsd ared arwd azd cacd caed cand casd cod ctd dcd ded flmd flnd flsd gamd gand gasd gud hid iand iasd idd ilcd ilnd ilsd
innd insd ksd kyed kywd laed lamd lawd mad mdd med mied miwd mnd moed mowd msnd mssd mtd nced ncmd ncwd ndd ned nhd njd nmd nmid nvd nyed nynd nysd nywd
ohnd ohsd oked oknd okwd ord paed pamd pawd prd rid scd sdd tned tnmd tnwd txed txnd txsd txwd utd vaed vawd vid vtd waed wawd wied wiwd wvnd wvsd wyd'''.split())


def valid_code(code):
    c = code.lower()
    return (c + 'd') in VALID_COURTS or c == 'mp'


def code_to_court(code):
    # JPML CM/ECF district codes: state(2) + optional direction letter -> CourtListener id = lower(code) + 'd' (MP is the exception)
    c = code.lower()
    if c == 'mp':
        return 'nmid'
    return c + 'd'


def year4(yy):
    y = int(yy)
    return 2000 + y if y < 70 else 1900 + y


def page_lines(page):
    words = page.get_text('words')
    rows = {}
    for x0, y0, x1, y1, w, b, l, n in words:
        rows.setdefault(round((y0 + y1) / 2 / 3), []).append((x0, x1, w))
    out = []
    for key in sorted(rows):
        items = sorted(rows[key])
        line, last_end = '', None
        for x0, x1, w in items:
            if last_end is not None and x0 - last_end > 14:
                line += '  |  '
            elif line:
                line += ' '
            line += HY.sub('-', w)
            last_end = x1
        out.append(line)
    return out


def classify(text):
    """Classify by the document's own title lines (the opinion body of a transfer order also mentions CTOs)."""
    lines = [re.sub(r'\s+', ' ', l).strip().upper() for l in text.split('\n')]
    title = [l for l in lines if l and not l.startswith('CASE ') and 'DOCUMENT' not in l[:40]][:40]
    joined = '\n'.join(title)
    if re.search(r'^(ORDER )?DENYING TRANSFER|^ORDER DENYING (TRANSFER|MOTIONS? TO TRANSFER)|ORDER DENYING TRANSFER', joined, re.M):
        return 'order_denying_transfer'
    if re.search(r'^ORDER (VACATING|LIFTING STAY|VACATING CONDITIONAL TRANSFER)|VACATING CONDITIONAL TRANSFER ORDER', joined, re.M):
        return 'order_vacating_cto'
    if re.search(r'^CONDITIONAL TRANSFER ORDER\s*\(?CTO', joined, re.M) or re.search(r'CONDITIONAL TRANSFER ORDER\s*\(CTO', joined):
        return 'cto'
    if re.search(r'^(TRANSFER ORDER|ORDER OF TRANSFER)\s*$', joined, re.M) or re.search(r'^(TAG-ALONG )?TRANSFER ORDER', joined, re.M):
        return 'transfer_order'
    if 'ORDER' in joined:
        return 'other_order'
    return 'unknown'


def main():
    path = sys.argv[1]
    source_url = sys.argv[sys.argv.index('--source-url') + 1] if '--source-url' in sys.argv else None
    retrieved_at = sys.argv[sys.argv.index('--retrieved-at') + 1] if '--retrieved-at' in sys.argv else None
    doc_date = sys.argv[sys.argv.index('--doc-date') + 1] if '--doc-date' in sys.argv else None
    data = open(path, 'rb').read()
    sha = hashlib.sha256(data).hexdigest()
    doc = fitz.open(path)
    pages = [page_lines(p) for p in doc]
    first = '\n'.join(pages[0]) if pages else ''
    m = re.search(r'MDL\s*(?:No\.?|Nos\.?)?\s*(\d{1,4})', first, re.I)
    mdl = int(m.group(1)) if m else None
    if doc_date is None:
        md = re.search(r'Filed\s+(\d{2})/(\d{2})/(\d{2})', first)
        if md:
            doc_date = f'{year4(md.group(3))}-{md.group(1)}-{md.group(2)}'
    doc_type = classify(first[:2500])
    cto_no = None
    m2 = re.search(r'CTO\s*[^\d\s]{0,2}\s*(\d+)', first, re.I) or re.search(r'CTO\s*[^\d\s]{0,2}\s*(\d+)', '\n'.join('\n'.join(p) for p in pages), re.I)
    if m2:
        cto_no = int(m2.group(1))
    rows, notes = [], []
    ordinal = 0
    in_schedule = False
    heading = None
    pending_caption = []
    last_row = None
    for pno, lines in enumerate(pages, start=1):
        for raw in lines:
            line = raw.replace('  |  ', '  ').strip()
            if not line:
                continue
            up = line.upper()
            if re.search(r'SCHEDULE\s*(A|CTO)', up) or ('DIST' in up and 'C.A.NO' in up.replace(' ', '')):
                in_schedule = True
                if 'DIST' in up and 'C.A.NO' in up.replace(' ', ''):
                    continue
                if 'SCHEDULE' in up:
                    continue
            if not in_schedule and not re.search(r'C\.A\.\s*No', line, re.I):
                continue
            # Format B: table row
            # Format B row; older CTOs prefix the row with a transferor cross reference ("17-cv-8269 L(5)  ILN  1  17-05796  caption"),
            # so search from any token boundary but require a valid JPML district code.
            mb = re.search(r'(?:^|\s)([A-Z]{2,3})\s+(\d{1,2})\s+(\d{2})\s*[^\d\s]{0,2}\s*(\d{3,6})\b\s*(.*)$', line)
            if mb and valid_code(mb.group(1)) and mb.group(1) not in ('MDL', 'DIV', 'THE'):
                ordinal += 1
                code, div, yy, seq, cap = mb.groups()
                row = {'ordinal': ordinal, 'page': pno, 'format': 'B', 'district_code': code, 'court_id': code_to_court(code), 'division': div, 'year2': yy,
                       'seq': seq, 'caption': cap.strip(), 'docket_number_as_printed': f'{div}:{yy}-{seq}'}
                rows.append(row)
                last_row = row
                pending_caption = []
                continue
            # Format A: "... C.A. No. 1:22-00268"
            ma = re.search(r'C\.A\.\s*No\.?\s*' + SEQ, line, re.I)
            if ma:
                ordinal += 1
                div, yy, seq = ma.groups()
                cap = (' '.join(pending_caption) + ' ' + line[:ma.start()]).strip(' ,')
                row = {'ordinal': ordinal, 'page': pno, 'format': 'A', 'district_heading': heading, 'court_id': heading_to_court(heading) if heading else None,
                       'division': div, 'year2': yy, 'seq': seq, 'caption': cap, 'docket_number_as_printed': f'{div}:{yy}-{seq}'}
                rows.append(row)
                last_row = row
                pending_caption = []
                continue
            mh = re.match(r'^((?:Northern|Southern|Eastern|Western|Middle|Central)\s+)?District of [A-Za-z .]+$', line.strip())
            if mh and heading_to_court(line.strip()):
                heading = line.strip()
                pending_caption = []
                continue
            # state/district heading in table format (all caps, no digits) -> ignore
            if re.match(r'^[A-Z ]{4,40}$', line) and not re.search(r'\d', line):
                pending_caption = []
                continue
            # continuation lines: wrapped caption (format A) or caption continuation (format B)
            if last_row is not None and last_row['format'] == 'B' and not re.match(r'^[A-Z]{2,3}\s+\d', line):
                last_row['caption'] = (last_row['caption'] + ' ' + line).strip()
            else:
                pending_caption.append(line)
    garbled = sum(1 for p in pages for l in p if re.search(r'&\s*\$\s*1R', l))
    if garbled:
        notes.append(f'{garbled} schedule line(s) use a font-encoded "C.A. No." whose digits are absent from the text layer; those rows are not parsed (no OCR available)')
    for r in rows:
        r['year'] = year4(r['year2'])
        r['docket_key'] = (f"{r['court_id']}:{r['division']}:{r['year']}-cv-{int(r['seq']):05d}" if r['court_id'] else None)
        r['docket_key_type_basis'] = 'jpml_schedule_civil_action_convention'
        r['unresolved_court'] = r['court_id'] is None
    result = {'schema_version': 'jpml-schedule-parse/1', 'file': path.replace('\\', '/'), 'file_sha256': sha, 'bytes': len(data), 'pages': len(pages), 'source_url': source_url, 'retrieved_at': retrieved_at, 'doc_date': doc_date,
              'mdl_no': mdl, 'doc_type': doc_type, 'cto_no': cto_no, 'row_count': len(rows), 'rows': rows, 'notes': notes}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
