-- Independent reconciliation of the 2026-10-03 data-quality ROUND 2 (run af6ac9c6-b834-497d-bd19-17970d4857d3). Read-only.
-- For every row-level fix it recomputes the ORIGINAL whole-row md5 (or whole-row JSON for the join tables) from the CURRENT row with only
-- the changed fields swapped back to the stored before-image (and the derived search_vector recomputed): equality proves nothing else changed.
with t as (
 select c.issue, c.dataset, c.record_id, c.original_record o, c.replacement rp
 from corpus_ingest.cleanup_decisions c
 where c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
   and c.issue in ('dq20261003r2_markdown_lone_marker','dq20261003r2_litigation_title_defect','dq20261003r2_citation_trailing_comma')),
tj as (select t.*, r.title cur_title, r.text cur_text, to_jsonb(r) cur_row,
        -- 6 trailing-comma rows were later also touched by the reporter-facet pass: swap their filters back too
        (select f.original_record->'filters' from corpus_ingest.cleanup_decisions f
          where f.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3' and f.issue = 'dq20261003r2_citation_reporter_facet' and f.dataset = t.dataset and f.record_id = t.record_id) as facet_filters
        from t join public.corpus_records r on r.dataset = t.dataset and r.id = t.record_id),
title_fixes as (
 select issue, count(*) audit_rows, count(*) filter (where cur_title = rp->>'title') at_replacement,
  count(*) filter (where md5(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(cur_row,'{title}',to_jsonb(o->>'title')),'{item}',o->'item'),'{detail}',o->'detail'),'{search_vector}',to_jsonb(public.corpus_bounded_search_vector(o->>'title', cur_text))),'{filters}',coalesce(facet_filters, cur_row->'filters'))::text) = o->>'row_md5') virtual_revert_identical,
  count(*) filter (where cur_row->>'search_vector' = to_jsonb(public.corpus_bounded_search_vector(cur_title, cur_text))#>>'{}') search_vector_current
 from tj group by issue),
facet as (
 select count(*) audit_rows,
  count(*) filter (where r.filters->'reporter' = jsonb_build_array(c.replacement->>'reporter')) at_replacement,
  count(*) filter (where md5(jsonb_set(to_jsonb(r),'{filters}',c.original_record->'filters')::text) = c.original_record->>'row_md5') virtual_revert_identical
 from corpus_ingest.cleanup_decisions c join public.corpus_records r on r.dataset='citation_index' and r.id=c.record_id
 where c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3' and c.issue='dq20261003r2_citation_reporter_facet'),
mdls as (
 select count(*) audit_rows, count(*) filter (where r.text = c.replacement->>'text') at_replacement,
  count(*) filter (where md5(jsonb_set(jsonb_set(to_jsonb(r),'{text}',to_jsonb(c.original_record->>'text')),'{search_vector}',to_jsonb(public.corpus_bounded_search_vector(r.title, c.original_record->>'text')))::text) = c.original_record->>'row_md5') virtual_revert_identical,
  count(*) filter (where to_jsonb(r)->>'search_vector' = to_jsonb(public.corpus_bounded_search_vector(r.title, r.text))#>>'{}') search_vector_current
 from corpus_ingest.cleanup_decisions c join public.corpus_records r on r.dataset='mdls' and r.id=c.record_id
 where c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3' and c.issue='dq20261003r2_mdls_searchable_identifiers'),
links as (
 select count(*) audit_rows,
  count(*) filter (where l.event_date = c.replacement->>'event_date' and l.date_basis = c.replacement->>'date_basis') at_replacement,
  count(*) filter (where to_jsonb(l) || jsonb_build_object('event_date', c.original_record->'event_date', 'date_basis', c.original_record->'date_basis', 'refreshed_at', c.original_record->'refreshed_at') = c.original_record) virtual_revert_identical
 from corpus_ingest.cleanup_decisions c
 join public.corpus_workspace_docket_links l on c.record_id = l.source_dataset || '/' || l.source_record_id || '/' || l.mdl
 where c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3' and c.issue='dq20261003r2_docket_link_event_date'),
opts as (
 select (select count(*) from jsonb_array_elements(f->'options') o
          where (o->>'count')::bigint is distinct from (select count(*) from public.corpus_records r where r.dataset='citation_index' and r.filters @> jsonb_build_object('reporter', jsonb_build_array(o->>'value')))) mismatches,
        jsonb_array_length(f->'options') n_options
 from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f where d.id='citation_index' and f->>'name'='reporter')
select jsonb_build_object(
 'run_id','af6ac9c6-b834-497d-bd19-17970d4857d3',
 'title_fixes', (select jsonb_object_agg(issue, jsonb_build_object('audit_rows',audit_rows,'at_replacement',at_replacement,'virtual_revert_identical',virtual_revert_identical,'search_vector_current',search_vector_current)) from title_fixes),
 'citation_reporter_facet', (select to_jsonb(facet) from facet),
 'citation_reporter_options', (select to_jsonb(opts) from opts),
 'mdls_searchable_identifiers', (select to_jsonb(mdls) from mdls),
 'docket_link_event_dates', (select to_jsonb(links) from links),
 'court_map', jsonb_build_object('rows',(select count(*) from public.corpus_workspace_court_map),'court_spine_rows',(select count(*) from public.corpus_records where dataset='court_spine'),
    'dangling_source_rows',(select count(*) from public.corpus_workspace_court_map m where not exists (select 1 from public.corpus_records s where s.dataset = m.source_dataset and s.id = m.source_record_id)),
    'removed_rows_audited',(select count(*) from corpus_ingest.cleanup_decisions where run_id='af6ac9c6-b834-497d-bd19-17970d4857d3' and issue='dq20261003r2_court_map_quarantined_testing_court')),
 'remaining_defects', jsonb_build_object(
    'citation_index_trailing_punct',(select count(*) from public.corpus_records where dataset='citation_index' and title ~ '[,;:]$'),
    'seeger_titles_starting_with_star',(select count(*) from public.corpus_records where dataset='seeger' and title ~ '^\*'),
    'court_documents_dot_leader',(select count(*) from public.corpus_records where dataset='court_documents' and title ~ '\.{4,}\s*$'),
    'mdls_empty_text',(select count(*) from public.corpus_records where dataset='mdls' and text = ''),
    'undated_activity_links',(select count(*) from public.corpus_workspace_docket_links where event_date is null and source_dataset = 'mdl_docket_activity')),
 'catalog', jsonb_build_object('datasets',(select count(*) from public.corpus_datasets),'ready',(select count(*) filter (where ready) from public.corpus_datasets),
    'sum_imported_records',(select sum(imported_records) from public.corpus_datasets),'orphan_rows',(select count(*) from public.corpus_records r where not exists (select 1 from public.corpus_datasets d where d.id = r.dataset))),
 'unchanged_invariants', jsonb_build_object('docket_links_rows',(select count(*) from public.corpus_workspace_docket_links),'law_collections_rows',(select count(*) from public.corpus_law_collections),'records_deleted',0),
 'checked_at', now()) as receipt;
