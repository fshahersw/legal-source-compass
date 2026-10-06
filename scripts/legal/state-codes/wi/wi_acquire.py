"""Wisconsin Statutes acquisition: official LRB site docs.legis.wisconsin.gov.

Captures, via the shared provenance Fetcher (direct fetch only, no proxy):
  seeds   - statutes chapter list page, prefaces (TOC, coverage, certificates), statutes help page
  per chapter - chapter TOC page (HTML), .txt and .json renditions, certified-print .pdf
The chapter list is read from the publisher's own index page and cross-checked against the
prefaces table of contents; nothing is inferred.

usage: wi_acquire.py [--root /tmp/sc/WI] [--only 893,1]
"""
import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher, verify_store  # noqa: E402

BASE = 'https://docs.legis.wisconsin.gov'
SEEDS = [
    ('/statutes/statutes', 'index-html'),
    ('/statutes/prefaces/toc', 'prefaces-toc-html'),
    ('/statutes/prefaces/toc.txt', 'prefaces-toc-txt'),
    ('/statutes/prefaces/toc.json', 'prefaces-toc-json'),
    ('/statutes/prefaces/coverage.txt', 'prefaces-coverage-txt'),
    ('/statutes/prefaces/certificate.txt', 'prefaces-certificate-txt'),
    ('/statutes/prefaces/certificate_offline.txt', 'prefaces-certificate-offline-txt'),
    ('/help/statutes', 'help-statutes-html'),
    ('/statutes', 'statutes-landing-html'),
    ('/robots.txt', 'robots-txt'),
]
CHAPTER_FORMS = [
    ('/statutes/statutes/{chapter}', 'chapter-toc-html'),
    ('/statutes/statutes/{chapter}.txt', 'chapter-txt'),
    ('/statutes/statutes/{chapter}.json', 'chapter-json'),
    ('/statutes/statutes/{chapter}.pdf', 'chapter-pdf'),
]
HREF = re.compile(r'href="/document/statutes/([0-9]+[A-Za-z]*)\.pdf"')


def chapter_ids_from_index(html):
    seen = []
    for m in HREF.finditer(html):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def chapter_ids_from_prefaces_toc(txt):
    ids = []
    for line in txt.splitlines():
        m = re.match(r'^([0-9]+[A-Za-z]*)\. ', line)
        if m:
            ids.append(m.group(1))
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='/tmp/sc/WI')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    f = Fetcher('WI', root, min_interval=1.0, timeout=120)
    results = {}
    for path, label in SEEDS:
        r = f.get(BASE + path, label=label)
        results[label] = r
        print(label, r.get('status'), r.get('bytes'), flush=True)
    idx = results['index-html']
    toc = results['prefaces-toc-txt']
    if not (idx.get('ok') and toc.get('ok')):
        print('seed capture failed; stop')
        return 2
    from_index = chapter_ids_from_index(f.read(idx).decode('utf8'))
    from_toc = chapter_ids_from_prefaces_toc(f.read(toc).decode('utf8'))
    plan = {'chapters_index_page': from_index, 'chapters_prefaces_toc': from_toc,
            'only_in_index': sorted(set(from_index) - set(from_toc)),
            'only_in_toc': sorted(set(from_toc) - set(from_index))}
    (root / 'extract').mkdir(exist_ok=True)
    (root / 'extract' / 'capture-plan.json').write_text(json.dumps(plan, indent=1))
    print('chapters index=%d toc=%d diff=%s/%s' % (len(from_index), len(from_toc), plan['only_in_index'], plan['only_in_toc']), flush=True)
    chapters = [c for c in from_index if not args.only or c in args.only.split(',')]
    failures = []
    for n, ch in enumerate(chapters, 1):
        for path, label in CHAPTER_FORMS:
            r = f.get(BASE + path.format(chapter=ch), label='%s:%s' % (label, ch))
            if not r.get('ok'):
                failures.append((ch, label, r.get('status'), r.get('error')))
                print('FAIL', ch, label, r.get('status'), r.get('error'), flush=True)
                if r.get('status') in (403, 429):
                    print('access block; stopping')
                    json.dump(failures, open(root / 'logs' / 'failures.json', 'w'))
                    return 3
        if n % 25 == 0:
            print('chapter %d/%d (%s)' % (n, len(chapters), ch), flush=True)
    json.dump(failures, open(root / 'logs' / 'failures.json', 'w'))
    checked, problems = verify_store(root)
    print('verify_store checked=%d problems=%d failures=%d' % (checked, len(problems), len(failures)))
    return 0 if not problems and not failures else 1


if __name__ == '__main__':
    sys.exit(main())
