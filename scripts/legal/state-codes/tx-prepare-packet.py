"""Freeze verified publisher evidence for private intake; never publish or upload.

Chapter text is stored once by its whole-file hash. Section occurrences reference
Unicode-code-point spans in that exact derivative; identical citations in distinct
publisher members remain distinct. New database intake support is required.
"""
import collections
import hashlib
import json
import pathlib
import sys

SCHEMA = 'publisher-code-evidence/1'
SOURCE = 'texas-legislature-code'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    def check(item):
        if item is None or isinstance(item, bool):
            return
        if isinstance(item, str):
            if '\x00' in item or any(0xd800 <= ord(c) <= 0xdfff for c in item):
                raise ValueError('Unsupported JSON string')
        elif isinstance(item, int):
            if abs(item) > 9007199254740991:
                raise ValueError('Unsafe JSON integer')
        elif isinstance(item, list):
            for child in item:
                check(child)
        elif isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or any(ord(c) < 32 or ord(c) > 126 for c in key):
                    raise ValueError('Non-ASCII field name')
                check(child)
        else:
            raise ValueError('Unsupported canonical value')
    check(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf8')


def envelope(kind, identity, data, chapter):
    if not identity or len(identity) > 512:
        raise ValueError('Invalid composite source identity')
    data = dict(data, jurisdiction='TX', public_projection_allowed=False,
                current_law_verified=False, calculation_activation_allowed=False)
    return {'schema_version': SCHEMA, 'source_system': SOURCE, 'entity_type': kind,
            'native_id': identity, 'data': data,
            'provenance': {'source_url': chapter['archive_source_url'],
                           'source_sha256': chapter['archive_sha256'],
                           'publisher_member': chapter['publisher_member'],
                           'raw_member_sha256': chapter['raw_member_sha256'],
                           'retrieved_at': chapter['retrieved_at'], 'source_as_of': None,
                           'retrieval_method': 'publisher_zip_member',
                           'record_hash_codec': 'canonical-integer-jsonb/1',
                           'record_sha256': sha(canonical(data)),
                           'parser': chapter['parser']}}


def section_record(section, chapter, text):
    start, end = section['text_start'], section['text_end']
    if (not isinstance(start, int) or not isinstance(end, int)
            or not 0 <= start < end <= len(text)
            or sha(text[start:end].encode('utf8')) != section['text_sha256']
            or section['chapter_text_sha256'] != chapter['text_sha256']
            or section['archive_sha256'] != chapter['archive_sha256']
            or section['raw_member_sha256'] != chapter['raw_member_sha256']):
        raise ValueError('Section span or retained source mismatch')
    if (type(section['occurrence']) is not int or section['occurrence'] < 1
            or section['chapter_id'] != chapter['id']
            or section['native_citation_key'] != chapter['code'] + ':' + section['native_section_anchor']
            or section['id'] != chapter['id'] + ':' + section['native_section_anchor'] + ':' + str(section['occurrence'])):
        raise ValueError('Composite occurrence identity mismatch')
    data = {
        'identity_kind': 'publisher_member_anchor_occurrence',
        'publisher_native_entity': False,
        'chapter_identity': chapter['id'], 'code': chapter['code'],
        'native_citation_key': section['native_citation_key'],
        'native_section_anchor': section['native_section_anchor'],
        'occurrence': section['occurrence'], 'citation_heading': section['citation_heading'],
        'publisher_section_url': section['source_url'],
        'identity_evidence': section['identity_evidence'],
        'anchor_whitespace_anomaly': section['anchor_whitespace_anomaly'],
        'publisher_filename_legacy_hint': chapter['publisher_filename_legacy_hint'],
        'hierarchy': section['hierarchy'],
        'text_sha256': section['text_sha256'],
        'text_derivative_sha256': chapter['text_sha256'],
        'text_span': {'unit': 'unicode_code_points', 'start': start, 'end': end},
        'following_context_start': section['following_context_start'],
    }
    if section.get('subdivisions'):
        for child in section['subdivisions']:
            a, b = child['text_start'], child['text_end']
            if type(a) is not int or type(b) is not int or not start <= a < b <= end or text[a:b] != child['label']:
                raise ValueError('Subdivision outside verified parent text')
        data['subdivisions'] = section['subdivisions']
        data['subdivision_span_unit'] = 'unicode_code_points'
    return envelope('code-section-occurrence', section['id'], data, chapter)


def main(root, destination, parser_version='5'):
    root = pathlib.Path(root).resolve()
    destination = pathlib.Path(destination).resolve()
    if root not in destination.parents:
        raise ValueError('Packet must be a new directory under its source evidence root')
    if parser_version != '5':
        raise ValueError('Parser v5 required: prior derivatives clip embedded compound statutes')
    parsed = root / ('parsed-v' + parser_version)
    audit_file = root / ('parser-v' + parser_version + '-comparison-audit.json')
    audit = json.loads(audit_file.read_bytes())
    if audit.get('outcome') != 'passed' or audit.get('parser') != 'texas-publisher-html/5':
        raise ValueError('Successful v5 subdivision audit required')
    summary = json.loads((parsed / 'summary.json').read_bytes())
    if summary['parser'] != 'texas-publisher-html/' + parser_version or summary['parse_failures']:
        raise ValueError('Verified parser output required')
    for name in ['chapters', 'sections']:
        if sha((parsed / (name + '.jsonl')).read_bytes()) != audit[name + '_jsonl_sha256']:
            raise ValueError('Audited derivative changed')
    chapters = {}
    for line in (parsed / 'chapters.jsonl').read_text(encoding='utf8').splitlines():
        row = json.loads(line)
        if row['id'] in chapters:
            raise ValueError('Duplicate chapter identity')
        chapters[row['id']] = row
    destination.mkdir(exist_ok=False)
    assets, texts, batches, batch, size = {}, {}, [], [], 2
    counts = collections.Counter()

    def asset(file, digest, expected_bytes, kind):
        resolved = file.resolve()
        if root not in resolved.parents or file.is_symlink():
            raise ValueError('Asset escapes source evidence directory')
        raw = file.read_bytes()
        if sha(raw) != digest or len(raw) != expected_bytes:
            raise ValueError('Asset hash or length mismatch')
        old = assets.get(digest)
        if old and old['bytes'] != len(raw):
            raise ValueError('Content identity conflict')
        if not old:
            assets[digest] = {'path': str(file), 'sha256': digest, 'bytes': len(raw),
                              'kind': kind, 'source_references': []}
        return raw

    def flush():
        nonlocal batch, size
        if not batch:
            return
        raw = b'[' + b','.join(batch) + b']'
        name = f'batch-{len(batches):05d}.json'
        (destination / name).write_bytes(raw)
        batches.append({'file': name, 'records': len(batch), 'bytes': len(raw), 'sha256': sha(raw)})
        batch, size = [], 2

    def append(record):
        nonlocal size
        raw = canonical(record)
        if len(raw) + 2 > 1_900_000:
            raise ValueError('One record exceeds bounded intake size')
        if len(batch) >= 500 or size + len(raw) + 1 > 1_900_000:
            flush()
        batch.append(raw)
        size += len(raw) + 1
        counts[record['entity_type']] += 1

    for code in sorted({c['code'] for c in chapters.values()}):
        receipt = json.loads((root / 'receipts' / (code + '.json')).read_bytes())
        if receipt['source_url'] != f'https://tcss.legis.texas.gov/resources/Zips/{code}.htm.zip' or receipt['http_status'] != 200:
            raise ValueError('Publisher archive receipt mismatch')
        asset(root / receipt['raw_file'], receipt['sha256'], receipt['bytes'], 'publisher_archive')
        assets[receipt['sha256']]['source_references'].append(receipt)
    for identity, chapter in chapters.items():
        raw = asset(root / chapter['text_file'], chapter['text_sha256'], chapter['text_bytes'], 'chapter_text_derivative')
        texts[identity] = raw.decode('utf8')
        assets[chapter['text_sha256']]['source_references'].append({'chapter_identity': identity,
            'archive_sha256': chapter['archive_sha256'], 'raw_member_sha256': chapter['raw_member_sha256'],
            'parser': chapter['parser']})
        data = {key: chapter[key] for key in ['code', 'code_name', 'publisher_member',
            'raw_member_sha256', 'raw_member_bytes', 'archive_sha256', 'text_sha256',
            'text_bytes', 'section_occurrences', 'publisher_filename_legacy_hint']}
        data.update(identity_kind='publisher_code_and_member_filename', publisher_native_entity=False)
        append(envelope('code-chapter-document', identity, data, chapter))
    seen = set()
    for line in (parsed / 'sections.jsonl').read_text(encoding='utf8').splitlines():
        section = json.loads(line)
        if section['id'] in seen:
            raise ValueError('Repeated occurrence identity')
        seen.add(section['id'])
        chapter = chapters[section['chapter_id']]
        append(section_record(section, chapter, texts[chapter['id']]))
    flush()
    if counts['code-section-occurrence'] != summary['section_occurrences'] or counts['code-chapter-document'] != summary['parsed_members']:
        raise ValueError('Packet counts do not match verified parse')
    asset_raw = canonical(list(assets.values()))
    (destination / 'assets.json').write_bytes(asset_raw)
    manifest = {'schema_version': 'publisher-code-private-packet/1', 'project_id': 'xosqzzsnhxcyehcnirpa',
        'source_system': SOURCE, 'parser': summary['parser'], 'counts': dict(counts),
        'batches': batches, 'assets': {'file': 'assets.json', 'sha256': sha(asset_raw),
          'unique_objects': len(assets), 'unique_bytes': sum(a['bytes'] for a in assets.values())},
        'input_audit_sha256': sha(audit_file.read_bytes()),
        'registered': False, 'published': False, 'cloud_verified': False,
        'requires': ['Whole-object cloud verification and private source registration',
                     'Dedicated publisher-code corpus_ingest wrapper and actual open run',
                     'Independent publication review; no held collection release',
                     'Separate primary-authority review before calculator activation']}
    encoded = canonical(manifest)
    (destination / 'manifest.json').write_bytes(encoded)
    print(json.dumps({'counts': dict(counts), 'batches': len(batches), 'unique_assets': len(assets),
        'unique_asset_bytes': manifest['assets']['unique_bytes'], 'manifest_sha256': sha(encoded),
        'registered': False, 'published': False}))


if __name__ == '__main__':
    main(*sys.argv[1:])
