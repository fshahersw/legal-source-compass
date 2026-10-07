"""Shared landing helpers for publisher-code-intake/2 (service role, private).

Credentials are read from the environment at call time only (EXTERNAL_SUPABASE_URL,
EXTERNAL_SUPABASE_SERVICE_ROLE_KEY) and are never written to disk, logs or reports.
"""
import concurrent.futures as cf
import hashlib
import json
import os
import pathlib
import threading
import time
import uuid

import requests

BUCKET = 'corpus-originals'
GATES = {'publisher_native_entity': False, 'public_projection_allowed': False,
         'current_law_verified': False, 'calculation_activation_allowed': False}
_tls = threading.local()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def record_sha(data):
    return sha256_bytes(canonical(data).encode('utf8'))


def object_key(sha):
    return 'state-codes/sha256/%s/%s' % (sha[:2], sha)


def now_z():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


class Supa:
    def __init__(self):
        self.url = os.environ['EXTERNAL_SUPABASE_URL'].rstrip('/')
        self.key = os.environ['EXTERNAL_SUPABASE_SERVICE_ROLE_KEY']
        self.storage = self.url.replace('.supabase.co', '.storage.supabase.co') + '/storage/v1'

    def _session(self):
        s = getattr(_tls, 'session', None)
        if s is None:
            s = requests.Session()
            s.headers['apikey'] = self.key
            if not self.key.startswith('sb_'):
                s.headers['Authorization'] = 'Bearer ' + self.key
            _tls.session = s
        return s

    def rpc(self, name, payload, retries=4):
        body = json.dumps(payload, ensure_ascii=False).encode('utf8')
        last = None
        for attempt in range(retries):
            try:
                r = self._session().post('%s/rest/v1/rpc/%s' % (self.url, name), data=body, timeout=300,
                                         headers={'Content-Type': 'application/json'})
            except requests.RequestException as exc:
                last = 'transport %s' % type(exc).__name__
                time.sleep(2 ** attempt * 2)
                continue
            if r.status_code < 300:
                return r.json()
            last = 'HTTP %d %s' % (r.status_code, r.text[:600])
            if r.status_code < 500 and r.status_code != 429:
                break
            time.sleep(2 ** attempt * 2)
        raise RuntimeError('%s failed: %s' % (name, last))

    def put_and_readback(self, sha, data, content_type, text=False):
        """Upload immutable bytes if absent, then authenticated whole-object GET and sha256 check."""
        key = object_key(sha)
        s = self._session()
        last = None
        for attempt in range(4):
            try:
                got = s.get('%s/object/authenticated/%s/%s' % (self.storage, BUCKET, key), timeout=120)
                if got.status_code == 404 or (got.status_code == 400 and 'not_found' in got.text.lower().replace(' ', '_')) \
                        or (got.status_code == 400 and 'NoSuchKey' in got.text):
                    up = s.post('%s/object/%s/%s' % (self.storage, BUCKET, key), data=data, timeout=300,
                                headers={'Content-Type': content_type, 'x-upsert': 'false'})
                    if up.status_code not in (200, 201) and 'Duplicate' not in up.text and 'already exists' not in up.text:
                        raise IOError('upload HTTP %d %s' % (up.status_code, up.text[:300]))
                    got = s.get('%s/object/authenticated/%s/%s' % (self.storage, BUCKET, key), timeout=120)
                if got.status_code != 200 or got.headers.get('content-range'):
                    raise IOError('readback HTTP %d' % got.status_code)
                body = got.content
                if sha256_bytes(body) != sha or len(body) != len(data):
                    raise IOError('readback hash or length mismatch')
                receipt = {'bytes': len(body), 'bucket': BUCKET, 'object_key': key, 'readback_sha256': sha,
                           'readback_bytes': len(body), 'verification_method': 'authenticated-whole-object-get-sha256',
                           'http_status': 200, 'verified_at': now_z()}
                if text:
                    receipt['readback_text_encoding'] = 'utf-8'
                    receipt['readback_text_code_points'] = len(body.decode('utf-8'))
                return receipt
            except (requests.RequestException, IOError) as exc:
                last = '%s: %s' % (type(exc).__name__, str(exc)[:200])
                if 'mismatch' in last:
                    raise
                time.sleep(2 ** attempt * 2)
        raise RuntimeError('object %s: %s' % (sha[:12], last))


class Journal:
    """Append-only JSONL map sha -> readback receipt, so uploads resume without repeating work."""

    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.done = {}
        self.lock = threading.Lock()
        if self.path.exists():
            for line in self.path.read_text(encoding='utf8').splitlines():
                if line.strip():
                    r = json.loads(line)
                    self.done[r['sha256']] = r

    def add(self, sha, kind, receipt):
        rec = {'sha256': sha, 'kind': kind, 'receipt': receipt}
        with self.lock:
            self.done[sha] = rec
            with open(self.path, 'a', encoding='utf8') as h:
                h.write(json.dumps(rec, sort_keys=True) + '\n')


def upload_all(supa, journal, assets, workers=12, progress=None):
    """assets: iterable of (sha, kind, bytes, content_type). Skips journaled; returns count uploaded."""
    todo = [a for a in assets if a[0] not in journal.done]
    seen = set()
    uniq = []
    for a in todo:
        if a[0] not in seen:
            seen.add(a[0])
            uniq.append(a)
    n = [0]

    def one(a):
        sha, kind, data, ctype = a
        rcpt = supa.put_and_readback(sha, data, ctype, text=(kind == 'unit_text_derivative'))
        journal.add(sha, kind, rcpt)
        n[0] += 1
        if progress and n[0] % 1000 == 0:
            progress('uploaded %d of %d' % (n[0], len(uniq)))

    with cf.ThreadPoolExecutor(workers) as ex:
        for f in cf.as_completed([ex.submit(one, a) for a in uniq]):
            f.result()
    return len(uniq)


def assert_landable(assets, sources_by_sha, toc_proof):
    """Stop before a run is opened. Empty text is a gap, not a unit. TOC child pages must be fetched."""
    if not sources_by_sha:
        raise RuntimeError('no sources to land')
    for sha, srcs in sources_by_sha.items():
        if not srcs:
            raise RuntimeError('object %s has no sources' % sha[:12])
        for s in srcs:
            if s.get('http_status') != 200:
                raise RuntimeError('source http_status must be 200 before landing: %s' % s.get('source_url'))
    for sha, kind, data, _ctype in assets:
        if kind == 'unit_text_derivative':
            text = data.decode('utf-8')
            if not text.strip() or '\x00' in text:
                raise RuntimeError('empty unit text %s; record it as a gap' % sha[:12])
    if not isinstance(toc_proof, dict) or 'unfetched_child_pages' not in toc_proof:
        raise RuntimeError('toc_proof must include unfetched_child_pages')
    pending = toc_proof.get('unfetched_child_pages') or []
    if pending:
        raise RuntimeError('toc_proof lists %d unfetched child pages; do not land' % len(pending))
    pages = toc_proof.get('pages') or []
    if not pages or not str(toc_proof.get('marker') or '').strip():
        raise RuntimeError('toc_proof needs a marker description and one entry per page')
    bad = [p for p in pages if p.get('markers') != p.get('sections')]
    if bad:
        raise RuntimeError('toc marker mismatch on %d pages; first %s' % (len(bad), bad[0].get('url')))


def register_objects(supa, run, journal, sources_by_sha, chunk=1000):
    """sources_by_sha: sha -> list of source dicts (source_url, retrieved_at, http_status, retrieval_method, proxy)."""
    shas = sorted(sources_by_sha)
    new = 0
    for i in range(0, len(shas), chunk):
        objs = []
        for sha in shas[i:i + chunk]:
            rec = journal.done[sha]
            objs.append({'sha256': sha, 'bytes': rec['receipt']['bytes'], 'kind': rec['kind'],
                         'readback': rec['receipt'],
                         'sources': [{'source_url': s['source_url'], 'retrieved_at': s['retrieved_at'],
                                      'http_status': s['http_status'],
                                      'retrieval_method': s['retrieval_method'], 'proxy': s['proxy']}
                                     for s in sources_by_sha[sha]]})
        res = supa.rpc('corpus_publisher_code_register_objects_v2', {'p_run': run, 'p_objects': objs})
        new += res.get('objects_new', 0)
    return new


class UnitText:
    """Builds the unit text derivative and reports code-point spans for pieces appended to it."""

    def __init__(self):
        self.parts = []
        self.n = 0

    def add(self, text, newline=True):
        start = self.n
        self.parts.append(text)
        self.n += len(text)
        end = self.n
        if newline:
            self.parts.append('\n')
            self.n += 1
        return start, end

    def value(self):
        return ''.join(self.parts)


def currency_obj(statement, through_date=None, edition=None, basis='publisher_statement'):
    return {'basis': basis, 'statement': statement, 'through_date': through_date, 'edition': edition}


def provenance_obj(data, src, manifest_sha, parser):
    return {'source_url': src['source_url'], 'source_sha256': src['sha256'], 'retrieved_at': src['retrieved_at'],
            'retrieval_method': src['retrieval_method'], 'proxy': src['proxy'],
            'source_as_of': data['currency']['through_date'], 'record_hash_codec': 'canonical-integer-jsonb/1',
            'record_sha256': record_sha(data), 'parser': parser, 'manifest_sha256': manifest_sha}


def unit_row(st, source_system, manifest_sha, parser, unit_key, unit_kind, heading, src, unit_text, sections_expected,
             currency, publisher_member=None, raw_member_sha256=None):
    tsha = sha256_bytes(unit_text.encode('utf8'))
    data = {'jurisdiction': st, **GATES, 'identity_kind': 'publisher_source_unit', 'unit_key': unit_key,
            'unit_kind': unit_kind, 'heading': heading, 'original_sha256': src['sha256'],
            'publisher_member': publisher_member, 'raw_member_sha256': raw_member_sha256,
            'text_sha256': tsha, 'text_code_points': len(unit_text), 'sections_expected': sections_expected,
            'currency': currency}
    return {'schema_version': 'publisher-code-evidence/2', 'source_system': source_system,
            'entity_type': 'code-source-unit', 'native_id': '%s:unit:%s' % (st, unit_key), 'data': data,
            'provenance': provenance_obj(data, src, manifest_sha, parser)}


def section_row(st, source_system, manifest_sha, parser, citation_path, citation, heading, text, hierarchy, history,
                status_note, unit_key, unit_text, span, src, currency):
    data = {'jurisdiction': st, **GATES, 'identity_kind': 'official_citation_path', 'citation_path': citation_path,
            'citation': citation, 'heading': heading, 'text': text,
            'text_sha256': sha256_bytes(text.encode('utf8')), 'text_code_points': len(text),
            'hierarchy': hierarchy, 'history': history, 'status_note': status_note,
            'unit_id': '%s:unit:%s' % (st, unit_key), 'unit_text_sha256': sha256_bytes(unit_text.encode('utf8')),
            'span': ({'unit': 'unicode_code_points', 'start': span[0], 'end': span[1]} if span else None),
            'currency': currency}
    return {'schema_version': 'publisher-code-evidence/2', 'source_system': source_system,
            'entity_type': 'code-section', 'native_id': '%s:%s' % (st, citation_path), 'data': data,
            'provenance': provenance_obj(data, src, manifest_sha, parser)}


def batches(rows, max_rows=450, max_bytes=5_000_000):
    cur, size = [], 0
    for r in rows:
        n = len(json.dumps(r, ensure_ascii=False).encode('utf8'))
        if cur and (len(cur) >= max_rows or size + n > max_bytes):
            yield cur
            cur, size = [], 0
        cur.append(r)
        size += n
    if cur:
        yield cur


def write_status(path, obj):
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf8')
    os.replace(tmp, p)


def new_run_id():
    return str(uuid.uuid4())
