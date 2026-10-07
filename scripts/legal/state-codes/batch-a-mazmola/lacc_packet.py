#!/usr/bin/env python3
"""Build the shared landing packet for the Louisiana Civil Code from /tmp/sc/LACC (one unit per article page).

    lacc_packet.py  ->  /tmp/sc/LACC/landing/{manifest.json,objects.jsonl,units.jsonl,sections.jsonl,toc-proof.json}

Land it with:  land_publisher_code_v2.py /tmp/sc/LACC/landing --multicode [--execute]
Builds files only. It registers nothing, lands nothing and never reviews anything.
"""
import hashlib
import json
import os
import pathlib
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lacc_parse as P  # noqa: E402
import lacc_toc_check as T  # noqa: E402

ROOT = pathlib.Path('/tmp/sc/LACC')
OUT = ROOT / 'landing'
SEARCH_URL = 'https://legis.la.gov/legis/LawSearch.aspx'


def statement(receipts):
    rec = [r for r in receipts if r.get('label') == 'la-law-search' and r.get('ok') and r.get('status') == 200][-1]
    text = P.clean(BeautifulSoup((ROOT / rec['stored_path']).read_text(encoding='utf8', errors='replace'), 'html.parser').get_text(' '))
    upd = re.search(r'Laws have been updated through.*?click here\.', text).group(0)
    disc = re.search(r'Disclaimer This website contains.*?not official or authoritative\.', text).group(0)
    return rec, '%s %s' % (upd, disc)


def main():
    receipts = [json.loads(x) for x in open(ROOT / 'receipts.jsonl') if x.strip()]
    docs = json.load(open(ROOT / 'docs.json'))
    pages = {}
    for r in receipts:
        if 'LawPrint.aspx?d=' in r['url'] and r.get('ok') and r.get('status') == 200:
            pages[r['url'].rsplit('=', 1)[1]] = r
    toc_rec = next(r for r in receipts if r.get('label') == 'cc-toc' and r.get('ok'))
    search_rec, stmt = statement(receipts)
    currency = {'basis': 'publisher_statement', 'statement': stmt, 'through_date': None, 'edition': None}
    (OUT / 'text').mkdir(parents=True, exist_ok=True)
    objects, units, sections, proof_pages = {}, [], [], []

    def add_source(sha, size, kind, path, rec, method='publisher_page'):
        o = objects.setdefault(sha, {'sha256': sha, 'bytes': size, 'kind': kind, 'path': str(path), 'sources': []})
        src = {'source_url': rec['url'], 'retrieved_at': rec['retrieved_at'], 'http_status': rec['status'],
               'retrieval_method': method, 'proxy': None}
        if src not in o['sources']:
            o['sources'].append(src)

    state = []
    for d in docs:
        rec = pages[d]
        pg = P.parse_page((ROOT / rec['stored_path']).read_text(encoding='utf8', errors='replace'))
        art = P.article_record(pg)
        state = P.apply_headers(state, pg['headers'])
        unit_lines = list(pg['lines_before']) + [pg['article_line']] + list(pg['body']) + list(pg['history'])
        unit_text = '\n'.join(unit_lines)
        art_at = unit_text.index(pg['article_line'])
        at = unit_text.find(art['text'], art_at)
        span = {'unit': 'unicode_code_points', 'start': at, 'end': at + len(art['text'])} if at >= 0 else None
        deriv = unit_text.encode('utf-8')
        tsha = hashlib.sha256(deriv).hexdigest()
        tpath = OUT / 'text' / (tsha + '.txt')
        if not tpath.exists():
            tpath.write_bytes(deriv)
        add_source(rec['sha256'], rec['bytes'], 'publisher_original', ROOT / rec['stored_path'], rec)
        add_source(tsha, len(deriv), 'unit_text_derivative', tpath, rec)
        key = 'cc-%s' % pg['path']
        hier = [{'level': lv, 'number': num, 'heading': hd or None} for lv, _rk, num, hd in state]
        hier.append({'level': 'section', 'number': pg['path'], 'heading': art['heading']})
        units.append({'unit_key': key, 'unit_kind': 'article_page', 'heading': art['heading'], 'original_sha256': rec['sha256'],
                      'publisher_member': None, 'raw_member_sha256': None, 'text_sha256': tsha, 'text_code_points': len(unit_text),
                      'sections_expected': 1, 'currency': currency, 'source_url': rec['url'], 'retrieved_at': rec['retrieved_at'],
                      'retrieval_method': 'publisher_page', 'proxy': None})
        sections.append({'unit_key': key, 'citation_path': pg['path'], 'citation': 'La. C.C. art. %s' % pg['path'], 'heading': art['heading'],
                         'text': art['text'], 'hierarchy': hier, 'history': art['history'], 'status_note': art['status_note'],
                         'span': span, 'currency': currency})
        proof_pages.append({'url': rec['url'], 'markers': 1, 'sections': 1})
    for rec in (toc_rec, search_rec):
        data = (ROOT / rec['stored_path']).read_bytes()
        add_source(rec['sha256'], len(data), 'publisher_original', ROOT / rec['stored_path'], rec)
    proof = {'marker': 'Civil Code contents page: article links (2 anchors per article, one article document each); each article page prints one article line',
             'pages': [{'url': toc_rec['url'], 'markers': len(docs), 'sections': len(sections)}] + proof_pages,
             'unfetched_child_pages': [], 'empty_text_pages': []}
    manifest = json.loads((OUT / 'manifest.json').read_text())
    with open(OUT / 'objects.jsonl', 'w', encoding='utf-8') as f:
        for o in sorted(objects.values(), key=lambda x: x['sha256']):
            f.write(json.dumps(o, ensure_ascii=False, separators=(',', ':')) + '\n')
    for name, rows in (('units.jsonl', units), ('sections.jsonl', sections)):
        with open(OUT / name, 'w', encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
    (OUT / 'toc-proof.json').write_text(json.dumps(proof))
    null_span = sum(1 for s in sections if s['span'] is None)
    print(json.dumps({'units': len(units), 'sections': len(sections), 'objects': len(objects), 'null_spans': null_span,
                      'toc_pages': len(proof['pages']), 'source_system': manifest['source_system']}))


if __name__ == '__main__':
    main()
