-- Aggregate acknowledgement proof for fixed, idempotent administrative intakes.
-- Read-only and server-role-only. No retained payload is returned.
create or replace function public.corpus_admin_intake_status_v1(p_run uuid,p_mode text,p_rows jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $admin_status_v1$
declare namespace text; result jsonb;
begin
 namespace:=case p_mode when 'openfda' then 'openfda' when 'local-catalog' then 'local-sw-catalog'
  when 'local-statute' then 'local-vaquill-open-us-law' when 'local-registry' then 'local-source-registry' end;
 if namespace is null or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 10000 or octet_length(p_rows::text)>2097152
  or not exists(select 1 from corpus_ingest.runs r where r.id=p_run and r.scope->>'source_system'=namespace)
  or exists(select 1 from jsonb_array_elements(p_rows) r where r->>'source_system' is distinct from namespace) then
  raise exception 'Invalid acknowledgement scope' using errcode='22023';
 end if;
 with expected as(select r from jsonb_array_elements(p_rows)r), proof as(select r,
  exists(select 1 from corpus_ingest.entity_versions v where v.source_system=namespace
   and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id'
   and v.payload_sha256=r->'provenance'->>'record_sha256'
   and v.schema_version=r->>'schema_version' and v.data=r->'data'
   and v.storage_sha256=encode(sha256(convert_to(v.data::text,'UTF8')),'hex')) version_matches,
  case when p_mode='openfda' then exists(select 1 from corpus_ingest.observations o
   where o.run_id=p_run and o.source_system=namespace and o.entity_type=r->>'entity_type'
    and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256'
    and o.source_url=r->'provenance'->>'source_url' and o.source_sha256=r->'provenance'->>'source_sha256'
    and o.source_as_of is not distinct from nullif(r->'provenance'->>'source_as_of','')::date
    and o.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz
    and o.provenance=r->'provenance')
  else exists(select 1 from corpus_ingest.local_observations o where o.run_id=p_run and o.source_system=namespace
   and o.entity_type=r->>'entity_type' and o.native_id=r->>'native_id'
   and o.payload_sha256=r->'provenance'->>'record_sha256'
   and o.source_file_uri=r->'provenance'->>'source_file_uri'
   and o.source_sha256=r->'provenance'->>'source_sha256'
   and o.source_record_ordinal::text=r->'provenance'->>'source_record_ordinal'
   and o.source_original_record_sha256=r->'provenance'->>'source_original_record_sha256'
   and o.local_snapshot_as_of is not distinct from nullif(r->'provenance'->>'local_snapshot_as_of','')::date
   and o.observed_at=(r->'provenance'->>'observed_at')::timestamptz
   and o.provenance=r->'provenance')end observation_matches,
  exists(select 1 from corpus_ingest.entity_versions v where v.source_system=namespace
   and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id'
   and v.payload_sha256=r->'provenance'->>'record_sha256'
   and (v.schema_version is distinct from r->>'schema_version' or v.data is distinct from r->'data'
    or v.storage_sha256 is distinct from encode(sha256(convert_to(v.data::text,'UTF8')),'hex')))
  or case when p_mode='openfda' then exists(select 1 from corpus_ingest.observations o
   where o.run_id=p_run and o.source_system=namespace and o.entity_type=r->>'entity_type'
    and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256'
    and o.source_url=r->'provenance'->>'source_url'
    and (o.source_sha256 is distinct from r->'provenance'->>'source_sha256'
     or o.source_as_of is distinct from nullif(r->'provenance'->>'source_as_of','')::date
     or o.retrieved_at is distinct from (r->'provenance'->>'retrieved_at')::timestamptz
     or o.provenance is distinct from r->'provenance'))
  else exists(select 1 from corpus_ingest.local_observations o where o.run_id=p_run and o.source_system=namespace
   and o.entity_type=r->>'entity_type' and o.native_id=r->>'native_id'
   and o.payload_sha256=r->'provenance'->>'record_sha256'
   and o.source_file_uri=r->'provenance'->>'source_file_uri'
   and o.source_sha256=r->'provenance'->>'source_sha256'
   and o.source_record_ordinal::text=r->'provenance'->>'source_record_ordinal'
   and (o.source_original_record_sha256 is distinct from r->'provenance'->>'source_original_record_sha256'
    or o.local_snapshot_as_of is distinct from nullif(r->'provenance'->>'local_snapshot_as_of','')::date
    or o.observed_at is distinct from (r->'provenance'->>'observed_at')::timestamptz
    or o.provenance is distinct from r->'provenance'))end conflict
 from expected)
 select jsonb_build_object('expected',count(*),'matched',count(*)filter(where version_matches and observation_matches),
  'conflicts',count(*)filter(where conflict))into result from proof;
 return result;
end;
$admin_status_v1$;
revoke all on function public.corpus_admin_intake_status_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_intake_status_v1(uuid,text,jsonb) to service_role;
