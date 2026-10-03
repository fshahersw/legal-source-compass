-- court-spine-in-use-and-parent/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; round 3 item B "court accuracy: in_use / parent ids")
-- Scope: public.corpus_records dataset='court_spine'; the corpus_workspace_court_map projection is re-synced by court-map-sync-r3-20261003-v1.sql.
-- Evidence:
--  (I) superctguam (Superior Court of Guam). The court directory was built from the CourtListener bulk courts snapshot of 2026-06-30 and says "In use: no".
--      The CourtListener snapshot we hold as dataset cl_courts (source_as_of 2026-09-30) says in_use = t (has_opinion_scraper = t). It is the only one of the 3,359
--      CourtListener courts whose in-use flag differs between the two snapshots (end_date, parent, names, dates, codes: 0 differences apart from trimmed whitespace).
--      The flag is changed to yes and the fact "In-use flag source" records the later snapshot and the earlier value.
--  (O) ohctapp1 (Court of Appeals of Ohio, First District). CourtListener recorded no court type (jurisdiction ''), no parent court, and the directory therefore shows
--      system 'Unknown', no state and court_type the literal string '[]'. Evidence for completing it, all independent of a name match:
--        - the 11 sibling districts ohctapp2..ohctapp12 all have parent ohioctapp, state OH, system state (checked in the statement below);
--        - its own child ohctapp1hamilto ("... First District, Hamilton County") already has parent ohctapp1, state OH, system state, so ohctapp1 was an orphan in the hierarchy;
--        - courts-db 0.10.27 lists ohctapp1 with parent ohioctapp, system state, location Ohio;
--        - the court name prints "Ohio" (the directory's own rule for the State column: "state name printed in the CourtListener court name").
--      Completed: state OH, system State, parent ohioctapp (fact "Parent court (courts-db; not recorded by CourtListener)"), and a "Classification note" fact.
--      The CourtListener court type stays "Not recorded"; the map column court_type '[]' becomes NULL (map sync file).
-- Before-image: whole title / state / item / detail / text / filters + whole-row md5 (issues dq20261003r3_court_in_use, dq20261003r3_court_ohctapp1_link).
-- Execute statements 1..4 in order (each guarded by the row md5). The two apply statements (2 and 4) were run as one UPDATE over both issues; the effect is identical.
--
-- ROLLBACK (exact; run per issue):
--   update public.corpus_records r
--      set title = c.original_record->>'title', state = c.original_record->>'state', item = c.original_record->'item', detail = c.original_record->'detail',
--          text = c.original_record->>'text', filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'court_spine' and c.issue in ('dq20261003r3_court_in_use', 'dq20261003r3_court_ohctapp1_link')
--      and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and r.dataset = 'court_spine' and r.id = c.record_id;
--   (the court_spine facet counts are restored by the rollback in court-map-sync-r3-20261003-v1.sql)
--
-- ===== statement 1: audit (I) =====
with flag as (select true as apply),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r
 where r.dataset = 'court_spine' and r.id = 'superctguam'
   and r.detail->'facts' @> '[["In use (CourtListener flag)","no"]]'::jsonb
   and exists (select 1 from public.corpus_records c where c.dataset = 'cl_courts' and c.id = 'cl:courts:superctguam' and c.item->'cells'->>'in_use' = 't'
                  and c.item->'cells'->>'source_as_of' = '2026-09-30')),
fx as (
 select g.id, g.title, g.state, g.item, g.filters, g.text as old_text, g.detail as old_detail, g.row_md5,
        jsonb_set(g.detail, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
            select case when e.v->>0 = 'In use (CourtListener flag)' then jsonb_build_array('In use (CourtListener flag)', 'yes') else e.v end as x, e.o * 2 as ord
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o)
            union all
            select jsonb_build_array('In-use flag source', 'CourtListener courts snapshot 2026-09-30 (the 2026-06-30 snapshot recorded no)'), e.o * 2 + 1
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o) where e.v->>0 = 'In use (CourtListener flag)') q)) as new_detail,
        replace(g.text, 'In use (CourtListener flag) no ', 'In use (CourtListener flag) yes In-use flag source CourtListener courts snapshot 2026-09-30 (the 2026-06-30 snapshot recorded no) ') as new_text
 from tgt g),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.id, 'dq20261003r3_court_in_use', 'label_override',
  'The directory (CourtListener snapshot 2026-06-30) says the court is not in use; the later CourtListener snapshot we hold (cl_courts, 2026-09-30) says in_use = t. It is the only in-use flag that differs between the two snapshots. Updated to the later snapshot with an explicit source fact.',
  jsonb_build_object('review_version','court-spine-in-use-and-parent/2026-10-03.r3.1','cl_courts_id','cl:courts:superctguam','cl_courts_in_use','t','cl_courts_source_as_of','2026-09-30','approved_by','coordinator (round 3 item B: court accuracy, in_use vs CourtListener snapshot)'),
  jsonb_build_object('id',x.id,'title',x.title,'state',x.state,'item',x.item,'detail',x.old_detail,'text',x.old_text,'filters',x.filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.title,'state',x.state,'item',x.item,'detail',x.new_detail,'text',x.new_text,'filters',x.filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from ins) audit_rows_written, (select new_text from fx) new_text;

-- ===== statement 2: apply (I) =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_in_use' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'court_spine' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: audit (O) =====
with flag as (select true as apply),
note(txt) as (values ('System, state and parent court completed from courts-db 0.10.27 (system state, location Ohio, parent ohioctapp) and from the 11 sibling districts ohctapp2-ohctapp12 (all parent ohioctapp, state OH, system state); CourtListener recorded no court type or parent for this row.')),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r
 where r.dataset = 'court_spine' and r.id = 'ohctapp1' and r.state = '' and r.item->'cells'->>'system' = 'Unknown'
   and (select count(*) from public.corpus_workspace_court_map m
         where m.court_id ~ '^ohctapp([2-9]|1[0-2])$' and m.parent_id = 'ohioctapp' and m.state = 'OH' and m.system = 'state') = 11
   and exists (select 1 from public.corpus_workspace_court_map m where m.court_id = 'ohctapp1hamilto' and m.parent_id = 'ohctapp1' and m.state = 'OH' and m.system = 'state')),
fx as (
 select g.id, g.title, g.item as old_item, g.detail as old_detail, g.text as old_text, g.filters as old_filters, g.row_md5,
        jsonb_set(jsonb_set(g.item, '{cells,state}', '"OH"'), '{cells,system}', '"State"') as new_item,
        jsonb_set(g.detail, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
            select case when e.v->>0 = 'System' then jsonb_build_array('System', 'State') else e.v end as x, e.o * 10 as ord
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o)
            union all
            select jsonb_build_array('State', 'OH — state name printed in the CourtListener court name'), e.o * 10 + 1
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o) where e.v->>0 = 'System'
            union all
            select jsonb_build_array('Parent court (courts-db; not recorded by CourtListener)', 'Ohio Court of Appeals (ohioctapp)'), e.o * 10 + 1
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o) where e.v->>0 = 'In use (CourtListener flag)'
            union all
            select jsonb_build_array('Classification note', n.txt), e.o * 10 + 2
              from jsonb_array_elements(g.detail->'facts') with ordinality e(v, o), note n where e.v->>0 = 'In use (CourtListener flag)') q)) as new_detail,
        jsonb_set(jsonb_set(g.filters, '{state}', '["OH"]'), '{system}', '["state"]') as new_filters,
        replace(g.text, 'System Unknown In use (CourtListener flag) no Saved raster identity marks',
          'System State State OH — state name printed in the CourtListener court name In use (CourtListener flag) no Parent court (courts-db; not recorded by CourtListener) Ohio Court of Appeals (ohioctapp) Classification note ' || (select txt from note) || ' Saved raster identity marks') as new_text
 from tgt g),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.id, 'dq20261003r3_court_ohctapp1_link', 'label_override',
  'ohctapp1 lacked court type, parent, state and system in the CourtListener snapshot and was an orphan in the Ohio Court of Appeals hierarchy although its child ohctapp1hamilto points to it. Completed from the 11 sibling districts and courts-db; the court type stays "Not recorded".',
  jsonb_build_object('review_version','court-spine-in-use-and-parent/2026-10-03.r3.1','siblings','ohctapp2..ohctapp12: parent ohioctapp, state OH, system state (11 of 11)','child','ohctapp1hamilto: parent ohctapp1, state OH','courts_db','0.10.27: parent ohioctapp, system state, location Ohio','approved_by','coordinator (round 3 item B: court accuracy, parent ids)'),
  jsonb_build_object('id',x.id,'title',x.title,'state','','item',x.old_item,'detail',x.old_detail,'text',x.old_text,'filters',x.old_filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.title,'state','OH','item',x.new_item,'detail',x.new_detail,'text',x.new_text,'filters',x.new_filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from ins) audit_rows_written, (select new_text from fx) new_text;

-- ===== statement 4: apply (O) =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r3_court_ohctapp1_link' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'court_spine' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
