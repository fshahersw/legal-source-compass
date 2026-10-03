-- Independent reconciliation of the 2026-10-03 data-quality ROUND 4 (run c41d48ea-d3fb-4362-bda3-a959b127a4cb). Read-only. Run each statement separately.
-- For every row-level fix it recomputes the ORIGINAL whole-row md5 from the CURRENT row with only the changed fields swapped back to the stored before-image
-- (and the derived search_vector recomputed where title/text changed): equality proves nothing else changed. "at_replacement" proves the stored replacement is what is live.
--
-- ===== V1: judges directory-stub flags (coordinator decision 4: flag only, no merge) =====
with a as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'judges' and issue = 'dq20261003r4_judges_directory_stub')
select jsonb_build_object(
  'audit_rows', count(*),
  'at_replacement', count(*) filter (where r.item = a.rp->'item' and r.detail = a.rp->'detail'),
  'virtual_revert_identical', count(*) filter (where md5((to_jsonb(r) || jsonb_build_object('item', a.o->'item', 'detail', a.o->'detail'))::text) = a.o->>'row_md5'),
  'flagged_now', (select count(*) from public.corpus_records where dataset = 'judges' and item->>'profile_role' = 'directory_stub'),
  'primary_is_fjc_backed_same_normalized_name_and_court', (select count(*) from public.corpus_records s where s.dataset = 'judges' and s.item->>'profile_role' = 'directory_stub'
        and exists (select 1 from public.corpus_records p where p.dataset = 'judges' and p.id = s.item->>'primary_profile_id' and p.detail->'structured'->'ids'->>'fjc_nid' is not null
                    and btrim(regexp_replace(regexp_replace(lower(normalize(coalesce(p.item->>'name', p.title), NFC)), '[.,]', ' ', 'g'), '\s+', ' ', 'g')) = btrim(regexp_replace(regexp_replace(lower(normalize(coalesce(s.item->>'name', s.title), NFC)), '[.,]', ' ', 'g'), '\s+', ' ', 'g'))
                    and exists (select 1 from jsonb_array_elements_text(coalesce(s.item->'courts','[]'::jsonb)) c where coalesce(p.item->'courts','[]'::jsonb) ? c))),
  'research_names_summary_equals_item', (select count(*) from public.corpus_research_names n join public.corpus_records r2 on r2.dataset = n.source_dataset and r2.id = n.source_id where n.kind = 'judge' and n.summary = r2.item),
  'research_names_judges', (select count(*) from public.corpus_research_names where kind = 'judge')) as receipt
from a join public.corpus_records r on r.dataset = 'judges' and r.id = a.record_id;

-- ===== V2: court_spine State fill (coordinator decision 1) =====
with s as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'court_spine' and issue = 'dq20261003r4_court_state_fill'),
m as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'corpus_workspace_court_map' and issue = 'dq20261003r4_court_map_state_fill'),
sv as (
 select s.record_id, r.state, r.filters, r.item, r.detail,
        md5((to_jsonb(r) || jsonb_build_object('title', s.o->>'title', 'state', s.o->>'state', 'item', s.o->'item', 'detail', s.o->'detail', 'text', s.o->>'text', 'filters', s.o->'filters',
              'search_vector', to_jsonb(public.corpus_bounded_search_vector(s.o->>'title', s.o->>'text'))))::text) = s.o->>'row_md5' as revert_ok,
        r.state = s.rp->>'state' and r.item = s.rp->'item' and r.detail = s.rp->'detail' and r.filters = s.rp->'filters' and r.text = s.rp->>'text' as at_replacement
 from s join public.corpus_records r on r.dataset = 'court_spine' and r.id = s.record_id),
mv as (
 select m.record_id, md5((to_jsonb(w) || jsonb_build_object('state', m.o->'row'->>'state', 'facts', m.o->'row'->'facts'))::text) = m.o->>'row_md5' as revert_ok,
        w.state = m.rp->>'state' and w.facts = m.rp->'facts' as at_replacement
 from m join public.corpus_workspace_court_map w on w.court_id = m.record_id)
select jsonb_build_object(
  'spine', jsonb_build_object('audit_rows', (select count(*) from s), 'at_replacement', (select count(*) from sv where at_replacement), 'virtual_revert_identical', (select count(*) from sv where revert_ok),
      'state_in_item_cells_filters_and_column_agree', (select count(*) from sv where filters->'state' = jsonb_build_array(state) and item->'cells'->>'state' = state)),
  'map', jsonb_build_object('audit_rows', (select count(*) from m), 'at_replacement', (select count(*) from mv where at_replacement), 'virtual_revert_identical', (select count(*) from mv where revert_ok)),
  'map_vs_spine', jsonb_build_object('state_or_facts_differ', (select count(*) from public.corpus_workspace_court_map w join public.corpus_records r on r.dataset = 'court_spine' and r.id = w.court_id where w.state is distinct from r.state or w.facts is distinct from r.detail->'facts'),
      'map_rows', (select count(*) from public.corpus_workspace_court_map), 'spine_rows', (select count(*) from public.corpus_records where dataset = 'court_spine')),
  'state_facet_options_off', (select count(*) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(f->'options') o
        where d.id = 'court_spine' and f->>'name' = 'state' and (o->>'count')::bigint is distinct from (select count(*) from public.corpus_records r where r.dataset = 'court_spine' and r.filters @> jsonb_build_object('state', jsonb_build_array(o->>'value')))),
  'excluded_homonym_traps_still_empty', (select count(*) from public.corpus_records where dataset = 'court_spine' and id in ('flactyct67','nyfamctdel','nyjustctportwa','ohcirctdelaware','reg-ST-vi_state','washterr') and coalesce(state,'') = ''),
  'suppressed_state_court_rows_left', (select count(*) from public.corpus_workspace_court_map where system = 'state' and coalesce(state,'') = '')) as receipt;

-- ===== V3: mdls cl_docket_id fill (coordinator decision 3, registry-master-ids.md) =====
with a as (select record_id, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'mdls' and issue = 'dq20261003r4_mdls_cl_docket_id')
select jsonb_build_object(
  'audit_rows', count(*),
  'at_replacement', count(*) filter (where r.item = a.rp->'item' and r.detail = a.rp->'detail'),
  'virtual_revert_identical', count(*) filter (where md5((to_jsonb(r) || jsonb_build_object('item', a.o->'item', 'detail', a.o->'detail'))::text) = a.o->>'row_md5'),
  'all_other_item_keys_unchanged', count(*) filter (where (r.item - 'cl_docket_id' - 'cl_docket_id_basis') = ((a.o->'item') - 'cl_docket_id')),
  'previous_cl_docket_id_was_null_or_absent', count(*) filter (where a.o->'item'->'cl_docket_id' = 'null'::jsonb or not ((a.o->'item') ? 'cl_docket_id')),
  'summary_equals_item', (select count(*) from public.corpus_records where dataset = 'mdls' and detail->'summary' = item),
  'mdls_with_cl_docket_id', (select count(*) from public.corpus_records where dataset = 'mdls' and item->>'cl_docket_id' is not null),
  'mdls_total', (select count(*) from public.corpus_records where dataset = 'mdls'),
  'ambiguous_conflict_blocked_left_empty', (select count(*) from public.corpus_records where dataset = 'mdls' and id in ('2804','3014','3143','3010','2885','2921') and item->>'cl_docket_id' is null),
  'ids_that_disagree_with_registry_file', (select count(*) from public.corpus_records r2 where r2.dataset = 'mdls' and r2.id in ('3047','3140','3094','3163','3180','3166','3080','3113','3081','2846','2873','3108','3149','3114','3185','3125','3144','3043','3060','2741','3026','2924','2323','2973','2789','2672','2843','3031','2606','2592','2782')
        and r2.item->>'cl_docket_id' is not null and r2.item->>'cl_docket_id' <> (select v.cl::text from (values ('3047',65407433),('3140',69674950),('3094',68222905),('3163',72052106),('3180',73443394),('3166',72030009),('3080',67665081),('3113',68869775),('3081',67678440),('2846',7603829),('2873',8408916),('3108',68837976),('3149',69912599),('3114',68936135),('3185',73454806),('3125',69255166),('3144',69871659),('3043',65408277),('3060',66801859),('2741',5981306),('3026',61690868),('2924',16813256),('2323',4369937),('2973',18753355),('2789',6224301),('2672',4182438),('2843',7067512),('3031',63363039),('2606',5838695),('2592',4270519),('2782',6078886)) v(id, cl) where v.id = r2.id)),
  'metadata_results_equal_live_items', (select count(*) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'results') x join public.corpus_records r3 on r3.dataset = 'mdls' and r3.item = x where d.id = 'mdls'),
  'metadata_filter_index_equal_live', (select count(*) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'filter_index') f join public.corpus_records r4 on r4.dataset = 'mdls' and r4.id = f->>'id' and r4.item = f->'item' and r4.filters = f->'filters' where d.id = 'mdls')) as receipt
from a join public.corpus_records r on r.dataset = 'mdls' and r.id = a.record_id;

-- ===== V4: Seeger Weiss counsel accuracy (round 4 item A) =====
with cd as (select record_id, issue, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'counsel_directory'),
ma as (select record_id, issue, original_record o, replacement rp from corpus_ingest.cleanup_decisions where run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and dataset = 'mdl_appearances'),
cdv as (
 select cd.issue, cd.record_id, md5((to_jsonb(r) || case when cd.o ? 'item' then jsonb_build_object('item', cd.o->'item') else '{}'::jsonb end || case when cd.o ? 'filters' then jsonb_build_object('filters', cd.o->'filters') else '{}'::jsonb end
          || jsonb_build_object('detail', cd.o->'detail', 'text', cd.o->>'text', 'search_vector', to_jsonb(public.corpus_bounded_search_vector(r.title, cd.o->>'text'))))::text) = cd.o->>'row_md5' as revert_ok,
        r.detail = cd.rp->'detail' and r.text = cd.rp->>'text' as at_replacement
 from cd join public.corpus_records r on r.dataset = 'counsel_directory' and r.id = cd.record_id),
mav as (
 select ma.issue, ma.record_id, md5((to_jsonb(r) || case when ma.o ? 'item' then jsonb_build_object('item', ma.o->'item') else '{}'::jsonb end || jsonb_build_object('filters', ma.o->'filters', 'detail', ma.o->'detail', 'text', ma.o->>'text',
          'search_vector', to_jsonb(public.corpus_bounded_search_vector(r.title, ma.o->>'text'))))::text) = ma.o->>'row_md5' as revert_ok,
        r.detail = ma.rp->'detail' and r.text = ma.rp->>'text' as at_replacement
 from ma join public.corpus_records r on r.dataset = 'mdl_appearances' and r.id = ma.record_id)
select jsonb_build_object(
  'counsel_directory', (select jsonb_object_agg(issue, jsonb_build_object('audit_rows', n, 'at_replacement', ok_rep, 'virtual_revert_identical', ok_rev)) from (select issue, count(*) n, count(*) filter (where at_replacement) ok_rep, count(*) filter (where revert_ok) ok_rev from cdv group by issue) q),
  'mdl_appearances', (select jsonb_object_agg(issue, jsonb_build_object('audit_rows', n, 'at_replacement', ok_rep, 'virtual_revert_identical', ok_rev)) from (select issue, count(*) n, count(*) filter (where at_replacement) ok_rep, count(*) filter (where revert_ok) ok_rev from mav group by issue) q),
  'remaining_raw_terminated_seeger', jsonb_build_object(
      'counsel_directory_attorney_records', (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'sections') s, jsonb_array_elements(coalesce(s->'rows','[]'::jsonb)) x
            where r.dataset = 'counsel_directory' and s->>'heading' = 'Roles seen' and x->>0 = 'terminated' and x->>1 = 'Terminated' and r.detail::text ~* 'seeger\s*,?\s*weiss'),
      'mdl_appearances_rows', (select count(*) from public.corpus_records r where r.dataset = 'mdl_appearances' and r.item::text ~* 'seeger\s*,?\s*weiss' and r.item->'cells'->>'role' = 'Terminated')),
  'seeger_role_values', jsonb_build_object(
      'counsel_directory_firm_cells_roles', (select item->'cells'->>'roles' from public.corpus_records where dataset = 'counsel_directory' and id = 'firm:3f24b0b7635a81a8'),
      'attorney_records_with_pro_hac_vice', (select count(*) from public.corpus_records where dataset = 'counsel_directory' and filters @> '{"kind":["attorney"]}' and filters->'role' ? 'Pro hac vice' and detail::text ~* 'seeger\s*,?\s*weiss'),
      'appearances_pro_hac_vice', (select count(*) from public.corpus_records where dataset = 'mdl_appearances' and item::text ~* 'seeger\s*,?\s*weiss' and filters @> '{"role":["Pro hac vice"]}')),
  'firm_headings', (select jsonb_agg(s->>'heading') from public.corpus_records r, jsonb_array_elements(r.detail->'sections') s where r.dataset = 'counsel_directory' and r.id = 'firm:3f24b0b7635a81a8' and (s->>'heading' like 'Attorneys (%' or s->>'heading' like 'Dockets (%')),
  'docket_flags', (select count(*) from public.corpus_records r, jsonb_array_elements(r.detail->'facts') f where r.dataset in ('counsel_directory','mdl_appearances') and f->>0 = 'Docket attribution check'),
  'role_facet_options_off', (select jsonb_object_agg(d.id, (select count(*) from jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(f->'options') o where f->>'name' = 'role'
        and (o->>'count')::bigint is distinct from (select count(*) from public.corpus_records r where r.dataset = d.id and (r.filters @> jsonb_build_object('role', jsonb_build_array(o->>'value')) or r.filters @> jsonb_build_object('role', o->>'value')))))
        from public.corpus_datasets d where d.id in ('counsel_directory','mdl_appearances')),
  'research_names_summary_not_equal_item', (select count(*) from public.corpus_research_names n join public.corpus_records r on r.dataset = n.source_dataset and r.id = n.source_id where n.summary is distinct from r.item),
  'research_names_sync_rows', (select count(*) from corpus_ingest.cleanup_decisions c join public.corpus_research_names n on c.record_id = n.kind || '|' || n.canonical_id
        where c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.dataset = 'corpus_research_names' and (to_jsonb(n) || jsonb_build_object('summary', c.original_record->'row'->'summary', 'refreshed_at', c.original_record->'row'->'refreshed_at')) = c.original_record->'row')) as receipt;

-- ===== V5: metrics alignment (round 4 item B) =====
with act as (select dataset, count(*) n, count(*) filter (where filters @> '{"_listing":["yes"]}' or filters @> '{"_listing":"yes"}' or filters @> '{"_listing":"true"}' or filters @> '{"_listing":["true"]}') listed, count(*) filter (where filters ? '_listing') has_flag from public.corpus_records group by 1),
d as (select d.id, d.imported_records, d.expected_records, d.metadata, a.n, a.listed, a.has_flag from public.corpus_datasets d left join act a on a.dataset = d.id where d.ready)
select jsonb_build_object(
  'ready_datasets', (select count(*) from d),
  'imported_or_expected_not_equal_live_count', (select count(*) from d where imported_records is distinct from n or expected_records is distinct from n),
  'metadata_ready_false_on_ready_dataset', (select count(*) from d where metadata->'ready' = 'false'::jsonb),
  'single_mode_listing_total_not_equal_live_listed', (select count(*) from d where has_flag > 0 and metadata->'listing'->>'total' is not null and not (metadata ? 'listing_modes' and (select count(*) from jsonb_object_keys(metadata->'listing_modes')) > 1) and (metadata->'listing'->>'total')::bigint <> listed),
  'multi_mode_sum_not_equal_live_count', (select count(*) from d where (select count(*) from jsonb_object_keys(coalesce(metadata->'listing_modes','{}'::jsonb))) > 1 and (select sum((v->>'total')::bigint) from jsonb_each(metadata->'listing_modes') e(k,v)) <> n),
  'metadata_expected_records_not_equal_column', (select count(*) from d where metadata->>'expected_records' is not null and (metadata->>'expected_records')::bigint <> expected_records),
  'court_spine', (select jsonb_build_object('listing_total', metadata->'listing'->'total', 'mode_total', metadata->'listing_modes'->'default'->'total', 'expected_records', metadata->'expected_records', 'live', n, 'kept_receipt_exported_records', metadata->'exported_records') from d where id = 'court_spine'),
  'qualification_texts', (select jsonb_build_object(
        'court_documents', substring(metadata->'listing'->>'qualification' from 'Index of [0-9,]+ of the [0-9,]+ downloaded court documents'),
        'mdl_docket_activity', substring(metadata->'listing'->>'qualification' from '36 of the 176 JPML-registry MDLs of the 2026-09-01 report \(the MDL directory lists [0-9]+'),
        'mdls_ids_sentence_count', substring((select metadata->'listing'->>'qualification' from d where id = 'mdls') from '([0-9]+) master-docket ids'),
        'counsel_directory_mode_copies_equal_listing', (select bool_and(e.value->>'qualification' = (select metadata->'listing'->>'qualification' from d where id = 'counsel_directory')) from d x, jsonb_each(x.metadata->'listing_modes') e where x.id = 'counsel_directory'))
      from d where id = 'court_documents' limit 1),
  'chunked_context_expected_records', (select jsonb_object_agg(substring(c.key from 14), (select (string_agg(p.data #>> '{}', '' order by t.ord))::jsonb->>'expected_records' from jsonb_array_elements_text(c.data->'parts') with ordinality t(pkey, ord) join public.corpus_context p on p.key = t.pkey))
        from public.corpus_context c where c.key in ('dataset-meta:counties','dataset-meta:county_litigation','dataset-meta:judges','dataset-meta:people','dataset-meta:sources')),
  'agency_context_rows_not_equal_live', (select count(*) from public.corpus_context c, jsonb_array_elements(c.data->'items') i where c.key = 'agency:datasets'
        and (i->>'rows')::bigint <> (select count(*) from public.corpus_records r where r.dataset = 'agency_safety_' || (i->>'dataset')))) as receipt;
