-- Official-court MDL documents with the printed title / date / document number the court showed (read-only projection for the application server).
-- Author: official-mdl agent, 2026-10-03.
--
-- Why: corpus_matter_pdf_documents_v1 lists the private PDF registry by native case id but carries no title or date. The official-mdl adapter stores, in every
-- `origins[]` element of an `official-court` asset, the court listing row it came from (`origins[].listing`: printed title, printed date + ISO reading and its basis,
-- Doc.#, order label, section, page URL). This function surfaces exactly that, additively (no table is created or altered).
--   * service_role only, SECURITY DEFINER, search_path = '', bounded, read-only (same posture as corpus_matter_pdf_read_v1)
--   * availability is the registry's own rule (corpus_pdf_availability_v1): official-court rows are 'open' only when sealing_related_locator_held = false
--   * a held row never returns a hash, size or public URL; sha256/storage identity is resolved server-side by corpus_matter_pdf_object_v1 (not here)
--   * rows registered before the adapter (no `listing` in any origin) are not returned; corpus_matter_pdf_documents_v1 still lists them
--   * the printed title is clipped to 500 characters (printed_title_chars keeps the original length); nothing is paraphrased
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
$official_mdl_documents_v1$;

revoke all on function public.corpus_official_mdl_documents_v1(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.corpus_official_mdl_documents_v1(text[], integer, integer) to service_role;
