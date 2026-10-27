-- judge_cl_crosswalk: every /judges profile with its FJC nid, CourtListener person id, tier and review flag
select jsonb_agg(jsonb_build_object('judges_id', r.id, 'fjc_nid', r.item->'profile'->>'fjc_nid', 'cl_person_id', r.item->'profile'->>'cl_person_id', 'tier', r.item->'profile'->>'tier',
  'needs_review', r.item->'profile'->'needs_review', 'name', r.item->'profile'->>'name', 'system', r.item->'profile'->>'system', 'court_ids', r.item->'profile'->'court_ids') order by r.id) as xwalk
from public.corpus_records r where r.dataset='judge_cl_crosswalk'
