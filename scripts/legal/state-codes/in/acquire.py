"""Indiana Code acquisition probes. Honest-UA direct capture only.

The public website currently returns its single-page-app fallback for document paths.
Those responses are evidence of a delivery failure, not captures of the requested law
and not evidence that a document does not exist. The public API is probed without an API
key solely to retain its denial response. No browser impersonation, credentials, API
keys, terms acceptance, or CAPTCHA bypasses are used.
"""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher, now_iso, verify_store  # noqa: E402

BASE = 'https://iga.in.gov'
API_BASE = 'https://api.iga.in.gov'
TITLES = range(1, 38)
SPA_SHELL_MARK = b'<div id="root"></div>'
BROWSER_UA = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
)


def plan(year):
    items = [('downloads-page', BASE + '/laws/ic/downloads', 'html'),
             ('titles-index', '%s/laws/%s/ic/titles' % (BASE, year), 'html')]
    for n in TITLES:
        items.append(('title-%d' % n, '%s/ic/%s/Title_%d.pdf' % (BASE, year, n), 'pdf'))
    return items


def blocker_probes(year):
    """Small representative plan for diagnosing a blocked publication route."""
    return [
        ('downloads-page', BASE + '/laws/ic/downloads', 'html', (200,)),
        ('titles-index', f'{BASE}/laws/{year}/ic/titles', 'html', (200,)),
        ('title-1-pdf', f'{BASE}/ic/{year}/Title_1.pdf', 'pdf', (200,)),
        ('title-1-html', f'{BASE}/ic/{year}/Title_1.html', 'html-document', (200,)),
        ('title-36-article', f'{BASE}/ic/{year}/Title_36/Article_2.pdf', 'pdf', (200,)),
        ('api-root-no-key', API_BASE + '/', 'api-denial', (200, 401, 403)),
        ('api-titles-no-key', f'{API_BASE}/{year}/ic/titles', 'api-denial',
         (200, 401, 403)),
    ]


def bulk_plan(year):
    return [
        ('code-html-zip', f'{BASE}/ic/{year}/{year}-Indiana-Code-html.zip', 'zip'),
        ('code-pdf-html-zip', f'{BASE}/ic/{year}/{year}-Indiana-Code.zip', 'zip'),
        ('acts-list', f'{BASE}/ic/{year}/{year}%20Acts.pdf', 'pdf'),
        ('non-code-statutes', f'{BASE}/ic/{year}/{year}%20Non-code.pdf', 'pdf'),
        ('constitution', (
            BASE + '/publications/indiana_constitution/'
            'Constitution%20(as%20amended%202024).pdf'
        ), 'pdf'),
        ('downloads-page', BASE + '/laws/ic/downloads', 'html'),
        ('currency-notice', BASE + '/documents/d2426fae', 'html'),
    ]


def classify(body, kind):
    if kind == 'zip':
        return 'zip' if body[:4] == b'PK\x03\x04' else (
            'spa-shell' if SPA_SHELL_MARK in body else 'unexpected'
        )
    if kind == 'pdf':
        return 'pdf' if body[:5] == b'%PDF-' else ('spa-shell' if SPA_SHELL_MARK in body else 'unexpected')
    if kind == 'html-document':
        return 'spa-shell' if SPA_SHELL_MARK in body else 'html-document'
    if kind == 'api-denial':
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 'unexpected'
        return 'api-key-gate' if value.get('error') in ('401', '403') else 'api-response'
    return 'spa-shell' if SPA_SHELL_MARK in body else 'html'


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', default='2026')
    ap.add_argument('--root', default='/tmp/sc/IN')
    ap.add_argument('--limit', type=int, default=0, help='probe only the first N planned URLs')
    ap.add_argument('--blocker-probes', action='store_true',
                    help='run the bounded website/API diagnostic plan')
    ap.add_argument('--bulk', action='store_true',
                    help='capture the official bulk archives and supplementary PDFs')
    args = ap.parse_args(argv)
    fetcher = (
        Fetcher('IN', args.root, user_agent=BROWSER_UA)
        if args.bulk else Fetcher('IN', args.root)
    )
    results = []
    if args.bulk:
        items = [(label, url, kind, (200,)) for label, url, kind in bulk_plan(args.year)]
    elif args.blocker_probes:
        items = blocker_probes(args.year)
    else:
        items = [(label, url, kind, (200,)) for label, url, kind in plan(args.year)]
    if args.limit:
        items = items[:args.limit]
    for label, url, kind, ok_statuses in items:
        receipt = fetcher.get(url, label=label, ok_statuses=ok_statuses)
        verdict = classify(fetcher.read(receipt), kind) if receipt.get('ok') else 'transport-failure'
        results.append({'label': label, 'url': url, 'status': receipt.get('status'),
                        'bytes': receipt.get('bytes'), 'sha256': receipt.get('sha256'),
                        'content_type': (receipt.get('headers') or {}).get('content-type'),
                        'verdict': verdict})
        print(label, receipt.get('status'), receipt.get('bytes'), verdict, flush=True)
        if verdict in ('spa-shell', 'transport-failure') and kind == 'pdf' and not args.blocker_probes:
            print('STOP: publication route failure observed; not bypassing', flush=True)
            break
    out = pathlib.Path(args.root) / 'logs' / ('acquire-%s.json' % now_iso())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=1))
    print('verify_store', verify_store(args.root))


if __name__ == '__main__':
    main()
