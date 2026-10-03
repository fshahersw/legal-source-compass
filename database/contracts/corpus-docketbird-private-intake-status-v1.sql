-- DRAFT ONLY: fixed-source, read-only acknowledgement proof. No retained
-- document payload, locator, party metadata or credentials are returned.
-- The caller must send the identical frozen group used for the uncertain write.
create or replace function public.corpus_admin_docketbird_evidence_status_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $docketbird_status_v1$
declare run_scope jsonb; result jsonb;
begin
 if auth.role() is distinct from 'service_role'
  or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 100
  or octet_length(p_rows::text)>1048576 then
  raise exception 'Bounded service-only acknowledgement required' using errcode='22023';
 end if;
 select scope into run_scope from corpus_ingest.runs
 where id=p_run and status in ('running','partial','completed')
  and scope->>'source_system'='docketbird-mcp'
  and scope->>'purpose'='seeger-weiss-source-qualified-document-evidence'
  and scope->>'schema_version'='seeger-weiss-docketbird-document-evidence/1'
  and scope->>'intake_normalizer_version'='docketbird-private-observation-lineage/1'
  and scope->'private_only'='true'::jsonb
  and scope->'public_projection_allowed'='false'::jsonb
  and scope->'publisher_native_cross_provider_merge_allowed'='false'::jsonb
  and scope->'native_relationship_writes_expected'='0'::jsonb
  and scope->>'source_manifest_sha256' ~ '^[a-f0-9]{64}$'
  and scope->>'original_input_sha256' ~ '^[a-f0-9]{64}$';
 if run_scope is null then raise exception 'Wrong source-qualified acknowledgement scope' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where
  r->>'source_system' is distinct from 'docketbird-mcp'
  or r->>'entity_type' is distinct from 'document_metadata'
  or r->>'schema_version' is distinct from 'seeger-weiss-docketbird-document-evidence/1'
  or jsonb_typeof(r->'data') is distinct from 'object'
  or jsonb_typeof(r->'provenance') is distinct from 'object'
  or r->>'native_id' is distinct from r->'data'->>'native_document_id'
  or coalesce(r->'data'->>'native_case_id','')=''
  or left(r->>'native_id',length(r->'data'->>'native_case_id')+1) is distinct from ((r->'data'->>'native_case_id')||'-')
  or r->'data'->'publisher_native_entity' is distinct from 'true'::jsonb
  or r->'data'->'publisher_native_cross_provider_merge_allowed' is distinct from 'false'::jsonb
  or r->'data'->'firm_current_participation_verified' is distinct from 'false'::jsonb
  or r->'data'->'mdl_member_relationship_verified' is distinct from 'false'::jsonb
  or r->'data'->'public_projection_allowed' is distinct from 'false'::jsonb
  or r->'data'->'binary_checksum_independently_verified' is distinct from 'false'::jsonb
  or r->'data'->'pdf_download_performed_by_this_normalizer' is distinct from 'false'::jsonb
  or r->'provenance'->>'source_url' is distinct from 'https://mcp.docketbird.com/mcp'
  or r->'provenance'->>'source_tool' is distinct from 'get_docket_sheet'
  or r->'provenance'->>'source_tool_case_id' is distinct from r->'data'->>'native_case_id'
  or r->'provenance'->>'source_manifest_sha256' is distinct from run_scope->>'source_manifest_sha256'
  or r->'provenance'->>'source_packet_file_sha256' is distinct from run_scope->>'original_input_sha256'
  or r->'provenance'->>'intake_normalizer_version' is distinct from 'docketbird-private-observation-lineage/1'
  or r->'provenance'->>'record_sha256_codec' is distinct from 'canonical-integer-jsonb/1'
  or corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data') is distinct from r->'provenance'->>'record_sha256'
  or jsonb_typeof(r->'provenance'->'full_lineage') is distinct from 'array'
  or coalesce(r->'provenance'->>'source_occurrence_count','') !~ '^[1-9][0-9]*$'
  or (r->'provenance'->>'source_occurrence_count')::bigint is distinct from jsonb_array_length(r->'provenance'->'full_lineage')::bigint
  or (select count(*) from jsonb_array_elements(r->'provenance'->'full_lineage') l where l->>'provenance_role'='selected_observation')<>1
  or jsonb_path_exists(r,'$.**.pdf_url') or jsonb_path_exists(r,'$.**.download_url')
  or exists(select 1 from jsonb_path_query(r,'$.** ? (@.type() == "string")') value
   where value #>> '{}' ~* '^https?://[^[:space:]]*[?&](user[_-]?id|(?:access[_-]?)?token|signature|api[_-]?key|awsaccesskeyid|expires|x-goog-signature|x-amz-[^=]+)='))
  or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'native_id',r->'provenance'->>'record_sha256' having count(*)>1) then
  raise exception 'Source, payload, private lineage or unique acknowledgement key mismatch' using errcode='22023';
 end if;
 with expected as (select r from jsonb_array_elements(p_rows) r), proof as (
  select r,
   v.native_id is not null and v.schema_version=r->>'schema_version' and v.data=r->'data'
    and v.storage_sha256=encode(sha256(convert_to(v.data::text,'UTF8')),'hex')
    and corpus_ingest.canonical_integer_jsonb_sha256_v1(v.data)=v.payload_sha256 as version_matches,
   o.native_id is not null and o.source_sha256 is not distinct from r->'provenance'->>'source_sha256'
    and o.source_as_of is not distinct from nullif(r->'provenance'->>'source_as_of','')::date
    and o.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz
    and o.provenance=r->'provenance' as observation_matches,
   e.native_id is not null and e.payload_sha256=r->'provenance'->>'record_sha256'
    and e.schema_version=r->>'schema_version' and e.data=r->'data'
    and e.provenance=r->'provenance'
    and e.source_as_of is not distinct from nullif(r->'provenance'->>'source_as_of','')::date
    and e.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz and e.last_run=p_run as current_entity_matches,
   (v.native_id is not null and (v.schema_version is distinct from r->>'schema_version'
    or v.data is distinct from r->'data'
    or v.storage_sha256 is distinct from encode(sha256(convert_to(v.data::text,'UTF8')),'hex')
    or corpus_ingest.canonical_integer_jsonb_sha256_v1(v.data) is distinct from v.payload_sha256))
   or (o.native_id is not null and (o.source_sha256 is distinct from r->'provenance'->>'source_sha256'
    or o.source_as_of is distinct from nullif(r->'provenance'->>'source_as_of','')::date
    or o.retrieved_at is distinct from (r->'provenance'->>'retrieved_at')::timestamptz
    or o.provenance is distinct from r->'provenance')) as conflict
  from expected
  left join corpus_ingest.entity_versions v on v.source_system='docketbird-mcp' and v.entity_type='document_metadata'
   and v.native_id=r->>'native_id' and v.payload_sha256=r->'provenance'->>'record_sha256'
  left join corpus_ingest.observations o on o.run_id=p_run and o.source_system='docketbird-mcp' and o.entity_type='document_metadata'
   and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256'
   and o.source_url='https://mcp.docketbird.com/mcp'
  left join corpus_ingest.entities e on e.source_system='docketbird-mcp' and e.entity_type='document_metadata' and e.native_id=r->>'native_id'
 ) select jsonb_build_object('expected',count(*),'matched',count(*) filter(where version_matches and observation_matches),
  'conflicts',count(*) filter(where conflict),'current_entities_exact',count(*) filter(where current_entity_matches),
  'expected_source_occurrences',sum((r->'provenance'->>'source_occurrence_count')::bigint),
  'matched_source_occurrences',coalesce(sum((r->'provenance'->>'source_occurrence_count')::bigint) filter(where version_matches and observation_matches),0),
  'proof_grain','immutable native document payload version plus exact same-run observation provenance',
  'read_only',true,'private_only',true) into result from proof;
 return result;
end;
$docketbird_status_v1$;
revoke all on function public.corpus_admin_docketbird_evidence_status_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_evidence_status_v1(uuid,jsonb) to service_role;
