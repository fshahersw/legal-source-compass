-- Prepared additive contract; not a deployed migration. The release owner applies it.
-- Requires corpus-ingest-v1 and canonical-integer-jsonb-v1 (both already deployed).
--
-- Versioned, resumable intake of Federal Register API documents into the private
-- corpus_ingest contract. Entity shape: source_system 'federalregister',
-- entity_type 'documents', native_id = publisher document number,
-- schema_version 'federal-register-metadata/2' (a strict superset of the
-- 'federal-register-metadata/1' fields behind regulatory_backfill).
--
-- Existing federalregister entities (schema /1) are never overwritten: a /2
-- payload is retained as a new entity_version plus observation, and the current
-- entity row is only advanced by a newer observation of the same schema version.
-- Nothing here writes public.corpus_records; projection stays a separate,
-- reconciled step. No PDF bytes are acquired.
begin;

create or replace function public.corpus_federal_register_open_run_v1(p_run uuid, p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fr_open$
declare existing jsonb;
begin
  if p_run is null or jsonb_typeof(p_scope) is distinct from 'object'
    or p_scope->>'source_system' is distinct from 'federalregister'
    or p_scope->>'contract' is distinct from 'federal-register-intake/1'
    or p_scope->>'schema_version' is distinct from 'federal-register-metadata/2'
    or p_scope->>'source_name' is distinct from 'FederalRegister.gov API v1'
    or coalesce(p_scope->>'publication_from','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'publication_through','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_scope->>'publication_from')::date > (p_scope->>'publication_through')::date
    or p_scope->'private_only' is distinct from 'true'::jsonb then
    raise exception 'Invalid Federal Register run scope' using errcode='22023';
  end if;
  select scope into existing from corpus_ingest.runs where id=p_run;
  if existing is not null and existing is distinct from p_scope then
    raise exception 'Run already exists with a different scope' using errcode='22023';
  end if;
  insert into corpus_ingest.runs(id,status,scope) values (p_run,'running',p_scope) on conflict(id) do nothing;
  return (select jsonb_build_object('run_id',r.id,'status',r.status,'scope',r.scope) from corpus_ingest.runs r where r.id=p_run);
end;
$fr_open$;

create or replace function public.corpus_federal_register_intake_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fr_intake$
declare s jsonb; rows_received bigint; versions_inserted bigint; observations_written bigint; entities_written bigint;
begin
  select scope into s from corpus_ingest.runs
    where id=p_run and status in ('running','partial') and scope->>'contract'='federal-register-intake/1' for share;
  if s is null or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 10000 or octet_length(p_rows::text)>2097152 then
    raise exception 'Open Federal Register run and bounded rows required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
      r->>'source_system' is distinct from 'federalregister'
      or r->>'entity_type' is distinct from 'documents'
      or r->>'schema_version' is distinct from 'federal-register-metadata/2'
      or jsonb_typeof(r->'data') is distinct from 'object'
      or jsonb_typeof(r->'provenance') is distinct from 'object'
      or length(coalesce(r->>'native_id','')) not between 1 and 64
      or r->>'native_id' is distinct from r->'data'->>'document_number'
      or coalesce(r->'data'->>'publication_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (r->'data'->>'publication_date')::date not between (s->>'publication_from')::date and (s->>'publication_through')::date
      or r->'provenance'->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data') is distinct from r->'provenance'->>'record_sha256'
      or coalesce(r->'provenance'->>'source_url','') !~ '^https://www\.federalregister\.gov/api/v1/'
      or coalesce(r->'provenance'->>'source_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(r->'provenance'->>'retrieved_at','')=''
      or coalesce(r->'provenance'->>'source_as_of','') !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'Invalid Federal Register identity, schema, canonical payload or provenance' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r join corpus_ingest.entity_versions v
      on v.source_system='federalregister' and v.entity_type='documents' and v.native_id=r->>'native_id'
     and v.payload_sha256=r->'provenance'->>'record_sha256'
     where v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version')
    or exists(select 1 from jsonb_array_elements(p_rows) r
      group by r->>'native_id',r->'provenance'->>'record_sha256' having count(distinct r->'data')>1) then
    raise exception 'Hash identity has conflicting source payload or schema version' using errcode='22023';
  end if;
  rows_received:=jsonb_array_length(p_rows);

  insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
  select distinct 'federalregister','documents',r->>'native_id',r->'provenance'->>'record_sha256',
    r->>'schema_version',r->'data',encode(sha256(convert_to((r->'data')::text,'UTF8')),'hex'),p_run
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics versions_inserted=row_count;

  insert into corpus_ingest.observations(run_id,source_system,entity_type,native_id,payload_sha256,source_url,source_sha256,source_as_of,retrieved_at,provenance)
  select distinct p_run,'federalregister','documents',r->>'native_id',r->'provenance'->>'record_sha256',
    r->'provenance'->>'source_url',r->'provenance'->>'source_sha256',(r->'provenance'->>'source_as_of')::date,
    (r->'provenance'->>'retrieved_at')::timestamptz,r->'provenance'
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics observations_written=row_count;

  insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,provenance,source_as_of,retrieved_at,last_run)
  select distinct on (r->>'native_id') 'federalregister','documents',r->>'native_id',r->'provenance'->>'record_sha256',
    r->>'schema_version',r->'data',r->'provenance',(r->'provenance'->>'source_as_of')::date,
    (r->'provenance'->>'retrieved_at')::timestamptz,p_run
  from jsonb_array_elements(p_rows) r
  order by r->>'native_id',(r->'provenance'->>'source_as_of')::date desc,(r->'provenance'->>'retrieved_at')::timestamptz desc
  on conflict(source_system,entity_type,native_id) do update set
    payload_sha256=excluded.payload_sha256,data=excluded.data,provenance=excluded.provenance,
    source_as_of=excluded.source_as_of,retrieved_at=excluded.retrieved_at,last_run=excluded.last_run
  where corpus_ingest.entities.schema_version=excluded.schema_version
    and (excluded.source_as_of,excluded.retrieved_at)>=(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at);
  get diagnostics entities_written=row_count;
  return jsonb_build_object('received',rows_received,'new_versions',versions_inserted,
    'new_observations',observations_written,'entities_written',entities_written);
end;
$fr_intake$;

-- Read-only aggregate proof that exactly these rows are stored: version payload,
-- schema, storage checksum, and this run's observation provenance.
create or replace function public.corpus_federal_register_status_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fr_status$
declare expected_rows bigint; versions_matched bigint; observations_matched bigint; conflicts bigint;
begin
  if not exists(select 1 from corpus_ingest.runs where id=p_run and scope->>'contract'='federal-register-intake/1')
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 10000
    or octet_length(p_rows::text)>2097152 then
    raise exception 'Invalid acknowledgement scope' using errcode='22023';
  end if;
  expected_rows:=jsonb_array_length(p_rows);
  select count(*) into versions_matched from jsonb_array_elements(p_rows) r where exists(
    select 1 from corpus_ingest.entity_versions v where v.source_system='federalregister' and v.entity_type='documents'
      and v.native_id=r->>'native_id' and v.payload_sha256=r->'provenance'->>'record_sha256'
      and v.schema_version=r->>'schema_version' and v.data=r->'data'
      and v.storage_sha256=encode(sha256(convert_to(v.data::text,'UTF8')),'hex'));
  select count(*) into observations_matched from jsonb_array_elements(p_rows) r where exists(
    select 1 from corpus_ingest.observations o where o.run_id=p_run and o.source_system='federalregister'
      and o.entity_type='documents' and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256'
      and o.source_url=r->'provenance'->>'source_url' and o.source_sha256=r->'provenance'->>'source_sha256'
      and o.source_as_of=(r->'provenance'->>'source_as_of')::date
      and o.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz and o.provenance=r->'provenance');
  select count(*) into conflicts from jsonb_array_elements(p_rows) r where exists(
    select 1 from corpus_ingest.entity_versions v where v.source_system='federalregister' and v.entity_type='documents'
      and v.native_id=r->>'native_id' and v.payload_sha256=r->'provenance'->>'record_sha256'
      and (v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version'));
  return jsonb_build_object('expected',expected_rows,'versions_matched',versions_matched,
    'observations_matched',observations_matched,'conflicts',conflicts);
end;
$fr_status$;

create or replace function public.corpus_federal_register_finish_run_v1(p_run uuid, p_status text, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fr_finish$
begin
  if p_status not in ('partial','completed','failed') or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Invalid run closure' using errcode='22023';
  end if;
  update corpus_ingest.runs set status=p_status,finished_at=now(),counts=p_counts
    where id=p_run and status in ('running','partial') and scope->>'contract'='federal-register-intake/1';
  if not found then raise exception 'Open Federal Register run required' using errcode='22023'; end if;
  return (select jsonb_build_object('run_id',r.id,'status',r.status,'counts',r.counts) from corpus_ingest.runs r where r.id=p_run);
end;
$fr_finish$;

-- Continuation checkpoint: the most recent Federal Register runs and their scopes.
create or replace function public.corpus_federal_register_checkpoint_v1()
returns jsonb language sql stable security definer set search_path='' as $fr_checkpoint$
  select coalesce(jsonb_agg(jsonb_build_object('run_id',id,'status',status,'started_at',started_at,
    'finished_at',finished_at,'scope',scope,'counts',counts) order by started_at desc),'[]'::jsonb)
  from (select * from corpus_ingest.runs where scope->>'contract'='federal-register-intake/1'
        order by started_at desc limit 50) x;
$fr_checkpoint$;

revoke all on function public.corpus_federal_register_open_run_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_federal_register_intake_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_federal_register_status_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_federal_register_finish_run_v1(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_federal_register_checkpoint_v1() from public,anon,authenticated;
grant execute on function public.corpus_federal_register_open_run_v1(uuid,jsonb) to service_role;
grant execute on function public.corpus_federal_register_intake_v1(uuid,jsonb) to service_role;
grant execute on function public.corpus_federal_register_status_v1(uuid,jsonb) to service_role;
grant execute on function public.corpus_federal_register_finish_run_v1(uuid,text,jsonb) to service_role;
grant execute on function public.corpus_federal_register_checkpoint_v1() to service_role;

comment on function public.corpus_federal_register_intake_v1(uuid,jsonb) is
  'Server-role-only intake of Federal Register API documents into corpus_ingest (schema federal-register-metadata/2). Idempotent; never overwrites a different schema version''s current entity; no public projection; no PDF bytes.';

notify pgrst, 'reload schema';
commit;
