-- mdls-judge-native-links/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; round 3 item B "judge accuracy: link ambiguity and native-id coverage")
-- Scope: public.corpus_records dataset='mdls' (179 rows) and dataset='judges' (145 profiles); public.corpus_datasets mdls metadata copies.
-- Problem (measured before this change, all numbers from the live tables):
--   * MDL -> judge by printed name: the app links a printed judge name only when exactly one judges profile has that exact normalized name. For the 176 MDLs that print a judge:
--     80 link (unique exact name), 9 do not because two judge profiles share the name (an FJC-backed entity and a name-only Trellis-directory stub of the same judge), 87 have no exact-name profile
--     (printed "Michael A. Shipp" vs profile "Michael Andre Shipp": the registry joined them as middle_initial 76 / first_initial 7 / middle_omitted 8 / native bridge 8 / ...).
--     The registry key judge_entity_id is exact: all 172 MDLs that carry one match exactly one judges profile (judges.item.entity_id), 0 ambiguous, 0 missing.
--   * MDL -> CourtListener person id: item.cl_assigned_to_id (the docket's assigned_to id seen in a CourtListener search) exists for 17 of 176 MDLs. The judge profile of the linked entity
--     already carries the CourtListener person id obtained by native ids only (FJC nid -> FJC jid == CourtListener people.fjc_id -> person id; bridge_status linked_native_id): 140 of the 172 linked
--     entities. All 3,701 profile CourtListener ids exist in cl_people with the same FJC jid, none is an alias, none repeats across profiles. For the 15 MDLs that have both ids they agree 15 of 15
--     (0 conflicts); 2 MDLs (3060, 3094) have a docket id and a profile without one; 1 more MDL (3163) shares its judge entity with MDL 3094.
--   * Judge -> MDL: every judges profile carries detail.mdls = {total: 0, results: []} (10,698 of 10,698), although 145 judge entities preside over 172 MDLs. The app renders this block as
--     "MDL appearances" (a collection of results with title, status and link) and treats total 0 as empty.
-- Change (additive, no value removed):
--   mdls item (and detail.summary, which is an exact copy of item): judge_profile_id (the exact judges profile record id, for #judge/<id> links, null where unresolved),
--     judge_cl_person_id (CourtListener person id; null where none is established) and judge_cl_person_basis (judge_profile_native_bridge | cl_docket_assigned_to |
--     judge_profile_native_bridge+cl_docket_assigned_to | same_judge_entity_cl_docket_assigned_to; hidden from the page as a "basis" field). Existing cl_assigned_to_id stays as observed.
--   mdls filters.cl_person_id: set to judge_cl_person_id where it was empty (the existing filter key).
--   mdls detail.judge_links[]: each linked judge gets links = [{url: "#judge/<profile id>", label: "Judge profile"}] (the page's table makes the row clickable; no new visible column).
--   judges detail.mdls (145 profiles): the empty block is replaced by as_of 2026-10-01, total, pending_total, results (one entry per MDL: id, title, status, subtitle, mdl_number, court_name,
--     actions_pending, total_actions, links [#mdl/<number>]) from the mdls directory by judge_entity_id; profiles without an MDL keep their block.
--   metadata of the mdls dataset: listing.results and filter_index (exact copies of the live item/filters) are regenerated; refresh_2026_10_01.judge_native_ids records the run.
-- Not done (reported instead): no CourtListener person id is invented for the 32 linked entities whose FJC jid has no CourtListener person (31 recent appointees, 1 withheld_for_review);
--   the 4 MDLs with a printed judge but no entity (judge sitting by designation or no FJC name match: 2358 Wolson, 2695 Shelby, 2879 Bailey, 3015 Singhal) stay unresolved; the 76 shared-name
--   groups made of an FJC-backed profile plus a stub are reported, not merged.
-- Before-image: whole item / detail / filters + row md5 (issue dq20261003r3_mdls_judge_native_links); judges whole detail + row md5 (issue dq20261003r3_judges_mdl_block);
--   mdls dataset metadata keys (issue dq20261003r3_mdls_judge_metadata). Execute statements 1..5 in order (3 after 2; 4 and 5 are independent of 1..3).
--
-- ROLLBACK (exact). ORDER: this contract restores the state AFTER the October 1 refresh, so roll it back BEFORE mdls-jpml-2026-10-01-refresh-r3-20261003-v1.sql (whose rows it touched).
--   update public.corpus_records r set item = c.original_record->'item', detail = c.original_record->'detail', filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'mdls' and c.issue = 'dq20261003r3_mdls_judge_native_links' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and r.dataset = 'mdls' and r.id = c.record_id;
--   update public.corpus_records r set detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'judges' and c.issue = 'dq20261003r3_judges_mdl_block' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and r.dataset = 'judges' and r.id = c.record_id;
--   update public.corpus_datasets d
--      set metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{listing,results}', c.original_record->'listing_results'), '{filter_index}', c.original_record->'filter_index'),
--                       '{refresh_2026_10_01}', c.original_record->'refresh_2026_10_01'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r3_mdls_judge_metadata' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33' and d.id = c.record_id;
--
-- ===== statement 1: audit (mdls) =====
with flag as (select true as apply),
pr as materialized (
 select j.item->>'entity_id' as eid, j.id as pid, j.detail->'structured'->'ids' as ids
 from public.corpus_records j where j.dataset = 'judges' and j.item->>'entity_id' is not null),
ent as materialized (
 select r.item->>'judge_entity_id' as eid, min(r.item->>'cl_assigned_to_id') as cl_docket, count(distinct r.item->>'cl_assigned_to_id') as n_cl
 from public.corpus_records r where r.dataset = 'mdls' and r.item->>'judge_entity_id' is not null and r.item->>'cl_assigned_to_id' is not null group by 1),
tgt as materialized (
 select r.id, r.title, r.state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5,
        r.item->>'judge_entity_id' as eid, r.item->>'cl_assigned_to_id' as own_cl, p.pid,
        case when p.ids->>'bridge_status' = 'linked_native_id' then p.ids->>'cl_person_id' end as prof_cl,
        e.cl_docket as ent_cl, e.n_cl
 from public.corpus_records r
 left join pr p on p.eid = r.item->>'judge_entity_id'
 left join ent e on e.eid = r.item->>'judge_entity_id'
 where r.dataset = 'mdls'),
res as (
 select t.*,
   case when t.prof_cl is not null and t.own_cl is not null and t.prof_cl <> t.own_cl then null
        when t.prof_cl is not null then t.prof_cl
        when t.own_cl is not null then t.own_cl
        when t.ent_cl is not null and t.n_cl = 1 then t.ent_cl end as cl_id,
   case when t.prof_cl is not null and t.own_cl is not null and t.prof_cl = t.own_cl then 'judge_profile_native_bridge+cl_docket_assigned_to'
        when t.prof_cl is not null and t.own_cl is not null then 'conflict'
        when t.prof_cl is not null then 'judge_profile_native_bridge'
        when t.own_cl is not null then 'cl_docket_assigned_to'
        when t.ent_cl is not null and t.n_cl = 1 then 'same_judge_entity_cl_docket_assigned_to' end as cl_basis
 from tgt t),
fx as (
 select s.id, s.title, s.state, s.item as old_item, s.detail as old_detail, s.filters as old_filters, s.row_md5, s.pid, s.cl_id, s.cl_basis,
        s.item || jsonb_build_object('judge_profile_id', s.pid, 'judge_cl_person_id', s.cl_id, 'judge_cl_person_basis', case when s.cl_basis = 'conflict' then null else s.cl_basis end) as new_item,
        case when s.cl_id is not null then jsonb_set(s.filters, '{cl_person_id}', to_jsonb(s.cl_id)) else s.filters end as new_filters
 from res s),
fx2 as (
 select x.*,
        jsonb_set(jsonb_set(x.old_detail, '{summary}', x.new_item), '{judge_links}',
          case when x.pid is null then x.old_detail->'judge_links'
               else (select coalesce(jsonb_agg(l || jsonb_build_object('links', jsonb_build_array(jsonb_build_object('url', '#judge/' || x.pid, 'label', 'Judge profile')))), '[]'::jsonb)
                       from jsonb_array_elements(x.old_detail->'judge_links') l) end) as new_detail
 from fx x),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'mdls', x.id, 'dq20261003r3_mdls_judge_native_links', 'label_override',
  'Additive native links for the transferee judge: exact judges profile id (via judge_entity_id = judges.item.entity_id) and the CourtListener person id obtained by native ids (profile bridge FJC nid -> jid == CourtListener people.fjc_id, or the docket assigned_to id). No value removed.',
  jsonb_build_object('review_version','mdls-judge-native-links/2026-10-03.r3.1','cl_basis',x.cl_basis,'profile_found',x.pid is not null,'approved_by','coordinator (round 3 item B: judge accuracy, fix deterministic defects)'),
  jsonb_build_object('id',x.id,'item',x.old_item,'detail',x.old_detail,'filters',x.old_filters,'row_md5',x.row_md5),
  jsonb_build_object('item',x.new_item,'detail',x.new_detail,'filters',x.new_filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx2 x where (select apply from flag) and x.cl_basis is distinct from 'conflict'
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) mdl_rows, (select count(*) from fx2 where pid is not null) with_profile, (select count(*) from fx2 where cl_id is not null) with_cl_id,
       (select count(*) from fx2 where cl_basis = 'conflict') conflicts,
       (select string_agg(b || '=' || n, ', ' order by b) from (select coalesce(cl_basis, '(none)') b, count(*) n from fx2 group by 1) q) by_basis,
       (select count(*) from fx2 where (old_item->>'cl_assigned_to_id') is not null) had_cl_before,
       (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply (mdls) =====
with u as (
 update public.corpus_records r
    set item = c.replacement->'item', detail = c.replacement->'detail', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'mdls' and c.issue = 'dq20261003r3_mdls_judge_native_links' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'mdls' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: regenerate the mdls metadata copies of item / filters and record the run (audit + apply in one statement; one row) =====
with old as (select d.id, d.metadata from public.corpus_datasets d where d.id = 'mdls' and not (d.metadata->'refresh_2026_10_01' ? 'judge_native_ids')),
live as (select r.id, r.title, r.ordinal, r.item, r.filters from public.corpus_records r where r.dataset = 'mdls'),
oldfi as (select f.value->>'id' as id, f.value->>'search' as search from old, jsonb_array_elements(old.metadata->'filter_index') f),
newres as (select jsonb_agg(l.item order by l.ordinal) as o from live l),
newfi as (
 select jsonb_agg(jsonb_build_object('id', l.id, 'item', l.item, 'filters', l.filters,
          'search', coalesce(o.search, lower(l.title) || ' ' || l.id || ' mdl-' || l.id || ' mdl ' || l.id)) order by l.ordinal) as o
 from live l left join oldfi o on o.id = l.id),
sums as (
 select count(*) filter (where item->>'judge_profile_id' is not null) as with_profile, count(*) filter (where item->>'judge_cl_person_id' is not null) as with_cl_person,
        count(*) filter (where item->>'cl_assigned_to_id' is not null) as with_docket_cl, count(*) as records from live),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', 'mdls', 'dq20261003r3_mdls_judge_metadata', 'label_override',
  'listing.results and filter_index are exact copies of the live item/filters; regenerated after the additive judge link fields.',
  jsonb_build_object('review_version','mdls-judge-native-links/2026-10-03.r3.1','approved_by','coordinator (round 3 item B)'),
  jsonb_build_object('id','mdls','listing_results',o.metadata->'listing'->'results','filter_index',o.metadata->'filter_index','refresh_2026_10_01',o.metadata->'refresh_2026_10_01'),
  jsonb_build_object('records', s.records, 'with_profile', s.with_profile, 'with_cl_person', s.with_cl_person),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from old o cross join sums s on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(jsonb_set(jsonb_set(o.metadata, '{listing,results}', nr.o), '{filter_index}', nf.o),
          '{refresh_2026_10_01,judge_native_ids}', jsonb_build_object('run_id', 'c490cdf1-b32e-46ae-95c5-788cdeba3f33', 'as_of', '2026-10-03',
             'added_item_fields', jsonb_build_array('judge_profile_id', 'judge_cl_person_id', 'judge_cl_person_basis'),
             'mdls_with_judge_profile_id', s.with_profile, 'mdls_with_judge_cl_person_id', s.with_cl_person, 'mdls_with_docket_assigned_to_id', s.with_docket_cl,
             'note', 'cl_assigned_to_id keeps its meaning (the docket assigned_to id seen in a CourtListener search); judge_cl_person_id also carries the id from the linked judge profile native bridge')),
        updated_at = now()
   from old o, newres nr, newfi nf, sums s, aud a
  where d.id = 'mdls'
 returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;

-- ===== statement 4: audit (judges profile MDL block) =====
with flag as (select true as apply),
mm as materialized (
 select r.item->>'judge_entity_id' as eid, r.id as mdl_id, r.title, r.item->>'status' as status, (r.item->>'mdl_number')::int as mdl_no, r.item->>'court_name' as court_name,
        (r.item->>'actions_pending')::bigint as actions_pending, (r.item->>'total_actions')::bigint as total_actions
 from public.corpus_records r where r.dataset = 'mdls' and r.item->>'judge_entity_id' is not null),
agg as (
 select eid, count(*)::int as total, (count(*) filter (where status = 'pending'))::int as pending_total,
        jsonb_agg(jsonb_build_object('id', 'mdl:' || mdl_id, 'title', title, 'status', status, 'subtitle', 'MDL ' || mdl_no || ' · ' || status || coalesce(' · ' || court_name, ''),
                  'mdl_number', mdl_no, 'court_name', court_name, 'actions_pending', actions_pending, 'total_actions', total_actions,
                  'links', jsonb_build_array(jsonb_build_object('url', '#mdl/' || mdl_id, 'label', 'MDL ' || mdl_no)))
                  order by (status <> 'pending'), actions_pending desc nulls last, mdl_no) as results
 from mm group by eid),
tgt as materialized (
 select j.id, j.detail, md5(to_jsonb(j)::text) as row_md5, a.total, a.pending_total, a.results
 from public.corpus_records j join agg a on a.eid = j.item->>'entity_id'
 where j.dataset = 'judges' and coalesce((j.detail->'mdls'->>'total')::int, 0) = 0),
fx as (
 select t.id, t.detail as old_detail, t.row_md5,
        jsonb_set(t.detail, '{mdls}', jsonb_build_object(
          'as_of', '2026-10-01',
          'basis', 'mdls directory: the MDL''s judge_entity_id equals this profile''s entity_id (transferee judge printed in the JPML report, joined to FJC appointments by name and court or by CourtListener person id; see judge_link_basis on each MDL)',
          'total', t.total, 'pending_total', t.pending_total, 'results', t.results, 'available', true,
          'entity_id', t.id, 'counts_label', 'as listed in the JPML report dated 2026-10-01')) as new_detail
 from tgt t),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'judges', x.id, 'dq20261003r3_judges_mdl_block', 'label_override',
  'The profile-side "MDL appearances" block was empty (total 0, no results) for every judge profile although the profile presides over MDLs in the mdls directory (join: mdls.judge_entity_id = judges.item.entity_id). Filled from the mdls directory as of the JPML report dated 2026-10-01.',
  jsonb_build_object('review_version','mdls-judge-native-links/2026-10-03.r3.1','join','mdls.item.judge_entity_id = judges.item.entity_id','approved_by','coordinator (round 3 item B: judge accuracy, fix deterministic defects)'),
  jsonb_build_object('id',x.id,'detail',x.old_detail,'row_md5',x.row_md5),
  jsonb_build_object('detail',x.new_detail),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) profiles, (select coalesce(sum(total), 0) from tgt) mdl_links, (select count(*) from ins) audit_rows_written;

-- ===== statement 5: apply (judges profile MDL block) =====
with u as (
 update public.corpus_records r
    set detail = c.replacement->'detail'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'judges' and c.issue = 'dq20261003r3_judges_mdl_block' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'judges' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;
