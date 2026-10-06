"""Pre-flip review of landed Oklahoma sections against the live official PDF/RTF of each title."""
import json
import os
import random
import re
import sys

import pymupdf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
from provenance_fetch import Fetcher  # noqa: E402
from review_lib import compare, norm, words  # noqa: E402

ROOT = '/tmp/sc/OK'
BASE = 'https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os%s.%s'


def strip_headers(text):
    # running page header printed by the publisher: "Oklahoma Statutes - Title N. <name> Page M"
    return re.sub(r'\s+', ' ', re.sub(r'oklahoma statutes - title [0-9a-z]+\. .*? page \d+ ', ' ', text + ' '))


def main(seed='ok-review-2026-10-06'):
    rows = [json.loads(l) for l in open(ROOT + '/landing/sections.jsonl', encoding='utf-8')]
    units = {u['unit_key']: u for u in map(json.loads, open(ROOT + '/landing/units.jsonl', encoding='utf-8'))}
    rng = random.Random(seed)
    bodied = [r for r in rows if r['status_note'] is None and r['text'] != r['heading']]
    status = [r for r in rows if r['status_note'] is not None]
    sample = rng.sample(bodied, 16) + rng.sample(status, 4)
    fetcher = Fetcher('OK', ROOT + '/review', min_interval=1.2)
    pdfs, results = {}, []
    retained = {u['publisher_member']: u for u in units.values()}
    for r in sample:
        title = r['hierarchy'][0]['number']
        if title not in pdfs:
            rec = fetcher.get(BASE % (title, 'pdf'), label='review-live-pdf', force=True)
            rtf = fetcher.get(BASE % (title, 'rtf'), label='review-live-rtf', force=True)
            unit = units.get('os%s.rtf' % title) or next(u for u in units.values() if u['unit_key'].lower().startswith('os%s.' % title.lower()))
            pdfs[title] = {'text': strip_headers(norm(' '.join(p.get_text() for p in pymupdf.open(stream=fetcher.read(rec), filetype='pdf')))) if rec['ok'] else None,
                           'rtf_unchanged': rtf.get('ok') and rtf['sha256'] == unit['original_sha256'], 'rtf_sha': rtf.get('sha256'),
                           'pdf_status': rec.get('status')}
        live = pdfs[title]
        num = r['hierarchy'][-1]['number']
        body = norm(r['text'])
        verdict = {'citation_path': r['citation_path'], 'title': title, 'status_row': r['status_note'] is not None,
                   'live_rtf_identical_to_retained': live['rtf_unchanged'], 'live_pdf_http': live['pdf_status']}
        if live['text'] is None:
            verdict.update(verdict='unverifiable', reason='live PDF not retrievable')
        else:
            probe = ' '.join(body.split()[:14])
            heading_ok = norm(r['heading'] or '')[:60] in live['text']
            start = live['text'].find(probe)
            if start < 0:
                verdict.update(verdict='mismatch', ratio=None, reason='landed opening words not found in live PDF text',
                               heading_found=heading_ok)
            else:
                region = live['text'][start:start + len(body) + 60]
                n = len(words(r['text']))
                ratio, v = compare(r['text'], ' '.join(words(region)[:n]))
                hist_ok = (not r['history']) or norm(r['history']) in live['text']
                verdict.update(verdict=v if hist_ok else 'mismatch', ratio=round(ratio, 4), heading_found=heading_ok,
                               history_found=hist_ok, chars=len(body))
        results.append(verdict)
    summary = {'sampled': len(results), 'match': sum(v['verdict'] == 'match' for v in results),
               'mismatch': sum(v['verdict'] == 'mismatch' for v in results),
               'unverifiable': sum(v['verdict'] == 'unverifiable' for v in results),
               'live_rtf_unchanged_titles': sum(1 for t in pdfs.values() if t['rtf_unchanged']), 'titles_fetched': len(pdfs)}
    json.dump({'summary': summary, 'results': results}, open(ROOT + '/review/review-result.json', 'w'), indent=1)
    print(json.dumps(summary))
    for v in results:
        if v['verdict'] != 'match':
            print(json.dumps(v)[:400])


if __name__ == '__main__':
    main()
