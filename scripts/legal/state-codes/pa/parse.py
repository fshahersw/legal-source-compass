"""Parse a palegis.us Pennsylvania Consolidated Statutes title document (one HTML file per title).

The publisher marks structure with hidden comment divs: <TT>c<SEC>s starts a section, <TT>c<SEC>v
starts its amendment-history and editorial notes, <TT>c<SEC>h starts a division header block,
<TT>cc ends the title's table of contents and <TT>cax starts the appendix. Everything is read from
those markers and the printed lines; nothing is inferred from outside the document.

A unit text derivative is "\n".join(lines) of every printed paragraph or table row in document
order. A section's text is a contiguous slice of those lines (printed heading line through the last
body line), so its span in code points can be recorded exactly.
"""
import html
import re

MARKER = re.compile(r'<div class="Comment">([^<]*)</div>')
BLOCK = re.compile(r'<div class="Comment">([^<]*)</div>|<p\b[^>]*>(.*?)</p>|<table\b.*?</table>', re.S)
ROW = re.compile(r'<tr\b.*?</tr>', re.S)
CELL = re.compile(r'<t[dh]\b.*?</t[dh]>', re.S)
MARKER_CODE = re.compile(r'^(\d{2})c([0-9A-Za-z.]+?)([svh])$')
DIVISION = re.compile(r'^(TITLE|PART|SUBPART|ARTICLE|SUBARTICLE|CHAPTER|SUBCHAPTER|DIVISION|SUBDIVISION) '
                      r'([0-9]+[A-Z]?(?:\.[0-9]+)?|[IVXLCDM]+[A-Z]?|[A-Z](?:-[0-9]+)?)$')
HEADING = re.compile(r'^§ ?([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)\.(?: +(.*))?$')
REVISED = re.compile(r'<meta name="revised" content="([^"]*)"\s*/?>')
LEVEL_NAMES = {k: k.lower() for k in ('TITLE', 'PART', 'SUBPART', 'ARTICLE', 'SUBARTICLE', 'CHAPTER', 'SUBCHAPTER', 'DIVISION', 'SUBDIVISION')}


def squash(fragment):
    fragment = re.sub(r'<br\s*/?>', ' ', fragment)
    text = html.unescape(re.sub(r'<[^>]+>', '', fragment)).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def tokens(document):
    """Return (lines, markers) where markers is [(line_index, code)] in document order."""
    body = document[document.index('<body>'):]
    lines, markers = [], []
    for match in BLOCK.finditer(body):
        if match.group(1) is not None:
            markers.append((len(lines), match.group(1)))
        elif match.group(2) is not None:
            lines.append(squash(match.group(2)))
        else:
            for row in ROW.findall(match.group(0)):
                lines.append('\t'.join(squash(c) for c in CELL.findall(row)).strip('\t'))
    return lines, markers


CONST_SCHEDULE = re.compile(r'^SCHEDULE NO\. ([0-9]+)$')


def division_at(lines, index, constitution=False):
    if constitution:
        line = lines[index]
        if line == 'SCHEDULE TO JUDICIARY ARTICLE':
            return {'kind': 'SCHEDULE', 'number': 'ART-V', 'heading': line.title()}
        schedule = CONST_SCHEDULE.match(line)
        if schedule:
            follow = lines[index + 1] if index + 1 < len(lines) else ''
            return {'kind': 'SCHEDULE', 'number': schedule.group(1), 'heading': follow or None}
        found = re.match(r'^ARTICLE ([IVX]+)$', line)
        if not found:
            return None
        follow = lines[index + 1] if index + 1 < len(lines) else ''
        return {'kind': 'ARTICLE', 'number': found.group(1), 'heading': follow or None}
    found = DIVISION.match(lines[index])
    if not found:
        return None
    name = []
    for follow in lines[index + 1:index + 5]:
        if not follow:
            break
        if DIVISION.match(follow) or follow == 'Sec.':
            break
        name.append(follow)
    return {'kind': found.group(1), 'number': found.group(2), 'heading': ' '.join(name) or None}


class Depths:
    """Nesting order of division kinds, learned from first appearance within one title."""

    def __init__(self):
        self.order = []

    def depth(self, kind):
        if kind not in self.order:
            base = kind[3:] if kind.startswith('SUB') else None
            if base in self.order:
                self.order.insert(self.order.index(base) + 1, kind)
            elif kind == 'TITLE':
                self.order.insert(0, kind)
            else:
                self.order.append(kind)
        return self.order.index(kind)


def parse_title(document, ttl):
    """Parse one title document. ttl is the two-digit title string ('00' is the Constitution)."""
    revised = REVISED.search(document)
    lines, markers = tokens(document)
    toc_end = next((i for i, (_, c) in enumerate(markers) if MARKER_CODE.match(c)), len(markers))
    body_start = markers[toc_end][0] if toc_end < len(markers) else len(lines)
    ranges = []
    for i, (pos, code) in enumerate(markers):
        end = markers[i + 1][0] if i + 1 < len(markers) else len(lines)
        ranges.append((pos, end, code))
    constitution = ttl == '00'
    depths = Depths()
    stack = []
    sections, anomalies = [], []
    last_section = None
    appendix_from = None

    def scan_divisions(start, stop):
        for i in range(start, stop):
            div = division_at(lines, i, constitution)
            if not div:
                continue
            depth = 0 if constitution else depths.depth(div['kind'])
            div['depth'] = depth
            while stack and stack[-1]['depth'] >= depth:
                stack.pop()
            stack.append(div)

    for pos, end, code in ranges:
        if code.endswith('cax') or code == ttl + 'cax':
            appendix_from = pos
            scan_divisions(pos, pos)
            last_section = None
            continue
        parsed = MARKER_CODE.match(code)
        if not parsed or parsed.group(1) != ttl:
            continue
        kind = parsed.group(3)
        if appendix_from is not None and kind != 's':
            continue
        if kind == 's':
            if appendix_from is not None:
                continue
            while pos < end and lines[pos] == '':
                pos += 1
            heading = HEADING.match(lines[pos]) if pos < end else None
            if not heading:
                anomalies.append({'marker': code, 'reason': 'no section heading line'})
                last_section = None
                continue
            stop = end
            for i in range(pos + 1, end):
                if division_at(lines, i, constitution):
                    stop = i
                    break
            while stop > pos + 1 and lines[stop - 1] == '':
                stop -= 1
            section = {'marker': code, 'number': heading.group(1), 'heading': heading.group(2) or None,
                       'first': pos, 'last': stop, 'history': None, 'hierarchy': [{k: v for k, v in d.items() if k != 'depth'} for d in stack]}
            sections.append(section)
            last_section = section
            scan_divisions(stop, end)
        elif kind == 'v':
            if last_section and last_section['marker'][:-1] == code[:-1] and last_section['history'] is None:
                hist = []
                for i in range(pos, end):
                    if lines[i] == '':
                        break
                    hist.append(lines[i])
                if hist and hist[0].startswith('('):
                    last_section['history'] = '\n'.join(hist)
            scan_divisions(pos, end)
            last_section = None
        else:
            scan_divisions(pos, end)
            last_section = None
    return {'lines': lines, 'sections': sections, 'anomalies': anomalies, 'body_start_line': body_start,
            'revised': revised.group(0) if revised else None, 'revised_value': revised.group(1) if revised else None,
            'appendix_line': appendix_from,
            'title_tag': (re.search(r'<title>([^<]*)</title>', document) or [None, None])[1]}


def unit_text(parsed):
    return '\n'.join(parsed['lines'])


def line_offsets(lines):
    offsets, at = [], 0
    for line in lines:
        offsets.append(at)
        at += len(line) + 1
    return offsets
