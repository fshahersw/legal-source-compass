"""Build compact, read-only post-intake SQL and expected whole-packet digests.

No credentials or database access. The owner executes the SQL; check compares
its saved output against the private candidate and retained baseline evidence.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

from stage_hrs import digest,json_file


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def framed(values):return ''.join(str(len(value))+':'+value for value in values)
def read_json(path):
    value=json.loads(Path(path).read_text('utf8'))
    if isinstance(value,list)and len(value)==1:value=value[0]
    return value.get('packet',value)


def expected_groups(rows):
    groups=defaultdict(list)
    for row in rows:
        chapter=row['provenance']['source_url'].rsplit('/',2)[-2]
        key=row['entity_type']+'|'+chapter
        groups[key].append((row['native_id'],row['provenance']['record_sha256'],digest(canonical(row['provenance']).encode())))
    return [dict(group_key=key,records=len(values),sha256=digest(''.join(framed(row)for row in sorted(values)).encode()))
            for key,values in sorted(groups.items())]


def generate(packet,baseline,output,run_id=None):
    packet=Path(packet);output=Path(output)
    if output.exists():raise FileExistsError('Fresh review output required')
    output.mkdir(parents=True)
    path=Path(__file__).resolve().parents[1]/'common/land_publisher_code_v2.py'
    spec=importlib.util.spec_from_file_location('hrs_readonly_lander_codec',path)
    codec=importlib.util.module_from_spec(spec);spec.loader.exec_module(codec)
    codec.preflight_packet(str(packet));manifest=json.loads((packet/'manifest.json').read_text('utf8'))
    if manifest['jurisdiction']!='HI'or manifest['source_system']!='hi-hrs':raise ValueError('HRS packet required')
    manifest_sha=codec.sha(manifest);run=str(uuid.UUID(run_id))if run_id else str(uuid.uuid5(codec.NS,'HI:'+manifest_sha))
    units,sections=codec.build_rows(str(packet),manifest_sha,manifest)
    old=read_json(baseline)
    if any(row['entity_type']!='code-source-unit'for row in old['current_groups']):raise ValueError('Unexpected baseline section records require explicit review')
    expected=dict(schema='hi-post-intake-expected/1',manifest_sha256=manifest_sha,run_id=run,sections=len(sections),units=len(units),
        groups=expected_groups(units+sections),baseline_current_groups=old['current_groups'],baseline_version_groups=old['version_groups'])
    json_file(output/'expected.json',expected)
    sql=SQL.replace('__MANIFEST__',manifest_sha).replace('__RUN__',run)
    (output/'readback.sql').write_text(sql,encoding='utf8',newline='\n')
    return expected


def check(expected_path,readback_path):
    expected=read_json(expected_path);actual=read_json(readback_path);issues=[]
    if actual.get('schema')!='hi-post-intake-readback/1':issues.append('Readback schema differs')
    if actual.get('read_only')!='on':issues.append('Readback was not explicitly read-only')
    if sorted(actual.get('groups')or[],key=lambda r:r['group_key'])!=expected['groups']:issues.append('Whole candidate data/provenance digests differ')
    totals=actual.get('totals')or{}
    if totals.get('sections')!=expected['sections']or totals.get('units')!=expected['units']:issues.append('Candidate row counts differ')
    if any(totals.get(key)!=0 for key in ['bad_payload','bad_scope','bad_gates','bad_version','bad_original','bad_unit_or_derivative','bad_native']):issues.append('Source/schema/storage proof failed')
    state=actual.get('state')or{};run=actual.get('run')or{}
    baseline_units=sum(row['records']for row in expected['baseline_current_groups'])
    if state.get('sections')!=expected['sections']or state.get('units')!=expected['units']+baseline_units:
        issues.append('State summary does not match candidate plus retained legacy units')
    if (state.get('last_run')!=expected['run_id']or state.get('current_manifest_sha256')!=expected['manifest_sha256']
            or state.get('review_status')!='landed'or state.get('public_projection_allowed')is not False
            or run.get('id')!=expected['run_id']or run.get('status')!='completed'or actual.get('open_runs')!=0):issues.append('Expected completed private candidate/run scope differs')
    for key in ['current_groups','version_groups']:
        before=expected['baseline_'+key];after=actual.get('baseline_'+key)or[]
        if sorted(before,key=canonical)!=sorted(after,key=canonical):issues.append('Retained baseline '+key+' changed')
    return dict(schema='hi-post-intake-review/1',passed=not issues,issues=issues,sections=expected['sections'],units=expected['units'],
        expected_file_sha256=digest(Path(expected_path).read_bytes()),readback_file_sha256=digest(Path(readback_path).read_bytes()),
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)


SQL=r'''-- HRS report-only post-intake evidence. No approval or publication mutation.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';
set local lock_timeout = '3s';
with expected as(select '__MANIFEST__'::text manifest_sha256,'__RUN__'::uuid run_id),
candidate as(select e.*,e.entity_type||'|'||substring(e.provenance->>'source_url' from '/(HRS[0-9A-Z]+)/[^/]+$') group_key,
 corpus_ingest.canonical_integer_jsonb_sha256_v1(e.data) actual_payload,
 corpus_ingest.canonical_integer_jsonb_sha256_v1(e.provenance) provenance_sha256
 from corpus_ingest.entities e,expected x where e.source_system='hi-hrs' and e.review_status<>'quarantined'
 and (e.entity_type='code-section' or(e.entity_type='code-source-unit' and e.provenance->>'manifest_sha256'=x.manifest_sha256))),
checked as(select e.*,
 (e.payload_sha256=e.actual_payload and e.payload_sha256=e.provenance->>'record_sha256') payload_ok,
 (e.schema_version='publisher-code-evidence/2' and e.last_run=x.run_id and e.provenance->>'manifest_sha256'=x.manifest_sha256
  and e.provenance->>'parser'='hi-hrs-html/3') scope_ok,
 (e.data->'public_projection_allowed'='false'::jsonb and e.data->'current_law_verified'='false'::jsonb
  and e.data->'calculation_activation_allowed'='false'::jsonb and e.data->'publisher_native_entity'='false'::jsonb) gates_ok,
 exists(select 1 from corpus_ingest.entity_versions v where v.source_system=e.source_system and v.entity_type=e.entity_type
  and v.native_id=e.native_id and v.payload_sha256=e.payload_sha256 and v.data=e.data) version_ok,
 exists(select 1 from corpus_ingest.publisher_code_object_sources_v2 os join corpus_ingest.publisher_code_objects_v2 ob using(sha256)
  join storage.objects so on so.bucket_id=ob.bucket and so.name=ob.object_key join storage.buckets b on b.id=ob.bucket
  where os.jurisdiction='HI' and os.sha256=e.provenance->>'source_sha256' and os.source_url=e.provenance->>'source_url'
  and os.retrieved_at=(e.provenance->>'retrieved_at')::timestamptz and os.retrieval_method='publisher_page' and os.proxy is null
  and os.http_status=200 and ob.kind='publisher_original' and b.public is false) original_ok,
 case when e.entity_type='code-source-unit' then exists(select 1 from corpus_ingest.publisher_code_objects_v2 ob
  join storage.objects so on so.bucket_id=ob.bucket and so.name=ob.object_key join storage.buckets b on b.id=ob.bucket
  where ob.sha256=e.data->>'text_sha256' and ob.kind='unit_text_derivative' and ob.code_points=(e.data->>'text_code_points')::bigint
  and b.public is false and e.data->>'original_sha256'=e.provenance->>'source_sha256')
 else coalesce(u.native_id is not null
  and u.data->>'text_sha256'=e.data->>'unit_text_sha256' and u.provenance->>'source_sha256'=e.provenance->>'source_sha256'
  and e.data->>'text_sha256'=encode(sha256(convert_to(e.data->>'text','UTF8')),'hex')
  and (e.data->>'text_code_points')::bigint=length(e.data->>'text')
  and e.data->'span'->>'unit'='unicode_code_points' and (e.data->'span'->>'start')::bigint>=0
  and (e.data->'span'->>'end')::bigint<=(u.data->>'text_code_points')::bigint
  and (e.data->'span'->>'end')::bigint-(e.data->'span'->>'start')::bigint=length(e.data->>'text'),false)end unit_ok,
 (e.native_id=(case when e.entity_type='code-source-unit' then 'HI:unit:'else 'HI:'end)||
  regexp_replace(e.provenance->>'source_url','^.*/([^/]+)\.htm$','\1')
  and e.provenance->>'source_url' ~ '^https://data\.capitol\.hawaii\.gov/hrscurrent/Vol[0-9]+_[^/]+/HRS[0-9A-Z]+/HRS_[0-9A-Za-z_%\-]+(_\[OLD\])?(\.docx)?\.htm$') native_ok
 -- The source/type/native primary key permits only one matching HI unit.
 -- Join once: a correlated scan of this materialized CTE is quadratic in HRS pages.
 from candidate e cross join expected x
 left join candidate u on u.entity_type='code-source-unit' and u.native_id=e.data->>'unit_id'),
groups as(select group_key,count(*) records,encode(sha256(convert_to(string_agg(
 length(native_id)::text||':'||native_id||'64:'||payload_sha256||'64:'||provenance_sha256,'' order by native_id collate "C"),'UTF8')),'hex') sha256
 from checked group by group_key),
totals as(select count(*) filter(where entity_type='code-section') sections,count(*) filter(where entity_type='code-source-unit') units,
 count(*) filter(where payload_ok is not true) bad_payload,count(*) filter(where scope_ok is not true) bad_scope,
 count(*) filter(where gates_ok is not true) bad_gates,count(*) filter(where version_ok is not true) bad_version,
 count(*) filter(where original_ok is not true) bad_original,count(*) filter(where unit_ok is not true) bad_unit_or_derivative,
 count(*) filter(where native_ok is not true) bad_native from checked),
baseline_current as(select entity_type,review_status,last_run,provenance->>'parser' parser,
 provenance->>'manifest_sha256' manifest_sha256,count(*) records,count(distinct native_id) native_ids,
 count(distinct provenance->>'source_url') source_urls,min(native_id) first_native_id,max(native_id) last_native_id,
 encode(sha256(convert_to(string_agg(jsonb_build_array(native_id,payload_sha256,data,provenance,review_status)::text,
 E'\n' order by native_id),'UTF8')),'hex') current_digest
 from corpus_ingest.entities where source_system='hi-hrs' and provenance->>'manifest_sha256'<>'__MANIFEST__'
 group by entity_type,review_status,last_run,provenance->>'parser',provenance->>'manifest_sha256'),
baseline_versions as(select entity_type,first_run,count(*) versions,
 encode(sha256(convert_to(string_agg(jsonb_build_array(native_id,payload_sha256,data,storage_sha256)::text,
 E'\n' order by native_id,payload_sha256),'UTF8')),'hex') immutable_version_digest
 from corpus_ingest.entity_versions where source_system='hi-hrs' and first_run<>'__RUN__'::uuid group by entity_type,first_run)
select jsonb_build_object('schema','hi-post-intake-readback/1','checked_at',now(),'read_only',current_setting('transaction_read_only'),
 'state',(select to_jsonb(s)from corpus_ingest.publisher_code_states_v2 s where jurisdiction='HI'),
 'run',(select to_jsonb(r)from corpus_ingest.runs r where id='__RUN__'::uuid),
 'totals',(select to_jsonb(t)from totals t),'groups',(select jsonb_agg(to_jsonb(g)order by group_key)from groups g),
 'baseline_current_groups',(select jsonb_agg(to_jsonb(g))from baseline_current g),
 'baseline_version_groups',(select jsonb_agg(to_jsonb(g))from baseline_versions g),
 'open_runs',(select count(*)from corpus_ingest.runs where scope->>'source_system'='hi-hrs' and status in('running','partial'))
)packet;
commit;
'''


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);sub=cli.add_subparsers(dest='command',required=True)
    make=sub.add_parser('generate');make.add_argument('--packet',type=Path,required=True);make.add_argument('--baseline',type=Path,required=True)
    make.add_argument('--out',type=Path,required=True);make.add_argument('--run-id')
    compare=sub.add_parser('check');compare.add_argument('--expected',type=Path,required=True);compare.add_argument('--readback',type=Path,required=True);compare.add_argument('--out',type=Path,required=True)
    args=cli.parse_args()
    if args.command=='generate':
        result=generate(args.packet,args.baseline,args.out,args.run_id);print(json.dumps({k:v for k,v in result.items()if k not in ['groups','baseline_current_groups','baseline_version_groups']}))
    else:
        result=check(args.expected,args.readback);json_file(args.out,result);print(json.dumps(result))
