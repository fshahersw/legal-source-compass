-- court-map-sync/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; round 3 item B "court accuracy")
-- Scope: public.corpus_workspace_court_map (the per-court projection that getCourtMap / the court page read) and the dataset metadata of court_spine.
-- The map is a byte-copy projection of the court directory: for all 5,411 rows map.title = spine.title, map.state = spine.state and map.facts = spine.detail->'facts'
-- (checked before this round: 0 differences). After the spine fixes of this round (court-spine-names / -in-use-and-parent / -mdl-counts) the map is re-synced from the spine.
-- Map-only columns that follow the same evidence:
--   superctguam : in_use 'no' -> 'yes'         (CourtListener snapshot 2026-09-30, see court-spine-in-use-and-parent)
--   ohctapp1    : system 'unknown' -> 'state', parent_id NULL -> 'ohioctapp', court_type '[]' -> NULL (the literal string '[]' was a serialization artifact of an empty
--                 court-type list; CourtListener recorded no court type; the column is nullable). State '' -> 'OH' comes from the spine.
-- Statement 3 updates the dataset metadata of court_spine: the facet counts that ohctapp1 changes (system: unknown 1 -> removed, state +1; state OH 483 -> 484; recomputed from
-- live corpus_records.filters with the same containment semantics as corpus_query_bounded, like dataset-facet-count-review-20261003-v1.sql) and the dataset qualification, which still cites
-- the JPML report dated 2026-09-01 (listing.qualification and the mirrored listing_modes.default.qualification -> 2026-10-01). A key accuracy_review_r3 records the run.
-- Before-image: whole map row + row md5 (issue dq20261003r3_court_map_sync, dataset corpus_workspace_court_map); metadata listing.filters / qualifications
-- (issue dq20261003r3_court_spine_metadata, dataset corpus_datasets). Execute statements 1..4 in order, after the three spine files.
--
-- ROLLBACK (exact):
--   update public.corpus_workspace_court_map m
--      set title = c.original_record->'row'->>'title', state = c.original_record->'row'->>'state', facts = c.original_record->'row'->'facts',
--          in_use = c.original_record->'row'->>'in_use', system = c.original_record->'row'->>'system',
--          parent_id = c.original_record->'row'->>'parent_id', court_type = c.original_record->'row'->>'court_type'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_workspace_court_map' and c.issue = 'dq20261003r3_court_map_sync' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and m.court_id = c.record_id;
--   update public.corpus_datasets d
--      set metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{listing,filters}', c.original_record->'listing_filters'),
--                       '{listing,qualification}', to_jsonb(c.original_record->>'listing_qualification')),
--                       '{listing_modes,default,qualification}', to_jsonb(c.original_record->>'listing_modes_default_qualification')) - 'accuracy_review_r3',
--          updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r3_court_spine_metadata' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and d.id = c.record_id;
--
-- ===== statement 1: audit (map) =====
with flag as (select true as apply),
tgt as materialized (
 select m.court_id, to_jsonb(m) as old_row, md5(to_jsonb(m)::text) as row_md5, s.title as s_title, s.state as s_state, s.detail->'facts' as s_facts
 from public.corpus_workspace_court_map m join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id
 where m.title is distinct from s.title or m.facts is distinct from s.detail->'facts' or m.state is distinct from s.state or m.court_id in ('superctguam', 'ohctapp1')),
fx as (
 select t.court_id, t.old_row, t.row_md5,
        jsonb_build_object('title', t.s_title, 'state', t.s_state, 'facts', t.s_facts,
          'in_use', case when t.court_id = 'superctguam' then 'yes' else t.old_row->>'in_use' end,
          'system', case when t.court_id = 'ohctapp1' then 'state' else t.old_row->>'system' end,
          'parent_id', case when t.court_id = 'ohctapp1' then 'ohioctapp' else t.old_row->>'parent_id' end,
          'court_type', case when t.court_id = 'ohctapp1' then null else t.old_row->>'court_type' end) as repl
 from tgt t),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_workspace_court_map', x.court_id, 'dq20261003r3_court_map_sync', 'label_override',
  'The court map is a byte-copy projection of the court directory (title, state, facts). Re-synced after the round-3 spine fixes (names, in-use flag, ohctapp1 parent/state/system, MDL counts); map-only columns follow the same evidence.',
  jsonb_build_object('review_version','court-map-sync/2026-10-03.r3.1','source','corpus_records court_spine (title, state, detail.facts)','approved_by','coordinator (round 3 item B: court accuracy)'),
  jsonb_build_object('row', x.old_row, 'row_md5', x.row_md5),
  x.repl,
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply (map) =====
with u as (
 update public.corpus_workspace_court_map m
    set title = c.replacement->>'title', state = c.replacement->>'state', facts = c.replacement->'facts', in_use = c.replacement->>'in_use',
        system = c.replacement->>'system', parent_id = c.replacement->>'parent_id', court_type = c.replacement->>'court_type'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'corpus_workspace_court_map' and c.issue = 'dq20261003r3_court_map_sync' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and m.court_id = c.record_id and md5(to_jsonb(m)::text) = c.original_record->>'row_md5'
 returning m.court_id)
select count(*) updated from u;

-- ===== statement 3: audit (court_spine dataset metadata) =====
with flag as (select true as apply),
ds as (select id, metadata from public.corpus_datasets where id = 'court_spine' and not (metadata ? 'accuracy_review_r3')),
cnt as (
 select e.key as fname, x.val as oval, count(*) as n
 from public.corpus_records r
 cross join lateral jsonb_each(r.filters) e
 cross join lateral (
   select jsonb_array_elements_text(e.value) as val where jsonb_typeof(e.value) = 'array'
   union all
   select e.value #>> '{}' where jsonb_typeof(e.value) in ('string','number','boolean')) x
 where r.dataset = 'court_spine' and e.key not like '\_\_%' escape '\'
 group by 1, 2),
nf as (
 select jsonb_agg(
   case when f->>'type' = 'select' and jsonb_typeof(f->'options') = 'array' then
     jsonb_set(f, '{options}', coalesce((
        select jsonb_agg(jsonb_set(o, '{count}', to_jsonb(c.n)) order by ord)
        from jsonb_array_elements(f->'options') with ordinality as t(o, ord)
        join cnt c on c.fname = f->>'name' and c.oval = o->>'value'), '[]'::jsonb))
   else f end order by fo) as new_filters
 from ds, jsonb_array_elements(ds.metadata->'listing'->'filters') with ordinality as ft(f, fo)),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r3_court_spine_metadata', 'label_override',
  'Facet counts follow the ohctapp1 completion (system unknown -> state, state OH +1) and the dataset qualification cites the JPML report that the per-court MDL counts now come from (2026-10-01). Counts recomputed from live corpus_records.filters.',
  jsonb_build_object('review_version','court-spine-accuracy/2026-10-03.r3.1','semantics','filters @> {name:value} OR filters @> {name:[value]}','approved_by','coordinator (round 3 item B: court accuracy)'),
  jsonb_build_object('id', ds.id, 'listing_filters', ds.metadata->'listing'->'filters', 'listing_qualification', ds.metadata->'listing'->>'qualification',
                     'listing_modes_default_qualification', ds.metadata->'listing_modes'->'default'->>'qualification'),
  jsonb_build_object('listing_filters', nf.new_filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from ds cross join nf where (select apply from flag) and ds.metadata->'listing'->'filters' is distinct from nf.new_filters
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from ins) audit_rows_written,
       (select count(*) from jsonb_array_elements((select new_filters from nf)) f where f->>'name' = 'system') system_filter_present;

-- ===== statement 4: apply (court_spine dataset metadata) =====
with u as (
 update public.corpus_datasets d
    set metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata,
              '{listing,filters}', c.replacement->'listing_filters'),
              '{listing,qualification}', to_jsonb(replace(d.metadata->'listing'->>'qualification', 'JPML MDL report dated 2026-09-01', 'JPML MDL report dated 2026-10-01'))),
              '{listing_modes,default,qualification}', to_jsonb(replace(d.metadata->'listing_modes'->'default'->>'qualification', 'JPML MDL report dated 2026-09-01', 'JPML MDL report dated 2026-10-01')))
                   || jsonb_build_object('accuracy_review_r3', jsonb_build_object('version', 'court-spine-accuracy/2026-10-03.r3.1', 'run_id', 'c490cdf1-b32e-46ae-95c5-788cdeba3f33', 'applied_at', now(),
                        'summary', 'typo words 37 rows, truncated numbers 3, superctguam in-use, ohctapp1 parent/state/system, per-court MDL counts and report date (51 rows), map re-synced')),
        updated_at = now()
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r3_court_spine_metadata' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and d.id = c.record_id and d.metadata->'listing'->'filters' = c.original_record->'listing_filters' and not (d.metadata ? 'accuracy_review_r3')
 returning d.id)
select count(*) updated from u;
