-- corpus-pdf-assets-v2.sql
-- Owner decision 2026-10-27 (AGENTS.md, 6658bff3): "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What this changes (one function, four comments; no table data is touched):
--   public.corpus_admin_register_pdf_assets_v1(jsonb)  every new observation records source_seal_status only. The v1 text
--     stamped every observation with source_privacy_qualification {source_seal_status, private_quarantine_required,
--     public_projection_allowed:false}, so 'unknown' seal status read like a quarantine order. No reader in
--     database/contracts, src/ or the live database checks those keys; availability, matter documents, object streaming,
--     page text, search and documents_refresh_v1 all go through public.corpus_pdf_availability_v1 on provider_flags.
--     Everything else in the function (validation, provider branches, byte identity, grants, SECURITY DEFINER,
--     search_path) is the live text byte for byte; the base text is pdf-govinfo-source-v1.sql, whose body md5
--     c9cc6c7aee5d16b6d4b4ef293f8c8099 equals the live prosrc md5 read on 2026-10-27.
--   comments on corpus_ingest.pdf_asset_observations and on local_pdf_asset_occurrences.private_quarantine_required /
--     public_projection_allowed / source_seal_status say that the stored annotations are history, not holds.
--
-- Existing rows stay as they are (history). Counts read on 2026-10-27:
--   pdf_asset_observations 204,823; 142,552 carry private_quarantine_required=true (130,643 distinct PDFs), all on
--   associations that corpus_pdf_availability_v1 already reports 'open'.
--   local_pdf_asset_occurrences 752: 740 unknown_local_blank (628 PDFs), 12 locally_flagged_sealed (12 PDFs). The CHECK
--   constraints that force private_quarantine_required=true / public_projection_allowed=false stay: the frozen local
--   packets assert those values and their hashes are pinned; relaxing them would need new packets (scripts/ingest, owned
--   by the de-dockets workstream) and would change nothing that is served.
--
-- Note on re-registration: the observation digest covers the stored observation, so re-sending a row that was
-- registered under v1 adds one new observation of the same association (the association row itself is unchanged and
-- 'on conflict do nothing'). Readers that count observations should count distinct associations.
--
-- Rollback: corpus-pdf-assets-v2.rollback.sql (the live v1 text verbatim, comments reset to NULL).

CREATE OR REPLACE FUNCTION public.corpus_admin_register_pdf_assets_v1(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row jsonb; object_row corpus_ingest.pdf_objects; asset_row corpus_ingest.pdf_document_assets; stored_observation jsonb; observation_digest text; n integer:=0; matched integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Bounded PDF assets array required'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if row->>'state' is distinct from 'cloud_verified' or row->>'project_id' is distinct from 'xosqzzsnhxcyehcnirpa' or row->>'bucket' is distinct from 'corpus-originals'
   or row->>'provider' not in ('docketbird','courtlistener','official-court','courtlistener-public-locator','govinfo') or row->>'provider' is null
   or coalesce(row->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(row->>'sha1','') !~ '^[a-f0-9]{40}$'
   or coalesce(row->>'selected_source_record_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(row->>'queue_sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(row->>'bytes','') !~ '^[1-9][0-9]*$' or coalesce(length(row->>'native_document_id'),0) not between 1 and 500
   or row->>'storage_key' is distinct from ('seeger-weiss/pdf-sha256/'||substr(row->>'sha256',1,2)||'/'||(row->>'sha256')||'.pdf')
   or jsonb_typeof(row->'source_origins') is distinct from 'array' or jsonb_array_length(row->'source_origins')=0
   or jsonb_typeof(row->'provider_flags') is distinct from 'object'
   or jsonb_typeof(row->'sha256') is distinct from 'string' or jsonb_typeof(row->'sha1') is distinct from 'string'
   or jsonb_typeof(row->'selected_source_record_sha256') is distinct from 'string' or jsonb_typeof(row->'queue_sha256') is distinct from 'string'
   or jsonb_typeof(row->'native_document_id') is distinct from 'string'
   or jsonb_path_exists(row,'$.**.download_url') or jsonb_path_exists(row,'$.**.pdf_url')
   or (row->>'durable_url' is not null and ((row->>'durable_url') not like 'https://%' or (row->>'durable_url') ~* '^https://[^/?#]*@' or (row->>'durable_url') ~* '(x-amz-|token=|signature=|api[_-]?key=|user[_-]?id=)')) then raise exception 'Invalid verified PDF asset'; end if;
  if row->>'provider'='docketbird' and (not (((row->'provider_flags'->'restricted')='false'::jsonb and (row->'provider_flags'->'downloaded') in ('1'::jsonb,'true'::jsonb)) is true or ((row->'provider_flags'->'restricted')='null'::jsonb and (row->'provider_flags'->'downloaded')='null'::jsonb and row->'provider_flags'->>'availability_evidence'='publisher_search_pdf_locator' and row->'provider_flags'->'search_pdf_url_observed'='true'::jsonb and row->'provider_flags'->'sealing_related_locator_held'='false'::jsonb and exists(select 1 from jsonb_array_elements(row->'source_origins') origin where origin->>'source_tool'='search_documents' and origin->>'native_case_id'=row->>'native_case_id')) is true) or coalesce(length(row->>'native_case_id'),0)=0 or (left(row->>'native_document_id',length(row->>'native_case_id')+1) is distinct from ((row->>'native_case_id')||'-') and not (left(row->>'native_case_id',2)='c-' and length(row->>'native_case_id')>2 and left(row->>'native_document_id',length(row->>'native_case_id')+1)=('d-'||substr(row->>'native_case_id',3)||'-') and exists(select 1 from jsonb_array_elements(row->'source_origins') origin where origin->>'native_case_id'=row->>'native_case_id')))) then raise exception 'DocketBird parent or availability mismatch'; end if;
  -- Explicit JSON null is an unknown source seal status: recorded as 'unknown', never a hold;
  -- missing/string values never become false or an unsealed assertion.
  if row->>'provider'='courtlistener' and ((row->'provider_flags'->'is_available') is distinct from 'true'::jsonb or ((row->'provider_flags'->'is_sealed') is distinct from 'false'::jsonb and (row->'provider_flags'->'is_sealed') is distinct from 'null'::jsonb) or coalesce(row->>'native_case_id','') !~ '^[1-9][0-9]*$' or coalesce(row->>'native_document_id','') !~ '^[1-9][0-9]*$') then raise exception 'Unavailable CourtListener original'; end if;
  if row->>'provider'='courtlistener-public-locator' and (row->>'native_document_identity_kind' is distinct from 'publisher_observed_pdf_locator_url'
   or row->>'native_document_id' is distinct from row->>'durable_url'
   or coalesce(row->>'native_document_id','') !~ '^https://storage[.]courtlistener[.]com/recap/[^?#[:space:]]+[.]pdf$'
   or coalesce(row->>'native_case_id','') !~ '^[1-9][0-9]*$'
   or row->'provider_flags'->'public_pdf_link_observed' is distinct from 'true'::jsonb
   or row->'provider_flags'->'sealing_related_locator_held' is distinct from 'false'::jsonb
   or row->'provider_flags'->'backend_api_id_verified' is distinct from 'false'::jsonb
   or row->'provider_flags'->'api_availability_verified' is distinct from 'false'::jsonb) then raise exception 'Observed public RECAP locator identity required'; end if;
  if row->>'provider'='official-court' and (row->'provider_flags'->'sealing_related_locator_held') is distinct from 'false'::jsonb then raise exception 'Sealing-related locator held'; end if;
  -- govinfo (U.S. GPO USCOURTS collection): the granule id is the document identity, the URL must be exactly that granule's PDF, native_case_id is the printed case number (never empty), and the
  -- not-sealing-related flag must be explicitly false. Granule ids: USCOURTS-<court>-<office>_<yy>-<type>-<seq>-<part>; the package id is the granule id without the trailing part number.
  if row->>'provider'='govinfo' and ((row->'provider_flags'->'sealing_related_locator_held') is distinct from 'false'::jsonb
   or coalesce(length(row->>'native_case_id'),0) not between 1 and 200
   or coalesce(row->>'native_document_id','') !~ '^USCOURTS-[a-z0-9]+-[0-9]{1,2}_[0-9]{2}-[A-Za-z]{1,5}-[0-9]{3,6}-[0-9]{1,6}$'
   or row->>'durable_url' is distinct from ('https://www.govinfo.gov/content/pkg/'||regexp_replace(row->>'native_document_id','-[0-9]{1,6}$','')||'/pdf/'||(row->>'native_document_id')||'.pdf')) then raise exception 'GovInfo granule identity or sealing flag mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(row->'source_origins') origin where jsonb_typeof(origin) is distinct from 'object' or jsonb_typeof(origin->'native_record_sha256') is distinct from 'string' or coalesce(origin->>'native_record_sha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(coalesce(nullif(origin->'source_response_sha256','null'::jsonb),origin->'source_sha256')) is distinct from 'string' or coalesce(origin->>'source_response_sha256',origin->>'source_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(origin->>'retrieved_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or (origin ? 'native_case_id' and origin->>'native_case_id' is distinct from row->>'native_case_id')) then raise exception 'Original provenance digest or parent required'; end if;
  perform (origin->>'retrieved_at')::timestamptz from jsonb_array_elements(row->'source_origins') origin;
  if not exists(select 1 from jsonb_array_elements(row->'source_origins') origin where origin->>'native_record_sha256'=row->>'selected_source_record_sha256') then raise exception 'Selected source version not observed'; end if;
  select count(*) into matched from storage.objects o join storage.buckets b on b.id=o.bucket_id where o.bucket_id='corpus-originals' and b.public=false and o.name=row->>'storage_key' and (o.metadata->>'size')::bigint=(row->>'bytes')::bigint;
  if matched<>1 then raise exception 'Private stored original not found at verified size'; end if;
  insert into corpus_ingest.pdf_objects(sha256,sha1,bytes,bucket,storage_key,first_verified_at)
   values(row->>'sha256',row->>'sha1',(row->>'bytes')::bigint,row->>'bucket',row->>'storage_key',(row->>'verified_at')::timestamptz) on conflict(sha256) do nothing;
  select * into object_row from corpus_ingest.pdf_objects where sha256=row->>'sha256';
  if object_row.sha1 is distinct from row->>'sha1' or object_row.bytes is distinct from (row->>'bytes')::bigint or object_row.storage_key is distinct from row->>'storage_key' then raise exception 'Immutable PDF byte identity conflict'; end if;
  insert into corpus_ingest.pdf_document_assets(source_system,native_document_id,native_case_id,sha256,source_record_sha256,queue_sha256,durable_url,provider_flags,origins,verified_at)
   values(row->>'provider',row->>'native_document_id',row->>'native_case_id',row->>'sha256',row->>'selected_source_record_sha256',row->>'queue_sha256',row->>'durable_url',row->'provider_flags',row->'source_origins',(row->>'verified_at')::timestamptz) on conflict do nothing;
  select * into asset_row from corpus_ingest.pdf_document_assets where source_system=row->>'provider' and native_document_id=row->>'native_document_id' and source_record_sha256=row->>'selected_source_record_sha256' and sha256=row->>'sha256';
  if asset_row.native_case_id is distinct from row->>'native_case_id' or asset_row.durable_url is distinct from row->>'durable_url' or asset_row.provider_flags is distinct from row->'provider_flags' then raise exception 'Immutable native PDF association conflict'; end if;
  -- Owner decision 2026-10-27 ("dont withhold any data"): the observation records the source's own seal status and
  -- nothing else. No quarantine or projection verdict is stamped, and a qualification object carried in by a queue row
  -- is dropped. Availability is decided only by public.corpus_pdf_availability_v1 on the explicit provider_flags.
  stored_observation:=(row-'source_privacy_qualification')||jsonb_build_object('source_seal_status',case when row->>'provider'='courtlistener-public-locator' or (row->>'provider'='courtlistener' and row->'provider_flags'->'is_sealed'='null'::jsonb) or (row->>'provider'='docketbird' and row->'provider_flags'->'restricted'='null'::jsonb) then 'unknown' when row->>'provider'='courtlistener' then 'explicit_false' when row->>'provider'='docketbird' then 'provider_restricted_false' else 'source_locator_not_sealing_related' end);
  observation_digest:=encode(extensions.digest(convert_to(stored_observation::text,'UTF8'),'sha256'),'hex');
  insert into corpus_ingest.pdf_asset_observations(observation_sha256,source_system,native_document_id,source_record_sha256,sha256,queue_sha256,verified_at,observation)
   values(observation_digest,row->>'provider',row->>'native_document_id',row->>'selected_source_record_sha256',row->>'sha256',row->>'queue_sha256',(row->>'verified_at')::timestamptz,stored_observation) on conflict(observation_sha256) do nothing;
  n:=n+1;
 end loop;
 return jsonb_build_object('received',n,'private_only',true,'bucket','corpus-originals');
end $function$;

revoke all on function public.corpus_admin_register_pdf_assets_v1(jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_register_pdf_assets_v1(jsonb) to service_role;

comment on table corpus_ingest.pdf_asset_observations is 'Repeated verified observations of a native PDF association. Observations registered before 2026-10-27 carry observation.source_privacy_qualification (private_quarantine_required, public_projection_allowed=false); that is a historical intake annotation, not a hold. From 2026-10-27 only observation.source_seal_status is recorded. Availability comes only from public.corpus_pdf_availability_v1 on pdf_document_assets.provider_flags.';
comment on column corpus_ingest.local_pdf_asset_occurrences.private_quarantine_required is 'Historical intake annotation forced true by the v1 contract for every local bundle occurrence. Not a hold: no reader gates on it (owner decision 2026-10-27).';
comment on column corpus_ingest.local_pdf_asset_occurrences.public_projection_allowed is 'Historical intake annotation forced false by the v1 contract for every local bundle occurrence. Not a hold: no reader gates on it (owner decision 2026-10-27).';
comment on column corpus_ingest.local_pdf_asset_occurrences.source_seal_status is 'Seal status as recorded in the firm''s local bundle. Only ''locally_flagged_sealed'' is an explicit seal flag and is used for exclusion; ''unknown_local_blank'' and ''unknown_local_literal'' mean the bundle recorded nothing and are not holds.';
