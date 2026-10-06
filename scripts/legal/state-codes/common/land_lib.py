"""Generic lander for publisher-code-intake/2 (private; no publication, no calculator activation).

Credentials come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY in the
environment and are never logged or written. Every object is uploaded with x-upsert:false and then
verified by an authenticated whole-object GET whose sha256 is recomputed here; the SQL contract only
checks the receipt, so this module is where bytes are actually verified.
"""
import datetime
import hashlib
import json
import os
import re
import time
import uuid

import requests

SCHEMA = 'publisher-code-evidence/2'
BUCKET = 'corpus-originals'
GATES = {'publisher_native_entity': False, 'public_projection_allowed': False,
         'current_law_verified': False, 'calculation_activation_allowed': False}
MAX_BATCH_ROWS = 500
MAX_BATCH_BYTES = 6_000_000


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def _check(item):
    if item is None or isinstance(item, bool):
        return
    if isinstance(item, str):
        if '\x00' in item or any(0xd800 <= ord(c) <= 0xdfff for c in item):
            raise ValueError('Unsupported JSON string')
    elif isinstance(item, int):
        if abs(item) > 9007199254740991:
            raise ValueError('Unsafe JSON integer')
    elif isinstance(item, list):
        for child in item:
            _check(child)
    elif isinstance(item, dict):
        for key, child in item.items():
            if not isinstance(key, str) or any(ord(c) < 32 or ord(c) > 126 for c in key):
                raise ValueError('Non-ASCII field name')
            _check(child)
    else:
        raise ValueError('Unsupported canonical value: %r' % type(item))


def canonical(value):
    """canonical-integer-jsonb/1: sorted keys, compact separators, integers only."""
    _check(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf8')


def canonical_sha(value):
    return sha256_bytes(canonical(value))


def build_manifest(config):
    m = {
        'schema_version': 'publisher-code-manifest/2',
        'jurisdiction': config['jurisdiction'],
        'publisher': config['publisher'],
        'publisher_url': config['publisher_url'],
        'source_system': config['source_system'],
        'code_title': config['code_title'],
        'parser': config['parser'],
        'retrieval': {'methods': config['retrieval']['methods'],
                      'source_url_patterns': config['retrieval']['source_url_patterns'],
                      'terms_gate': False, 'official_source': True,
                      'rate_limit_ms': str(config['retrieval'].get('rate_limit_ms', 1000))},
        'structure': config['structure'],
        'section_id': config['section_id'],
        'currency': config['currency'],
        'review': config['review'],
    }
    return m


class Client:
    def __init__(self):
        self.url = os.environ['EXTERNAL_SUPABASE_URL'].rstrip('/')
        key = os.environ['EXTERNAL_SUPABASE_SERVICE_ROLE_KEY']
        self.headers = {'apikey': key}
        if not key.startswith('sb_'):
            self.headers['Authorization'] = 'Bearer ' + key
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def rpc(self, name, payload, retries=3):
        last = None
        for attempt in range(retries):
            try:
                resp = self.session.post(self.url + '/rest/v1/rpc/' + name, json=payload, timeout=300)
            except requests.RequestException as exc:
                last = 'transport %s' % type(exc).__name__
                time.sleep(2 ** attempt * 2)
                continue
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code >= 500 or resp.status_code == 429:
                last = 'HTTP %d' % resp.status_code
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError('%s -> HTTP %d: %s' % (name, resp.status_code, resp.text[:600]))
        raise RuntimeError('%s failed: %s' % (name, last))

    def object_url(self, key, authenticated=False):
        base = self.url + '/storage/v1/object/'
        return base + ('authenticated/' if authenticated else '') + BUCKET + '/' + key

    def readback(self, key):
        resp = self.session.get(self.object_url(key, True), timeout=600)
        return resp

    def ensure_object(self, sha, path, kind):
        """Upload (never overwrite) then verify with a whole-object GET. Returns the readback receipt."""
        key = 'state-codes/sha256/%s/%s' % (sha[:2], sha)
        size = os.path.getsize(path)
        resp = self.readback(key)
        if resp.status_code != 200:
            if resp.status_code not in (400, 404):
                raise RuntimeError('Unexpected readback status %d for %s' % (resp.status_code, sha[:12]))
            with open(path, 'rb') as handle:
                up = self.session.post(self.object_url(key), data=handle, timeout=1800,
                                       headers={'x-upsert': 'false', 'Content-Type': 'application/octet-stream'})
            if up.status_code not in (200, 201, 409):
                raise RuntimeError('Upload failed HTTP %d for %s: %s' % (up.status_code, sha[:12], up.text[:300]))
            resp = self.readback(key)
        if resp.status_code != 200:
            raise RuntimeError('Readback failed HTTP %d for %s' % (resp.status_code, sha[:12]))
        body = resp.content
        if len(body) != size or sha256_bytes(body) != sha:
            raise RuntimeError('Stored bytes differ from local bytes for %s' % sha[:12])
        receipt = {'bytes': size, 'bucket': BUCKET, 'object_key': key, 'readback_sha256': sha,
                   'readback_bytes': size, 'verification_method': 'authenticated-whole-object-get-sha256',
                   'http_status': 200,
                   'verified_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
        if kind == 'unit_text_derivative':
            text = body.decode('utf-8')
            receipt['readback_text_encoding'] = 'utf-8'
            receipt['readback_text_code_points'] = len(text)
        return receipt


def currency_obj(statement, through_date, edition, basis):
    if basis == 'none':
        statement = ''
        through_date = None
    if through_date is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', through_date):
        through_date = None
    return {'basis': basis, 'statement': statement or '', 'through_date': through_date, 'edition': edition}


def unit_row(jur, source_system, parser, manifest_sha, unit, original, cur):
    data = dict(GATES, jurisdiction=jur, identity_kind='publisher_source_unit', unit_key=unit['unit_key'],
                unit_kind=unit['unit_kind'], heading=unit.get('heading'), original_sha256=original['sha256'],
                publisher_member=unit.get('publisher_member'), raw_member_sha256=unit.get('raw_member_sha256'),
                text_sha256=unit['text_sha256'], text_code_points=unit['text_code_points'],
                sections_expected=unit.get('sections_expected'), currency=cur)
    return envelope('code-source-unit', '%s:unit:%s' % (jur, unit['unit_key']), data, source_system, parser,
                    manifest_sha, original, cur)


def envelope(entity_type, native_id, data, source_system, parser, manifest_sha, source, cur):
    return {'schema_version': SCHEMA, 'source_system': source_system, 'entity_type': entity_type,
            'native_id': native_id, 'data': data,
            'provenance': {'source_url': source['source_url'], 'source_sha256': source['sha256'],
                           'retrieved_at': source['retrieved_at'], 'retrieval_method': source['retrieval_method'],
                           'proxy': source.get('proxy'), 'source_as_of': cur['through_date'],
                           'record_hash_codec': 'canonical-integer-jsonb/1', 'record_sha256': canonical_sha(data),
                           'parser': parser, 'manifest_sha256': manifest_sha}}


def section_row(jur, source_system, parser, manifest_sha, sec, unit, original, cur):
    text = sec['text']
    data = dict(GATES, jurisdiction=jur, identity_kind='official_citation_path',
                citation_path=sec['citation_path'], citation=sec['citation'], heading=sec.get('heading'),
                text=text, text_sha256=sha256_bytes(text.encode('utf8')), text_code_points=len(text),
                hierarchy=sec['hierarchy'], history=sec.get('history'), status_note=sec.get('status_note'),
                unit_id='%s:unit:%s' % (jur, unit['unit_key']), unit_text_sha256=unit['text_sha256'],
                span=sec.get('span'), currency=cur)
    if sec.get('effective'):
        data['effective_wording'] = sec['effective']
    return envelope('code-section', '%s:%s' % (jur, sec['citation_path']), data, source_system, parser,
                    manifest_sha, original, cur)


def batches(rows):
    batch, size = [], 0
    for row in rows:
        n = len(json.dumps(row, ensure_ascii=False))
        if batch and (len(batch) >= MAX_BATCH_ROWS or size + n > MAX_BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += n
    if batch:
        yield batch


def new_run_id(jur, manifest_sha, salt=''):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'legal-source-atlas/publisher-code-intake-2/%s/%s/%s' % (jur, manifest_sha, salt)))
