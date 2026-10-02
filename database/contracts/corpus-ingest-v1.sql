-- Versioned, private administrative ingestion. Existing public records stay intact.
-- Upstream CourtListener DDL is source documentation and is never applied here.
create schema if not exists corpus_ingest;
revoke all on schema corpus_ingest from public, anon, authenticated;

create table corpus_ingest.runs (
  id uuid primary key,
  contract_version text not null default 'corpus-ingest/1',
  status text not null check (status in ('running','partial','completed','failed')),
  scope jsonb not null check (jsonb_typeof(scope)='object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'
);

create table corpus_ingest.entities (
  source_system text not null,
  entity_type text not null,
  native_id text not null check (length(native_id)>0),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  provenance jsonb not null check (jsonb_typeof(provenance)='object'),
  source_as_of date,
  retrieved_at timestamptz not null,
  last_run uuid not null references corpus_ingest.runs(id),
  review_status text not null default 'source_metadata' check (review_status in ('source_metadata','reviewed','quarantined')),
  primary key (source_system,entity_type,native_id)
);

create table corpus_ingest.entity_versions (
  source_system text not null,
  entity_type text not null,
  native_id text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  storage_sha256 text not null,
  first_run uuid not null references corpus_ingest.runs(id),
  primary key (source_system,entity_type,native_id,payload_sha256)
);

create table corpus_ingest.observations (
  run_id uuid not null references corpus_ingest.runs(id),
  source_system text not null,
  entity_type text not null,
  native_id text not null,
  payload_sha256 text not null,
  source_url text not null check (source_url ~ '^https?://'),
  source_sha256 text,
  source_as_of date,
  retrieved_at timestamptz not null,
  provenance jsonb not null,
  primary key (run_id,source_system,entity_type,native_id,payload_sha256,source_url),
  foreign key (source_system,entity_type,native_id,payload_sha256)
    references corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256)
);

create table corpus_ingest.relationships (
  source_system text not null,
  from_type text not null,
  from_id text not null,
  field text not null,
  to_type text not null,
  to_id text not null,
  evidence_sha256 text not null,
  inferred boolean not null default false,
  target_present boolean not null default false,
  run_id uuid not null references corpus_ingest.runs(id),
  primary key (source_system,from_type,from_id,field,to_type,to_id,evidence_sha256),
  foreign key (source_system,from_type,from_id,evidence_sha256)
    references corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256)
);
create index relationships_target on corpus_ingest.relationships(source_system,to_type,to_id);
create index entity_observation_date on corpus_ingest.entities(entity_type,retrieved_at);

create table corpus_ingest.cleanup_decisions (
  dataset text not null,
  record_id text not null,
  issue text not null,
  disposition text not null check (disposition in ('review','canonical_alias','quarantine','label_override')),
  reason text not null,
  evidence jsonb not null,
  original_record jsonb not null,
  replacement jsonb,
  reviewed_at timestamptz not null default now(),
  run_id uuid not null references corpus_ingest.runs(id),
  primary key(dataset,record_id,issue)
);

create table corpus_ingest.category_map (
  native_category text primary key,
  canonical_category text not null,
  display_label text not null,
  mapping_basis text not null,
  version text not null default 'category-map/1'
);

alter table corpus_ingest.runs enable row level security;
alter table corpus_ingest.entities enable row level security;
alter table corpus_ingest.entity_versions enable row level security;
alter table corpus_ingest.observations enable row level security;
alter table corpus_ingest.relationships enable row level security;
alter table corpus_ingest.cleanup_decisions enable row level security;
alter table corpus_ingest.category_map enable row level security;
revoke all on all tables in schema corpus_ingest from public, anon, authenticated;
grant usage on schema corpus_ingest to service_role;
grant all on all tables in schema corpus_ingest to service_role;

create or replace function corpus_ingest.ingest_entities(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rows_received bigint; versions_inserted bigint; observations_written bigint; entities_written bigint;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'Expected at most 10000 records' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs where id=p_run and status in ('running','partial')) then
    raise exception 'Run is not open' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    where coalesce(r->>'native_id','')='' or coalesce(r->>'entity_type','')=''
      or coalesce(r->>'source_system','')='' or coalesce(r->>'schema_version','')=''
      or jsonb_typeof(r->'data') is distinct from 'object'
      or coalesce(r->'provenance'->>'record_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(r->'provenance'->>'source_url','') !~ '^https?://'
      or coalesce(r->'provenance'->>'retrieved_at','')='') then
    raise exception 'Missing native identity, source, hash, schema or retrieval provenance' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r join corpus_ingest.entity_versions v
    on v.source_system=r->>'source_system' and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id'
    and v.payload_sha256=r->'provenance'->>'record_sha256' where v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version')
    or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256' having count(distinct r->'data')>1 or count(distinct r->>'schema_version')>1) then
    raise exception 'Hash identity has conflicting source payload or schema version' using errcode='22023';
  end if;
  rows_received:=jsonb_array_length(p_rows);

  insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
  select distinct r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->>'schema_version',r->'data',encode(sha256(convert_to((r->'data')::text,'UTF8')),'hex'),p_run
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics versions_inserted=row_count;

  insert into corpus_ingest.observations(run_id,source_system,entity_type,native_id,payload_sha256,source_url,source_sha256,source_as_of,retrieved_at,provenance)
  select distinct p_run,r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->'provenance'->>'source_url',r->'provenance'->>'source_sha256',nullif(r->'provenance'->>'source_as_of','')::date,
    (r->'provenance'->>'retrieved_at')::timestamptz,r->'provenance'
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics observations_written=row_count;

  insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,provenance,source_as_of,retrieved_at,last_run)
  select distinct on (r->>'source_system',r->>'entity_type',r->>'native_id')
    r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',r->>'schema_version',r->'data',r->'provenance',
    nullif(r->'provenance'->>'source_as_of','')::date,(r->'provenance'->>'retrieved_at')::timestamptz,p_run
  from jsonb_array_elements(p_rows) r
  order by r->>'source_system',r->>'entity_type',r->>'native_id',coalesce(nullif(r->'provenance'->>'source_as_of','')::date,(r->'provenance'->>'retrieved_at')::timestamptz::date) desc,(r->'provenance'->>'retrieved_at')::timestamptz desc
  on conflict(source_system,entity_type,native_id) do update set
    payload_sha256=excluded.payload_sha256,schema_version=excluded.schema_version,data=excluded.data,
    provenance=excluded.provenance,source_as_of=excluded.source_as_of,retrieved_at=excluded.retrieved_at,last_run=excluded.last_run
  where (coalesce(excluded.source_as_of,excluded.retrieved_at::date),excluded.retrieved_at) >= (coalesce(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at::date),corpus_ingest.entities.retrieved_at);
  get diagnostics entities_written=row_count;
  return jsonb_build_object('received',rows_received,'new_versions',versions_inserted,'new_observations',observations_written,'entities_written',entities_written);
end;
$$;
revoke all on function corpus_ingest.ingest_entities(uuid,jsonb) from public,anon,authenticated;
grant execute on function corpus_ingest.ingest_entities(uuid,jsonb) to service_role;

comment on schema corpus_ingest is 'Private, source-versioned administrative corpus enrichment. Metadata is not a finding of legal applicability. No PDF bytes are acquired by this contract.';
comment on table corpus_ingest.relationships is 'Native foreign-key and explicitly source-recorded relationships. Unresolved targets remain unresolved; no name or docket-number inference.';
comment on table corpus_ingest.cleanup_decisions is 'Reversible review evidence and original rows. Identical cross-collection IDs alone never prove duplication.';
