-- publisher-code-projection/3 — outline read that honours optional hierarchy levels.
--
-- Why: corpus_publisher_code_projected_outline_v2 matches the recorded path against a section's
-- hierarchy by array position (publisher_code_path_matches_v2) and then groups only on the next
-- *declared* level, and its validation accepts only a path whose levels are exactly the first N
-- declared levels. A publisher that declares optional levels (PA: title, part, subpart, article,
-- subarticle, chapter, ...; also NY, LA, IA, CT, KY, NV, ...) lands many sections whose hierarchy
-- skips one or more of them, for example 42 Pa.C.S. § 5524 = [title 42, part VI, chapter 55,
-- subchapter B]. Under v2 the outline at [title 42, part VI] looks for a "subpart" at position 2,
-- finds none, and shows nothing; the path [title 42, part VI, chapter 55] is rejected as not
-- following the declared levels. Measured on 2026-10-08 (first click only): 12 of Pennsylvania's
-- 51 titles (2,058 sections) and 7 of New York's 94 laws (5,370 sections) dead-end.
--
-- v3 keeps every v2 guarantee (service role only, reviewed + public_projection_allowed gate, no
-- storage keys, hashes or receipts) and the same anchored, order-preserving positional matcher.
-- It changes two things only:
--   * a path is valid when each step is a declared non-section level and the steps are in strictly
--     increasing declared order (declared levels may be skipped);
--   * the outline under a path groups on whatever hierarchy entry each matched section records at
--     position len(path), so one outline level can show, side by side, groups of different declared
--     levels; every group carries its own `level`. A section whose entry at that position is the
--     section itself (or that has no entry there) is a direct section.
-- Paths the website builds are always exact prefixes of a section's recorded hierarchy (outline
-- clicks append the group's own level and number; "Show in outline" uses the section's own
-- hierarchy), so the positional match is both sufficient and unambiguous.
-- v2 stays installed; the website prefers v3 and falls back to v2 when v3 is absent.
-- Apply after corpus-publisher-code-projection-v2.sql. Service role only. Nothing here writes.
begin;

create or replace function public.corpus_publisher_code_projected_outline_v3(
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
  prev_pos integer := -1;
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
      or jsonb_typeof(elem->'number') not in ('string', 'null')
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

  -- Every step is a declared, non-section level, and steps follow the declared order.
  for step in select elem from jsonb_array_elements(p_path) elem loop
    if step->>'level' = 'section' then
      raise exception 'A hierarchy path ends above the section level' using errcode = '22023';
    end if;
    select (t.ord - 1)::integer into pos
    from jsonb_array_elements_text(levels) with ordinality as t(lvl, ord)
    where t.lvl = step->>'level'
    order by t.ord limit 1;
    if pos is null or pos <= prev_pos then
      raise exception 'Hierarchy path does not follow this code''s declared levels' using errcode = '22023';
    end if;
    prev_pos := pos;
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
      and corpus_ingest.publisher_code_path_matches_v2(e.data->'hierarchy', p_path)
  ),
  -- A section sits here when its next entry is the section row, or when nothing follows the path.
  direct as (
    select * from matched n where n.nxt is null or n.nxt->>'level' = 'section'
  ),
  grouped as (
    select g.level, g.number, g.heading, g.n,
           (select (t.ord - 1)::integer
              from jsonb_array_elements_text(levels) with ordinality as t(lvl, ord)
             where t.lvl = g.level order by t.ord limit 1) as pos
    from (
      select n.nxt->>'level' as level,
             n.nxt->>'number' as number,
             n.nxt->>'heading' as heading,
             count(*) as n
      from matched n
      where n.nxt is not null and n.nxt->>'level' <> 'section'
      group by 1, 2, 3
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
          'level', g.level, 'number', g.number, 'heading', g.heading, 'count', g.n
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

revoke all on function public.corpus_publisher_code_projected_outline_v3(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_publisher_code_projected_outline_v3(text, jsonb) to service_role;

comment on function public.corpus_publisher_code_projected_outline_v3(text, jsonb) is
  'Service-role outline of a projected full state code. The path is matched positionally against each section''s recorded hierarchy; the outline groups on the entry recorded after the path, whatever its declared level, so optional levels may be skipped. Groups carry their own level.';

-- Expected readback after apply (service role), compared with v2 on the same path:
--   select public.corpus_publisher_code_projected_outline_v3('PA', '[{"level":"title","number":"42"},{"level":"part","number":"VI"}]');
--     -> kind groups, groups include {"level":"chapter","number":"55","heading":"LIMITATION OF TIME"}
--   select public.corpus_publisher_code_projected_outline_v3('PA',
--     '[{"level":"title","number":"42"},{"level":"part","number":"VI"},{"level":"chapter","number":"55"},{"level":"subchapter","number":"B"}]');
--     -> kind sections, includes native_id PA:42:5524
--   select public.corpus_publisher_code_projected_outline_v3('PA', '[{"level":"chapter","number":"55"},{"level":"title","number":"42"}]');
--     -> error 22023 (declared order)
--   select public.corpus_publisher_code_projected_outline_v3('FL', '[]') = public.corpus_publisher_code_projected_outline_v2('FL', '[]')
--     minus the added "level"/"levels" keys -> same totals and group numbers.
--   explain analyze on PA '[]' should use the same plan shape as v2 '[]' (one scan of the state's sections).

notify pgrst, 'reload schema';
commit;
