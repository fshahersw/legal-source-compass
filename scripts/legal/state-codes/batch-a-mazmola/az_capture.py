"""Arizona Revised Statutes capture from azleg.gov, honouring robots.txt Crawl-delay: 120.

arstitle index, then per title arsDetail/?title=N (section list), then one /ars/<title>/<nnnnn>.htm per section.
Direct fetches only, 120 s between requests to the host (robots.txt: Crawl-delay 120 for User-agent *).
Resumable. Raw bodies: /tmp/sc/AZ.
"""
import html as htmllib
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from provenance_fetch import Fetcher, now_iso as az_parse_now  # noqa: E402
import az_parse  # noqa: E402
from az_deadline import HardDeadline, run_with_deadline  # noqa: E402

ROOT = '/tmp/sc/AZ'
F = Fetcher('AZ', ROOT, min_interval=float(os.environ.get('AZ_INTERVAL', '120')), timeout=120)
STOP = ROOT + '/STOP'
REQUEST_DEADLINE = float(os.environ.get('AZ_REQUEST_DEADLINE', '300'))  # hard wall-clock limit for one request; not the crawl delay


def main():
    idx = F.get('https://www.azleg.gov/arstitle/', label='ars-title-index')
    if not idx.get('ok'):
        raise SystemExit('index failed')
    index_html = F.read(idx).decode('utf8')
    titles = []
    for t in re.findall(r'href="https://www\.azleg\.gov/arsDetail/?\?title=([0-9A-Za-z.\-]+)"', index_html):
        if t not in titles:
            titles.append(t)
    print('titles', titles, flush=True)
    for t in titles:
        d = F.get('https://www.azleg.gov/arsDetail/?title=%s' % t, label='title-detail:%s' % t)
        if not d.get('ok'):
            print('FAIL title', t, flush=True)
            continue
        h = F.read(d).decode('utf8', 'replace')
        # The publisher's own section links (a.stat). Filenames can carry a hyphen (00109-01.htm); the earlier pattern dropped those.
        urls = az_parse.listed_urls(h)
        raw = len(set(re.findall(r'docName=(https://www\.azleg\.gov/ars/[^"&]+\.htm)', htmllib.unescape(h))))
        if raw != len(urls):
            raise SystemExit('title %s: %d docName links on the page but %d section links parsed; refusing to continue' % (t, raw, len(urls)))
        print('title', t, 'sections', len(urls), flush=True)
        failed = []
        for u in urls + [None]:
            if u is None:
                # one retry pass for requests that failed or hit the hard deadline; each retry is paced like any other request
                urls_now, failed = failed, []
                if not urls_now:
                    break
                print('title', t, 'retrying', len(urls_now), flush=True)
            else:
                urls_now = [u]
            for uu in urls_now:
                if os.path.exists(STOP):
                    print('STOP file present', flush=True)
                    return
                try:
                    r = run_with_deadline(REQUEST_DEADLINE, F.get, uu, label='section:title%s' % t)
                except HardDeadline:
                    F.session.close()
                    F._append({'state': 'AZ', 'url': uu, 'label': 'section:title%s' % t, 'ok': False, 'status': None,
                               'error': 'HardDeadline: no response within %ds' % REQUEST_DEADLINE, 'retrieval_method': 'direct',
                               'retrieved_at': az_parse_now()})
                    print('DEADLINE', uu, flush=True)
                    failed.append(uu)
                    continue
                if not r.get('ok'):
                    print('FAIL', uu, r.get('status'), r.get('error'), flush=True)
                    if u is not None:
                        failed.append(uu)


if __name__ == '__main__':
    main()
