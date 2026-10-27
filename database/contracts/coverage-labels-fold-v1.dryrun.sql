-- coverage-labels-fold-v1.dryrun.sql
-- Read-only rehearsal of coverage-labels-fold-v1.sql: the same projection (between the PROJECTION markers, checked
-- identical by scripts/admin/coverage-labels-fold.test.mjs) and the same new-value expressions, as one SELECT.
-- Returns one JSON object: current counts, projected counts after the fold, and two sample records before/after.
set local statement_timeout = '120s';
with
-- BEGIN PROJECTION
src as (
  select c.id,
    jsonb_strip_nulls(jsonb_build_object(
      'law_body_class_confidence', case when c.item ->> 'law_body_class' in ('form', 'notice') then null else c.item -> 'confidence' end,
      'law_body_class_basis', case when c.item ->> 'law_body_class' in ('form', 'notice') then null else c.item -> 'class_basis' end,
      'law_body_class_detail', c.item -> 'class_detail',
      'rule_set_detail', c.item -> 'rule_set_detail',
      'rule_set_basis', c.item -> 'rule_set_basis'))
    || jsonb_build_object('label_overlay', jsonb_build_object(
      'dataset', 'coverage_labels',
      'manifest_sha256', 'e24f575c2076e2c674ae399a030f181bac32fd5f7f71bdfe1a3b215416f77daa',
      'contract', 'coverage-labels-fold-v1',
      'class_confidence_omitted', coalesce(c.item ->> 'law_body_class' in ('form', 'notice'), false),
      'source_as_of_folded', (c.item #>> '{temporal,source_as_of}') is not null)) as add_labels,
    c.item #>> '{temporal,source_as_of}' as as_of,
    c.item #>> '{temporal,source_as_of_basis}' as as_of_basis
  from public.corpus_records c
  join public.corpus_records o on o.dataset = 'focused' and o.id = c.id
  where c.dataset = 'coverage_labels'
    and c.item ->> 'law_body_class' is not distinct from o.detail #>> '{facets,labels,law_body_class}'
    and c.item ->> 'rule_set' is not distinct from o.detail #>> '{facets,labels,rule_set}'
    and c.item ->> 'original_sha256' = o.detail #>> '{facets,original_sha256}'
    and o.detail -> 'facets' = o.item -> 'facets'
    and o.detail #> '{facets,dates,source_as_of}' = '{"basis":null,"value":null}'::jsonb
    and o.detail -> 'source_as_of' = 'null'::jsonb
    and o.detail #> '{date_evidence,source_as_of_field}' = 'null'::jsonb
    and o.filters -> 'source_as_of' = 'null'::jsonb
    and not (o.detail #> '{facets,labels}' ? 'label_overlay')
),
-- END PROJECTION
nxt as (
  select o.id, o.state, o.detail as old_detail,
    jsonb_set(
      case when s.as_of is null then o.detail -> 'facets'
           else jsonb_set(o.detail -> 'facets', '{dates,source_as_of}',
                          jsonb_build_object('value', s.as_of, 'basis', s.as_of_basis)) end,
      '{labels}', (o.detail #> '{facets,labels}') || s.add_labels) as facets,
    s.as_of, s.as_of_basis, o.filters as old_filters
  from src s join public.corpus_records o on o.dataset = 'focused' and o.id = s.id
),
after as (
  select n.id, n.state, n.old_detail,
    case when n.as_of is null then jsonb_set(n.old_detail, '{facets}', n.facets)
         else jsonb_set(jsonb_set(jsonb_set(n.old_detail, '{facets}', n.facets),
                '{source_as_of}', to_jsonb(n.as_of)),
                '{date_evidence}', (n.old_detail -> 'date_evidence') || jsonb_build_object(
                  'source_as_of_field', 'coverage_labels.temporal.source_as_of',
                  'source_as_of_basis', n.as_of_basis)) end as detail,
    case when n.as_of is null then n.old_filters
         else n.old_filters || jsonb_build_object('source_as_of', n.as_of, 'source_lo', n.as_of, 'source_hi', n.as_of) end as filters
  from nxt n
),
focused_now as (
  select
    count(*) as rows,
    count(*) filter (where detail #> '{facets,labels}' ? 'label_overlay') as labels_folded,
    count(*) filter (where detail #> '{facets,labels}' ? 'law_body_class_confidence') as with_confidence,
    count(*) filter (where detail #>> '{facets,dates,source_as_of,value}' is not null) as facet_as_of,
    count(*) filter (where detail ->> 'source_as_of' is not null) as detail_as_of,
    count(*) filter (where filters ->> 'source_as_of' is not null) as filter_as_of
  from public.corpus_records where dataset = 'focused'
)
select jsonb_build_object(
  'overlay_rows', (select count(*) from public.corpus_records where dataset = 'coverage_labels'),
  'overlay_ready', (select ready from public.corpus_datasets where id = 'coverage_labels'),
  'focused_twins', (select count(*) from public.corpus_records c join public.corpus_records o
                      on o.dataset = 'focused' and o.id = c.id where c.dataset = 'coverage_labels'),
  'eligible', (select count(*) from src),
  'before', (select to_jsonb(f) from focused_now f),
  'after_projected', jsonb_build_object(
    'labels_folded', (select count(*) from after) + (select labels_folded from focused_now),
    'with_confidence', (select count(*) from after where detail #> '{facets,labels}' ? 'law_body_class_confidence')
                       + (select with_confidence from focused_now),
    'facet_as_of', (select count(*) from after where detail #>> '{facets,dates,source_as_of,value}' is not null)
                   + (select facet_as_of from focused_now),
    'detail_as_of', (select count(*) from after where detail ->> 'source_as_of' is not null) + (select detail_as_of from focused_now),
    'filter_as_of', (select count(*) from after where filters ->> 'source_as_of' is not null) + (select filter_as_of from focused_now)),
  'confidence', (select jsonb_object_agg(k, n) from (select detail #>> '{facets,labels,law_body_class_confidence}' k, count(*) n
                   from after group by 1) x),
  'class_detail', (select jsonb_object_agg(coalesce(k, 'none'), n) from (select detail #>> '{facets,labels,law_body_class_detail}' k, count(*) n
                   from after group by 1) x),
  'rule_set_detail', (select jsonb_object_agg(coalesce(k, 'none'), n) from (select detail #>> '{facets,labels,rule_set_detail}' k, count(*) n
                   from after group by 1) x),
  'as_of_by_state', (select jsonb_object_agg(k, n) from (select state || ' ' || min(detail ->> 'source_as_of') || '..' || max(detail ->> 'source_as_of') k, count(*) n
                   from after where detail ->> 'source_as_of' is not null group by state) x),
  'date_evidence_not_object', (select count(*) from after where jsonb_typeof(old_detail -> 'date_evidence') <> 'object'),
  'samples', (select jsonb_agg(jsonb_build_object('id', id, 'before', jsonb_build_object(
                  'source_as_of', old_detail -> 'source_as_of', 'date_evidence', old_detail -> 'date_evidence',
                  'facets_dates_source_as_of', old_detail #> '{facets,dates,source_as_of}', 'labels', old_detail #> '{facets,labels}'),
                'after', jsonb_build_object(
                  'source_as_of', detail -> 'source_as_of', 'date_evidence', detail -> 'date_evidence',
                  'facets_dates_source_as_of', detail #> '{facets,dates,source_as_of}', 'labels', detail #> '{facets,labels}',
                  'filters_source', jsonb_build_object('source_as_of', filters -> 'source_as_of', 'source_lo', filters -> 'source_lo', 'source_hi', filters -> 'source_hi'))))
              from after where id in ('000d6648b1f68300bed6193ebd1bdaaa', '0002e8d37b0c7426049c76ce82b27768')
                 or id = (select min(id) from after where state in ('NV', 'Nevada') and detail ->> 'source_as_of' is not null))
) as dry_run;
