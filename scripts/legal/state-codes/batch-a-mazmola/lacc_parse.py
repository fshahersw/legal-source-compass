"""Parse retained legis.la.gov LawPrint.aspx pages of the Louisiana Civil Code (no network).

Every rule below comes from the text the publisher prints on the captured pages:
  * LabelName is the document label ("CC 681", "CC 2315.1"); it is the citation path.
  * The first article of a unit prints the structural headings that apply to it (PRELIMINARY TITLE, BOOK I., TITLE II -- DOMICILE,
    CHAPTER 2. ..., SECTION 1--...). Later articles omit them, so the headings in force carry over in table-of-contents order and a
    deeper heading is dropped when a shallower one prints.
  * A heading's words can continue on following lines ("BOOK I." then "OF PERSONS").
  * The article line is "Art. N. Heading" ("Art 681." and "§118." also occur). When the article has no body, the printed words after
    the number are the whole article (for example "Repealed by Acts 2001, No. 572, §2."); they become the text and the status note.
  * Trailing "Acts ...", "Amended by ...", "Added by ..." and "Source:" lines are the history.
  * "NOTE: ..." lines before the article line are the publisher's note about it and are kept as the status note.
Nothing is guessed: a line this module cannot place raises, so the capture is never silently reshaped.
"""
import re

from bs4 import BeautifulSoup

NBSP = re.compile(r'[\u00a0\u2002\u2003\u2009]')
WS = re.compile(r'[ \t\r\n\f\v]+')
HISTORY = re.compile(r'^(Acts\s+\d{4}|Amended by|Added by|Amended and reenacted|Enacted by|Redesignated|Repealed by Acts|Reenacted|'
                     r'Re-enacted|Source:|Formerly|Transferred by|Renumbered|Amended and renumbered|Acts\s)')
HEADER = re.compile(r'^(PRELIMINARY TITLE|BOOK|SUBTITLE|TITLE|CHAPTER|SECTION|SUBSECTION|PART|SUBPART)\b'
                    r'(?:\s+([IVXLCDM]+|[0-9]+(?:-[A-Z])?|[A-Z])(?![A-Za-z]))?\s*(?:\.|--|-|\u2013|\u2014)?\s*(.*)$', re.I)
SECTION_SIGN_HEADER = re.compile(r'^§\s*([0-9]+(?:-[A-Z])?)\s*(?:--|\u2013|\u2014|-|\.)\s*(.+)$')
ARTICLE = re.compile(r'^Art\.?\s*([0-9]+(?:\.[0-9]+)?(?:-[A-Z])?)\s*\.?\s*(.*)$')
SIGN_ARTICLE = re.compile(r'^§\s*([0-9]+(?:\.[0-9]+)?(?:-[A-Z])?)\.\s*(.*)$')
LEVEL = {'BOOK': ('book', 0), 'PRELIMINARY TITLE': ('title', 1), 'TITLE': ('title', 1), 'SUBTITLE': ('subtitle', 2),
         'CHAPTER': ('chapter', 3), 'SECTION': ('section_group', 4), 'SUBSECTION': ('subsection_group', 5),
         'PART': ('part', 4), 'SUBPART': ('subpart', 5)}
LABEL = re.compile(r'^CC ([0-9]+(?:\.[0-9]+)?(?:-[A-Z])?)$')


def clean(s):
    return WS.sub(' ', NBSP.sub(' ', s)).strip()


def page_lines(html):
    soup = BeautifulSoup(html, 'html.parser')
    name, doc = soup.find(id='LabelName'), soup.find(id='LabelDocument')
    if name is None or doc is None:
        raise ValueError('not a LawPrint page')
    lines = []
    for p in doc.find_all('p'):
        for part in re.split(r'<br\s*/?>', p.decode_contents(), flags=re.I):
            t = clean(BeautifulSoup(part, 'html.parser').get_text(' '))
            if t:
                lines.append(t)
    return clean(name.get_text(' ')), lines


def parse_page(html):
    """-> dict(label, path, headers=[[level, rank, number, heading]], notes, art_no, heading, body, history, repeal_only)."""
    label, lines = page_lines(html)
    m = LABEL.match(label)
    if not m:
        raise ValueError('unexpected label %r' % label)
    article = ARTICLE
    idx = next((i for i, x in enumerate(lines) if ARTICLE.match(x)), None)
    if idx is None:
        article = SIGN_ARTICLE
        idx = next((i for i, x in enumerate(lines) if SIGN_ARTICLE.match(x)), None)
    if idx is None:
        raise ValueError('no article line on %s' % label)
    headers, notes = [], []
    for ln in lines[:idx]:
        if ln.startswith('NOTE:'):
            notes.append(ln)
            continue
        ms = SECTION_SIGN_HEADER.match(ln)
        if ms:
            headers.append(['section_group', 4, ms.group(1), ms.group(2).strip()])
            continue
        mh = HEADER.match(ln)
        if mh:
            kind = mh.group(1).upper()
        if mh and kind in LEVEL and not (kind != 'PRELIMINARY TITLE' and mh.group(2) is None):
            level, rank = LEVEL[kind]
            number = 'Preliminary' if kind == 'PRELIMINARY TITLE' else mh.group(2)
            headers.append([level, rank, number, (mh.group(3) or '').strip()])
        elif headers:
            headers[-1][3] = (headers[-1][3] + ' ' + ln).strip()
        else:
            raise ValueError('unplaced line before article %s: %r' % (label, ln[:80]))
    ma = article.match(lines[idx])
    art_no, heading = ma.group(1), ma.group(2).strip()
    if art_no != m.group(1):
        raise ValueError('article number %s differs from label %s' % (art_no, label))
    rest = lines[idx + 1:]
    start = len(rest)
    while start > 0 and HISTORY.match(rest[start - 1]):
        start -= 1
    body, history = rest[:start], rest[start:]
    return {'label': label, 'path': m.group(1), 'headers': headers, 'notes': notes, 'art_no': art_no,
            'heading': heading or None, 'body': body, 'history': history, 'article_line': lines[idx]}


def article_record(page):
    """Text, heading, status note, history for one parsed page. A page with no body keeps its printed words as text."""
    status = ' '.join(page['notes']) or None
    if page['body']:
        text, heading = '\n'.join(page['body']), page['heading']
    else:
        text, heading = page['heading'], None
        if not text:
            raise ValueError('article %s prints no words after its number' % page['label'])
        status = ('%s %s' % (status, text)).strip() if status else text
    history = '\n'.join(page['history']) or None
    return {'text': text, 'heading': heading, 'status_note': status, 'history': history}


def apply_headers(state, headers):
    """Carry the headings in force: a printed heading replaces everything at its rank or deeper."""
    for level, rank, number, heading in headers:
        state = [s for s in state if s[1] < rank]
        state.append((level, rank, number, heading))
    return state
