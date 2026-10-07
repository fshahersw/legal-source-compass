"""Land one state's parsed units and sections through publisher-code-intake/2 (service role only).

Credentials come from the environment at call time (EXTERNAL_SUPABASE_URL,
EXTERNAL_SUPABASE_SERVICE_ROLE_KEY) and are never written to disk, logs or reports.

Call order per state: register manifest, open run, upload originals and text derivatives to the
private corpus-originals bucket with a whole-object readback sha256, register objects, intake
units then sections (<=500 rows per batch), verify every batch, and finish the run in a finally.
"""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import re
import threading
import time
import urllib.parse

import requests

SCHEMA = 'publisher-code-evidence/2'
BUCKET = 'corpus-originals'
PROJECT = 'xosqzzsnhxcyehcnirpa'
STORAGE = 'https://%s.storage.supabase.co/storage/v1' % PROJECT
GATES = {'publisher_native_entity': False, 'public_projection_allowed': False,
         'current_law_verified': False, 'calculation_activation_allowed': False}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha256_text(text):
    return hashlib.sha256(text.encode('utf8')).hexdigest()


def record_sha256(data):
    return sha256_text(canonical(data))


def object_key(sha):
    return 'state-codes/sha256/%s/%s' % (sha[:2], sha)


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class Service:
    def __init__(self):
        self.url = os.environ['EXTERNAL_SUPABASE_URL'].rstrip('/')
        key = os.environ['EXTERNAL_SUPABASE_SERVICE_ROLE_KEY']
        self.headers = {'apikey': key}
        if not key.startswith('sb_'):
            self.headers['Authorization'] = 'Bearer ' + key
        self.local = threading.local()

    def session(self):
        if not hasattr(self.local, 's'):
            self.local.s = requests.Session()
        return self.local.s

    def rpc(self, name, params, timeout=300):
        for attempt in range(4):
            try:
                resp = self.session().post('%s/rest/v1/rpc/%s' % (self.url, name), json=params, timeout=timeout,
                                           headers={**self.headers, 'Content-Type': 'application/json'})
            except requests.RequestException as exc:
                if attempt == 3:
                    raise RuntimeError('rpc %s transport failure: %s' % (name, type(exc).__name__))
                time.sleep(4 * 2 ** attempt)
                continue
            if resp.status_code in (502, 503, 504, 520, 522, 524) and attempt < 3:
                time.sleep(4 * 2 ** attempt)
                continue
            if resp.status_code != 200:
                raise RuntimeError('rpc %s HTTP %d: %s' % (name, resp.status_code, resp.text[:600]))
            return resp.json()

    def readback(self, sha, expect_bytes):
        resp = self.session().get('%s/object/authenticated/%s/%s' % (STORAGE, BUCKET, object_key(sha)),
                                  headers=self.headers, timeout=180)
        if resp.status_code in (400, 404):
            return None
        if resp.status_code != 200 or 'content-range' in resp.headers:
            raise RuntimeError('readback HTTP %d for %s' % (resp.status_code, sha[:12]))
        body = resp.content
        return body

    def ensure_object(self, sha, data, kind):
        """Upload (if missing) and verify by a whole-object authenticated GET; returns the receipt."""
        key = object_key(sha)
        body = self.readback(sha, len(data))
        disposition = 'verified_reuse'
        upload_status = None
        if body is None:
            for attempt in range(3):
                resp = self.session().post('%s/object/%s/%s' % (STORAGE, BUCKET, key), data=data, timeout=300,
                                           headers={**self.headers, 'Content-Type': 'application/octet-stream',
                                                    'x-upsert': 'false'})
                upload_status = resp.status_code
                if upload_status in (200, 201, 400, 409):
                    break
                time.sleep(4 * 2 ** attempt)
            body = self.readback(sha, len(data))
            if body is None:
                raise RuntimeError('object missing after upload %s (upload HTTP %s)' % (sha[:12], upload_status))
            disposition = 'uploaded_verified' if upload_status in (200, 201) else 'upload_outcome_resolved_by_full_readback'
        got = hashlib.sha256(body).hexdigest()
        if got != sha or len(body) != len(data):
            raise RuntimeError('readback hash or length mismatch %s' % sha[:12])
        receipt = {'project_id': PROJECT, 'bucket': BUCKET, 'object_key': key, 'sha256': sha, 'bytes': len(data),
                   'readback_sha256': got, 'readback_bytes': len(body), 'http_status': 200,
                   'verification_method': 'authenticated-whole-object-get-sha256', 'verified_at': utc_now(),
                   'disposition': disposition, 'upload_http_status': upload_status, 'private_only': True}
        if kind == 'unit_text_derivative':
            text = body.decode('utf-8')
            receipt['readback_text_encoding'] = 'utf-8'
            receipt['readback_text_code_points'] = len(text)
        return receipt


def source_ref(receipt):
    """Fetcher receipt -> (retrieval_method, proxy)."""
    method = receipt['retrieval_method']
    if method == 'direct':
        return 'publisher_page', None
    if method.startswith('proxied:'):
        return 'proxied_fetch', method.split(':', 1)[1]
    raise ValueError('unknown retrieval method ' + method)


def currency_block(statement, edition=None, through_date=None, basis='publisher_statement'):
    return {'basis': basis, 'statement': statement, 'through_date': through_date, 'edition': edition}


def unit_row(st, source_system, parser, manifest_sha, unit):
    """unit: dict(key, kind, heading, original{sha,url,retrieved_at,method,proxy}, text, sections_expected, currency)."""
    text = unit['text']
    data = {**GATES, 'jurisdiction': st, 'identity_kind': 'publisher_source_unit', 'unit_key': unit['key'],
            'unit_kind': unit['kind'], 'heading': unit['heading'], 'original_sha256': unit['original']['sha'],
            'publisher_member': None, 'raw_member_sha256': None, 'text_sha256': sha256_text(text),
            'text_code_points': len(text), 'sections_expected': unit['sections_expected'],
            'currency': unit['currency']}
    return envelope(st, source_system, parser, manifest_sha, 'code-source-unit', '%s:unit:%s' % (st, unit['key']),
                    data, unit)


def section_row(st, source_system, parser, manifest_sha, unit, sec):
    text = sec['text']
    data = {**GATES, 'jurisdiction': st, 'code_id': source_system, 'identity_kind': 'official_citation_path',
            'citation_path': sec['citation_path'], 'citation': sec['citation'], 'heading': sec['heading'],
            'text': text, 'text_sha256': sha256_text(text), 'text_code_points': len(text),
            'hierarchy': sec['hierarchy'], 'history': sec['history'], 'status_note': sec['status_note'],
            'unit_id': '%s:unit:%s' % (st, unit['key']), 'unit_text_sha256': sha256_text(unit['text']),
            'span': sec['span'], 'currency': unit['currency']}
    return envelope(st, source_system, parser, manifest_sha, 'code-section', '%s:%s' % (st, sec['citation_path']),
                    data, unit)


def envelope(st, source_system, parser, manifest_sha, entity_type, native_id, data, unit):
    original = unit['original']
    prov = {'source_url': original['url'], 'source_sha256': original['sha'], 'retrieved_at': original['retrieved_at'],
            'retrieval_method': original['method'], 'proxy': original['proxy'],
            'source_as_of': data['currency']['through_date'], 'record_hash_codec': 'canonical-integer-jsonb/1',
            'record_sha256': record_sha256(data), 'parser': parser, 'manifest_sha256': manifest_sha}
    return {'schema_version': SCHEMA, 'source_system': source_system, 'entity_type': entity_type,
            'native_id': native_id, 'data': data, 'provenance': prov}


def batches(rows, max_rows=500, max_bytes=5_500_000):
    batch, size = [], 0
    for row in rows:
        row_size = len(json.dumps(row, ensure_ascii=False).encode('utf8'))
        if batch and (len(batch) >= max_rows or size + row_size > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += row_size
    if batch:
        yield batch


def upload_all(service, objects, workers=4, log=print):
    """objects: {sha: (bytes, kind)} -> {sha: receipt}."""
    receipts = {}
    lock = threading.Lock()

    def work(item):
        sha, (data, kind) = item
        receipt = service.ensure_object(sha, data, kind)
        with lock:
            receipts[sha] = receipt
            if len(receipts) % 25 == 0:
                log('uploaded/verified %d/%d' % (len(receipts), len(objects)))

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        list(pool.map(work, objects.items()))
    return receipts


def register_objects(service, run, objects, receipts, sources, per_call=60):
    """sources: {sha: [source dicts]}"""
    shas = list(objects)
    results = []
    for i in range(0, len(shas), per_call):
        payload = []
        for sha in shas[i:i + per_call]:
            data, kind = objects[sha]
            payload.append({'sha256': sha, 'bytes': len(data), 'kind': kind, 'readback': receipts[sha], 'sources': sources[sha]})
        results.append(service.rpc('corpus_publisher_code_register_objects_v2', {'p_run': run, 'p_objects': payload}))
    return results


def require_toc_proof(st):
    """Refuse to open a run until publisher section markers match and no child page is unfetched."""
    path = pathlib.Path('/tmp/sc') / st / 'toc-proof.json'
    if not path.is_file():
        raise RuntimeError('refusing to land %s: toc-proof.json is required' % st)
    proof = json.loads(path.read_text(encoding='utf-8'))
    if 'unfetched_child_pages' not in proof or proof.get('unfetched_child_pages'):
        raise RuntimeError('refusing to land %s: unfetched child pages remain' % st)
    pages = proof.get('pages') or []
    bad = [p for p in pages if p.get('markers') != p.get('sections')]
    if not pages or not str(proof.get('marker') or '').strip() or bad:
        raise RuntimeError('refusing to land %s: toc marker mismatch' % st)
    return proof


def land(service, manifest, units, run, st, source_system, parser_label, expected, log=print, counts_extra=None, status_hook=None):
    """Full landing. units: list of unit dicts (see unit_row) each with 'sections' and 'original'.
    Returns a result dict; the run is always finished (completed only if everything verified)."""
    require_toc_proof(st)
    result = {'run': run, 'sections_landed': 0, 'units_landed': 0, 'batches': 0, 'verify_failures': 0}
    registered = service.rpc('corpus_publisher_code_register_manifest_v2', {'p_manifest': manifest})
    manifest_sha = registered['manifest_sha256']
    result['manifest_sha256'] = manifest_sha
    log('manifest %s registered=%s' % (manifest_sha[:12], registered.get('registered')))
    service.rpc('corpus_publisher_code_open_run_v2', {'p_run': run, 'p_manifest_sha256': manifest_sha})
    final = 'failed'
    error = None
    try:
        objects, sources = {}, {}
        for unit in units:
            orig = unit['original']
            objects[orig['sha']] = (orig['bytes_obj'], 'publisher_original')
            srcs = sources.setdefault(orig['sha'], [])
            ref = {'source_url': orig['url'], 'retrieved_at': orig['retrieved_at'], 'http_status': 200,
                   'retrieval_method': orig['method'], 'proxy': orig['proxy']}
            if ref not in srcs:
                srcs.append(ref)
            tdata = unit['text'].encode('utf8')
            objects.setdefault(sha_bytes(tdata), (tdata, 'unit_text_derivative'))
            sources.setdefault(sha_bytes(tdata), [ref])
        # derivative objects carry a source reference too (their original's), so they register uniformly
        receipts = upload_all(service, objects, log=log)
        result['objects'] = len(objects)
        result['object_bytes'] = sum(len(v[0]) for v in objects.values())
        reg = register_objects(service, run, objects, receipts, sources)
        result['objects_new'] = sum(r['objects_new'] for r in reg)
        log('objects registered: %d (new %d)' % (len(objects), result['objects_new']))

        def rows():
            for unit in units:
                yield unit_row(st, source_system, parser_label, manifest_sha, unit)
                for sec in unit['sections']:
                    yield section_row(st, source_system, parser_label, manifest_sha, unit, sec)

        n_rows = 0
        for batch in batches(rows()):
            out = service.rpc('corpus_publisher_code_intake_v2', {'p_run': run, 'p_rows': batch})
            check = service.rpc('corpus_publisher_code_verify_batch_v2', {'p_run': run, 'p_rows': batch})
            if check.get('verified') is not True:
                result['verify_failures'] += 1
                raise RuntimeError('batch %s not verified: %s' % (out.get('batch_index'), json.dumps(check)[:400]))
            n_rows += len(batch)
            result['batches'] += 1
            result['units_landed'] += sum(1 for r in batch if r['entity_type'] == 'code-source-unit')
            result['sections_landed'] += sum(1 for r in batch if r['entity_type'] == 'code-section')
            if result['batches'] % 10 == 0:
                log('batches %d rows %d' % (result['batches'], n_rows))
            if status_hook:
                status_hook(result)
        full = (result['units_landed'] == expected['units'] and result['sections_landed'] == expected['sections']
                and result['verify_failures'] == 0)
        final = 'completed' if full else 'partial'
    except Exception as exc:  # recorded, never swallowed: the run must close
        error = '%s: %s' % (type(exc).__name__, str(exc)[:500])
        final = 'partial' if result['sections_landed'] or result['units_landed'] else 'failed'
        result['error'] = error
    finally:
        counts = {'units': result['units_landed'], 'sections': result['sections_landed'], 'batches': result['batches'],
                  'verify_failures': result['verify_failures'], 'error': error}
        counts.update(counts_extra or {})
        try:
            closed = service.rpc('corpus_publisher_code_finish_run_v2', {'p_run': run, 'p_status': final, 'p_counts': counts})
            result['run_status'] = final
            result['finish'] = closed
        except Exception as exc2:
            result['finish_error'] = str(exc2)[:300]
    return result


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()
