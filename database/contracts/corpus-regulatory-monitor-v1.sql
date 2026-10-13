-- Regulatory source evidence and separate firm work product. Administrative install only.
-- Requires corpus-ingest-v1.sql and canonical-integer-jsonb-v1.sql. No existing collections/graphs are changed.
begin;
create schema if not exists corpus_regulatory;
create schema if not exists corpus_regulatory_workspace;
revoke all on schema corpus_regulatory, corpus_regulatory_workspace from public, anon, authenticated;

create table if not exists corpus_regulatory.sources (
  id text primary key check(id in ('federal_register','fda_recall_notices','fda_warning_letters','openfda_enforcement_drug','openfda_enforcement_device','openfda_enforcement_food','cpsc_recalls','nhtsa_recalls','nhtsa_investigations','nhtsa_communications')),
  label text not null, agency text not null, family text not null, source_url text not null,
  allowed_hosts text[] not null, count_unit text not null, qualification text not null,
  enabled boolean not null default true
);
insert into corpus_regulatory.sources values
('federal_register','Federal Register','Office of the Federal Register','federal_register','https://www.federalregister.gov/',array['www.federalregister.gov','www.govinfo.gov','api.federalregister.gov'],'Federal Register document records','Rules, proposed rules and notices are distinct. A document may propose, amend, correct or merely discuss a provision; this monitor does not establish operative law.',true),
('fda_recall_notices','FDA recall notices','FDA','fda','https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',array['www.fda.gov','www.accessdata.fda.gov'],'FDA notice records','Published recall and safety notices; a notice is not a unique product, patient, injury or current recall lifecycle.',true),
('fda_warning_letters','FDA warning letters','FDA','fda','https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters',array['www.fda.gov'],'FDA warning-letter records','Source-recorded regulatory correspondence. A warning letter is not a finding of civil liability or proof of injury.',true),
('openfda_enforcement_drug','FDA drug enforcement reports','FDA','fda','https://open.fda.gov/apis/drug/enforcement/',array['api.fda.gov','download.open.fda.gov','open.fda.gov','www.fda.gov','www.accessdata.fda.gov'],'drug enforcement report records','Dated enforcement metadata. Report counts are not unique products, patients or injuries, and recorded status may not represent the current recall lifecycle.',true),
('openfda_enforcement_device','FDA device enforcement reports','FDA','fda','https://open.fda.gov/apis/device/enforcement/',array['api.fda.gov','download.open.fda.gov','open.fda.gov','www.fda.gov','www.accessdata.fda.gov'],'device enforcement report records','Dated enforcement metadata. Recall classification I/II/III is distinct from device classification 1/2/3. Counts do not measure injuries or liability.',true),
('openfda_enforcement_food','FDA food enforcement reports','FDA','fda','https://open.fda.gov/apis/food/enforcement/',array['api.fda.gov','download.open.fda.gov','open.fda.gov','www.fda.gov','www.accessdata.fda.gov'],'food enforcement report records','Dated food enforcement metadata. Report counts are not unique products, patients or injuries and do not establish causation.',true),
('cpsc_recalls','CPSC recalls','CPSC','cpsc','https://www.cpsc.gov/Recalls',array['www.cpsc.gov','cpsc.gov','www.saferproducts.gov','www.saferproducts.gov'],'CPSC recall records','Recall records only. The removed CPSC injury collection is excluded. Counts do not measure population injury risk.',true),
('nhtsa_recalls','NHTSA recalls','NHTSA','nhtsa','https://www.nhtsa.gov/recalls',array['api.nhtsa.gov','www.nhtsa.gov','static.nhtsa.gov','www-odi.nhtsa.dot.gov','static.nhtsa.gov'],'NHTSA recall campaign records','Source-recorded campaigns within the displayed collection scope; not vehicle, claimant or injury counts.',true),
('nhtsa_investigations','NHTSA investigations','NHTSA','nhtsa','https://www.nhtsa.gov/vehicle-safety/defects-and-recalls',array['api.nhtsa.gov','www.nhtsa.gov','static.nhtsa.gov','www-odi.nhtsa.dot.gov'],'NHTSA investigation records','An investigation is not a defect finding, injury count or liability conclusion. Collection scope may be limited.',true),
('nhtsa_communications','NHTSA manufacturer communications','NHTSA','nhtsa','https://www.nhtsa.gov/recalls',array['api.nhtsa.gov','www.nhtsa.gov','static.nhtsa.gov','www-odi.nhtsa.dot.gov'],'manufacturer communication records','Manufacturer communications are not necessarily recalls or defect findings. Collection scope may be limited.',true)
on conflict(id) do nothing;

create table if not exists corpus_regulatory.runs (
  id uuid primary key references corpus_ingest.runs(id), source_id text not null references corpus_regulatory.sources(id),
  mode text not null check(mode in ('initial','incremental','backfill')),
  status text not null check(status in ('running','completed','partial','failed')),
  window_from date not null, window_to date not null check(window_to>=window_from),
  expected_count bigint check(expected_count>=0), observed_count bigint not null default 0 check(observed_count>=0),
  scope jsonb not null check(jsonb_typeof(scope)='object'), started_at timestamptz not null default now(),
  finished_at timestamptz, error_code text check(error_code ~ '^[a-z0-9_:-]{1,100}$')
);
create unique index if not exists regulatory_source_lease on corpus_regulatory.runs(source_id) where status='running';
create table if not exists corpus_regulatory.captures (
  run_id uuid not null references corpus_regulatory.runs(id), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  source_url text not null, retrieved_at timestamptz not null, byte_count bigint not null check(byte_count>0 and byte_count<=104857600),
  content_type text not null, storage_key text not null, readback_sha256 text not null check(readback_sha256=sha256),
  primary key(run_id,sha256,source_url)
);
create table if not exists corpus_regulatory.records (
  source_id text not null references corpus_regulatory.sources(id), native_id text not null,
  payload_sha256 text not null, data jsonb not null, retrieved_at timestamptz not null,
  run_id uuid not null references corpus_regulatory.runs(id), primary key(source_id,native_id)
);
create table if not exists corpus_regulatory.events (
  id text primary key check(id ~ '^[a-f0-9]{64}$'), source_id text not null references corpus_regulatory.sources(id),
  native_id text not null, payload_sha256 text not null, previous_payload_sha256 text,
  event_type text not null check(event_type in ('initial_record','backfill','new_record','record_changed','correction')),
  reason text not null, changed_fields text[] not null, detected_at timestamptz not null, published_on date,
  rule_version text not null default 'regulatory-events/1' check(rule_version='regulatory-events/1'),
  run_id uuid not null references corpus_regulatory.runs(id)
);
create index if not exists regulatory_events_detected on corpus_regulatory.events(detected_at desc,id);
create index if not exists regulatory_events_published on corpus_regulatory.events(published_on desc,id);
create index if not exists regulatory_events_record on corpus_regulatory.events(source_id,native_id);
create index if not exists regulatory_record_entities on corpus_regulatory.records using gin((data->'entity_refs'));

create or replace function corpus_regulatory.allowed_url(p_source text,p_url text)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(length(p_url)<=8192 and lower((regexp_match(p_url,'^https://([A-Za-z0-9.-]+)(?::443)?(?:/|$)'))[1])=any(s.allowed_hosts),false)
  from corpus_regulatory.sources s where s.id=p_source;
$$;

create or replace function public.corpus_regulatory_open_run_v1(p_run uuid,p_source text,p_window_from date,p_window_to date,p_expected_count bigint,p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r corpus_regulatory.runs; m text;
begin
  if p_run is null or not exists(select 1 from corpus_regulatory.sources where id=p_source and enabled)
    or p_window_from is null or p_window_to is null or p_window_to<p_window_from or p_expected_count<0
    or jsonb_typeof(p_scope) is distinct from 'object' or pg_column_size(p_scope)>16000 then
    raise exception 'Invalid approved source or run scope' using errcode='22023';
  end if;
  m:=p_scope->>'mode';
  if m is null or m not in ('initial','incremental','backfill') then raise exception 'Run mode required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('regulatory:'||p_source,0));
  select * into r from corpus_regulatory.runs where id=p_run for update;
  if found then
    if (r.source_id,r.window_from,r.window_to,r.expected_count,r.scope) is distinct from (p_source,p_window_from,p_window_to,p_expected_count,p_scope) then
      raise exception 'Run identity has conflicting scope' using errcode='22023';
    end if;
    if r.status='completed' then return jsonb_build_object('id',p_run,'status','completed','observed_count',r.observed_count); end if;
    if exists(select 1 from corpus_regulatory.runs where source_id=p_source and status='running' and id<>p_run) then raise exception 'Source collection is already running' using errcode='55000'; end if;
    update corpus_regulatory.runs set status='running',finished_at=null,error_code=null where id=p_run;
    update corpus_ingest.runs set status='running',finished_at=null where id=p_run;
    return jsonb_build_object('id',p_run,'status','running','resumed',true);
  end if;
  if exists(select 1 from corpus_regulatory.runs where source_id=p_source and status='running') then raise exception 'Source collection is already running' using errcode='55000'; end if;
  insert into corpus_ingest.runs(id,contract_version,status,scope) values(p_run,'regulatory-monitor/1','running',p_scope||jsonb_build_object('source',p_source,'window_from',p_window_from,'window_to',p_window_to));
  insert into corpus_regulatory.runs(id,source_id,mode,status,window_from,window_to,expected_count,scope) values(p_run,p_source,m,'running',p_window_from,p_window_to,p_expected_count,p_scope);
  return jsonb_build_object('id',p_run,'status','running','resumed',false);
end;
$$;

create or replace function corpus_regulatory.source_json(p_source text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',s.id,'label',s.label,'agency',s.agency,'sourceUrl',s.source_url,'countUnit',s.count_unit,
    'qualification',s.qualification||' Counts describe stored source records. Completed collection windows do not establish continuous or comprehensive coverage.',
    'enabled',s.enabled,'latestCompletedAt',(select max(finished_at) from corpus_regulatory.runs where source_id=s.id and status='completed'),
    'latestAttemptAt',(select max(started_at) from corpus_regulatory.runs where source_id=s.id),
    'latestAttemptStatus',(select status from corpus_regulatory.runs where source_id=s.id order by started_at desc,id desc limit 1),
    'coverageFrom',(select min(window_from) from corpus_regulatory.runs where source_id=s.id and status='completed'),
    'coverageTo',(select max(window_to) from corpus_regulatory.runs where source_id=s.id and status='completed'),
    'records',(select count(*) from corpus_regulatory.records where source_id=s.id),'events',(select count(*) from corpus_regulatory.events where source_id=s.id))
  from corpus_regulatory.sources s where s.id=p_source;
$$;

create or replace function corpus_regulatory.event_json(p_event corpus_regulatory.events)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_event.id,'source',p_event.source_id,'nativeId',p_event.native_id,'eventType',p_event.event_type,
    'reason',p_event.reason,'changedFields',p_event.changed_fields,'detectedAt',p_event.detected_at,'payloadSha256',p_event.payload_sha256,
    'previousPayloadSha256',p_event.previous_payload_sha256,'ruleVersion',p_event.rule_version,'record',v.data)
  from corpus_ingest.entity_versions v where v.source_system='regulatory:'||p_event.source_id and v.entity_type='regulatory-record'
    and v.native_id=p_event.native_id and v.payload_sha256=p_event.payload_sha256;
$$;

create or replace function public.corpus_regulatory_overview_v1()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('sources',(select coalesce(jsonb_agg(corpus_regulatory.source_json(id) order by label),'[]') from corpus_regulatory.sources),
    'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source_id,'mode',mode,'status',status,'startedAt',started_at,'finishedAt',finished_at,
      'windowFrom',window_from,'windowTo',window_to,'expectedCount',expected_count,'observedCount',observed_count,'errorCode',error_code,'scope',scope) order by started_at desc,id desc),'[]')
      from (select * from corpus_regulatory.runs order by started_at desc,id desc limit 100) r),
    'counts',jsonb_build_object('records',(select count(*) from corpus_regulatory.records),'events',(select count(*) from corpus_regulatory.events),
      'completedSources',(select count(distinct source_id) from corpus_regulatory.runs where status='completed')),
    'qualifications',jsonb_build_array('Events are source-version observations, not incidents, injuries or findings of liability.',
      'Initial collection and backfill are labeled separately from newly observed records. Publication dates may precede detection.',
      'Only completed, count-reconciled captures enter the public monitor. Failed or partial runs remain visible as coverage limitations.',
      'Source-native entity references are literal; names alone never establish identity, causation or MDL membership.'));
$$;

create or replace function corpus_regulatory.validate_query(p_query jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_query) is distinct from 'object' or pg_column_size(p_query)>8000
    or exists(select 1 from jsonb_object_keys(p_query) k where k not in ('q','source','sourceFamily','eventType','from','to','dateBasis','entityNamespace','entityId','limit','offset'))
    or exists(select 1 from jsonb_each(p_query) x where x.key not in ('limit','offset') and jsonb_typeof(x.value)<>'string')
    or (p_query ? 'limit' and jsonb_typeof(p_query->'limit')<>'number')
    or (p_query ? 'offset' and jsonb_typeof(p_query->'offset')<>'number')
    or length(coalesce(p_query->>'q',''))>300
    or (p_query ? 'source' and p_query->>'source' not in ('federal_register','fda_recall_notices','fda_warning_letters','openfda_enforcement_drug','openfda_enforcement_device','openfda_enforcement_food','cpsc_recalls','nhtsa_recalls','nhtsa_investigations','nhtsa_communications'))
    or (p_query ? 'sourceFamily' and p_query->>'sourceFamily' not in ('fda','nhtsa','cpsc','federal_register'))
    or (p_query ? 'eventType' and p_query->>'eventType' not in ('initial_record','backfill','new_record','record_changed','correction'))
    or (p_query ? 'dateBasis' and p_query->>'dateBasis' not in ('detected','published'))
    or ((p_query ? 'entityNamespace')<>(p_query ? 'entityId'))
    or (p_query ? 'entityNamespace' and length(p_query->>'entityNamespace') not between 1 and 100)
    or (p_query ? 'entityId' and length(p_query->>'entityId') not between 1 and 300)
    or (p_query ? 'limit' and (p_query->>'limit' !~ '^[0-9]{1,3}$' or (p_query->>'limit')::int not between 1 and 100))
    or (p_query ? 'offset' and (p_query->>'offset' !~ '^[0-9]{1,5}$' or (p_query->>'offset')::int not between 0 and 10000))
    or exists(select 1 from jsonb_each(p_query) x where x.value='null'::jsonb) then raise exception 'Invalid bounded regulatory query' using errcode='22023'; end if;
  if (p_query ? 'from' and (p_query->>'from' !~ '^\d{4}-\d{2}-\d{2}$' or (p_query->>'from')::date::text<>p_query->>'from'))
    or (p_query ? 'to' and (p_query->>'to' !~ '^\d{4}-\d{2}-\d{2}$' or (p_query->>'to')::date::text<>p_query->>'to'))
    or (p_query ? 'from' and p_query ? 'to' and (p_query->>'from')::date>(p_query->>'to')::date) then
    raise exception 'Invalid exact query dates' using errcode='22023';
  end if;
end;
$$;

create or replace function corpus_regulatory.match_event(p_event corpus_regulatory.events,p_data jsonb,p_query jsonb)
returns boolean language sql stable security invoker set search_path='' as $$
  select (not p_query ? 'source' or p_event.source_id=p_query->>'source')
    and (not p_query ? 'sourceFamily' or exists(select 1 from corpus_regulatory.sources s where s.id=p_event.source_id and s.family=p_query->>'sourceFamily'))
    and (not p_query ? 'eventType' or p_event.event_type=p_query->>'eventType')
    and (not p_query ? 'from' or case when p_query->>'dateBasis'='published' then p_event.published_on else (p_event.detected_at at time zone 'UTC')::date end >= (p_query->>'from')::date)
    and (not p_query ? 'to' or case when p_query->>'dateBasis'='published' then p_event.published_on else (p_event.detected_at at time zone 'UTC')::date end <= (p_query->>'to')::date)
    and (coalesce(p_query->>'q','')='' or position(lower(p_query->>'q') in lower(concat_ws(' ',p_data->>'title',p_data->>'evidence_excerpt',p_data->>'native_id',
      (p_data->'identifiers')::text,(p_data->'entity_refs')::text,p_data->'fields'->>'notice_text',
      (p_data->'fields'->'publisher_record')::text,(p_data->'fields'->'publisher_rows')::text)))>0)
    and (not p_query ? 'entityId' or exists(select 1 from jsonb_array_elements(p_data->'entity_refs') x where x->>'namespace'=p_query->>'entityNamespace' and x->>'native_id'=p_query->>'entityId'));
$$;

create or replace function public.corpus_regulatory_query_v1(p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb;
begin
  perform corpus_regulatory.validate_query(p_query);
  with matched as materialized (
    select e.* from corpus_regulatory.events e join corpus_ingest.entity_versions v on v.source_system='regulatory:'||e.source_id
      and v.entity_type='regulatory-record' and v.native_id=e.native_id and v.payload_sha256=e.payload_sha256
    where corpus_regulatory.match_event(e,v.data,p_query)
    order by case when p_query->>'dateBasis'='published' then e.published_on else (e.detected_at at time zone 'UTC')::date end desc nulls last,e.detected_at desc,e.id desc limit 100001
  ), page as (select * from matched offset coalesce((p_query->>'offset')::int,0) limit coalesce((p_query->>'limit')::int,50))
  select jsonb_build_object('items',(select coalesce(jsonb_agg(corpus_regulatory.event_json(e::corpus_regulatory.events)),'[]') from page e),
    'total',least(count(*),100000),'totalCapped',count(*)>100000,'nextOffset',case when count(*)>coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50)
      and coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50)<=10000 then coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50) else null end,
    'countUnit','source-version events','dateBasis',coalesce(p_query->>'dateBasis','detected')) into out from matched;
  return out;
end;
$$;

create or replace function public.corpus_regulatory_detail_v1(p_source text,p_native_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r corpus_regulatory.records; vers jsonb; evs jsonb; n bigint; en bigint;
begin
  if coalesce(length(p_native_id),0) not between 1 and 500 or not exists(select 1 from corpus_regulatory.sources where id=p_source) then raise exception 'Invalid source-native record identity' using errcode='22023'; end if;
  select * into r from corpus_regulatory.records where source_id=p_source and native_id=p_native_id;
  if not found then return null; end if;
  with retained as (
    select v.payload_sha256,v.data,v.schema_version,min(o.retrieved_at) first_at,max(o.retrieved_at) last_at,
      (array_agg(o.source_sha256 order by o.retrieved_at desc,o.source_url))[1] raw_sha,
      (array_agg(o.source_url order by o.retrieved_at desc,o.source_url))[1] capture_url
    from corpus_ingest.entity_versions v join corpus_ingest.observations o using(source_system,entity_type,native_id,payload_sha256)
    join corpus_regulatory.runs cr on cr.id=o.run_id and cr.status='completed'
    where v.source_system='regulatory:'||p_source and v.entity_type='regulatory-record' and v.native_id=p_native_id
    group by v.payload_sha256,v.data,v.schema_version order by max(o.retrieved_at) desc,v.payload_sha256 limit 101
  ) select count(*),(select coalesce(jsonb_agg(jsonb_build_object('payloadSha256',v.payload_sha256,'record',v.data,'firstObservedAt',v.first_at,'lastObservedAt',v.last_at,
      'rawSha256',v.raw_sha,'captureSourceUrl',v.capture_url,'schemaVersion',v.schema_version) order by v.last_at desc,v.payload_sha256),'[]') from (select * from retained limit 100) v) into n,vers from retained;
  select count(*) into en from corpus_regulatory.events where source_id=p_source and native_id=p_native_id;
  select coalesce(jsonb_agg(corpus_regulatory.event_json(e::corpus_regulatory.events) order by e.detected_at desc,e.id),'[]') into evs from
    (select * from corpus_regulatory.events where source_id=p_source and native_id=p_native_id order by detected_at desc,id limit 100) e;
  return jsonb_build_object('source',corpus_regulatory.source_json(p_source),'record',r.data,'payloadSha256',r.payload_sha256,'retrievedAt',r.retrieved_at,
    'versions',vers,'versionsCapped',n>100,'events',evs,'eventsCapped',en>100,
    'qualification','Exact source-native record history from completed collections. Retained metadata and excerpts do not establish current regulatory status, causation or liability.');
end;
$$;

create or replace function public.corpus_regulatory_entities_v1(p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb;
begin
  perform corpus_regulatory.validate_query(p_query);
  with groups as materialized (
    select x->>'namespace' ns,x->>'native_id' id,array_agg(distinct x->>'label' order by x->>'label') labels,
      count(distinct (r.source_id,r.native_id)) records,array_agg(distinct r.source_id order by r.source_id) sources
    from corpus_regulatory.records r cross join lateral jsonb_array_elements(r.data->'entity_refs') x
    where (not p_query ? 'source' or r.source_id=p_query->>'source')
      and (not p_query ? 'sourceFamily' or exists(select 1 from corpus_regulatory.sources s where s.id=r.source_id and s.family=p_query->>'sourceFamily'))
      and (coalesce(p_query->>'q','')='' or position(lower(p_query->>'q') in lower(x::text))>0)
    group by x->>'namespace',x->>'native_id' order by x->>'namespace',x->>'native_id' limit 100001
  ), page as (select * from groups offset coalesce((p_query->>'offset')::int,0) limit coalesce((p_query->>'limit')::int,50))
  select jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('namespace',ns,'nativeId',id,'labels',labels,'records',records,'sources',sources)),'[]') from page),
    'total',least(count(*),100000),'totalCapped',count(*)>100000,'nextOffset',case when count(*)>coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50)
      and coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50)<=10000 then coalesce((p_query->>'offset')::int,0)+coalesce((p_query->>'limit')::int,50) else null end,
    'qualification','Entities are exact namespace/native-ID references asserted by the source. Labels are not fuzzy-merged; record counts are not incidents.') into out from groups;
  return out;
end;
$$;

create or replace function public.corpus_regulatory_trends_v1(p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out jsonb;
begin
  perform corpus_regulatory.validate_query(p_query);
  if not (p_query ?& array['from','to']) or (p_query->>'to')::date-(p_query->>'from')::date>366 then raise exception 'Bounded trend dates required' using errcode='22023'; end if;
  with matched as (
    select case when p_query->>'dateBasis'='published' then e.published_on else (e.detected_at at time zone 'UTC')::date end as day,e.event_type
    from corpus_regulatory.events e join corpus_ingest.entity_versions v on v.source_system='regulatory:'||e.source_id and v.entity_type='regulatory-record' and v.native_id=e.native_id and v.payload_sha256=e.payload_sha256
    where corpus_regulatory.match_event(e,v.data,p_query)
  ), days as (select d::date as day from generate_series((p_query->>'from')::date,(p_query->>'to')::date,interval '1 day') d), counts as (
    select day,count(*) events,count(*) filter(where event_type in ('initial_record','backfill')) initial,count(*) filter(where event_type in ('record_changed','correction')) changes from matched group by day)
  select jsonb_build_object('points',jsonb_agg(jsonb_build_object('day',d.day,'events',coalesce(c.events,0),'initialRecords',coalesce(c.initial,0),'changes',coalesce(c.changes,0)) order by d.day),
    'countUnit','source-version events','dateBasis',coalesce(p_query->>'dateBasis','detected'),
    'qualification','Counts describe stored source-version events by the selected date role, not incidents or risk. Zero means no stored matching event; it does not prove complete source coverage. Multiple revisions may refer to one source record.',
    'sources',(select coalesce(jsonb_agg(corpus_regulatory.source_json(id) order by label),'[]') from corpus_regulatory.sources where (not p_query ? 'source' or id=p_query->>'source') and (not p_query ? 'sourceFamily' or family=p_query->>'sourceFamily')))
    into out from days d left join counts c using(day);
  return out;
end;
$$;

create or replace function public.corpus_regulatory_capture_v1(p_run uuid,p_captures jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r corpus_regulatory.runs; c jsonb; n bigint:=0;
begin
  select * into r from corpus_regulatory.runs where id=p_run for update;
  if not found or r.status<>'running' then raise exception 'Collection is not open' using errcode='55000'; end if;
  if jsonb_typeof(p_captures) is distinct from 'array' or jsonb_array_length(p_captures)>100 or pg_column_size(p_captures)>1000000 then raise exception 'Bounded capture array required' using errcode='22023'; end if;
  for c in select value from jsonb_array_elements(p_captures) loop
    if coalesce(c->>'sha256','') !~ '^[a-f0-9]{64}$' or c->>'readback_sha256' is distinct from c->>'sha256'
      or not coalesce(corpus_regulatory.allowed_url(r.source_id,c->>'source_url'),false)
      or c->>'storage_key' is distinct from 'regulatory/'||left(c->>'sha256',2)||'/'||(c->>'sha256')||'.raw'
      or coalesce(c->>'byte_count','') !~ '^[0-9]{1,9}$' or (c->>'byte_count')::bigint not between 1 and 104857600
      or coalesce(length(c->>'content_type'),0) not between 1 and 200
      or c->>'retrieved_at' is null or (c->>'retrieved_at')::timestamptz>now()+interval '5 minutes' then
      raise exception 'Invalid retained source capture' using errcode='22023';
    end if;
    if not exists(select 1 from storage.buckets where id='corpus-originals' and public=false)
      or not exists(select 1 from storage.objects where bucket_id='corpus-originals' and name=c->>'storage_key'
        and metadata->>'size'=(c->>'byte_count')) then raise exception 'Private raw object size/name not verified' using errcode='22023'; end if;
    if exists(select 1 from corpus_regulatory.captures x where x.run_id=p_run and x.sha256=c->>'sha256' and x.source_url=c->>'source_url'
      and (x.byte_count,x.content_type,x.storage_key,x.retrieved_at) is distinct from ((c->>'byte_count')::bigint,c->>'content_type',c->>'storage_key',(c->>'retrieved_at')::timestamptz)) then
      raise exception 'Capture replay conflicts with retained evidence' using errcode='22023';
    end if;
    insert into corpus_regulatory.captures values(p_run,c->>'sha256',c->>'source_url',(c->>'retrieved_at')::timestamptz,(c->>'byte_count')::bigint,c->>'content_type',c->>'storage_key',c->>'readback_sha256') on conflict do nothing;
    n:=n+1;
  end loop;
  return jsonb_build_object('received',n,'retained',(select count(*) from corpus_regulatory.captures where run_id=p_run));
end;
$$;

create or replace function public.corpus_regulatory_intake_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r corpus_regulatory.runs; row jsonb; d jsonb; a jsonb; normalized jsonb:='[]'; result jsonb;
begin
  select * into r from corpus_regulatory.runs where id=p_run for update;
  if not found or r.status<>'running' then raise exception 'Collection is not open' using errcode='55000'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 or pg_column_size(p_rows)>2000000 then raise exception 'Bounded record array required' using errcode='22023'; end if;
  for row in select value from jsonb_array_elements(p_rows) loop
    d:=row->'data';
    if jsonb_typeof(d) is distinct from 'object' or row->>'schema_version' is distinct from 'regulatory-record/1'
      or coalesce(length(d->>'native_id'),0) not between 1 and 500 or coalesce(length(d->>'title'),0) not between 1 and 4000
      or coalesce(length(d->>'document_type'),0) not between 1 and 200 or pg_column_size(d)>200000
      or not (d ?& array['native_id','title','document_type','published_on','source_updated_on','source_url','agency_ids','agency_names','entity_refs','identifiers','status','fields','correction_of','evidence_excerpt'])
      or (select count(*) from jsonb_object_keys(d))<>14
      or exists(select 1 from jsonb_each(d) x where x.key in ('native_id','title','document_type','source_url') and jsonb_typeof(x.value)<>'string')
      or not coalesce(corpus_regulatory.allowed_url(r.source_id,d->>'source_url'),false)
      or jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(d->'evidence_excerpt') is distinct from 'string'
      or length(d->>'evidence_excerpt')>20000
      or (d->>'status' is not null and (jsonb_typeof(d->'status')<>'string' or length(d->>'status')>500))
      or row->>'payload_sha256' is distinct from corpus_ingest.canonical_integer_jsonb_sha256_v1(d) then
      raise exception 'Invalid native source record or canonical payload hash' using errcode='22023';
    end if;
    foreach a in array array[d->'agency_ids',d->'agency_names',d->'identifiers',d->'correction_of'] loop
      if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)>200
        or exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 500) then
        raise exception 'Bounded literal identifier arrays required' using errcode='22023';
      end if;
    end loop;
    if jsonb_typeof(d->'entity_refs') is distinct from 'array' or jsonb_array_length(d->'entity_refs')>200
      or exists(select 1 from jsonb_array_elements(d->'entity_refs') x where jsonb_typeof(x)<>'object'
        or coalesce(length(x->>'namespace'),0) not between 1 and 100 or coalesce(length(x->>'native_id'),0) not between 1 and 300
        or coalesce(length(x->>'label'),0) not between 1 and 500 or (select count(*) from jsonb_object_keys(x))<>3
        or exists(select 1 from jsonb_each(x) e where jsonb_typeof(e.value)<>'string')) then
      raise exception 'Explicit source-native entity references required' using errcode='22023';
    end if;
    if (d->>'published_on' is not null and (d->>'published_on' !~ '^\d{4}-\d{2}-\d{2}$' or (d->>'published_on')::date::text<>d->>'published_on'))
      or (d->>'source_updated_on' is not null and (d->>'source_updated_on' !~ '^\d{4}-\d{2}-\d{2}$' or (d->>'source_updated_on')::date::text<>d->>'source_updated_on'))
      or row->>'retrieved_at' is null or (row->>'retrieved_at')::timestamptz>now()+interval '5 minutes'
      or length(coalesce(row->>'record_pointer',''))>1000 then raise exception 'Invalid source dates or extraction pointer' using errcode='22023'; end if;
    if not exists(select 1 from corpus_regulatory.captures c where c.run_id=p_run and c.sha256=row->>'raw_sha256'
      and c.source_url=row->>'capture_source_url' and c.storage_key=row->>'raw_storage_key'
      and c.retrieved_at=(row->>'retrieved_at')::timestamptz) then raise exception 'Record has no exact retained capture receipt' using errcode='22023'; end if;
    if exists(select 1 from corpus_ingest.observations o where o.run_id=p_run and o.source_system='regulatory:'||r.source_id
      and o.entity_type='regulatory-record' and o.native_id=d->>'native_id' and o.payload_sha256<>row->>'payload_sha256')
      or exists(select 1 from jsonb_array_elements(p_rows) other where other->'data'->>'native_id'=d->>'native_id' and other->>'payload_sha256'<>row->>'payload_sha256') then
      raise exception 'Conflicting versions of a native record within one collection' using errcode='22023';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('source_system','regulatory:'||r.source_id,'entity_type','regulatory-record',
      'native_id',d->>'native_id','schema_version','regulatory-record/1','data',d,'provenance',jsonb_build_object(
      'source_url',row->>'capture_source_url','record_url',d->>'source_url','source_sha256',row->>'raw_sha256','storage_key',row->>'raw_storage_key',
      'retrieved_at',row->>'retrieved_at','source_as_of',d->>'source_updated_on','record_sha256',row->>'payload_sha256','record_hash_codec','canonical-integer-jsonb/1',
      'record_pointer',row->>'record_pointer','parser','regulatory-record/1')));
  end loop;
  result:=corpus_ingest.ingest_entities(p_run,normalized);
  update corpus_regulatory.runs set observed_count=(select count(distinct native_id) from corpus_ingest.observations where run_id=p_run and source_system='regulatory:'||r.source_id and entity_type='regulatory-record') where id=p_run;
  return result||jsonb_build_object('observed_count',(select observed_count from corpus_regulatory.runs where id=p_run));
end;
$$;

create or replace function public.corpus_regulatory_finish_run_v1(p_run uuid,p_status text,p_observed_count bigint,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r corpus_regulatory.runs; v record; old corpus_regulatory.records; kind text; reason text; changed text[]; eid text; n bigint; baseline boolean;
begin
  select * into r from corpus_regulatory.runs where id=p_run for update;
  if not found or p_status is null or p_status not in ('completed','partial','failed') or p_observed_count is null or p_observed_count<0
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_:-]{1,100}$') then raise exception 'Invalid collection completion' using errcode='22023'; end if;
  if r.status='completed' then
    if p_status<>'completed' or p_observed_count<>r.observed_count then raise exception 'Completed run is immutable' using errcode='55000'; end if;
    return jsonb_build_object('id',r.id,'status',r.status,'observed_count',r.observed_count,'replayed',true);
  end if;
  if r.status<>'running' then raise exception 'Resume the collection before finalizing it' using errcode='55000'; end if;
  select count(distinct native_id) into n from corpus_ingest.observations where run_id=p_run and source_system='regulatory:'||r.source_id and entity_type='regulatory-record';
  if n<>p_observed_count or n<>r.observed_count then raise exception 'Observation count readback mismatch' using errcode='22023'; end if;
  if p_status='completed' and (r.expected_count is null or n<>r.expected_count or p_error_code is not null
    or not exists(select 1 from corpus_regulatory.captures where run_id=p_run)) then raise exception 'Exact source count and retained capture required for completed coverage' using errcode='22023'; end if;
  if p_status='completed' then
    -- The locked running row plus unique source lease prevents competing finalizers;
    -- do not acquire the source-open lock in reverse order and deadlock a resume.
    baseline:=not exists(select 1 from corpus_regulatory.runs where source_id=r.source_id and status='completed');
    for v in select distinct on(o.native_id) o.native_id,o.payload_sha256,o.retrieved_at,ev.data
      from corpus_ingest.observations o join corpus_ingest.entity_versions ev using(source_system,entity_type,native_id,payload_sha256)
      where o.run_id=p_run and o.source_system='regulatory:'||r.source_id and o.entity_type='regulatory-record'
      order by o.native_id,o.retrieved_at desc loop
      select * into old from corpus_regulatory.records where source_id=r.source_id and native_id=v.native_id for update;
      if old.payload_sha256=v.payload_sha256 then
        update corpus_regulatory.records set retrieved_at=greatest(retrieved_at,v.retrieved_at),run_id=p_run where source_id=r.source_id and native_id=v.native_id;
        continue;
      end if;
      -- An older dated backfill must not replace a later source revision; the full version remains retained privately.
      if old.native_id is not null and (v.retrieved_at<old.retrieved_at or
        (r.mode='backfill' and coalesce(v.data->>'source_updated_on',v.data->>'published_on','')<coalesce(old.data->>'source_updated_on',old.data->>'published_on',''))) then continue; end if;
      select coalesce(array_agg(k order by k),array[]::text[]) into changed from jsonb_object_keys(v.data) k where old.native_id is not null and v.data->k is distinct from old.data->k;
      kind:=case when jsonb_array_length(v.data->'correction_of')>0 then 'correction' when old.native_id is not null then 'record_changed' when baseline or r.mode='initial' then 'initial_record' when r.mode='backfill' then 'backfill' else 'new_record' end;
      reason:=case when kind='correction' then 'The source records an explicit correction relationship.' when old.native_id is not null then 'Source fields changed: '||array_to_string(changed,', ')||'.' when kind='initial_record' then 'Record observed during initial collection; this is not a new incident.' when kind='backfill' then 'Record observed during historical backfill; this is not a new incident.' else 'Record newly observed by this monitor; publication and incident dates may be earlier.' end;
      eid:=encode(sha256(convert_to(jsonb_build_array(r.source_id,v.native_id,old.payload_sha256,v.payload_sha256,'regulatory-events/1',p_run)::text,'UTF8')),'hex');
      insert into corpus_regulatory.events(id,source_id,native_id,payload_sha256,previous_payload_sha256,event_type,reason,changed_fields,detected_at,published_on,run_id)
        values(eid,r.source_id,v.native_id,v.payload_sha256,old.payload_sha256,kind,reason,changed,v.retrieved_at,(v.data->>'published_on')::date,p_run) on conflict do nothing;
      insert into corpus_regulatory.records values(r.source_id,v.native_id,v.payload_sha256,v.data,v.retrieved_at,p_run)
        on conflict(source_id,native_id) do update set payload_sha256=excluded.payload_sha256,data=excluded.data,retrieved_at=excluded.retrieved_at,run_id=excluded.run_id;
    end loop;
  end if;
  update corpus_regulatory.runs set status=p_status,finished_at=now(),observed_count=n,error_code=p_error_code where id=p_run;
  update corpus_ingest.runs set status=p_status,finished_at=now(),counts=jsonb_build_object('observed',n,'expected',r.expected_count,'error_code',p_error_code) where id=p_run;
  return jsonb_build_object('id',p_run,'status',p_status,'observed_count',n,'events',(select count(*) from corpus_regulatory.events where run_id=p_run));
end;
$$;

-- A separate schema for confidential work product. There is no self-join or email-domain enrollment.
create table if not exists corpus_regulatory_workspace.organizations (
  id uuid primary key, name text not null check(length(name) between 1 and 200), created_at timestamptz not null default now()
);
create table if not exists corpus_regulatory_workspace.memberships (
  organization_id uuid not null references corpus_regulatory_workspace.organizations(id), issuer text not null,
  user_id uuid not null, role text not null check(role in ('viewer','analyst','admin')), active boolean not null default true,
  updated_at timestamptz not null default now(), primary key(organization_id,issuer,user_id),
  check(issuer ~ '^https://[A-Za-z0-9.-]+(:443)?$')
);
create table if not exists corpus_regulatory_workspace.membership_audit (
  id bigint generated always as identity primary key, organization_id uuid not null, issuer text not null,user_id uuid not null,
  previous_value jsonb, new_value jsonb not null, reason text not null, changed_at timestamptz not null default now()
);
create table if not exists corpus_regulatory_workspace.investigations (
  id uuid primary key, organization_id uuid not null references corpus_regulatory_workspace.organizations(id),
  title text not null, description text not null, created_by uuid not null, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(id,organization_id)
);
create table if not exists corpus_regulatory_workspace.watchlists (
  id uuid primary key, organization_id uuid not null references corpus_regulatory_workspace.organizations(id),
  name text not null, query jsonb not null, investigation_id uuid, created_by uuid not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(investigation_id,organization_id) references corpus_regulatory_workspace.investigations(id,organization_id)
);
create table if not exists corpus_regulatory_workspace.reviews (
  id uuid primary key, organization_id uuid not null references corpus_regulatory_workspace.organizations(id),
  event_id text not null references corpus_regulatory.events(id), status text not null check(status in ('triaged','relevant','dismissed','needs_evidence')),
  note text not null, investigation_id uuid, reviewed_by uuid not null, created_at timestamptz not null default now(),
  foreign key(investigation_id,organization_id) references corpus_regulatory_workspace.investigations(id,organization_id)
);
create table if not exists corpus_regulatory_workspace.briefs (
  id uuid primary key, organization_id uuid not null references corpus_regulatory_workspace.organizations(id),
  title text not null, investigation_id uuid, created_by uuid not null, created_at timestamptz not null default now(),
  manifest_sha256 text not null, manifest jsonb not null,
  foreign key(investigation_id,organization_id) references corpus_regulatory_workspace.investigations(id,organization_id)
);
create table if not exists corpus_regulatory_workspace.change_audit (
  id bigint generated always as identity primary key, organization_id uuid not null, user_id uuid not null,
  action text not null, record_id uuid not null, previous_value jsonb, new_value jsonb not null, changed_at timestamptz not null default now()
);

create or replace function public.corpus_regulatory_admin_membership_v1(p_organization uuid,p_name text,p_issuer text,p_user uuid,p_role text,p_active boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb; new jsonb;
begin
  if p_organization is null or p_user is null or coalesce(length(trim(p_name)),0) not between 1 and 200
    or p_issuer is null or p_issuer !~ '^https://[A-Za-z0-9.-]+(:443)?$' or p_role is null or p_role not in ('viewer','analyst','admin')
    or p_active is null or coalesce(length(trim(p_reason)),0) not between 1 and 2000 then raise exception 'Explicit operator-reviewed membership required' using errcode='22023'; end if;
  insert into corpus_regulatory_workspace.organizations(id,name) values(p_organization,p_name) on conflict(id) do nothing;
  if not exists(select 1 from corpus_regulatory_workspace.organizations where id=p_organization and name=p_name) then raise exception 'Organization identity/name conflict' using errcode='22023'; end if;
  select to_jsonb(m) into old from corpus_regulatory_workspace.memberships m where organization_id=p_organization and issuer=p_issuer and user_id=p_user for update;
  insert into corpus_regulatory_workspace.memberships(organization_id,issuer,user_id,role,active) values(p_organization,p_issuer,p_user,p_role,p_active)
    on conflict(organization_id,issuer,user_id) do update set role=excluded.role,active=excluded.active,updated_at=now();
  select to_jsonb(m) into new from corpus_regulatory_workspace.memberships m where organization_id=p_organization and issuer=p_issuer and user_id=p_user;
  insert into corpus_regulatory_workspace.membership_audit(organization_id,issuer,user_id,previous_value,new_value,reason) values(p_organization,p_issuer,p_user,old,new,p_reason);
  return new;
end;
$$;

create or replace function corpus_regulatory_workspace.require_member(p_issuer text,p_user uuid,p_organization uuid,p_write boolean)
returns text language plpgsql stable security invoker set search_path='' as $$
declare r text;
begin
  select role into r from corpus_regulatory_workspace.memberships where organization_id=p_organization and issuer=p_issuer and user_id=p_user and active;
  if r is null or (p_write and r not in ('analyst','admin')) then raise exception 'Private workspace access denied' using errcode='42501'; end if;
  return r;
end;
$$;

create or replace function public.corpus_regulatory_workspace_access_v1(p_issuer text,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('organizationId',o.id,'organizationName',o.name,'role',m.role) order by o.name,o.id),'[]')
  from corpus_regulatory_workspace.memberships m join corpus_regulatory_workspace.organizations o on o.id=m.organization_id
  where m.issuer=p_issuer and m.user_id=p_user and m.active;
$$;

create or replace function public.corpus_regulatory_workspace_read_v1(p_issuer text,p_user uuid,p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role text; inv jsonb; watch jsonb; rev jsonb; brief jsonb;
begin
  role:=corpus_regulatory_workspace.require_member(p_issuer,p_user,p_organization,false);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'createdAt',created_at,'updatedAt',updated_at) order by updated_at desc,id),'[]') into inv
    from (select * from corpus_regulatory_workspace.investigations where organization_id=p_organization order by updated_at desc,id limit 100) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'query',query,'investigationId',investigation_id,'createdAt',created_at,'updatedAt',updated_at) order by updated_at desc,id),'[]') into watch
    from (select * from corpus_regulatory_workspace.watchlists where organization_id=p_organization order by updated_at desc,id limit 100) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'eventId',x.event_id,'status',x.status,'note',x.note,'investigationId',x.investigation_id,'reviewedBy',x.reviewed_by,'createdAt',x.created_at,
    'source',e.source_id,'nativeId',e.native_id,'payloadSha256',e.payload_sha256,'needsReconsideration',r.payload_sha256 is distinct from e.payload_sha256) order by x.created_at desc,x.id),'[]') into rev
    from (select * from corpus_regulatory_workspace.reviews where organization_id=p_organization order by created_at desc,id limit 100) x
    join corpus_regulatory.events e on e.id=x.event_id join corpus_regulatory.records r on r.source_id=e.source_id and r.native_id=e.native_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'investigationId',investigation_id,'createdBy',created_by,'createdAt',created_at,'manifestSha256',manifest_sha256) order by created_at desc,id),'[]') into brief
    from (select * from corpus_regulatory_workspace.briefs where organization_id=p_organization order by created_at desc,id limit 100) x;
  return jsonb_build_object('membership',jsonb_build_object('organizationId',p_organization,'organizationName',(select name from corpus_regulatory_workspace.organizations where id=p_organization),'role',role),
    'investigations',inv,'watchlists',watch,'reviews',rev,'briefs',brief,'listsCapped',
    (select count(*)>100 from corpus_regulatory_workspace.investigations where organization_id=p_organization) or
    (select count(*)>100 from corpus_regulatory_workspace.watchlists where organization_id=p_organization) or
    (select count(*)>100 from corpus_regulatory_workspace.reviews where organization_id=p_organization) or
    (select count(*)>100 from corpus_regulatory_workspace.briefs where organization_id=p_organization));
end;
$$;

create or replace function public.corpus_regulatory_brief_read_v1(p_issuer text,p_user uuid,p_organization uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b corpus_regulatory_workspace.briefs;
begin
  perform corpus_regulatory_workspace.require_member(p_issuer,p_user,p_organization,false);
  select * into b from corpus_regulatory_workspace.briefs where id=p_id and organization_id=p_organization;
  if not found then return null; end if;
  return jsonb_build_object('id',b.id,'title',b.title,'investigationId',b.investigation_id,'createdBy',b.created_by,'createdAt',b.created_at,'manifestSha256',b.manifest_sha256,'manifest',b.manifest);
end;
$$;

create or replace function public.corpus_regulatory_workspace_write_v1(p_issuer text,p_user uuid,p_organization uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; investigation uuid; old jsonb; result jsonb; event corpus_regulatory.events; manifest jsonb; selected jsonb; digest text; now_at timestamptz:=now(); n bigint; member_role text;
begin
  -- Serialized per-member writes plus membership recheck prevent revoked access from authorizing a later statement.
  select role into member_role from corpus_regulatory_workspace.memberships where organization_id=p_organization and issuer=p_issuer and user_id=p_user and active for share;
  if member_role is null or member_role not in ('analyst','admin') then raise exception 'Private workspace access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or pg_column_size(p_input)>40000 or p_action is null or p_action not in ('investigation','watchlist','review','brief') then raise exception 'Invalid private work-product action' using errcode='22023'; end if;
  v_id:=coalesce((p_input->>'id')::uuid,gen_random_uuid());
  investigation:=(p_input->>'investigationId')::uuid;
  if investigation is not null and not exists(select 1 from corpus_regulatory_workspace.investigations where investigations.id=investigation and organization_id=p_organization) then raise exception 'Investigation is not accessible' using errcode='42501'; end if;
  if p_action='investigation' then
    if coalesce(length(trim(p_input->>'title')),0) not between 1 and 200 or jsonb_typeof(p_input->'description') is distinct from 'string' or length(p_input->>'description')>10000 then raise exception 'Invalid investigation' using errcode='22023'; end if;
    select to_jsonb(x) into old from corpus_regulatory_workspace.investigations x where x.id=v_id and organization_id=p_organization for update;
    if p_input ? 'id' and old is null then raise exception 'Investigation is not accessible' using errcode='42501'; end if;
    insert into corpus_regulatory_workspace.investigations(id,organization_id,title,description,created_by) values(v_id,p_organization,p_input->>'title',p_input->>'description',p_user)
      on conflict on constraint investigations_pkey do update set title=excluded.title,description=excluded.description,updated_at=now_at where corpus_regulatory_workspace.investigations.organization_id=p_organization;
    select jsonb_build_object('id',x.id,'title',title,'description',description,'createdAt',created_at,'updatedAt',updated_at) into result from corpus_regulatory_workspace.investigations x where x.id=v_id and organization_id=p_organization;
  elsif p_action='watchlist' then
    if coalesce(length(trim(p_input->>'name')),0) not between 1 and 200 then raise exception 'Invalid watchlist name' using errcode='22023'; end if;
    perform corpus_regulatory.validate_query(p_input->'query');
    select to_jsonb(x) into old from corpus_regulatory_workspace.watchlists x where x.id=v_id and organization_id=p_organization for update;
    if p_input ? 'id' and old is null then raise exception 'Watchlist is not accessible' using errcode='42501'; end if;
    insert into corpus_regulatory_workspace.watchlists(id,organization_id,name,query,investigation_id,created_by) values(v_id,p_organization,p_input->>'name',p_input->'query',investigation,p_user)
      on conflict on constraint watchlists_pkey do update set name=excluded.name,query=excluded.query,investigation_id=excluded.investigation_id,updated_at=now_at where corpus_regulatory_workspace.watchlists.organization_id=p_organization;
    select jsonb_build_object('id',x.id,'name',name,'query',query,'investigationId',investigation_id,'createdAt',created_at,'updatedAt',updated_at) into result from corpus_regulatory_workspace.watchlists x where x.id=v_id and organization_id=p_organization;
  elsif p_action='review' then
    if p_input ? 'id' or coalesce(p_input->>'status','') not in ('triaged','relevant','dismissed','needs_evidence') or coalesce(length(trim(p_input->>'note')),0) not between 1 and 10000 then raise exception 'Append-only review with reason required' using errcode='22023'; end if;
    select * into event from corpus_regulatory.events where events.id=p_input->>'eventId';
    if not found then raise exception 'Source event is not available' using errcode='22023'; end if;
    insert into corpus_regulatory_workspace.reviews values(v_id,p_organization,event.id,p_input->>'status',p_input->>'note',investigation,p_user,now_at);
    result:=jsonb_build_object('id',v_id,'eventId',event.id,'status',p_input->>'status','note',p_input->>'note','investigationId',investigation,'reviewedBy',p_user,'createdAt',now_at,
      'source',event.source_id,'nativeId',event.native_id,'payloadSha256',event.payload_sha256,'needsReconsideration',(select payload_sha256 is distinct from event.payload_sha256 from corpus_regulatory.records where source_id=event.source_id and native_id=event.native_id));
  else
    if p_input ? 'id' or coalesce(length(trim(p_input->>'title')),0) not between 1 and 200 or jsonb_typeof(p_input->'eventIds') is distinct from 'array'
      or jsonb_array_length(p_input->'eventIds') not between 1 and 50 then raise exception 'A brief requires bounded selected evidence' using errcode='22023'; end if;
    perform corpus_regulatory.validate_query(p_input->'query');
    select count(*),jsonb_agg(corpus_regulatory.event_json(e) order by e.detected_at,e.id) into n,selected from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_input->'eventIds'));
    if n<>jsonb_array_length(p_input->'eventIds') then raise exception 'Every selected event must exist exactly once' using errcode='22023'; end if;
    manifest:=jsonb_build_object('version','regulatory-brief/1','generatedAt',now_at,'title',p_input->>'title','query',p_input->'query','events',selected,
      'sources',(select jsonb_agg(corpus_regulatory.source_json(s.id) order by s.id) from corpus_regulatory.sources s where s.id in
        (select e.source_id from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_input->'eventIds')))),
      'evidence',(select jsonb_agg(jsonb_build_object('eventId',e.id,'runId',o.run_id,'payloadSha256',o.payload_sha256,'rawSha256',o.source_sha256,
        'captureSourceUrl',o.source_url,'retrievedAt',o.retrieved_at,'recordPointer',o.provenance->>'record_pointer','parser',o.provenance->>'parser') order by e.id,o.source_url)
        from corpus_regulatory.events e join corpus_ingest.observations o on o.run_id=e.run_id and o.source_system='regulatory:'||e.source_id
          and o.entity_type='regulatory-record' and o.native_id=e.native_id and o.payload_sha256=e.payload_sha256
        where e.id in(select jsonb_array_elements_text(p_input->'eventIds'))),
      'coverageRuns',(select jsonb_agg(jsonb_build_object('id',r.id,'source',r.source_id,'mode',r.mode,'status',r.status,'startedAt',r.started_at,'finishedAt',r.finished_at,
        'windowFrom',r.window_from,'windowTo',r.window_to,'expectedCount',r.expected_count,'observedCount',r.observed_count,'errorCode',r.error_code,'scope',r.scope) order by r.started_at,r.id)
        from corpus_regulatory.runs r where r.id in(select e.run_id from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_input->'eventIds')))),
      'qualifications',jsonb_build_array('Evidence is pinned to the selected retained source versions; this document does not establish current legal status, causation or liability.',
      'Event counts and dates describe source records and observations, not injury incidence. Initial and backfilled records are explicitly labeled.',
      'Native references are source assertions; entity labels do not establish case membership or unique person/product identity.'));
    if pg_column_size(manifest)>1500000 then raise exception 'Selected brief evidence exceeds the bounded export size; select fewer events' using errcode='22023'; end if;
    digest:=corpus_ingest.canonical_integer_jsonb_sha256_v1(manifest);
    insert into corpus_regulatory_workspace.briefs values(v_id,p_organization,p_input->>'title',investigation,p_user,now_at,digest,manifest);
    result:=jsonb_build_object('id',v_id,'title',p_input->>'title','investigationId',investigation,'createdBy',p_user,'createdAt',now_at,'manifestSha256',digest,'manifest',manifest);
  end if;
  if result is null then raise exception 'Private work product could not be saved' using errcode='42501'; end if;
  insert into corpus_regulatory_workspace.change_audit(organization_id,user_id,action,record_id,previous_value,new_value) values(p_organization,p_user,p_action,v_id,old,result);
  return result;
end;
$$;

-- Defense in depth: neither browser role can access private tables or any monitor RPC.
do $$ declare t record; f record; begin
  for t in select schemaname,tablename from pg_tables where schemaname in ('corpus_regulatory','corpus_regulatory_workspace') loop
    execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
    execute format('revoke all on %I.%I from public, anon, authenticated',t.schemaname,t.tablename);
  end loop;
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('corpus_regulatory','corpus_regulatory_workspace') or (n.nspname='public' and p.proname like 'corpus_regulatory_%') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
grant usage on schema corpus_regulatory,corpus_regulatory_workspace to service_role;
revoke all on all sequences in schema corpus_regulatory_workspace from public,anon,authenticated;
comment on schema corpus_regulatory is 'Versioned regulatory source monitor. Approved source records only; no deleted injury collections, held graph promotion or inferred legal findings.';
comment on schema corpus_regulatory_workspace is 'Confidential firm work product. Server-verified provider identity plus operator-managed issuer/user membership required on every access; optional public corpus auth does not authorize this schema.';
commit;
