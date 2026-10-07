#!/usr/bin/env python3
"""Build the shared landing packet for the Arizona Revised Statutes from /tmp/sc/AZ (one unit per section page).

    az_packet.py  ->  /tmp/sc/AZ/landing/{manifest,objects,units,sections}.jsonl|json, toc-proof.json, gaps.json

Hierarchy (title, chapter, article) comes from the publisher's own arsDetail listings; the contents proof compares the section links each
title page lists with the section pages retained and parsed. A section page that prints no text is a gap, never a row.
Builds files only. Registers nothing, lands nothing, reviews nothing.
"""
import collections
import hashlib
import json
import os
import pathlib
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import az_parse as P  # noqa: E402

ROOT = pathlib.Path('/tmp/sc/AZ')
OUT = ROOT / 'landing'
INDEX = 'https://www.azleg.gov/arstitle/'
PATH_RE = r'^[0-9]+[A-Za-z]?-[0-9A-Za-z.]+(@[0-9]+)?$'
SECTION_URL = re.compile(r'/ars/[0-9]+[A-Za-z]?/[0-9A-Za-z.\-]+\.htm$')
MANIFEST = {
    'schema_version': 'publisher-code-manifest/2', 'jurisdiction': 'AZ',
    'publisher': 'Arizona Legislature (azleg.gov Arizona Revised Statutes)',
    'publisher_url': 'https://www.azleg.gov/arstitle/', 'source_system': 'az-revised-statutes',
    'code_title': 'Arizona Revised Statutes',
    'parser': {'name': 'az-legislature-html', 'version': '2'},
    'retrieval': {'methods': ['publisher_page', 'proxied_fetch'],
                  'source_url_patterns': [r'^https://www\.azleg\.gov/ars/[0-9]+[A-Za-z]?/[0-9A-Za-z.\-]+\.htm$',
                                          r'^https://www\.azleg\.gov/arsDetail/\?title=[0-9A-Za-z.\-]+$',
                                          r'^https://www\.azleg\.gov/arstitle/$'],
                  'terms_gate': False, 'official_source': True, 'rate_limit_ms': 1000},
    'structure': {'levels': ['title', 'chapter', 'article', 'section'], 'unit': 'one /ars/<title>/<section>.htm document (one section)'},
    'section_id': {'scheme': 'official_citation_path', 'regex': PATH_RE, 'example': '13-3881', 'citation_format': 'A.R.S. § <path>'},
    'currency': {'basis': 'publisher_statement',
                 'location': 'arstitle/ page: the update statement and the disclaimer; each section page carries a Creation Date comment'},
    'review': {'reviewed_by': 'batch A lead', 'reviewed_at': '2026-10-07'},
}


def method_of(r):
    if r.get('retrieval_method') == 'proxied:firecrawl':
        return 'proxied_fetch', 'firecrawl', r.get('source_status')
    return 'publisher_page', None, r.get('status')


def main():
    recs = [json.loads(x) for x in open(ROOT / 'receipts.jsonl', encoding='utf8') if x.strip()]
    good = {}
    for r in recs:
        if not r.get('ok'):
            continue
        method, proxy, status = method_of(r)
        if status != 200:
            continue
        if r['url'] not in good or method == 'publisher_page':
            good[r['url']] = r
    listing = json.load(open(ROOT / 'listing.json'))
    index = good[INDEX]
    text = P.clean(BeautifulSoup((ROOT / index['stored_path']).read_text(encoding='utf8', errors='replace'), 'lxml').get_text(' '))
    upd = re.search(r'The Arizona Revised Statutes have been updated to include.*?convenes in January 20[0-9]{2}\.', text).group(0)
    disc = re.search(r'DISCLAIMER This online version of the Arizona Revised Statutes.*?published by Thomson Reuters\.', text).group(0)
    currency = {'basis': 'publisher_statement', 'statement': '%s %s' % (upd, disc), 'through_date': None, 'edition': None}
    (OUT / 'text').mkdir(parents=True, exist_ok=True)
    objects, units, sections, gaps, proof_pages, seen = {}, [], [], [], [], collections.Counter()

    def add(sha, size, kind, path, rec):
        method, proxy, status = method_of(rec)
        o = objects.setdefault(sha, {'sha256': sha, 'bytes': size, 'kind': kind, 'path': str(path), 'sources': []})
        src = {'source_url': rec['url'], 'retrieved_at': rec['retrieved_at'], 'http_status': 200, 'retrieval_method': method, 'proxy': proxy}
        if src not in o['sources']:
            o['sources'].append(src)

    for t, urls in listing.items():
        det = [r for r in recs if r.get('label') == 'title-detail:%s' % t and r.get('ok')][-1]
        h = (ROOT / det['stored_path']).read_text(encoding='utf8', errors='replace')
        tree = P.parse_detail(h)
        add(det['sha256'], det['bytes'], 'publisher_original', ROOT / det['stored_path'], det)
        landed = 0
        empty = 0
        for u in urls:
            rec = good[u]
            page_html = (ROOT / rec['stored_path']).read_text(encoding='utf8', errors='replace')
            try:
                pg = P.parse_section(page_html, u)
            except P.EmptySectionPage:
                gaps.append({'url': u, 'reason': 'section page has no printed text'})
                empty += 1
                continue
            sec = P.section_record(pg)
            path = pg['num']
            seen[path] += 1
            if seen[path] > 1:
                path = '%s@%d' % (path, seen[path])
            lines = [pg['first_line']] + pg['body']
            unit_text = '\n'.join(lines)
            at = unit_text.find(sec['text'], len(pg['first_line']) if pg['body'] else 0)
            span = {'unit': 'unicode_code_points', 'start': at, 'end': at + len(sec['text'])} if at >= 0 else None
            deriv = unit_text.encode('utf-8')
            tsha = hashlib.sha256(deriv).hexdigest()
            tpath = OUT / 'text' / (tsha + '.txt')
            if not tpath.exists():
                tpath.write_bytes(deriv)
            add(rec['sha256'], rec['bytes'], 'publisher_original', ROOT / rec['stored_path'], rec)
            add(tsha, len(deriv), 'unit_text_derivative', tpath, rec)
            info = tree.get(u, {})
            hier = [{'level': 'title', 'number': t, 'heading': None}]
            if info.get('chapter') and info['chapter'][0]:
                hier.append({'level': 'chapter', 'number': info['chapter'][0], 'heading': info['chapter'][1] or None})
            if info.get('article') and info['article'][0]:
                hier.append({'level': 'article', 'number': info['article'][0], 'heading': info['article'][1] or None})
            hier.append({'level': 'section', 'number': path, 'heading': sec['heading']})
            method, proxy, status = method_of(rec)
            key = 'az-%s' % path
            units.append({'unit_key': key, 'unit_kind': 'section_page', 'heading': sec['heading'], 'original_sha256': rec['sha256'],
                          'publisher_member': None, 'raw_member_sha256': None, 'text_sha256': tsha, 'text_code_points': len(unit_text),
                          'sections_expected': 1, 'currency': currency, 'source_url': u, 'retrieved_at': rec['retrieved_at'],
                          'retrieval_method': method, 'proxy': proxy})
            sections.append({'unit_key': key, 'citation_path': path, 'citation': 'A.R.S. § %s' % pg['num'], 'heading': sec['heading'],
                             'text': sec['text'], 'hierarchy': hier, 'history': None, 'status_note': sec['status_note'], 'span': span,
                             'currency': currency})
            proof_pages.append({'url': u, 'markers': 1, 'sections': 1})
            landed += 1
        proof_pages.append({'url': det['url'], 'markers': len(urls) - empty, 'sections': landed})
    add(index['sha256'], index['bytes'], 'publisher_original', ROOT / index['stored_path'], index)
    with open(OUT / 'objects.jsonl', 'w', encoding='utf-8') as f:
        for o in sorted(objects.values(), key=lambda x: x['sha256']):
            f.write(json.dumps(o, ensure_ascii=False, separators=(',', ':')) + '\n')
    for name, rows in (('units.jsonl', units), ('sections.jsonl', sections)):
        with open(OUT / name, 'w', encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
    (OUT / 'manifest.json').write_text(json.dumps(MANIFEST, indent=1, sort_keys=True))
    proof = {'marker': 'azleg.gov arsDetail section links (a.stat docName), one per section; each section page prints one section',
             'pages': proof_pages, 'unfetched_child_pages': [], 'empty_text_pages': [g['url'] for g in gaps]}
    (OUT / 'toc-proof.json').write_text(json.dumps(proof))
    (OUT / 'gaps.json').write_text(json.dumps(gaps, indent=1))
    proxied = sum(1 for u in units if u['retrieval_method'] == 'proxied_fetch')
    listed = sum(len(v) for v in listing.values())
    bad = [p for p in proof_pages if p['markers'] != p['sections']]
    print(json.dumps({'listed': listed, 'units': len(units), 'sections': len(sections), 'gaps': len(gaps), 'proxied_units': proxied,
                      'objects': len(objects), 'null_spans': sum(1 for s in sections if s['span'] is None),
                      'dup_paths': sum(1 for p, c in seen.items() if c > 1), 'toc_mismatch': len(bad)}))


if __name__ == '__main__':
    main()
