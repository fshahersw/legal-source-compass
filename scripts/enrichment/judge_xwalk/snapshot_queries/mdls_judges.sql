-- mdls: the transferee-judge fields of every MDL record with its row md5, the CourtListener docket assignment (corpus_ingest.relationships
-- dockets.assigned_to_id of item.cl_docket_id), the assigned person as CourtListener publishes it, and every judge_cl_crosswalk profile that
-- carries that person id (with its tier). Read-only.
with m as (
  select r.id, r.item, r.detail, r.filters, md5(to_jsonb(r)::text) as row_md5 from public.corpus_records r where r.dataset = 'mdls'),
a as (
  select m.id, rl.to_id as person, rl.evidence_sha256, rl.run_id
  from m join corpus_ingest.relationships rl
    on rl.source_system = 'courtlistener' and rl.from_type = 'dockets' and rl.from_id = m.item->>'cl_docket_id' and rl.field = 'assigned_to_id' and rl.to_type = 'people')
select jsonb_agg(jsonb_build_object(
  'id', m.id, 'row_md5', m.row_md5, 'mdl_number', m.item->'mdl_number', 'status', m.item->>'status', 'title', m.item->>'title', 'court_id', m.item->>'cl_court_id',
  'cl_docket_id', m.item->>'cl_docket_id', 'master_docket', m.item->>'master_docket', 'judge_name_as_printed', m.item->>'judge_name_as_printed', 'judge_entity_id', m.item->>'judge_entity_id',
  'judge_profile_id', m.item->>'judge_profile_id', 'judge_cl_person_id', m.item->>'judge_cl_person_id', 'judge_cl_person_basis', m.item->>'judge_cl_person_basis',
  'judge_match_kind', m.item->>'judge_match_kind', 'judge_link_basis', m.item->>'judge_link_basis', 'judge_relation', m.item->>'judge_relation',
  'judge_resolved', m.item->'judge_resolved', 'cl_assigned_to_id', m.item->>'cl_assigned_to_id', 'filter_cl_person_id', m.filters->'cl_person_id',
  'judge_links', m.detail->'judge_links', 'summary_equals_item', (m.detail->'summary') = m.item,
  'assigned', (select jsonb_agg(jsonb_build_object('person', a.person, 'evidence_sha256', a.evidence_sha256, 'run_id', a.run_id,
       'name', (select jsonb_build_object('first', e.data->>'name_first', 'middle', e.data->>'name_middle', 'last', e.data->>'name_last', 'suffix', e.data->>'name_suffix',
                  'fjc_id', e.data->>'fjc_id', 'is_alias_of_id', e.data->>'is_alias_of_id', 'source_as_of', e.source_as_of)
                from corpus_ingest.entities e where e.source_system = 'courtlistener' and e.entity_type = 'people' and e.native_id = a.person),
       'profiles', (select jsonb_agg(jsonb_build_object('judges_id', x.id, 'tier', x.item->'profile'->>'tier', 'fjc_nid', x.item->'profile'->>'fjc_nid',
                      'name', (select j.item->>'name' from public.corpus_records j where j.dataset = 'judges' and j.id = x.id),
                      'entity_id', (select j.item->>'entity_id' from public.corpus_records j where j.dataset = 'judges' and j.id = x.id)) order by x.id)
                from public.corpus_records x where x.dataset = 'judge_cl_crosswalk' and x.item->'profile'->>'cl_person_id' = a.person)))
     from a where a.id = m.id)
) order by m.id) as mdls
from m
