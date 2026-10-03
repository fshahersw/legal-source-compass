-- Applied 2026-10-03 by orchestrator as migration corpus_matter_pdf_read_v1 (SQL unchanged from this file).
-- Read-only matter PDF projection for the application server.
-- Author: ui-integration agent, 2026-10-03.
--
-- Why: the corpus PostgREST exposes only `public`; `corpus_ingest.pdf_document_assets` / `pdf_objects` are
-- unreachable from the app's server key, so matter pages cannot list or stream the verified PDF registry.
-- These functions are additive (no table is created or altered), SECURITY DEFINER, service_role only,
-- bounded, and read-only. They expose only what the registry itself qualifies as openly displayable:
--   * docketbird          : provider_flags.restricted = false AND downloaded in (1,true)
--   * courtlistener       : is_available = true AND is_sealed = false
--   * official-court      : sealing_related_locator_held = false (public court-posted order)
--   * everything else (unknown seal status, courtlistener-public-locator, restricted = null) => 'held'
-- Held rows never return a hash, size or storage key. Immutable byte identity (sha256 -> storage_key) is
-- resolved server-side only and is never sent to the browser.

create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text language sql immutable set search_path = ''
as $$
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
$$;

-- One row per native document (an open association wins over a held one) for an explicit list of native case ids.
create or replace function public.corpus_matter_pdf_documents_v1(
  p_native_case_ids text[],
  p_limit integer default 200,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
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
end $$;

-- Storage lookup for the streaming route. Returns null when unknown, {availability:'held'} when held,
-- {availability:'open', sha256, bytes, bucket, storage_key} otherwise.
create or replace function public.corpus_matter_pdf_object_v1(p_source_system text, p_native_document_id text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
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
end $$;

revoke all on function public.corpus_pdf_availability_v1(text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_matter_pdf_documents_v1(text[], integer, integer) from public, anon, authenticated;
revoke all on function public.corpus_matter_pdf_object_v1(text, text) from public, anon, authenticated;
grant execute on function public.corpus_pdf_availability_v1(text, jsonb) to service_role;
grant execute on function public.corpus_matter_pdf_documents_v1(text[], integer, integer) to service_role;
grant execute on function public.corpus_matter_pdf_object_v1(text, text) to service_role;
