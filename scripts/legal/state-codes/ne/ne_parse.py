"""Parse Nebraska Legislature statute HTML into section records.

Official full-chapter files (laws-index/chapNN-full.html) and the full UCC file
are sequences of div.printwidth blocks. Appendix units are individual
div.statute panels. Annotations and cross references stay out of the body.
"""
import hashlib
import re

from bs4 import BeautifulSoup

PARSER_NAME = 'ne_rs_html'
PARSER_VERSION = '2'

SECTION_RE = re.compile(
    r'^(\d+[A-Za-z]?-\d[\d,]*(?:\.\d+)*[A-Za-z]?)\s*\.\s*(.*)$', re.S)
ARTICLE_RE = re.compile(
    r'^(?:ARTICLE|Article)\s+(\d+[A-Za-z]?)\b\.?\s*(.*)$', re.S)
STATUS_RE = re.compile(
    r'^(Repealed|Transferred|Reserved|Renumbered|Expired|Omitted|Superseded|Vacant|Unconstitutional|Deleted)\b'
    r'|^(Expiration of act|Act, expired)\b')
STATUS_IN_CATCHLINE = re.compile(
    r'\b(Repealed|Transferred|Reserved|Renumbered|Expired|Omitted|Superseded|Vacant|Unconstitutional|Deleted)\.')
DATE_RE = re.compile(r'^(?:Operative Date|Effective Date|Termination Date)\s*:')
EDITION_STATEMENT = 'Last updated May 27, 2026'
EDITION_AS_OF = 'May 27, 2026'

NOTE_CLASSES = ('source', 'anno', 'cross')


def collapse(text):
    if text is None:
        return ''
    text = text.replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def inline_text(node):
    """Text of a node. Inline tags do not insert spaces; HTML whitespace is collapsed."""
    if node is None:
        return ''
    return collapse(node.get_text('', strip=False))


def sha256_text(text):
    return hashlib.sha256((text or '').encode('utf-8')).hexdigest()


def _lines_from_node(node):
    """Paragraph-preserving text. Source-wrap newlines inside a block are spaces."""
    if node is None:
        return ''
    clone = BeautifulSoup(str(node), 'lxml')
    root = clone.body or clone
    for tag in root.find_all(['script', 'style']):
        tag.decompose()
    for text_node in list(root.find_all(string=True)):
        text_node.replace_with(text_node.replace('\xa0', ' ').replace('\r', ' ').replace('\n', ' '))
    for br in root.find_all('br'):
        br.replace_with('\n')
    for tag in root.find_all(['p', 'tr', 'li', 'h2', 'h3', 'h4']):
        tag.insert_after('\n')
    raw = root.get_text('', strip=False)
    lines = [collapse(line) for line in raw.splitlines()]
    out = []
    blank = False
    for line in lines:
        if not line:
            blank = True
            continue
        if blank and out:
            out.append('')
        blank = False
        out.append(line)
    return '\n'.join(out).strip()


def _date_strings(node):
    found = []
    for strong in node.find_all('strong'):
        label = inline_text(strong)
        if DATE_RE.match(label):
            found.append(label)
            strong.decompose()
    return found


def _pull_note_runs(div):
    """Pull <strong>Note:</strong> plus the text that follows it, up to the next strong."""
    notes = []
    for strong in list(div.find_all('strong')):
        if inline_text(strong).rstrip(':') != 'Note':
            continue
        chunks = []
        sibling = strong.next_sibling
        while sibling is not None:
            name = getattr(sibling, 'name', None)
            if name == 'strong':
                break
            if name and sibling.find('strong'):
                break
            chunks.append(sibling)
            sibling = sibling.next_sibling
        parts = []
        for chunk in chunks:
            if getattr(chunk, 'name', None):
                parts.append(chunk.get_text('', strip=False))
            else:
                parts.append(str(chunk))
            chunk.extract()
        strong.extract()
        text = collapse(''.join(parts))
        if text:
            notes.append({'label': 'Note', 'text': text})
    return notes


def _note_blocks(container):
    """Detach source / annotation / cross-reference blocks. Returns (history, dates, notes)."""
    history = None
    dates = []
    notes = []
    blocks = []
    for div in container.find_all('div'):
        classes = div.get('class') or []
        if any(c in NOTE_CLASSES for c in classes):
            blocks.append(div)
    # Also catch a panel "Source" heading that is not class=source (section pages).
    for div in container.find_all('div'):
        if div in blocks or div.parent is None:
            continue
        heading = div.find('h2')
        if heading and inline_text(heading) in ('Source', 'Annotations', 'Cross References'):
            blocks.append(div)
    for div in blocks:
        classes = div.get('class') or []
        dates.extend(_date_strings(div))
        strong = div.find('strong')
        h2 = div.find('h2')
        label = None
        if strong:
            label = inline_text(strong).rstrip(':')
        elif h2:
            label = inline_text(h2).rstrip(':')
        if 'source' in classes or label == 'Source':
            notes.extend(_pull_note_runs(div))
            strong = div.find('strong')
            if strong:
                strong.decompose()
            if h2 and inline_text(h2).rstrip(':') == 'Source':
                h2.decompose()
            history = inline_text(div) or None
            if history and not history.lower().startswith('source'):
                history = 'Source: ' + history
            elif history and history.lower().startswith('source:') and not history.startswith('Source:'):
                history = 'Source:' + history[7:]
        else:
            if strong and label:
                strong.decompose()
            if h2 and label and inline_text(h2).rstrip(':') == label:
                h2.decompose()
            text = _lines_from_node(div)
            if text:
                notes.append({'label': label or (classes[0] if classes else 'Note'), 'text': text})
        div.decompose()
    return history, dates, notes


def _status_label(heading, text=''):
    if not heading:
        return None
    match = STATUS_RE.match(heading)
    if match:
        return next(group for group in match.groups() if group)
    if text:
        return None
    match = STATUS_IN_CATCHLINE.search(heading)
    if match:
        return match.group(1)
    if heading.startswith('Note:'):
        return 'Note'
    return None


def _section_record(number, heading, text, history, dates, notes, path_prefix):
    heading = heading if heading else None
    text = text or ''
    path = list(path_prefix)
    path.append({'level': 'section', 'number': number, 'heading': heading})
    return {
        'native_id': number,
        'heading': heading,
        'text': text,
        'history': history,
        'status_label': _status_label(heading, text),
        'effective': '\n'.join(dates) if dates else None,
        'annotations': notes or None,
        'citation_path': path,
        'text_sha256': sha256_text(text),
    }


def parse_printwidth_html(html, path_prefix):
    """Parse a full-chapter or full-UCC HTML document.

    Returns (sections, article_headings, anomalies).
    article_headings are published headings that are not section units.
    """
    soup = BeautifulSoup(html, 'lxml')
    sections = []
    articles = []
    anomalies = []
    current_prefix = list(path_prefix)
    for index, block in enumerate(soup.select('div.printwidth')):
        history, dates, notes = _note_blocks(block)
        strong = block.find('strong')
        if strong is None:
            anomalies.append({'kind': 'printwidth_without_strong', 'index': index})
            continue
        head = inline_text(strong)
        strong.decompose()
        section_match = SECTION_RE.match(head)
        article_match = ARTICLE_RE.match(head)
        if section_match:
            number = section_match.group(1)
            heading = collapse(section_match.group(2)) or None
            # group 2 already came from collapsed head; collapse again is harmless
            body = _lines_from_node(block)
            rec = _section_record(number, heading, body, history, dates, notes, current_prefix)
            rec['span'] = 'printwidth:%d' % index
            sections.append(rec)
        elif article_match:
            articles.append({
                'number': article_match.group(1),
                'heading': collapse(article_match.group(2)) or None,
                'span': 'printwidth:%d' % index,
                'raw_heading': head,
            })
            current_prefix = list(path_prefix) + [{
                'level': 'article',
                'number': article_match.group(1),
                'heading': collapse(article_match.group(2)) or None,
            }]
        else:
            anomalies.append({'kind': 'unparsed_printwidth_heading', 'index': index, 'heading': head[:300]})
    return sections, articles, anomalies


def parse_statute_panel(html, path_prefix):
    """Parse one section-page (div.statute) used for the appendix and section views."""
    soup = BeautifulSoup(html, 'lxml')
    panel = soup.select_one('div.statute')
    if panel is None:
        return None, [{'kind': 'missing_statute_panel'}]
    h1 = soup.select_one('.main-content h1')
    citation = inline_text(h1) if h1 else None
    history, dates, notes = _note_blocks(panel)
    h2 = panel.find('h2')
    h3 = panel.find('h3')
    number = None
    heading = None
    if h2:
        h2_text = inline_text(h2)
        match = SECTION_RE.match(h2_text if h2_text.endswith('.') else h2_text + '.')
        if match:
            number = match.group(1)
        h2.decompose()
    if h3:
        heading = inline_text(h3) or None
        h3.decompose()
    if number is None:
        return None, [{'kind': 'panel_without_section_number', 'citation': citation}]
    body = _lines_from_node(panel)
    rec = _section_record(number, heading, body, history, dates, notes, path_prefix)
    rec['span'] = 'statute-panel'
    rec['page_h1'] = citation
    return rec, []


def parse_chapter_index(html):
    """Official chapter browse page: chapter heading and ordered section rows."""
    soup = BeautifulSoup(html, 'lxml')
    header = soup.select_one('.card-header.leg-header') or soup.select_one('.card-header')
    header_text = collapse(header.get_text(' ', strip=True)) if header else None
    chapter_number = None
    chapter_heading = None
    if header_text:
        match = re.match(r'Revised Statutes Chapter (\d+)\s+-\s+(.*)$', header_text)
        if match:
            chapter_number = match.group(1)
            chapter_heading = collapse(match.group(2)) or None
    rows = []
    articles = []
    current_article = None
    for tr in soup.select('table tr'):
        link = None
        for a in tr.find_all('a', href=True):
            if re.search(r'statutes\.php\?statute=', a['href']) and 'print=true' not in a['href']:
                link = a
                break
        if link is None:
            label = collapse(tr.get_text(' ', strip=True))
            if label:
                article_match = ARTICLE_RE.match(label)
                current_article = {
                    'number': article_match.group(1) if article_match else None,
                    'heading': label,
                }
                articles.append(current_article)
            continue
        href = link['href']
        id_match = re.search(r'[?&]statute=([^&]+)', href)
        number = id_match.group(1) if id_match else None
        title_span = tr.select_one('span.col-lg-9, span.col-md-9, span.col-md-8')
        heading = inline_text(title_span) if title_span else None
        rows.append({
            'native_id': number,
            'number': number,
            'heading': heading,
            'href': href,
            'article': dict(current_article) if current_article else None,
        })
    return {
        'header': header_text,
        'chapter_number': chapter_number,
        'chapter_heading': chapter_heading,
        'sections': rows,
        'articles': articles,
    }


def parse_flat_index(html, href_pattern, param):
    """UCC and appendix indexes: flat section tables, plus stray note paragraphs."""
    soup = BeautifulSoup(html, 'lxml')
    header = soup.select_one('.card-header.leg-header') or soup.select_one('.card-header')
    header_text = collapse(header.get_text(' ', strip=True)) if header else None
    notes = []
    card = soup.select_one('.card-body')
    if card:
        for p in card.find_all('p'):
            text = collapse(p.get_text(' ', strip=True))
            if not text:
                continue
            if text.lower().startswith('to browse') or text.lower().startswith('to view'):
                continue
            notes.append(text)
    rows = []
    seen = set()
    for a in soup.find_all('a', href=True):
        if not re.search(href_pattern, a['href']) or 'print=true' in a['href']:
            continue
        id_match = re.search(r'[?&]%s=([^&]+)' % param, a['href'])
        if not id_match:
            continue
        number = id_match.group(1)
        if number in seen:
            continue
        seen.add(number)
        tr = a.find_parent('tr')
        heading = None
        if tr:
            title_span = tr.select_one('span.col-md-9, span.col-lg-9, span.col-md-8')
            if title_span:
                heading = inline_text(title_span) or None
        rows.append({'native_id': number, 'number': number, 'heading': heading, 'href': a['href']})
    return {'header': header_text, 'sections': rows, 'notes': notes}


def abs_url(href):
    if not href:
        return None
    if href.startswith('http'):
        return href
    return 'https://nebraskalegislature.gov' + (href if href.startswith('/') else '/' + href)
