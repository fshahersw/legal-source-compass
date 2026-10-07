-- The matter PDF reader pages by a turn inside each requested case id, then by case id.
-- A case id with a few documents is therefore inside the application's 20,000-row read even when
-- another requested id has tens of thousands of rows. The summary still counts every source record.
-- Rows past the cap stay unread; a large case id is not loaded in full to reach a smaller one.
--
-- Replaces the page order of public.corpus_matter_pdf_documents_v1. Signature, availability rule,
-- and grants are unchanged.

create or replace function public.corpus_matter_pdf_documents_v1(
  p_native_case_ids text[],
  p_limit integer default 200,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
       where a.source_system in ('docketbird', 'courtlistener', 'official-court', 'courtlistener-public-locator', 'govinfo')
         and a.native_case_id = any (p_native_case_ids)
    ), picked as (
      select distinct on (source_system, native_document_id) *
        from docs
       order by source_system, native_document_id, (availability = 'open') desc, verified_at desc
    ), ranked as (
      select *,
             row_number() over (
               partition by native_case_id
               order by native_document_id, source_system
             ) as turn
        from picked
    ), page as (
      select * from ranked
       order by turn, native_case_id, native_document_id, source_system
       limit p_limit offset p_offset
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
               ) order by turn, native_case_id, native_document_id, source_system) from page), '[]'::jsonb),
      'offset', p_offset,
      'limit', p_limit
    )
  );
end $$;

revoke all on function public.corpus_matter_pdf_documents_v1(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.corpus_matter_pdf_documents_v1(text[], integer, integer) to service_role;
