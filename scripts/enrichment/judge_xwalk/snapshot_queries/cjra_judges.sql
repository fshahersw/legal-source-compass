-- court_cjra_judges: identity, court, roles, listed report dates and the current profile match of every judge record
select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'identity', r.item->>'identity', 'court_id', r.item->>'court_id', 'roles', r.item->'roles',
  'role', r.filters->'role'->>0, 'active', r.filters->'active'->>0, 'listed', (select jsonb_agg(k order by k) from jsonb_object_keys(r.item->'printed_by_period') k),
  'match', r.item->'match', 'filter_profile', r.filters->'profile', 'filter_judge_profile', r.filters->'judge_profile', 'row_md5', md5(to_jsonb(r)::text)) order by r.id) as cjra
from public.corpus_records r where r.dataset='court_cjra_judges'
