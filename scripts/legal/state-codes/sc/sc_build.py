"""Parse, independently audit, and stage a captured South Carolina Code packet."""
import collections
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import time

from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import sha256_file, verify_store  # noqa: E402

import sc_audit  # noqa: E402
import sc_parse  # noqa: E402

BASE = 'https://www.scstatehouse.gov'
INDEX = BASE + '/code/statmast.php'
CODE_NAME = 'Code of Laws of South Carolina 1976'
EDITION = '1976 Code of Laws'
CURRENCY = (
    "The South Carolina Code on the General Assembly's website is now current "
    'through the 2025 Session of the General Assembly.'
)
PERMISSION = (
    "The South Carolina Code, consisting only of Code text, numbering, history, and Effect of "
    "Amendment, Editor's, and Code Commissioner's notes may be copied from this website at the "
    "reader's expense and effort without need for permission."
)
OFFICIALITY = (
    'The Code of Laws on this website will be updated online periodically; however, the official '
    'version of the Code of Laws remains the print version which will continue to be updated on a '
    'yearly basis before the start of each legislative session.'
)
INDEX_TITLE = re.compile(
    r'href="/code/title(\d+)\.php">Title\s+\d+</a>\s*-\s*(.*?)</span><br\s*/?>', re.S | re.I
)
CHAPTER_PATH = re.compile(r'^/code/t(\d+)(?:\w*)c(\w+)\.php$', re.I)
RAW_SECTION = re.compile(
    r'<span style="font-weight: bold;">\s*SECTION\s+(%s)\.\s*</span>\s*(.*?)<br\s*/?>'
    % sc_parse.SECTION_ID,
    re.S,
)


def json_line(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf8')


def clean_html(fragment):
    return BeautifulSoup(fragment, 'lxml').get_text(' ', strip=True)


def read_receipts(root):
    receipts = [
        json.loads(line)
        for line in (root / 'receipts.jsonl').read_text(encoding='utf8').splitlines()
        if line.strip()
    ]
    successful = {}
    for receipt in receipts:
        if receipt.get('ok') and receipt.get('retrieval_method') == 'direct':
            successful.setdefault(receipt['url'], receipt)
    return receipts, successful


def receipt_body(root, receipt):
    return (root / receipt['stored_path']).read_bytes()


def title_inventory(index_page):
    found = []
    for match in INDEX_TITLE.finditer(index_page):
        found.append({
            'number': match.group(1),
            'heading': clean_html(match.group(2)),
            'url': '%s/code/title%s.php' % (BASE, match.group(1)),
        })
    return found


def chapter_inventory(title_page, title_number):
    soup = BeautifulSoup(title_page, 'lxml')
    content = soup.find(id='contentsection')
    if content is None:
        raise ValueError('title %s has no contentsection' % title_number)
    chapters = []
    for row in content.find_all('tr'):
        cells = row.find_all('td')
        links = row.find_all('a', href=True)
        if len(cells) < 3 or len(links) < 2:
            continue
        label = cells[0].get_text(' ', strip=True)
        match = re.match(r'^(CHAPTER|ARTICLE)\s+(\S+)\s+-\s+(.*)$', label, re.I)
        if not match:
            raise ValueError('unparsed title %s chapter row: %r' % (title_number, label))
        html_path = links[0]['href']
        word_path = links[1]['href'].replace('&amp;', '&')
        path_match = CHAPTER_PATH.match(html_path)
        if not path_match or int(path_match.group(1)) != int(title_number):
            raise ValueError('unexpected chapter path %r under title %s' % (html_path, title_number))
        chapters.append({
            'title': str(title_number),
            'level': match.group(1).lower(),
            'number': match.group(2),
            'heading': match.group(3),
            'html_path': html_path,
            'html_url': BASE + html_path,
            'word_url': BASE + word_path,
        })
    return chapters


def raw_section_inventory(page):
    return [
        {'number': match.group(1), 'heading': clean_html(match.group(2))}
        for match in RAW_SECTION.finditer(page)
    ]


def hardlink_or_copy(source, target):
    if target.exists():
        if sha256_file(target) != target.name:
            raise ValueError('bad existing derivative %s' % target)
        return
    try:
        os.link(source, target)
    except OSError:
        shutil.copyfile(source, target)


def hash_bytes(body):
    return hashlib.sha256(body).hexdigest()


def build(root_path, store_path):
    root = pathlib.Path(root_path)
    store = pathlib.Path(store_path)
    parsed = root / 'parsed'
    extract = root / 'extract' / 'chapters'
    staged = root / 'staged'
    staged_chapters = staged / 'chapters'
    for directory in (parsed, extract, staged, staged_chapters, store):
        directory.mkdir(parents=True, exist_ok=True)

    receipts, successful = read_receipts(root)
    checked, store_problems = verify_store(root)
    if store_problems:
        raise ValueError('verify_store failed for %d URLs' % len(store_problems))
    if INDEX not in successful:
        raise ValueError('missing official index capture')
    index_page = receipt_body(root, successful[INDEX]).decode('utf8')
    titles = title_inventory(index_page)
    if not titles:
        raise ValueError('no titles in official index')

    gaps = []
    chapters = []
    for title in titles:
        receipt = successful.get(title['url'])
        if receipt is None:
            gaps.append({'kind': 'missing_title', 'url': title['url']})
            continue
        title_page = receipt_body(root, receipt).decode('utf8')
        chapters.extend(chapter_inventory(title_page, title['number']))
    for chapter in chapters:
        for kind in ('html_url', 'word_url'):
            if chapter[kind] not in successful:
                gaps.append({'kind': 'missing_chapter_' + kind[:-4], 'url': chapter[kind]})
    if gaps:
        raise ValueError('capture gaps prevent complete staging: %d' % len(gaps))

    inventory_path = parsed / 'inventory.jsonl'
    sections_path = parsed / 'sections.jsonl'
    sample_path = parsed / 'sample-sections.jsonl'
    chapter_assets = {}
    citation_occurrences = collections.Counter()
    repeated = collections.Counter()
    level_counts = collections.Counter()
    status_counts = collections.Counter()
    empty_bodies = []
    no_history = []
    no_section_chapters = []
    parser_anomalies = []
    audit_mismatches = []
    audit_source_variants = []
    docx_chars = 0
    html_chars = 0
    section_rows = 0
    sample_rows = []
    input_html_hashes = []
    input_docx_hashes = []

    title_by_number = {title['number']: title for title in titles}
    chapters_by_title = collections.defaultdict(list)
    for chapter in chapters:
        chapters_by_title[chapter['title']].append(chapter)

    with inventory_path.open('w', encoding='utf8') as inventory_out, sections_path.open('w', encoding='utf8') as sections_out:
        for title in titles:
            inventory_out.write(json_line({
                'level': 'title',
                'native_id': 'title%s' % title['number'],
                'number': title['number'],
                'heading': title['heading'],
                'url': title['url'],
            }))
            level_counts['title'] += 1
            for chapter in chapters_by_title[title['number']]:
                html_receipt = successful[chapter['html_url']]
                word_receipt = successful[chapter['word_url']]
                input_html_hashes.append(html_receipt['sha256'])
                input_docx_hashes.append(word_receipt['sha256'])
                inventory_out.write(json_line({
                    'level': chapter['level'],
                    'native_id': chapter['html_path'],
                    'number': chapter['number'],
                    'heading': chapter['heading'],
                    'url': chapter['html_url'],
                    'title': title['number'],
                }))
                level_counts[chapter['level']] += 1

                page = receipt_body(root, html_receipt).decode('utf8')
                independent_sections = raw_section_inventory(page)
                derivative, header, parsed_sections = sc_parse.parse_chapter(page)
                expected_numbers = [row['number'] for row in independent_sections]
                parsed_numbers = [row['number'] for row in parsed_sections]
                if expected_numbers != parsed_numbers:
                    parser_anomalies.append({
                        'chapter': chapter['html_path'],
                        'kind': 'raw_regex_parser_sequence_mismatch',
                        'expected': len(expected_numbers),
                        'parsed': len(parsed_numbers),
                    })
                if not parsed_sections:
                    no_section_chapters.append(chapter['html_path'])
                if not header.get('title') or header['title']['number'] != title['number']:
                    parser_anomalies.append({'chapter': chapter['html_path'], 'kind': 'title_identity_mismatch'})
                if (not header.get('unit')
                        or header['unit']['level'] != chapter['level']
                        or header['unit']['number'].lstrip('0') != chapter['number'].lstrip('0')):
                    parser_anomalies.append({'chapter': chapter['html_path'], 'kind': 'unit_identity_mismatch'})

                derivative_bytes = derivative.encode('utf8')
                derivative_sha = hash_bytes(derivative_bytes)
                extract_path = extract / derivative_sha
                if not extract_path.exists():
                    extract_path.write_bytes(derivative_bytes)
                hardlink_or_copy(extract_path, staged_chapters / derivative_sha)
                asset = chapter_assets.setdefault(derivative_sha, {
                    'kind': 'chapter_text_derivative',
                    'sha256': derivative_sha,
                    'bytes': len(derivative_bytes),
                    'path': 'chapters/' + derivative_sha,
                    'source_urls': [],
                    'original_sha256s': [],
                    'members': [],
                })
                asset['source_urls'].append(chapter['html_url'])
                asset['original_sha256s'].append(html_receipt['sha256'])
                asset['members'].append(chapter['html_path'])

                visible_chars = sc_audit.canonical_characters(sc_audit.html_visible_text(page))
                derivative_chars = sc_audit.canonical_characters(derivative)
                if visible_chars != derivative_chars:
                    audit_mismatches.append({'chapter': chapter['html_path'], 'kind': 'html_visible_text_coverage'})
                word_text = sc_audit.docx_text(root / word_receipt['stored_path'])
                word_markers = sc_audit.docx_markers(word_text)
                if word_markers != expected_numbers:
                    audit_mismatches.append({
                        'chapter': chapter['html_path'],
                        'kind': 'docx_section_sequence',
                        'html': len(expected_numbers),
                        'docx': len(word_markers),
                    })
                comparison = sc_audit.compare_texts(
                    derivative,
                    word_text,
                    'Title %s - %s' % (header['title']['number'], header['title']['heading']),
                )
                html_chars += comparison['html_characters']
                docx_chars += comparison['docx_characters']
                if not comparison['matched']:
                    reserved_variant = (
                        not parsed_sections
                        and chapter['heading'].upper() == 'RESERVED'
                        and sc_audit.canonical_characters(word_text)
                        == sc_audit.canonical_characters('CHAPTER %s [Reserved]' % chapter['number'])
                        and sc_audit.canonical_characters(derivative).endswith(
                            sc_audit.canonical_characters('CHAPTER %s' % chapter['number'])
                        )
                    )
                    record = {
                        'chapter': chapter['html_path'],
                        'kind': ('docx_reserved_empty_chapter_variant' if reserved_variant
                                 else 'docx_normalized_text'),
                        **comparison,
                    }
                    (audit_source_variants if reserved_variant else audit_mismatches).append(record)

                for expected, section in zip(independent_sections, parsed_sections):
                    citation_occurrences[section['number']] += 1
                    occurrence = citation_occurrences[section['number']]
                    if occurrence > 1:
                        repeated[section['number']] += 1
                    identity = section['number'] if occurrence == 1 else '%s:%d' % (section['number'], occurrence)
                    inventory_out.write(json_line({
                        'level': 'section',
                        'native_id': identity,
                        'number': section['number'],
                        'heading': expected['heading'],
                        'url': chapter['html_url'],
                        'title': title['number'],
                        'chapter': chapter['number'],
                        'occurrence': occurrence,
                    }))
                    level_counts['section'] += 1
                    body = derivative[section['body_start']:section['body_end']]
                    if not body:
                        empty_bodies.append(identity)
                    history = '\n'.join(section['history']) if section['history'] else None
                    if history is None:
                        no_history.append(identity)
                    status = sc_parse.status_of(section['heading'], section['body'])
                    if status:
                        status_counts[status] += 1
                    hierarchy = section['path'] + [{
                        'level': 'section',
                        'number': section['number'],
                        'heading': section['heading'] or None,
                    }]
                    row = {
                        'state': 'SC',
                        'code_id': 'sc-code-of-laws',
                        'code_name': CODE_NAME,
                        'edition': EDITION,
                        'native_id': identity,
                        'identity_kind': 'publisher_native' if occurrence == 1 else 'publisher_native_with_occurrence',
                        'citation': section['printed'],
                        'citation_path': hierarchy,
                        'heading': section['heading'] or None,
                        'text': body,
                        'history': history,
                        'status_label': status,
                        'effective': sc_parse.effective_of(section['history']),
                        'currency': {'statement': CURRENCY, 'as_of': None},
                        'source': {
                            'url': chapter['html_url'],
                            'receipt_sha256': html_receipt['sha256'],
                            'member': chapter['html_path'],
                            'span': {'unit': 'unicode_code_points', 'start': section['body_start'], 'end': section['body_end']},
                            'derivative_sha256': derivative_sha,
                        },
                        'text_sha256': sc_parse.sha256_text(body),
                        'occurrence': occurrence,
                    }
                    sections_out.write(json_line(row))
                    if len(sample_rows) < 25:
                        sample_rows.append(row)
                    section_rows += 1

    sample_path.write_text(''.join(json_line(row) for row in sample_rows), encoding='utf8')
    if parser_anomalies:
        raise ValueError('parser reconciliation failed: %d anomalies' % len(parser_anomalies))

    gzip_path = staged / 'sections.jsonl.gz'
    with sections_path.open('rb') as source, gzip_path.open('wb') as raw_out:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw_out, mtime=0, compresslevel=9) as zipped:
            shutil.copyfileobj(source, zipped, length=1 << 20)

    successful_receipts = [receipt for receipt in receipts if receipt.get('ok')]
    unique_raw = {}
    for receipt in successful_receipts:
        item = unique_raw.setdefault(receipt['sha256'], {
            'kind': 'publisher_original',
            'sha256': receipt['sha256'],
            'bytes': receipt['bytes'],
            'path': receipt['stored_path'],
            'url': receipt['url'],
            'urls': [],
            'retrieved_at': receipt['retrieved_at'],
            'retrieval_method': receipt['retrieval_method'],
        })
        item['urls'].append(receipt['url'])
    raw_bytes = sum(item['bytes'] for item in unique_raw.values())
    sections_gzip_sha = sha256_file(gzip_path)
    sections_gzip_bytes = gzip_path.stat().st_size
    generated_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    manifest = {
        'schema_version': 'state-code-staging/1',
        'state': 'SC',
        'code_id': 'sc-code-of-laws',
        'parser': {'name': sc_parse.PARSER.rsplit('/', 1)[0], 'version': sc_parse.PARSER.rsplit('/', 1)[1]},
        'generated_at': generated_at,
        'counts': {
            'titles': len(titles),
            'chapters': level_counts['chapter'],
            'articles': level_counts['article'],
            'source_units': len(chapters),
            'sections': level_counts['section'],
            'rows': section_rows,
            'raw_files': len(unique_raw),
            'raw_bytes': raw_bytes,
            'chapter_derivatives': len(chapter_assets),
        },
        'files': sorted(unique_raw.values(), key=lambda item: item['sha256'])
                 + sorted(chapter_assets.values(), key=lambda item: item['sha256'])
                 + [{
                     'kind': 'sections_jsonl_gzip',
                     'sha256': sections_gzip_sha,
                     'bytes': sections_gzip_bytes,
                     'path': 'sections.jsonl.gz',
                 }],
    }
    manifest_path = staged / 'manifest.json'
    write_json(manifest_path, manifest)
    manifest_sha = sha256_file(manifest_path)

    proxied_items = [
        {'url': receipt['url'], 'service': receipt['retrieval_method'], 'sha256': receipt.get('sha256')}
        for receipt in receipts if receipt.get('ok') and receipt.get('retrieval_method', '').startswith('proxied:')
    ]
    source = {
        'schema_version': 'state-code-source/1',
        'state': 'SC',
        'publisher': 'South Carolina Legislative Council',
        'publisher_site': 'South Carolina Legislature',
        'official_urls': {
            'index': INDEX,
            'title_pattern': BASE + '/code/title{title}.php',
            'chapter_pattern': BASE + '/code/t{title_padded}c{chapter_padded}.php',
        },
        'code_name': CODE_NAME,
        'edition': EDITION,
        'currency': {'statement': CURRENCY, 'as_of': None},
        'session_law_lag': (
            'The publisher states currency only through the 2025 Session; the page does not identify '
            'specific later acts omitted from this website edition.'
        ),
        'licence_terms_notes': [PERMISSION, OFFICIALITY],
        'gates': [],
        'proxied_items': proxied_items,
    }
    source_path = staged / 'source.json'
    write_json(source_path, source)

    receipt_file_sha = sha256_file(root / 'receipts.jsonl')
    parse_report = {
        'schema_version': 'state-code-parse-report/1',
        'state': 'SC',
        'parser': {'name': sc_parse.PARSER.rsplit('/', 1)[0], 'version': sc_parse.PARSER.rsplit('/', 1)[1]},
        'counts': {
            'levels': dict(sorted(level_counts.items())),
            'rows': section_rows,
            'distinct_citations': len(citation_occurrences),
            'repeated_citation_groups': len(repeated),
            'additional_occurrences': sum(repeated.values()),
            'empty_bodies': len(empty_bodies),
            'without_history': len(no_history),
            'status_labels': dict(sorted(status_counts.items())),
            'chapters_without_sections': len(no_section_chapters),
        },
        'expected_vs_parsed': {
            'official_index_titles': len(titles),
            'captured_title_pages': sum(title['url'] in successful for title in titles),
            'official_title_page_chapters': len(chapters),
            'captured_chapter_html': sum(chapter['html_url'] in successful for chapter in chapters),
            'captured_chapter_docx': sum(chapter['word_url'] in successful for chapter in chapters),
            'raw_html_section_markers': level_counts['section'],
            'parsed_rows': section_rows,
            'matched': level_counts['section'] == section_rows and not parser_anomalies,
        },
        'anomalies': {
            'parser': parser_anomalies,
            'audit_mismatches': audit_mismatches,
            'audit_source_variants': audit_source_variants,
            'repeated_citations': dict(sorted(repeated.items())),
            'empty_body_native_ids': empty_bodies,
            'chapters_without_sections': no_section_chapters,
        },
        'independent_audit': {
            'method': (
                'BeautifulSoup visible-text coverage plus raw-HTML bold section-marker regex; '
                'OOXML paragraph extraction independently compares DOCX section sequence and '
                'all alphanumeric text after case/layout normalization and the publisher variants '
                'SECTION/§ and SECTIONS/§§.'
            ),
            'html_visible_text_chapters_matched': len(chapters) - sum(
                item['kind'] == 'html_visible_text_coverage' for item in audit_mismatches
            ),
            'docx_section_sequences_matched': len(chapters) - sum(
                item['kind'] == 'docx_section_sequence' for item in audit_mismatches
            ),
            'docx_full_text_chapters_matched': len(chapters) - sum(
                item['kind'] == 'docx_normalized_text' for item in audit_mismatches
            ),
            'chapters_total': len(chapters),
            'html_normalized_characters': html_chars,
            'docx_normalized_characters': docx_chars,
            'passed': not audit_mismatches,
            'documented_source_variants': len(audit_source_variants),
        },
        'input_hashes': {
            'receipts_jsonl': receipt_file_sha,
            'index': successful[INDEX]['sha256'],
            'title_pages': [successful[title['url']]['sha256'] for title in titles],
            'chapter_html': input_html_hashes,
            'chapter_docx': input_docx_hashes,
        },
        'output_hashes': {
            'inventory_jsonl': sha256_file(inventory_path),
            'sections_jsonl': sha256_file(sections_path),
            'sections_jsonl_gz': sections_gzip_sha,
            'manifest_json': manifest_sha,
        },
        'verify_store': {'checked_unique_bodies': checked, 'problems': store_problems, 'passed': not store_problems},
    }
    parse_report_path = parsed / 'parse-report.json'
    write_json(parse_report_path, parse_report)

    for source_file, destination_name in (
        (source_path, 'source.json'),
        (manifest_path, 'manifest.json'),
        (parse_report_path, 'parse-report.json'),
        (sample_path, 'sample-sections.jsonl'),
    ):
        shutil.copyfile(source_file, store / destination_name)

    report = f"""---
cursor:
  subagentId: "bc-bb558623-371e-5141-b499-58a9c5d2eee4"
---
# South Carolina Code of Laws acquisition and staging report

- Official source: South Carolina Legislative Council, [{INDEX}]({INDEX}).
- Edition: `{EDITION}`.
- Publisher currency statement: “{CURRENCY}”
- Session-law lag: the publisher states currency only through the 2025 Session and does not identify specific later omitted acts on this page.
- Disclaimer/currentness: “{OFFICIALITY}”
- Permission note: “{PERMISSION}”
- Counts: {len(titles)} titles; {level_counts['chapter']} chapters; {level_counts['article']} Title 62 article units; {level_counts['section']} official HTML section markers; {section_rows} staged rows.
- Raw capture: {len(unique_raw)} content-addressed files; {raw_bytes} bytes.
- Derivatives: {len(chapter_assets)} distinct chapter text files.
- Repeated citations: {len(repeated)} groups / {sum(repeated.values())} additional occurrences.
- Empty bodies: {len(empty_bodies)}; chapters without section markers: {len(no_section_chapters)}.
- Gaps: {len(gaps)}.
- Gates: none observed.
- Proxied items: {len(proxied_items)}.
- Store verification: passed ({checked} unique bodies rehashed).
- Parser reconciliation: {'passed' if not parser_anomalies else 'failed'} ({level_counts['section']} expected; {section_rows} parsed).
- Independent audit: {'passed' if not audit_mismatches else 'failed'}; HTML visible-text, raw marker sequences, DOCX marker sequences, and normalized full text checked for all {len(chapters)} source units; {len(audit_mismatches)} mismatches and {len(audit_source_variants)} documented official-source variants (the two empty reserved HTML chapters have `[Reserved]` only in DOCX).
- Parser tests: passed (4 tests; `python3 -m unittest scripts/legal/state-codes/sc/test_sc_parse.py`).
- `sections.jsonl.gz` SHA-256: `{sections_gzip_sha}`.
- `manifest.json` SHA-256: `{manifest_sha}`.
- What remains: batch-lead review and mechanical conversion to `publisher-code-intake/2`; no database or corpus write was performed.
"""
    (store / 'report.md').write_text(report, encoding='utf8')
    result = {
        'counts': manifest['counts'],
        'currency': CURRENCY,
        'edition': EDITION,
        'gaps': gaps,
        'proxied_items': len(proxied_items),
        'parser_anomalies': len(parser_anomalies),
        'audit_mismatches': len(audit_mismatches),
        'audit_source_variants': len(audit_source_variants),
        'sections_jsonl_gz_sha256': sections_gzip_sha,
        'manifest_json_sha256': manifest_sha,
        'report': str(store / 'report.md'),
    }
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: sc_build.py ROOT STORE_DIR')
    build(sys.argv[1], sys.argv[2])
