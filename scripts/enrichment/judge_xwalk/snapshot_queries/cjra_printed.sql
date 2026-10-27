-- court_cjra_judges: the first printed label and the latest mixed-case printed label of the records whose profile link the relink removes
-- (relink_cjra_judges.py names them when it stops; only needed with a cjra_judges snapshot captured before those fields were added to it).
-- Replace the id list with the ids the script prints.
select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'row_md5', md5(to_jsonb(r)::text),
  'printed_first', (select e.v from jsonb_each_text(r.item->'printed_by_period') e(k, v) order by e.k limit 1),
  'printed_mixed', (select e.v from jsonb_each_text(r.item->'printed_by_period') e(k, v) where e.v ~ '[a-z]' and e.v ~ '[A-Z]' order by e.k desc limit 1)) order by r.id) as cjra_printed
from public.corpus_records r where r.dataset = 'court_cjra_judges' and r.id in ('nyed-dearcy-hall-lashann-monique')
