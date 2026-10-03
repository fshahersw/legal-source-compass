-- Draft: root applies after review. Local original observations never enter
-- publisher-native pdf_document_assets. Expected packet rows are separately pinned.
create table if not exists corpus_ingest.local_pdf_asset_packet_scopes (
 source_packet_sha256 text primary key check (source_packet_sha256 ~ '^[a-f0-9]{64}$'),
 transfer_plan_sha256 text not null check (transfer_plan_sha256 ~ '^[a-f0-9]{64}$'),
 prepared_occurrences_sha256 text not null check (prepared_occurrences_sha256 ~ '^[a-f0-9]{64}$'),
 source_inventory_sha256 text not null check (source_inventory_sha256 ~ '^[a-f0-9]{64}$'),
 expected_occurrences integer not null check (expected_occurrences between 1 and 10000),
 expected_unique_objects integer not null check (expected_unique_objects between 1 and expected_occurrences),
 registered_at timestamptz not null default now()
);
create table if not exists corpus_ingest.local_pdf_asset_expected_occurrences (
 local_occurrence_id text primary key check (local_occurrence_id ~ '^local-pdf:[a-f0-9]{64}$'),
 source_packet_sha256 text not null references corpus_ingest.local_pdf_asset_packet_scopes(source_packet_sha256),
 occurrence_sha256 text not null check (occurrence_sha256 ~ '^[a-f0-9]{64}$'),
 occurrence jsonb not null check (jsonb_typeof(occurrence)='object'),
 unique(source_packet_sha256,local_occurrence_id)
);
create table if not exists corpus_ingest.local_pdf_asset_occurrences (
 local_occurrence_id text primary key references corpus_ingest.local_pdf_asset_expected_occurrences(local_occurrence_id),
 source_packet_sha256 text not null references corpus_ingest.local_pdf_asset_packet_scopes(source_packet_sha256),
 occurrence_sha256 text not null check (occurrence_sha256 ~ '^[a-f0-9]{64}$'),
 sha256 text not null references corpus_ingest.pdf_objects(sha256),
 source_system text not null check (source_system='local-matter-bundle-pdf'),
 native_document_id text check (native_document_id is null),
 native_case_id text check (native_case_id is null),
 source_claimed_parent_docket_id text not null check (source_claimed_parent_docket_id ~ '^[1-9][0-9]*$'),
 literal_retained_locator text,
 source_seal_status text not null check (source_seal_status in ('unknown_local_blank','unknown_local_literal','locally_flagged_sealed')),
 private_quarantine_required boolean not null check (private_quarantine_required),
 public_projection_allowed boolean not null check (not public_projection_allowed),
 occurrence jsonb not null check (jsonb_typeof(occurrence)='object'),
 first_cloud_verified_at timestamptz not null,
 registered_at timestamptz not null default now(),
 check(literal_retained_locator is null or literal_retained_locator ~ '^https://storage[.]courtlistener[.]com/recap/[^?#[:space:]]+[.]pdf$')
);
create table if not exists corpus_ingest.local_pdf_asset_observations (
 observation_sha256 text primary key check (observation_sha256 ~ '^[a-f0-9]{64}$'),
 local_occurrence_id text not null references corpus_ingest.local_pdf_asset_occurrences(local_occurrence_id),
 transfer_plan_sha256 text not null check (transfer_plan_sha256 ~ '^[a-f0-9]{64}$'),
 transfer_receipt_file_sha256 text not null check (transfer_receipt_file_sha256 ~ '^[a-f0-9]{64}$'),
 transfer_receipt_record_ordinal integer not null check (transfer_receipt_record_ordinal>0),
 cloud_verification jsonb not null check(jsonb_typeof(cloud_verification)='object'),
 verified_at timestamptz not null,
 registered_at timestamptz not null default now()
);
alter table corpus_ingest.local_pdf_asset_packet_scopes enable row level security;
alter table corpus_ingest.local_pdf_asset_expected_occurrences enable row level security;
alter table corpus_ingest.local_pdf_asset_occurrences enable row level security;
alter table corpus_ingest.local_pdf_asset_observations enable row level security;
revoke all on corpus_ingest.local_pdf_asset_packet_scopes,corpus_ingest.local_pdf_asset_expected_occurrences,corpus_ingest.local_pdf_asset_occurrences,corpus_ingest.local_pdf_asset_observations from public,anon,authenticated;
grant select,insert on corpus_ingest.local_pdf_asset_packet_scopes,corpus_ingest.local_pdf_asset_expected_occurrences,corpus_ingest.local_pdf_asset_occurrences,corpus_ingest.local_pdf_asset_observations to service_role;
grant select,insert on corpus_ingest.pdf_objects to service_role;

create or replace function public.corpus_admin_register_local_bundle_pdf_assets_v1(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare row jsonb; original jsonb; proof jsonb; scope corpus_ingest.local_pdf_asset_packet_scopes;
 expected corpus_ingest.local_pdf_asset_expected_occurrences; existing corpus_ingest.local_pdf_asset_occurrences;
 object_row corpus_ingest.pdf_objects; actual_hash text; object_count integer; received integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
  or octet_length(p_rows::text)>1048576 then raise exception 'Bounded local PDF registration required'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(row))<>3
   or not(row ?& array['occurrence','occurrence_sha256','cloud_verification'])
   or jsonb_typeof(row->'occurrence') is distinct from 'object'
   or jsonb_typeof(row->'cloud_verification') is distinct from 'object' then raise exception 'Local registration shape required'; end if;
  original:=row->'occurrence'; proof:=row->'cloud_verification';
  select * into expected from corpus_ingest.local_pdf_asset_expected_occurrences where local_occurrence_id=original->>'local_occurrence_id';
  if not found then raise exception 'Unregistered local occurrence'; end if;
  select * into scope from corpus_ingest.local_pdf_asset_packet_scopes where source_packet_sha256=expected.source_packet_sha256;
  if not found then raise exception 'Unregistered source packet'; end if;
  actual_hash:=corpus_ingest.canonical_integer_jsonb_sha256_v1(original);
  if actual_hash is distinct from row->>'occurrence_sha256' or actual_hash is distinct from expected.occurrence_sha256
   or original is distinct from expected.occurrence or original->>'source_packet_sha256' is distinct from scope.source_packet_sha256
   or original->>'source_inventory_sha256' is distinct from scope.source_inventory_sha256
   or original->>'schema_version' is distinct from 'local-bundle-private-pdf-occurrence/1'
   or original->>'source_system' is distinct from 'local-matter-bundle-pdf'
   or original->'native_document_id' is distinct from 'null'::jsonb
   or original->'native_case_id' is distinct from 'null'::jsonb
   or original->'native_backend_document_id' is distinct from 'null'::jsonb
   or original->'publisher_native_entity' is distinct from 'false'::jsonb
   or original->'publisher_parent_association_verified' is distinct from 'false'::jsonb
   or original->'publisher_sealing_asserted' is distinct from 'false'::jsonb
   or original->'private_only' is distinct from 'true'::jsonb
   or original->'private_quarantine_required' is distinct from 'true'::jsonb
   or original->'public_projection_allowed' is distinct from 'false'::jsonb
   or original->'cloud_binary_verified' is distinct from 'false'::jsonb
   or original->'network_download_performed' is distinct from 'false'::jsonb
   or original->'local_binary_sha_verified' is distinct from 'true'::jsonb
   or original->'pdf_magic_verified' is distinct from 'true'::jsonb
   or original->'source_http_retrieved_at' is distinct from 'null'::jsonb
   or original->'source_http_status' is distinct from 'null'::jsonb
   or original->>'source_seal_status' not in ('unknown_local_blank','unknown_local_literal','locally_flagged_sealed')
   or original->>'storage_bucket' is distinct from 'corpus-originals'
   or original->>'intended_storage_key' is distinct from ('seeger-weiss/pdf-sha256/'||substr(original->>'pdf_sha256',1,2)||'/'||(original->>'pdf_sha256')||'.pdf')
   or original->'source_evidence'->>'courtlistener_docket_id' is distinct from original->'firm_query_parent_evidence'->>'native_docket_id'
   or original->'firm_query_parent_evidence'->'http_status' is distinct from '200'::jsonb
   or original->'firm_query_parent_evidence'->>'request_method' is distinct from 'GET'
   or original->'firm_query_parent_evidence'->>'query_scope' is distinct from 'firm:"Seeger Weiss"'
   or jsonb_path_exists(row,'$.**.download_url') or jsonb_path_exists(row,'$.**.pdf_url') then raise exception 'Frozen local provenance or privacy mismatch'; end if;
  -- Empty retained locator and local sealing flags remain private observations.
  -- They never establish API identity, public availability or publisher seal status.
  if nullif(original->'source_evidence'->>'literal_recap_pdf_url','') is not null
   and original->'source_evidence'->>'literal_recap_pdf_url' !~ '^https://storage[.]courtlistener[.]com/recap/[^?#[:space:]]+[.]pdf$'
   then raise exception 'Unqualified retained local locator'; end if;
  if (select count(*) from jsonb_object_keys(proof))<>15
   or proof->>'schema_version' is distinct from 'local-bundle-private-cloud-readback/1'
   or proof->>'state' is distinct from 'local_cloud_verified'
   or proof->>'project_id' is distinct from 'xosqzzsnhxcyehcnirpa'
   or proof->>'bucket' is distinct from 'corpus-originals'
   or proof->>'storage_key' is distinct from original->>'intended_storage_key'
   or proof->'sha256' is distinct from original->'pdf_sha256'
   or proof->'sha1' is distinct from original->'pdf_sha1'
   or proof->'bytes' is distinct from original->'pdf_bytes'
   or jsonb_typeof(proof->'bytes') is distinct from 'number'
   or coalesce(proof->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(proof->>'sha1','') !~ '^[a-f0-9]{40}$'
   or coalesce(proof->>'bytes','') !~ '^[1-9][0-9]*$'
   or proof->'whole_object_get_hash_verified' is distinct from 'true'::jsonb
   or proof->'local_original_file_hash_verified' is distinct from 'true'::jsonb
   or proof->>'verification_method' is distinct from 'authenticated_whole_object_readback_sha256_sha1_bytes'
   or proof->>'transfer_plan_sha256' is distinct from scope.transfer_plan_sha256
   or coalesce(proof->>'transfer_receipt_file_sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(proof->'transfer_receipt_record_ordinal') is distinct from 'number'
   or coalesce(proof->>'transfer_receipt_record_ordinal','') !~ '^[1-9][0-9]*$'
   or coalesce(proof->>'verified_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'Whole private object readback proof required'; end if;
  perform (proof->>'verified_at')::timestamptz;
  select count(*) into object_count from storage.objects o join storage.buckets b on b.id=o.bucket_id
   where o.bucket_id='corpus-originals' and b.public=false and o.name=proof->>'storage_key'
   and (o.metadata->>'size')::bigint=(proof->>'bytes')::bigint;
  if object_count<>1 then raise exception 'Private original object missing or size mismatch'; end if;
  insert into corpus_ingest.pdf_objects(sha256,sha1,bytes,bucket,storage_key,first_verified_at)
   values(proof->>'sha256',proof->>'sha1',(proof->>'bytes')::bigint,'corpus-originals',proof->>'storage_key',(proof->>'verified_at')::timestamptz) on conflict(sha256) do nothing;
  select * into object_row from corpus_ingest.pdf_objects where sha256=proof->>'sha256';
  if object_row.sha1 is distinct from proof->>'sha1' or object_row.bytes is distinct from (proof->>'bytes')::bigint
   or object_row.bucket is distinct from 'corpus-originals' or object_row.storage_key is distinct from proof->>'storage_key' then raise exception 'Immutable byte identity conflict'; end if;
  insert into corpus_ingest.local_pdf_asset_occurrences(local_occurrence_id,source_packet_sha256,occurrence_sha256,sha256,source_system,native_document_id,native_case_id,source_claimed_parent_docket_id,literal_retained_locator,source_seal_status,private_quarantine_required,public_projection_allowed,occurrence,first_cloud_verified_at)
   values(original->>'local_occurrence_id',scope.source_packet_sha256,actual_hash,proof->>'sha256','local-matter-bundle-pdf',null,null,original->'source_evidence'->>'courtlistener_docket_id',nullif(original->'source_evidence'->>'literal_recap_pdf_url',''),original->>'source_seal_status',true,false,original,(proof->>'verified_at')::timestamptz) on conflict(local_occurrence_id) do nothing;
  select * into existing from corpus_ingest.local_pdf_asset_occurrences where local_occurrence_id=original->>'local_occurrence_id';
  if existing.occurrence is distinct from original or existing.occurrence_sha256 is distinct from actual_hash or existing.sha256 is distinct from proof->>'sha256'
   or existing.source_packet_sha256 is distinct from scope.source_packet_sha256
   or existing.native_document_id is not null or existing.native_case_id is not null
   or existing.source_claimed_parent_docket_id is distinct from original->'source_evidence'->>'courtlistener_docket_id'
   or existing.literal_retained_locator is distinct from nullif(original->'source_evidence'->>'literal_recap_pdf_url','')
   or existing.source_seal_status is distinct from original->>'source_seal_status'
   or not existing.private_quarantine_required or existing.public_projection_allowed then raise exception 'Immutable local occurrence conflict'; end if;
  insert into corpus_ingest.local_pdf_asset_observations(observation_sha256,local_occurrence_id,transfer_plan_sha256,transfer_receipt_file_sha256,transfer_receipt_record_ordinal,cloud_verification,verified_at)
   values(corpus_ingest.canonical_integer_jsonb_sha256_v1(row),original->>'local_occurrence_id',scope.transfer_plan_sha256,proof->>'transfer_receipt_file_sha256',(proof->>'transfer_receipt_record_ordinal')::integer,proof,(proof->>'verified_at')::timestamptz) on conflict(observation_sha256) do nothing;
  received:=received+1;
 end loop;
 return jsonb_build_object('received',received,'private_only',true,'private_quarantine_required',true,'publisher_native_asset_writes',0,'bucket','corpus-originals');
end $$;
revoke all on function public.corpus_admin_register_local_bundle_pdf_assets_v1(jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_register_local_bundle_pdf_assets_v1(jsonb) to service_role;

-- Read-only exact acknowledgement after an unknown HTTP outcome. No source,
-- locator, file path, private payload or cloud grant is returned.
create or replace function public.corpus_admin_local_bundle_pdf_assets_status_v1(p_rows jsonb)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare row jsonb; original jsonb; proof jsonb; expected_count integer:=0; matched_count integer:=0; conflict_count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
  or octet_length(p_rows::text)>1048576 then raise exception 'Bounded local PDF status required'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  original:=row->'occurrence'; proof:=row->'cloud_verification'; expected_count:=expected_count+1;
  if jsonb_typeof(original) is distinct from 'object' or jsonb_typeof(proof) is distinct from 'object'
   or not exists(select 1 from corpus_ingest.local_pdf_asset_expected_occurrences e
    join corpus_ingest.local_pdf_asset_packet_scopes s on s.source_packet_sha256=e.source_packet_sha256
    where e.local_occurrence_id=original->>'local_occurrence_id' and e.occurrence=original
    and e.occurrence_sha256=row->>'occurrence_sha256'
    and corpus_ingest.canonical_integer_jsonb_sha256_v1(original)=e.occurrence_sha256
    and s.transfer_plan_sha256=proof->>'transfer_plan_sha256') then raise exception 'Unregistered frozen local status body'; end if;
  if exists(select 1 from corpus_ingest.local_pdf_asset_occurrences a
    join corpus_ingest.pdf_objects p on p.sha256=a.sha256
    join corpus_ingest.local_pdf_asset_observations o on o.local_occurrence_id=a.local_occurrence_id
    where a.local_occurrence_id=original->>'local_occurrence_id' and a.occurrence=original
    and a.occurrence_sha256=row->>'occurrence_sha256' and a.sha256=proof->>'sha256'
    and a.source_packet_sha256=original->>'source_packet_sha256'
    and a.source_claimed_parent_docket_id=original->'source_evidence'->>'courtlistener_docket_id'
    and a.literal_retained_locator is not distinct from nullif(original->'source_evidence'->>'literal_recap_pdf_url','')
    and a.source_seal_status=original->>'source_seal_status'
    and a.native_document_id is null and a.native_case_id is null and a.private_quarantine_required and not a.public_projection_allowed
    and p.sha1=proof->>'sha1' and p.bytes=(proof->>'bytes')::bigint and p.bucket='corpus-originals' and p.storage_key=proof->>'storage_key'
    and o.observation_sha256=corpus_ingest.canonical_integer_jsonb_sha256_v1(row)
    and o.cloud_verification=proof and o.transfer_plan_sha256=proof->>'transfer_plan_sha256'
    and o.transfer_receipt_file_sha256=proof->>'transfer_receipt_file_sha256'
    and o.transfer_receipt_record_ordinal=(proof->>'transfer_receipt_record_ordinal')::integer
    and o.verified_at=(proof->>'verified_at')::timestamptz) then matched_count:=matched_count+1; end if;
  if exists(select 1 from corpus_ingest.local_pdf_asset_occurrences a where a.local_occurrence_id=original->>'local_occurrence_id'
    and (a.occurrence is distinct from original or a.occurrence_sha256 is distinct from row->>'occurrence_sha256'
    or a.sha256 is distinct from proof->>'sha256' or a.native_document_id is not null or a.native_case_id is not null
    or a.source_packet_sha256 is distinct from original->>'source_packet_sha256'
    or a.source_claimed_parent_docket_id is distinct from original->'source_evidence'->>'courtlistener_docket_id'
    or a.literal_retained_locator is distinct from nullif(original->'source_evidence'->>'literal_recap_pdf_url','')
    or a.source_seal_status is distinct from original->>'source_seal_status'
    or not a.private_quarantine_required or a.public_projection_allowed))
   or exists(select 1 from corpus_ingest.pdf_objects p where p.sha256=proof->>'sha256'
    and (p.sha1 is distinct from proof->>'sha1' or p.bytes is distinct from (proof->>'bytes')::bigint
    or p.bucket is distinct from 'corpus-originals' or p.storage_key is distinct from proof->>'storage_key'))
   then conflict_count:=conflict_count+1; end if;
 end loop;
 return jsonb_build_object('expected',expected_count,'matched',matched_count,'conflicts',conflict_count,'private_only',true,'publisher_native_asset_writes',0);
end $$;
revoke all on function public.corpus_admin_local_bundle_pdf_assets_status_v1(jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_local_bundle_pdf_assets_status_v1(jsonb) to service_role;
