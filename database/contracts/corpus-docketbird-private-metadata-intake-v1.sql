-- Narrow private intake for captured case headers and local source observations.
-- Search, sheet and coverage identifiers are expressly not publisher entity IDs.
-- Original captures retain omitted source fields; no PDF locator values or bytes.
create or replace function corpus_ingest.validate_docketbird_metadata_v1(p_run uuid,p_rows jsonb,p_open boolean)
returns void language plpgsql stable security invoker set search_path='' as $metadata_validate$
declare r jsonb; s jsonb; spec jsonb; kind text; expected_tool text; publisher boolean; d jsonb; p jsonb; c jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_open is null or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>1048576 then raise exception 'Bounded service-only metadata required'; end if;
 select scope into s from corpus_ingest.runs where id=p_run and (status in ('running','partial') or (not p_open and status='completed'));
 if s is null or s->>'source_system' is distinct from 'docketbird-mcp'
  or s->>'purpose' is distinct from 'seeger-weiss-source-qualified-recent-metadata-observations'
  or s->>'schema_version' is distinct from 'seeger-weiss-docketbird-recent-metadata/1'
  or s->>'intake_normalizer_version' is distinct from 'docketbird-private-metadata-observation/1'
  or coalesce(s->>'source_manifest_sha256','') !~ '^[a-f0-9]{64}$'
  or s->'private_only' is distinct from 'true'::jsonb or s->'public_projection_allowed' is distinct from 'false'::jsonb
  or s->'publisher_native_cross_provider_merge_allowed' is distinct from 'false'::jsonb
  or s->'native_relationship_writes_expected' is distinct from '0'::jsonb
  or jsonb_typeof(s->'expected_types') is distinct from 'object' then raise exception 'Exact private metadata run scope required'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'entity_type',x->>'native_id' having count(*)<>1) then raise exception 'Duplicate metadata identities'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  d:=r->'data'; p:=r->'provenance'; c:=p->'source_capture'; kind:=r->>'entity_type'; spec:=s->'expected_types'->kind;
  case kind
   when 'case_metadata' then expected_tool:='get_case'; publisher:=true;
   when 'docket_sheet_observation' then expected_tool:='get_docket_sheet'; publisher:=false;
   when 'search_reference_observation' then expected_tool:='search_cases'; publisher:=false;
   when 'docket_sheet_coverage_observation' then expected_tool:='captured_sheet_metadata_coverage'; publisher:=false;
   else raise exception 'Unsupported metadata grain';
  end case;
  if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(c) is distinct from 'object'
   or jsonb_typeof(spec) is distinct from 'object' or r->>'source_system' is distinct from 'docketbird-mcp'
   or r->>'schema_version' is distinct from 'seeger-weiss-docketbird-recent-metadata/1'
   or coalesce(r->>'native_id','')='' or length(r->>'native_id')>512
   or d->'publisher_native_entity' is distinct from to_jsonb(publisher)
   or d->'publisher_native_cross_provider_merge_allowed' is distinct from 'false'::jsonb
   or d->'public_projection_allowed' is distinct from 'false'::jsonb
   or p->'public_projection_allowed' is distinct from 'false'::jsonb
   or p->>'source_url' is distinct from 'https://mcp.docketbird.com/mcp' or p->>'request_method' is distinct from 'POST'
   or p->'http_status' is distinct from '200'::jsonb or p->>'source_tool' is distinct from expected_tool
   or coalesce(p->>'source_sha256','') !~ '^[a-f0-9]{64}$'
   or p->>'record_sha256_codec' is distinct from 'canonical-integer-jsonb/1'
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(d) is distinct from p->>'record_sha256'
   or p->>'source_manifest_sha256' is distinct from s->>'source_manifest_sha256'
   or p->>'collector_plan_sha256' is distinct from s->>'collector_plan_sha256'
   or p->>'collector_runtime_sha256' is distinct from s->>'collector_runtime_sha256'
   or p->>'intake_normalizer_version' is distinct from s->>'intake_normalizer_version'
   or p->>'source_input_file_sha256' is distinct from spec->>'input_sha256'
   or p->'source_input_file_bytes' is distinct from spec->'input_bytes'
   or jsonb_typeof(p->'source_input_record_ordinal') is distinct from 'number'
   or coalesce(p->>'source_input_record_ordinal','') !~ '^[1-9][0-9]{0,8}$'
   or (p->>'source_input_record_ordinal')::bigint>(spec->>'expected_observations')::bigint
   or coalesce(p->>'source_input_record_sha256','') !~ '^[a-f0-9]{64}$'
   or p->>'source_input_record_sha256_codec' is distinct from 'utf8-jsonl-record-without-LF/1'
   or c->>'source_url' is distinct from p->>'source_url' or c->>'response_sha256' is distinct from p->>'source_sha256'
   or c->>'retrieved_at' is distinct from p->>'retrieved_at' or coalesce(p->>'retrieved_at','')=''
   or c->'response_bytes' is distinct from p->'source_response_bytes' or c->'publisher_wire_bytes_asserted' is distinct from 'false'::jsonb
   or coalesce(c->>'capture_file_sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p->'source_scope') is distinct from 'array' or jsonb_array_length(p->'source_scope')=0
   or jsonb_path_exists(r,'$.**.pdf_url') or jsonb_path_exists(r,'$.**.download_url')
   or exists(select 1 from jsonb_path_query(r,'$.** ? (@.type() == "string")') v where v #>> '{}' ~* '^https?://[^[:space:]]*[?&](user[_-]?id|(?:access[_-]?)?token|signature|api[_-]?key|awsaccesskeyid|expires|x-goog-signature|x-amz-[^=]+)=') then raise exception 'Native metadata/private source qualification mismatch'; end if;
  if kind='case_metadata' then
   if r->>'native_id' is distinct from d->>'native_case_id' or coalesce(d->>'source_court_id','')=''
    or left(r->>'native_id',length(d->>'source_court_id')+1) is distinct from (d->>'source_court_id')||'-'
    or d->'firm_current_participation_verified' is distinct from 'false'::jsonb
    or jsonb_typeof(d->'original_fields_available_in_private_capture') is distinct from 'array'
    or (d->'source_complaint_document_id' is distinct from 'null'::jsonb and (jsonb_typeof(d->'source_complaint_document_id') is distinct from 'string' or left(d->>'source_complaint_document_id',length(d->>'native_case_id')+1) is distinct from (d->>'native_case_id')||'-')) then raise exception 'Native case header mismatch'; end if;
  elsif kind='docket_sheet_observation' then
   if r->>'native_id' is distinct from 'source-capture:'||(c->>'capture_file_sha256')
    or coalesce(d->>'native_case_id','')='' or coalesce(d->>'source_sort','') not in ('recent','chronological')
    or d->>'source_observation_kind' is distinct from 'captured_provider_sheet_end_view'
    or jsonb_typeof(d->'source_entries_total') is distinct from 'number' or coalesce(d->>'source_entries_total','') !~ '^[0-9]{1,9}$'
    or jsonb_typeof(d->'native_document_ids') is distinct from 'array'
    or d->'source_entries_returned' is distinct from to_jsonb(jsonb_array_length(d->'native_document_ids'))
    or exists(select 1 from jsonb_array_elements(d->'native_document_ids') x where jsonb_typeof(x) is distinct from 'string' or left(x #>> '{}',length(d->>'native_case_id')+1) is distinct from (d->>'native_case_id')||'-') then raise exception 'Sheet source observation mismatch'; end if;
  elsif kind='search_reference_observation' then
   if r->>'native_id' is distinct from 'source-capture:'||(c->>'capture_file_sha256')
    or jsonb_typeof(d->'provider_case_ids') is distinct from 'array'
    or jsonb_typeof(d->'provider_search_complete') is distinct from 'boolean'
    or jsonb_typeof(d->'definitive_association_allowed') is distinct from 'boolean'
    or d->'firm_current_participation_verified' is distinct from 'false'::jsonb
    or (d->'definitive_association_allowed'='true'::jsonb and (d->'provider_search_complete' is distinct from 'true'::jsonb or d->>'match_resolution' is distinct from 'unique_exact_reference' or jsonb_array_length(d->'provider_case_ids')<>1)) then raise exception 'Search source observation mismatch'; end if;
  else
   if r->>'native_id' is distinct from 'source-coverage:'||(p->>'source_input_record_canonical_sha256')
    or coalesce(p->>'source_input_record_canonical_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(d->>'native_case_id','')='' or d->>'source_observation_kind' is distinct from 'source_qualified_provider_sheet_metadata_coverage'
    or jsonb_typeof(d->'source_provider_metadata_complete') is distinct from 'boolean'
    or d->'court_docket_completeness_verified' is distinct from 'false'::jsonb or d->'pdf_body_completeness_verified' is distinct from 'false'::jsonb
    or corpus_ingest.canonical_integer_jsonb_sha256_v1(p->'coverage_source_evidence') is distinct from p->>'source_input_record_canonical_sha256' then raise exception 'Qualified coverage observation mismatch'; end if;
  end if;
 end loop;
end $metadata_validate$;
revoke all on function corpus_ingest.validate_docketbird_metadata_v1(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function corpus_ingest.validate_docketbird_metadata_v1(uuid,jsonb,boolean) to service_role;

create or replace function public.corpus_admin_docketbird_metadata_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $metadata_intake$
begin
 perform corpus_ingest.validate_docketbird_metadata_v1(p_run,p_rows,true);
 return corpus_ingest.ingest_entities(p_run,p_rows)||jsonb_build_object('private_only',true,'publisher_native_entities_released',0);
end $metadata_intake$;
revoke all on function public.corpus_admin_docketbird_metadata_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_metadata_v1(uuid,jsonb) to service_role;

create or replace function public.corpus_admin_docketbird_metadata_status_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $metadata_status$
declare result jsonb;
begin
 perform corpus_ingest.validate_docketbird_metadata_v1(p_run,p_rows,false);
 with expected as (select value r from jsonb_array_elements(p_rows)), checks as (
  select r,v.native_id is not null as version_present,o.native_id is not null as observation_present,e.native_id is not null as entity_present,
   v.data is not distinct from r->'data' and v.schema_version=r->>'schema_version' and v.payload_sha256=r->'provenance'->>'record_sha256'
    and v.storage_sha256=encode(sha256(convert_to(v.data::text,'UTF8')),'hex') and corpus_ingest.canonical_integer_jsonb_sha256_v1(v.data)=v.payload_sha256 as version_exact,
   o.source_sha256 is not distinct from r->'provenance'->>'source_sha256' and o.source_as_of is null and o.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz and o.provenance is not distinct from r->'provenance' as observation_exact,
   e.data is not distinct from r->'data' and e.schema_version=r->>'schema_version' and e.payload_sha256=r->'provenance'->>'record_sha256' and e.provenance is not distinct from r->'provenance' and e.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz and e.source_as_of is null and e.last_run=p_run as entity_exact
  from expected left join corpus_ingest.entity_versions v on v.source_system=r->>'source_system' and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id' and v.payload_sha256=r->'provenance'->>'record_sha256'
  left join corpus_ingest.observations o on o.run_id=p_run and o.source_system=r->>'source_system' and o.entity_type=r->>'entity_type' and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256' and o.source_url=r->'provenance'->>'source_url'
  left join corpus_ingest.entities e on e.source_system=r->>'source_system' and e.entity_type=r->>'entity_type' and e.native_id=r->>'native_id'
 ) select jsonb_build_object('run_id',p_run,'expected',count(*),'versions_present',count(*) filter(where version_present),'versions_exact',count(*) filter(where version_exact),'observations_present',count(*) filter(where observation_present),'observations_exact',count(*) filter(where observation_exact),'entities_present',count(*) filter(where entity_present),'current_entities_exact',count(*) filter(where entity_exact),
  'matched',count(*) filter(where version_exact and observation_exact and entity_exact),'conflicts',count(*) filter(where (version_present and version_exact is not true) or (observation_present and observation_exact is not true) or (entity_present and entity_exact is not true)),
  'expected_payload_provenance_sha256',encode(sha256(convert_to(string_agg((r->>'entity_type')||E'\t'||(r->>'native_id')||E'\t'||(r->'provenance'->>'record_sha256')||E'\t'||corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'provenance')||E'\n','' order by (r->>'entity_type') collate "C",(r->>'native_id') collate "C"),'UTF8')),'hex'),
  'private_only',true,'read_only',true) into result from checks;
 return result;
end $metadata_status$;
revoke all on function public.corpus_admin_docketbird_metadata_status_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_metadata_status_v1(uuid,jsonb) to service_role;

-- Global proof complements bounded exact full-data/full-provenance comparisons.
create or replace function public.corpus_admin_docketbird_metadata_global_proof_v1(p_run uuid,p_manifest_sha256 text,p_expected_types jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $metadata_global$
declare s jsonb; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service-only private proof required'; end if;
 select scope into s from corpus_ingest.runs where id=p_run and status in ('running','partial','completed');
 if s is null or s->>'purpose' is distinct from 'seeger-weiss-source-qualified-recent-metadata-observations'
  or s->>'source_system' is distinct from 'docketbird-mcp' or s->>'schema_version' is distinct from 'seeger-weiss-docketbird-recent-metadata/1'
  or s->>'intake_normalizer_version' is distinct from 'docketbird-private-metadata-observation/1'
  or s->>'source_manifest_sha256' is distinct from p_manifest_sha256 or coalesce(p_manifest_sha256,'') !~ '^[a-f0-9]{64}$'
  or s->'expected_types' is distinct from p_expected_types or s->'private_only' is distinct from 'true'::jsonb
  or s->'public_projection_allowed' is distinct from 'false'::jsonb then raise exception 'Pinned private metadata scope required'; end if;
 with observations as materialized (select * from corpus_ingest.observations where run_id=p_run), specs as (select key kind,value spec from jsonb_each(p_expected_types)),
 per_type as (select kind,jsonb_build_object('expected',(spec->>'expected_observations')::bigint,'observations',count(o.native_id),'distinct_native_ids',count(distinct o.native_id),
  'distinct_input_ordinals',count(distinct o.provenance->>'source_input_record_ordinal'),
  'min_input_ordinal',min((o.provenance->>'source_input_record_ordinal')::bigint),'max_input_ordinal',max((o.provenance->>'source_input_record_ordinal')::bigint),
  'source_input_mismatches',count(o.native_id) filter(where o.provenance->>'source_input_file_sha256' is distinct from spec->>'input_sha256'
   or o.provenance->'source_input_file_bytes' is distinct from spec->'input_bytes' or o.provenance->>'source_manifest_sha256' is distinct from p_manifest_sha256)) counts
  from specs left join observations o on o.entity_type=kind group by kind,spec)
 select jsonb_build_object('run_id',p_run,'source_manifest_sha256',p_manifest_sha256,'expected_types',p_expected_types,'run_observations',(select count(*) from observations),
  'per_type',(select jsonb_object_agg(kind,counts) from per_type),
  'wrong_source_type_endpoint',(select count(*) from observations where source_system<>'docketbird-mcp' or source_url<>'https://mcp.docketbird.com/mcp' or not(p_expected_types ? entity_type)),
  'run_relationship_writes',(select count(*) from corpus_ingest.relationships where run_id=p_run),
  'referenced_version_rows',(select count(*) from observations o join corpus_ingest.entity_versions v on v.source_system=o.source_system and v.entity_type=o.entity_type and v.native_id=o.native_id and v.payload_sha256=o.payload_sha256),
  'first_seen_version_rows',(select count(*) from corpus_ingest.entity_versions where first_run=p_run),
  'unreferenced_first_run_versions',(select count(*) from corpus_ingest.entity_versions v where v.first_run=p_run and not exists(select 1 from observations o where o.source_system=v.source_system and o.entity_type=v.entity_type and o.native_id=v.native_id and o.payload_sha256=v.payload_sha256)),
  'private_tables_with_rls',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='corpus_ingest' and c.relname in ('runs','entities','entity_versions','observations') and c.relrowsecurity),
  'anon_or_authenticated_private_select_grants',(select count(*) from (values ('anon'),('authenticated')) roles(role_name) cross join (values ('corpus_ingest.runs'),('corpus_ingest.entities'),('corpus_ingest.entity_versions'),('corpus_ingest.observations')) tables(table_name) where has_table_privilege(role_name,table_name,'SELECT')),
  'private_only',true,'read_only',true) into result;
 return result;
end $metadata_global$;
revoke all on function public.corpus_admin_docketbird_metadata_global_proof_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_metadata_global_proof_v1(uuid,text,jsonb) to service_role;
