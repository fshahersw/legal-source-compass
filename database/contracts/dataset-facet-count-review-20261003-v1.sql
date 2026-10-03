-- dataset-facet-count-review/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Recomputes metadata.listing.filters[].options[].count for counsel_directory, mdl_counsel and court_spine
-- from live public.corpus_records.filters, using the same containment semantics as public.corpus_query_bounded:
--   filters @> {name: value}  OR  filters @> {name: [value]}
-- Why: counsel_directory/mdl_counsel counts were scoped to the first listing mode (kind=firm) while the UI ignores
-- listing_modes and filters across all kinds (e.g. "Attorney to be noticed (416)" returns 2,361 records);
-- court_spine counts and the option "T" predate the 2026-10-02 testing-court quarantine (psc/test).
-- Mode-scoped originals remain in metadata.listing_modes. Options, labels and order are unchanged; the only removal is
-- the dead court_spine type=T option (0 rows). Dry-run diff: 21 counts changed, 1 option removed.
-- Reversible: before-image of listing.filters is in corpus_ingest.cleanup_decisions
-- (dataset='corpus_datasets', issue='dq20261003_facet_option_counts').
--
-- ROLLBACK (exact):
--   update public.corpus_datasets d
--      set metadata = jsonb_set(d.metadata,'{listing,filters}', c.original_record->'listing_filters') - 'facet_count_review',
--          updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003_facet_option_counts'
--      and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b' and c.record_id=d.id;
with ds as (select id, metadata from public.corpus_datasets where id in ('counsel_directory','mdl_counsel','court_spine')),
cnt as (
 select r.dataset, e.key as fname, x.val as oval, count(*) as n
 from public.corpus_records r join ds on ds.id = r.dataset
 cross join lateral jsonb_each(r.filters) e
 cross join lateral (
   select jsonb_array_elements_text(e.value) as val where jsonb_typeof(e.value) = 'array'
   union all
   select e.value #>> '{}' where jsonb_typeof(e.value) in ('string','number','boolean')) x
 where e.key not like '\_\_%' escape '\'
 group by 1,2,3),
nf as (
 select ds.id, jsonb_agg(
   case when f->>'type' = 'select' and jsonb_typeof(f->'options') = 'array' then
     jsonb_set(f, '{options}', coalesce((
        select jsonb_agg(jsonb_set(o, '{count}', to_jsonb(c.n)) order by ord)
        from jsonb_array_elements(f->'options') with ordinality as t(o, ord)
        join cnt c on c.dataset = ds.id and c.fname = f->>'name' and c.oval = o->>'value'), '[]'::jsonb))
   else f end order by fo) as new_filters
 from ds, jsonb_array_elements(ds.metadata->'listing'->'filters') with ordinality as ft(f, fo)
 group by ds.id),
target as materialized (
 select ds.id, ds.metadata, nf.new_filters from ds join nf on nf.id = ds.id
 where ds.metadata->'listing'->'filters' is distinct from nf.new_filters and not (ds.metadata ? 'facet_count_review')),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', t.id, 'dq20261003_facet_option_counts', 'label_override',
  'Stored facet option counts did not equal the rows the filter returns (counts were scoped to one listing mode, or predate the testing-court quarantine). Recomputed from live corpus_records.filters; dead zero-row options removed.',
  jsonb_build_object('review_version','dataset-facet-count-review/2026-10-03.1','semantics','filters @> {name:value} OR filters @> {name:[value]}'),
  jsonb_build_object('id', t.id, 'listing_filters', t.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', t.new_filters),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
updated as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{listing,filters}', t.new_filters)
                   || jsonb_build_object('facet_count_review', jsonb_build_object('version','dataset-facet-count-review/2026-10-03.1','run_id','664a081e-b5a6-4ab0-af5a-41c260b0d09b','recomputed_at',now())),
        updated_at = now()
   from target t join audited a on a.record_id = t.id
  where d.id = t.id and d.metadata->'listing'->'filters' = t.metadata->'listing'->'filters'
  returning d.id)
select jsonb_build_object('contract','dataset-facet-count-review/2026-10-03.1','targets',(select count(*) from target),
 'audit_rows_written',(select count(*) from audited),'rows_updated',(select count(*) from updated),'checked_at',now()) as receipt;
