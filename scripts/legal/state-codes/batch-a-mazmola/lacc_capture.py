"""Louisiana Civil Code capture from legis.la.gov (its own code, folder 67; not part of the Revised Statutes).

One Laws_Toc.aspx?folder=67 page lists every article document; one LawPrint.aspx?d=<doc id> page per article.
Direct fetches only, >=1 s per host, resumable. Raw bodies: /tmp/sc/LACC.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast_fetcher import FastFetcher as Fetcher  # noqa: E402

ROOT = '/tmp/sc/LACC'
BASE = 'https://legis.la.gov/legis/'
TOC = BASE + 'Laws_Toc.aspx?folder=67&level=Parent'
F = Fetcher('LACC', ROOT, min_interval=1.0, timeout=120)


def main():
    toc = F.get(TOC, label='cc-toc')
    if not toc.get('ok'):
        raise SystemExit('toc failed')
    html = F.read(toc).decode('utf8', 'replace')
    docs = []
    for m in re.finditer(r'href="Law\.aspx\?d=(\d+)"', html):
        if m.group(1) not in docs:
            docs.append(m.group(1))
    json.dump(docs, open(ROOT + '/docs.json', 'w'))
    print('docs', len(docs), flush=True)
    bad = 0
    for i, d in enumerate(docs):
        r = F.get('%sLawPrint.aspx?d=%s' % (BASE, d), label='article')
        if not r.get('ok'):
            bad += 1
            print('FAIL', d, r.get('status'), r.get('error'), flush=True)
        if i % 250 == 0:
            print('doc', i, 'of', len(docs), 'bad', bad, flush=True)
    print('done', len(docs), 'bad', bad, flush=True)


if __name__ == '__main__':
    main()
