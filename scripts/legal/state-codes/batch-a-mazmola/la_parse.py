"""Parse retained legis.la.gov LawPrint.aspx pages (no network)."""
import re

from bs4 import BeautifulSoup

NBSP = re.compile(r'[\u00a0\u2002\u2003\u2009]')
WS = re.compile(r'[ \t\r\n\f\v]+')
LEVEL_RANK = {'TITLE': 0, 'SUBTITLE': 1, 'CHAPTER': 2, 'SUBCHAPTER': 3, 'PART': 4, 'SUBPART': 5, 'ARTICLE': 6,
              'SUBARTICLE': 7}
HEADER_RE = re.compile(r'^(TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|ARTICLE|SUBARTICLE)\s+([0-9A-Za-z.\-]+?)\.?(?:\s+(.*))?$')
SECTION_LINE = re.compile(r'^§\s*([^\s]+?)\.?(?:\s+(.*))?$')
HISTORY_RE = re.compile(r'^(Acts\s+\d{4}|Amended by|Added by|Amended and reenacted|Enacted by|Redesignated|Repealed by|'
                        r'Reenacted|Re-enacted|Source:|Formerly|Transferred by|Renumbered|Amended and renumbered)')


def clean(s):
    return WS.sub(' ', NBSP.sub(' ', s)).strip()


def parse_page(html):
    soup = BeautifulSoup(html, 'html.parser')
    name = soup.find(id='LabelName')
    doc = soup.find(id='LabelDocument')
    if name is None or doc is None:
        raise ValueError('not a LawPrint page')
    label = clean(name.get_text(' '))
    lines = []
    for p in doc.find_all('p'):
        for part in re.split(r'<br\s*/?>', p.decode_contents(), flags=re.I):
            t = clean(BeautifulSoup(part, 'html.parser').get_text(' '))
            lines.append(t)
    return label, lines


def split_page(label, lines):
    """-> dict(kind='title'|'section', header=[(KEY, number, heading)], sec_no, heading, body, history, lines)."""
    nonblank = [ln for ln in lines if ln]
    idx = next((i for i, ln in enumerate(nonblank) if ln.startswith('§')), None)
    if idx is None:
        return {'kind': 'other', 'lines': nonblank}
    header_lines = nonblank[:idx]
    m = SECTION_LINE.match(nonblank[idx])
    sec_no, heading = m.group(1), (m.group(2) or '').strip() or None
    rest = nonblank[idx + 1:]
    hist_start = len(rest)
    while hist_start > 0 and HISTORY_RE.match(rest[hist_start - 1]):
        hist_start -= 1
    body = rest[:hist_start]
    history = rest[hist_start:]
    header = []
    for ln in header_lines:
        if ln == 'LOUISIANA REVISED STATUTES':
            continue
        mh = HEADER_RE.match(ln)
        if mh and mh.group(1) in LEVEL_RANK and (mh.group(1) != 'PART' or True):
            header.append([mh.group(1), mh.group(2), (mh.group(3) or '').strip()])
        elif header:
            header[-1][2] = (header[-1][2] + ' ' + ln).strip()
        else:
            header.append(['?', None, ln])
    return {'kind': 'section', 'header': header, 'sec_no': sec_no, 'heading': heading, 'body': body,
            'history': history, 'section_line': nonblank[idx], 'lines': nonblank, 'header_lines': header_lines}
