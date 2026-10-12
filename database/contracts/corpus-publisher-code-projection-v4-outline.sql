-- publisher-code-projection/4: exact publisher hierarchy, including native node identities.
-- California orders structural levels differently between codes and contains repeated
-- printed numbers in distinct publisher TOC nodes. A global level ordering is invalid.
-- Source nodes remain distinct via node_id; legacy rows without node IDs still match
-- their exact level/number prefixes. No unanchored or reordered path is synthesized.
-- Additive: v2/v3 remain installed for fallback. Only reviewed/public states are read.
-- Apply after publisher-code-projection/2. All writes here are function definitions;
-- no code row, source version, review flag or publication flag is changed.
begin;

-- Exact source-prefix matching. A stored source node ID must be supplied and
-- match; dropping it cannot collapse two same-numbered or unnumbered nodes.
create or replace function corpus_ingest.publisher_code_path_matches_v4(p_hierarchy jsonb, p_path jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_hierarchy) = 'array'
    and jsonb_array_length(p_hierarchy) >= jsonb_array_length(p_path)
    and not exists (
      select 1 from jsonb_array_elements(p_path) with ordinality t(elem, ord)
      where (p_hierarchy->(t.ord::integer - 1)->>'level') is distinct from (t.elem->>'level')
         or (p_hierarchy->(t.ord::integer - 1)->>'number') is distinct from (t.elem->>'number')
         or (p_hierarchy->(t.ord::integer - 1)->>'node_id') is distinct from (t.elem->>'node_id')
    );
$$;
revoke all on function corpus_ingest.publisher_code_path_matches_v4(jsonb, jsonb) from public, anon, authenticated;
grant execute on function corpus_ingest.publisher_code_path_matches_v4(jsonb, jsonb) to service_role;


create or replace function public.corpus_publisher_code_projected_outline_v4(
  p_jurisdiction text,
  p_path jsonb default '[]'::jsonb
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  gate record;
  levels jsonb;
  depth integer;
  total bigint;
  direct_total bigint;
  step jsonb;
  pos integer;
  built jsonb;
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
      or not (elem ? 'number')
      or jsonb_typeof(elem->'number') not in ('string', 'null')
      or (elem ? 'node_id' and (jsonb_typeof(elem->'node_id') is distinct from 'string'
        or length(elem->>'node_id') not between 1 and 256))
  ) then
    raise exception 'Hierarchy path entries must be a level and a number' using errcode = '22023';
  end if;
  select * into gate from corpus_ingest.publisher_code_projected_gate_v2(p_jurisdiction);
  if gate.jurisdiction is null then
    return jsonb_build_object('available', false);
  end if;
  levels := gate.manifest->'structure'->'levels';
  if jsonb_typeof(levels) is distinct from 'array' then
    raise exception 'This code declares no hierarchy levels' using errcode = '22023';
  end if;

  -- Source order is authoritative. Membership is checked; no universal order is invented.
  for step in select elem from jsonb_array_elements(p_path) elem loop
    if step->>'level' = 'section' then
      raise exception 'A hierarchy path ends above the section level' using errcode = '22023';
    end if;
    select (t.ord - 1)::integer into pos
    from jsonb_array_elements_text(levels) with ordinality as t(lvl, ord)
    where t.lvl = step->>'level'
    order by t.ord limit 1;
    if pos is null then
      raise exception 'Hierarchy path contains an undeclared level' using errcode = '22023';
    end if;
  end loop;
  depth := jsonb_array_length(p_path);

  -- One scan of the state's sections under the path. `nxt` is the entry each section records right
  -- after the path, whatever its level. matched is referenced several times, so it materializes once.
  with matched as (
    select e.native_id,
           e.data->>'citation' as citation,
           e.data->>'heading' as heading,
           e.data->>'status_note' as status_note,
           e.data->'hierarchy'->depth as nxt
    from corpus_ingest.entities e
    where e.source_system = gate.source_system
      and e.entity_type = 'code-section'
      and e.review_status <> 'quarantined'
      and e.schema_version = 'publisher-code-evidence/2'
      and corpus_ingest.publisher_code_path_matches_v4(e.data->'hierarchy', p_path)
  ),
  -- A section sits here when its next entry is the section row, or when nothing follows the path.
  direct as (
    select * from matched n where n.nxt is null or n.nxt->>'level' = 'section'
  ),
  grouped as (
    select g.level, g.number, g.heading, g.node_id, g.n,
           (select (t.ord - 1)::integer
              from jsonb_array_elements_text(levels) with ordinality as t(lvl, ord)
             where t.lvl = g.level order by t.ord limit 1) as pos
    from (
      select n.nxt->>'level' as level,
             n.nxt->>'number' as number,
             n.nxt->>'heading' as heading,
             n.nxt->>'node_id' as node_id,
             count(*) as n
      from matched n
      where n.nxt is not null and n.nxt->>'level' <> 'section'
      group by 1, 2, 3, 4
    ) g
  )
  select
    (select count(*) from direct),
    (select count(*) from grouped),
    jsonb_build_object(
      -- The declared level the groups most often sit on; each group also names its own level.
      'level', (select g.level from grouped g group by g.level order by sum(g.n) desc, g.level limit 1),
      'levels', coalesce((
        select jsonb_agg(l.level order by l.pos nulls last, l.level)
        from (select distinct g.level, g.pos from grouped g) l
      ), '[]'::jsonb),
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'level', g.level, 'number', g.number, 'heading', g.heading, 'node_id', g.node_id, 'count', g.n
        ) order by g.pos nulls last, g.number, g.heading)
        from (select * from grouped order by pos nulls last, number, heading limit 2000) g
      ), '[]'::jsonb),
      'direct_sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'native_id', s.native_id, 'citation', s.citation,
          'heading', s.heading, 'status_note', s.status_note
        ) order by s.native_id)
        from (select * from direct order by native_id limit 5000) s
      ), '[]'::jsonb)
    )
  into direct_total, total, built;

  if total = 0 then
    return jsonb_build_object(
      'available', true, 'kind', 'sections', 'level', 'section', 'total', direct_total,
      'truncated', direct_total > 5000,
      'sections', built->'direct_sections');
  end if;

  return jsonb_build_object(
    'available', true, 'kind', 'groups',
    'level', built->'level',
    'levels', built->'levels',
    'total', total,
    'truncated', total > 2000,
    'groups', built->'groups',
    'direct_total', direct_total,
    'direct_truncated', direct_total > 5000,
    'direct_sections', case when direct_total = 0 then '[]'::jsonb else built->'direct_sections' end);
end $$;

revoke all on function public.corpus_publisher_code_projected_outline_v4(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_publisher_code_projected_outline_v4(text, jsonb) to service_role;

comment on function public.corpus_publisher_code_projected_outline_v4(text, jsonb) is
  'Service-role outline with exact source-node prefix identity, preserving publisher hierarchy order and duplicate printed numbers. Reviewed/public gate is unchanged; no storage paths or hashes are exposed.';

notify pgrst, 'reload schema';
commit;
