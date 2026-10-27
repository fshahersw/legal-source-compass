-- coverage-labels-fold-v1.sql
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What was held: corpus_datasets 'coverage_labels' (ready=false since the 2026-10-02 bundle import), 10,013
-- corpus_records. Each row is a rule-based page classification of one captured official page (state legislature,
-- court and government hosts only; no commercial host). The hold had no source evidence (no seal, restriction or
-- policy hold): it was a caution hold.
--
-- Why the rows are not simply flipped to ready=true (accuracy, not caution; measured 2026-10-27):
--   * 10,009 of the 10,013 ids are the same record ids as published 'focused' records (same original_sha256).
--     public.corpus_detail(p_id) picks the first ready dataset by name, and 'coverage_labels' < 'focused', so a flip
--     would replace 10,009 published record pages (9,992 with full text) by an overlay row with empty text and a URL
--     as its title, and search would list every page twice.
--   * Every overlay row carries category 'guidance'; the pages are statute, constitution and court-rule pages, so
--     that category is wrong.
--   * Its law_body_class and rule_set already equal the published focused facets.labels on all 10,009 rows.
--   * The 4 ids with no focused twin are 3 navigation pages and the Delaware Constitution PDF, whose text is already
--     published in state_constitutions / state_constitution_sections (207 sections) and 'sources'.
--
-- What this contract releases: the facts the overlay has and the published records lack, folded onto the 10,009
-- published focused records (detail and item, whose facets are identical):
--   * 1,420 publisher-printed "as of" dates (Nevada "[Rev. ...]" revision stamps 950, Wisconsin "Published and
--     certified under s. 35.18" dates 470), each with the overlay's basis text; stated as printed, not an effective
--     date. Written to detail.source_as_of, detail.date_evidence, facets.dates.source_as_of and the filters
--     source_as_of/source_lo/source_hi (same YYYY-MM-DD value, as saved_lo/saved_hi do for saved_at).
--     Each date was checked against the published record's own stored text on 2026-10-27: every Nevada page holds
--     exactly one distinct "[Rev. M/D/YYYY" stamp and it equals the value (950/950); every Wisconsin page holds
--     "35.18" and the same date spelled out (470/470). The precondition below repeats that check.
--   * facets.labels: law_body_class_confidence and law_body_class_basis (the classifier's own plain-words basis),
--     law_body_class_detail (e.g. repeal_or_reserved_stub), rule_set_detail and rule_set_basis, plus label_overlay
--     provenance. Review fix 2026-10-27: confidence and basis are NOT copied for the classes 'form' (204 rows) and
--     'notice' (957 rows). Those classes misfire on statute and court-rule pages (form|high: 108 of 162 on
--     statute/rule publisher paths, e.g. olls.info/crs titles, ndlegis.gov/cencode chapters, vacodefull titles,
--     Nevada session-law volumes; notice|high: 710 of 784), so a "high" confidence would make a wrong class look
--     authoritative. label_overlay.class_confidence_omitted marks those rows; 8,848 rows get a confidence.
--     Correcting the published law_body_class on those rows is a separate follow-up.
-- The coverage_labels rows themselves stay in place (nothing deleted) and stay ready=false with a qualification that
-- says where their facts are published. Raw classifier feature vectors (link_ratio, function_ratio, ...) are not
-- copied: class_basis already states them in words.
--
-- Guarded: aborts unless the live state equals the 2026-10-27 dry run; only touches focused rows whose labels,
-- original hash and as-of slots match; refuses to run twice. Exact inverse: coverage-labels-fold-v1.rollback.sql.

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

-- 1. Preconditions -----------------------------------------------------------------------------------------------
do $pre$
declare
  v_overlay bigint; v_twins bigint; v_eligible bigint; v_folded bigint; v_bad_date bigint; v_meta jsonb; v_ready boolean;
begin
  select count(*) into v_overlay from public.corpus_records where dataset = 'coverage_labels';
  select count(*) into v_twins from public.corpus_records c
    join public.corpus_records o on o.dataset = 'focused' and o.id = c.id
   where c.dataset = 'coverage_labels';
  select count(*) into v_folded from public.corpus_records
   where dataset = 'focused' and detail #> '{facets,labels}' ? 'label_overlay';
  select count(*) into v_bad_date from public.corpus_records
   where dataset = 'coverage_labels' and item #>> '{temporal,source_as_of}' is not null
     and item #>> '{temporal,source_as_of}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  select ready, metadata into v_ready, v_meta from public.corpus_datasets where id = 'coverage_labels';
  if v_overlay <> 10013 then raise exception 'coverage_labels rows % <> 10013', v_overlay; end if;
  if v_twins <> 10009 then raise exception 'focused twins % <> 10009', v_twins; end if;
  if v_folded <> 0 then raise exception 'already folded: % focused rows carry label_overlay', v_folded; end if;
  if v_bad_date <> 0 then raise exception '% as-of values are not YYYY-MM-DD', v_bad_date; end if;
  if v_ready is distinct from false then raise exception 'coverage_labels ready is %, expected false', v_ready; end if;
  if v_meta ? 'qualification' or v_meta ? 'publication' then raise exception 'coverage_labels metadata already annotated'; end if;
  if v_meta ->> 'sha256' <> 'e24f575c2076e2c674ae399a030f181bac32fd5f7f71bdfe1a3b215416f77daa' then
    raise exception 'coverage_labels manifest changed: %', v_meta ->> 'sha256'; end if;
  -- every as-of date must be printed in the published record's own text (NV revision stamp, WI s. 35.18 date)
  select count(*) into v_bad_date
    from public.corpus_records c
    join public.corpus_records o on o.dataset = 'focused' and o.id = c.id
   where c.dataset = 'coverage_labels' and c.item #>> '{temporal,source_as_of}' is not null
     and not (
       (c.state = 'NV' and position('[Rev. ' || to_char((c.item #>> '{temporal,source_as_of}')::date, 'FMMM/FMDD/YYYY') in o.text) > 0)
       or (c.state = 'WI' and o.text like '%35.18%'
           and position(trim(to_char((c.item #>> '{temporal,source_as_of}')::date, 'Month')) || ' '
                        || to_char((c.item #>> '{temporal,source_as_of}')::date, 'FMDD, YYYY') in o.text) > 0));
  if v_bad_date <> 0 then raise exception '% as-of dates not found in the published text', v_bad_date; end if;
  with
  -- BEGIN PROJECTION (identical in coverage-labels-fold-v1.dryrun.sql; checked by scripts/admin/coverage-labels-fold.test.mjs)
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
  )
  -- END PROJECTION
  select count(*) into v_eligible from src;
  if v_eligible <> 10009 then raise exception 'eligible focused rows % <> 10009', v_eligible; end if;
end
$pre$;

-- 2. Fold the overlay facts onto the published focused records -----------------------------------------------------
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
  select o.id,
    -- facets (identical in detail and item): labels + optional as-of date
    jsonb_set(
      case when s.as_of is null then o.detail -> 'facets'
           else jsonb_set(o.detail -> 'facets', '{dates,source_as_of}',
                          jsonb_build_object('value', s.as_of, 'basis', s.as_of_basis)) end,
      '{labels}', (o.detail #> '{facets,labels}') || s.add_labels) as facets,
    s.as_of, s.as_of_basis
  from src s join public.corpus_records o on o.dataset = 'focused' and o.id = s.id
)
update public.corpus_records o set
  detail = case when n.as_of is null then jsonb_set(o.detail, '{facets}', n.facets)
           else jsonb_set(jsonb_set(jsonb_set(o.detail, '{facets}', n.facets),
                  '{source_as_of}', to_jsonb(n.as_of)),
                  '{date_evidence}', (o.detail -> 'date_evidence') || jsonb_build_object(
                    'source_as_of_field', 'coverage_labels.temporal.source_as_of',
                    'source_as_of_basis', n.as_of_basis)) end,
  item = jsonb_set(o.item, '{facets}', n.facets),
  filters = case when n.as_of is null then o.filters
            else o.filters || jsonb_build_object('source_as_of', n.as_of, 'source_lo', n.as_of, 'source_hi', n.as_of) end
from nxt n
where o.dataset = 'focused' and o.id = n.id;

-- 3. Catalog: the overlay stays unpublished, with its reason and where its facts now live --------------------------
update public.corpus_datasets set
  label = 'Machine page-type labels',
  metadata = metadata || jsonb_build_object(
    'qualification', 'Rule-based page-type labels for captured official law pages. Their labels, confidence, basis '
      || 'and publisher-printed as-of dates are published on the matching records of "Focused state and county '
      || 'legal-source captures". This copy is not listed separately: its rows share record ids with those pages and '
      || 'carry no text.',
    'publication', jsonb_build_object(
      'status', 'folded_into_published_records',
      'target_dataset', 'focused',
      'contract', 'coverage-labels-fold-v1',
      'decision', 'owner 2026-10-27: dont withhold any data. If its accurate and valuable, USE IT',
      'not_listed_reason', 'record ids collide with published focused records (corpus_detail would resolve 10,009 '
        || 'pages to this textless overlay); every row is categorised guidance, which is wrong for these pages')),
  updated_at = now()
where id = 'coverage_labels' and ready = false;

-- 4. Postconditions (abort and roll back the whole transaction on any mismatch) ----------------------------------
do $post$
declare v_labels bigint; v_asof bigint; v_filters bigint; v_top bigint; v_item_eq bigint; v_cat bigint;
begin
  -- counted on the folded rows only (757 other focused rows already carried a detail.source_as_of of their own)
  select count(*),
         count(*) filter (where detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true'
                            and detail #>> '{facets,dates,source_as_of,value}' is not null),
         count(*) filter (where detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true'
                            and filters ->> 'source_as_of' = detail #>> '{facets,dates,source_as_of,value}'
                            and filters ->> 'source_lo' = filters ->> 'source_as_of'
                            and filters ->> 'source_hi' = filters ->> 'source_as_of'),
         count(*) filter (where detail #>> '{facets,labels,label_overlay,source_as_of_folded}' = 'true'
                            and detail ->> 'source_as_of' = detail #>> '{facets,dates,source_as_of,value}'),
         count(*) filter (where detail -> 'facets' = item -> 'facets')
    into v_labels, v_asof, v_filters, v_top, v_item_eq
    from public.corpus_records
   where dataset = 'focused' and detail #> '{facets,labels}' ? 'label_overlay';
  select count(*) into v_cat from public.corpus_datasets
   where id = 'coverage_labels' and ready = false and metadata #>> '{publication,status}' = 'folded_into_published_records';
  if v_labels <> 10009 or v_item_eq <> 10009 then raise exception 'labels folded %/% (expected 10009)', v_labels, v_item_eq; end if;
  if v_asof <> 1420 or v_filters <> 1420 or v_top <> 1420 then
    raise exception 'as-of folded facets %, filters %, detail % (expected 1420)', v_asof, v_filters, v_top; end if;
  if v_cat <> 1 then raise exception 'catalog row not annotated'; end if;
  select count(*) filter (where detail #> '{facets,labels}' ? 'law_body_class_confidence'),
         count(*) filter (where detail #>> '{facets,labels,law_body_class}' in ('form', 'notice')
                            and (detail #> '{facets,labels}' ? 'law_body_class_confidence'
                                 or detail #> '{facets,labels}' ? 'law_body_class_basis'))
    into v_labels, v_asof
    from public.corpus_records
   where dataset = 'focused' and detail #>> '{facets,labels,label_overlay,contract}' = 'coverage-labels-fold-v1';
  if v_labels <> 8848 or v_asof <> 0 then
    raise exception 'confidence folded on % rows (expected 8848), % form/notice rows carry confidence or basis', v_labels, v_asof; end if;
end
$post$;

commit;
