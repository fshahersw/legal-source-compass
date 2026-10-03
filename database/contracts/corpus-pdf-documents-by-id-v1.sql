-- corpus-pdf-documents-by-id-v1.sql
-- Applied 2026-10-03 by the orchestrator as migration `corpus_pdf_documents_by_id_v1` (corpussite xosqzzsnhxcyehcnirpa).
-- Per-document PDF registry lookup for the app server: the docket timeline maps an entry's exact provider document ids
-- to stored PDFs without building a per-matter index. Read-only, service_role only. Same availability rule and row shape
-- as public.corpus_matter_pdf_documents_v1; held rows carry no hash, size or URL.
-- Verified after apply: anon/authenticated have no EXECUTE; 6 requested (5 real + 1 unknown) -> found 5.
-- Rollback: drop function public.corpus_pdf_documents_by_id_v1(text, text[]);

create or replace function public.corpus_pdf_documents_by_id_v1(p_source_system text, p_native_document_ids text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_source_system is null or p_source_system not in ('docketbird', 'courtlistener', 'official-court', 'courtlistener-public-locator', 'govinfo') then
    raise exception 'Unknown source system';
  end if;
  if p_native_document_ids is null or cardinality(p_native_document_ids) not between 1 and 500 then
    raise exception 'Bounded native document id list required';
  end if;
  return (
    with docs as (
      select a.source_system, a.native_document_id, a.native_case_id, a.sha256, o.bytes, a.durable_url, a.verified_at,
             public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) as availability
        from corpus_ingest.pdf_document_assets a
        join corpus_ingest.pdf_objects o on o.sha256 = a.sha256
       where a.source_system = p_source_system
         and a.native_document_id = any (p_native_document_ids)
    ), picked as (
      select distinct on (native_document_id) *
        from docs
       order by native_document_id, (availability = 'open') desc, verified_at desc
    )
    select jsonb_build_object(
      'requested', cardinality(p_native_document_ids),
      'found', (select count(*) from picked),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'source_system', source_system,
          'native_document_id', native_document_id,
          'native_case_id', native_case_id,
          'availability', availability,
          'sha256', case when availability = 'open' then sha256 end,
          'bytes', case when availability = 'open' then bytes end,
          'public_url', case when availability = 'open' then durable_url end,
          'verified_at', verified_at
        ) order by native_document_id) from picked), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.corpus_pdf_documents_by_id_v1(text, text[]) from public, anon, authenticated;
grant execute on function public.corpus_pdf_documents_by_id_v1(text, text[]) to service_role;
