#!/usr/bin/env python3
"""Acquire the Code of Virginia from the official DLS/LIS site (law.lis.virginia.gov).

Phases (all direct, 1 s/host pacing, receipts via common/provenance_fetch.Fetcher):
  meta      portal pages (vacode TOC, updates, law-library, developers, API help)
  titles    official web-service title list (inventory source #1)
  chapters  web-service chapter list per title (inventory source #2)
  sections  web-service section list per chapter (inventory source #3, independent of bodies)
  bodies    /vacodefull/title<N>/ whole-title HTML (the text bodies that get parsed)
  csv       official per-title CSV bulk files (stale 2025 baseline; audit cross-check only)
Resumable: a URL with an existing ok receipt is never re-fetched.

    va_acquire.py [phases...] [--root DIR] [--worker I --workers N]

--worker/--workers split the titles round-robin so several processes can capture in parallel, each into its own root;
merge_roots.py combines their receipts and content-addressed bodies into one root for parsing.
"""
import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'common'))
from provenance_fetch import Fetcher  # noqa: E402

BASE = 'https://law.lis.virginia.gov'
ROOT = pathlib.Path('/tmp/sc/VA')


def log(msg):
    print(msg, flush=True)


def jget(f, url, label):
    r = f.get(url, label=label)
    if not r.get('ok'):
        log('FAIL %s status=%s err=%s' % (url, r.get('status'), r.get('error')))
        return None, r
    return json.loads(f.read(r).decode('utf8')), r


def main(phases, root=ROOT, worker=0, workers=1):
    f = Fetcher('VA', root, min_interval=1.0)
    if 'meta' in phases and worker == 0:
        for path, label in (('/vacode/', 'portal-toc'), ('/vacodeupdates/', 'portal-2026-updates'),
                            ('/law-library/', 'portal-law-library'), ('/developers/', 'portal-developers'),
                            ('/jsonapi/', 'portal-jsonapi-help'), ('/vacodepopularnames', 'portal-popular-names')):
            r = f.get(BASE + path, label=label)
            log('%s %s %s' % (label, r.get('status'), r.get('bytes')))
    titles, r = jget(f, BASE + '/api/CoVTitlesGetListOfJson/', 'api-titles')
    nums = []
    for t in titles or []:
        if t['TitleNumber'] not in nums:
            nums.append(t['TitleNumber'])
    log('titles: %d distinct numbers (%d rows)' % (len(nums), len(titles or [])))
    nums = nums[worker::workers]
    if 'bodies' in phases:
        for n in nums:
            r = f.get('%s/vacodefull/title%s/' % (BASE, n), label='title-body:' + n)
            log('body %s %s %s' % (n, r.get('status'), r.get('bytes')))
    if 'chapters' in phases or 'sections' in phases:
        for n in nums:
            ch, r = jget(f, '%s/api/CoVChaptersGetListOfJson/%s/' % (BASE, n), 'api-chapters:' + n)
            if not ch:
                continue
            if 'sections' in phases:
                for c in ch.get('ChapterList') or []:
                    d, r = jget(f, '%s/api/CoVSectionsGetListOfJson/%s/%s/' % (BASE, n, c['ChapterNum']),
                                'api-sections:%s:%s' % (n, c['ChapterNum']))
            log('chapters/sections title %s done' % n)
    if 'csv' in phases and worker == 0:
        lib = f.get(BASE + '/law-library/', label='portal-law-library')
        import re
        html = f.read(lib).decode('utf8')
        for h in sorted(set(re.findall(r'href="(/CSV/CoVTitle_[^"]+\.csv)"', html))):
            r = f.get(BASE + h, label='csv:' + h)
            log('csv %s %s %s' % (h, r.get('status'), r.get('bytes')))
    log('DONE ' + ','.join(phases))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('phases', nargs='*', default=['meta', 'bodies', 'chapters', 'sections', 'csv'])
    ap.add_argument('--root', type=pathlib.Path, default=ROOT)
    ap.add_argument('--worker', type=int, default=0)
    ap.add_argument('--workers', type=int, default=1)
    a = ap.parse_args()
    main(a.phases, a.root, a.worker, a.workers)
