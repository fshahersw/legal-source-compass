-- public.corpus_sw_matter_case_ids_v1 — flat, call-ready native case ids per docket of a registry matter (contract sw-matter-registry/1, section 6.5).
-- v1 (migration corpus_sw_matter_case_ids_v1, 2026-10-03 11:48Z) returned provider, source_system, id.
-- v1.2 (migration corpus_sw_matter_case_ids_v1_resolution_basis, 2026-10-03 ~13:05Z) adds, per native case id:
--   resolution_basis  how the id was tied to the docket (exact_docket_key, provider_native_id, ambiguous_same_docket_key_multiple_courtlistener_dockets, ...)
--   pdf_lookup        false when the id's own provider header conflicts with the master identity (resolution_basis contains 'header_conflicts');
--                     such ids must not be passed to corpus_matter_pdf_documents_v1 as the matter's PDFs.
-- Read-only; reads only the published (ready) projection; SECURITY DEFINER with an empty search_path; service_role only.
create or replace function public.corpus_sw_matter_case_ids_v1(p_mdl text, p_roles text[] default null, p_limit integer default 500, p_offset integer default 0)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with published as (
    select 1 from public.corpus_datasets d where d.id = 'sw_matter_dockets_v1' and d.ready
  ), scoped as (
    select r.ordinal, r.detail->'registry' as reg, r.item->'cells' as cells
    from public.corpus_records r
    where exists (select 1 from published) and r.dataset = 'sw_matter_dockets_v1'
      and r.filters->>'mdl' = p_mdl
      and (p_roles is null or (r.filters->>'role') = any (p_roles))
  ), page as (
    select * from scoped order by ordinal limit least(greatest(p_limit, 1), 2000) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'matter', p_mdl,
    'total', (select count(*) from scoped),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'role', reg->>'role', 'docket_key', reg->>'docket_key', 'court_id', cells->>'court_id', 'docket_number', cells->>'docket_number',
        'route', reg->>'route', 'basis', reg->'membership_basis', 'evidence_count', jsonb_array_length(reg->'evidence'),
        'native_case_ids', (select coalesce(jsonb_agg(jsonb_build_object('provider', n->>'provider', 'source_system', n->>'source_system', 'id', n->>'id',
              'resolution_basis', n->>'resolution_basis', 'pdf_lookup', coalesce(n->>'resolution_basis', '') !~ 'header_conflicts')), '[]'::jsonb)
            from jsonb_array_elements(reg->'native_case_ids') n)
      ) order by ordinal) from page), '[]'::jsonb)
  );
$function$;

revoke all on function public.corpus_sw_matter_case_ids_v1(text, text[], integer, integer) from public, anon, authenticated;
grant execute on function public.corpus_sw_matter_case_ids_v1(text, text[], integer, integer) to service_role;
