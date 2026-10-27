-- coverage-labels-fold-v1-verify.sql
-- Read-only check for coverage-labels-fold-v1.sql. Run before the fold (expect state 'before') and after it (expect
-- state 'after'); after coverage-labels-fold-v1.rollback.sql it returns 'before' again.
--   before: folded 0, folded_as_of 0, facet_as_of 0, filter_as_of 0, detail_as_of 757, catalog_status null
--   after:  folded 10009, folded_as_of 1420 (NV 950, WI 470), facet_as_of 1420, filter_as_of 1420, detail_as_of 2177,
--           with_confidence 8848 (form/notice rows carry no confidence), item_facets_equal 10009, catalog_status 'folded_into_published_records'
-- In both states: overlay_rows 10013, overlay_ready false, focused rows 17416.
set local statement_timeout = '120s';
with f as (
  select
    count(*) as focused_rows,
    count(*) filter (where detail #> '{facets,labels}' ? 'label_overlay') as folded,
    count(*) filter (where detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true') as folded_as_of,
    count(*) filter (where detail #> '{facets,labels}' ? 'law_body_class_confidence') as with_confidence,
    count(*) filter (where detail #> '{facets,labels}' ? 'label_overlay' and detail -> 'facets' = item -> 'facets') as item_facets_equal,
    count(*) filter (where detail #>> '{facets,dates,source_as_of,value}' is not null) as facet_as_of,
    count(*) filter (where filters ->> 'source_as_of' is not null) as filter_as_of,
    count(*) filter (where detail ->> 'source_as_of' is not null) as detail_as_of,
    count(*) filter (where state = 'Nevada' and detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true') as nv_as_of,
    count(*) filter (where state = 'Wisconsin' and detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true') as wi_as_of
  from public.corpus_records where dataset = 'focused'
)
select jsonb_build_object(
  'state', case when f.folded = 0 then 'before' when f.folded = 10009 and f.folded_as_of = 1420 then 'after' else 'unexpected' end,
  'focused', to_jsonb(f),
  'overlay_rows', (select count(*) from public.corpus_records where dataset = 'coverage_labels'),
  'overlay_ready', (select ready from public.corpus_datasets where id = 'coverage_labels'),
  'catalog_label', (select label from public.corpus_datasets where id = 'coverage_labels'),
  'catalog_status', (select metadata #>> '{publication,status}' from public.corpus_datasets where id = 'coverage_labels')
) as verify
from f;
