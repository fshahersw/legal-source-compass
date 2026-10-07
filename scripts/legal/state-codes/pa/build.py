"""Turn retained palegis.us title documents into publisher-code-intake/2 units and sections."""
import collections
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse  # noqa: E402
from land_v2 import land as lv2  # noqa: E402

ST = 'PA'
SOURCE_SYSTEM = 'pa-consolidated-statutes'
PARSER = {'name': 'pa-palegis-title-html', 'version': '1'}
PARSER_LABEL = '%s/%s' % (PARSER['name'], PARSER['version'])
URL_PATTERN = r'^https://www\.palegis\.us/statutes/consolidated/view-statute\?50&iFrame=true&txtType=HTM&ttl=[0-9]{1,2}$'
SECTION_REGEX = r'^([0-9]{1,2}:[0-9A-Za-z]+(\.[0-9A-Za-z]+)*|CONST:(ART|SCH)-[A-Z0-9-]+\.[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)(#[0-9]+)?$'
LEVELS = ['title', 'part', 'subpart', 'article', 'subarticle', 'chapter', 'subchapter', 'division', 'subdivision',
          'schedule', 'section']
TITLE_URL = 'https://www.palegis.us/statutes/consolidated/view-statute?50&iFrame=true&txtType=HTM&ttl=%s'


def manifest():
    return {
        'schema_version': 'publisher-code-manifest/2', 'jurisdiction': ST,
        'publisher': 'Pennsylvania General Assembly (palegis.us), Legislative Data Processing Center',
        'publisher_url': 'https://www.palegis.us/statutes/consolidated', 'source_system': SOURCE_SYSTEM,
        'code_title': 'Pennsylvania Consolidated Statutes and Constitution of Pennsylvania',
        'parser': PARSER,
        'retrieval': {'methods': ['proxied_fetch'], 'source_url_patterns': [URL_PATTERN], 'terms_gate': False,
                      'official_source': True, 'rate_limit_ms': 1000},
        'structure': {'levels': LEVELS, 'unit': 'one palegis.us title document (a whole Pennsylvania Consolidated Statutes title, or the Constitution)'},
        'section_id': {'scheme': 'official_citation_path', 'regex': SECTION_REGEX, 'example': '18:2502',
                       'citation_format': '<title> Pa.C.S. § <section>; Pa. Const. art. <article>, § <section>'},
        'currency': {'basis': 'publisher_metadata',
                     'location': 'the <meta name="revised"> tag in the head of each title document, quoted verbatim'},
        'review': {'reviewed_by': 'Legal Source Atlas batch A worker bc-3f24d0ce', 'reviewed_at': '2026-10-06'},
    }


def good_receipts(fetcher):
    found = {}
    for r in fetcher.receipts():
        if (r.get('ok') and r.get('retrieval_method') == 'proxied:firecrawl' and r.get('source_status') == 200
                and re.search(r'iFrame=true&txtType=HTM&ttl=\d+$', r['url'])):
            body = fetcher.read(r).decode('utf8', 'replace')
            if body.rstrip().endswith('</html>') and '<div class="BodyContainer">' in body:
                found[r['url']] = r
    return found


def section_identity(ttl, section):
    if ttl == '00':
        top = section['hierarchy'][0]
        prefix = 'ART' if top['kind'] == 'ARTICLE' else 'SCH'
        return 'CONST:%s-%s.%s' % (prefix, top['number'], section['number'])
    return '%d:%s' % (int(ttl), section['number'])


def citation(ttl, section):
    if ttl == '00':
        top = section['hierarchy'][0]
        if top['kind'] == 'ARTICLE':
            return 'Pa. Const. art. %s, § %s' % (top['number'], section['number'])
        label = 'art. V, Schedule to Judiciary Article' if top['number'] == 'ART-V' else 'Schedule No. %s' % top['number']
        return 'Pa. Const. %s, § %s' % (label, section['number'])
    return '%d Pa.C.S. § %s' % (int(ttl), section['number'])


def build_unit(ttl, receipt, document, raw_bytes):
    parsed = parse.parse_title(document, ttl)
    text = parse.unit_text(parsed)
    offsets = parse.line_offsets(parsed['lines'])
    lines = parsed['lines']
    seen = collections.Counter()
    sections = []
    title_tag = parsed['title_tag'] or ''
    title_heading = (title_tag.split(' - ', 1)[1] if ' - ' in title_tag else title_tag).strip() or None
    for s in parsed['sections']:
        base = section_identity(ttl, s)
        seen[base] += 1
        path = base if seen[base] == 1 else '%s#%d' % (base, seen[base])
        start = offsets[s['first']]
        end = offsets[s['last'] - 1] + len(lines[s['last'] - 1])
        body = text[start:end]
        assert body == '\n'.join(lines[s['first']:s['last']])
        hierarchy = [{'level': d['kind'].lower(), 'number': d['number'], 'heading': d['heading']} for d in s['hierarchy']]
        if ttl != '00' and not any(h['level'] == 'title' for h in hierarchy):
            hierarchy.insert(0, {'level': 'title', 'number': str(int(ttl)), 'heading': title_heading})
        hierarchy.append({'level': 'section', 'number': s['number'], 'heading': s['heading']})
        bad = [h['level'] for h in hierarchy if h['level'] not in LEVELS]
        if bad:
            raise ValueError('level not in manifest: %s' % bad)
        sections.append({'citation_path': path, 'citation': citation(ttl, s), 'heading': s['heading'], 'text': body,
                         'history': s['history'], 'status_note': None, 'hierarchy': hierarchy,
                         'span': {'unit': 'unicode_code_points', 'start': start, 'end': end}})
    method, proxy = lv2.source_ref(receipt)
    heading = title_heading or ''
    statement = parsed['revised']
    currency = lv2.currency_block(statement, edition=None, through_date=None, basis='publisher_metadata') if statement else None
    return {'key': 'title-%s' % ttl if ttl != '00' else 'constitution', 'kind': 'title_document' if ttl != '00' else 'constitution_document',
            'heading': heading.strip() or None, 'text': text, 'sections': sections, 'sections_expected': len(sections),
            'currency': currency,
            'original': {'sha': receipt['sha256'], 'url': receipt['url'], 'retrieved_at': receipt['retrieved_at'],
                         'method': method, 'proxy': proxy, 'bytes_obj': raw_bytes},
            'anomalies': parsed['anomalies'], 'appendix_line': parsed['appendix_line'], 'ttl': ttl,
            'revised_value': parsed['revised_value']}


def build_all(fetcher, titles):
    receipts = good_receipts(fetcher)
    units, missing = [], []
    for ttl in titles:
        url = TITLE_URL % str(int(ttl))
        receipt = receipts.get(url)
        if not receipt:
            missing.append(ttl)
            continue
        raw = fetcher.read(receipt)
        units.append(build_unit(ttl, receipt, raw.decode('utf8'), raw))
    return units, missing
