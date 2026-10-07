"""Polite, resumable, provenance-recording HTTP capture for official state-code sources.

Every response body is stored content-addressed (raw/<sha[:2]>/<sha256>) and every
attempt, including failures, appends one JSON line to receipts.jsonl. Bodies are never
altered. Proxied fetches (Firecrawl/Tavily) are recorded with retrieval_method
"proxied:<service>" and are derivatives, not original bytes. No credentials are
written anywhere: proxy keys are read from the environment at call time only.
"""
import hashlib
import json
import os
import pathlib
import threading
import time
import urllib.parse

import requests

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

DEFAULT_UA = 'LegalSourceAtlas-corpus-capture/1.0 (research; official-source archival; contact: owner)'
KEPT_HEADERS = ('content-type', 'content-length', 'content-encoding', 'etag', 'last-modified',
                'content-disposition', 'cache-control', 'server', 'date', 'x-powered-by')
_host_lock = threading.Lock()
_last_start = {}


def now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


class Fetcher:
    def __init__(self, state, root, min_interval=1.0, user_agent=DEFAULT_UA, timeout=60,
                 retries=3, max_bytes=2_000_000_000):
        self.state = state
        self.root = pathlib.Path(root)
        self.raw = self.root / 'raw'
        self.raw.mkdir(parents=True, exist_ok=True)
        self.receipts_path = self.root / 'receipts.jsonl'
        self.min_interval = min_interval
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.max_bytes = max_bytes
        self.session = requests.Session()
        self.session.headers['User-Agent'] = user_agent
        self._done = None

    def _pace(self, host):
        with _host_lock:
            wait = _last_start.get(host, 0) + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            _last_start[host] = time.monotonic()

    def _append(self, receipt):
        line = json.dumps(receipt, sort_keys=True, ensure_ascii=False) + '\n'
        with open(self.receipts_path, 'a', encoding='utf8') as handle:
            if fcntl:
                fcntl.flock(handle, fcntl.LOCK_EX)
            handle.write(line)
            handle.flush()
            if fcntl:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def receipts(self):
        if not self.receipts_path.exists():
            return []
        return [json.loads(x) for x in self.receipts_path.read_text(encoding='utf8').splitlines() if x.strip()]

    def captured(self, url):
        """Return the existing successful receipt for url, if any (resume support)."""
        for r in self.receipts():
            if r['url'] == url and r.get('ok') and r.get('retrieval_method') == 'direct':
                return r
        return None

    def path_for(self, sha):
        return self.raw / sha[:2] / sha

    def get(self, url, label=None, headers=None, force=False, ok_statuses=(200,)):
        """GET url once (with transport retries). Always returns the receipt dict."""
        if not force:
            prior = self.captured(url)
            if prior:
                return prior
        host = urllib.parse.urlsplit(url).netloc
        last = None
        for attempt in range(1, self.retries + 1):
            self._pace(host)
            started = now_iso()
            t0 = time.monotonic()
            receipt = {'state': self.state, 'url': url, 'label': label, 'attempt': attempt,
                       'retrieved_at': started, 'retrieval_method': 'direct',
                       'user_agent': self.user_agent, 'ok': False}
            tmp = self.raw / ('.tmp-%d-%d' % (os.getpid(), threading.get_ident()))
            try:
                with self.session.get(url, stream=True, timeout=self.timeout, headers=headers or {}) as resp:
                    digest = hashlib.sha256()
                    size = 0
                    with open(tmp, 'wb') as out:
                        for chunk in resp.iter_content(1 << 16):
                            size += len(chunk)
                            if size > self.max_bytes:
                                raise IOError('response exceeds max_bytes')
                            digest.update(chunk)
                            out.write(chunk)
                    receipt.update({'status': resp.status_code, 'final_url': resp.url,
                                    'redirects': [r.url for r in resp.history],
                                    'headers': {k: v for k, v in resp.headers.items() if k.lower() in KEPT_HEADERS},
                                    'bytes': size, 'sha256': digest.hexdigest(),
                                    'elapsed_s': round(time.monotonic() - t0, 3)})
                    declared = resp.headers.get('content-length')
                    if (declared and declared.isdigit() and not resp.headers.get('content-encoding')
                            and int(declared) != size):
                        raise IOError('truncated body: declared %s got %d' % (declared, size))
                    if resp.status_code in ok_statuses:
                        dest = self.path_for(receipt['sha256'])
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        if not dest.exists():
                            os.replace(tmp, dest)
                        receipt['ok'] = True
                        receipt['stored_path'] = str(dest.relative_to(self.root))
            except Exception as exc:  # transport failure: recorded, never hidden
                receipt['error'] = '%s: %s' % (type(exc).__name__, str(exc)[:300])
            finally:
                if tmp.exists():
                    tmp.unlink()
            self._append(receipt)
            last = receipt
            if receipt['ok']:
                return receipt
            status = receipt.get('status')
            if status and status < 500 and status != 429:
                return receipt
            time.sleep(min(30, 2 ** attempt * 2))
        return last

    def read(self, receipt):
        return (self.root / receipt['stored_path']).read_bytes()

    def proxied(self, url, service='firecrawl', label=None, options=None):
        """Fallback for bot-blocked official hosts; recorded as a lower-grade derivative.

        options are extra Firecrawl scrape fields (e.g. {'maxAge': 0} to refuse a cached copy); they are kept on the receipt.
        """
        started = now_iso()
        receipt = {'state': self.state, 'url': url, 'label': label, 'retrieved_at': started,
                   'retrieval_method': 'proxied:' + service, 'ok': False}
        try:
            if service == 'firecrawl':
                request = {'url': url, 'formats': ['rawHtml'], **(options or {})}
                if options:
                    receipt['proxy_options'] = options
                resp = requests.post('https://api.firecrawl.dev/v1/scrape', timeout=120,
                                     headers={'Authorization': 'Bearer ' + os.environ['FIRECRAWL_API_KEY']},
                                     json=request)
                receipt['status'] = resp.status_code
                data = resp.json().get('data') or {}
                body = (data.get('rawHtml') or '').encode('utf8')
                meta = data.get('metadata') or {}
                receipt['source_status'] = meta.get('statusCode')
                kept = {k: meta[k] for k in ('scrapeId', 'cacheState', 'proxyUsed', 'creditsUsed', 'sourceURL') if meta.get(k) is not None}
                if kept:
                    receipt['proxy_metadata'] = kept
            else:
                resp = requests.post('https://api.tavily.com/extract', timeout=120,
                                     headers={'Authorization': 'Bearer ' + os.environ['TAVILY_API_KEY']},
                                     json={'urls': [url]})
                results = resp.json().get('results') or []
                body = (results[0].get('raw_content') if results else '').encode('utf8')
                receipt['status'] = resp.status_code
            if body:
                sha = hashlib.sha256(body).hexdigest()
                dest = self.path_for(sha)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(body)
                receipt.update({'bytes': len(body), 'sha256': sha, 'ok': True,
                                'stored_path': str(dest.relative_to(self.root)),
                                'derivative_of_original': True})
        except Exception as exc:
            receipt['error'] = '%s: %s' % (type(exc).__name__, str(exc)[:300])
        self._append(receipt)
        return receipt


def sha256_file(path, block=1 << 20):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(block), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_store(root):
    """Re-hash every stored body against its receipt; returns (checked, problems)."""
    root = pathlib.Path(root)
    problems = []
    checked = 0
    seen = set()
    for line in (root / 'receipts.jsonl').read_text(encoding='utf8').splitlines():
        r = json.loads(line)
        if not r.get('ok') or r['sha256'] in seen:
            continue
        seen.add(r['sha256'])
        checked += 1
        path = root / r['stored_path']
        if not path.exists() or sha256_file(path) != r['sha256'] or path.stat().st_size != r['bytes']:
            problems.append(r['url'])
    return checked, problems
