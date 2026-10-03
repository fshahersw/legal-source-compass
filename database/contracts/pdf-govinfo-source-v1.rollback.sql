-- pdf-govinfo-source-v1.rollback.sql
-- Restores the LIVE definitions captured with pg_get_functiondef on 2026-10-03 ~17:10Z (verbatim) and the previous CHECK constraint.
-- Order: functions first (they are always safe), then the constraint ONLY if no govinfo row exists. Rows are never deleted to make a rollback possible:
--   select count(*) from corpus_ingest.pdf_document_assets where source_system = 'govinfo';   -- must be 0 before the constraint step
-- With govinfo rows present, run only the function part and leave the widened constraint in place (it is harmless: it only allows one more source_system value).

-- corpus_pdf_availability_v1 (live definition)
CREATE OR REPLACE FUNCTION public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_source_system = 'docketbird'
      and p_provider_flags -> 'restricted' = 'false'::jsonb
      and p_provider_flags -> 'downloaded' in ('1'::jsonb, 'true'::jsonb) then 'open'
    when p_source_system = 'courtlistener'
      and p_provider_flags -> 'is_available' = 'true'::jsonb
      and p_provider_flags -> 'is_sealed' = 'false'::jsonb then 'open'
    when p_source_system = 'official-court'
      and p_provider_flags -> 'sealing_related_locator_held' = 'false'::jsonb then 'open'
    else 'held'
  end
$function$;

-- corpus_matter_pdf_object_v1 (live definition)
CREATE OR REPLACE FUNCTION public.corpus_matter_pdf_object_v1(p_source_system text, p_native_document_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_source_system is null or p_source_system not in ('docketbird', 'courtlistener', 'official-court', 'courtlistener-public-locator')
     or p_native_document_id is null or length(p_native_document_id) not between 1 and 500 then
    return null;
  end if;
  select a.sha256, o.bytes, o.bucket, o.storage_key,
         public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) as availability
    into r
    from corpus_ingest.pdf_document_assets a
    join corpus_ingest.pdf_objects o on o.sha256 = a.sha256
   where a.source_system = p_source_system and a.native_document_id = p_native_document_id
   order by (public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open') desc, a.verified_at desc
   limit 1;
  if not found then return null; end if;
  if r.availability <> 'open' then return jsonb_build_object('availability', 'held'); end if;
  return jsonb_build_object('availability', 'open', 'sha256', r.sha256, 'bytes', r.bytes, 'bucket', r.bucket, 'storage_key', r.storage_key);
end $function$;

-- corpus_matter_pdf_documents_v1 (live definition)
CREATE OR REPLACE FUNCTION public.corpus_matter_pdf_documents_v1(p_native_case_ids text[], p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_native_case_ids is null or cardinality(p_native_case_ids) not between 1 and 50 then
    raise exception 'Bounded native case id list required';
  end if;
  if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset < 0 then
    raise exception 'Bounded page required';
  end if;
  return (
    with docs as (
      select a.source_system, a.native_document_id, a.native_case_id, a.sha256, o.bytes, a.durable_url, a.verified_at,
             public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) as availability
        from corpus_ingest.pdf_document_assets a
        join corpus_ingest.pdf_objects o on o.sha256 = a.sha256
       where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'courtlistener-public-locator')
         and a.native_case_id = any (p_native_case_ids)
    ), picked as (
      select distinct on (source_system, native_document_id) *
        from docs
       order by source_system, native_document_id, (availability = 'open') desc, verified_at desc
    ), page as (
      select * from picked order by native_case_id, native_document_id, source_system limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'total', (select count(*) from picked),
        'open', (select count(*) from picked where availability = 'open'),
        'held', (select count(*) from picked where availability = 'held'),
        'open_bytes', (select coalesce(sum(bytes), 0) from picked where availability = 'open'),
        'by_source', (select coalesce(jsonb_object_agg(source_system, n), '{}'::jsonb)
                        from (select source_system, count(*) as n from picked group by source_system) s)
      ),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                 'source_system', source_system,
                 'native_document_id', native_document_id,
                 'native_case_id', native_case_id,
                 'availability', availability,
                 'sha256', case when availability = 'open' then sha256 end,
                 'bytes', case when availability = 'open' then bytes end,
                 'public_url', case when availability = 'open' then durable_url end,
                 'verified_at', verified_at
               ) order by native_case_id, native_document_id, source_system) from page), '[]'::jsonb),
      'offset', p_offset,
      'limit', p_limit
    )
  );
end $function$;

-- corpus_admin_register_pdf_assets_v1 (live definition)
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
   or row->>'provider' not in ('docketbird','courtlistener','official-court','courtlistener-public-locator') or row->>'provider' is null
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
  -- Explicit JSON null is an unknown source seal status, retained privately;
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
  stored_observation:=row||jsonb_build_object('source_privacy_qualification',jsonb_build_object(
   'source_seal_status',case when row->>'provider'='courtlistener-public-locator' or (row->>'provider'='courtlistener' and row->'provider_flags'->'is_sealed'='null'::jsonb) or (row->>'provider'='docketbird' and row->'provider_flags'->'restricted'='null'::jsonb) then 'unknown' when row->>'provider'='courtlistener' then 'explicit_false' when row->>'provider'='docketbird' then 'provider_restricted_false' else 'source_locator_not_sealing_related' end,
   'private_quarantine_required',row->>'provider'='courtlistener-public-locator' or (row->>'provider'='courtlistener' and row->'provider_flags'->'is_sealed'='null'::jsonb) or (row->>'provider'='docketbird' and row->'provider_flags'->'restricted'='null'::jsonb),
   'public_projection_allowed',false));
  observation_digest:=encode(extensions.digest(convert_to(stored_observation::text,'UTF8'),'sha256'),'hex');
  insert into corpus_ingest.pdf_asset_observations(observation_sha256,source_system,native_document_id,source_record_sha256,sha256,queue_sha256,verified_at,observation)
   values(observation_digest,row->>'provider',row->>'native_document_id',row->>'selected_source_record_sha256',row->>'sha256',row->>'queue_sha256',(row->>'verified_at')::timestamptz,stored_observation) on conflict(observation_sha256) do nothing;
  n:=n+1;
 end loop;
 return jsonb_build_object('received',n,'private_only',true,'bucket','corpus-originals');
end $function$;

-- corpus_official_mdl_documents_v1 (previous definition, as created by database/contracts/corpus-official-mdl-documents-v1.sql)
create or replace function public.corpus_official_mdl_documents_v1(
  p_native_case_ids text[] default null,
  p_limit integer default 200,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $official_mdl_documents_v1$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_native_case_ids is not null and cardinality(p_native_case_ids) not between 1 and 50 then
    raise exception 'Bounded native case id list required';
  end if;
  if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset < 0 then
    raise exception 'Bounded page required';
  end if;
  return (
    with docs as (
      select a.native_document_id, a.native_case_id, a.sha256, o.bytes, a.durable_url, a.verified_at,
             public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) as availability,
             (select x from jsonb_array_elements(a.origins) x where x ? 'listing' order by x ->> 'retrieved_at' desc limit 1) as origin
        from corpus_ingest.pdf_document_assets a
        join corpus_ingest.pdf_objects o on o.sha256 = a.sha256
       where a.source_system = 'official-court'
         and (p_native_case_ids is null or a.native_case_id = any (p_native_case_ids))
    ), picked as (
      select distinct on (native_document_id, native_case_id) *
        from docs
       where origin is not null
       order by native_document_id, native_case_id, (availability = 'open') desc, verified_at desc
    ), page as (
      select * from picked order by native_case_id, coalesce(origin -> 'listing' ->> 'date_iso', '9999-12-31'), native_document_id limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'total', (select count(*) from picked),
        'open', (select count(*) from picked where availability = 'open'),
        'held', (select count(*) from picked where availability = 'held'),
        'by_doc_kind', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(origin -> 'listing' ->> 'doc_kind', 'other') as k, count(*) as n from picked group by 1) s)
      ),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'source_system', 'official-court',
          'native_document_id', native_document_id,
          'native_case_id', native_case_id,
          'availability', availability,
          'sha256', case when availability = 'open' then sha256 end,
          'bytes', case when availability = 'open' then bytes end,
          'public_url', case when availability = 'open' then durable_url end,
          'printed_title', left(origin -> 'listing' ->> 'printed_title', 500),
          'printed_title_chars', length(origin -> 'listing' ->> 'printed_title'),
          'printed_label', left(origin -> 'listing' ->> 'printed_label', 200),
          'derived_label', origin -> 'listing' ->> 'derived_label',
          'printed_date', origin -> 'listing' ->> 'printed_date',
          'date_iso', origin -> 'listing' ->> 'date_iso',
          'date_iso_basis', origin -> 'listing' ->> 'date_iso_basis',
          'doc_number', origin -> 'listing' ->> 'doc_number',
          'order_label', origin -> 'listing' ->> 'order_label_printed',
          'order_kind', origin -> 'listing' ->> 'order_kind',
          'order_number', origin -> 'listing' ->> 'order_number',
          'doc_kind', origin -> 'listing' ->> 'doc_kind',
          'section', left(origin -> 'listing' ->> 'section', 200),
          'listing_page_url', origin -> 'listing' ->> 'page_url',
          'listing_page_role', origin -> 'listing' ->> 'page_role',
          'listing_retrieved_at', origin ->> 'retrieved_at',
          'verified_at', verified_at
        ) order by native_case_id, coalesce(origin -> 'listing' ->> 'date_iso', '9999-12-31'), native_document_id) from page), '[]'::jsonb),
      'offset', p_offset,
      'limit', p_limit
    )
  );
end
$official_mdl_documents_v1$;;

revoke all on function public.corpus_official_mdl_documents_v1(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.corpus_official_mdl_documents_v1(text[], integer, integer) to service_role;

-- constraint part (only when no govinfo row exists, see the header)
alter table corpus_ingest.pdf_document_assets
  add constraint pdf_document_assets_source_system_check_old
  check (source_system = any (array['docketbird'::text, 'courtlistener'::text, 'official-court'::text, 'courtlistener-public-locator'::text])) not valid;
alter table corpus_ingest.pdf_document_assets validate constraint pdf_document_assets_source_system_check_old;
alter table corpus_ingest.pdf_document_assets drop constraint pdf_document_assets_source_system_check;
alter table corpus_ingest.pdf_document_assets rename constraint pdf_document_assets_source_system_check_old to pdf_document_assets_source_system_check;
