"""Land the Louisiana Revised Statutes (legis.la.gov captures in /tmp/sc/LA) as publisher-code-intake/2."""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import land_lib as L  # noqa: E402
import land_run as R  # noqa: E402
import la_parse as P  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

ROOT = '/tmp/sc/LA'
ST = 'LA'
SYSTEM = 'la-revised-statutes'
PARSER = 'la-legis-lawprint/1'
PATH_RE = r'^[0-9]+[:.][0-9A-Za-z][0-9A-Za-z.:-]*(@[0-9]+)?$'
LEVELS = ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'article', 'subarticle', 'section']


def manifest():
    return {
        'schema_version': 'publisher-code-manifest/2', 'jurisdiction': ST,
        'publisher': 'Louisiana State Legislature (legis.la.gov Louisiana Laws)',
        'publisher_url': 'https://legis.la.gov/legis/Laws_Toc.aspx?folder=75&level=Parent', 'source_system': SYSTEM,
        'code_title': 'Louisiana Revised Statutes',
        'parser': {'name': 'la-legis-lawprint', 'version': '1'},
        'retrieval': {'methods': ['publisher_page'],
                      'source_url_patterns': [r'^https://legis\.la\.gov/legis/LawPrint\.aspx\?d=[0-9]+$',
                                              r'^https://legis\.la\.gov/legis/Laws_Toc\.aspx\?folder=75&level=Parent$',
                                              r'^https://legis\.la\.gov/legis/LawSearch\.aspx$'],
                      'terms_gate': False, 'official_source': True, 'rate_limit_ms': 1000},
        'structure': {'levels': LEVELS, 'unit': 'one LawPrint.aspx?d=<doc id> page (one section with printed headings)'},
        'section_id': {'scheme': 'official_citation_path', 'regex': PATH_RE, 'example': '14:32.9',
                       'citation_format': 'La. R.S. <path>'},
        'currency': {'basis': 'publisher_statement',
                     'location': 'LawSearch.aspx: "Laws have been updated through ..." line and disclaimer'},
        'review': {'reviewed_by': 'batch-a worker (MA AZ MO LA)', 'reviewed_at': '2026-10-06'},
    }


def receipts():
    out = []
    for line in open(ROOT + '/receipts.jsonl', encoding='utf8'):
        if line.strip():
            out.append(json.loads(line))
    return out


def body(rec):
    return open('%s/%s' % (ROOT, rec['stored_path']), 'rb').read()


def src_of(rec):
    status = rec.get('http_status', rec.get('status'))
    if status != 200:
        raise RuntimeError('refusing %s status %s' % (rec.get('url'), status))
    return {'source_url': rec['url'], 'sha256': rec['sha256'], 'retrieved_at': rec['retrieved_at'],
            'http_status': 200, 'retrieval_method': 'publisher_page', 'proxy': None}


BROWSER_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
SEARCH_URL = 'https://legis.la.gov/legis/LawSearch.aspx'


def ensure_statement_page():
    """Direct fetch of the printed update line. Browser User-Agent only if the first direct fetch fails."""
    for r in receipts():
        if r.get('ok') and r.get('status') == 200 and r['url'].endswith('/LawSearch.aspx') and r.get('label') == 'la-law-search':
            return
    from fast_fetcher import FastFetcher
    fetcher = FastFetcher('LA', ROOT, min_interval=1.0, timeout=120)
    rec = fetcher.get(SEARCH_URL, label='la-law-search')
    if not rec.get('ok') or rec.get('status') != 200:
        fetcher.user_agent = BROWSER_UA
        fetcher.session.headers['User-Agent'] = BROWSER_UA
        rec = fetcher.get(SEARCH_URL, label='la-law-search', force=True)
    if not rec.get('ok') or rec.get('status') != 200:
        raise RuntimeError('LawSearch page status %s' % rec.get('status'))


def toc_proof(titles, toc_recs, doc_recs):
    """Title TOC pages list Law.aspx?d= markers. A title page with zero markers is a pass only when it has no child postback."""
    pages = []
    pending = []
    have = {}
    for r in toc_recs:
        if r.get('status') == 200 and r.get('postback_target'):
            have[r['postback_target']] = r
    ok_docs = {url for url, rec in doc_recs.items() if rec.get('status') == 200}
    for t in titles:
        rec = have.get(t['target'])
        if rec is None:
            pending.append('title-toc:%s' % t['title'])
            continue
        html = body(rec).decode('utf8', 'replace')
        docs = []
        seen = set()
        for m in re.finditer(r'href="Law\.aspx\?d=(\d+)"', html):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                docs.append(m.group(1))
        if not docs:
            kids = re.findall(r"__doPostBack\('([^']*ListViewTOC[^']*)'", html)
            kids += re.findall(r'__doPostBack\(&#39;([^&]*ListViewTOC[^&]*)&#39;', html)
            kids = [k for k in kids if 'MenuSearch' not in k and k not in have]
            if kids:
                pending.extend(kids)
                continue
        got = 0
        for d in docs:
            url = 'https://legis.la.gov/legis/LawPrint.aspx?d=%s' % d
            if url in ok_docs:
                got += 1
            else:
                pending.append(url)
        pages.append({'url': rec['url'], 'postback_target': t['target'], 'title': t['title'],
                      'markers': len(docs), 'sections': got})
    return {'marker': 'legis.la.gov title table-of-contents Law.aspx?d= document links',
            'pages': pages, 'unfetched_child_pages': pending}


def statement_info(rs):
    rec = None
    for r in rs:
        if r.get('ok') and r['url'].endswith('/LawSearch.aspx') and r.get('label') == 'la-law-search':
            rec = r
    if rec is None:
        raise RuntimeError('LawSearch statement page not captured')
    text = P.clean(BeautifulSoup(body(rec).decode('utf8', 'replace'), 'html.parser').get_text(' '))
    upd = re.search(r'Laws have been updated through.*?click here\.', text).group(0)
    disc = re.search(r'Disclaimer This website contains.*?not official or authoritative\.', text).group(0)
    return rec, '%s %s' % (upd, disc)


def main(dry=False):
    if not dry:
        ensure_statement_page()
    rs = [r for r in receipts() if r.get('ok')]
    first = {}
    for r in rs:
        first.setdefault((r['url'], r.get('postback_target')), r)
    titles = json.load(open(ROOT + '/titles.json'))
    doc_recs = {r['url']: r for r in rs if r.get('label') == 'section'}
    toc_recs = [r for r in rs if str(r.get('label', '')).startswith('title-toc:')]
    srec, statement = (None, 'DRY') if dry else statement_info(rs)
    proof = toc_proof(titles, toc_recs, doc_recs)
    missing = []
    plan = []
    empty_gaps = []
    skipped = []
    keys_seen = collections.Counter()
    odd_labels = []
    paths = collections.Counter()
    pages = []
    for t in titles:
        tnum = re.sub(r'^TITLE\s+', '', t['title']).strip()
        state = []
        for d in t['docs']:
            rec = doc_recs.get('https://legis.la.gov/legis/LawPrint.aspx?d=%s' % d)
            if rec is None:
                missing.append(d)
                continue
            label, lines = P.parse_page(body(rec).decode('utf8', 'replace'))
            pg = P.split_page(label, lines)
            if pg['kind'] != 'section':
                skipped.append({'doc': d, 'label': label, 'lines': pg['lines'][:3]})
                continue
            for key, num, head in pg['header']:
                if key == 'TITLE' or key == '?':
                    continue
                keys_seen[key] += 1
                rank = P.LEVEL_RANK[key]
                state = [s for s in state if P.LEVEL_RANK[s[0]] < rank]
                state.append((key, num, head))
            m = re.match(r'^RS (\S+)$', label) or re.match(r'^RS ([0-9A-Za-z]+):\s+(\S+)$', label)
            if not m:
                raise RuntimeError('unexpected label %r' % label)
            path = m.group(1) if m.lastindex == 1 else '%s:%s' % (m.group(1), m.group(2))
            if not path.startswith(tnum + ':'):
                odd_labels.append({'doc': d, 'label': label, 'title': tnum})
            paths[path] += 1
            pages.append((t, tnum, d, rec, label, pg, list(state), path))
    seen = collections.Counter()
    for t, tnum, d, rec, label, pg, state, path in pages:
        p = path
        if paths[path] > 1:
            seen[path] += 1
            p = '%s@%d' % (path, seen[path])
        ut = L.UnitText()
        for ln in pg['header_lines']:
            ut.add(ln)
        sec_line_start, _ = ut.add(pg['section_line'])
        status = None
        heading = pg['heading']
        if pg['body']:
            text = '\n'.join(pg['body'])
            span = ut.add(text)
        else:
            text = heading or pg['section_line']
            off = pg['section_line'].find(text) if heading else 0
            span = (sec_line_start + off, sec_line_start + off + len(text))
            status = text
            heading = None
        history = None
        if pg['history']:
            history = '\n'.join(pg['history'])
            ut.add(history)
        unit_text = ut.value()
        if not unit_text.strip() or not (text or '').strip():
            empty_gaps.append({'doc': d, 'path': path})
            continue
        hier = [{'level': 'title', 'number': tnum, 'heading': t['name']}]
        for key, num, head in state:
            hier.append({'level': key.lower(), 'number': num, 'heading': head or None})
        hier.append({'level': 'section', 'number': pg['sec_no'], 'heading': heading})
        plan.append({'path': p, 'rec': rec, 'heading': heading, 'text': text, 'status': status, 'history': history,
                     'hier': hier, 'unit_text': unit_text, 'span': span, 'citation': 'La. R.S. %s' % path})

    assets, sources = [], collections.defaultdict(list)

    def add(rec, data, ctype):
        assets.append((rec['sha256'], 'publisher_original', data, ctype))
        lst = sources[rec['sha256']]
        s0 = src_of(rec)
        if not any(x['source_url'] == s0['source_url'] and x['retrieved_at'] == s0['retrieved_at'] for x in lst):
            lst.append(s0)

    for r in doc_recs.values():
        add(r, body(r), 'text/html; charset=utf-8')
    for r in toc_recs:
        add(r, body(r), 'text/html; charset=utf-8')
    if srec:
        add(srec, body(srec), 'text/html; charset=utf-8')
    for p in plan:
        ub = p['unit_text'].encode('utf8')
        usha = L.sha256_bytes(ub)
        assets.append((usha, 'unit_text_derivative', ub, 'text/plain; charset=utf-8'))
        lst = sources[usha]
        s0 = src_of(p['rec'])
        if not any(x['source_url'] == s0['source_url'] for x in lst):
            lst.append(s0)

    def rows(manifest_sha):
        for p in plan:
            src = src_of(p['rec'])
            cur = L.currency_obj(statement)
            yield L.unit_row(ST, SYSTEM, manifest_sha, PARSER, p['path'], 'section_page', p['heading'], src,
                             p['unit_text'], 1, cur)
            yield L.section_row(ST, SYSTEM, manifest_sha, PARSER, p['path'], p['citation'], p['heading'], p['text'],
                                p['hier'], p['history'], p['status'], p['path'], p['unit_text'], p['span'], src, cur)

    proof_clean = bool(proof['pages']) and not proof['unfetched_child_pages'] and all(
        p['markers'] == p['sections'] for p in proof['pages'])
    if dry:
        reg = re.compile(PATH_RE)
        bad = [p['path'] for p in plan if not reg.match(p['path'])]
        n = sum(1 for _ in rows('0' * 64))
        for p in plan:
            assert p['unit_text'][p['span'][0]:p['span'][1]] == p['text'], p['path']
        print('plan', len(plan), 'skipped', len(skipped), skipped[:3], 'missing', len(missing), 'rows', n, 'badpaths', bad[:5])
        print('levels seen', dict(keys_seen), 'dups', sum(1 for v in paths.values() if v > 1), 'odd', odd_labels[:5],
              'status', sum(1 for p in plan if p['status']), 'history', sum(1 for p in plan if p['history']))
        print('toc pages', len(proof['pages']), 'unfetched', len(proof['unfetched_child_pages']), 'empty_gaps', len(empty_gaps), 'clean', proof_clean)
        return
    if missing:
        raise RuntimeError('%d listed documents not captured' % len(missing))
    if not proof_clean:
        raise SystemExit('refusing to open a run: toc proof is not clean (%d unfetched, %d pages)' % (
            len(proof['unfetched_child_pages']), len(proof['pages'])))
    json.dump(proof, open(ROOT + '/toc-proof.json', 'w'))
    extra = {'source': 'https://legis.la.gov/legis/Laws_Toc.aspx?folder=75&level=Parent (title tables of contents) and LawPrint.aspx?d=<doc id> (one per section)',
             'currency_quote': statement, 'currency_as_printed': statement,
             'documents_listed': sum(len(t['docs']) for t in titles),
             'non_section_documents_skipped': skipped, 'sections_landed': len(plan), 'levels_seen': dict(keys_seen),
             'repeated_citations': sum(1 for v in paths.values() if v > 1), 'labels_not_in_title_colon_form': odd_labels,
             'empty_text_gaps': empty_gaps, 'through_date': None, 'edition_as_printed': None, 'toc_proof': proof}
    notes = ('Full Louisiana Revised Statutes as published by the Louisiana State Legislature (not official or authoritative per the site disclaimer). '
             'Hierarchy below title is carried forward in table-of-contents order from the headings printed on the first LawPrint page after each heading. '
             'Redesignated/repealed placeholders are landed with the publisher section line as text and status_note.')
    res = R.run_landing(ST, manifest(), assets, sources, rows, proof_clean and not missing, notes, extra)
    print(json.dumps({k: res.get(k) for k in ('run_id', 'run_status', 'counts')}, indent=1))


if __name__ == '__main__':
    main(dry=os.environ.get('DRY') == '1')
