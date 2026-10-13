-- Versioned openFDA aggregate snapshots, not individual source records. Administrative installation only.
-- Requires corpus-ingest-v1.sql and canonical-integer-jsonb-v1.sql. Existing collections remain untouched.
begin;
create schema if not exists corpus_fda_analytics;
revoke all on schema corpus_fda_analytics from public, anon, authenticated;

create table if not exists corpus_fda_analytics.snapshots (
  run_id uuid primary key references corpus_ingest.runs(id),
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz not null, data jsonb not null, storage_receipts jsonb not null,
  published_at timestamptz not null default now()
);
alter table corpus_fda_analytics.snapshots enable row level security;
revoke all on corpus_fda_analytics.snapshots from public, anon, authenticated;

create or replace function corpus_fda_analytics.has_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys
    and not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_keys)),false);
$$;
create or replace function corpus_fda_analytics.valid_count(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='number' and p_value::text ~ '^(0|[1-9][0-9]{0,15})$'
    and (p_value::text)::numeric<=9007199254740991,false);
$$;
create or replace function corpus_fda_analytics.valid_day(p_value text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  return coalesce(p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char(p_value::date,'YYYY-MM-DD')=p_value,false);
exception when others then return false;
end; $$;
create or replace function corpus_fda_analytics.valid_range(p_range jsonb,p_max_days integer default 731)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  return coalesce(corpus_fda_analytics.has_keys(p_range,array['from','to'])
    and corpus_fda_analytics.valid_day(p_range->>'from') and corpus_fda_analytics.valid_day(p_range->>'to')
    and (p_range->>'to')::date-(p_range->>'from')::date between 0 and p_max_days,false);
exception when others then return false;
end; $$;
create or replace function corpus_fda_analytics.valid_url(p_url text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(length(p_url)<=8192 and p_url ~ '^https://api[.]fda[.]gov/[a-z]+/[a-z0-9]+[.]json([?][^#]*)?$'
    and not exists(select 1 from regexp_split_to_table(split_part(p_url,'?',2),'&') q
      where q<>'' and split_part(q,'=',1) not in ('search','count','limit','skip','sort')),false);
$$;
create or replace function corpus_fda_analytics.metric_refs(p_refs jsonb,p_endpoint text,p_receipts jsonb,p_nonzero boolean)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare ref text; r jsonb; successful boolean:=false;
begin
  if jsonb_typeof(p_refs) is distinct from 'array' or jsonb_array_length(p_refs) not between 1 and 1000
    or (select count(*) from jsonb_array_elements(p_refs))<>(select count(distinct value) from jsonb_array_elements(p_refs)) then
    raise exception 'Metric requires unique capture references' using errcode='22023';
  end if;
  for ref in select jsonb_array_elements_text(p_refs) loop
    select value into r from jsonb_array_elements(p_receipts) where value->>'id'=ref;
    if r is null or split_part(r->>'url','?',1)<>p_endpoint or (r->>'httpStatus')::int not in (200,404) then
      raise exception 'Metric capture is missing, failed or bound to another endpoint' using errcode='22023';
    end if;
    successful:=successful or r->>'httpStatus'='200';
  end loop;
  if p_nonzero and not successful then raise exception 'Nonzero metric requires a successful source response' using errcode='22023'; end if;
end; $$;

create or replace function public.corpus_fda_analytics_publish_v1(p_run uuid,p_snapshot jsonb,p_payload_sha256 text,p_receipts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  d jsonb; r jsonb; proof jsonb; s jsonb; f jsonb; point jsonb; bucket jsonb;
  n numeric; actual_sha text; raw_size bigint; generated timestamptz; existing corpus_fda_analytics.snapshots; receipt_sha text;
  dataset_ids text[]:=array['food_enforcement','food_event','animalandveterinary_event','transparency_crl','tobacco_problem',
    'other_historicaldocument','other_unii','other_nsde','other_substance','device_classification','device_510k',
    'device_covid19serology','device_registrationlisting','device_enforcement','device_udi','device_event','device_recall',
    'device_pma','cosmetic_event','drug_drugsfda','drug_orangebook','drug_label','drug_enforcement','drug_event','drug_shortages','drug_ndc'];
  expected_endpoint text; family text; latest_day text; result jsonb;
begin
  if p_run is null or not corpus_fda_analytics.has_keys(p_snapshot,array['schemaVersion','runId','generatedAt','window','datasets','receipts','qualifications'])
    or p_snapshot->>'schemaVersion' is distinct from 'fda-analytics/1' or p_snapshot->>'runId' is distinct from p_run::text
    or jsonb_typeof(p_snapshot->'generatedAt') is distinct from 'string'
    or not corpus_fda_analytics.valid_range(p_snapshot->'window',36599)
    or jsonb_typeof(p_snapshot->'datasets') is distinct from 'array' or jsonb_array_length(p_snapshot->'datasets')<>26
    or jsonb_typeof(p_snapshot->'receipts') is distinct from 'array' or jsonb_array_length(p_snapshot->'receipts')>1500
    or jsonb_typeof(p_receipts) is distinct from 'array' or jsonb_array_length(p_receipts)<>jsonb_array_length(p_snapshot->'receipts')
    or jsonb_typeof(p_snapshot->'qualifications') is distinct from 'array' or jsonb_array_length(p_snapshot->'qualifications') not between 1 and 30
    or exists(select 1 from jsonb_array_elements(p_snapshot->'qualifications') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 4000) then
    raise exception 'Exact bounded FDA analytics snapshot contract required' using errcode='22023';
  end if;
  generated:=(p_snapshot->>'generatedAt')::timestamptz;
  if generated is null or generated>now()+interval '5 minutes' or (p_snapshot->'window'->>'to')::date>generated::date then raise exception 'Invalid snapshot capture date' using errcode='22023'; end if;
  actual_sha:=corpus_ingest.canonical_integer_jsonb_sha256_v1(p_snapshot);
  raw_size:=octet_length(corpus_ingest.canonical_integer_jsonb_v1(p_snapshot));
  if p_payload_sha256 is distinct from actual_sha or raw_size>12582912 then raise exception 'Exact bounded canonical snapshot hash required' using errcode='22023'; end if;
  if not exists(select 1 from storage.buckets where id='corpus-originals' and public=false)
    or not exists(select 1 from storage.objects where bucket_id='corpus-originals' and name='fda-analytics/snapshots/'||actual_sha||'.json'
      and coalesce(metadata->>'size','')=raw_size::text) then raise exception 'Private hash-readback snapshot object required' using errcode='22023'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_snapshot->'datasets') x)<>26
    or exists(select 1 from jsonb_array_elements(p_snapshot->'datasets') x where not (x->>'id')=any(dataset_ids))
    or (select count(distinct x->>'id') from jsonb_array_elements(p_snapshot->'receipts') x)<>jsonb_array_length(p_snapshot->'receipts')
    or (select count(distinct x->>'id') from jsonb_array_elements(p_receipts) x)<>jsonb_array_length(p_receipts) then
    raise exception 'Exact catalog and unique receipt identities required' using errcode='22023';
  end if;
  for r in select value from jsonb_array_elements(p_snapshot->'receipts') loop
    select value into proof from jsonb_array_elements(p_receipts) where value->>'id'=r->>'id';
    if not corpus_fda_analytics.has_keys(r,array['id','url','sha256','retrievedAt','lastUpdated','byteCount','contentType','httpStatus'])
      or not corpus_fda_analytics.has_keys(proof,array['id','storageKey','readbackSha256'])
      or not corpus_fda_analytics.valid_url(r->>'url') or r->>'sha256' !~ '^[a-f0-9]{64}$'
      or exists(select 1 from unnest(array['id','url','sha256','retrievedAt','contentType']) k where jsonb_typeof(r->k)<>'string')
      or r->>'id'<>encode(sha256(convert_to((r->>'url')||E'\n'||(r->>'sha256'),'UTF8')),'hex')
      or proof->>'storageKey'<>'fda-analytics/'||substr(r->>'sha256',1,2)||'/'||(r->>'sha256')||'.raw'
      or proof->>'readbackSha256' is distinct from r->>'sha256'
      or not corpus_fda_analytics.valid_count(r->'byteCount') or (r->>'byteCount')::bigint not between 1 and 104857600
      or r->>'contentType'<>'application/json' or not corpus_fda_analytics.valid_count(r->'httpStatus') or (r->>'httpStatus')::int not between 200 and 599
      or jsonb_typeof(r->'lastUpdated') not in ('string','null') or length(coalesce(r->>'lastUpdated',''))>100
      or (r->>'retrievedAt')::timestamptz>generated or (r->>'retrievedAt')::timestamptz is null
      or not exists(select 1 from storage.objects where bucket_id='corpus-originals' and name=proof->>'storageKey' and coalesce(metadata->>'size','')=r->>'byteCount') then
      raise exception 'Exact official API capture and private object readback required' using errcode='22023';
    end if;
  end loop;
  for d in select value from jsonb_array_elements(p_snapshot->'datasets') loop
    expected_endpoint:='https://api.fda.gov/'||regexp_replace(d->>'id','^([^_]+)_(.+)$','\1/\2')||'.json';
    family:=split_part(d->>'id','_',1); if family='animalandveterinary' then family:='animal_veterinary'; end if;
    if not corpus_fda_analytics.has_keys(d,array['id','label','endpoint','documentationUrl','productFamily','countUnit','status','statusReason','retrievedAt','sourceUpdatedAt','qualification','total','series','facets'])
      or d->>'endpoint'<>expected_endpoint or d->>'productFamily'<>family
      or d->>'documentationUrl' !~ '^https://(open[.]fda[.]gov|www[.]fda[.]gov)/[^?#]*$'
      or exists(select 1 from unnest(array['id','label','endpoint','documentationUrl','productFamily','countUnit','status','retrievedAt','qualification']) k where jsonb_typeof(d->k)<>'string' or length(d->>k) not between 1 and 4000)
      or d->>'status' not in ('ready','partial','failed','unavailable')
      or jsonb_typeof(d->'statusReason') not in ('string','null') or (d->>'status'<>'ready' and length(coalesce(d->>'statusReason',''))=0)
      or jsonb_typeof(d->'sourceUpdatedAt') not in ('string','null') or length(coalesce(d->>'sourceUpdatedAt',''))>100
      or (d->>'retrievedAt')::timestamptz>generated or (d->>'retrievedAt')::timestamptz is null
      or not corpus_fda_analytics.has_keys(d->'total',array['value','scope','receiptIds']) or d->'total'->>'scope' not in ('all_time','inventory')
      or jsonb_typeof(d->'total'->'scope') is distinct from 'string'
      or jsonb_typeof(d->'total'->'receiptIds') is distinct from 'array'
      or jsonb_typeof(d->'facets') is distinct from 'array' or jsonb_array_length(d->'facets')>80 then
      raise exception 'Invalid dataset descriptor or count semantics' using errcode='22023';
    end if;
    if d->'total'->'value'<>'null'::jsonb then
      if not corpus_fda_analytics.valid_count(d->'total'->'value') then raise exception 'Invalid total count' using errcode='22023'; end if;
      perform corpus_fda_analytics.metric_refs(d->'total'->'receiptIds',expected_endpoint,p_snapshot->'receipts',(d->'total'->>'value')::numeric>0);
    elsif jsonb_array_length(d->'total'->'receiptIds')<>0 then raise exception 'Unknown total must not claim successful metric evidence' using errcode='22023'; end if;
    if d->>'status' in ('failed','unavailable') and (d->'total'->'value'<>'null'::jsonb or d->'series'<>'null'::jsonb or jsonb_array_length(d->'facets')>0) then
      raise exception 'Unavailable dataset cannot supply numeric charts' using errcode='22023';
    end if;
    s:=d->'series';
    if s<>'null'::jsonb then
      if not corpus_fda_analytics.has_keys(s,array['dateField','dateMeaning','range','complete','completeThrough','points','matchedRecords','receiptIds','qualification'])
        or not corpus_fda_analytics.valid_range(s->'range') or s->'range'->>'from'<p_snapshot->'window'->>'from' or s->'range'->>'to'>p_snapshot->'window'->>'to'
        or exists(select 1 from unnest(array['dateField','dateMeaning','qualification']) k where jsonb_typeof(s->k)<>'string' or length(s->>k) not between 1 and 4000)
        or jsonb_typeof(s->'complete') is distinct from 'boolean' or jsonb_typeof(s->'points') is distinct from 'array' or jsonb_array_length(s->'points')>732
        or (s->'matchedRecords'<>'null'::jsonb and not corpus_fda_analytics.valid_count(s->'matchedRecords')) then raise exception 'Invalid series scope' using errcode='22023'; end if;
      n:=0; latest_day:=null;
      if (select count(distinct x->>'date') from jsonb_array_elements(s->'points') x)<>jsonb_array_length(s->'points') then raise exception 'Duplicate series day' using errcode='22023'; end if;
      for point in select value from jsonb_array_elements(s->'points') loop
        if not corpus_fda_analytics.has_keys(point,array['date','count']) or not corpus_fda_analytics.valid_day(point->>'date')
          or point->>'date'<s->'range'->>'from' or point->>'date'>s->'range'->>'to' or not corpus_fda_analytics.valid_count(point->'count') then raise exception 'Invalid series day' using errcode='22023'; end if;
        n:=n+(point->>'count')::numeric; latest_day:=greatest(latest_day,point->>'date');
      end loop;
      if n>9007199254740991 or ((s->>'complete')::boolean and (s->'matchedRecords'='null'::jsonb or n<>(s->>'matchedRecords')::numeric)) then raise exception 'Complete API enumeration must reconcile to scoped total' using errcode='22023'; end if;
      if s->'completeThrough'<>'null'::jsonb and (not corpus_fda_analytics.valid_day(s->>'completeThrough') or latest_day is null or s->>'completeThrough'>latest_day
        or s->>'completeThrough'<s->'range'->>'from' or (s->>'completeThrough')::date>=generated::date) then raise exception 'Cutoff exceeds captured source dates' using errcode='22023'; end if;
      perform corpus_fda_analytics.metric_refs(s->'receiptIds',expected_endpoint,p_snapshot->'receipts',n>0);
    end if;
    if (select count(distinct x->>'id') from jsonb_array_elements(d->'facets') x)<>jsonb_array_length(d->'facets') then raise exception 'Duplicate facet identity' using errcode='22023'; end if;
    for f in select value from jsonb_array_elements(d->'facets') loop
      if not corpus_fda_analytics.has_keys(f,array['id','label','field','countUnit','scope','buckets','denominator','denominatorLabel','multiValued','exhaustive','truncated','receiptIds','qualification'])
        or f->>'id' !~ '^[a-zA-Z0-9_.-]{1,120}$'
        or exists(select 1 from unnest(array['label','field','countUnit','denominatorLabel','qualification']) k where jsonb_typeof(f->k)<>'string' or length(f->>k) not between 1 and 4000)
        or exists(select 1 from unnest(array['multiValued','exhaustive','truncated']) k where jsonb_typeof(f->k)<>'boolean')
        or ((f->>'exhaustive')::boolean and (f->>'truncated')::boolean)
        or jsonb_typeof(f->'buckets') is distinct from 'array' or jsonb_array_length(f->'buckets')>1000
        or (f->'denominator'<>'null'::jsonb and not corpus_fda_analytics.valid_count(f->'denominator')) then raise exception 'Invalid facet semantics' using errcode='22023'; end if;
      if f->'scope'->>'kind'='window' then
        if not corpus_fda_analytics.has_keys(f->'scope',array['kind','from','to']) or not corpus_fda_analytics.valid_range((f->'scope')-'kind')
          or f->'scope'->>'from'<p_snapshot->'window'->>'from' or f->'scope'->>'to'>p_snapshot->'window'->>'to' then raise exception 'Invalid facet date window' using errcode='22023'; end if;
      elsif not corpus_fda_analytics.has_keys(f->'scope',array['kind']) or jsonb_typeof(f->'scope'->'kind') is distinct from 'string' or f->'scope'->>'kind' not in ('inventory','all_time') then raise exception 'Explicit facet scope required' using errcode='22023'; end if;
      n:=0;
      if (select count(distinct x->>'key') from jsonb_array_elements(f->'buckets') x)<>jsonb_array_length(f->'buckets') then raise exception 'Duplicate facet category' using errcode='22023'; end if;
      for bucket in select value from jsonb_array_elements(f->'buckets') loop
        if not corpus_fda_analytics.has_keys(bucket,array['key','label','count']) or jsonb_typeof(bucket->'key')<>'string' or jsonb_typeof(bucket->'label')<>'string'
          or length(bucket->>'key')>1000 or length(bucket->>'label') not between 1 and 1000 or not corpus_fda_analytics.valid_count(bucket->'count')
          or (bucket->>'key'='' and bucket->>'label'<>'(empty term in source)')
          or (f->'denominator'<>'null'::jsonb and (bucket->>'count')::numeric>(f->>'denominator')::numeric) then raise exception 'Invalid facet bucket or count above denominator' using errcode='22023'; end if;
        n:=n+(bucket->>'count')::numeric;
      end loop;
      if not (f->>'multiValued')::boolean and f->'denominator'<>'null'::jsonb and (n>(f->>'denominator')::numeric or ((f->>'exhaustive')::boolean and n<>(f->>'denominator')::numeric)) then raise exception 'Exclusive categories do not reconcile to the denominator' using errcode='22023'; end if;
      perform corpus_fda_analytics.metric_refs(f->'receiptIds',expected_endpoint,p_snapshot->'receipts',n>0);
    end loop;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('fda-analytics:'||p_run::text,0));
  select * into existing from corpus_fda_analytics.snapshots where run_id=p_run;
  if found then
    if existing.payload_sha256<>actual_sha or existing.storage_receipts<>p_receipts then raise exception 'Snapshot run identity is immutable' using errcode='22023'; end if;
  else
    insert into corpus_ingest.runs(id,contract_version,status,scope,finished_at,counts)
      values(p_run,'fda-analytics/1','completed',jsonb_build_object('kind','official_api_aggregates','window',p_snapshot->'window','payload_sha256',actual_sha),now(),jsonb_build_object('datasets',26,'receipts',jsonb_array_length(p_receipts)));
    insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
      values('fda-analytics','aggregate-snapshot',p_run::text,actual_sha,'fda-analytics/1',p_snapshot,actual_sha,p_run);
    insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,provenance,retrieved_at,last_run)
      values('fda-analytics','aggregate-snapshot',p_run::text,actual_sha,'fda-analytics/1',p_snapshot,jsonb_build_object('storage_receipts',p_receipts,'kind','official_api_aggregates'),generated,p_run);
    for r in select value from jsonb_array_elements(p_snapshot->'receipts') loop
      receipt_sha:=corpus_ingest.canonical_integer_jsonb_sha256_v1(r);
      insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
        values('fda-analytics','api-capture',r->>'id',receipt_sha,'fda-api-capture/1',r,r->>'sha256',p_run) on conflict do nothing;
      insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,provenance,retrieved_at,last_run)
        values('fda-analytics','api-capture',r->>'id',receipt_sha,'fda-api-capture/1',r,jsonb_build_object('kind','official_api_capture_metadata'),(r->>'retrievedAt')::timestamptz,p_run)
        on conflict(source_system,entity_type,native_id) do update set payload_sha256=excluded.payload_sha256,data=excluded.data,retrieved_at=excluded.retrieved_at,last_run=excluded.last_run
        where excluded.retrieved_at>=corpus_ingest.entities.retrieved_at;
      insert into corpus_ingest.observations(run_id,source_system,entity_type,native_id,payload_sha256,source_url,source_sha256,retrieved_at,provenance)
        values(p_run,'fda-analytics','api-capture',r->>'id',receipt_sha,r->>'url',r->>'sha256',(r->>'retrievedAt')::timestamptz,r);
    end loop;
    insert into corpus_fda_analytics.snapshots(run_id,payload_sha256,generated_at,data,storage_receipts) values(p_run,actual_sha,generated,p_snapshot,p_receipts);
  end if;
  result:=jsonb_build_object('runId',p_run,'payloadSha256',actual_sha,'status','completed','datasetCount',26,'receiptCount',jsonb_array_length(p_receipts));
  return result;
end; $$;

create or replace function public.corpus_fda_analytics_snapshot_v1(p_run uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('payloadSha256',s.payload_sha256,'snapshot',s.data)
  from corpus_fda_analytics.snapshots s join corpus_ingest.runs r on r.id=s.run_id and r.status='completed' and r.contract_version='fda-analytics/1'
  where p_run is null or s.run_id=p_run order by s.generated_at desc,s.published_at desc,s.run_id desc limit 1;
$$;
revoke all on all functions in schema corpus_fda_analytics from public, anon, authenticated;
revoke all on function public.corpus_fda_analytics_publish_v1(uuid,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function public.corpus_fda_analytics_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.corpus_fda_analytics_publish_v1(uuid,jsonb,text,jsonb) to service_role;
grant execute on function public.corpus_fda_analytics_snapshot_v1(uuid) to service_role;
comment on function public.corpus_fda_analytics_snapshot_v1(uuid) is 'Read-only retained openFDA aggregates. No individual case records, live publisher calls, incidence or causal claims.';
notify pgrst,'reload schema';
commit;
