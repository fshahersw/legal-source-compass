"""Independent checks for South Carolina chapter HTML against publisher DOCX files."""
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

from bs4 import BeautifulSoup

from sc_parse import SECTION_ID

DOCX_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MARKER = re.compile(r'\bSECTION\s+(%s)\.' % SECTION_ID)


def docx_text(path):
    """Extract Word paragraphs directly from OOXML, independently of the HTML parser."""
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    return '\n'.join(
        ''.join(node.text or '' for node in paragraph.iter(DOCX_NS + 't'))
        for paragraph in root.iter(DOCX_NS + 'p')
    )


def docx_markers(text):
    return [
        match.group(1)
        for line in text.splitlines()
        for match in [MARKER.match(line)]
        if match
    ]


def html_visible_text(page):
    node = BeautifulSoup(page, 'lxml').find(id='contentsection')
    if node is None:
        raise ValueError('no contentsection for independent audit')
    return node.get_text('\n')


def canonical_characters(text):
    """Ignore layout/case and the publisher's HTML spelling-out of Word's section signs."""
    text = unicodedata.normalize('NFKC', text.replace('§§', 'SECTIONS').replace('§', 'SECTION'))
    return ''.join(char.lower() for char in text if char.isalnum())


def compare_texts(html_derivative, docx_derivative, title_line):
    html_chars = canonical_characters(html_derivative)
    title_chars = canonical_characters(title_line)
    if html_chars.startswith(title_chars):
        html_chars = html_chars[len(title_chars):]
    docx_chars = canonical_characters(docx_derivative)
    return {
        'html_characters': len(html_chars),
        'docx_characters': len(docx_chars),
        'matched': html_chars == docx_chars,
    }
