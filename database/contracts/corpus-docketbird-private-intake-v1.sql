-- Fixed private intake of independently reconstructed, source-qualified
-- document metadata evidence. Original publisher identifiers stay distinct.
create or replace function public.corpus_admin_docketbird_evidence_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row jsonb;
begin
 if auth.role() is distinct from 'service_role' or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>1048576 then raise exception 'Bounded service-only document evidence required'; end if;
 if not exists(select 1 from corpus_ingest.runs where id=p_run and status in ('running','partial') and scope->>'source_system'='docketbird-mcp' and scope->>'purpose'='seeger-weiss-source-qualified-document-evidence' and scope->>'source_manifest_sha256' ~ '^[a-f0-9]{64}$') then raise exception 'Wrong open source-qualified run'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if row->>'source_system' is distinct from 'docketbird-mcp' or row->>'entity_type' is distinct from 'document_metadata'
   or row->>'schema_version' is distinct from 'seeger-weiss-docketbird-document-evidence/1'
   or jsonb_typeof(row->'data') is distinct from 'object' or jsonb_typeof(row->'provenance') is distinct from 'object'
   or row->>'native_id' is distinct from row->'data'->>'native_document_id'
   or coalesce(row->'data'->>'native_case_id','')='' or left(row->>'native_id',length(row->'data'->>'native_case_id')+1) is distinct from ((row->'data'->>'native_case_id')||'-')
   or row->'data'->'publisher_native_cross_provider_merge_allowed' is distinct from 'false'::jsonb
   or row->'data'->'public_projection_allowed' is distinct from 'false'::jsonb
   or row->'data'->'publisher_native_entity' is distinct from 'true'::jsonb
   or row->'data'->'firm_current_participation_verified' is distinct from 'false'::jsonb
   or row->'data'->'mdl_member_relationship_verified' is distinct from 'false'::jsonb
   or row->'data'->'binary_checksum_independently_verified' is distinct from 'false'::jsonb
   or row->'data'->'pdf_download_performed_by_this_normalizer' is distinct from 'false'::jsonb
   or row->'provenance'->>'source_url' is distinct from 'https://mcp.docketbird.com/mcp'
   or row->'provenance'->>'source_tool' is distinct from 'get_docket_sheet'
   or row->'provenance'->>'source_tool_case_id' is distinct from row->'data'->>'native_case_id'
   or coalesce(row->'provenance'->>'source_sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(row->'provenance'->>'source_original_document_sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(row->'provenance'->>'source_capture_file_sha256','') !~ '^[a-f0-9]{64}$'
   or row->'provenance'->>'record_sha256_codec' is distinct from 'canonical-integer-jsonb/1'
   or row->'provenance'->>'source_manifest_sha256' is distinct from (select scope->>'source_manifest_sha256' from corpus_ingest.runs where id=p_run)
   or row->'provenance'->>'intake_normalizer_version' is distinct from 'docketbird-private-observation-lineage/1'
   or row->'provenance'->>'source_packet_file_sha256' is distinct from (select scope->>'original_input_sha256' from corpus_ingest.runs where id=p_run)
   or jsonb_typeof(row->'provenance'->'source_occurrence_count') is distinct from 'number'
   or coalesce(row->'provenance'->>'source_occurrence_count','') !~ '^[1-9][0-9]*$'
   or jsonb_typeof(row->'provenance'->'full_lineage') is distinct from 'array'
   or (row->'provenance'->>'source_occurrence_count')::bigint is distinct from jsonb_array_length(row->'provenance'->'full_lineage')::bigint
   or (select count(*) from jsonb_array_elements(row->'provenance'->'full_lineage') lineage where lineage->>'provenance_role'='selected_observation')<>1
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(row->'data') is distinct from row->'provenance'->>'record_sha256'
   or jsonb_typeof(row->'provenance'->'firm_scope_evidence') is distinct from 'array' or jsonb_array_length(row->'provenance'->'firm_scope_evidence')=0
   or jsonb_path_exists(row,'$.**.pdf_url') or jsonb_path_exists(row,'$.**.download_url')
   or exists(select 1 from jsonb_path_query(row,'$.** ? (@.type() == "string")') value where value #>> '{}' ~* '^https?://[^[:space:]]*[?&](user[_-]?id|(?:access[_-]?)?token|signature|api[_-]?key|awsaccesskeyid|expires|x-goog-signature|x-amz-[^=]+)=') then raise exception 'Source/native identity, private scope or provenance mismatch'; end if;
 end loop;
 return corpus_ingest.ingest_entities(p_run,p_rows)||jsonb_build_object('private_only',true,'publisher_native_entities_released',0);
end $$;
revoke all on function public.corpus_admin_docketbird_evidence_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_docketbird_evidence_v1(uuid,jsonb) to service_role;
