"""Alabama Code capture from ALISON (Alabama Legislative Information System Online).

The public human site is a Next.js shell at /code-of-alabama. Section text is delivered
gate-free as JSON from the official Express API:

  GET https://alison.legislature.state.al.us/api/code-of-alabama?page=<n>

Each page returns up to 500 mixed hierarchy nodes; section rows include HTML in
``content``. No API key, login, or terms acceptance is required on this route. Direct
fetch only (see common/provenance_fetch.py); no proxy or browser impersonation.

Usage:
  python3 al_acquire.py probe [--root /tmp/sc/AL]
  python3 al_acquire.py capture [--root /tmp/sc/AL] [--max-pages N]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher, now_iso, verify_store  # noqa: E402

BASE = 'https://alison.legislature.state.al.us'
API = BASE + '/api/code-of-alabama'
LANDING = BASE + '/code-of-alabama'
LEGACY_HOST = 'https://legislature.state.al.us/codeofalabama/1975/coatoc.htm'
PURCHASING_POINTER = 'https://purchasing.alabama.gov/code-of-alabama'
SPA_MARK = b'turbopack-'


def api_url(page: int) -> str:
    return API if page <= 1 else '%s?page=%d' % (API, page)


def classify(body: bytes, kind: str) -> str:
    if kind == 'api-page':
        try:
            data = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 'unexpected'
        if not isinstance(data, list):
            return 'unexpected'
        sections = [x for x in data if x.get('type') == 'Section' and x.get('content')]
        return 'api-sections' if sections else ('api-empty' if not data else 'api-structure-only')
    if kind == 'html':
        return 'spa-shell' if SPA_MARK in body or b'/_next/static/chunks/' in body else 'html'
    return 'unexpected'


def summarize_page(body: bytes) -> dict:
    data = json.loads(body)
    counts = {}
    for row in data:
        counts[row.get('type', '?')] = counts.get(row.get('type', '?'), 0) + 1
    sections = [x for x in data if x.get('type') == 'Section' and x.get('content')]
    return {
        'items': len(data),
        'type_counts': counts,
        'sections_with_content': len(sections),
        'first_section': sections[0]['displayId'] if sections else None,
        'last_section': sections[-1]['displayId'] if sections else None,
    }


def probe_plan() -> list[tuple[str, str, str, tuple[int, ...]]]:
    return [
        ('landing', LANDING, 'html', (200,)),
        ('robots', BASE + '/robots.txt', 'html', (200,)),
        ('api-page-1', api_url(1), 'api-page', (200,)),
        ('api-page-2', api_url(2), 'api-page', (200,)),
        ('purchasing-pointer', PURCHASING_POINTER, 'html', (200, 301, 302, 403)),
        ('legacy-host', LEGACY_HOST, 'html', (200, 301, 302, 404, 403)),
    ]


def discover_last_page(fetcher: Fetcher) -> int:
    """Binary search the highest API page that returns a non-empty JSON array."""
    lo, hi, last = 1, 512, 1
    while lo <= hi:
        mid = (lo + hi) // 2
        receipt = fetcher.get(api_url(mid), label='discover-page:%d' % mid, ok_statuses=(200,))
        if not receipt.get('ok'):
            hi = mid - 1
            continue
        data = json.loads(fetcher.read(receipt))
        if data:
            last = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return last


def run_probe(fetcher: Fetcher, root: pathlib.Path) -> list[dict]:
    results = []
    for label, url, kind, ok_statuses in probe_plan():
        receipt = fetcher.get(url, label='probe:' + label, ok_statuses=ok_statuses)
        verdict = 'transport-failure'
        summary = None
        if receipt.get('ok'):
            verdict = classify(fetcher.read(receipt), kind)
            if kind == 'api-page':
                summary = summarize_page(fetcher.read(receipt))
        row = {
            'label': label,
            'url': url,
            'status': receipt.get('status'),
            'bytes': receipt.get('bytes'),
            'sha256': receipt.get('sha256'),
            'verdict': verdict,
            'summary': summary,
            'error': receipt.get('error'),
        }
        results.append(row)
        print(label, receipt.get('status'), receipt.get('bytes'), verdict, summary or receipt.get('error'), flush=True)
    last_page = discover_last_page(fetcher)
    tail = fetcher.get(api_url(last_page), label='probe:api-last-page')
    tail_summary = summarize_page(fetcher.read(tail)) if tail.get('ok') else None
    results.append({
        'label': 'api-last-page',
        'url': api_url(last_page),
        'status': tail.get('status'),
        'bytes': tail.get('bytes'),
        'sha256': tail.get('sha256'),
        'verdict': classify(fetcher.read(tail), 'api-page') if tail.get('ok') else 'transport-failure',
        'summary': tail_summary,
        'discovered_last_page': last_page,
    })
    print('discovered_last_page', last_page, tail_summary, flush=True)
    out = root / 'logs' / ('probe-%s.json' % now_iso())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2, sort_keys=True) + '\n')
    plan = root / 'extract' / 'capture-plan.json'
    plan.parent.mkdir(parents=True, exist_ok=True)
    plan.write_text(json.dumps({
        'publisher': 'Alabama Legislative Services Agency (ALISON)',
        'api_pattern': API + '?page={page}',
        'discovered_last_page': last_page,
        'probe_verdict': 'gate-free-api',
        'html_route_note': 'Human /code-of-alabama URLs return the Next.js shell only; use the API for bodies.',
    }, indent=2, sort_keys=True) + '\n')
    return results


def run_capture(fetcher: Fetcher, root: pathlib.Path, max_pages: int) -> dict:
    last_page = discover_last_page(fetcher) if not max_pages else min(max_pages, discover_last_page(fetcher))
    totals = {'pages': 0, 'sections_with_content': 0, 'items': 0}
    for page in range(1, last_page + 1):
        receipt = fetcher.get(api_url(page), label='api-page:%d' % page)
        if not receipt.get('ok'):
            raise SystemExit('capture failed page %d: %s' % (page, receipt))
        summary = summarize_page(fetcher.read(receipt))
        totals['pages'] += 1
        totals['items'] += summary['items']
        totals['sections_with_content'] += summary['sections_with_content']
        if page % 10 == 0 or page == last_page:
            print('capture', page, '/', last_page, summary['sections_with_content'], 'sections this page', flush=True)
    totals['last_page'] = last_page
    totals_path = root / 'extract' / 'capture-totals.json'
    totals_path.parent.mkdir(parents=True, exist_ok=True)
    totals_path.write_text(json.dumps(totals, indent=2, sort_keys=True) + '\n')
    return totals


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['probe', 'capture'])
    ap.add_argument('--root', default='/tmp/sc/AL')
    ap.add_argument('--max-pages', type=int, default=0,
                    help='capture at most N API pages (0 = all discovered pages)')
    args = ap.parse_args(argv)
    root = pathlib.Path(args.root)
    fetcher = Fetcher('AL', root, min_interval=1.0, timeout=120)
    if args.mode == 'probe':
        run_probe(fetcher, root)
    else:
        run_capture(fetcher, root, args.max_pages)
    checked, problems = verify_store(root)
    print('verify_store', checked, 'problems', len(problems), flush=True)
    return 0 if not problems else 2


if __name__ == '__main__':
    raise SystemExit(main())
