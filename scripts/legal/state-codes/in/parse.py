"""Parse the official 2026 Indiana Code HTML archive into staging JSONL."""
import argparse
import hashlib
import json
import pathlib
import re
import zipfile

from bs4 import BeautifulSoup, Tag

ARCHIVE_URL = 'https://iga.in.gov/ic/2026/2026-Indiana-Code-html.zip'
CURRENCY = (
    'The 2026 Indiana Code is now available online. This version has been updated '
    'through the 2026 regular session. Consult the 2026 Table of Citations pdf '
    'document for specific effective dates.'
)
LEVELS = ('title', 'article', 'chapter', 'section')
MEMBER_RE = re.compile(r'/(\d+)\.html$')
STATUS_RE = re.compile(r'^(Repealed|Expired|Reserved|Vacant|Renumbered)\b', re.I)
EFFECTIVE_RE = re.compile(r'\[EFFECTIVE[^\]]+\]', re.I)
EFFECTIVE_NOTE_RE = re.compile(
    r"^(?:Note:|Revisor's Note:).*\b(?:effective|expires?|expiration)\b.*$",
    re.I,
)
SECTION_MARKER_RE = re.compile(br'<div\s+class=["\']section["\']', re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized_text(node):
    text = node.get_text('', strip=False).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def heading(node):
    value = node.find('span', id='shortdescription')
    return normalized_text(value) if value else ''


def official_number(node):
    value = node.find('span', id='ic_number')
    text = normalized_text(value) if value else ''
    return re.sub(r'^IC\s+', '', text).strip()


def component(native_id, parent_id):
    prefix = parent_id + '-'
    if not native_id.startswith(prefix):
        raise ValueError(f'{native_id} is not below {parent_id}')
    return native_id[len(prefix):]


def toc_entries(soup):
    """Return navigation entries independently from the structural heading scan."""
    found = {}
    for link in soup.find_all('a', href=True):
        parent = link.parent
        if not isinstance(parent, Tag) or 'width: 150px' not in (parent.get('style') or ''):
            continue
        href = link['href']
        if href.startswith('#') and len(href) > 1:
            link_text = normalized_text(link)
            if link_text.startswith('Art.'):
                level = 'article'
            elif link_text.startswith('Ch.'):
                level = 'chapter'
            else:
                level = 'section'
            container = parent.parent
            spans = container.find_all('span', recursive=False) if isinstance(container, Tag) else []
            description = normalized_text(spans[-1]) if len(spans) > 1 else ''
            found[href[1:]] = {'level': level, 'heading': description}
    return found


def structural_nodes(soup):
    return [
        node for node in soup.find_all('div')
        if any(level in (node.get('class') or []) for level in LEVELS)
    ]


def section_parts(node):
    """Extract body/history until the next structural heading."""
    body = []
    history = []
    for sibling in node.next_siblings:
        if isinstance(sibling, Tag) and sibling.name == 'div' and any(
                level in (sibling.get('class') or []) for level in LEVELS):
            break
        if not isinstance(sibling, Tag) or sibling.name != 'p':
            continue
        text = normalized_text(sibling)
        if not text:
            continue
        italic = sibling.find('i')
        if italic and normalized_text(italic) == text:
            history.append(text)
        else:
            body.append(text)
    return '\n'.join(body), '\n'.join(history) or None


def parse_member(data, member, archive_sha):
    soup = BeautifulSoup(data, 'lxml')
    navigation = toc_entries(soup)
    inventory = []
    sections = []
    context = {}
    structural_ids = set()
    level_counts = {level: 0 for level in LEVELS}
    for node in structural_nodes(soup):
        level = next(level for level in LEVELS if level in (node.get('class') or []))
        anchor_id = node.get('id')
        if not anchor_id:
            raise ValueError(f'{member}: {level} without id')
        number = official_number(node)
        if not number:
            raise ValueError(f'{member}: {level} without official number')
        structural_ids.add(anchor_id)
        level_counts[level] += 1
        title_text = heading(node)
        context[level] = {'id': anchor_id, 'number': number, 'heading': title_text}
        for child in LEVELS[LEVELS.index(level) + 1:]:
            context.pop(child, None)
        inventory.append({
            'state': 'IN',
            'level': level,
            'native_id': anchor_id,
            'official_number': number,
            'heading': title_text,
            'member': member,
            'url': ARCHIVE_URL,
        })
        if level != 'section':
            continue
        required = ('title', 'article', 'chapter', 'section')
        if any(key not in context for key in required):
            raise ValueError(f'{member}: incomplete hierarchy at {native_id}')
        title_id = context['title']['number']
        article_id = context['article']['number']
        chapter_id = context['chapter']['number']
        native_id = context['section']['number']
        body, history = section_parts(node)
        status_match = STATUS_RE.match(title_text)
        combined_text = body + '\n' + (history or '')
        effective_values = EFFECTIVE_RE.findall(combined_text)
        effective_values.extend(
            line for line in combined_text.splitlines() if EFFECTIVE_NOTE_RE.match(line)
        )
        sections.append({
            'state': 'IN',
            'code_id': 'in-code',
            'code_name': 'Indiana Code',
            'edition': '2026 Indiana Code',
            'native_id': native_id,
            'identity_kind': 'publisher_native_id',
            'citation': 'IC ' + native_id,
            'citation_path': [
                {'level': 'title', 'number': title_id,
                 'heading': context['title']['heading']},
                {'level': 'article', 'number': component(article_id, title_id),
                 'heading': context['article']['heading']},
                {'level': 'chapter', 'number': component(chapter_id, article_id),
                 'heading': context['chapter']['heading']},
                {'level': 'section', 'number': component(native_id, chapter_id),
                 'heading': title_text},
            ],
            'heading': title_text,
            'text': body,
            'history': history,
            'status_label': status_match.group(1).title() if status_match else None,
            'effective': '; '.join(dict.fromkeys(effective_values)) or None,
            'currency': {'statement': CURRENCY, 'as_of': None},
            'source': {
                'url': ARCHIVE_URL,
                'receipt_sha256': archive_sha,
                'parent_archive_sha256': archive_sha,
                'member': member,
                'anchor': anchor_id,
                'raw_member_sha256': digest(data),
                'span': None,
            },
            'text_sha256': digest(body.encode()),
            'occurrence': 1,
        })
    structural_non_title = {
        row['native_id'] for row in inventory if row['level'] != 'title'
    }
    navigation_ids = set(navigation)
    for native_id in sorted(navigation_ids - structural_non_title):
        entry = navigation[native_id]
        inventory.append({
            'state': 'IN',
            'level': entry['level'],
            'native_id': native_id,
            'official_number': native_id,
            'heading': entry['heading'],
            'member': member,
            'url': ARCHIVE_URL,
            'inventory_basis': 'toc_only_no_structural_body',
        })
    return {
        'inventory': inventory,
        'sections': sections,
        'counts': level_counts,
        'toc_ids': navigation_ids,
        'structural_non_title_ids': structural_non_title,
        'toc_only_ids': navigation_ids - structural_non_title,
        'regex_section_count': len(SECTION_MARKER_RE.findall(data)),
    }


def find_archive_receipt(root):
    receipts = [
        json.loads(line) for line in (root / 'receipts.jsonl').read_text().splitlines()
        if line.strip()
    ]
    matches = [
        item for item in receipts
        if item.get('ok') and item.get('url') == ARCHIVE_URL
        and item.get('headers', {}).get('Content-Type', '').startswith('application/zip')
    ]
    if not matches:
        raise SystemExit('official HTML archive receipt not found')
    return matches[-1]


def json_line(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/tmp/sc/IN')
    args = parser.parse_args(argv)
    root = pathlib.Path(args.root)
    parsed_dir = root / 'parsed'
    titles_dir = root / 'staged' / 'titles'
    parsed_dir.mkdir(parents=True, exist_ok=True)
    titles_dir.mkdir(parents=True, exist_ok=True)
    receipt = find_archive_receipt(root)
    archive_path = root / receipt['stored_path']

    counts = {level: 0 for level in LEVELS}
    audit_regex = 0
    audit_toc = 0
    anomalies = []
    seen = {}
    repeated = []
    empty_bodies = 0
    members_report = []
    inventory_rows = 0
    gaps = []
    with zipfile.ZipFile(archive_path) as archive, \
            (parsed_dir / 'inventory.jsonl').open('w', encoding='utf8') as inventory_out, \
            (parsed_dir / 'sections.jsonl').open('w', encoding='utf8') as sections_out:
        bad_member = archive.testzip()
        if bad_member:
            raise SystemExit(f'ZIP CRC failure: {bad_member}')
        members = sorted(
            (item for item in archive.infolist() if MEMBER_RE.search(item.filename)),
            key=lambda item: int(MEMBER_RE.search(item.filename).group(1)),
        )
        title_numbers = [int(MEMBER_RE.search(item.filename).group(1)) for item in members]
        expected = list(range(min(title_numbers), max(title_numbers) + 1))
        if title_numbers != expected:
            anomalies.append({'kind': 'title-sequence', 'observed': title_numbers})
        for info in members:
            data = archive.read(info)
            result = parse_member(data, info.filename, receipt['sha256'])
            for row in result['inventory']:
                inventory_out.write(json_line(row))
                inventory_rows += 1
            title_sections = result['sections']
            derivative_parts = []
            position = 0
            for row in title_sections:
                occurrence = seen.get(row['native_id'], 0) + 1
                seen[row['native_id']] = occurrence
                row['occurrence'] = occurrence
                if occurrence > 1:
                    row['native_id'] += f'#{occurrence}'
                    row['identity_kind'] = 'publisher_native_id_with_occurrence'
                    repeated.append(row['citation'])
                if not row['text'] and not row['status_label']:
                    empty_bodies += 1
                if derivative_parts:
                    position += 2
                start = position
                derivative_parts.append(row['text'])
                position += len(row['text'])
                row['source']['span'] = {'unit': 'unicode_code_points',
                                         'start': start, 'end': position}
            derivative = '\n\n'.join(derivative_parts)
            derivative_bytes = derivative.encode()
            derivative_sha = digest(derivative_bytes)
            derivative_path = titles_dir / f'{derivative_sha}.txt'
            if not derivative_path.exists():
                derivative_path.write_bytes(derivative_bytes)
            for row in title_sections:
                row['source']['unit_text_sha256'] = derivative_sha
                sections_out.write(json_line(row))
            for level, value in result['counts'].items():
                counts[level] += value
            audit_regex += result['regex_section_count']
            audit_toc += len(result['toc_ids'])
            missing_toc = sorted(result['structural_non_title_ids'] - result['toc_ids'])
            extra_toc = sorted(result['toc_ids'] - result['structural_non_title_ids'])
            gaps.extend({
                'kind': 'toc-listed-without-structural-body',
                'member': info.filename,
                'native_id': native_id,
            } for native_id in extra_toc)
            if missing_toc or extra_toc:
                anomalies.append({
                    'kind': 'toc-structural-mismatch',
                    'member': info.filename,
                    'missing_from_toc': missing_toc,
                    'extra_in_toc': extra_toc,
                })
            members_report.append({
                'member': info.filename,
                'bytes': info.file_size,
                'crc32': f'{info.CRC:08x}',
                'raw_member_sha256': digest(data),
                'unit_text_sha256': derivative_sha,
                'unit_text_bytes': len(derivative_bytes),
                'counts': result['counts'],
            })

    inventory_path = parsed_dir / 'inventory.jsonl'
    sections_path = parsed_dir / 'sections.jsonl'
    report = {
        'schema_version': 'publisher-code-parse-report/2',
        'status': 'parsed',
        'parser': {'name': 'indiana-official-html', 'version': '1.0.0'},
        'counts': {
            'titles': counts['title'],
            'articles': counts['article'],
            'chapters': counts['chapter'],
            'sections': counts['section'],
            'rows': counts['section'],
        },
        'expected_vs_parsed': {
            'inventory_rows': inventory_rows,
            'parsed_sections': counts['section'],
            'expected_sections': counts['section'] + sum(
                gap['kind'] == 'toc-listed-without-structural-body' for gap in gaps
            ),
            'title_members': len(members_report),
            'title_sequence': [1, 37],
            'gaps': gaps,
        },
        'anomalies': anomalies,
        'repeated_citations': repeated,
        'empty_bodies_without_status': empty_bodies,
        'members': members_report,
        'input_hashes': {'html_archive': receipt['sha256']},
        'output_hashes': {
            'inventory.jsonl': digest(inventory_path.read_bytes()),
            'sections.jsonl': digest(sections_path.read_bytes()),
        },
        'independent_audit': {
            'method': 'raw-byte section-marker regex and navigation-anchor id set',
            'raw_section_markers': audit_regex,
            'parsed_sections': counts['section'],
            'toc_non_title_ids': audit_toc,
            'structural_non_title_ids': (
                counts['article'] + counts['chapter'] + counts['section']
            ),
            'section_count_match': audit_regex == counts['section'],
            'toc_mismatch_members': sum(
                item['kind'] == 'toc-structural-mismatch' for item in anomalies
            ),
        },
    }
    (parsed_dir / 'parse-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    )
    print(json.dumps(report['counts'], sort_keys=True))
    print(json.dumps(report['independent_audit'], sort_keys=True))


if __name__ == '__main__':
    main()
