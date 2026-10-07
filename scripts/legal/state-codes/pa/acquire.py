"""Capture the Pennsylvania Consolidated Statutes (and Constitution) from palegis.us.

Direct requests to palegis.us / legis.state.pa.us time out from this environment (no HTTP
response; not a terms/login/captcha gate), so each document is retrieved through Firecrawl
and recorded as retrieval_method proxied:firecrawl. The publisher serves each title as one
HTML document inside an iframe; that iframe URL is the document captured.
"""
import html
import os
import pathlib
import re
import sys
import time

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from common.provenance_fetch import Fetcher, now_iso

ROOT = pathlib.Path(os.environ.get('PA_ROOT', '/tmp/sc/PA'))
INDEX = 'https://www.palegis.us/statutes/consolidated'
DOC = 'https://www.palegis.us/statutes/consolidated/view-statute?50&iFrame=true&txtType=HTM&ttl=%s'


class WaitFetcher(Fetcher):
    """Firecrawl scrape with a render wait, for the JavaScript-built title list only."""

    def proxied_wait(self, url, label, wait_ms=4000):
        import os
        receipt = {'state': self.state, 'url': url, 'label': label, 'retrieved_at': now_iso(),
                   'retrieval_method': 'proxied:firecrawl', 'proxy_options': {'waitFor': wait_ms}, 'ok': False}
        resp = requests.post('https://api.firecrawl.dev/v1/scrape', timeout=180,
                             headers={'Authorization': 'Bearer ' + os.environ['FIRECRAWL_API_KEY']},
                             json={'url': url, 'formats': ['rawHtml'], 'waitFor': wait_ms})
        data = resp.json().get('data') or {}
        body = (data.get('rawHtml') or '').encode('utf8')
        receipt['status'] = resp.status_code
        receipt['source_status'] = (data.get('metadata') or {}).get('statusCode')
        if body:
            import hashlib
            sha = hashlib.sha256(body).hexdigest()
            dest = self.path_for(sha)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            receipt.update({'bytes': len(body), 'sha256': sha, 'ok': True, 'stored_path': str(dest.relative_to(self.root)),
                            'derivative_of_original': True})
        self._append(receipt)
        return receipt


def title_numbers(index_html):
    return sorted(set(re.findall(r'view-statute\?txtType=HTM&(?:amp;)?ttl=(\w+)', index_html)), key=lambda x: (len(x.lstrip('0')) , x))


def complete(body):
    return body.rstrip().endswith('</html>') and '<div class="BodyContainer">' in body and '<title>' in body


def good(receipt):
    return receipt.get('ok') and receipt.get('retrieval_method') == 'proxied:firecrawl' and receipt.get('source_status') == 200


def latest_good(fetcher):
    found = {}
    for r in fetcher.receipts():
        if good(r):
            found[r['url']] = r
    return found


def main():
    fetcher = WaitFetcher('PA', ROOT, min_interval=1.0)
    have = latest_good(fetcher)
    if INDEX + '#wait' not in have and not any(r['url'] == INDEX and r.get('proxy_options') for r in fetcher.receipts() if r.get('ok')):
        fetcher.proxied_wait(INDEX, 'title-list')
    index = [r for r in fetcher.receipts() if r['url'] == INDEX and r.get('proxy_options') and r.get('ok')][-1]
    nums = title_numbers(fetcher.read(index).decode('utf8'))
    print('titles', len(nums), nums, flush=True)
    for n in nums:
        ttl = str(int(n))
        url = DOC % ttl
        if url in have and complete(fetcher.read(have[url]).decode('utf8', 'replace')):
            continue
        for attempt in range(3):
            time.sleep(1)
            receipt = fetcher.proxied(url, label='title-%s' % n)
            body = fetcher.read(receipt).decode('utf8', 'replace') if receipt.get('ok') else ''
            ok = good(receipt) and complete(body)
            print({'ttl': ttl, 'attempt': attempt + 1, 'ok': ok, 'bytes': receipt.get('bytes'), 'status': receipt.get('source_status'), 'err': receipt.get('error')}, flush=True)
            if ok:
                break


if __name__ == '__main__':
    main()
