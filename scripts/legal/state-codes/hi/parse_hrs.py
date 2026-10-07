"""Parse Hawaii Revised Statutes HTML captured from data.capitol.hawaii.gov.

Parser hi-hrs-html/1. One section file is one section. Chapter index HTML
(HRS_####-.htm and instrument indexes) is the official inventory, read
separately from section bodies. History notes in brackets ([L 1972, c 9, ...])
are copied out of the operative text. Repealed and reserved placeholders are
kept.
"""
import hashlib
import json
import re
from pathlib import Path

PARSER = 'hi-hrs-html/2'
CODE_ID = 'hi-hrs'
CODE_NAME = 'Hawaii Revised Statutes'
EDITION = 'Hawaii Revised Statutes 2025'
CURRENCY = {'statement': EDITION, 'as_of': None}
NOTE_CLASSES = {'XNotes', 'XNotesHeading'}
STATUS_WORD = re.compile(
    r'^(REPEALED|Repealed|RESERVED|Reserved|RENUMBERED|Renumbered|EXPIRED|Expired|'
    r'OMITTED|Omitted|TRANSFERRED|Transferred|REDESIGNATED|Redesignated)\b\.?'
)
HRS_CITE = re.compile(r'^(\d+[A-Za-z]?(?::[0-9A-Za-z]+)?-\d+(?:\.\d+)*)\s*(.*)$')
BARE_CITE = re.compile(r'^(\d+(?:\.\d+)*)\s+(.*)$')
PART_LINE = re.compile(r'^(Part|PART|Subpart|SUBPART)\s+(\S+)\.?\s*(.*)$')
ARTICLE_LINE = re.compile(r'^Article\s+([IVXLC]+|\d+)\.?\s*(.*)$')
DIVISION_LINE = re.compile(r'^DIVISION\s+(\S+)\s*(.*)$')
TITLE_LINE = re.compile(r'^TITLE\s+(\S+)\s*(.*)$')
SUBTITLE_LINE = re.compile(r'^Subtitle\s+(\S+)\s*(.*)$', re.I)
CHAPTER_LINE = re.compile(r'^CHAPTER\s+(\S+)$')
SOURCE_TAIL = re.compile(r'\s*(\[[^\[\]]+\])\s*$')
UNBRACKETED_REPEAL = re.compile(
    r'^(.*?\b(REPEALED|Repealed|RESERVED|Reserved))\.\s+((?:L|RL|SLH)\b.+)$',
    re.S,
)
ROMAN = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100}


def roman_to_int(text):
    if text.isdigit():
        return int(text)
    total = 0
    prev = 0
    for ch in reversed(text.upper()):
        val = ROMAN[ch]
        if val < prev:
            total -= val
        else:
            total += val
            prev = val
    return total


def collapse(text):
    return ' '.join(text.replace('\xa0', ' ').split())


def paragraphs(html):
    from bs4 import BeautifulSoup
    if isinstance(html, (bytes, bytearray)):
        html = html.decode('utf-8-sig', 'replace')
    soup = BeautifulSoup(html, 'lxml')
    root = soup.find(class_='WordSection1') or soup.body or soup
    rows = []
    for para in root.find_all('p'):
        classes = para.get('class') or []
        # '' separator: Word splits a catchline across bold tags (<b>§1</b>-<b>17</b>)
        # and a space separator would invent a gap that is not in the published line.
        text = collapse(para.get_text(''))
        bolds = [collapse(b.get_text('')) for b in para.find_all('b')]
        bolds = [b for b in bolds if b]
        if not text and not bolds:
            continue
        rows.append({'class': classes, 'text': text, 'bolds': bolds})
    return rows


def is_index_name(name):
    stem = name[:-4] if name.lower().endswith('.htm') else name
    return stem.endswith('-') or stem.endswith('_')


def strip_num(token):
    if '_' in token:
        return '.'.join(strip_num(part) for part in token.split('_'))
    match = re.fullmatch(r'0*(\d+)([A-Za-z]*)', token)
    if not match:
        return token
    return match.group(1) + match.group(2)


def file_key(name):
    """Match key for a section filename. None for index files."""
    if not name.lower().endswith('.htm') or is_index_name(name):
        return None
    stem = name[:-4]
    match = re.fullmatch(r'USCON_AM-(\d+)(?:-(\d+(?:_\d+)*))?$', stem)
    if match:
        section = strip_num(match.group(2)) if match.group(2) else ''
        return {'instrument': 'USCON_AM', 'article': int(match.group(1)),
                'section': section, 'cite': section or str(int(match.group(1)))}
    match = re.fullmatch(r'(HRS|CONST|USCON|ORG|ADM|HNP|HHCA)_(.+)$', stem)
    if not match:
        return {'instrument': None, 'cite': stem, 'section': stem, 'article': None}
    instrument, rest = match.group(1), match.group(2)
    parts = [strip_num(part) for part in rest.split('-')]
    if instrument in ('CONST', 'USCON') and len(parts) >= 2:
        return {'instrument': instrument, 'article': int(parts[0]), 'section': parts[1],
                'cite': '-'.join(parts)}
    if instrument == 'HRS':
        return {'instrument': 'HRS', 'article': None, 'section': '-'.join(parts),
                'cite': '-'.join(parts).replace(':', '-')}
    return {'instrument': instrument, 'article': None, 'section': '-'.join(parts),
            'cite': '-'.join(parts)}


def toc_match_key(instrument, article_number, cite):
    if instrument in ('CONST', 'USCON', 'USCON_AM') and article_number is not None:
        # cite is the bare section number printed under the article
        return (instrument, article_number, str(cite))
    return (instrument or 'HRS', None, str(cite).replace(':', '-'))


def file_match_key(key):
    if key is None:
        return None
    if key['instrument'] in ('CONST', 'USCON', 'USCON_AM'):
        return (key['instrument'], key['article'], str(key['section']))
    return (key['instrument'] or 'HRS', None, str(key.get('cite') or key.get('section')).replace(':', '-'))


def looks_like_source(note):
    inner = note[1:-1]
    if not re.search(r'\b(L|RL|SLH|am|cc|ren|repealed|imp)\b', inner, re.I):
        return False
    return bool(re.search(r'(§|\bc\s|\bRL\b|\bSLH\b)', inner))


def split_history(statutory_paragraphs):
    """Return (text, history, status_from_repeal_line). History keeps the brackets."""
    if not statutory_paragraphs:
        return '', None, None
    paras = list(statutory_paragraphs)
    last = paras[-1]
    status = None
    match = SOURCE_TAIL.search(last)
    if match and looks_like_source(match.group(1)):
        history = match.group(1)
        last = SOURCE_TAIL.sub('', last).strip()
        paras[-1] = last
        text = '\n'.join(p for p in paras if p)
        return text, history, status
    match = UNBRACKETED_REPEAL.match(last.strip())
    if match:
        status = match.group(2)
        paras[-1] = match.group(1).strip() + '.'
        history = match.group(3).strip()
        text = '\n'.join(p for p in paras if p)
        return text, history, status
    return '\n'.join(p for p in paras if p), None, None


def status_of(heading, text, explicit):
    if explicit:
        return explicit
    for candidate in (heading or '', text or ''):
        match = STATUS_WORD.match(candidate.strip())
        if match:
            return match.group(1)
    return None


def effective_of(history):
    if not history:
        return None
    match = re.search(r';\s*((?:eff(?:ective)?)\.?\s+[^;\]]+)', history, re.I)
    if match:
        return match.group(1).strip()
    return None


def annotation_text(blocks):
    parts = []
    for block in blocks:
        if block['heading']:
            parts.append(block['heading'])
        parts.extend(block['lines'])
    return '\n'.join(parts) if parts else None


def split_notes(rows):
    statutory = []
    section_bold = None
    chapter_bold = None
    annotations = []
    for row in rows:
        classes = set(row['class'])
        if 'XNotesHeading' in classes or 'XNotes' in classes:
            if 'XNotesHeading' in classes:
                annotations.append({'heading': row['text'], 'lines': []})
            else:
                if not annotations:
                    annotations.append({'heading': None, 'lines': []})
                if row['text']:
                    annotations[-1]['lines'].append(row['text'])
            continue
        if row['text']:
            statutory.append(row['text'])
        for bold in row['bolds']:
            if section_bold is None and (bold.startswith('§') or bold.startswith('Section ')):
                section_bold = bold
            elif chapter_bold is None and bold.startswith('CHAPTER '):
                chapter_bold = bold
    return statutory, section_bold or chapter_bold, annotations


# Hyphenated HRS forms (§1-17, §1-13.5, §431:10C-103) and the bracketed
# supplement form ([§1-13.7]). Organic Act / park acts use §1. with a period.
LEAD = re.compile(
    r'^(?:\[\s*)?'
    r'(§\s*\d+[A-Za-z]?(?::\d+[A-Za-z]?)?(?:-\d+[A-Za-z]?(?:\.\d+)*)+'
    r'|§\s*\d+[A-Za-z]?\.'
    r'|Section\s+\d+\.)'
    r'\s*\]?\s*'
    r'(.*)$'
)


def split_lead(paragraph, bolds=()):
    """Return citation, heading, remainder-of-paragraph. None if this paragraph is not a catchline."""
    match = LEAD.match(paragraph)
    if not match:
        return None
    citation = collapse(match.group(1))
    rest = match.group(2).strip()
    if citation.startswith('Section'):
        return citation, None, rest
    if re.fullmatch(r'§\s*\d+[A-Za-z]?\.', citation):
        for bold in bolds:
            if bold.startswith(citation) and bold != citation:
                extra = bold[len(citation):].strip()
                after = paragraph[len(citation):].strip() if paragraph.startswith(citation) else rest
                if extra and after.startswith(extra):
                    return citation, extra, after[len(extra):].strip()
        return citation, None, rest
    if rest.startswith('['):
        close = rest.find('.] ')
        if close >= 0:
            heading = rest[: close + 2]
            body = rest[close + 3 :].strip()
            return citation, heading or None, body
    dot = rest.find('. ')
    if dot >= 0:
        heading = rest[:dot + 1]
        body = rest[dot + 2:].strip()
    elif rest.endswith('.'):
        heading = rest
        body = ''
    else:
        heading = rest or None
        body = ''
    return citation, heading or None, body


def parse_catchline(bold):
    if not bold:
        return None, None, bold
    if bold.startswith('§'):
        match = re.match(r'^(§\s*[0-9A-Za-z][0-9A-Za-z:.\-]*)\s*(.*)$', bold)
        if not match:
            return None, None, bold
        return collapse(match.group(1)), match.group(2).strip() or None, bold
    match = re.match(r'^(Section\s+[0-9]+)\.\s*(.*)$', bold)
    if match:
        heading = match.group(2).strip() or None
        return match.group(1) + '.', heading, bold
    return None, None, bold


def parse_section_html(html, name):
    rows = paragraphs(html)
    statutory, bold, annotations = split_notes(rows)
    citation = None
    heading = None
    statute_rows = [row for row in rows if 'XNotes' not in row['class'] and 'XNotesHeading' not in row['class'] and row['text']]
    for index, row in enumerate(statute_rows):
        lead = split_lead(row['text'], row['bolds'])
        if not lead:
            continue
        citation, heading, body = lead
        statute_rows[index] = dict(row, text=body)
        statutory = [item['text'] for item in statute_rows if item['text']]
        break
    text, history, repeal_status = split_history(statutory)
    if heading is None and bold and bold.startswith('CHAPTER '):
        # repealed-chapter (or other) index page kept as a unit
        heading = next((p for p in statutory if p != bold and not STATUS_WORD.match(p)), None)
    status = status_of(heading, text, repeal_status)
    return {
        'name': name,
        'citation': citation,
        'heading': heading,
        'catchline': citation if citation and citation.startswith('§') else None,
        'text': text,
        'history': history,
        'status_label': status,
        'effective': effective_of(history),
        'annotations': annotation_text(annotations),
    }


def _new_section(cite, heading, ctx):
    return {
        'cite': cite,
        'heading': heading or '',
        'part': ctx.get('part'),
        'part_heading': ctx.get('part_heading'),
        'article': ctx.get('article'),
        'article_heading': ctx.get('article_heading'),
        'article_number': ctx.get('article_number'),
        'chapter': ctx.get('chapter'),
        'chapter_heading': ctx.get('chapter_heading'),
    }


def parse_index(html, name):
    """Official contents of one index HTML file."""
    rows = paragraphs(html)
    statutory = [row['text'] for row in rows if not (set(row['class']) & NOTE_CLASSES) and row['text']]
    instrument = 'HRS'
    if name.startswith('CONST'):
        instrument = 'CONST'
    elif name.startswith('USCON_AM') or name.startswith('USCON'):
        instrument = 'USCON_AM' if name.startswith('USCON_AM') else 'USCON'
    elif name.startswith('HHCA'):
        instrument = 'HHCA'
    elif name.startswith('ORG'):
        instrument = 'ORG'
    elif name.startswith('ADM'):
        instrument = 'ADM'
    elif name.startswith('HNP'):
        instrument = 'HNP'
    # HRS section lines always contain a hyphen (1-13.5). The other instruments
    # printed in the HRS volumes number sections as bare numbers (1, 201.5).
    bare = instrument != 'HRS'
    ctx = {
        'division': None, 'division_heading': None,
        'title': None, 'title_heading': None,
        'subtitle': None, 'subtitle_heading': None,
        'chapter': None, 'chapter_heading': None,
        'chapter_status': None, 'chapter_history': None,
        'part': None, 'part_heading': None,
        'article': None, 'article_heading': None, 'article_number': None,
    }
    sections = []
    current = None
    mode = 'front'
    embedded = None
    embedded_units = []
    unclassified = []
    hierarchy = []

    def close_embedded():
        nonlocal embedded
        if embedded and (embedded['heading'] or embedded['lines']):
            embedded_units.append(embedded)
        embedded = None

    for line in statutory:
        if embedded is not None:
            if line.isupper() and len(line) > 8 and line != embedded['heading']:
                close_embedded()
                embedded = {'heading': line, 'lines': []}
            else:
                embedded['lines'].append(line)
            continue
        if line in ('PREAMBLE', 'FEDERAL CONSTITUTION ADOPTED') and sections:
            if current:
                sections.append(current)
                current = None
            embedded = {'heading': line, 'lines': []}
            mode = 'embedded'
            continue
        div = DIVISION_LINE.match(line)
        title = TITLE_LINE.match(line)
        subtitle = SUBTITLE_LINE.match(line)
        chapter = CHAPTER_LINE.match(line)
        article = ARTICLE_LINE.match(line)
        part = PART_LINE.match(line)
        if div:
            if current:
                sections.append(current)
                current = None
            ctx['division'] = div.group(1).rstrip('.')
            ctx['division_heading'] = div.group(2).strip(' .') or None
            hierarchy.append({'level': 'division', 'number': ctx['division'], 'heading': ctx['division_heading']})
            mode = 'front'
            continue
        if title:
            if current:
                sections.append(current)
                current = None
            ctx['title'] = title.group(1).rstrip('.')
            ctx['title_heading'] = title.group(2).strip(' .') or None
            hierarchy.append({'level': 'title', 'number': ctx['title'], 'heading': ctx['title_heading']})
            mode = 'front'
            continue
        if subtitle:
            ctx['subtitle'] = subtitle.group(1).rstrip('.')
            ctx['subtitle_heading'] = subtitle.group(2).strip(' .') or None
            continue
        if chapter:
            if current:
                sections.append(current)
                current = None
            ctx['chapter'] = chapter.group(1).rstrip('.')
            ctx['chapter_heading'] = None
            ctx['chapter_status'] = None
            ctx['part'] = None
            ctx['part_heading'] = None
            mode = 'chapter-heading'
            continue
        if article:
            if current:
                sections.append(current)
                current = None
            ctx['article'] = article.group(1)
            ctx['article_number'] = roman_to_int(article.group(1))
            ctx['article_heading'] = article.group(2).strip() or None
            ctx['part'] = None
            ctx['part_heading'] = None
            hierarchy.append({'level': 'article', 'number': ctx['article'], 'heading': ctx['article_heading']})
            mode = 'article'
            continue
        if line == 'Section':
            mode = 'sections'
            continue
        if line == 'Chapter':
            mode = 'chapter-list'
            continue
        if mode == 'chapter-heading':
            if STATUS_WORD.match(line) or line.startswith('REPEALED') or line.startswith('Repealed'):
                text, history, status = split_history([line])
                ctx['chapter_status'] = status or (STATUS_WORD.match(line).group(1) if STATUS_WORD.match(line) else None)
                ctx['chapter_history'] = history
            else:
                ctx['chapter_heading'] = line
                hierarchy.append({'level': 'chapter', 'number': ctx['chapter'], 'heading': line})
            mode = 'chapter-body'
            continue
        if mode == 'chapter-list':
            continue
        if part:
            if current:
                sections.append(current)
                current = None
            ctx['part'] = part.group(2).rstrip('.')
            ctx['part_heading'] = part.group(3).strip() or None
            mode = 'sections'
            continue
        cite_match = HRS_CITE.match(line) if not bare else None
        if cite_match is None and bare and mode in ('sections', 'article', 'chapter-body', 'front'):
            cite_match = BARE_CITE.match(line)
            kind = 'bare'
        else:
            kind = 'hrs' if cite_match else None
        if cite_match and (kind == 'hrs' or bare):
            if current:
                sections.append(current)
            heading = cite_match.group(2).strip()
            current = _new_section(cite_match.group(1), heading, ctx)
            mode = 'sections'
            continue
        if mode == 'sections' and current is not None:
            current['heading'] = (current['heading'] + ' ' + line).strip()
            continue
        if mode == 'article' and ctx.get('article_heading') is not None:
            ctx['article_heading'] = (ctx['article_heading'] + ' ' + line).strip()
            if hierarchy and hierarchy[-1]['level'] == 'article':
                hierarchy[-1]['heading'] = ctx['article_heading']
            continue
        if mode == 'chapter-body':
            unclassified.append(line)
            continue
        if line and line != '_______________':
            unclassified.append(line)
    if current:
        sections.append(current)
    close_embedded()
    # notes on the index page (cross references under a repealed chapter)
    _, _, annotations = split_notes(rows)
    return {
        'name': name,
        'instrument': instrument,
        'context': ctx,
        'hierarchy': hierarchy,
        'sections': sections,
        'embedded': embedded_units,
        'annotations': annotation_text(annotations),
        'unclassified': unclassified,
    }


def sha256_text(text):
    return hashlib.sha256((text or '').encode('utf-8')).hexdigest()


def section_record(parsed, path_rows, source, occurrence):
    text = parsed['text'] or ''
    record = {
        'state': 'HI',
        'code_id': CODE_ID,
        'code_name': CODE_NAME,
        'edition': EDITION,
        'native_id': parsed['name'][:-4] if parsed['name'].lower().endswith('.htm') else parsed['name'],
        'citation': parsed['citation'],
        'citation_path': path_rows,
        'heading': parsed['heading'],
        'text': text,
        'history': parsed['history'],
        'status_label': parsed['status_label'],
        'effective': parsed['effective'],
        'currency': CURRENCY,
        'source': source,
        'text_sha256': sha256_text(text),
        'occurrence': occurrence,
        'annotations': parsed['annotations'],
    }
    return record


def load_jsonl(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding='utf8').splitlines() if line.strip()]
