-- corpus-pdf-availability-v2.sql
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- The v1 rule opened a PDF only when every provider flag was explicitly safe, and never opened source_system
-- 'courtlistener-public-locator'. On 2026-10-27 that held 142,553 stored PDFs, and none of them carried a sealed or
-- restricted flag from its source:
--   courtlistener-public-locator 101,424 (13,031 explicitly is_sealed=false; all on storage.courtlistener.com RECAP)
--   courtlistener                 27,696 (is_available=true, is_sealed not reported)
--   docketbird                    13,432 (restricted not reported; availability_evidence publisher_search_pdf_locator)
--   official-court                     1
-- Every one of them has its bytes in corpus_ingest.pdf_objects.
--
-- v2 holds a PDF only on explicit evidence: an owner/admin policy hold (withheld_by_policy, set by
-- corpus_admin_withhold_pdf_sha256_v1), a source-reported seal (is_sealed), a source-reported restriction
-- (restricted), or a sealing-related locator (sealing_related_locator_held). Everything else is open.
-- Same name, signature, language, volatility, search_path and grants; every reader (matter documents, object
-- streaming, text pages, text search, documents refresh) already goes through this function.
-- Rollback: corpus-pdf-availability-v2.rollback.sql (the live v1 text, verbatim).

create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_provider_flags -> 'withheld_by_policy' = 'true'::jsonb then 'held'
    when p_provider_flags -> 'is_sealed' = 'true'::jsonb then 'held'
    when p_provider_flags -> 'restricted' = 'true'::jsonb then 'held'
    when p_provider_flags -> 'sealing_related_locator_held' = 'true'::jsonb then 'held'
    when p_source_system in ('docketbird', 'courtlistener', 'courtlistener-public-locator', 'official-court', 'govinfo') then 'open'
    else 'held'
  end
$function$;

revoke all on function public.corpus_pdf_availability_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_pdf_availability_v1(text, jsonb) to service_role;
