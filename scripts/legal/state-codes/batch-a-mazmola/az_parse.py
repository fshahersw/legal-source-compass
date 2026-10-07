"""Parse retained azleg.gov Arizona Revised Statutes pages (no network).

Section page (/ars/<title>/<section>.htm): a tiny HTML document. The first <p> prints the section number in a green <font> and the
heading in a purple <u>; every later <p> is a line of the section's text, exactly as printed. The page's own "Creation Date"
comment is kept as the page date and is not parsed.

Title page (arsDetail/?title=N): chapters (accordion), articles inside them, and one link per section whose docName is the section URL.
That listing is the publisher's own table of contents; the hierarchy and the per-title section count come from it.

A line this module cannot place raises, so a retained page is never silently reshaped.
"""
import html as htmllib
import re

from bs4 import BeautifulSoup

WS = re.compile(r'[ \t\r\n\f\v\u00a0\u2002\u2003\u2009]+')
URL_PATH = re.compile(r'/ars/([0-9]+[A-Za-z]?)/([0-9A-Za-z.\-]+)\.htm$')
NUMBER = re.compile(r'^([0-9]+[A-Za-z]?)-([0-9A-Za-z.]+)$')
DOC = re.compile(r'docName=(https://www\.azleg\.gov/ars/[^"&]+\.htm)')


class EmptySectionPage(ValueError):
    """The page has no printed text beyond (or including) its heading line."""


def clean(s):
    return WS.sub(' ', s or '').strip()


def parse_section(page_html, url=None):
    created = re.search(r'<!Creation Date:\s*([^>]*)>', page_html)
    soup = BeautifulSoup(page_html, 'lxml')
    ps = soup.body.find_all('p') if soup.body else []
    if not ps:
        raise EmptySectionPage(url or '')
    first = ps[0]
    font, under = first.find('font'), first.find('u')
    num = clean(font.get_text(' ')) if font else None
    if not num or not NUMBER.match(num):
        raise ValueError('no section number on %s: %r' % (url, clean(first.get_text(' '))[:80]))
    heading = clean(under.get_text(' ')) if under else None
    lead = clean(first.get_text(' '))
    expected = '%s. %s' % (num, heading) if heading else '%s.' % num
    if lead != expected and not lead.startswith(num):
        raise ValueError('unplaced first line on %s: %r' % (url, lead[:80]))
    body = [clean(p.get_text(' ')) for p in ps[1:]]
    body = [b for b in body if b]
    if url:
        m = URL_PATH.search(url)
        n = NUMBER.match(num)
        if not m or m.group(1).lower() != n.group(1).lower():
            raise ValueError('section number %s does not belong to %s' % (num, url))
    return {'created': created.group(1).strip() if created else None, 'num': num, 'title': NUMBER.match(num).group(1),
            'heading': heading, 'first_line': lead, 'body': body}


def section_record(page):
    """Text, heading and status note. A section with no body keeps its printed heading words (for example a repeal notice)."""
    if page['body']:
        return {'text': '\n'.join(page['body']), 'heading': page['heading'], 'status_note': None}
    words = page['heading']
    if not words:
        raise EmptySectionPage(page['num'])
    return {'text': words, 'heading': None, 'status_note': words}


def parse_detail(page_html):
    """-> {section url: {chapter: (number, name), article: (number, name), section: printed number}} in document order."""
    soup = BeautifulSoup(page_html, 'lxml')
    out = {}
    for chap in soup.find_all('div', class_='accordion'):
        h5 = chap.find('h5')
        if h5 is None or h5.find('a') is None:
            continue
        cnum = clean(h5.find('a').get_text(' ')).replace('Chapter', '').strip()
        two = h5.find('div', class_='two-thirds')
        cname = clean(two.get_text(' ')) if two else ''
        for art in chap.find_all('div', class_='article'):
            a = art.find('a')
            span = art.find('span')
            anum = clean(a.get_text(' ')).replace('Article', '').strip() if a else ''
            aname = clean(span.get_text(' ')) if span else ''
            for link in art.find_all('a', class_='stat'):
                m = DOC.search(htmllib.unescape(link.get('href') or ''))
                if m and m.group(1) not in out:
                    out[m.group(1)] = {'chapter': (cnum, cname), 'article': (anum, aname), 'section': clean(link.get_text(' '))}
    return out


def listed_urls(page_html):
    soup = BeautifulSoup(page_html, 'lxml')
    seen = []
    for link in soup.find_all('a', class_='stat'):
        m = DOC.search(htmllib.unescape(link.get('href') or ''))
        if m and m.group(1) not in seen:
            seen.append(m.group(1))
    return seen
