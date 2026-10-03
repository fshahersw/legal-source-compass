-- Private local evidence extension. Existing HTTP-only observations are unchanged.
-- Apply only after canonical-integer-jsonb-v1.sql. All acquired records remain in
-- a separate local namespace; these records never certify a publisher-native row.
create table if not exists corpus_ingest.local_source_artifacts (
  source_system text not null check (source_system='local-sw-catalog'),
  source_file_uri text not null check (
    source_file_uri ~ '^file:///C:/Users/firas/Downloads/SW-BULK/(catalog|catalog_test)/([A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(json|jsonl|csv|parquet)$'
    and source_file_uri !~ '(^|/)\.{1,2}(/|$)'
  ),
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_bytes bigint not null check(source_bytes>=0),
  source_record_count bigint not null check(source_record_count>=0),
  registered_by_run uuid not null references corpus_ingest.runs(id),
  registered_at timestamptz not null default now(),
  primary key(source_system,source_file_uri,source_sha256)
);

create table if not exists corpus_ingest.local_observations (
  run_id uuid not null references corpus_ingest.runs(id),
  source_system text not null check(source_system='local-sw-catalog'),
  entity_type text not null,
  native_id text not null,
  payload_sha256 text not null,
  source_file_uri text not null,
  source_sha256 text not null,
  source_record_ordinal bigint not null check(source_record_ordinal>0),
  source_original_record_sha256 text not null check(source_original_record_sha256 ~ '^[a-f0-9]{64}$'),
  local_snapshot_as_of date,
  observed_at timestamptz not null,
  provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  primary key(run_id,source_system,entity_type,native_id,payload_sha256,source_file_uri,source_sha256,source_record_ordinal),
  foreign key(source_system,entity_type,native_id,payload_sha256)
    references corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256),
  foreign key(source_system,source_file_uri,source_sha256)
    references corpus_ingest.local_source_artifacts(source_system,source_file_uri,source_sha256)
);

alter table corpus_ingest.local_source_artifacts enable row level security;
alter table corpus_ingest.local_observations enable row level security;
revoke all on corpus_ingest.local_source_artifacts,corpus_ingest.local_observations from public,anon,authenticated;
grant all on corpus_ingest.local_source_artifacts,corpus_ingest.local_observations to service_role;

create or replace function corpus_ingest.ingest_local_catalog_entities_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $local_catalog_ingest_v1$
declare rows_received bigint; versions_inserted bigint; observations_written bigint; entities_written bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'Expected at most 10000 local catalog records' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs where id=p_run and status in ('running','partial')
    and scope->>'source_system'='local-sw-catalog') then
    raise exception 'Local catalog run is not open or correctly qualified' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    left join corpus_ingest.local_source_artifacts a
      on a.source_system=r->>'source_system' and a.source_file_uri=r->'provenance'->>'source_file_uri'
      and a.source_sha256=r->'provenance'->>'source_sha256'
    where r->>'source_system' is distinct from 'local-sw-catalog'
      or r->>'schema_version' is distinct from 'local-sw-catalog-evidence/1'
      or coalesce(r->>'native_id','')='' or length(r->>'native_id')>512
      or coalesce(r->>'entity_type','') !~ '^[a-z][a-z0-9-]{0,80}$'
      or jsonb_typeof(r->'data') is distinct from 'object'
      or r->'data'->>'local_id' is distinct from r->>'native_id'
      or r->'data'->'publisher_native_entity' is distinct from 'false'::jsonb
      or r->'provenance' ? 'source_url'
      or r->'provenance'->'http_status' is distinct from 'null'::jsonb
      or r->'provenance'->>'retrieved_at_basis' is distinct from 'local_file_read_timestamp_not_upstream_retrieval'
      or r->'provenance'->>'schema_version' is distinct from r->>'schema_version'
      or r->'provenance'->>'observed_at' is distinct from r->'provenance'->>'retrieved_at'
      or r->'provenance'->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or coalesce(r->'provenance'->>'record_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->'provenance'->>'source_original_record_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->'provenance'->>'source_record_ordinal','') !~ '^[1-9][0-9]{0,14}$'
      or coalesce(r->'provenance'->>'observed_at','')=''
      or a.source_file_uri is null) then
    raise exception 'Invalid local identity, codec, registered artifact, ordinal or observation provenance' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    join corpus_ingest.local_source_artifacts a
      on a.source_system=r->>'source_system' and a.source_file_uri=r->'provenance'->>'source_file_uri'
      and a.source_sha256=r->'provenance'->>'source_sha256'
    where (r->'provenance'->>'source_record_ordinal')::bigint>a.source_record_count
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data')<>r->'provenance'->>'record_sha256'
      or r->'data'->>'source_original_record_sha256' is distinct from r->'provenance'->>'source_original_record_sha256') then
    raise exception 'Local payload hash, original-row hash or registered ordinal mismatch' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r join corpus_ingest.entity_versions v
    on v.source_system=r->>'source_system' and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id'
    and v.payload_sha256=r->'provenance'->>'record_sha256'
    where v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version') then
    raise exception 'Local version hash conflicts with retained payload or schema' using errcode='22023';
  end if;
  rows_received:=jsonb_array_length(p_rows);
  insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
  select distinct r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->>'schema_version',r->'data',encode(sha256(convert_to((r->'data')::text,'UTF8')),'hex'),p_run
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics versions_inserted=row_count;
  insert into corpus_ingest.local_observations(run_id,source_system,entity_type,native_id,payload_sha256,
    source_file_uri,source_sha256,source_record_ordinal,source_original_record_sha256,local_snapshot_as_of,observed_at,provenance)
  select distinct p_run,r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->'provenance'->>'source_file_uri',r->'provenance'->>'source_sha256',(r->'provenance'->>'source_record_ordinal')::bigint,
    r->'provenance'->>'source_original_record_sha256',nullif(r->'provenance'->>'local_snapshot_as_of','')::date,
    (r->'provenance'->>'observed_at')::timestamptz,r->'provenance'
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics observations_written=row_count;
  insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,
    provenance,source_as_of,retrieved_at,last_run)
  select distinct on (r->>'source_system',r->>'entity_type',r->>'native_id')
    r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',r->>'schema_version',r->'data',r->'provenance',
    nullif(r->'provenance'->>'local_snapshot_as_of','')::date,(r->'provenance'->>'observed_at')::timestamptz,p_run
  from jsonb_array_elements(p_rows) r
  order by r->>'source_system',r->>'entity_type',r->>'native_id',
    coalesce(nullif(r->'provenance'->>'local_snapshot_as_of','')::date,(r->'provenance'->>'observed_at')::timestamptz::date) desc,
    (r->'provenance'->>'observed_at')::timestamptz desc,r->'provenance'->>'record_sha256'
  -- Preserve existing review_status, including quarantined dispositions.
  on conflict(source_system,entity_type,native_id) do update set
    payload_sha256=excluded.payload_sha256,schema_version=excluded.schema_version,data=excluded.data,provenance=excluded.provenance,
    source_as_of=excluded.source_as_of,retrieved_at=excluded.retrieved_at,last_run=excluded.last_run
  where (coalesce(excluded.source_as_of,excluded.retrieved_at::date),excluded.retrieved_at)>
        (coalesce(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at::date),corpus_ingest.entities.retrieved_at)
    or ((coalesce(excluded.source_as_of,excluded.retrieved_at::date),excluded.retrieved_at)=
        (coalesce(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at::date),corpus_ingest.entities.retrieved_at)
        and excluded.payload_sha256<corpus_ingest.entities.payload_sha256);
  get diagnostics entities_written=row_count;
  return jsonb_build_object('received',rows_received,'new_versions',versions_inserted,
    'new_local_observations',observations_written,'entities_written',entities_written,'publisher_native_entities_written',0);
end;
$local_catalog_ingest_v1$;
revoke all on function corpus_ingest.ingest_local_catalog_entities_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function corpus_ingest.ingest_local_catalog_entities_v1(uuid,jsonb) to service_role;
comment on table corpus_ingest.local_observations is
  'Private local file occurrences. Observed timestamp is this local read; snapshot claims and extracted or heuristic relationships are not current publisher-native evidence.';
