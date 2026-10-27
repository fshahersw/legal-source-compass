-- Rollback for corpus-pdf-availability-v2.sql: the live v1 definition captured with pg_get_functiondef on 2026-10-27.
create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_provider_flags -> 'withheld_by_policy' = 'true'::jsonb then 'held'
    when p_source_system = 'docketbird'
      and p_provider_flags -> 'restricted' = 'false'::jsonb
      and p_provider_flags -> 'downloaded' in ('1'::jsonb, 'true'::jsonb) then 'open'
    when p_source_system = 'courtlistener'
      and p_provider_flags -> 'is_available' = 'true'::jsonb
      and p_provider_flags -> 'is_sealed' = 'false'::jsonb then 'open'
    when p_source_system = 'official-court'
      and p_provider_flags -> 'sealing_related_locator_held' = 'false'::jsonb then 'open'
    when p_source_system = 'govinfo'
      and p_provider_flags -> 'sealing_related_locator_held' = 'false'::jsonb then 'open'
    else 'held'
  end
$function$;

revoke all on function public.corpus_pdf_availability_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_pdf_availability_v1(text, jsonb) to service_role;
