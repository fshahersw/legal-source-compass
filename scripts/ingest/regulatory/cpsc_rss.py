"""Strict official CPSC RSS parser. No network, external entities, or corpus access."""
import datetime
import json
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit


def parse_feed(raw):
    if len(raw) > 8 * 1024 * 1024 or re.search(br'<!\s*(?:DOCTYPE|ENTITY)', raw, re.I):
        raise ValueError('XML declarations or size not permitted')
    root = ET.fromstring(raw)
    if root.tag != 'rss' or root.attrib.get('version') != '2.0':
        raise ValueError('RSS schema changed')
    channels = root.findall('channel')
    if len(channels) != 1 or channels[0].findtext('title') != 'Recall List':
        raise ValueError('Recall channel missing')
    items = channels[0].findall('item')
    if not items or len(items) > 500:
        raise ValueError('Empty or oversized recall feed')
    records = []
    seen = set()
    for item in items:
        def required(name):
            nodes = item.findall(name)
            if len(nodes) != 1 or list(nodes[0]) or not (nodes[0].text or '').strip():
                raise ValueError('Missing, duplicate, or nested source field')
            return nodes[0].text.strip()
        guid, url = required('guid'), required('link')
        if not re.fullmatch(r'https://www\.cpsc\.gov/_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', guid):
            raise ValueError('Publisher GUID changed')
        parsed_url = urlsplit(url)
        if (parsed_url.scheme != 'https' or parsed_url.netloc != 'www.cpsc.gov'
                or not parsed_url.path.startswith('/Recalls/') or parsed_url.fragment):
            raise ValueError('Recall link outside official path')
        if guid in seen:
            raise ValueError('Duplicate publisher GUID')
        seen.add(guid)
        literal_date = required('pubDate')
        if not re.fullmatch(r'[A-Z][a-z]+ \d{2}, \d{4}', literal_date):
            raise ValueError('Publisher date format changed')
        published = datetime.datetime.strptime(literal_date, '%B %d, %Y').date().isoformat()
        records.append({'guid': guid, 'url': url, 'title': required('title'),
                        'description_html': required('description'),
                        'published_on': published, 'published_literal': literal_date})
    return records


if __name__ == '__main__':
    try:
        print(json.dumps(parse_feed(sys.stdin.buffer.read(8 * 1024 * 1024 + 1)), ensure_ascii=False))
    except (ValueError, ET.ParseError):
        sys.exit(2)
