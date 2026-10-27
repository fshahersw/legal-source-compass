-- coverage-labels-fold-v1.rollback.sql
-- Exact inverse of coverage-labels-fold-v1.sql. Before the fold (dry run 2026-10-27) none of the 10,009 focused twins
-- had any of the added label keys, and every one had facets.dates.source_as_of = {"basis":null,"value":null},
-- detail.source_as_of = null, date_evidence.source_as_of_field = null (no source_as_of_basis key) and
-- filters.source_as_of/source_lo/source_hi = null. Rows are selected by the label_overlay marker the fold wrote;
-- the as-of slots are reset only where the marker says the fold set them (source_as_of_folded = true).
-- The coverage_labels catalog row gets back its label, metadata (without the two added keys) and updated_at.

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

-- the rows this rollback reverts (the fold's own marker); the postcondition checks only these rows, so as-of dates
-- that later releases add to other focused rows never block the inverse
create temporary table _cl_fold_rb on commit drop as
  select o.id, (o.detail #>> '{facets,labels,label_overlay,source_as_of_folded}') = 'true' as had_as_of
    from public.corpus_records o
   where o.dataset = 'focused' and o.detail #> '{facets,labels}' ? 'label_overlay'
     and o.detail #>> '{facets,labels,label_overlay,contract}' = 'coverage-labels-fold-v1';

with tgt as (
  select o.id,
    (o.detail #>> '{facets,labels,label_overlay,source_as_of_folded}') = 'true' as had_as_of,
    jsonb_set(
      case when (o.detail #>> '{facets,labels,label_overlay,source_as_of_folded}') = 'true'
           then jsonb_set(o.detail -> 'facets', '{dates,source_as_of}', '{"basis":null,"value":null}'::jsonb)
           else o.detail -> 'facets' end,
      '{labels}',
      (o.detail #> '{facets,labels}') - array['law_body_class_confidence', 'law_body_class_basis',
        'law_body_class_detail', 'rule_set_detail', 'rule_set_basis', 'label_overlay']) as facets
  from public.corpus_records o
  where o.dataset = 'focused' and o.detail #> '{facets,labels}' ? 'label_overlay'
    and o.detail #>> '{facets,labels,label_overlay,contract}' = 'coverage-labels-fold-v1'
)
update public.corpus_records o set
  detail = case when t.had_as_of
           then jsonb_set(jsonb_set(jsonb_set(o.detail, '{facets}', t.facets), '{source_as_of}', 'null'::jsonb),
                  '{date_evidence}', ((o.detail -> 'date_evidence') - 'source_as_of_basis')
                                     || '{"source_as_of_field":null}'::jsonb)
           else jsonb_set(o.detail, '{facets}', t.facets) end,
  item = jsonb_set(o.item, '{facets}', t.facets),
  filters = case when t.had_as_of
            then o.filters || '{"source_as_of":null,"source_lo":null,"source_hi":null}'::jsonb
            else o.filters end
from tgt t
where o.dataset = 'focused' and o.id = t.id;

update public.corpus_datasets set
  label = 'Coverage labels',
  metadata = metadata - 'qualification' - 'publication',
  updated_at = '2026-10-03 11:03:14.007374+00'
where id = 'coverage_labels' and metadata #>> '{publication,contract}' = 'coverage-labels-fold-v1';

do $post$
declare v_left bigint; v_asof bigint; v_cat bigint;
begin
  select count(*) into v_left from public.corpus_records
   where dataset = 'focused' and detail #> '{facets,labels}' ? 'label_overlay';
  select count(*) into v_asof from public.corpus_records r join _cl_fold_rb t on t.id = r.id
   where r.dataset = 'focused' and t.had_as_of
     and (r.detail #>> '{facets,dates,source_as_of,value}' is not null or r.filters ->> 'source_as_of' is not null
          or r.detail ->> 'source_as_of' is not null);
  select count(*) into v_cat from public.corpus_datasets
   where id = 'coverage_labels' and ready = false and label = 'Coverage labels'
     and not (metadata ? 'qualification') and not (metadata ? 'publication');
  if v_left <> 0 then raise exception '% focused rows still carry label_overlay', v_left; end if;
  if v_asof <> 0 then raise exception '% focused rows still carry a folded as-of', v_asof; end if;
  if v_cat <> 1 then raise exception 'catalog row not restored'; end if;
end
$post$;

commit;
