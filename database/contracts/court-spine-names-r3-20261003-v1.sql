-- court-spine-names/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; round 3 item B "court accuracy: names")
-- Scope: public.corpus_records dataset='court_spine' only (the court directory); the corpus_workspace_court_map projection is re-synced from it by
--        court-map-sync-r3-20261003-v1.sql (map.title and map.facts are byte-copies of spine.title and spine.detail.facts for all 5,411 rows).
-- Evidence (see docs/data-quality-round3-2026-10-03.md):
--  (A) typo words. CourtListener publishes these court names with a misspelled word that the same CourtListener family (child courts, sibling
--      courts, the court's own short_name) and courts-db 0.10.27 spell correctly:
--        Califonia->California (caljustct; its 21 child courts are named "California Justice Court, <county>"), Pennylvania->Pennsylvania (pamunictphila),
--        Mongtomery->Montgomery (paorphctmongto), Illnois->Illinois (circtndil, circtsdil; sibling circtdil spells it correctly), Coloardo->Colorado (cosuperct),
--        Wycoming->Wyoming (pactcomplwycomi), Onieda->Oneida (nyoniedactyct), Fransisco->Francisco (sfdistct; courts-db), Coporation->Corporation (vacorpct;
--        its own short_name and courts-db; 5 child courts "<city> Corporation Court, Va.").
--      Applied word-for-word to title, item, detail, text (this also corrects the "Parent court (CourtListener)" facts and the percent-encoded
--      "search documents for this court name" links of the 31 child courts). The court's own row keeps the CourtListener spelling as the fact
--      "Name as recorded by CourtListener". 37 spine rows, 10 of them the courts themselves.
--  (B) truncated names. texctyct70/71/72 are all named "Texas City Court, Harris City Criminal Court at Law No." (CourtListener cut the number); the
--      same row's own short_name carries it ("... Crim. Ct. at Law No. 3" / "No. 4" / "No. 11"). The number is appended to the name; "City" (which CourtListener
--      prints where the court is a Texas county court) is NOT rewritten. The original goes to the fact "Name as recorded by CourtListener".
-- Not changed: cl_courts (the verbatim CourtListener snapshot) and any other dataset.
-- Before-image: whole title / state / item / detail / text / filters + whole-row md5 in corpus_ingest.cleanup_decisions
--   issues dq20261003r3_court_name_typo and dq20261003r3_court_name_number (dataset court_spine). search_vector is recomputed by the existing trigger.
-- Execute statements 1..4 in order (each is guarded by the row md5, so a rerun changes nothing).
--
-- ROLLBACK (exact; run per issue, the trigger restores search_vector):
--   update public.corpus_records r
--      set title = c.original_record->>'title', state = c.original_record->>'state', item = c.original_record->'item', detail = c.original_record->'detail',
--          text = c.original_record->>'text', filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'court_spine' and c.issue in ('dq20261003r3_court_name_typo', 'dq20261003r3_court_name_number')
--      and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and r.dataset = 'court_spine' and r.id = c.record_id;
--   (then run the rollback of court-map-sync-r3-20261003-v1.sql)
--
-- ===== statement 1: audit (A) typo words =====
with recursive typo(n, bad, good) as (values
  (1,'Califonia','California'),(2,'Pennylvania','Pennsylvania'),(3,'Mongtomery','Montgomery'),(4,'Illnois','Illinois'),
  (5,'Coloardo','Colorado'),(6,'Wycoming','Wyoming'),(7,'Onieda','Oneida'),(8,'Fransisco','Francisco'),(9,'Coporation','Corporation')),
flag as (select true as apply),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5,
        exists (select 1 from typo t where position(t.bad in r.title) > 0) as self_typo
 from public.corpus_records r
 where r.dataset = 'court_spine'
   and exists (select 1 from typo t where position(t.bad in r.title) > 0 or position(t.bad in r.text) > 0
                                       or position(t.bad in r.item::text) > 0 or position(t.bad in r.detail::text) > 0)),
fold(id, i, f_title, f_item, f_detail, f_text) as (
 select id, 0, title, item::text, detail::text, text from tgt
 union all
 select f.id, f.i + 1, replace(f.f_title, t.bad, t.good), replace(f.f_item, t.bad, t.good),
        replace(f.f_detail, t.bad, t.good), replace(f.f_text, t.bad, t.good)
 from fold f join typo t on t.n = f.i + 1),
fx as (
 select g.id, g.title as old_title, g.item as old_item, g.detail as old_detail, g.text as old_text, g.state, g.filters, g.row_md5, g.self_typo,
        d.f_title as new_title, d.f_item::jsonb as new_item,
        case when g.self_typo then jsonb_set(d.f_detail::jsonb, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
               select e.v as x, e.o * 2 as ord from jsonb_array_elements(d.f_detail::jsonb->'facts') with ordinality e(v, o)
               union all
               select jsonb_build_array('Name as recorded by CourtListener', g.title), e.o * 2 + 1
                 from jsonb_array_elements(d.f_detail::jsonb->'facts') with ordinality e(v, o) where e.v->>0 = 'Name') q))
             else d.f_detail::jsonb end as new_detail,
        case when g.self_typo then replace(d.f_text, 'Name ' || d.f_title || ' ', 'Name ' || d.f_title || ' Name as recorded by CourtListener ' || g.title || ' ')
             else d.f_text end as new_text
 from tgt g join fold d on d.id = g.id and d.i = 9),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.id, 'dq20261003r3_court_name_typo', 'label_override',
  'Court name carries a misspelled word that the same CourtListener family (child courts, sibling courts, own short_name) and courts-db spell correctly. Corrected word-for-word; the CourtListener spelling stays as the fact "Name as recorded by CourtListener" on the court itself; parent-name facts of child courts follow.',
  jsonb_build_object('review_version','court-spine-names/2026-10-03.r3.1','words','Califonia, Pennylvania, Mongtomery, Illnois, Coloardo, Wycoming, Onieda, Fransisco, Coporation','self_typo',x.self_typo,'approved_by','coordinator (round 3 item B: court accuracy, fix deterministic defects)'),
  jsonb_build_object('id',x.id,'title',x.old_title,'state',x.state,'item',x.old_item,'detail',x.old_detail,'text',x.old_text,'filters',x.filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.new_title,'state',x.state,'item',x.new_item,'detail',x.new_detail,'text',x.new_text,'filters',x.filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from tgt where self_typo) self_typo_rows,
       (select count(*) from ins) audit_rows_written,
       (select string_agg(id || ': ' || old_title || ' -> ' || new_title, ' | ' order by id) from fx where self_typo) renamed;

-- ===== statement 2: apply (A) =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_name_typo' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'court_spine' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: audit (B) truncated numbers =====
with flag as (select true as apply),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5,
        (select f->>1 from jsonb_array_elements(r.detail->'facts') f where f->>0 = 'Short name') as short_name
 from public.corpus_records r where r.dataset = 'court_spine' and r.title ~ ' No\.$'),
fx0 as (
 select g.id, g.title as old_title, g.item as old_item, g.detail as old_detail, g.text as old_text, g.state, g.filters, g.row_md5, g.short_name,
        (regexp_match(g.short_name, ' No\. ([0-9]+)$'))[1] as num,
        g.title || ' ' || (regexp_match(g.short_name, ' No\. ([0-9]+)$'))[1] as new_title
 from tgt g where g.short_name ~ ' No\. [0-9]+$'),
fx1 as (
 select x.*,
   replace(replace(x.old_item::text, to_jsonb(x.old_title)::text, to_jsonb(x.new_title)::text), 'Law%20No."', 'Law%20No.%20' || x.num || '"')::jsonb as new_item,
   replace(replace(x.old_detail::text, to_jsonb(x.old_title)::text, to_jsonb(x.new_title)::text), 'Law%20No."', 'Law%20No.%20' || x.num || '"')::jsonb as d1,
   replace(x.old_text, x.old_title || ' ', x.new_title || ' ') as t1
 from fx0 x),
fx as (
 select y.id, y.old_title, y.new_title, y.old_item, y.old_detail, y.old_text, y.state, y.filters, y.row_md5, y.short_name, y.new_item,
        jsonb_set(y.d1, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
            select e.v as x, e.o * 2 as ord from jsonb_array_elements(y.d1->'facts') with ordinality e(v, o)
            union all
            select jsonb_build_array('Name as recorded by CourtListener', y.old_title), e.o * 2 + 1
              from jsonb_array_elements(y.d1->'facts') with ordinality e(v, o) where e.v->>0 = 'Name') q)) as new_detail,
        replace(y.t1, 'Name ' || y.new_title || ' ', 'Name ' || y.new_title || ' Name as recorded by CourtListener ' || y.old_title || ' ') as new_text
 from fx1 y),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.id, 'dq20261003r3_court_name_number', 'label_override',
  'CourtListener cut the court number off the name ("... Criminal Court at Law No."); the same row''s own short_name carries it. The number is appended; the CourtListener name stays as the fact "Name as recorded by CourtListener".',
  jsonb_build_object('review_version','court-spine-names/2026-10-03.r3.1','short_name',x.short_name,'city_note','CourtListener prints "City" where the court is a Texas county court; not rewritten','approved_by','coordinator (round 3 item B: court accuracy, fix deterministic defects)'),
  jsonb_build_object('id',x.id,'title',x.old_title,'state',x.state,'item',x.old_item,'detail',x.old_detail,'text',x.old_text,'filters',x.filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.new_title,'state',x.state,'item',x.new_item,'detail',x.new_detail,'text',x.new_text,'filters',x.filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from fx) fixable, (select count(*) from ins) audit_rows_written,
       (select string_agg(id || ': ' || old_title || ' -> ' || new_title, ' | ' order by id) from fx) renamed;

-- ===== statement 4: apply (B) =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_name_number' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'court_spine' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
