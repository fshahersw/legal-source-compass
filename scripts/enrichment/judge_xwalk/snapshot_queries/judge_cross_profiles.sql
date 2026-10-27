-- judge_cross_profiles: every record (judges and the summary) with its FJC nid, stored profile id, profile filter, scatter entries and row md5,
-- plus the photo_url of each /judges profile those nids reach through judge_cl_crosswalk (the builder copies it as cross.photo)
select jsonb_build_object(
  'records', (select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.item->>'kind', 'nid', r.item->'cross'->>'nid', 'name', r.item->'cross'->>'name',
      'judge_profile_id', r.item->'cross'->>'judge_profile_id', 'photo', r.item->'cross'->>'photo', 'filter_judge_profile', r.filters->'judge_profile',
      'link_labels', (select jsonb_agg(l->>'label') from jsonb_array_elements(r.item->'links') l),
      'scatter', (select jsonb_agg(jsonb_build_object('nid', s->>'nid', 'judge_profile_id', s->>'judge_profile_id', 'photo', s->>'photo')) from jsonb_array_elements(r.item->'summary'->'scatter') s),
      'row_md5', md5(to_jsonb(r)::text)) order by r.id)
    from public.corpus_records r where r.dataset = 'judge_cross_profiles'),
  'photos', (select jsonb_object_agg(j.id, j.item->>'photo_url') from public.corpus_records j
    where j.dataset = 'judges' and coalesce(j.item->>'photo_url', '') <> ''
      and j.id in (select x.id from public.corpus_records x where x.dataset = 'judge_cl_crosswalk'
                     and x.item->'profile'->>'fjc_nid' in (select c.item->'cross'->>'nid' from public.corpus_records c where c.dataset = 'judge_cross_profiles')))
) as judge_cross
