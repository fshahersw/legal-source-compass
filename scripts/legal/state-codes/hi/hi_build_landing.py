#!/usr/bin/env python3
"""Build publisher-code-intake/2 landing packet for Hawaii (one unit per section .htm)."""
import gzip
import hashlib
import json
import os
from pathlib import Path

ROOT = Path('/tmp/sc/HI')
LANDING = ROOT / 'landing'
STAGED = ROOT / 'staged'
REGEX = r'^[A-Z0-9_-]+(?:#\d+)?$'
CURRENCY = {'statement': 'Hawaii Revised Statutes 2025', 'through_date': None, 'basis': 'publisher_statement', 'edition': 'Hawaii Revised Statutes 2025'}


def norm_currency(row):
    cur = dict(CURRENCY)
    if row.get('currency'):
        cur.update({k: v for k, v in row['currency'].items() if v is not None or k == 'through_date'})
    return cur


def jl(path):
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def unit_body(row):
    parts = []
    if row.get('citation'):
        parts.append(row['citation'])
    if row.get('heading'):
        parts.append(row['heading'])
    if row.get('status_label'):
        parts.append(row['status_label'])
    if row.get('text'):
        parts.append(row['text'])
    if row.get('history'):
        parts.append(row['history'])
    return ('\n'.join(parts) + '\n').encode('utf-8')


def main():
    LANDING.mkdir(parents=True, exist_ok=True)
    STAGED.mkdir(parents=True, exist_ok=True)
    chapters = STAGED / 'chapters'
    chapters.mkdir(parents=True, exist_ok=True)
    receipts = {}
    for r in jl(ROOT / 'receipts.jsonl'):
        if r.get('ok') and r.get('sha256'):
            receipts.setdefault(r['sha256'], r)

    gaps_path = LANDING / 'gaps.jsonl'
    gapf = gaps_path.open('w', encoding='utf-8')
    units = {}
    sections_out = []
    objects = {}
    seen_cp = {}

    for row in jl(ROOT / 'parsed/sections.jsonl'):
        src = row['source']
        orig = src['receipt_sha256']
        member = src['member']
        if not (row.get('text') or '').strip() and not row.get('status_label'):
            gapf.write(json.dumps({'kind': 'empty_text', 'native_id': row['native_id'], 'url': src['url']}, ensure_ascii=False) + '\n')
            continue
        if orig not in receipts:
            gapf.write(json.dumps({'kind': 'no_receipt', 'native_id': row['native_id']}, ensure_ascii=False) + '\n')
            continue
        body = unit_body(row)
        text_sha = sha_bytes(body)
        dest = chapters / text_sha
        if not dest.exists():
            dest.write_bytes(body)
        ukey = '%s:%s' % (member, orig[:12])
        if ukey not in units:
            rec = receipts[orig]
            units[ukey] = {
                'unit_key': ukey,
                'unit_kind': 'section',
                'heading': row.get('heading'),
                'original_sha256': orig,
                'publisher_member': member,
                'raw_member_sha256': None,
                'text_sha256': text_sha,
                'text_code_points': len(body.decode('utf-8')),
                'sections_expected': 0,
                'currency': norm_currency(row),
                'source_url': src['url'],
                'retrieved_at': rec['retrieved_at'],
                'retrieval_method': 'publisher_page',
                'proxy': None,
            }
            objects[text_sha] = {
                'sha256': text_sha,
                'bytes': len(body),
                'kind': 'unit_text_derivative',
                'path': str(dest),
                'sources': [{'source_url': src['url'], 'retrieved_at': rec['retrieved_at'],
                             'retrieval_method': 'publisher_page', 'proxy': None}],
            }
        units[ukey]['sections_expected'] += 1
        if orig not in objects:
            rec = receipts[orig]
            objects[orig] = {
                'sha256': orig,
                'bytes': rec['bytes'],
                'kind': 'publisher_original',
                'path': str(ROOT / rec['stored_path']),
                'sources': [{'source_url': rec['url'], 'retrieved_at': rec['retrieved_at'],
                             'retrieval_method': rec.get('retrieval_method', 'direct'), 'proxy': None}],
            }
        cp = row['native_id']
        seen_cp[cp] = seen_cp.get(cp, 0) + 1
        if seen_cp[cp] > 1:
            cp = '%s#%d' % (cp, seen_cp[cp])
        import re
        if not re.match(REGEX, cp):
            gapf.write(json.dumps({'kind': 'bad_citation_path', 'native_id': row['native_id']}, ensure_ascii=False) + '\n')
            continue
        hier = row['citation_path']
        sections_out.append({
            'citation_path': cp,
            'citation': row.get('citation'),
            'heading': row.get('heading'),
            'text': row.get('text') or row.get('status_label') or '',
            'hierarchy': hier,
            'history': row.get('history'),
            'status_note': row.get('status_label'),
            'unit_key': ukey,
            'span': row.get('source', {}).get('span'),
            'currency': norm_currency(row),
        })

    gapf.close()
    manifest = {
        'schema_version': 'publisher-code-manifest/2',
        'jurisdiction': 'HI',
        'publisher': 'Hawaii Legislative Reference Bureau (capitol.hawaii.gov)',
        'publisher_url': 'https://data.capitol.hawaii.gov/hrsall',
        'source_system': 'hi-hrs',
        'code_title': 'Hawaii Revised Statutes',
        'parser': {'name': 'hi-hrs-html', 'version': '2'},
        'retrieval': {
            'methods': ['publisher_page'],
            'source_url_patterns': [r'^https://data\.capitol\.hawaii\.gov/hrscurrent/'],
            'terms_gate': False,
            'official_source': True,
            'rate_limit_ms': 1000,
        },
        'structure': {
            'levels': ['volume', 'article', 'division', 'title', 'chapter', 'part', 'section'],
            'unit': 'One official section HTML file under hrscurrent volume directories.',
        },
        'section_id': {
            'scheme': 'official_citation_path',
            'regex': REGEX,
            'example': 'HRS_0001-0001',
            'citation_format': 'HRS section HTML basename (native_id).',
        },
        'currency': {
            'basis': 'publisher_statement',
            'location': 'https://data.capitol.hawaii.gov/hrsall h1 (Hawaii Revised Statutes 2025).',
        },
        'review': {'reviewed_by': 'batch-c lead (Cursor agent)', 'reviewed_at': '2026-10-07'},
    }
    with open(LANDING / 'manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')
    with open(LANDING / 'objects.jsonl', 'w', encoding='utf-8') as f:
        for obj in objects.values():
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
    with open(LANDING / 'units.jsonl', 'w', encoding='utf-8') as f:
        for unit in units.values():
            f.write(json.dumps(unit, ensure_ascii=False) + '\n')
    with open(LANDING / 'sections.jsonl', 'w', encoding='utf-8') as f:
        for sec in sections_out:
            f.write(json.dumps(sec, ensure_ascii=False) + '\n')
    raw = (LANDING / 'sections.jsonl').read_bytes()
    with gzip.open(STAGED / 'sections.jsonl.gz', 'wb') as gz:
        gz.write(raw)
    print(json.dumps({'units': len(units), 'sections': len(sections_out), 'objects': len(objects),
                      'gaps': sum(1 for _ in open(gaps_path))}, indent=2))


if __name__ == '__main__':
    main()
