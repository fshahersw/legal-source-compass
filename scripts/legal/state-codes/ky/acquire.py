"""Kentucky Revised Statutes capture (LRC unofficial online version) with provenance receipts.

Stages: `inventory` (title index + info pages + every chapter page) and `sections`
(every statute.aspx page linked from the captured chapter pages). Resumable: already
captured URLs are skipped. Usage: acquire.py <stage> [--root /tmp/sc/KY]
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher  # noqa: E402

import parse_index  # noqa: E402

BASE = 'https://apps.legislature.ky.gov/law/statutes/'
INFO_PAGES = [
    'https://legislature.ky.gov/Law/Statutes/Pages/default.aspx',
    'https://legislature.ky.gov/Law/Statutes/Pages/StatRevInfo.aspx',
    'https://legislature.ky.gov/Law/Statutes/Pages/KRSEDS.aspx',
    'https://legislature.ky.gov/Law/Statutes/Pages/KRSHistory.aspx',
    'https://legislature.ky.gov/Law/Statutes/Pages/KrsEffDates.aspx',
    'https://legislature.ky.gov/Law/Statutes/Pages/KrsExtraOrdList.aspx',
    'https://legislature.ky.gov/policies-security/Pages/Disclaimers.aspx',
    'https://legislature.ky.gov/policies-security/Pages/default.aspx',
    'https://apps.legislature.ky.gov/robots.txt',
]


def chapter_url(href):
    return BASE + href


def inventory(f):
    idx = f.get(BASE, label='title-index')
    assert idx['ok'], idx
    for url in INFO_PAGES:
        f.get(url, label='info')
    chapters = parse_index.parse_index(f.read(idx))['chapters']
    todo = [c for c in chapters if c['href']]
    for n, c in enumerate(todo, 1):
        r = f.get(chapter_url(c['href']), label='chapter:%s' % c['chapter_label'])
        if not r['ok']:
            print('FAIL chapter', c['href'], r.get('status'), r.get('error'), flush=True)
        if n % 50 == 0:
            print('chapters', n, '/', len(todo), flush=True)


def section_urls(f, successful=None):
    if successful is None:
        successful = {
            r['url']: r
            for r in f.receipts()
            if r.get('ok') and r.get('retrieval_method') == 'direct'
        }
    if BASE not in successful:
        idx = f.get(BASE, label='title-index')
        if not idx['ok']:
            raise SystemExit('title index missing')
        successful[BASE] = idx
    chapters = parse_index.parse_index(f.read(successful[BASE]))['chapters']
    seen = {}
    for c in chapters:
        if not c['href']:
            continue
        unit_url = chapter_url(c['href'])
        if unit_url not in successful:
            raise SystemExit('chapter missing: %s' % c['href'])
        for s in parse_index.parse_chapter(f.read(successful[unit_url]))['sections']:
            seen.setdefault(BASE + s['href'], c['href'])
    return list(seen)


def sections(f, shard_index=0, shard_count=1):
    successful = {
        r['url']: r
        for r in f.receipts()
        if r.get('ok') and r.get('retrieval_method') == 'direct'
    }
    urls = section_urls(f, successful)
    print('section urls', len(urls), flush=True)
    done = set(successful)
    todo = sorted(u for u in urls if u not in done)
    if shard_count > 1:
        start = len(todo) * shard_index // shard_count
        end = len(todo) * (shard_index + 1) // shard_count
        todo = todo[start:end]
        print('shard', shard_index, '/', shard_count, 'todo', len(todo), 'range', start, end, flush=True)
    fails = 0
    requested = 0
    for n, url in enumerate(todo, 1):
        r = f.get(url, label='section', force=True)
        requested += 1
        if not r['ok']:
            fails += 1
            print('FAIL', url, r.get('status'), r.get('error'), flush=True)
            if r.get('status') == 403:
                raise SystemExit('persistent 403: stop')
        if requested % 200 == 0:
            print('sections', n, '/', len(todo), 'requested', requested, 'fails', fails, flush=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['inventory', 'sections'])
    ap.add_argument('--root', default='/tmp/sc/KY')
    ap.add_argument('--shard-index', type=int, default=0, help='0-based shard when using --shard-count')
    ap.add_argument('--shard-count', type=int, default=1, help='split remaining section URLs into N disjoint ranges')
    a = ap.parse_args()
    if a.shard_count < 1 or a.shard_index < 0 or a.shard_index >= a.shard_count:
        raise SystemExit('invalid --shard-index / --shard-count')
    fetcher = Fetcher('KY', a.root, min_interval=1.0)
    if a.stage == 'inventory':
        inventory(fetcher)
    else:
        sections(fetcher, a.shard_index, a.shard_count)
