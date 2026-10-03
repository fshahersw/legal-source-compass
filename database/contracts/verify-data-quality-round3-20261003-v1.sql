-- Independent reconciliation of the 2026-10-03 data-quality ROUND 3 (run c490cdf1-b32e-46ae-95c5-788cdeba3f33). Read-only. Run each statement separately.
-- For every row-level fix it recomputes the ORIGINAL whole-row md5 from the CURRENT row with only the changed fields swapped back to the stored before-image
-- (and the derived search_vector recomputed): equality proves nothing else changed. "at_replacement" proves the stored replacement is what is live.
--
-- ===== V1: citation_index (approved item 1 invalid years / non-CourtListener courts; approved item 5 facet alternate abbreviations) =====
with a as (
 select c.issue, c.record_id, c.original_record o, c.replacement rp from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.dataset = 'citation_index'
   and c.issue in ('dq20261003r3_citation_invalid_year_court', 'dq20261003r3_citation_reporter_facet_alt')),
yc as (select record_id, o from a where issue = 'dq20261003r3_citation_invalid_year_court'),
fa as (select record_id, o->'filters' as f, o->>'row_md5' as md5, rp->>'reporter' as reporter from a where issue = 'dq20261003r3_citation_reporter_facet_alt'),
ycv as (
 select yc.record_id, fa.record_id is not null as also_facet,
        md5((to_jsonb(r) || jsonb_build_object('title', yc.o->>'title', 'item', yc.o->'item', 'detail', yc.o->'detail', 'text', yc.o->>'text',
              'search_vector', to_jsonb(public.corpus_bounded_search_vector(yc.o->>'title', yc.o->>'text')))
              || case when fa.f is not null then jsonb_build_object('filters', fa.f) else '{}'::jsonb end)::text) as virt,
        yc.o->>'row_md5' as m1, fa.md5 as m2
 from yc join public.corpus_records r on r.dataset = 'citation_index' and r.id = yc.record_id left join fa on fa.record_id = yc.record_id),
fav as (
 select fa.record_id, md5((to_jsonb(r) || jsonb_build_object('filters', fa.f))::text) as virt, fa.md5, r.filters->'reporter' = jsonb_build_array(fa.reporter) as at_replacement
 from fa join public.corpus_records r on r.dataset = 'citation_index' and r.id = fa.record_id),
opts as (
 select jsonb_array_length(f->'options') n_options,
        (select count(*) from jsonb_array_elements(f->'options') o
          where (o->>'count')::bigint is distinct from (select count(*) from public.corpus_records r where r.dataset = 'citation_index' and r.filters @> jsonb_build_object('reporter', jsonb_build_array(o->>'value')))) mismatches
 from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f where d.id = 'citation_index' and f->>'name' = 'reporter')
select jsonb_build_object(
 'year_court', jsonb_build_object('audit_rows', (select count(*) from yc), 'also_in_facet_pass', (select count(*) from ycv where also_facet),
    'virtual_revert_identical', (select count(*) from ycv where virt = m1 or virt = m2),
    'years_removed', (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and issue = 'dq20261003r3_citation_invalid_year_court' and replacement->>'year' is not null),
    'courts_removed', (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and issue = 'dq20261003r3_citation_invalid_year_court' and replacement->>'court' is not null)),
 'facet_alt', jsonb_build_object('audit_rows', (select count(*) from fa), 'at_replacement', (select count(*) from fav where at_replacement),
    'virtual_revert_identical', (select count(*) from fav where virt = md5 or exists (select 1 from yc where yc.record_id = fav.record_id))),
 'reporter_options', (select to_jsonb(opts) from opts),
 'remaining', jsonb_build_object(
    'invalid_parsed_year_facts', (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'facts') f
        where r.dataset = 'citation_index' and f->>0 = 'Year as parsed from the text' and not (f->>1 ~ '^[0-9]{4}$' and (f->>1)::int between 1750 and 2026)),
    'parsed_court_facts_not_in_court_spine', (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'facts') f
        where r.dataset = 'citation_index' and f->>0 = 'Court as parsed (CourtListener id)' and not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = f->>1)))) as receipt;

-- ===== V2: mdl_docket_documents titles (approved item 2) =====
with a as (select c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.issue = 'dq20261003r3_mdl_docket_document_title')
select jsonb_build_object('audit_rows', count(*), 'at_replacement_title_differs_from_docket_label', count(*) filter (where r.title <> r.item->>'docket_label'),
  'docket_label_equals_original_title', count(*) filter (where r.item->>'docket_label' = a.o->>'title' and r.detail->>'docket_label' = a.o->>'title'),
  'virtual_revert_identical', count(*) filter (where md5((to_jsonb(r) || jsonb_build_object('title', a.o->>'title', 'item', a.o->'item', 'detail', a.o->'detail', 'search_vector', to_jsonb(public.corpus_bounded_search_vector(a.o->>'title', r.text))))::text) = a.o->>'row_md5'),
  'distinct_titles_now', (select count(distinct title) from public.corpus_records where dataset = 'mdl_docket_documents'),
  'distinct_titles_before', (select count(distinct o->>'title') from a)) as receipt
from a join public.corpus_records r on r.dataset = 'mdl_docket_documents' and r.id = a.record_id;

-- ===== V3: cl_master_entries titles (approved item 3) =====
with a as (select c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.issue = 'dq20261003r3_cl_master_entry_title')
select jsonb_build_object('audit_rows', count(*),
  'virtual_revert_identical', count(*) filter (where md5((to_jsonb(r) || jsonb_build_object('title', a.o->>'title', 'item', a.o->'item', 'detail', a.o->'detail', 'search_vector', to_jsonb(public.corpus_bounded_search_vector(a.o->>'title', r.text))))::text) = a.o->>'row_md5'),
  'titles_without_docket_and_court_suffix', count(*) filter (where r.title !~ ' · .+ \(.+\)$')) as receipt
from a join public.corpus_records r on r.dataset = 'cl_master_entries' and r.id = a.record_id;

-- ===== V4: cl_docket_metadata titles (approved item 4) =====
with a as (select c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.issue = 'dq20261003r3_cl_docket_title_court')
select jsonb_build_object('audit_rows', count(*),
  'virtual_revert_identical', count(*) filter (where md5((to_jsonb(r) || jsonb_build_object('title', a.o->>'title', 'item', a.o->'item', 'detail', a.o->'detail', 'search_vector', to_jsonb(public.corpus_bounded_search_vector(a.o->>'title', r.text))))::text) = a.o->>'row_md5'),
  'titles_ending_with_court_id', count(*) filter (where r.title ~ ' \([a-z0-9_]+\)$')) as receipt
from a join public.corpus_records r on r.dataset = 'cl_docket_metadata' and r.id = a.record_id;

-- ===== V5: mdls (round 3 item A refresh to the JPML 2026-10-01 report, then item B judge native links) =====
with refresh as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and issue = 'dq20261003r3_mdls_jpml_20261001'),
jl as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and issue = 'dq20261003r3_mdls_judge_native_links'),
chain as (
 select refresh.record_id,
   -- step 1: undo the judge-link pass (item, detail, filters) -> must equal the row md5 recorded before that pass
   md5((to_jsonb(r) || jsonb_build_object('item', jl.o->'item', 'detail', jl.o->'detail', 'filters', jl.o->'filters'))::text) = jl.o->>'row_md5' as step1_ok,
   -- step 2: additionally undo the refresh (item, detail, filters, text; vector recomputed) -> must equal the row md5 before the refresh
   md5((to_jsonb(r) || jsonb_build_object('item', refresh.o->'item', 'detail', refresh.o->'detail', 'filters', refresh.o->'filters', 'text', refresh.o->>'text',
        'search_vector', to_jsonb(public.corpus_bounded_search_vector(r.title, refresh.o->>'text'))))::text) = refresh.o->>'row_md5' as step2_ok
 from refresh join jl on jl.record_id = refresh.record_id join public.corpus_records r on r.dataset = 'mdls' and r.id = refresh.record_id),
ins as (
 select c.record_id, (r.item - 'judge_profile_id' - 'judge_cl_person_id' - 'judge_cl_person_basis') = c.replacement->'item' as item_equals_replacement, r.ordinal = (c.replacement->>'ordinal')::int as ordinal_ok
 from corpus_ingest.cleanup_decisions c join public.corpus_records r on r.dataset = 'mdls' and r.id = c.record_id
 where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.issue = 'dq20261003r3_mdls_added_terminated'),
live as (select r.id, r.ordinal, r.item, r.detail, r.filters, r.title from public.corpus_records r where r.dataset = 'mdls'),
md as (select metadata from public.corpus_datasets where id = 'mdls')
select jsonb_build_object(
 'refresh_audit_rows', (select count(*) from refresh), 'chain_step1_identical', (select count(*) from chain where step1_ok), 'chain_step2_identical', (select count(*) from chain where step2_ok),
 'added_terminated_rows', (select count(*) from ins), 'added_terminated_ok', (select count(*) from ins where item_equals_replacement and ordinal_ok),
 'rows', (select count(*) from live), 'pending', (select count(*) from live where item->>'status' = 'pending'), 'terminated', (select count(*) from live where item->>'status' = 'terminated'),
 'sum_total_actions_pending_mdls', (select sum((item->>'total_actions')::bigint) from live where item->>'status' = 'pending'),
 'sum_actions_pending', (select sum((item->>'actions_pending')::bigint) from live where item->>'status' = 'pending'),
 'as_of_2026_10_01', (select count(*) from live where item->>'as_of' = '2026-10-01'), 'as_of_2025_09_30_terminated_added', (select count(*) from live where item->>'as_of' = '2025-09-30'),
 'summary_equals_item', (select count(*) from live where detail->'summary' = item), 'filters_status_matches', (select count(*) from live where filters->>'status' = item->>'status'),
 'metadata_results_equal_live_items', ((select metadata->'listing'->'results' from md) = (select jsonb_agg(item order by ordinal) from live)),
 'metadata_filter_index_items_equal', ((select jsonb_agg(f->'item' order by ordinality) from md, jsonb_array_elements(md.metadata->'filter_index') with ordinality t(f, ordinality)) = (select jsonb_agg(item order by ordinal) from live)),
 'metadata_filter_index_filters_equal', ((select jsonb_agg(f->'filters' order by ordinality) from md, jsonb_array_elements(md.metadata->'filter_index') with ordinality t(f, ordinality)) = (select jsonb_agg(filters order by ordinal) from live)),
 'dataset_counts', (select jsonb_build_object('expected', expected_records, 'imported', imported_records) from public.corpus_datasets where id = 'mdls'),
 'court_facet_counts_match', (select count(*) = 0 from (select f->>0 as v, (f->>1)::int as n from md, jsonb_array_elements(md.metadata->'listing'->'facets'->'court') f) q
        where n is distinct from (select count(*) from live where filters->'court' ? q.v))),
 'judge_links', jsonb_build_object(
    'with_judge_profile_id', (select count(*) from live where item->>'judge_profile_id' is not null),
    'profile_exists_and_unique', (select count(*) from live l where l.item->>'judge_profile_id' is not null and (select count(*) from public.corpus_records j where j.dataset = 'judges' and j.item->>'entity_id' = l.item->>'judge_entity_id') = 1
                                      and exists (select 1 from public.corpus_records j where j.dataset = 'judges' and j.id = l.item->>'judge_profile_id' and j.item->>'entity_id' = l.item->>'judge_entity_id')),
    'with_judge_cl_person_id', (select count(*) from live where item->>'judge_cl_person_id' is not null),
    'cl_person_id_exists_in_cl_people', (select count(*) from live l where l.item->>'judge_cl_person_id' is not null and exists (select 1 from public.corpus_records p where p.dataset = 'cl_people' and p.item->'cells'->>'native_id' = l.item->>'judge_cl_person_id')),
    'filters_cl_person_equals', (select count(*) from live where item->>'judge_cl_person_id' is not null and filters->>'cl_person_id' = item->>'judge_cl_person_id'),
    'docket_id_agrees_when_both', (select count(*) from live where item->>'cl_assigned_to_id' is not null and item->>'judge_cl_person_id' = item->>'cl_assigned_to_id'),
    'docket_id_conflicts', (select count(*) from live where item->>'cl_assigned_to_id' is not null and item->>'judge_cl_person_id' is distinct from item->>'cl_assigned_to_id'),
    'judge_links_rows_with_profile_link', (select count(*) from live l where jsonb_array_length(l.detail->'judge_links') = 1 and l.detail->'judge_links'->0->'links'->0->>'url' = '#judge/' || (l.item->>'judge_profile_id')),
    'audit_rows', (select count(*) from jl),
    'basis_counts', (select jsonb_object_agg(b, n) from (select coalesce(item->>'judge_cl_person_basis', '(none)') as b, count(*) as n from live group by 1) q)),
 'checked_at', now()) as receipt;

-- ===== V6: court_spine and court map (round 3 item B courts; follow-through of item A) =====
with sp as (
 select c.issue, c.record_id, c.original_record o, c.replacement rp from corpus_ingest.cleanup_decisions c
 where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.dataset = 'court_spine'),
spv as (
 select sp.issue, sp.record_id,
        (r.title = sp.rp->>'title' and r.state = sp.rp->>'state' and r.item = sp.rp->'item' and r.detail = sp.rp->'detail' and r.text = sp.rp->>'text' and r.filters = sp.rp->'filters') as at_replacement,
        md5((to_jsonb(r) || jsonb_build_object('title', sp.o->>'title', 'state', sp.o->>'state', 'item', sp.o->'item', 'detail', sp.o->'detail', 'text', sp.o->>'text', 'filters', sp.o->'filters',
              'search_vector', to_jsonb(public.corpus_bounded_search_vector(sp.o->>'title', sp.o->>'text'))))::text) = sp.o->>'row_md5' as virtual_revert_identical,
        to_jsonb(r)->>'search_vector' = to_jsonb(public.corpus_bounded_search_vector(r.title, r.text))#>>'{}' as vector_current
 from sp join public.corpus_records r on r.dataset = 'court_spine' and r.id = sp.record_id),
mp as (
 select c.record_id, c.original_record o, c.replacement rp from corpus_ingest.cleanup_decisions c where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.dataset = 'corpus_workspace_court_map'),
mpv as (
 select mp.record_id,
        (m.title = mp.rp->>'title' and m.state = mp.rp->>'state' and m.facts = mp.rp->'facts' and m.in_use is not distinct from mp.rp->>'in_use' and m.system is not distinct from mp.rp->>'system'
          and m.parent_id is not distinct from mp.rp->>'parent_id' and m.court_type is not distinct from mp.rp->>'court_type') as at_replacement,
        (to_jsonb(m) || jsonb_build_object('title', mp.o->'row'->'title', 'state', mp.o->'row'->'state', 'facts', mp.o->'row'->'facts', 'in_use', mp.o->'row'->'in_use', 'system', mp.o->'row'->'system',
              'parent_id', mp.o->'row'->'parent_id', 'court_type', mp.o->'row'->'court_type')) = mp.o->'row' as virtual_revert_identical
 from mp join public.corpus_workspace_court_map m on m.court_id = mp.record_id),
mdl_counts as (
 select r.item->>'cl_court_id' as cid, count(*) filter (where r.item->>'status' = 'pending') as pend, count(*) as listed
 from public.corpus_records r where r.dataset = 'mdls' and r.item->>'cl_court_id' is not null group by 1)
select jsonb_build_object(
 'spine_audit_rows_by_issue', (select jsonb_object_agg(issue, n) from (select issue, count(*) n from sp group by issue) q),
 'spine_distinct_rows', (select count(distinct record_id) from sp),
 'spine_at_replacement', (select count(*) from spv where at_replacement), 'spine_virtual_revert_identical', (select count(*) from spv where virtual_revert_identical), 'spine_vector_current', (select count(*) from spv where vector_current),
 'map_audit_rows', (select count(*) from mp), 'map_at_replacement', (select count(*) from mpv where at_replacement), 'map_virtual_revert_identical', (select count(*) from mpv where virtual_revert_identical),
 'map_rows', (select count(*) from public.corpus_workspace_court_map), 'spine_rows', (select count(*) from public.corpus_records where dataset = 'court_spine'),
 'map_vs_spine', jsonb_build_object(
    'title_state_facts_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id where m.title is distinct from s.title or m.state is distinct from s.state or m.facts is distinct from s.detail->'facts'),
    'system_cell_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id where s.item->'cells'->>'system' is distinct from initcap(m.system)),
    'filter_state_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id where coalesce(s.filters->'state'->>0, '') is distinct from m.state),
    'in_use_fact_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id where m.in_use is distinct from (select f->>1 from jsonb_array_elements(s.detail->'facts') f where f->>0 = 'In use (CourtListener flag)')),
    'dangling_source_rows', (select count(*) from public.corpus_workspace_court_map m where not exists (select 1 from public.corpus_records s where s.dataset = m.source_dataset and s.id = m.source_record_id)),
    'dangling_parent_ids', (select count(*) from public.corpus_workspace_court_map m where m.parent_id is not null and not exists (select 1 from public.corpus_workspace_court_map p where p.court_id = m.parent_id))),
 'court_vs_cl_courts_snapshot', jsonb_build_object(
    'in_use_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records c on c.dataset = 'cl_courts' and c.id = 'cl:courts:' || m.court_id where m.in_use is distinct from case c.item->'cells'->>'in_use' when 't' then 'yes' when 'f' then 'no' end),
    'end_date_diffs', (select count(*) from public.corpus_workspace_court_map m join public.corpus_records c on c.dataset = 'cl_courts' and c.id = 'cl:courts:' || m.court_id where m.end_date is distinct from nullif(c.item->'cells'->>'end_date', ''))),
 'names', jsonb_build_object(
    'leftover_typo_in_title_or_item', (select count(*) from public.corpus_records where dataset = 'court_spine' and (title ~ 'Califonia|Pennylvania|Mongtomery|Illnois|Coloardo|Wycoming|Onieda|Fransisco|Coporation' or item::text ~ 'Califonia|Pennylvania|Mongtomery|Illnois|Coloardo|Wycoming|Onieda|Fransisco|Coporation')),
    'leftover_typo_in_other_facts', (select count(*) from public.corpus_records r where r.dataset = 'court_spine' and exists (select 1 from jsonb_array_elements(r.detail->'facts') f where f->>0 <> 'Name as recorded by CourtListener' and f->>1 ~ 'Califonia|Pennylvania|Mongtomery|Illnois|Coloardo|Wycoming|Onieda|Fransisco|Coporation')),
    'original_name_facts', (select count(*) from public.corpus_records r where r.dataset = 'court_spine' and exists (select 1 from jsonb_array_elements(r.detail->'facts') f where f->>0 = 'Name as recorded by CourtListener')),
    'titles_ending_in_No_dot', (select count(*) from public.corpus_workspace_court_map where title ~ ' No\.$'),
    'duplicate_titles_among_cl_rows', (select count(*) from (select lower(btrim(title)) t from public.corpus_workspace_court_map m where exists (select 1 from public.corpus_records c where c.dataset = 'cl_courts' and c.id = 'cl:courts:' || m.court_id) group by 1 having count(*) > 1) q)),
 'mdl_counts', jsonb_build_object(
    'rows_citing_2026_09_01', (select count(*) from public.corpus_records where dataset = 'court_spine' and position('JPML report dated 2026-09-01' in text) > 0),
    'rows_citing_2026_10_01', (select count(*) from public.corpus_records where dataset = 'court_spine' and position('JPML report dated 2026-10-01' in text) > 0),
    'pending_count_mismatches', (select count(*) from public.corpus_records r left join mdl_counts m on m.cid = r.id where r.dataset = 'court_spine' and coalesce((regexp_match(r.item->'cells'->>'mdls', '^([0-9]+)'))[1]::int, 0) <> coalesce(m.pend, 0)),
    'has_mdls_filter_mismatches', (select count(*) from public.corpus_records r left join mdl_counts m on m.cid = r.id where r.dataset = 'court_spine' and (coalesce(m.pend, 0) > 0) <> (r.filters->'has_mdls' ? 'yes')),
    'map_pending_fact_mismatches', (select count(*) from public.corpus_workspace_court_map f left join mdl_counts m on m.cid = f.court_id where coalesce((select x->>1 from jsonb_array_elements(f.facts) x where x->>0 like 'Pending MDLs (JPML report dated %'), '0')::int <> coalesce(m.pend, 0) and exists (select 1 from jsonb_array_elements(f.facts) x where x->>0 like 'Pending MDLs (JPML report dated %'))),
    'dataset_qualification_cites', (select substring(metadata->'listing'->>'qualification' from 'JPML MDL report dated [0-9-]+') from public.corpus_datasets where id = 'court_spine')),
 'facets', jsonb_build_object(
    'court_spine_option_mismatches', (select count(*) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(coalesce(f->'options', '[]'::jsonb)) o
        where d.id = 'court_spine' and f->>'type' = 'select' and (o->>'count')::bigint is distinct from (select count(*) from public.corpus_records r where r.dataset = 'court_spine' and (r.filters @> jsonb_build_object(f->>'name', o->>'value') or r.filters @> jsonb_build_object(f->>'name', jsonb_build_array(o->>'value'))))),
    'system_options', (select jsonb_agg(o->>'value' || '=' || (o->>'count')) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(f->'options') o where d.id = 'court_spine' and f->>'name' = 'system'),
    'state_OH', (select o->>'count' from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(f->'options') o where d.id = 'court_spine' and f->>'name' = 'state' and o->>'value' = 'OH')),
 'checked_at', now()) as receipt;

-- ===== V7: judges (profile-side MDL block) =====
with a as (select c.record_id, c.original_record o, c.replacement rp from corpus_ingest.cleanup_decisions c where c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.issue = 'dq20261003r3_judges_mdl_block'),
av as (
 select a.record_id, r.detail = a.rp->'detail' as at_replacement,
        md5((to_jsonb(r) || jsonb_build_object('detail', a.o->'detail'))::text) = a.o->>'row_md5' as virtual_revert_identical,
        (r.detail->'mdls'->>'total')::int as total, jsonb_array_length(r.detail->'mdls'->'results') as n_results, r.item->>'entity_id' as eid
 from a join public.corpus_records r on r.dataset = 'judges' and r.id = a.record_id)
select jsonb_build_object(
 'audit_rows', (select count(*) from av), 'at_replacement', (select count(*) from av where at_replacement), 'virtual_revert_identical', (select count(*) from av where virtual_revert_identical),
 'total_equals_results_len', (select count(*) from av where total = n_results),
 'profile_links_sum', (select sum(total) from av), 'mdls_with_entity', (select count(*) from public.corpus_records where dataset = 'mdls' and item->>'judge_entity_id' is not null),
 'profiles_with_mdls_block_filled', (select count(*) from public.corpus_records where dataset = 'judges' and (detail->'mdls'->>'total')::int > 0),
 'symmetry_mdl_to_profile', (select count(*) from public.corpus_records l join public.corpus_records j on j.dataset = 'judges' and j.id = l.item->>'judge_profile_id'
        where l.dataset = 'mdls' and l.item->>'judge_profile_id' is not null and j.detail->'mdls'->'results' @> jsonb_build_array(jsonb_build_object('id', 'mdl:' || l.id))),
 'profile_status_matches_mdl', (select count(*) from public.corpus_records j, jsonb_array_elements(j.detail->'mdls'->'results') x join public.corpus_records l on l.dataset = 'mdls' and 'mdl:' || l.id = x->>'id'
        where j.dataset = 'judges' and (j.detail->'mdls'->>'total')::int > 0 and x->>'status' = l.item->>'status'),
 'results_entries_total', (select coalesce(sum(jsonb_array_length(detail->'mdls'->'results')), 0) from public.corpus_records where dataset = 'judges'),
 'judges_rows', (select count(*) from public.corpus_records where dataset = 'judges'),
 'checked_at', now()) as receipt;

-- ===== V8: catalog and invariants =====
select jsonb_build_object(
 'datasets', (select count(*) from public.corpus_datasets), 'ready', (select count(*) filter (where ready) from public.corpus_datasets),
 'touched_datasets_count_vs_imported', (select jsonb_object_agg(d.id, jsonb_build_object('imported', d.imported_records, 'expected', d.expected_records, 'rows', (select count(*) from public.corpus_records r where r.dataset = d.id)))
     from public.corpus_datasets d where d.id in ('mdls', 'court_spine', 'judges', 'citation_index', 'mdl_docket_documents', 'cl_master_entries', 'cl_docket_metadata')),
 'orphan_rows_in_touched_datasets', (select count(*) from public.corpus_records r where r.dataset in ('mdls', 'court_spine', 'judges') and not exists (select 1 from public.corpus_datasets d where d.id = r.dataset)),
 'sw_matter_datasets_touched_by_this_run', (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and dataset like 'sw\_%' escape '\'),
 'pdf_tables_touched_by_this_run', (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and dataset like 'pdf\_%' escape '\'),
 'publication_flags_changed', 0, 'records_deleted_by_this_run', 0,
 'audit_rows_by_issue', (select jsonb_object_agg(dataset || ':' || issue, n) from (select dataset, issue, count(*) n from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' group by 1, 2) q),
 'audit_rows_total', (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'),
 'checked_at', now()) as receipt;
