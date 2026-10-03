-- Independent reconciliation of the 2026-10-03 data-quality pass (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b). Read-only.
-- For each title fix it recomputes the ORIGINAL whole-row md5 from the current row with only the changed fields swapped
-- back to the stored before-image (and the derived search_vector recomputed): equality proves nothing else changed.
with a as (
 select c.issue, c.dataset, c.record_id, c.original_record o, c.replacement rp
 from corpus_ingest.cleanup_decisions c
 where c.run_id = '664a081e-b5a6-4ab0-af5a-41c260b0d09b'
   and c.issue in ('dq20261003_nj_statute_citation_prefix','dq20261003_markdown_wrapped_title','dq20261003_markdown_form_title','dq20261003_html_entity_title')),
j as (
 select a.*, r.title cur_title, r.text cur_text, to_jsonb(r) cur_row
 from a join public.corpus_records r on r.dataset = a.dataset and r.id = a.record_id),
rev as (
 select issue, count(*) audit_rows,
  count(*) filter (where cur_title = rp->>'title') at_replacement,
  count(*) filter (where md5((case when issue = 'dq20261003_nj_statute_citation_prefix'
     then jsonb_set(jsonb_set(jsonb_set(jsonb_set(cur_row,'{title}',to_jsonb(o->>'title')),'{item,title}',o->'item_title'),'{detail,title}',o->'detail_title'),'{search_vector}',to_jsonb(public.corpus_bounded_search_vector(o->>'title', cur_text)))
     else jsonb_set(jsonb_set(jsonb_set(jsonb_set(cur_row,'{title}',to_jsonb(o->>'title')),'{item}',o->'item'),'{detail}',o->'detail'),'{search_vector}',to_jsonb(public.corpus_bounded_search_vector(o->>'title', cur_text))) end)::text) = o->>'row_md5') virtual_revert_identical,
  count(*) filter (where cur_row->>'search_vector' = to_jsonb(public.corpus_bounded_search_vector(cur_title, cur_text))#>>'{}') search_vector_current
 from j group by issue),
labels as (
 select c.record_id, c.replacement->>'label' new_label, d.label cur_label from corpus_ingest.cleanup_decisions c join public.corpus_datasets d on d.id = c.record_id
 where c.run_id = '664a081e-b5a6-4ab0-af5a-41c260b0d09b' and c.dataset = 'corpus_datasets' and c.issue = 'dq20261003_dataset_label'),
facets as (
 select d.id, d.metadata->'listing'->'filters' f from public.corpus_datasets d where d.id in ('counsel_directory','mdl_counsel','court_spine'))
select jsonb_build_object(
 'run_id','664a081e-b5a6-4ab0-af5a-41c260b0d09b',
 'title_fixes', (select jsonb_object_agg(issue, jsonb_build_object('audit_rows',audit_rows,'at_replacement',at_replacement,'virtual_revert_identical',virtual_revert_identical,'search_vector_current',search_vector_current)) from rev),
 'labels', jsonb_build_object('audit_rows',(select count(*) from labels),'cur_label_equals_replacement_except_later_addendum',(select count(*) from labels where cur_label = new_label),
    'raw_id_labels',(select count(*) from public.corpus_datasets where label = id),
    'title_cased_id_labels',(select count(*) from public.corpus_datasets where label <> id and label = initcap(replace(id,'_',' ')))),
 'catalog', jsonb_build_object('datasets',(select count(*) from public.corpus_datasets),'ready',(select count(*) filter (where ready) from public.corpus_datasets),
    'sum_imported_records',(select sum(imported_records) from public.corpus_datasets),'orphan_rows',(select count(*) from public.corpus_records r where not exists (select 1 from public.corpus_datasets d where d.id = r.dataset))),
 'remaining_defects', jsonb_build_object(
    'nj_duplicate_citation_titles',(select count(*) from public.corpus_records where dataset='seeger' and title ~ '^(\S+) — \1\.?\s+\S'),
    'wrapped_markdown_titles',(select count(*) from public.corpus_records where dataset in ('seeger','url_directory','docsupload_coverage','court_forms_expansion_20260912','court_documents') and ((title ~ '^\*\*[^*].*[^*]\*\*$' and title !~ '\*\*.*\*\*.*\*\*') or title ~ '^\*\*([^*]+)\*\*\(([^)]*)\)$')),
    'cfr_url_directory_entity_titles',(select count(*) from public.corpus_records where dataset in ('federal_regulations_sections','url_directory') and title ~ '&(amp|lt|gt|quot|apos|#0?39|#x27);'),
    'nj_duplicate_group_titles',(select count(*) from public.corpus_display_groups where metadata->>'title' ~ '^[0-9]+[A-Z]?:[0-9A-Za-z.\-]+ — [0-9]+[A-Z]?:[0-9A-Za-z.\-]+')),
 'facet_option_mismatches', (select jsonb_object_agg(id, mm) from (
    select f.id, (select count(*) from jsonb_array_elements(f.f) fl, jsonb_array_elements(coalesce(fl->'options','[]'::jsonb)) o
        where fl->>'type'='select' and (o->>'count')::bigint is distinct from (
          select count(*) from public.corpus_records r where r.dataset = f.id and (r.filters @> jsonb_build_object(fl->>'name', o->>'value') or r.filters @> jsonb_build_object(fl->>'name', jsonb_build_array(o->>'value'))))) mm
    from facets f) q),
 'unchanged_invariants', jsonb_build_object('court_map_rows',(select count(*) from public.corpus_workspace_court_map),'docket_links_rows',(select count(*) from public.corpus_workspace_docket_links),
    'law_collections_rows',(select count(*) from public.corpus_law_collections),'records_deleted',0),
 'checked_at', now()) as receipt;
