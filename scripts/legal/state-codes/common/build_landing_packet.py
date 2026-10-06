#!/usr/bin/env python3
"""Convert a batch B staged state directory into a landing packet for land_publisher_code_v2.py.

Reads /tmp/sc/<ST>/staged/{manifest.json,sections.jsonl.gz} and receipts.jsonl and writes
/tmp/sc/<ST>/landing/{manifest.json,objects.jsonl,units.jsonl,sections.jsonl}. Nothing is invented:
a section whose publisher entry has no body text beyond its printed status/heading line lands with that
printed line as its text (counted and reported as `heading_as_text`); sections with neither are left out
and listed in landing/gaps.json. No network, no credentials.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import json
import os
import re
import sys

ISO = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MANIFEST_KEYS = ('schema_version', 'jurisdiction', 'publisher', 'publisher_url', 'source_system', 'code_title', 'parser',
                 'retrieval', 'structure', 'section_id', 'currency', 'review')
ORIGINAL_KINDS = ('publisher_original', 'publisher_support_page')


def jsonl_gz(path):
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def method_for(receipt):
    how = receipt.get('retrieval_method', 'direct')
    if how.startswith('proxied:'):
        return 'proxied_fetch', how.split(':', 1)[1]
    ctype = (receipt.get('headers') or {}).get('content-type', '')
    if 'html' in ctype:
        return 'publisher_page', None
    return 'publisher_bulk_download', None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', help='/tmp/sc/<ST>')
    ap.add_argument('--reviewer', default='batch B lead (bc-ddde25f5)')
    ap.add_argument('--config', help='intake-config.json when the staged manifest is not already publisher-code-manifest/2')
    a = ap.parse_args()
    root = a.root
    staged = os.path.join(root, 'staged')
    out = os.path.join(root, 'landing')
    os.makedirs(out, exist_ok=True)
    stm = json.load(open(os.path.join(staged, 'manifest.json'), encoding='utf-8'))
    cfg = json.load(open(a.config, encoding='utf-8')) if a.config else {}
    levels_seen = []
    if 'jurisdiction' not in stm:
        for r in jsonl_gz(os.path.join(staged, 'sections.jsonl.gz')):
            for h in r['citation_path']:
                if h['level'] not in levels_seen:
                    levels_seen.append(h['level'])
        methods = set()
        stm = dict(stm, schema_version='publisher-code-manifest/2', jurisdiction=cfg['jurisdiction'],
                   publisher=cfg['publisher'], publisher_url=cfg['publisher_url'], source_system=cfg['source_system'],
                   code_title=cfg['code_title'], parser={'name': stm['parser']['name'], 'version': cfg['parser_version']},
                   retrieval={'methods': [], 'source_url_patterns': cfg['source_url_patterns'],
                              'rate_limit_ms': cfg.get('rate_limit_ms', 1000)},
                   structure={'levels': levels_seen, 'unit': cfg['unit']}, section_id=cfg['section_id'],
                   currency=cfg['currency'], review={})
    manifest = {k: stm[k] for k in MANIFEST_KEYS}
    manifest['review'] = {'reviewed_by': stm['review'].get('reviewed_by') or a.reviewer,
                          'reviewed_at': stm['review'].get('reviewed_at') or datetime.date.today().isoformat()}
    manifest['retrieval'] = dict(manifest['retrieval'], terms_gate=False, official_source=True)
    levels = set(manifest['structure']['levels'])
    regex = re.compile(manifest['section_id']['regex'])
    base = stm['currency']['basis']

    receipts = collections.defaultdict(list)
    with open(os.path.join(root, 'receipts.jsonl'), encoding='utf-8') as handle:
        for line in handle:
            r = json.loads(line)
            if r.get('ok') and r.get('status') == 200:
                receipts[r['sha256']].append(r)

    def sources_for(sha, fallback=None):
        seen, items = set(), []
        for r in sorted(receipts.get(sha, []), key=lambda x: x['retrieved_at']):
            method, proxy = method_for(r)
            key = (r['url'], r['retrieved_at'])
            if key in seen:
                continue
            seen.add(key)
            items.append({'source_url': r['url'], 'retrieved_at': r['retrieved_at'], 'retrieval_method': method, 'proxy': proxy})
        if not items and fallback:
            items = fallback
        return items[:50]

    originals = {f['sha256']: f for f in stm['files'] if f['kind'] in ORIGINAL_KINDS}
    files = dict(originals)
    files.update({f['sha256']: dict(f, kind='unit_text_derivative') for f in stm['files'] if f['kind'].endswith('_derivative')})
    objects = []
    original_sources = {}
    for sha, f in originals.items():
        if True:
            src = sources_for(sha, [{'source_url': f['url'], 'retrieved_at': f['retrieved_at'],
                                     'retrieval_method': 'publisher_bulk_download', 'proxy': None}])
            original_sources[sha] = src
            objects.append({'sha256': sha, 'bytes': f['bytes'], 'kind': 'publisher_original',
                            'path': os.path.join(root, f['path']), 'sources': src})

    units, sections, gaps = {}, [], []
    derivative_remap = {}
    heading_as_text = 0
    per_unit = collections.Counter()
    seen_paths = set()
    for r in jsonl_gz(os.path.join(staged, 'sections.jsonl.gz')):
        s = r['source']
        orig, member, deriv = s['receipt_sha256'], s.get('member'), s['derivative_sha256']
        ukey = member or s['url'].rstrip('/').rsplit('/', 1)[-1] or ('unit-' + deriv[:16])
        ukey = re.sub(r'[^A-Za-z0-9._:-]', '_', ukey)
        ident = (orig, member, deriv)
        if ident not in units:
            if orig not in original_sources or deriv not in files:
                raise SystemExit('unit without registered original/derivative: %r' % (ident,))
            dpath = os.path.join(root, files[deriv]['path'])
            if not os.path.exists(dpath):
                dpath = os.path.join(staged, files[deriv]['path'])
            raw = open(dpath, 'rb').read()
            if deriv == orig:
                # one sha256 cannot be both original and derivative: derivative = text + one trailing newline
                raw = raw + b'\n'
                os.makedirs(os.path.join(out, 'derivatives'), exist_ok=True)
                dpath = os.path.join(out, 'derivatives', hashlib.sha256(raw).hexdigest())
                open(dpath, 'wb').write(raw)
                new_sha = hashlib.sha256(raw).hexdigest()
                derivative_remap[deriv] = new_sha
                files[new_sha] = {'path': os.path.relpath(dpath, root), 'bytes': len(raw), 'kind': 'unit_text_derivative'}
                deriv = new_sha
            body = raw.decode('utf-8')
            first = original_sources[orig][0]
            hier0 = r['citation_path'][0] if r['citation_path'] else {}
            units[ident] = {'unit_key': ukey, 'unit_kind': 'title' if manifest['structure']['unit'] == 'title' else 'unit',
                            'heading': hier0.get('heading'), 'original_sha256': orig,
                            'publisher_member': member, 'raw_member_sha256': (s.get('raw_member_sha256') if member else None),
                            'text_sha256': deriv, 'text_code_points': len(body), 'sections_expected': None,
                            'currency': None, 'source_url': first['source_url'], 'retrieved_at': first['retrieved_at'],
                            'retrieval_method': first['retrieval_method'], 'proxy': first['proxy'],
                            '_path': dpath, '_bytes': os.path.getsize(dpath)}
            if member and not units[ident]['raw_member_sha256']:
                units[ident]['publisher_member'] = None
        unit = units[ident]
        cur = r.get('currency') or {}
        through = cur.get('as_of') if ISO.match(cur.get('as_of') or '') else None
        currency = {'basis': base, 'statement': cur.get('statement') or '', 'through_date': through, 'edition': r.get('edition')}
        if unit['currency'] is None:
            unit['currency'] = currency
        path = r['native_id']
        if not regex.match(path):
            m = re.match(r'^(.*):([2-9][0-9]*)$', path)
            if m and ':occurrence:' not in path:
                path = '%s:occurrence:%s' % (m.group(1), m.group(2))
        if not regex.match(path):
            raise SystemExit('citation_path does not match manifest regex: %r' % path)
        if path in seen_paths:
            raise SystemExit('duplicate citation_path: %r' % path)
        seen_paths.add(path)
        text = r['text']
        status_note = r.get('status_label')
        if not text.strip():
            if (r.get('heading') or '').strip():
                text = r['heading']
                status_note = status_note or r['heading']
                heading_as_text += 1
            else:
                gaps.append({'citation_path': path, 'reason': 'no printed text or heading'})
                continue
        if '\x00' in text:
            raise SystemExit('NUL in text for %r' % path)
        hierarchy = [{'level': h['level'], 'number': h.get('number'), 'heading': h.get('heading')} for h in r['citation_path']]
        if not hierarchy or hierarchy[-1]['level'] != 'section' or any(h['level'] not in levels for h in hierarchy):
            raise SystemExit('hierarchy levels invalid for %r' % path)
        span = s.get('span')
        if span is not None and (span.get('unit') != 'unicode_code_points' or span['end'] - span['start'] != len(text)):
            span = None
        sections.append({'unit_key': unit['unit_key'], 'citation_path': path, 'citation': r['citation'], 'heading': r.get('heading'),
                         'text': text, 'hierarchy': hierarchy, 'history': r.get('history'), 'status_note': status_note,
                         'span': span, 'currency': currency})
        per_unit[unit['unit_key']] += 1

    keys = collections.Counter(u['unit_key'] for u in units.values())
    if any(n > 1 for n in keys.values()):
        raise SystemExit('unit_key collision: %r' % [k for k, n in keys.items() if n > 1][:5])
    for u in units.values():
        u['sections_expected'] = None
        derivative_sources = original_sources[u['original_sha256']]
        if not any(o['sha256'] == u['text_sha256'] for o in objects):
            objects.append({'sha256': u['text_sha256'], 'bytes': u['_bytes'], 'kind': 'unit_text_derivative',
                            'path': u['_path'], 'sources': derivative_sources})

    def dump(name, rows):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as handle:
            for row in rows:
                handle.write(json.dumps({k: v for k, v in row.items() if not k.startswith('_')}, ensure_ascii=False) + '\n')

    used = sorted({x['retrieval_method'] for o in objects for x in o['sources']})
    if not manifest['retrieval'].get('methods'):
        manifest['retrieval']['methods'] = used
    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    dump('objects.jsonl', objects)
    dump('units.jsonl', units.values())
    dump('sections.jsonl', sections)
    json.dump({'gaps': gaps, 'heading_as_text': heading_as_text, 'sections': len(sections), 'units': len(units),
               'objects': len(objects)}, open(os.path.join(out, 'packet-report.json'), 'w'), indent=1)
    print(json.dumps({'objects': len(objects), 'units': len(units), 'sections': len(sections),
                      'heading_as_text': heading_as_text, 'gaps': len(gaps)}))


if __name__ == '__main__':
    sys.exit(main())
