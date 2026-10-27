-- corpus-register-pdf-assets-v2.sql
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- Release category pdf-observation-privacy-label. public.corpus_admin_register_pdf_assets_v1 stamps every
-- corpus_ingest.pdf_asset_observations.observation with source_privacy_qualification. The live (v1) label says
-- public_projection_allowed=false for every row and private_quarantine_required=true whenever the source did not report
-- a seal/restriction status (CourtListener is_sealed=null, DocketBird restricted=null, every courtlistener-public-locator
-- row). That is the caution rule the owner withdrew; corpus_pdf_availability_v2 (applied 2026-10-27) already serves
-- those PDFs. No function, view or materialized view reads the label, so it gates nothing; it is stale and could mislead a
-- future builder into re-hiding open PDFs. Live on 2026-10-27: 204,823 observations, 142,552 private_quarantine_required=true
-- (courtlistener-public-locator 101,424, courtlistener 27,696, docketbird 13,432), 204,823 public_projection_allowed=false,
-- while corpus_pdf_availability_v1 answers 'open' for 204,822 of them (1 held: official-court, withheld_by_policy=true).
--
-- What changes (everything else is the live text, byte for byte; same name, signature, SECURITY DEFINER,
-- search_path, return value and grants, so scripts/admin/register-private-pdf-assets.mjs needs no change):
--   1. New observations record the live availability rule instead of the caution quarantine:
--        source_privacy_qualification = {
--          rule: 'corpus_pdf_availability_v2',
--          source_seal_status: unchanged descriptive value (unknown | explicit_false | provider_restricted_false |
--                              source_locator_not_sealing_related): what the source reported, nothing inferred,
--          availability: public.corpus_pdf_availability_v1(source_system, provider_flags) of the stored asset row,
--          public_projection_allowed: availability = 'open',
--          hold_basis: the explicit flag that holds it (withheld_by_policy | is_sealed | restricted |
--                      sealing_related_locator_held), 'source_system_not_listed', or null when open }
--      private_quarantine_required is no longer written. The label is a registration-time snapshot; the live gate stays
--      public.corpus_pdf_availability_v1, evaluated at read time (an admin withhold after registration still holds).
--   2. Replay idempotency is kept: if the receipt was already observed under the v1 label (its v1 observation digest exists
--      in pdf_asset_observations, a primary-key lookup) no second observation is written. Read-only proof 2026-10-27: the v1
--      digest recomputed from (observation - 'source_privacy_qualification') reproduces observation_sha256 for 204,823 of
--      204,823 rows.
-- Existing observations are NOT rewritten: they are content-hash addressed. Their v1 label is historical (AGENTS.md).
-- Not changed: public.corpus_admin_register_local_bundle_pdf_assets_v1. Its private_quarantine_required/public_projection_allowed
-- values are part of hash-pinned frozen packet occurrences (local_pdf_asset_expected_occurrences) and table CHECKs; those
-- 752 local occurrences carry no publisher-native document identity (native_document_id null). 12 are locally_flagged_sealed
-- (documents_refresh_v1 leaves those bytes out). 11 of the 12 have no open publisher-native asset; the 12th
-- (sha256 d72dd3fe...2415cca) is also DocketBird txed-4:2025-cv-01277-00023, restricted=false and open on the PDF
-- readers: the bundle's seal note appears to describe that entry's attachment #1, not this main document (lead/owner decision). Of the 740 unknown_local_blank, 450 share bytes with a
-- publisher-native asset that is already open; the other 290 stay out on the exact-link rule, not on caution.
-- Rollback: corpus-register-pdf-assets-v2.rollback.sql (live v1 text, md5 beaf86b57d3ffadee3f029bbe93b7fb6).
-- Verify: corpus-register-pdf-assets-v2-verify.sql (after apply, md5 of pg_get_functiondef = f245cb3985cf2b2bf13a6f357fb828a1).
CREATE OR REPLACE FUNCTION public.corpus_admin_register_pdf_assets_v1(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row jsonb; object_row corpus_ingest.pdf_objects; asset_row corpus_ingest.pdf_document_assets; stored_observation jsonb; observation_digest text; n integer:=0; matched integer; legacy_observation jsonb; pdf_availability text;
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
  -- Explicit JSON null is an unknown source seal status: recorded as unknown, never a hold (owner decision 2026-10-27);
  -- missing/string values never become false or a public unsealed assertion.
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
  -- Replay guard: a receipt already observed under the historical v1 label (same row, v1 digest) is not observed twice.
  legacy_observation:=row||jsonb_build_object('source_privacy_qualification',jsonb_build_object(
   'source_seal_status',case when row->>'provider'='courtlistener-public-locator' or (row->>'provider'='courtlistener' and row->'provider_flags'->'is_sealed'='null'::jsonb) or (row->>'provider'='docketbird' and row->'provider_flags'->'restricted'='null'::jsonb) then 'unknown' when row->>'provider'='courtlistener' then 'explicit_false' when row->>'provider'='docketbird' then 'provider_restricted_false' else 'source_locator_not_sealing_related' end,
   'private_quarantine_required',row->>'provider'='courtlistener-public-locator' or (row->>'provider'='courtlistener' and row->'provider_flags'->'is_sealed'='null'::jsonb) or (row->>'provider'='docketbird' and row->'provider_flags'->'restricted'='null'::jsonb),
   'public_projection_allowed',false));
  if exists(select 1 from corpus_ingest.pdf_asset_observations where observation_sha256=encode(extensions.digest(convert_to(legacy_observation::text,'UTF8'),'sha256'),'hex')) then n:=n+1; continue; end if;
  -- Owner decision 2026-10-27: the label records the live availability rule (explicit source seal/restriction,
  -- sealing-related locator or owner/admin policy hold only), never a caution quarantine for unreported status.
  pdf_availability:=public.corpus_pdf_availability_v1(asset_row.source_system,asset_row.provider_flags);
  stored_observation:=row||jsonb_build_object('source_privacy_qualification',jsonb_build_object(
   'rule','corpus_pdf_availability_v2',
   'source_seal_status',legacy_observation->'source_privacy_qualification'->'source_seal_status',
   'availability',pdf_availability,
   'public_projection_allowed',pdf_availability='open',
   'hold_basis',case when pdf_availability='open' then null
    else coalesce((select k from unnest(array['withheld_by_policy','is_sealed','restricted','sealing_related_locator_held']) with ordinality u(k,i)
     where coalesce(asset_row.provider_flags->k,'null'::jsonb) not in ('false'::jsonb,'null'::jsonb) order by i limit 1),'source_system_not_listed') end));
  observation_digest:=encode(extensions.digest(convert_to(stored_observation::text,'UTF8'),'sha256'),'hex');
  insert into corpus_ingest.pdf_asset_observations(observation_sha256,source_system,native_document_id,source_record_sha256,sha256,queue_sha256,verified_at,observation)
   values(observation_digest,row->>'provider',row->>'native_document_id',row->>'selected_source_record_sha256',row->>'sha256',row->>'queue_sha256',(row->>'verified_at')::timestamptz,stored_observation) on conflict(observation_sha256) do nothing;
  n:=n+1;
 end loop;
 return jsonb_build_object('received',n,'private_only',true,'bucket','corpus-originals');
end $function$;

revoke all on function public.corpus_admin_register_pdf_assets_v1(jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_register_pdf_assets_v1(jsonb) to service_role;
