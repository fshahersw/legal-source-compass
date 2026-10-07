"""Parser core for South Carolina Code of Laws chapter pages.

The page body (div#contentsection) is a flat run of centered hierarchy divs, bold
"SECTION n." spans, <br>-separated paragraphs and occasional tables. Per section the
body ends at the HISTORY line. Text is not substantively rewritten: surrounding
layout whitespace is removed per displayed line and HTML entities are decoded.
"""
import hashlib
import html as htmllib
import re

PARSER = 'sc-chapter-html/2'

SECTION_ID = r'[0-9][0-9A-Za-z]*(?:-[0-9A-Za-z.]+)+'
SECTION_LINE = re.compile(r'^SECTION\s+(%s)\.\s*(.*)$' % SECTION_ID, re.S)
HIER = re.compile(r'^(CHAPTER|ARTICLE|SUBARTICLE|PART|SUBPART|SUBCHAPTER|DIVISION|SUBDIVISION)\s+(\S+)$', re.I)
TITLE_LINE = re.compile(r'^Title\s+(\S+)\s+-\s+(.*)$')
NOTE_LABELS = ("Editor's Note", "Effect of Amendment", "Code Commissioner's Note", "Cross References",
               "Cross-References", "Editor's Notes", "Code Commissioner's Notes", "Effect of Amendments")
STATUS = re.compile(r'^(Reserved for future use|Not used|Repealed|Reserved|Expired|Obsolete|Renumbered|Transferred|'
                    r'Omitted|Superseded|Vacant|Deleted|Redesignated)\b', re.I)
EFF = re.compile(r'(eff(?:ective)?\b[^;]*?)\.?\s*$')

CENTER = re.compile(r'<div style="(?:font-weight: bold; )?text-align: center;">(.*?)</div>', re.S)
TABLE = re.compile(r'<table\b.*?</table>', re.S)
BOLD_SPAN = re.compile(r'<span style="font-weight: bold;">(.*?)</span>', re.S)
ROMAN = re.compile(r'^[IVXLC]+$')
TAG = re.compile(r'<[^>]+>')


def sha256_text(s):
    return hashlib.sha256(s.encode('utf8')).hexdigest()


def content_html(page):
    start = page.find('id="contentsection"')
    if start < 0:
        raise ValueError('no contentsection')
    start = page.find('>', start) + 1
    end = page.find('<!-- mainwidepanel', start)
    if end < 0:
        raise ValueError('no end marker')
    body = page[start:end]
    cut = body.rfind('</div>')  # closes contentsection
    return body[:cut] if cut >= 0 else body


def _clean(s):
    return htmllib.unescape(TAG.sub('', s)).replace('\xa0', ' ').strip()


def _render_table(m):
    rows = []
    for tr in re.findall(r'<tr\b.*?</tr>', m.group(0), re.S):
        cells = [_clean(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', tr, re.S)]
        while cells and not cells[-1]:
            cells.pop()
        rows.append('\t'.join(cells))
    return '\n@@TABLE@@' + '\n@@TABLE@@'.join(rows) + '\n'


def items(page):
    """Flatten the content div to [(kind, text)] with kinds title/center/section/line/table."""
    h = content_html(page)
    h = TABLE.sub(_render_table, h)
    h = re.sub(r'<div style="font-weight: bold; text-align: center;">(.*?)</div>', lambda m: '\n@@CENTER@@' + m.group(1) + '\n', h, flags=re.S)
    h = re.sub(r'<div style="text-align: center;">(.*?)</div>', lambda m: '\n@@CENTER@@' + m.group(1) + '\n', h, flags=re.S)
    h = BOLD_SPAN.sub(lambda m: '\n@@BOLD@@' + m.group(1) + '@@/BOLD@@', h)
    h = re.sub(r'<br\s*/?>', '\n', h)
    out = []
    for raw in h.split('\n'):
        if raw.startswith('@@TABLE@@'):
            out.append(('table', htmllib.unescape(raw[9:])))
            continue
        if raw.startswith('@@CENTER@@'):
            t = _clean(raw[10:])
            if t:
                out.append(('center', t))
            continue
        if raw.startswith('@@BOLD@@'):
            m = re.match(r'@@BOLD@@(.*?)@@/BOLD@@(.*)$', raw, re.S)
            label = _clean(m.group(1))
            if re.match(r'SECTION\s', label):
                out.append(('section', label + ' ' + _clean(m.group(2))))
            else:
                out.append(('line', _clean(raw.replace('@@BOLD@@', '').replace('@@/BOLD@@', ''))))
            continue
        t = _clean(raw)
        if t:
            out.append(('line', t))
    return out


def parse_chapter(page):
    """Return (derivative_text, header, sections). Sections carry char spans into derivative_text."""
    its = items(page)
    title = {}
    hier = {}
    order = []
    pending = None
    lines = []
    offset = 0
    cur = None
    sections = []
    header = {'title': None, 'chapter': None, 'unit': None}

    def emit(t):
        nonlocal offset
        start = offset
        lines.append(t)
        offset += len(t) + 1
        return start

    def close():
        nonlocal cur
        if cur is not None:
            cur['end'] = max(cur['start'], offset - 1)
            sections.append(cur)
            cur = None

    embed_heading = False
    for kind, t in its:
        if kind == 'center':
            m0 = HIER.match(t)
            in_body = cur is not None and cur['phase'] == 'body'
            if in_body and (embed_heading or (m0 and ROMAN.match(m0.group(2)))
                            or (not m0 and pending is None and not TITLE_LINE.match(t))):
                # compact/uniform-act articles quoted inside a section keep their text
                embed_heading = bool(m0)
                line_start = emit(t)
                if cur['body_start'] is None:
                    cur['body_start'] = line_start
                cur['body'].append(t)
                cur.setdefault('embedded_headings', 0)
                cur['embedded_headings'] += 1
                continue
            m = TITLE_LINE.match(t)
            if m and not title:
                title = {'level': 'title', 'number': m.group(1), 'heading': m.group(2)}
                header['title'] = title
                emit(t)
                continue
            m = HIER.match(t)
            close()
            if m:
                lvl = m.group(1).lower()
                node = {'level': lvl, 'number': m.group(2), 'heading': None}
                if lvl in order:
                    order = order[:order.index(lvl)]
                order.append(lvl)
                hier = {k: v for k, v in hier.items() if k in order}
                hier[lvl] = node
                pending = node
                if lvl == 'chapter':
                    header['chapter'] = node
                if header['unit'] is None and lvl in ('chapter', 'article'):
                    header['unit'] = node
            elif pending is not None and pending['heading'] is None:
                pending['heading'] = t
                pending = None
            else:
                node = {'level': 'unlabelled', 'number': None, 'heading': t}
                header.setdefault('stray_center', []).append(t)
            emit(t)
            continue
        if kind == 'section':
            close()
            m = SECTION_LINE.match(t)
            if not m:
                raise ValueError('bad section line: %r' % t[:80])
            pending = None
            start = emit(t)
            cur = {'number': m.group(1), 'heading': m.group(2).strip(), 'printed': 'SECTION %s.' % m.group(1),
                   'start': start, 'body_start': None, 'body_end': None,
                   'body': [], 'history': [], 'notes': [], 'note_label': None, 'phase': 'body',
                   'path': [dict(title)] + [dict(hier[k]) for k in order]}
            embed_heading = False
            continue
        # plain text / table row
        pending = None
        if kind == 'table':
            parts = t.split('\n@@TABLE@@')
            txts = parts
        else:
            txts = [t]
        for x in txts:
            line_start = emit(x)
            if cur is None:
                header.setdefault('preamble', []).append(x)
                continue
            if cur['phase'] == 'body':
                if x.startswith('HISTORY:'):
                    cur['body_end'] = line_start - 1 if cur['body_start'] is not None else line_start
                    cur['history'].append(x)
                    cur['phase'] = 'history'
                elif x in NOTE_LABELS:
                    cur['body_end'] = line_start - 1 if cur['body_start'] is not None else line_start
                    cur['phase'] = 'notes'
                    cur['note_label'] = x
                    cur['notes'].append({'label': x, 'lines': []})
                else:
                    if cur['body_start'] is None:
                        cur['body_start'] = line_start
                    cur['body'].append(x)
            elif cur['phase'] == 'history':
                if x in NOTE_LABELS:
                    cur['phase'] = 'notes'
                    cur['notes'].append({'label': x, 'lines': []})
                elif x.startswith('HISTORY:'):
                    cur['history'].append(x)
                else:
                    cur['notes'].append({'label': None, 'lines': [x]}) if not cur['notes'] else cur['notes'][-1]['lines'].append(x)
            else:
                if x in NOTE_LABELS:
                    cur['notes'].append({'label': x, 'lines': []})
                else:
                    cur['notes'][-1]['lines'].append(x)
    close()
    text = '\n'.join(lines)
    for s in sections:
        s['end'] = min(s['end'], len(text))
        if s['body_start'] is None:
            # Empty/repealed placeholders still have a valid zero-length span.
            s['body_start'] = s['start'] + len(s['printed']) + (1 if s['heading'] else 0) + len(s['heading'])
            s['body_end'] = s['body_start']
        elif s['body_end'] is None:
            s['body_end'] = s['end']
        if text[s['body_start']:s['body_end']] != '\n'.join(s['body']):
            raise ValueError('non-contiguous body span for %s' % s['number'])
    return text, header, sections


def effective_of(history):
    if not history:
        return None
    last = history[-1].rsplit(';', 1)[-1]
    m = EFF.search(last)
    return m.group(1).strip() if m else None


def status_of(heading, body):
    for candidate in [heading or ''] + list(body[:1]):
        match = STATUS.match(candidate.lstrip('['))
        if match:
            return match.group(1)
    return None
