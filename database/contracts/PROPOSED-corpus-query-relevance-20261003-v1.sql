-- REJECTED BY THE COORDINATOR (round-2 review, 2026-10-03) - NOT APPLIED AND NOT TO BE APPLIED.  corpus-query-relevance/2026-10-03.r2.1 (data-quality agent, work item B)
-- Decision: benchmarked as a temporary function with exactly this body: '2885' 266 ms -> 676 ms, 'court' 3.0 s -> 5.0 s - too costly for every search.
-- Routed to ui-integration as a client-side change (honorific stripping, judge boost, targeted entity-dataset passes) with no database change.
-- Round 3 supplies the data side of the judge boost: mdls.item.judge_profile_id / judge_cl_person_id and filters.cl_person_id now exist for 172 / 143 of the 176 MDLs
-- (see mdls-judge-native-links-r3-20261003-v1.sql); the comment below that says "176 ids" for mdls.filters.cl_person_id was wrong at the time (17), it is 143 now.
-- Kept only as the record of what was measured and proposed.
--
-- (original header follows)
-- PROPOSAL ONLY - NOT APPLIED.  For review by the orchestrator / ui-integration / whoever owns the corpus_query RPC.
--
-- WHAT THE MEASUREMENTS SHOW (src/lib/external/catalog.reads.server.ts calls corpus_query with p_sort = NULL, p_limit = 500):
--   * With p_sort NULL the RPC orders matches by (ordinal, id) only. There is no relevance signal in the database: the 500 "candidates"
--     are the 500 matches with the LOWEST ordinals across all ready datasets, and the client re-ranks only those 500.
--     7 of the 10 Seeger Weiss queries (3140, MDL 3047, social media adolescent addiction, GLP-1, talc, Bard port catheter, Judge Rodgers,
--     Seeger Weiss) have more than 500 matches, so the right record is only found if its dataset happens to have small ordinals
--     (the app papers over this for mdls and expert_rulings with two extra 250-row passes).
--   * 'Judge Rodgers': the role word 'judge' is not in any judge's title, so the client loses the all-words (+200) and phrase (+200)
--     bonuses for every judge record, the four Rodgers records tie at 100 and the alphabetical tie-break puts a saved page and a
--     non-judge ahead of the Depo-Provera transferee judge (Margaret Catharine Rodgers = M. Casey Rodgers, people:2755).
--
-- R1 (tiering): when a text query is present and p_sort is NULL, matches whose TITLE contains every query lexeme come first, then
--     everything else, each group still in (ordinal, id) order. Titles are short heap values; the extra cost is one to_tsvector per
--     matched row (measured order of magnitude: 105k matches for '2885' -> well under the 2-minute limit; run EXPLAIN ANALYZE before applying).
-- R2 (honorifics): 'judge', 'justice', 'hon', 'honorable' are dropped from the prefix query when other words remain, so
--     'Judge Rodgers' retrieves people/judges whose text lacks the word 'judge'.
-- Neither change alters results when p_sort is given (listing views) or when no query text is present.
--
-- COMPANION CLIENT CHANGE (TypeScript, src/lib/external/searchQuality.ts; prototyped read-only in _work/agents/data-quality/search/search_harness.mjs --proposal):
--   in score(): drop honorific words from queryWords before the title comparison, and when the query had one add
--   +250 for datasets judges/people/cl_people/judge_entities/judge_enrichment and another +250 when the record's CourtListener person id
--   is the transferee judge of an MDL (mdls.filters.cl_person_id, 176 ids).  Prototype result for 'Judge Rodgers':
--   people:2755 'Margaret Catharine Rodgers' 1000 (rank 1) / Henry Lee Rodgers 750 / People v. Rodgers 500 / Carlos Rodgers 500
--   (baseline: that judge ranked 4th behind a saved page, a focused page and Henry Lee Rodgers, all at 100).
--
-- Replacement body (same signature). Lines changed are marked R1 / R2.
CREATE OR REPLACE FUNCTION public.corpus_query(p_datasets text[] DEFAULT NULL::text[], p_filters jsonb DEFAULT '{}'::jsonb, p_q text DEFAULT ''::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'ordinal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  answer jsonb;
  terms tsquery;
begin
  if p_q <> '' then
    if p_filters->>'__prefix' in ('true','1') then
      -- prefix-query:start
      select coalesce(string_agg(quote_literal(lexeme) || ':*', ' & '), '')::tsquery
        into terms
        from (
          select lexeme
          from ts_debug('simple'::regconfig, left(p_q,300)) token
          cross join lateral unnest(token.lexemes) lexeme
          where token.alias not in ('asciihword','hword','numhword')
            -- R2: honorifics are optional when other words are present
            and (lexeme not in ('judge','justice','hon','honorable')
                 or not exists (select 1 from ts_debug('simple'::regconfig, left(p_q,300)) t2
                                 cross join lateral unnest(t2.lexemes) l2
                                 where t2.alias not in ('asciihword','hword','numhword')
                                   and l2 not in ('judge','justice','hon','honorable')))
          limit 16
        ) query_lexemes;
      -- prefix-query:end
    else terms := websearch_to_tsquery('simple',left(p_q,300)); end if;
  end if;
  with matched as not materialized (
    select r.* from public.corpus_records r
    join public.corpus_datasets d on d.id = r.dataset and d.ready
    where (p_datasets is null or r.dataset = any(p_datasets))
      and (terms is null or r.search_vector @@ terms)
      and (not(p_filters ? '__ids') or r.id=any(array(select jsonb_array_elements_text(p_filters->'__ids'))))
      and not exists (
        select 1 from jsonb_each(p_filters) f
        where f.key not like '\_\_%' escape '\'
          and not (case when jsonb_typeof(f.value)='array' then exists(select 1 from jsonb_array_elements(f.value) v where coalesce((r.filters -> f.key) @> v, false)) else coalesce((r.filters -> f.key) @> f.value, false) end)
      )
      and not exists (select 1 from jsonb_each_text(coalesce(p_filters->'__contains','{}'::jsonb)) f where position(lower(f.value) in lower(coalesce(r.filters->>f.key,''))) = 0)
      and (not (p_filters ? '__county') or r.county_geoids @> array[p_filters->>'__county'])
      and (p_filters ? '__date_any' or not (p_filters ? '__dfrom') or coalesce(r.filters->>(p_filters->>'__date_type'),'') >= p_filters->>'__dfrom')
      and (p_filters ? '__date_any' or not (p_filters ? '__dto') or coalesce(r.filters->>(p_filters->>'__date_type'),'') <= (p_filters->>'__dto') || 'T23:59:59.999999Z')
    and (not (p_filters ? '__date_any') or exists (
        select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.filters->(p_filters->>'__date_any'))='array' then r.filters->(p_filters->>'__date_any') else jsonb_build_array(r.filters->(p_filters->>'__date_any')) end) v
        where v is not null and (not(p_filters ? '__dfrom') or v>=p_filters->>'__dfrom')
        and (not(p_filters ? '__dto') or v<=(p_filters->>'__dto')||'T23:59:59.999999Z')
      ))
  ), selected as (
    select * from matched
    order by
      -- R1: title-hit tier first, only for relevance searches (p_sort NULL) with a text query
      case when p_sort is null and terms is not null and to_tsvector('simple'::regconfig, coalesce(title,'')) @@ terms then 0 else 1 end,
      case when p_sort='rank' then (filters->>'__rank')::bigint end,
      case when p_sort='title' then lower(title) end,
      case when p_sort='title_desc' then lower(title) end desc,
      case when p_sort='date_desc' then filters->>'date' end desc nulls last,
      ordinal, id
    limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)
  )
  select jsonb_build_object('total',(select count(*) from matched),
    'items',coalesce((select jsonb_agg(item) from selected),'[]'::jsonb),
    'limit',least(greatest(p_limit,1),500),'offset',greatest(p_offset,0)) into answer;
  return answer;
end;
$function$;
-- ROLLBACK: re-run the original definition (kept verbatim in _work/agents/data-quality/search/corpus_query.original.sql).
