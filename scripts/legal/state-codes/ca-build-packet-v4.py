#!/usr/bin/env python3
"""Build a private, lossless California packet directly from a verified ZIP.

Never selects a current statutory version, alters the archive, contacts a source,
or publishes data. Repeated citations retain the existing occurrence identities.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import ExitStack
import csv
import hashlib
import io
import json
from pathlib import Path
from urllib.parse import urlencode
import zipfile

from ca_caml_parser import render_caml
from ca_hierarchy import TABLES, build_payload, hierarchy_for, native_occurrences


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode('utf-8')).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def dump(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def json_line(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def build(archive_path, expected_sha256, capture_manifest, output):
    archive_path = Path(archive_path).resolve()
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError('Fresh versioned packet directory required')
    capture = json.loads(Path(capture_manifest).read_text(encoding='utf-8'))
    receipts = [item for item in capture['objects'] if item.get('sha256') == expected_sha256 and item.get('outcome') == 'captured']
    if len(receipts) != 1:
        raise ValueError('Exact unique successful publisher archive receipt required')
    receipt = receipts[0]
    if (receipt.get('status') != 200 or receipt.get('bytes') != archive_path.stat().st_size
            or file_hash(archive_path) != expected_sha256
            or receipt.get('finalUrl') != 'https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip'):
        raise ValueError('Publisher archive receipt/hash/URL mismatch')
    source = {'source_url': receipt['finalUrl'], 'retrieved_at': receipt['completedAt'],
              'http_status': 200, 'retrieval_method': 'publisher_bulk_download', 'proxy': None}
    currency = {'basis': 'publisher_metadata', 'edition': archive_path.name,
                'statement': 'Publisher export ' + archive_path.name + ' captured ' + receipt['completedAt'][:10] + '; compilation-through date and present legal effect not established.',
                'through_date': None}
    runtime_pins = {name: file_hash(Path(__file__).with_name(name)) for name in ('ca-build-packet-v4.py', 'ca_caml_parser.py', 'ca_hierarchy.py')}
    output.mkdir(parents=True)
    (output / 'code-text').mkdir()
    manifest = {
        'schema_version': 'publisher-code-manifest/2', 'jurisdiction': 'CA',
        'publisher': 'California Legislature (Legislative Counsel)',
        'publisher_url': 'https://leginfo.legislature.ca.gov/',
        'source_system': 'ca-leginfo-pubinfo', 'code_title': 'California Codes',
        'parser': {'name': 'california-pubinfo-xml', 'version': '4'},
        'retrieval': {'methods': ['publisher_bulk_download'], 'official_source': True,
                      'terms_gate': False, 'rate_limit_ms': 1000,
                      'source_url_patterns': [r'^https://downloads\.leginfo\.legislature\.ca\.gov/pubinfo_\d{4}\.zip$']},
        'structure': {'levels': ['code', 'division', 'title', 'part', 'chapter', 'article', 'heading', 'section'],
                      'unit': 'One code-specific lossless CAML text derivative; exact publisher node IDs and version-backed source ancestry; projection/4 required'},
        'section_id': {'scheme': 'official_citation_path', 'regex': r'^[A-Z]{2,5}:[^~]+(~[0-9]+)?$',
                       'example': 'CIV:1.', 'citation_format': '<lawCode>:<sectionNum> (~N for separate repeated publisher occurrences)'},
        'currency': {'basis': 'publisher_metadata', 'location': currency['statement']},
        'review': {'reviewed_by': 'whole retained ZIP source reconciliation; present legal effect not certified', 'reviewed_at': '2026-10-12'},
    }
    objects = [{'sha256': expected_sha256, 'bytes': receipt['bytes'], 'kind': 'publisher_original',
                'path': str(archive_path), 'sources': [source]}]
    counts, offsets, transforms = Counter(), Counter(), Counter()
    attachments, source_members = [], []
    with ExitStack() as stack:
        archive = stack.enter_context(zipfile.ZipFile(archive_path))
        names = archive.namelist()
        actual = {name.upper(): name for name in names}
        if len(actual) != len(names):
            raise ValueError('Duplicate case-insensitive source member')
        tables = {}
        for name in TABLES:
            raw = archive.read(name)
            source_members.append({'member': name, 'sha256': digest(raw), 'bytes': len(raw)})
            tables[name] = list(csv.reader(io.StringIO(raw.decode('utf-8', 'strict')), delimiter='\t', quotechar='`'))
        hierarchy = build_payload(tables['CODES_TBL.dat'], tables['LAW_TOC_TBL.dat'], tables['LAW_SECTION_TBL.dat'], tables['LAW_TOC_SECTIONS_TBL.dat'])
        references = {row[11].strip(): row for row in tables['LAW_TOC_SECTIONS_TBL.dat']}
        sections = stack.enter_context((output / 'sections.jsonl').open('x', encoding='utf-8', newline='\n'))
        handles = {}
        for native_id, row in native_occurrences(tables['LAW_SECTION_TBL.dat']):
            code, number, version = row[1].strip(), row[2].strip(), row[7].strip()
            member = actual.get(row[14].strip().upper())
            if member is None:
                raise ValueError('Missing publisher member: ' + native_id)
            raw = archive.read(member)
            rendered = render_caml(raw)
            text = rendered['text']
            if not text.strip():
                raise ValueError('No source text: ' + native_id)
            if code not in handles:
                handles[code] = stack.enter_context((output / 'code-text' / (code + '.txt')).open('xb'))
            if counts[code]:
                handles[code].write(b'\n\n')
                offsets[code] += 2
            start = offsets[code]
            handles[code].write(text.encode('utf-8'))
            offsets[code] += len(text)
            counts[code] += 1
            transforms.update(rendered['insertions'])
            path = native_id.removeprefix('CA:')
            status = []
            if row[15].strip() != 'Y':
                status.append('Publisher ACTIVE_FLG=' + row[15].strip() + '; legal effect not independently verified.')
            if rendered['tipIns']:
                attachments.append({'native_id': native_id, 'member': member, 'member_sha256': digest(raw), 'tip_ins': rendered['tipIns']})
                status.append('Publisher XML contains ' + str(len(rendered['tipIns'])) + ' TipIn attachment placeholder(s); supplemental graphic/form content is not present in this text export. Consult the official source.')
            ancestry = hierarchy_for(hierarchy, native_id, row, include_node_ids=True)
            heading = references[version][5].strip() or None
            ancestry[-1]['heading'] = heading
            locator = {'archive_sha256': expected_sha256, 'member': member, 'member_sha256': digest(raw),
                       'native_row_id': row[0].strip(), 'section_version_id': version, 'citation_path': path,
                       'display_url': 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?' + urlencode({'lawCode': code, 'sectionNum': number}),
                       'display_url_retrieved': False}
            json_line(sections, {'citation_path': path, 'citation': code + ' § ' + number,
                      'heading': heading, 'text': text, 'unit_key': 'code-' + code,
                      'span': {'unit': 'unicode_code_points', 'start': start, 'end': offsets[code]},
                      'hierarchy': ancestry, 'history': row[13].strip() or None,
                      'status_note': ' '.join(status) or None, 'currency': currency,
                      'source_locator': locator})
    with (output / 'units.jsonl').open('x', encoding='utf-8', newline='\n') as units:
        for code in sorted(counts):
            path = output / 'code-text' / (code + '.txt')
            text_sha = file_hash(path)
            objects.append({'sha256': text_sha, 'bytes': path.stat().st_size, 'kind': 'unit_text_derivative',
                            'path': str(path), 'code_points': offsets[code], 'sources': [source]})
            json_line(units, {'unit_key': 'code-' + code, 'unit_kind': 'publisher_code_export',
                              'heading': hierarchy['codes'][code], 'original_sha256': expected_sha256,
                              'publisher_member': None, 'raw_member_sha256': None,
                              'text_sha256': text_sha, 'text_code_points': offsets[code],
                              'sections_expected': counts[code], 'currency': currency,
                              **{key: value for key, value in source.items() if key != 'http_status'}})
    with (output / 'objects.jsonl').open('x', encoding='utf-8', newline='\n') as assets:
        for item in objects:
            json_line(assets, item)
    dump(output / 'manifest.json', manifest)
    dump(output / 'gaps.json', [])  # Every publisher section is retained; attachment gaps are explicit below.
    dump(output / 'source-attachment-gaps.json', attachments)
    dump(output / 'toc-proof.json', {'marker': 'Exact LAW_SECTION_TBL to LAW_TOC_SECTIONS_TBL version bijection; original XML member CRC/hash and lossless text traversal for every occurrence',
                                   'pages': [{'url': source['source_url'], 'markers': sum(counts.values()), 'sections': sum(counts.values())}],
                                   'unfetched_child_pages': []})
    report = {'schema_version': 'california-lossless-packet/4', 'archive_sha256': expected_sha256,
              'source_members': source_members, 'runtime_pins': runtime_pins, 'sections': sum(counts.values()),
              'units': len(counts), 'objects': len(objects), 'per_code': dict(sorted(counts.items())),
              'transformations': dict(transforms), 'attachment_gap_sections': len(attachments),
              'attachment_placeholders': sum(len(row['tip_ins']) for row in attachments),
              'missing_ancestor_headings': 0, 'section_metadata_sha256': hierarchy['section_metadata_sha256'],
              'sections_sha256': file_hash(output / 'sections.jsonl'),
              'projection_contract_required': 'publisher-code-projection/4',
              'publication_allowed': False, 'calculation_activation_allowed': False, 'current_law_verified': False,
              'scope': 'Complete retained publisher XML section inventory with explicit attachment gaps; dated source capture, not current-law certification.'}
    dump(output / 'packet-report.json', report)
    return report


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--archive', type=Path, required=True)
    ap.add_argument('--expected-sha256', required=True)
    ap.add_argument('--capture-manifest', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    print(json.dumps(build(args.archive, args.expected_sha256, args.capture_manifest, args.out), indent=2))
