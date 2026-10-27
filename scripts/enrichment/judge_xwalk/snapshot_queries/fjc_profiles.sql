-- judge_profiles_fjc: FJC nid, linked /judges profile ids, status, name and every service (court, type, commission, termination, senior status)
select jsonb_agg(jsonb_build_object('nid', r.id, 'profiles', coalesce(r.filters->'judge_profile','[]'::jsonb), 'status', r.item->'profile'->>'status', 'name', r.item->'profile'->>'name',
  'services', (select coalesce(jsonb_agg(jsonb_build_object('court_id', s->>'court_id', 'court_type', s->>'court_type', 'commission', s->>'commission', 'termination', coalesce(s->>'termination_date', s->>'termination'), 'senior', s->>'senior_status') order by o),'[]'::jsonb) from jsonb_array_elements(r.item->'profile'->'services') with ordinality t(s,o))) order by r.id) as fjc
from public.corpus_records r where r.dataset='judge_profiles_fjc'
