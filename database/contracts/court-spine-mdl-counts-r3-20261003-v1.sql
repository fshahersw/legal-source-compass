-- court-spine-mdl-counts/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; follow-through of round 3 item A, the mdls refresh to the JPML 2026-10-01 report)
-- Scope: public.corpus_records dataset='court_spine'; the corpus_workspace_court_map projection is re-synced by court-map-sync-r3-20261003-v1.sql.
-- Why: the court directory prints, per court, how many MDLs are pending in that court ("13 pending", fact "Pending MDLs (JPML report dated 2026-09-01)", link label
--      "MDLs in this court (13 pending, JPML report dated 2026-09-01)", badge "13 pending MDLs") and, where terminated MDLs exist, "MDLs listed, pending and terminated".
--      After the mdls directory was refreshed to the 2026-10-01 report these numbers were stale for 4 courts, and every one of the 51 rows still cites the 2026-09-01 report.
-- Rule (deterministic): pending = count of mdls rows with item.status = 'pending' and item.cl_court_id = the court id; listed = count of mdls rows with that cl_court_id
--      (pending + terminated). The "MDLs listed" fact is present exactly when listed <> pending (existing rows that have it keep the same value).
-- Result: njd 13 -> 12 pending (listed 13), mad 6 -> 5 (listed 6), mdd 2 -> 1 (listed 2), ded 2 -> 1 (listed 4, unchanged); the "MDLs listed" fact is added to njd, mad, mdd.
--      The other 47 rows keep their numbers and only change the report date to 2026-10-01 in item / detail / text (the phrase "JPML report dated 2026-09-01" -> "2026-10-01").
--      Rows with no MDL keep their undated "JPML report" wording. The has_mdls filter is unchanged for every row (all four courts still have >= 1 pending MDL).
-- Dated statements elsewhere that quote the 2026-09-01 report on purpose (mdl_case_inventory: "Against the JPML report dated 2026-09-01 the sample is small ...") are not touched:
--      they describe that report and remain true as dated.
-- Before-image: whole title / state / item / detail / text / filters + whole-row md5 (issue dq20261003r3_court_mdl_counts).
-- Execute statements 1 and 2 in order (statement 2 is guarded by the row md5 recorded by statement 1).
--
-- ROLLBACK (exact):
--   update public.corpus_records r
--      set title = c.original_record->>'title', state = c.original_record->>'state', item = c.original_record->'item', detail = c.original_record->'detail',
--          text = c.original_record->>'text', filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_mdl_counts' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset = 'court_spine' and r.id = c.record_id;
--
-- ===== statement 1: audit =====
with flag as (select true as apply),
mc as (
 select r.item->>'cl_court_id' as cid, count(*) filter (where r.item->>'status' = 'pending')::int as pend, count(*)::int as listed
 from public.corpus_records r where r.dataset = 'mdls' and r.item->>'cl_court_id' is not null group by 1),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5,
        coalesce((regexp_match(r.item->'cells'->>'mdls', '^([0-9]+)'))[1]::int, 0) as old_pend,
        coalesce(m.pend, 0) as new_pend, coalesce(m.listed, 0) as new_listed
 from public.corpus_records r left join mc m on m.cid = r.id
 where r.dataset = 'court_spine' and position('JPML report dated 2026-09-01' in r.text) > 0),
st1 as (
 select g.*,
  case when g.old_pend = g.new_pend then replace(g.item::text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01')
       else replace(replace(replace(replace(g.item::text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01'),
              '(' || g.old_pend || ' pending, JPML', '(' || g.new_pend || ' pending, JPML'),
              '"' || g.old_pend || ' pending"', '"' || g.new_pend || ' pending"'),
              '"' || g.old_pend || ' pending MDLs"', '"' || g.new_pend || ' pending MDLs"') end::jsonb as new_item,
  case when g.old_pend = g.new_pend then replace(g.detail::text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01')
       else replace(replace(g.detail::text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01'),
              '(' || g.old_pend || ' pending, JPML', '(' || g.new_pend || ' pending, JPML') end::jsonb as d1,
  case when g.old_pend = g.new_pend then replace(g.text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01')
       else replace(replace(replace(g.text, 'JPML report dated 2026-09-01', 'JPML report dated 2026-10-01'),
              '(' || g.old_pend || ' pending, JPML', '(' || g.new_pend || ' pending, JPML'),
              'Pending MDLs (JPML report dated 2026-10-01) ' || g.old_pend || ' ', 'Pending MDLs (JPML report dated 2026-10-01) ' || g.new_pend || ' ') end as t1
 from tgt g),
fx as (
 select s.id, s.title, s.state, s.filters, s.row_md5, s.item as old_item, s.detail as old_detail, s.text as old_text, s.old_pend, s.new_pend, s.new_listed, s.new_item,
        jsonb_set(s.d1, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
            select case when e.v->>0 like 'Pending MDLs (JPML report dated %' then jsonb_build_array(e.v->>0, s.new_pend::text) else e.v end as x, e.o * 2 as ord
              from jsonb_array_elements(s.d1->'facts') with ordinality e(v, o)
              where e.v->>0 not like 'MDLs listed, pending and terminated (JPML report dated %'
            union all
            select jsonb_build_array('MDLs listed, pending and terminated (JPML report dated 2026-10-01)', s.new_listed::text), e.o * 2 + 1
              from jsonb_array_elements(s.d1->'facts') with ordinality e(v, o)
              where e.v->>0 like 'Pending MDLs (JPML report dated %' and s.new_listed <> s.new_pend) q)) as new_detail,
        case when s.new_listed <> s.new_pend and position('MDLs listed, pending and terminated' in s.t1) = 0
             then replace(s.t1, 'Pending MDLs (JPML report dated 2026-10-01) ' || s.new_pend || ' ',
                  'Pending MDLs (JPML report dated 2026-10-01) ' || s.new_pend || ' MDLs listed, pending and terminated (JPML report dated 2026-10-01) ' || s.new_listed || ' ')
             else s.t1 end as new_text
 from st1 s),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.id, 'dq20261003r3_court_mdl_counts', 'label_override',
  'Per-court MDL counts are derived from the mdls directory, which was refreshed to the JPML report dated 2026-10-01 in round 3 item A; four courts changed their pending count and every row still cited the 2026-09-01 report.',
  jsonb_build_object('review_version','court-spine-mdl-counts/2026-10-03.r3.1','pending_rule','mdls.item.status = pending and mdls.item.cl_court_id = court id','listed_rule','all mdls rows with that cl_court_id','old_pending',x.old_pend,'new_pending',x.new_pend,'new_listed',x.new_listed,'approved_by','coordinator (round 3 item A follow-through)'),
  jsonb_build_object('id',x.id,'title',x.title,'state',x.state,'item',x.old_item,'detail',x.old_detail,'text',x.old_text,'filters',x.filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.title,'state',x.state,'item',x.new_item,'detail',x.new_detail,'text',x.new_text,'filters',x.filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from fx where old_pend <> new_pend) count_changed,
       (select string_agg(id || ' ' || old_pend || '->' || new_pend || ' (listed ' || new_listed || ')', ', ' order by id) from fx where old_pend <> new_pend) changes,
       (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_mdl_counts' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'court_spine' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
