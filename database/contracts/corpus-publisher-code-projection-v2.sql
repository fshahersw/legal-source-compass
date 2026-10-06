-- publisher-code-projection/2 — the only public read of full state codes landed through
-- publisher-code-intake/2.
--
-- Agreed with the intake contract: every intake row keeps data.public_projection_allowed = false.
-- The gate these functions honor is corpus_ingest.publisher_code_states_v2.public_projection_allowed,
-- which corpus_publisher_code_review_v2 can set only when review_status = 'reviewed'. A state that
-- is still private returns no sections. Nothing here writes, and nothing here returns storage keys,
-- payload hashes, receipts or proxy metadata.
--
-- A section's public identity is the intake native id <JURISDICTION>:<citation_path>
-- (official_citation_path), for example FL:95.11. The state list's edition and currency are the
-- summary from publisher_code_summarize_state_v2 (editions, through_min, through_max).
-- Apply after corpus-publisher-code-intake-v2.sql. Service role only.
begin;

-- True when every path entry matches the hierarchy item at the same position.
-- An empty path matches every hierarchy. Compared with IS NOT DISTINCT FROM so a null number matches.
create or replace function corpus_ingest.publisher_code_path_matches_v2(p_hierarchy jsonb, p_path jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_hierarchy) = 'array'
    and jsonb_array_length(p_hierarchy) >= jsonb_array_length(p_path)
    and (
      jsonb_array_length(p_path) = 0
      or (
        select bool_and(
          (p_hierarchy->(t.ord::integer - 1)->>'level') is not distinct from (t.elem->>'level')
          and (p_hierarchy->(t.ord::integer - 1)->>'number') is not distinct from (t.elem->>'number')
        )
        from jsonb_array_elements(p_path) with ordinality as t(elem, ord)
      )
    );
$$;

create or replace function corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction text)
returns table (
  jurisdiction text,
  publisher text,
  source_system text,
  sections bigint,
  units bigint,
  currency jsonb,
  manifest jsonb
)
language sql stable security definer set search_path = '' as $$
  select st.jurisdiction, st.publisher, st.source_system, st.sections, st.units, st.currency, mm.manifest
  from corpus_ingest.publisher_code_states_v2 st
  join corpus_ingest.publisher_code_manifests_v2 mm on mm.manifest_sha256 = st.current_manifest_sha256
  where st.jurisdiction = p_jurisdiction
    and st.public_projection_allowed
    and st.review_status = 'reviewed'
    and st.source_system is not null;
$$;

-- States whose review flag is on. Empty until a state is reviewed and projection is allowed.
create or replace function public.corpus_publisher_code_projected_states_v2()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jurisdiction', st.jurisdiction,
    'code_title', mm.manifest->>'code_title',
    'publisher', st.publisher,
    'publisher_url', mm.manifest->>'publisher_url',
    'source_system', st.source_system,
    'sections', st.sections,
    'units', st.units,
    'currency', st.currency,
    'structure_levels', mm.manifest->'structure'->'levels'
  ) order by st.jurisdiction), '[]'::jsonb)
  from corpus_ingest.publisher_code_states_v2 st
  join corpus_ingest.publisher_code_manifests_v2 mm on mm.manifest_sha256 = st.current_manifest_sha256
  where st.public_projection_allowed
    and st.review_status = 'reviewed'
    and st.source_system is not null;
$$;

-- Next hierarchy level under a recorded path, or the sections once the path reaches "section".
-- p_path is a jsonb array of {level, number}. number is the publisher's string, or null.
create or replace function public.corpus_publisher_code_projected_outline_v2(
  p_jurisdiction text,
  p_path jsonb default '[]'::jsonb
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare gate record; levels jsonb; depth integer; next_level text; total bigint; direct_total bigint;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$'
    or jsonb_typeof(p_path) is distinct from 'array'
    or jsonb_array_length(p_path) > 12 then
    raise exception 'Jurisdiction and a hierarchy path are required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_path) elem
    where jsonb_typeof(elem) is distinct from 'object'
      or coalesce(elem->>'level', '') !~ '^[a-z][a-z_]{1,40}$'
      or jsonb_typeof(elem->'number') not in ('string', 'null')
  ) then
    raise exception 'Hierarchy path entries must be a level and a number' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction);
  if gate.jurisdiction is null then
    return jsonb_build_object('available', false);
  end if;
  levels := gate.manifest->'structure'->'levels';
  depth := jsonb_array_length(p_path);
  if depth >= jsonb_array_length(levels) then
    raise exception 'Hierarchy path is longer than this code declares' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_path) with ordinality as t(elem, ord)
    where (levels->>((t.ord - 1)::integer)) is distinct from (t.elem->>'level')
  ) then
    raise exception 'Hierarchy path does not follow this code''s declared levels' using errcode = '22023';
  end if;
  next_level := levels->>depth;

  if next_level = 'section' then
    select count(*) into total from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path);
    return jsonb_build_object(
      'available', true, 'kind', 'sections', 'level', 'section', 'total', total,
      'truncated', total > 5000,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'native_id', s.native_id,
          'citation', s.data->>'citation',
          'heading', s.data->>'heading',
          'status_note', s.data->>'status_note'
        ) order by s.native_id)
        from (
          select e.native_id, e.data from corpus_ingest.entities e
          where e.source_system = gate.source_system
            and e.entity_type = 'code-section'
            and e.review_status <> 'quarantined'
            and e.schema_version = 'publisher-code-evidence/2'
            and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          order by e.native_id
          limit 5000
        ) s
      ), '[]'::jsonb));
  end if;

  -- A declared level is optional. Sections that sit here, with no part/article/division
  -- between them and the path, are listed instead of an empty group menu.
  select count(*) into direct_total from corpus_ingest.entities e
  where e.source_system = gate.source_system
    and e.entity_type = 'code-section'
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2'
    and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
    and e.data->'hierarchy'->depth->>'level' = 'section';
  select count(*) into total from (
    select 1 from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
      and e.data->'hierarchy'->depth->>'level' = next_level
    group by e.data->'hierarchy'->depth->>'number', e.data->'hierarchy'->depth->>'heading'
  ) g;
  if total = 0 and direct_total > 0 then
    return jsonb_build_object(
      'available', true, 'kind', 'sections', 'level', 'section', 'total', direct_total,
      'truncated', direct_total > 5000,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'native_id', s.native_id,
          'citation', s.data->>'citation',
          'heading', s.data->>'heading',
          'status_note', s.data->>'status_note'
        ) order by s.native_id)
        from (
          select e.native_id, e.data from corpus_ingest.entities e
          where e.source_system = gate.source_system
            and e.entity_type = 'code-section'
            and e.review_status <> 'quarantined'
            and e.schema_version = 'publisher-code-evidence/2'
            and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
            and e.data->'hierarchy'->depth->>'level' = 'section'
          order by e.native_id
          limit 5000
        ) s
      ), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'available', true, 'kind', 'groups', 'level', next_level, 'total', total,
    'truncated', total > 2000,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', g.number, 'heading', g.heading, 'count', g.n
      ) order by g.number, g.heading)
      from (
        select e.data->'hierarchy'->depth->>'number' as number,
               e.data->'hierarchy'->depth->>'heading' as heading,
               count(*) as n
        from corpus_ingest.entities e
        where e.source_system = gate.source_system
          and e.entity_type = 'code-section'
          and e.review_status <> 'quarantined'
          and e.schema_version = 'publisher-code-evidence/2'
          and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          and e.data->'hierarchy'->depth->>'level' = next_level
        group by 1, 2
        order by 1, 2
        limit 2000
      ) g
    ), '[]'::jsonb),
    'direct_total', direct_total,
    'direct_truncated', direct_total > 5000,
    'direct_sections', case when direct_total = 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'native_id', s.native_id,
        'citation', s.data->>'citation',
        'heading', s.data->>'heading',
        'status_note', s.data->>'status_note'
      ) order by s.native_id)
      from (
        select e.native_id, e.data from corpus_ingest.entities e
        where e.source_system = gate.source_system
          and e.entity_type = 'code-section'
          and e.review_status <> 'quarantined'
          and e.schema_version = 'publisher-code-evidence/2'
          and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
          and e.data->'hierarchy'->depth->>'level' = 'section'
        order by e.native_id
        limit 5000
      ) s
    ), '[]'::jsonb) end);
end $$;

-- One published section. Null when the state is not projected or the id is not one of its sections.
create or replace function public.corpus_publisher_code_projected_section_v2(p_jurisdiction text, p_native_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare gate record; row corpus_ingest.entities; source text;
begin
  if coalesce(p_jurisdiction, '') !~ '^[A-Z]{2}$' or length(coalesce(p_native_id, '')) not between 4 and 512 then
    raise exception 'Jurisdiction and section id are required' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction);
  if gate.jurisdiction is null then return null; end if;
  select * into row from corpus_ingest.entities e
  where e.source_system = gate.source_system
    and e.entity_type = 'code-section'
    and e.native_id = p_native_id
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2';
  if not found then return null; end if;
  source := row.provenance->>'source_url';
  if source is null or source !~ '^https://' then source := null; end if;
  return jsonb_build_object(
    'native_id', row.native_id,
    'jurisdiction', p_jurisdiction,
    'citation', row.data->>'citation',
    'citation_path', row.data->>'citation_path',
    'heading', row.data->>'heading',
    'text', row.data->>'text',
    'history', row.data->'history',
    'status_note', row.data->'status_note',
    'hierarchy', row.data->'hierarchy',
    'currency', row.data->'currency',
    'source_url', source
  );
end $$;

-- Citation or heading search across one projected state, or every projected state when p_jurisdiction is null.
create or replace function public.corpus_publisher_code_projected_search_v2(
  p_q text,
  p_jurisdiction text default null,
  p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare needle text; pattern text; total bigint;
begin
  needle := trim(coalesce(p_q, ''));
  if length(needle) < 2 or length(needle) > 120 or (p_jurisdiction is not null and p_jurisdiction !~ '^[A-Z]{2}$')
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'A citation or heading query is required' using errcode = '22023';
  end if;
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select count(*) into total
  from corpus_ingest.entities e
  join corpus_ingest.publisher_code_states_v2 st on st.source_system = e.source_system
  where st.public_projection_allowed
    and st.review_status = 'reviewed'
    and (p_jurisdiction is null or st.jurisdiction = p_jurisdiction)
    and e.entity_type = 'code-section'
    and e.review_status <> 'quarantined'
    and e.schema_version = 'publisher-code-evidence/2'
    and (
      coalesce(e.data->>'citation', '') ilike pattern escape '\'
      or coalesce(e.data->>'heading', '') ilike pattern escape '\'
    );
  return jsonb_build_object('total', total, 'hits', coalesce((
    select jsonb_agg(jsonb_build_object(
      'jurisdiction', h.jurisdiction,
      'native_id', h.native_id,
      'citation', h.citation,
      'heading', h.heading
    ) order by h.jurisdiction, h.native_id)
    from (
      select st.jurisdiction, e.native_id, e.data->>'citation' as citation, e.data->>'heading' as heading
      from corpus_ingest.entities e
      join corpus_ingest.publisher_code_states_v2 st on st.source_system = e.source_system
      where st.public_projection_allowed
        and st.review_status = 'reviewed'
        and (p_jurisdiction is null or st.jurisdiction = p_jurisdiction)
        and e.entity_type = 'code-section'
        and e.review_status <> 'quarantined'
        and e.schema_version = 'publisher-code-evidence/2'
        and (
          coalesce(e.data->>'citation', '') ilike pattern escape '\'
          or coalesce(e.data->>'heading', '') ilike pattern escape '\'
        )
      order by st.jurisdiction, e.native_id
      limit p_limit
    ) h
  ), '[]'::jsonb));
end $$;

revoke all on function corpus_ingest.publisher_code_path_matches_v2(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function corpus_ingest.publisher_code_projected_gate_v2(text) from public, anon, authenticated, service_role;
revoke all on function public.corpus_publisher_code_projected_states_v2() from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_outline_v2(text, jsonb) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_section_v2(text, text) from public, anon, authenticated;
revoke all on function public.corpus_publisher_code_projected_search_v2(text, text, integer) from public, anon, authenticated;
grant execute on function public.corpus_publisher_code_projected_states_v2() to service_role;
grant execute on function public.corpus_publisher_code_projected_outline_v2(text, jsonb) to service_role;
grant execute on function public.corpus_publisher_code_projected_section_v2(text, text) to service_role;
grant execute on function public.corpus_publisher_code_projected_search_v2(text, text, integer) to service_role;

comment on function public.corpus_publisher_code_projected_states_v2() is
  'Service-role read of full state codes whose review flag public_projection_allowed is true. Edition and currency are the intake currency summary.';
comment on function public.corpus_publisher_code_projected_section_v2(text, text) is
  'One published section (native id JURISDICTION:citation_path) from a state with public_projection_allowed. Null when the state is private.';

notify pgrst, 'reload schema';
commit;
