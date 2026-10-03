-- citation-index-invalid-year-court/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; approved by the coordinator after the round-2 review)
-- Work item A follow-up. Two wrong facts shown on the Citation index detail page:
--   (1) 'Year as parsed from the text' that is not a year (a pin cite / page number taken as the year): value not a 4-digit number in 1750..2026
--       (66 rows, e.g. '163 U.S. 662' year 5204, '116 F. 350' year '1180-81'); it is also appended to the card subtitle ("United States v. Ball · 5204").
--   (2) 'Court as parsed (CourtListener id)' that is not a CourtListener court (470 rows): vaccappomattox (Virginia circuit court) on 460 Arizona /
--       P.2d / P.3d citations, supctdc on 10 N.Y.S.2d / N.W. / Wis. citations. court_spine (the CourtListener court snapshot) has neither id.
-- Fix (removal only, no replacement value invented): drop the fact from detail.facts, drop the trailing ' · <year>' from item.subtitle and
-- detail.subtitle (subtitle becomes '' when it was only the year), and remove the same fact text / subtitle suffix from the flattened `text`
-- (first occurrence only, anchored on the fixed 'title subtitle Authority ...' layout). title, filters, links, counts unchanged.
-- search_vector is recomputed by the existing trigger (text changed). Before-image: whole title/text/item/detail + whole-row md5.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact; the trigger restores the search_vector):
--   update public.corpus_records r set text = c.original_record->>'text', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r3_citation_invalid_year_court' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset='citation_index' and r.id=c.record_id;
--
-- ===== statement 1: audit (before-images) =====
with f as (
 select r.id,
  (select g->>1 from jsonb_array_elements(r.detail->'facts') g where g->>0 = 'Year as parsed from the text' limit 1) as y,
  (select g->>1 from jsonb_array_elements(r.detail->'facts') g where g->>0 = 'Court as parsed (CourtListener id)' limit 1) as ct
 from public.corpus_records r where r.dataset = 'citation_index'),
target as materialized (
 select f.id,
  case when f.y is not null and (f.y !~ '^[0-9]{4}$' or f.y::int < 1750 or f.y::int > 2026) then f.y end as bad_year,
  case when f.ct is not null and not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = f.ct) then f.ct end as bad_court
 from f where f.y is not null or f.ct is not null),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'citation_index', t.id, 'dq20261003r3_citation_invalid_year_court', 'label_override',
  'Parsed year is not a year (pin cite taken as year) and/or the parsed court id is not a CourtListener court. The wrong fact (and the year in the subtitle) is removed; nothing is substituted.',
  jsonb_build_object('review_version','citation-index-invalid-year-court/2026-10-03.r3.1','year_rule','4-digit number in 1750..2026','court_rule','id must exist in court_spine (CourtListener courts snapshot)'),
  jsonb_build_object('id',r.id,'ordinal',r.ordinal,'title',r.title,'text',r.text,'item',r.item,'detail',r.detail,'row_md5',md5(to_jsonb(r)::text)),
  jsonb_build_object('year',t.bad_year,'court',t.bad_court),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from target t join public.corpus_records r on r.dataset = 'citation_index' and r.id = t.id
 where t.bad_year is not null or t.bad_court is not null
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target where bad_year is not null) bad_years, (select count(*) from target where bad_court is not null) bad_courts, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply from the audited before-images =====
with d as (
 select r.id, r.title, r.item, r.detail, r.text, r.item->>'subtitle' as sub, c.replacement->>'year' as y, c.replacement->>'court' as ct
 from corpus_ingest.cleanup_decisions c join public.corpus_records r on r.dataset = 'citation_index' and r.id = c.record_id
 where c.issue = 'dq20261003r3_citation_invalid_year_court' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
   and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'),
n as (
 select d.*, case when d.y is null then d.sub
                  when d.sub = d.y then ''
                  when right(d.sub, length(' · ' || d.y)) = ' · ' || d.y then left(d.sub, length(d.sub) - length(' · ' || d.y))
                  else d.sub end as new_sub from d),
t1 as (
 select n.*, case when n.y is not null and left(n.text, length(n.title || ' ' || n.sub || ' ')) = n.title || ' ' || n.sub || ' '
                  then n.title || ' ' || n.new_sub || ' ' || substr(n.text, length(n.title || ' ' || n.sub || ' ') + 1) else n.text end as text1 from n),
t2 as (
 select t1.*, case when t1.y is not null and position('Year as parsed from the text ' || t1.y || ' ' in t1.text1) > 0
                   then left(t1.text1, position('Year as parsed from the text ' || t1.y || ' ' in t1.text1) - 1) || substr(t1.text1, position('Year as parsed from the text ' || t1.y || ' ' in t1.text1) + length('Year as parsed from the text ' || t1.y || ' '))
                   else t1.text1 end as text2 from t1),
t3 as (
 select t2.*, case when t2.ct is not null and position('Court as parsed (CourtListener id) ' || t2.ct || ' ' in t2.text2) > 0
                   then left(t2.text2, position('Court as parsed (CourtListener id) ' || t2.ct || ' ' in t2.text2) - 1) || substr(t2.text2, position('Court as parsed (CourtListener id) ' || t2.ct || ' ' in t2.text2) + length('Court as parsed (CourtListener id) ' || t2.ct || ' '))
                   else t2.text2 end as text3 from t2),
u as (
 update public.corpus_records r
    set item = case when t3.y is not null then jsonb_set(t3.item, '{subtitle}', to_jsonb(t3.new_sub)) else t3.item end,
        detail = jsonb_set(case when t3.y is not null then jsonb_set(t3.detail, '{subtitle}', to_jsonb(t3.new_sub)) else t3.detail end, '{facts}',
                 (select coalesce(jsonb_agg(f order by ord), '[]'::jsonb) from jsonb_array_elements(t3.detail->'facts') with ordinality x(f, ord)
                   where not (t3.y is not null and f->>0 = 'Year as parsed from the text') and not (t3.ct is not null and f->>0 = 'Court as parsed (CourtListener id)'))),
        text = t3.text3
   from t3 where r.dataset = 'citation_index' and r.id = t3.id
 returning r.id)
select (select count(*) from u) updated, (select count(*) from t3 where y is not null and text2 = text1) year_text_pattern_missed, (select count(*) from t3 where ct is not null and text3 = text2) court_text_pattern_missed;
