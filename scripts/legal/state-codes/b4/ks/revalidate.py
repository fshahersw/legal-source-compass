"""Report-only Kansas release review. Never imports, approves, or mutates a database.

sql emits bounded read-only owner SQL exports. capture-toc retains exact official
index bytes and discovers section URLs only from those indices. audit compares
the entire exported inventory to that TOC; a live sample is a separate check.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import ssl
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler
import uuid

SOURCE = 'ks-statutes'
ROOT = 'https://www.ksrevisor.gov/ksa.html'
HOST = 'www.ksrevisor.gov'
SHA = re.compile(r'^[a-f0-9]{64}$')
CHAPTER = re.compile(r'^/statutes/ksa_ch[0-9A-Za-z]+\.html$')
SECTION = re.compile(r'^/statutes/chapters/[A-Za-z0-9_/-]+\.html$')
CURRENCY = re.compile(r'^/rpts/[0-9]{4}NewAmendsAndRepealsKSAOrder\.pdf$')


def digest(body):
    return hashlib.sha256(body).hexdigest()


def save_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def read_export(path):
    value = json.loads(Path(path).read_text('utf8'))
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    if isinstance(value, dict) and 'packet' in value:
        value = value['packet']
    if not isinstance(value, dict):
        raise ValueError('Expected an owner SQL JSON packet')
    return value


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.hrefs.extend(v for k, v in attrs if k == 'href' and v is not None)


def links(body, page_url, pattern):
    parsed = Links()
    parsed.feed(body.decode('utf8', errors='strict'))
    out = set()
    for href in parsed.hrefs:
        url = urljoin(page_url, href)
        parts = urlsplit(url)
        if (parts.scheme == 'https' and parts.netloc == HOST and not parts.query
                and not parts.fragment and pattern.fullmatch(parts.path)):
            out.add(url)
    return sorted(out)


def capture_toc(destination, max_chapters=200):
    destination = Path(destination)
    if destination.exists():
        raise FileExistsError('Retain prior captures; choose a new destination')
    (destination / 'raw').mkdir(parents=True)
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    # The standard trust store includes the Windows system CAs. Verification and
    # hostname checks remain enabled; never use verify=False for publisher text.
    session = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    receipts = []

    def fetch(url):
        # Redirects require a newly observed allowed URL, not implicit cross-host fetch.
        request = Request(url, headers={'User-Agent':'LegalSourceAtlas-Kansas-review/1 (+https://firastest1.com)'})
        try:
            response = session.open(request, timeout=40)
        except HTTPError as error:
            response = error
        data = bytearray()
        while chunk := response.read(65536):
            data.extend(chunk)
            if len(data) > 5_000_000:
                raise ValueError('Index exceeds the bounded capture size')
        body = bytes(data)
        sha = digest(body)
        (destination / 'raw' / sha).write_bytes(body)
        receipt = dict(source_url=url, final_url=response.url, http_status=response.status,
                       sha256=sha, bytes=len(body), retrieved_at=datetime.now(timezone.utc).isoformat(),
                       headers={k:response.headers[k] for k in ['Content-Type','ETag','Last-Modified'] if k in response.headers},
                       retrieval_method='publisher_page', raw_file='raw/'+sha)
        receipts.append(receipt)
        with (destination / 'receipts.jsonl').open('a', encoding='utf8') as stream:
            stream.write(json.dumps(receipt)+'\n')
        response.close()
        if receipt['http_status'] != 200 or b'<html' not in body.lower():
            raise ValueError('Official index did not return HTTP 200 HTML')
        time.sleep(1)
        return body

    root = fetch(ROOT)
    chapters = links(root, ROOT, CHAPTER)
    if not chapters or len(chapters) > max_chapters:
        raise ValueError('Publisher chapter links missing or exceed the explicit limit')
    pages = []
    for chapter in chapters:
        body = fetch(chapter)
        pages.append(dict(url=chapter, section_urls=links(body, chapter, SECTION)))
    save_new(destination / 'toc.json', dict(schema='ks-toc-review/1', root=ROOT,
        captured_at=datetime.now(timezone.utc).isoformat(), chapters=pages,
        section_urls=sorted({u for p in pages for u in p['section_urls']}),
        root_sha256=digest(root), receipts_sha256=digest((destination/'receipts.jsonl').read_bytes())))
    return dict(chapters=len(chapters), section_urls=len({u for p in pages for u in p['section_urls']}),
                receipts=len(receipts), publication_allowed=False)


def validate_toc(directory):
    directory = Path(directory)
    toc = read_export(directory / 'toc.json')
    ledger = (directory/'receipts.jsonl').read_bytes()
    if digest(ledger) != toc.get('receipts_sha256') or toc.get('root') != ROOT:
        raise ValueError('TOC receipt identity differs')
    receipts = [json.loads(x) for x in ledger.decode('utf8').splitlines()]
    by_url = {}
    for receipt in receipts:
        sha = receipt.get('sha256','')
        if not SHA.fullmatch(sha) or receipt.get('raw_file') != 'raw/'+sha:
            raise ValueError('Unsafe or incorrect retained path')
        body = (directory/'raw'/sha).read_bytes()
        if (digest(body) != sha or len(body) != receipt.get('bytes') or receipt.get('http_status') != 200
                or receipt.get('final_url') != receipt.get('source_url')):
            raise ValueError('Retained source hash/status/URL mismatch')
        url = receipt['source_url']
        if url in by_url:
            raise ValueError('Ambiguous TOC receipt')
        by_url[url] = body
    root = by_url[ROOT]
    chapter_urls = links(root, ROOT, CHAPTER)
    if not chapter_urls or set(by_url) != {ROOT, *chapter_urls}:
        raise ValueError('Not every exact publisher chapter was captured')
    expected = [dict(url=u,section_urls=links(by_url[u],u,SECTION)) for u in chapter_urls]
    if toc.get('chapters') != expected or toc.get('root_sha256') != digest(root):
        raise ValueError('TOC does not match retained anchor evidence')
    urls = sorted({u for page in expected for u in page['section_urls']})
    if not urls or toc.get('section_urls') != urls:
        raise ValueError('TOC section inventory differs')
    return toc


def capture_currency(toc_directory, destination):
    """Retain only amendment PDFs actually linked by the verified publisher root."""
    toc=validate_toc(toc_directory)
    body=(Path(toc_directory)/'raw'/toc['root_sha256']).read_bytes()
    urls=links(body,ROOT,CURRENCY)
    if not urls or len(urls)>10:raise ValueError('Expected one to ten exact amendment-list links')
    destination=Path(destination)
    if destination.exists():raise FileExistsError('Retain prior captures; choose a new destination')
    (destination/'raw').mkdir(parents=True)
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):return None
    session=build_opener(NoRedirect(),HTTPSHandler(context=ssl.create_default_context()))
    receipts=[]
    for url in urls:
        request=Request(url,headers={'User-Agent':'LegalSourceAtlas-Kansas-review/1 (+https://firastest1.com)'})
        try:response=session.open(request,timeout=40)
        except HTTPError as error:response=error
        body=response.read(10_000_001)
        if len(body)>10_000_000:raise ValueError('Amendment PDF exceeds bounded capture size')
        sha=digest(body);(destination/'raw'/sha).write_bytes(body)
        receipt=dict(source_url=url,final_url=response.url,http_status=response.status,sha256=sha,bytes=len(body),
            retrieved_at=datetime.now(timezone.utc).isoformat(),raw_file='raw/'+sha,retrieval_method='publisher_page',
            anchor_source_url=ROOT,anchor_source_sha256=toc['root_sha256'],
            headers={k:response.headers[k]for k in ['Content-Type','ETag','Last-Modified']if k in response.headers})
        receipts.append(receipt)
        with (destination/'receipts.jsonl').open('a',encoding='utf8',newline='\n')as stream:stream.write(json.dumps(receipt)+'\n')
        response.close()
        if receipt['http_status']!=200 or receipt['final_url']!=url or not body.startswith(b'%PDF-'):
            raise ValueError('Official amendment list did not return HTTP 200 PDF at exact URL')
        time.sleep(1)
    return dict(pdfs=len(receipts),publication_allowed=False,calculation_activation_allowed=False)


def sql(kind, run_id, manifest_sha, after='', limit=500, chapter=''):
    run_id = str(uuid.UUID(run_id))
    if not SHA.fullmatch(manifest_sha):
        raise ValueError('Exact manifest SHA-256 required')
    if not 1 <= limit <= 1000 or not re.fullmatch(r'[A-Za-z0-9_:.-]*', after):
        raise ValueError('Bounded safe cursor required')
    if chapter and not re.fullmatch(r'ch[0-9A-Za-z]+', chapter):
        raise ValueError('Exact publisher chapter directory required')
    if kind=='page' and (not chapter or limit>100):
        raise ValueError('Diagnostic pages require a chapter and at most 100 rows')
    scope = f"""expected as (select '{run_id}'::uuid run_id, '{manifest_sha}'::text manifest_sha256),
st as (select * from corpus_ingest.publisher_code_states_v2 where jurisdiction='KS'),
mf as (select m.* from corpus_ingest.publisher_code_manifests_v2 m,expected x where m.manifest_sha256=x.manifest_sha256),
rr as (select r.* from corpus_ingest.runs r,expected x where r.id=x.run_id)"""
    if kind == 'preflight':
        body = f"""with {scope},
counts as (select entity_type,review_status,last_run,count(*) rows
 from corpus_ingest.entities where source_system='ks-statutes' group by entity_type,review_status,last_run),
objects as (select o.kind,count(distinct o.sha256) objects,sum(o.bytes) bytes,
 count(*) filter(where b.public or so.id is null) missing_or_public_storage
 from corpus_ingest.publisher_code_objects_v2 o
 join (select distinct sha256 from corpus_ingest.publisher_code_object_sources_v2 where jurisdiction='KS') s using(sha256)
 left join storage.objects so on so.bucket_id=o.bucket and so.name=o.object_key
 left join storage.buckets b on b.id=o.bucket group by o.kind)
select jsonb_build_object('schema','ks-preflight/1','checked_at',now(),'read_only',current_setting('transaction_read_only'),
 'state',(select to_jsonb(st) from st),'run',(select to_jsonb(rr) from rr),
 'manifest',(select to_jsonb(mf) from mf),'counts',(select jsonb_agg(to_jsonb(c)) from counts c),
 'objects',(select jsonb_agg(to_jsonb(o)) from objects o),
 'open_runs',(select count(*) from corpus_ingest.runs where scope->>'source_system'='ks-statutes' and status in ('running','partial')),
 'rpc_controls',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
 'definer',p.prosecdef,'settings',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'corpus_publisher_code_%')
) packet;"""
    elif kind in ('inventory','summary','page'):
        body = f"""with {scope},
sections as (select e.native_id,e.review_status,e.last_run,e.payload_sha256,
 e.data->>'citation_path' citation_path,e.data->>'citation' citation,e.data->>'unit_id' unit_id,
 e.data->>'text_sha256' text_sha256,e.data->'currency' currency,e.data->'hierarchy' hierarchy,
 e.provenance->>'source_url' source_url,e.provenance->>'source_sha256' source_sha256,
 e.provenance->>'retrieved_at' retrieved_at,e.provenance->>'manifest_sha256' manifest_sha256,
 length(e.data->>'text') text_code_points,
 (e.data->>'text_sha256'=encode(sha256(convert_to(e.data->>'text','UTF8')),'hex')) text_hash_valid,
 exists(select 1 from corpus_ingest.entity_versions v where v.source_system=e.source_system
  and v.entity_type=e.entity_type and v.native_id=e.native_id and v.payload_sha256=e.payload_sha256 and v.data=e.data) retained_version_matches,
 exists(select 1 from corpus_ingest.entities u where u.source_system=e.source_system and u.entity_type='code-source-unit'
  and u.native_id=e.data->>'unit_id' and u.review_status<>'quarantined' and u.data->>'text_sha256'=e.data->>'unit_text_sha256') unit_matches,
 exists(select 1 from corpus_ingest.publisher_code_object_sources_v2 os
  join corpus_ingest.publisher_code_objects_v2 ob using(sha256)
  where os.jurisdiction='KS' and os.sha256=e.provenance->>'source_sha256'
   and os.source_url=e.provenance->>'source_url' and os.http_status=200 and ob.kind='publisher_original') original_registered
 from corpus_ingest.entities e where e.source_system='ks-statutes' and e.entity_type='code-section'
  and e.review_status<>'quarantined')"""
        if kind=='summary':
            body += f""", checked as (select s.*,
 (s.native_id='KS:'||s.citation_path and s.citation_path ~ (select manifest->'section_id'->>'regex' from mf)) native_identity_valid,
 (s.citation_path=regexp_replace(s.source_url,'^.*/([^/]+)\\.html$','\\1')
  or s.citation_path ~ ('^'||regexp_replace(s.source_url,'^.*/([^/]+)\\.html$','\\1')||':([2-9]|[1-9][0-9]+)$')) page_identity_valid,
 (s.last_run='{run_id}'::uuid and s.manifest_sha256='{manifest_sha}') current_scope_valid
 from sections s),
 pages as (select source_url,split_part(citation_path,':',1) base_id,count(*) occurrences
 from checked group by source_url,split_part(citation_path,':',1)),
 chapters as (select substring(source_url from '/chapters/([^/]+)/') chapter,count(*) pages,sum(occurrences) sections,
 encode(sha256(convert_to(string_agg(length(source_url)::text||':'||source_url,'' order by source_url),'UTF8')),'hex') urls_sha256,
 encode(sha256(convert_to(string_agg(length(base_id)::text||':'||base_id,'' order by base_id),'UTF8')),'hex') base_ids_sha256,
 min(source_url) first_url,max(source_url) last_url from pages group by 1),
 failures as (select * from checked where text_hash_valid is not true or retained_version_matches is not true
 or unit_matches is not true or original_registered is not true or native_identity_valid is not true
 or page_identity_valid is not true or current_scope_valid is not true or coalesce(text_code_points,0)<=0),
 totals as (select count(*) sections,count(distinct native_id) unique_native_ids,count(distinct source_url) unique_source_pages,
 count(*) filter(where text_hash_valid is not true) bad_text_hash,
 count(*) filter(where retained_version_matches is not true) bad_retained_version,
 count(*) filter(where unit_matches is not true) bad_unit,
 count(*) filter(where original_registered is not true) bad_original,
 count(*) filter(where native_identity_valid is not true) bad_native_identity,
 count(*) filter(where page_identity_valid is not true) bad_page_identity,
 count(*) filter(where current_scope_valid is not true) bad_scope,
 count(*) filter(where coalesce(text_code_points,0)<=0) empty_text from checked),
 currencies as (select currency,count(*) sections from checked group by currency)
 select jsonb_build_object('schema','ks-inventory-summary/1','checked_at',now(),
 'read_only',current_setting('transaction_read_only'),'run_id','{run_id}','manifest_sha256','{manifest_sha}',
 'state',(select to_jsonb(st) from st),'totals',(select to_jsonb(t) from totals t),
 'chapters',(select jsonb_agg(to_jsonb(c) order by chapter) from chapters c),
 'currencies',(select jsonb_agg(to_jsonb(c)) from currencies c),
 'failure_count',(select count(*) from failures),
 'failure_examples',(select coalesce(jsonb_agg(to_jsonb(f)),'[]') from(select * from failures order by native_id limit 50)f)) packet;"""
        elif kind=='page':
            body += f""" select jsonb_build_object('schema','ks-inventory-page/1','checked_at',now(),
 'read_only',current_setting('transaction_read_only'),'run_id','{run_id}','manifest_sha256','{manifest_sha}',
 'chapter','{chapter}','after','{after}','limit',{limit},
 'sections',(select coalesce(jsonb_agg(to_jsonb(p) order by native_id),'[]') from(
 select * from sections where substring(source_url from '/chapters/([^/]+)/')='{chapter}'
 and native_id>'{after}' order by native_id limit {limit})p)) packet;"""
        else:
            body += f""" select jsonb_build_object('schema','ks-inventory/1','checked_at',now(),'read_only',current_setting('transaction_read_only'),
 'run_id','{run_id}','manifest_sha256','{manifest_sha}',
 'state',(select to_jsonb(st) from st),'sections',coalesce((select jsonb_agg(to_jsonb(s) order by native_id) from sections s),'[]')) packet;"""
    elif kind == 'unit-proof':
        body = """with sections as (select s.native_id,s.data,s.provenance,u.native_id unit_id,u.data unit_data,u.provenance unit_provenance
 from corpus_ingest.entities s left join corpus_ingest.entities u on u.source_system=s.source_system
 and u.entity_type='code-source-unit' and u.native_id=s.data->>'unit_id' and u.review_status<>'quarantined'
 where s.source_system='ks-statutes' and s.entity_type='code-section' and s.review_status<>'quarantined'),
 checked as (select *,
 (unit_id is not null and data->>'unit_text_sha256'=unit_data->>'text_sha256') unit_valid,
 (provenance->>'source_sha256'=unit_provenance->>'source_sha256'
  and provenance->>'source_url'=unit_provenance->>'source_url') source_identity_valid,
 (data->'span'->>'unit'='unicode_code_points' and
 case when data->'span'->>'start' ~ '^[0-9]+$' and data->'span'->>'end' ~ '^[0-9]+$'
 and unit_data->>'text_code_points' ~ '^[0-9]+$' then
 (data->'span'->>'end')::bigint-(data->'span'->>'start')::bigint=length(data->>'text')
 and (data->'span'->>'end')::bigint<=(unit_data->>'text_code_points')::bigint else false end) span_valid,
 (case when data->'span'->>'start'='0' and data->'span'->>'end'=unit_data->>'text_code_points'
 then data->>'text_sha256'=unit_data->>'text_sha256' else true end) full_span_hash_valid,
 exists(select 1 from corpus_ingest.publisher_code_objects_v2 o where o.sha256=unit_data->>'text_sha256'
  and o.kind='unit_text_derivative' and o.bytes>0 and o.verified_at is not null) derivative_registered
 from sections),
 unit_groups as (select unit_id,count(*) sections,max(unit_data->>'sections_expected') expected,
 min(data->'span'->>'start') first_span from checked group by unit_id),
 bad as (select native_id,unit_id,unit_valid,source_identity_valid,span_valid,full_span_hash_valid,derivative_registered
 from checked where unit_valid is not true or source_identity_valid is not true or span_valid is not true
 or full_span_hash_valid is not true or derivative_registered is not true)
 select jsonb_build_object('schema','ks-unit-proof/1','read_only',current_setting('transaction_read_only'),
 'checked_at',now(),'sections',(select count(*) from checked),'referenced_units',(select count(*) from unit_groups),
 'bad_sections',(select count(*) from bad),
 'unit_marker_mismatches',(select count(*) from unit_groups where expected is null or expected<>sections::text),
 'bad_examples',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from(select * from bad order by native_id limit 30)b),
 'cohorts',(select jsonb_agg(to_jsonb(c)) from(select provenance->>'parser' parser,provenance->>'manifest_sha256' manifest_sha256,
 count(*) sections from checked group by 1,2)c)) packet;"""
    elif kind == 'sample':
        template = (Path(__file__).parents[2]/'common/review_sample_export.sql').read_text('utf8')
        body = template.replace('__SYSTEMS__', "('ks-statutes')")+';'
    elif kind == 'originals':
        body = f"""with hashes as (select distinct s.sha256
 from corpus_ingest.publisher_code_object_sources_v2 s join corpus_ingest.publisher_code_objects_v2 o using(sha256)
 where s.jurisdiction='KS' and o.kind='publisher_original' and s.sha256>'{after}' order by s.sha256 limit {limit}),
 page as (select s.sha256,s.source_url,s.retrieved_at,s.http_status,s.retrieval_method,s.proxy,s.run_id,
 o.kind,o.bytes,o.object_key,o.verified_at,o.readback_receipt
 from corpus_ingest.publisher_code_object_sources_v2 s join corpus_ingest.publisher_code_objects_v2 o using(sha256)
 join hashes h using(sha256) where s.jurisdiction='KS'
 order by s.sha256,s.source_url,s.retrieved_at)
 select jsonb_build_object('schema','ks-originals/1','read_only',current_setting('transaction_read_only'),
 'objects',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]')) packet;"""
    else:
        raise ValueError('Unknown export')
    return "-- Kansas evidence only: no intake, review, or projection changes.\nbegin transaction isolation level repeatable read read only;\nset local statement_timeout='60s';\nset local lock_timeout='3s';\n"+body+'\ncommit;\n'


def scope_issues(preflight, inventory, schema):
    issues = []
    if preflight.get('schema')!='ks-preflight/1' or inventory.get('schema')!=schema:
        issues.append('unexpected_export_schema')
    state = preflight.get('state') or {}
    run = preflight.get('run') or {}
    manifest_row = preflight.get('manifest') or {}
    manifest = manifest_row.get('manifest') or {}
    if any(p.get('read_only') != 'on' for p in [preflight,inventory]):
        issues.append('owner_export_not_read_only')
    if (state.get('jurisdiction')!='KS' or state.get('source_system')!=SOURCE
            or state.get('review_status')!='landed' or state.get('public_projection_allowed') is not False
            or preflight.get('open_runs')!=0 or run.get('status')!='completed'):
        issues.append('private_completed_scope_not_confirmed')
    if (inventory.get('run_id')!=run.get('id') or state.get('last_run')!=run.get('id')
            or inventory.get('manifest_sha256')!=state.get('current_manifest_sha256')
            or manifest_row.get('manifest_sha256')!=state.get('current_manifest_sha256')
            or inventory.get('state')!=state or manifest.get('jurisdiction')!='KS' or manifest.get('source_system')!=SOURCE):
        issues.append('scope_or_snapshot_changed')
    objects=preflight.get('objects') or []
    if not objects or any(x.get('missing_or_public_storage')!=0 for x in objects):
        issues.append('object_catalog_missing_or_public')
    controls=preflight.get('rpc_controls') or []
    if not controls or any(x.get('anon') is not False or x.get('authenticated') is not False
            or x.get('definer') is not True or x.get('service_role') is not True
            or [s for s in (x.get('settings')or[])if s.startswith('search_path=')]!=['search_path=""'] for x in controls):
        issues.append('rpc_boundary_not_confirmed')
    return issues


def audit(preflight, inventory, toc):
    issues=scope_issues(preflight,inventory,'ks-inventory/1')
    state=preflight.get('state') or {};run=preflight.get('run') or {}
    manifest_row=preflight.get('manifest') or {};manifest=manifest_row.get('manifest') or {}
    sections=inventory.get('sections') or []
    if not sections or len(sections)!=state.get('sections'):
        issues.append('section_count_differs')
    ids=[s.get('native_id')for s in sections]
    if len(ids)!=len(set(ids)):
        issues.append('duplicate_native_ids')
    expected=set(toc['section_urls']); actual={s.get('source_url')for s in sections}
    missing=sorted(expected-actual); extra=sorted(actual-expected,key=str)
    if missing:issues.append('publisher_pages_without_sections')
    if extra:issues.append('stored_pages_absent_from_current_toc')
    bad=[]; multi=Counter(); currencies=Counter()
    try: identity=re.compile(manifest['section_id']['regex'])
    except (KeyError,re.error):identity=None;issues.append('missing_identity_contract')
    for row in sections:
        errors=[]; path=row.get('citation_path','');url=row.get('source_url','')
        stem=urlsplit(url).path.rsplit('/',1)[-1].removesuffix('.html')
        if not identity or not identity.fullmatch(path) or row.get('native_id')!='KS:'+path:
            errors.append('native_id')
        if path!=stem and not re.fullmatch(re.escape(stem)+r':(?:[2-9]|[1-9][0-9]+)',path):
            errors.append('publisher_page_identity')
        if row.get('last_run')!=run.get('id') or row.get('manifest_sha256')!=manifest_row.get('manifest_sha256'):
            errors.append('legacy_or_different_run')
        for key in ['text_hash_valid','retained_version_matches','unit_matches','original_registered']:
            if row.get(key) is not True:errors.append(key)
        if not row.get('text_code_points'):errors.append('empty_text')
        if errors:bad.append(dict(native_id=row.get('native_id'),errors=errors))
        multi[url]+=1
        currencies[json.dumps(row.get('currency'),sort_keys=True,ensure_ascii=False)]+=1
    if bad:issues.append('record_integrity_or_provenance_failures')
    return dict(schema='ks-review-report/1',passed_inventory_checks=not issues,issues=issues,
        stored_sections=len(sections),publisher_pages=len(expected),stored_pages=len(actual),
        missing_pages=missing,extra_pages=extra,record_failures=bad,
        multiple_occurrence_pages=[dict(url=u,occurrences=n)for u,n in sorted(multi.items())if n>1],
        currency_statements=[dict(currency=json.loads(k),sections=n)for k,n in currencies.items()],
        publication_allowed=False,calculation_activation_allowed=False,
        remaining_requirements=['Retained original-byte parser/marker/span reconciliation for every publisher page',
          'Fresh two-way source review of at least 20 deterministic sections and known edge cases',
          'Verify publisher edition and later-session amendment qualifications',
          'Explicit source-backed publication review; this report never changes review flags'])


def framed_hash(values):
    return digest(''.join(str(len(v))+':'+v for v in sorted(values)).encode('utf8'))


def toc_groups(toc):
    grouped=defaultdict(list)
    for url in toc['section_urls']:
        match=re.fullmatch(r'/statutes/chapters/(ch[0-9A-Za-z]+)/([A-Za-z0-9_-]+)\.html',urlsplit(url).path)
        if not match:raise ValueError('Unexpected official section path shape')
        grouped[match[1]].append((url,match[2]))
    return {chapter:dict(chapter=chapter,pages=len(rows),urls_sha256=framed_hash([u for u,_ in rows]),
             base_ids_sha256=framed_hash([i for _,i in rows]))for chapter,rows in sorted(grouped.items())}


def audit_summary(preflight, summary, toc):
    issues=scope_issues(preflight,summary,'ks-inventory-summary/1')
    totals=summary.get('totals') or {};state=preflight.get('state')or{}
    if totals.get('sections')!=state.get('sections') or totals.get('unique_native_ids')!=totals.get('sections'):
        issues.append('section_count_or_native_uniqueness_differs')
    checks=['bad_text_hash','bad_retained_version','bad_unit','bad_original','bad_native_identity',
            'bad_page_identity','bad_scope','empty_text']
    if summary.get('failure_count')!=0 or any(totals.get(k)!=0 for k in checks):
        issues.append('record_integrity_or_provenance_failures')
    expected=toc_groups(toc);rows=summary.get('chapters')or[]
    actual={r.get('chapter'):r for r in rows}
    if len(actual)!=len(rows):issues.append('duplicate_chapter_summary')
    mismatches=[]
    for chapter in sorted(set(expected)|set(actual),key=str):
        exp=expected.get(chapter);got=actual.get(chapter)
        if exp is None or got is None or any(exp[k]!=got.get(k)for k in ['pages','urls_sha256','base_ids_sha256']):
            mismatches.append(dict(chapter=chapter,expected=exp,stored=got))
    if mismatches or totals.get('unique_source_pages')!=len(toc['section_urls']):
        issues.append('publisher_chapter_inventory_differs')
    return dict(schema='ks-review-summary-report/1',passed_inventory_checks=not issues,issues=issues,
        stored_sections=totals.get('sections'),publisher_pages=len(toc['section_urls']),
        stored_pages=totals.get('unique_source_pages'),totals=totals,chapter_mismatches=mismatches,
        failure_examples=summary.get('failure_examples',[]),currency_statements=summary.get('currencies',[]),
        publication_allowed=False,calculation_activation_allowed=False,
        remaining_requirements=['Retained original-byte parser/marker/span reconciliation for every publisher page',
          'Fresh two-way source review of at least 20 deterministic sections and known edge cases',
          'Verify publisher edition and later-session amendment qualifications',
          'Explicit source-backed publication review; this report never changes review flags'])


def main():
    cli=argparse.ArgumentParser(description=__doc__); sub=cli.add_subparsers(dest='command',required=True)
    p=sub.add_parser('sql');p.add_argument('kind',choices=['preflight','inventory','summary','page','unit-proof','sample','originals']);p.add_argument('--run-id',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--after',default='');p.add_argument('--limit',type=int,default=500);p.add_argument('--chapter',default='');p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('capture-toc');p.add_argument('--out',type=Path,required=True);p.add_argument('--max-chapters',type=int,default=200)
    p=sub.add_parser('capture-currency');p.add_argument('--toc',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('audit');p.add_argument('--preflight',type=Path,required=True);p.add_argument('--inventory',type=Path,required=True);p.add_argument('--toc',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=cli.parse_args()
    if a.command=='sql':
        result=sql(a.kind,a.run_id,a.manifest_sha256,a.after,a.limit,a.chapter);a.out.parent.mkdir(parents=True,exist_ok=True)
        with a.out.open('x',encoding='utf8',newline='\n')as stream:stream.write(result)
        print(json.dumps({'path':str(a.out),'sha256':digest(result.encode()),'read_only':True}))
    elif a.command=='capture-toc':print(json.dumps(capture_toc(a.out,a.max_chapters)))
    elif a.command=='capture-currency':print(json.dumps(capture_currency(a.toc,a.out)))
    else:
        inventory=read_export(a.inventory)
        checker=audit_summary if inventory.get('schema')=='ks-inventory-summary/1' else audit
        result=checker(read_export(a.preflight),inventory,validate_toc(a.toc));save_new(a.out,result)
        print(json.dumps({k:v for k,v in result.items()if not isinstance(v,list)}))
        return 0 if result['passed_inventory_checks']else 1
    return 0


if __name__=='__main__':
    raise SystemExit(main())
