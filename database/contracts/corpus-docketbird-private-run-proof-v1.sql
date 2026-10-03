-- DRAFT ONLY. Read-only, fixed-run aggregate proof against frozen local page
-- fingerprints. No source payload, locator, contact or party data is returned.
create or replace function public.corpus_admin_docketbird_run_proof_v1(p_run uuid,p_after_native_id text default null,p_limit integer default 1000)
returns jsonb language plpgsql stable security invoker set search_path='' as $docketbird_run_proof_v1$
declare manifest_sha text; input_sha text; expected_rows bigint; expected_occurrences bigint; run_scope jsonb; result jsonb; totals jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_limit is null or p_limit not between 1 and 1000
  or length(coalesce(p_after_native_id,''))>512 then raise exception 'Bounded private run proof required' using errcode='22023'; end if;
 if p_run='45d9fecf-33f4-403a-ae8d-a3b1559657d3'::uuid then
  manifest_sha:='c7b0b82edd2744f727a1e2759ff0d7b4930966793f492ba6eca04b1d88d07fa9';
  input_sha:='09cf598dacf6a48ea75091d181dba8cccc77871b221976ffee50cf8f0ef76b36'; expected_rows:=66366; expected_occurrences:=69555;
 elsif p_run='3eb56bc3-0d7d-4159-8b30-64d342a5febb'::uuid then
  manifest_sha:='9ec49fbf31e48b3bda761ef05947729c386740938ff6e5c2cbeb9461544b61b0';
  input_sha:='a1bc95787c35beca98940a83f29c413ae172d1aee6352ea792693a251abeeb08'; expected_rows:=260; expected_occurrences:=260;
 else raise exception 'Unregistered frozen run proof' using errcode='22023'; end if;
 select scope into run_scope from corpus_ingest.runs where id=p_run and status in ('running','partial','completed')
  and scope->>'source_system'='docketbird-mcp' and scope->>'purpose'='seeger-weiss-source-qualified-document-evidence'
  and scope->>'schema_version'='seeger-weiss-docketbird-document-evidence/1'
  and scope->>'intake_normalizer_version'='docketbird-private-observation-lineage/1'
  and scope->>'source_manifest_sha256'=manifest_sha and scope->>'original_input_sha256'=input_sha
  and scope->>'expected_run_observations'=expected_rows::text
  and scope->>'expected_preserved_source_occurrences'=expected_occurrences::text
  and scope->'private_only'='true'::jsonb and scope->'public_projection_allowed'='false'::jsonb
  and scope->'publisher_native_cross_provider_merge_allowed'='false'::jsonb
  and scope->'native_relationship_writes_expected'='0'::jsonb;
 if run_scope is null then raise exception 'Frozen private run scope differs' using errcode='22023'; end if;
 with page as materialized (
  select o.* from corpus_ingest.observations o where o.run_id=p_run and o.source_system='docketbird-mcp'
   and o.entity_type='document_metadata' and o.source_url='https://mcp.docketbird.com/mcp'
   and o.native_id collate "C">coalesce(p_after_native_id,'') collate "C"
  order by o.native_id collate "C" limit p_limit
 ), proof as materialized (
  select o.*,v.native_id is not null as version_present,
   v.data,v.schema_version,
   corpus_ingest.canonical_integer_jsonb_sha256_v1(v.data)=o.payload_sha256 as canonical_exact,
   v.storage_sha256=encode(sha256(convert_to(v.data::text,'UTF8')),'hex') as storage_exact,
   v.schema_version='seeger-weiss-docketbird-document-evidence/1' and v.data->>'native_document_id'=o.native_id
    and o.native_id like (v.data->>'native_case_id')||'-%' as version_identity_exact,
   corpus_ingest.canonical_integer_jsonb_sha256_v1(o.provenance) as provenance_canonical_sha256,
   o.source_sha256 is not distinct from o.provenance->>'source_sha256' and o.source_as_of is null
    and o.retrieved_at=(o.provenance->>'retrieved_at')::timestamptz
    and o.provenance->>'record_sha256'=o.payload_sha256 as observation_columns_exact,
   o.provenance->>'source_manifest_sha256'=manifest_sha and o.provenance->>'source_packet_file_sha256'=input_sha
    and o.provenance->>'record_sha256_codec'='canonical-integer-jsonb/1'
    and o.provenance->>'intake_normalizer_version'='docketbird-private-observation-lineage/1'
    and o.provenance->>'source_tool'='get_docket_sheet'
    and o.provenance->>'source_tool_case_id'=v.data->>'native_case_id' as source_scope_exact,
   e.native_id is not null and e.payload_sha256=o.payload_sha256 and e.data=v.data and e.schema_version=v.schema_version
    and e.provenance=o.provenance and e.source_as_of is null and e.retrieved_at=o.retrieved_at and e.last_run=p_run as current_entity_exact,
   v.data->'publisher_native_entity' is distinct from 'true'::jsonb
    or v.data->'publisher_native_cross_provider_merge_allowed' is distinct from 'false'::jsonb
    or v.data->'firm_current_participation_verified' is distinct from 'false'::jsonb
    or v.data->'mdl_member_relationship_verified' is distinct from 'false'::jsonb
    or v.data->'public_projection_allowed' is distinct from 'false'::jsonb
    or v.data->'binary_checksum_independently_verified' is distinct from 'false'::jsonb
    or v.data->'pdf_download_performed_by_this_normalizer' is distinct from 'false'::jsonb
    or e.data->'public_projection_allowed' is distinct from 'false'::jsonb as private_gate_failure,
   case when coalesce(o.provenance->>'source_occurrence_count','') ~ '^[1-9][0-9]{0,15}$'
    then (o.provenance->>'source_occurrence_count')::bigint end as declared_occurrences,
   case when jsonb_typeof(o.provenance->'full_lineage')='array' then o.provenance->'full_lineage' else '[]'::jsonb end as lineage
  from page o left join corpus_ingest.entity_versions v on v.source_system=o.source_system and v.entity_type=o.entity_type
   and v.native_id=o.native_id and v.payload_sha256=o.payload_sha256
  left join corpus_ingest.entities e on e.source_system=o.source_system and e.entity_type=o.entity_type and e.native_id=o.native_id
 ), lineage_checks as (
  select native_id,count(*) filter(where l->>'provenance_role'='selected_observation') as selected_count,
   count(*) filter(where l->>'provenance_role' not in ('selected_observation','additional_source_observation')
    or coalesce(l->>'input_record_ordinal','') !~ '^[1-9][0-9]{0,15}$'
    or coalesce(l->>'input_record_sha256','') !~ '^[a-f0-9]{64}$'
    or (l->>'provenance_role'='additional_source_observation' and jsonb_typeof(l->'original_provenance') is distinct from 'object')) as invalid_entries
  from proof left join lateral jsonb_array_elements(lineage) l on true group by native_id
 ) select jsonb_build_object('run_id',p_run,'page_records',count(*),
  'first_native_id',min(p.native_id collate "C"),'last_native_id',max(p.native_id collate "C"),
  'versions_present',count(*) filter(where version_present),'canonical_payloads_exact',count(*) filter(where canonical_exact),
  'storage_hashes_exact',count(*) filter(where storage_exact),'native_source_identities_exact',count(*) filter(where version_identity_exact),
  'observation_columns_exact',count(*) filter(where observation_columns_exact),'source_scopes_exact',count(*) filter(where source_scope_exact),
  'current_entities_exact',count(*) filter(where current_entity_exact),'private_gate_failures',count(*) filter(where private_gate_failure),
  'declared_source_occurrences',coalesce(sum(declared_occurrences),0),'lineage_entries',coalesce(sum(jsonb_array_length(lineage)),0),
  'lineage_count_mismatches',count(*) filter(where declared_occurrences is distinct from jsonb_array_length(lineage)::bigint),
  'selected_lineage_mismatches',count(*) filter(where c.selected_count<>1),'invalid_lineage_entries',coalesce(sum(c.invalid_entries),0),
  'page_payload_provenance_sha256',encode(sha256(convert_to(coalesce(string_agg(p.native_id||E'\t'||p.payload_sha256||E'\t'||p.provenance_canonical_sha256||E'\n','' order by p.native_id collate "C"),''),'UTF8')),'hex'),
  'private_only',true,'read_only',true) into result from proof p left join lineage_checks c using(native_id);
 if coalesce(p_after_native_id,'')='' or (result->>'page_records')::integer=0 then
  with observations as materialized (select o.* from corpus_ingest.observations o where o.run_id=p_run),
  original_occurrences as (select l from observations o cross join lateral jsonb_array_elements(
   case when jsonb_typeof(o.provenance->'full_lineage')='array' then o.provenance->'full_lineage' else '[]'::jsonb end) l),
  ordinals as (select case when coalesce(l->>'input_record_ordinal','') ~ '^[1-9][0-9]{0,15}$' then (l->>'input_record_ordinal')::bigint end ordinal from original_occurrences)
  select jsonb_build_object('expected_observations',expected_rows,'expected_source_occurrences',expected_occurrences,
   'run_observations',(select count(*) from observations),
   'distinct_document_ids',(select count(distinct native_id) from observations),
   'wrong_source_or_type_or_endpoint',(select count(*) from observations where source_system<>'docketbird-mcp' or entity_type<>'document_metadata' or source_url<>'https://mcp.docketbird.com/mcp'),
   'run_version_rows',(select count(*) from corpus_ingest.entity_versions where first_run=p_run and source_system='docketbird-mcp' and entity_type='document_metadata'),
   'run_current_entity_rows',(select count(*) from corpus_ingest.entities where last_run=p_run and source_system='docketbird-mcp' and entity_type='document_metadata'),
   'preserved_source_occurrences',(select count(*) from ordinals),'distinct_source_record_ordinals',(select count(distinct ordinal) from ordinals),
   'min_source_record_ordinal',(select min(ordinal) from ordinals),'max_source_record_ordinal',(select max(ordinal) from ordinals),
   'invalid_or_out_of_range_ordinals',(select count(*) from ordinals where ordinal is null or ordinal<1 or ordinal>expected_occurrences),
   'run_relationship_writes',(select count(*) from corpus_ingest.relationships where run_id=p_run),
   'private_tables_with_rls',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='corpus_ingest' and c.relname in ('runs','entities','entity_versions','observations') and c.relrowsecurity),
   'anon_or_authenticated_private_select_grants',(select count(*) from (values ('anon'),('authenticated')) roles(role_name)
    cross join (values ('corpus_ingest.runs'),('corpus_ingest.entities'),('corpus_ingest.entity_versions'),('corpus_ingest.observations')) tables(table_name)
    where has_table_privilege(role_name,table_name,'SELECT')),
   'source_manifest_sha256',manifest_sha,'original_input_sha256',input_sha) into totals;
  result:=result||jsonb_build_object('global_checks',totals);
 else result:=result||jsonb_build_object('global_checks',null); end if;
 return result;
end;
$docketbird_run_proof_v1$;
revoke all on function public.corpus_admin_docketbird_run_proof_v1(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_run_proof_v1(uuid,text,integer) to service_role;
