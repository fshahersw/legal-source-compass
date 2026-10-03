-- counsel-seeger-weiss/2026-10-03.r4.1  (run c41d48ea-d3fb-4362-bda3-a959b127a4cb; coordinator round 4 item A: counsel/firm accuracy for Seeger Weiss)
-- Scope: exact Seeger Weiss firm-name variants only (Seeger Weiss LLP, SEEGER WEISS LLP, Seeger Weiss Llp, Seeger Weiss, LLP, Seeger Weiss LLP (Newark), Seeger Weiss, Seeger Weiss LLC).
--   Datasets: counsel_directory (126 attorney records + 1 firm record + 1 Philadelphia liaison record), mdl_appearances (478 rows), mdl_counsel (6 rows), corpus_research_names (derived).
-- Defects fixed (deterministic, evidence below), all additive or label-only, nothing deleted, no flag changed:
--   1. ROLE LABELS. The source build printed CourtListener role codes with a shifted dictionary: code 4 as "terminated", code 6 as "inactive", code 8 as "unknown". CourtListener's own enumeration
--      (cl/people_db/models.py Role: 1 attorney to be noticed, 2 lead attorney, 3 attorney in sealed group, 4 PRO HAC VICE, 5 self-terminated, 6 TERMINATED, 7 suspended, 8 INACTIVE, 9 disbarred, 10 unknown)
--      and the live CourtListener data agree with each other and not with the build: in 103 of 103 role-6 attachments of a CourtListener parties result the termination date is set, in 134 of 134 role-4
--      attachments it is not; the saved numeric strings "4" and "6" are normalised correctly by the same build (Pro hac vice, Terminated); a join of 834 attorneys between the saved CourtListener party
--      attachments and counsel_directory shows the one-to-one shift (codes {1,4} <-> [attorney_to_be_noticed, terminated] 51x, {6} <-> [inactive] 18x, {4,6} <-> [inactive, terminated] 4x, ...).
--      Seeger Weiss records carry the raw value "terminated" (= code 4 = Pro hac vice): 12 counsel_directory attorney records and 19 mdl_appearances rows. They are relabelled Pro hac vice (raw value kept,
--      a "Role label correction" fact explains it). The same shift affects the rest of the datasets (214 more counsel_directory attorney records "terminated", 261 "inactive", 5 "unknown"; 1 mdl_appearances "unknown");
--      those are NOT changed here (scope = Seeger Weiss) and are proposed in the round-4 report.
--   2. DOCKET ATTRIBUTION FLAGS (no value changed). CourtListener attorney 979464 (Christopher A. Seeger, Seeger Weiss, LLP) is attached to docket 4264193 (3:10-cv-20375, ilsd), not to docket 4264289 (3:12-cv-20047, ilsd)
--      where counsel_directory (cl:979464) and the two defendant-side appearances of mdl_appearances place it; attorney 651829 is attached to docket 4518139 (2:16-cv-05143, njd), not to 4580886 (cl:651829).
--      Cause (inferred from the live CourtListener parties data): the source build read each party's attorney list without the attachment's docket_id, and parties are shared between dockets. 55 Seeger Weiss CourtListener
--      attorney ids were checked against CourtListener: 53 match their saved docket, 2 do not. A visible "Docket attribution check" fact is added to those records (and to the AWS attorney record of the defendant-side rows).
--   3. FIRM RECORD. Roles roll-up (cells.roles, filters.role, fact Roles seen, text) follows the corrected attorney records; the section headings "Attorneys (100, ...)" and "Dockets (40 saved)" count the listed rows,
--      not the firm totals (126 attorneys, 77 dockets); they now read "100 shown of 126" and "40 shown of 77 saved". 11 other firm records have the same truncation (proposal).
--   4. FACET COUNTS of the Role filter (counsel_directory, mdl_appearances) are recomputed; corpus_research_names.summary (an exact copy of the source item) is synced for the Seeger firm row and for the 72
--      judges rows whose item changed with the directory-stub flags (judges-directory-stub-flags-r4).
-- Before-image: whole filters / detail / text (counsel_directory), whole item / filters / detail / text (mdl_appearances) + whole-row md5; dataset metadata filters; research-names rows.
-- Execute the statements in order (1..11).
--
-- ROLLBACK (exact; each restores the row from its before-image):
--   update public.corpus_records r set filters = c.original_record->'filters', detail = c.original_record->'detail', text = c.original_record->>'text'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'counsel_directory' and c.issue in ('dq20261003r4_seeger_role_labels_cd','dq20261003r4_seeger_firm_record','dq20261003r4_seeger_docket_flags') and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'counsel_directory' and r.id = c.record_id;
--   update public.corpus_records r set item = c.original_record->'item', filters = c.original_record->'filters', detail = c.original_record->'detail', text = c.original_record->>'text'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'mdl_appearances' and c.issue in ('dq20261003r4_seeger_role_labels_ma','dq20261003r4_seeger_docket_flags') and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'mdl_appearances' and r.id = c.record_id;
--   (the firm record also restores item: see statement 4 for the item key; run its own rollback line below)
--   update public.corpus_records r set item = c.original_record->'item'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'counsel_directory' and c.issue = 'dq20261003r4_seeger_firm_record' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'counsel_directory' and r.id = c.record_id;
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata, '{listing,filters}', c.original_record->'listing_filters') - 'accuracy_review_r4_roles', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_seeger_role_facets' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = d.id;
--   update public.corpus_research_names n set summary = c.original_record->'row'->'summary', refreshed_at = (c.original_record->'row'->>'refreshed_at')::timestamptz
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_research_names' and c.issue = 'dq20261003r4_research_names_summary_sync' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = n.kind || '|' || n.canonical_id;
--
-- ===== statement 1: audit (counsel_directory attorney records, role relabel) =====
with flag as (select true as apply),
n as (select 'The source build printed CourtListener role code 4 as terminated. Code 4 is Pro hac vice (CourtListener role enumeration: 1 attorney to be noticed, 2 lead attorney, 4 pro hac vice, 6 terminated, 8 inactive, 10 unknown), so the role is shown as Pro hac vice here. The raw value is kept. Corrected on 2026-10-03 for Seeger Weiss records only.'::text as note),
tgt as materialized (
 select r.id, r.filters, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r
 where r.dataset = 'counsel_directory' and r.filters @> '{"kind":["attorney"]}' and r.detail::text ~* 'seeger\s*,?\s*weiss'
   and exists (select 1 from jsonb_array_elements(r.detail->'sections') s, jsonb_array_elements(coalesce(s->'rows','[]'::jsonb)) x
               where s->>'heading' = 'Roles seen' and x->>0 = 'terminated')),
rw as (
 select t.id, x.ord, x.r->>0 as raw, x.r->>1 as old_norm, x.r->>2 as cnt,
        case when x.r->>0 = 'terminated' then 'Pro hac vice' else x.r->>1 end as new_norm
 from tgt t, jsonb_array_elements(t.detail->'sections') as s(sec), jsonb_array_elements(s.sec->'rows') with ordinality as x(r, ord)
 where s.sec->>'heading' = 'Roles seen'),
roles_new as (select id, jsonb_agg(v order by o) as arr from (select id, new_norm as v, min(ord) as o from rw group by id, new_norm) q group by id),
rows_new as (select id, jsonb_agg(jsonb_build_array(raw, new_norm, cnt) order by ord) as arr from rw group by id),
roles_old_mapped as (
 select t.id, jsonb_agg(case when q.e = 'Terminated' then 'Pro hac vice' else q.e end order by q.o) as arr
 from tgt t, jsonb_array_elements_text(t.filters->'role') with ordinality as q(e, o) group by t.id),
nterm as (select id, count(*) as k from rw where raw = 'terminated' group by id),
fx as (
 select t.id, t.row_md5, t.filters as old_filters, t.detail as old_detail, t.text as old_text,
        jsonb_set(t.filters, '{role}', rn.arr) as new_filters,
        jsonb_set(
          jsonb_set(t.detail, '{sections}',
            (select jsonb_agg(case when s.sec->>'heading' = 'Roles seen' then jsonb_set(s.sec, '{rows}', rwn.arr) else s.sec end order by s.ord)
               from jsonb_array_elements(t.detail->'sections') with ordinality as s(sec, ord))),
          '{facts}', (t.detail->'facts') || jsonb_build_array(jsonb_build_array('Role label correction', (select note from n)))) as new_detail,
        replace(replace(t.text, ' terminated Terminated ', ' terminated Pro hac vice '), ' Firm(s) as printed ',
                ' Role label correction ' || (select note from n) || ' Firm(s) as printed ') as new_text
 from tgt t
 join roles_new rn on rn.id = t.id join rows_new rwn on rwn.id = t.id join roles_old_mapped rom on rom.id = t.id join nterm nt on nt.id = t.id
 where rn.arr = rom.arr
   and not exists (select 1 from rw where rw.id = t.id and rw.raw <> 'terminated' and rw.old_norm = 'Terminated')
   and length(t.text) - length(replace(t.text, ' terminated Terminated ', '')) = nt.k * length(' terminated Terminated ')
   and length(t.text) - length(replace(t.text, ' Firm(s) as printed ', '')) = length(' Firm(s) as printed ')),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'counsel_directory', x.id, 'dq20261003r4_seeger_role_labels_cd', 'label_override',
  'Seeger Weiss attorney record: the source printed CourtListener role code 4 as terminated; code 4 is Pro hac vice. Role filter value, Roles seen table, and search text corrected; raw value kept; an explanatory fact added.',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','source','CourtListener cl/people_db/models.py Role enumeration; live CourtListener parties data','approved_by','coordinator (round 4 item A: fix deterministic label/role defects)'),
  jsonb_build_object('id',x.id,'filters',x.old_filters,'detail',x.old_detail,'text',x.old_text,'row_md5',x.row_md5),
  jsonb_build_object('filters',x.new_filters,'detail',x.new_detail,'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) candidate_records, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply (counsel_directory attorney role relabel) =====
with u as (
 update public.corpus_records r
    set filters = c.replacement->'filters', detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'counsel_directory' and c.issue = 'dq20261003r4_seeger_role_labels_cd' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'counsel_directory' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: audit (firm record: roles roll-up and truncated section headings) =====
with flag as (select true as apply),
f as materialized (
 select r.id, r.item, r.filters, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r where r.dataset = 'counsel_directory' and r.id = 'firm:3f24b0b7635a81a8'),
linked as materialized (
 select r.filters from public.corpus_records r
 where r.dataset = 'counsel_directory' and r.filters @> '{"kind":["attorney"]}' and r.detail::text like '%#counsel?id=firm:3f24b0b7635a81a8%'),
newroles as (select string_agg(e.role, ', ' order by e.role) as s from (select distinct q.e as role from linked l, jsonb_array_elements_text(l.filters->'role') as q(e)) e),
hd as (
 select f.id,
        (select s.sec->>'heading' from jsonb_array_elements(f.detail->'sections') as s(sec) where s.sec->>'heading' like 'Attorneys (%') as h_att,
        (select s.sec->>'heading' from jsonb_array_elements(f.detail->'sections') as s(sec) where s.sec->>'heading' like 'Dockets (%') as h_dk,
        (select jsonb_array_length(s.sec->'items') from jsonb_array_elements(f.detail->'sections') as s(sec) where s.sec->>'heading' like 'Attorneys (%') as n_att,
        (select jsonb_array_length(s.sec->'items') from jsonb_array_elements(f.detail->'sections') as s(sec) where s.sec->>'heading' like 'Dockets (%') as n_dk,
        (select (x->>1)::int from jsonb_array_elements(f.detail->'facts') x where x->>0 = 'Attorneys linked (native id or AWS release id)') as t_att,
        (select (x->>1)::int from jsonb_array_elements(f.detail->'facts') x where x->>0 = 'Saved dockets') as t_dk
 from f),
nh as (
 select hd.*,
        regexp_replace(hd.h_att, '^Attorneys \(' || hd.n_att || ',', 'Attorneys (' || hd.n_att || ' shown of ' || hd.t_att || ',') as nh_att,
        regexp_replace(hd.h_dk, '^Dockets \(' || hd.n_dk || ' saved\)', 'Dockets (' || hd.n_dk || ' shown of ' || hd.t_dk || ' saved)') as nh_dk
 from hd),
fx as (
 select f.id, f.row_md5, f.item as old_item, f.filters as old_filters, f.detail as old_detail, f.text as old_text,
        jsonb_set(f.item, '{cells,roles}', to_jsonb(r.s)) as new_item,
        jsonb_set(f.filters, '{role}', (select jsonb_agg(case when q.e = 'Terminated' then 'Pro hac vice' else q.e end order by q.o) from jsonb_array_elements_text(f.filters->'role') with ordinality as q(e, o))) as new_filters,
        jsonb_set(jsonb_set(f.detail, '{facts}',
            (select jsonb_agg(case when x.v->>0 = 'Roles seen' then jsonb_build_array('Roles seen', r.s) else x.v end order by x.o) from jsonb_array_elements(f.detail->'facts') with ordinality as x(v, o))),
          '{sections}',
            (select jsonb_agg(case when s.sec->>'heading' = nh.h_att then jsonb_set(s.sec, '{heading}', to_jsonb(nh.nh_att))
                                   when s.sec->>'heading' = nh.h_dk then jsonb_set(s.sec, '{heading}', to_jsonb(nh.nh_dk)) else s.sec end order by s.ord)
               from jsonb_array_elements(f.detail->'sections') with ordinality as s(sec, ord))) as new_detail,
        replace(replace(replace(f.text, f.item->'cells'->>'roles', r.s), nh.h_att, nh.nh_att), nh.h_dk, nh.nh_dk) as new_text
 from f cross join newroles r join nh on nh.id = f.id
 where f.item->'cells'->>'roles' = 'Attorney to be noticed, Lead attorney, Not stated, Terminated, Unknown'
   and r.s = 'Attorney to be noticed, Lead attorney, Not stated, Pro hac vice, Unknown'
   and nh.t_att > nh.n_att and nh.t_dk > nh.n_dk and nh.nh_att <> nh.h_att and nh.nh_dk <> nh.h_dk
   and length(f.text) - length(replace(f.text, f.item->'cells'->>'roles', '')) >= length(f.item->'cells'->>'roles')),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'counsel_directory', x.id, 'dq20261003r4_seeger_firm_record', 'label_override',
  'Seeger Weiss firm record: roles roll-up follows the corrected attorney records (Terminated -> Pro hac vice); the Attorneys and Dockets section headings now say how many rows are shown of the firm totals.',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','approved_by','coordinator (round 4 item A)'),
  jsonb_build_object('id',x.id,'item',x.old_item,'filters',x.old_filters,'detail',x.old_detail,'text',x.old_text,'row_md5',x.row_md5),
  jsonb_build_object('item',x.new_item,'filters',x.new_filters,'detail',x.new_detail,'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from f) firm_rows, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 4: apply (firm record) =====
with u as (
 update public.corpus_records r
    set item = c.replacement->'item', filters = c.replacement->'filters', detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'counsel_directory' and c.issue = 'dq20261003r4_seeger_firm_record' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'counsel_directory' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 5: audit (mdl_appearances rows, role relabel) =====
with flag as (select true as apply),
n as (select 'The source build printed CourtListener role code 4 as terminated. Code 4 is Pro hac vice (CourtListener role enumeration: 1 attorney to be noticed, 2 lead attorney, 4 pro hac vice, 6 terminated, 8 inactive, 10 unknown), so the role is shown as Pro hac vice here. The raw value is kept. Corrected on 2026-10-03 for Seeger Weiss records only.'::text as note),
tgt as materialized (
 select r.id, r.item, r.filters, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r
 where r.dataset = 'mdl_appearances' and r.item::text ~* 'seeger\s*,?\s*weiss'
   and exists (select 1 from jsonb_array_elements(r.detail->'facts') f where f->>0 = 'Role (raw)' and f->>1 = 'terminated')),
fx as (
 select t.id, t.row_md5, t.item as old_item, t.filters as old_filters, t.detail as old_detail, t.text as old_text,
        jsonb_set(jsonb_set(t.item, '{cells,role}', '"Pro hac vice"'), '{badges,0}', '"Pro hac vice"') as new_item,
        jsonb_set(t.filters, '{role}', '["Pro hac vice"]') as new_filters,
        jsonb_set(t.detail, '{facts}',
          (select jsonb_agg(case when f.v->>0 = 'Role (normalised)' then jsonb_build_array('Role (normalised)', 'Pro hac vice') else f.v end order by f.o) from jsonb_array_elements(t.detail->'facts') with ordinality as f(v, o))
          || jsonb_build_array(jsonb_build_array('Role label correction', (select note from n)))) as new_detail,
        regexp_replace(replace(t.text, ' Role (normalised) Terminated ', ' Role (normalised) Pro hac vice '), '(\s*)$', ' Role label correction ' || (select note from n) || '\1') as new_text
 from tgt t
 where t.item->'cells'->>'role' = 'Terminated' and t.item->'badges'->>0 = 'Terminated' and t.filters->'role' = '["Terminated"]'::jsonb
   and (select f->>1 from jsonb_array_elements(t.detail->'facts') f where f->>0 = 'Role (normalised)') = 'Terminated'
   and length(t.text) - length(replace(t.text, ' Role (normalised) Terminated ', '')) = length(' Role (normalised) Terminated ')),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'mdl_appearances', x.id, 'dq20261003r4_seeger_role_labels_ma', 'label_override',
  'Seeger Weiss appearance: the source printed CourtListener role code 4 as terminated; code 4 is Pro hac vice. Role cell, badge, filter, normalised-role fact and search text corrected; raw value kept; an explanatory fact added.',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','source','CourtListener cl/people_db/models.py Role enumeration; live CourtListener attorney 5420574/5638281/8251218/8251219 attachments (role 4) joined to the AWS matter rows','approved_by','coordinator (round 4 item A)'),
  jsonb_build_object('id',x.id,'item',x.old_item,'filters',x.old_filters,'detail',x.old_detail,'text',x.old_text,'row_md5',x.row_md5),
  jsonb_build_object('item',x.new_item,'filters',x.new_filters,'detail',x.new_detail,'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) candidate_rows, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 6: apply (mdl_appearances role relabel) =====
with u as (
 update public.corpus_records r
    set item = c.replacement->'item', filters = c.replacement->'filters', detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'mdl_appearances' and c.issue = 'dq20261003r4_seeger_role_labels_ma' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'mdl_appearances' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 7: audit (docket attribution flags; additive fact + text) =====
with flag as (select true as apply),
notes(dataset, id, note) as (values
 ('counsel_directory','cl:979464','CourtListener attorney record 979464 (Christopher A. Seeger, Seeger Weiss, LLP) lists this attorney on docket 4264193 (3:10-cv-20375, ilsd), under three parties, and not on docket 4264289 (3:12-cv-20047, ilsd) shown below, where the Seeger Weiss attorney of record is CourtListener attorney 1310563. The saved docket below was carried over from the source build and is probably mis-attributed. Checked against CourtListener on 2026-10-03; nothing else in this record was changed.'),
 ('counsel_directory','cl:651829','CourtListener attorney record 651829 (Christopher A. Seeger, Seeger Weiss, LLP) lists this attorney on docket 4518139 (2:16-cv-05143, njd) and not on docket 4580886 (2:17-cv-00194, njd) shown below. The saved docket below was carried over from the source build and is probably mis-attributed. Checked against CourtListener on 2026-10-03; nothing else in this record was changed.'),
 ('counsel_directory','aws:d33f5a87-d542-5224-90a0-744edbf2fd65','The two defendant-side appearances of this record are probably the two Seeger Weiss defendant-side appearances of the MDL counsel appearances dataset on docket 4264289 (3:12-cv-20047, ilsd). CourtListener lists a Seeger Weiss attorney on that docket only on the plaintiff side (attorney 1310563); the same person appears under attorney 979464 on docket 4264193 (3:10-cv-20375, ilsd), under defendant parties that both dockets share. The defendant side is therefore not confirmed for docket 4264289. Checked against CourtListener on 2026-10-03; nothing else in this record was changed.'),
 ('mdl_appearances','6a7c35aa-af02-57ac-86b9-676598fe9e1a','CourtListener lists a Seeger Weiss attorney on this docket (4264289, 3:12-cv-20047, ilsd) only on the plaintiff side (attorney 1310563). The same person appears under CourtListener attorney 979464 on docket 4264193 (3:10-cv-20375, ilsd), under defendant parties that both dockets share, so this defendant-side appearance is probably re-attributed from that docket and is not confirmed for this one. Checked against CourtListener on 2026-10-03; the side shown is as recorded by the source and was not changed.'),
 ('mdl_appearances','cd4d6d39-73b1-5b26-97b6-727ae69eb7d8','CourtListener lists a Seeger Weiss attorney on this docket (4264289, 3:12-cv-20047, ilsd) only on the plaintiff side (attorney 1310563). The same person appears under CourtListener attorney 979464 on docket 4264193 (3:10-cv-20375, ilsd), under defendant parties that both dockets share, so this defendant-side appearance is probably re-attributed from that docket and is not confirmed for this one. Checked against CourtListener on 2026-10-03; the side shown is as recorded by the source and was not changed.')),
tgt as materialized (
 select r.dataset, r.id, r.filters, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5, n.note
 from public.corpus_records r join notes n on n.dataset = r.dataset and n.id = r.id),
fx as (
 select t.*, (t.detail->'facts') || jsonb_build_array(jsonb_build_array('Docket attribution check', t.note)) as new_facts,
        case when t.dataset = 'counsel_directory' then replace(t.text, ' Firm(s) as printed ', ' Docket attribution check ' || t.note || ' Firm(s) as printed ')
             else regexp_replace(t.text, '(\s*)$', ' Docket attribution check ' || t.note || '\1') end as new_text
 from tgt t
 where not exists (select 1 from jsonb_array_elements(t.detail->'facts') f where f->>0 = 'Docket attribution check')
   and (t.dataset = 'mdl_appearances' or length(t.text) - length(replace(t.text, ' Firm(s) as printed ', '')) = length(' Firm(s) as printed '))),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select x.dataset, x.id, 'dq20261003r4_seeger_docket_flags', 'label_override',
  'Seeger Weiss record whose docket (or defendant side) is not supported by CourtListener: a visible "Docket attribution check" fact says so. No existing value changed.',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','source','CourtListener REST API (attorneys 979464, 1310563, 651829; parties for dockets 4264289, 4264193), 2026-10-03','approved_by','coordinator (round 4 item A)'),
  jsonb_build_object('id',x.id,'filters',x.filters,'detail',x.detail,'text',x.text,'row_md5',x.row_md5),
  jsonb_build_object('detail',jsonb_set(x.detail, '{facts}', x.new_facts),'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) candidate_rows, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 8: apply (docket attribution flags) =====
with u as (
 update public.corpus_records r
    set detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset in ('counsel_directory','mdl_appearances') and c.issue = 'dq20261003r4_seeger_docket_flags' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = c.dataset and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 9: facet counts of the Role filter (counsel_directory, mdl_appearances; audit + apply in one statement) =====
with ds as (select id, metadata from public.corpus_datasets where id in ('counsel_directory','mdl_appearances') and not (metadata ? 'accuracy_review_r4_roles')),
cnt as (
 select r.dataset, e.key as fname, x.val as oval, count(*) as n
 from public.corpus_records r join ds on ds.id = r.dataset
 cross join lateral jsonb_each(r.filters) e
 cross join lateral (
   select jsonb_array_elements_text(e.value) as val where jsonb_typeof(e.value) = 'array'
   union all
   select e.value #>> '{}' where jsonb_typeof(e.value) in ('string','number','boolean')) x
 where e.key not like '\_\_%' escape '\'
 group by 1, 2, 3),
nf as (
 select ds.id, jsonb_agg(
   case when f->>'type' = 'select' and jsonb_typeof(f->'options') = 'array' then
     jsonb_set(f, '{options}', coalesce((
        select jsonb_agg(jsonb_set(o, '{count}', to_jsonb(c.n)) order by ord)
        from jsonb_array_elements(f->'options') with ordinality as t(o, ord)
        join cnt c on c.dataset = ds.id and c.fname = f->>'name' and c.oval = o->>'value'), '[]'::jsonb))
   else f end order by fo) as new_filters
 from ds, jsonb_array_elements(ds.metadata->'listing'->'filters') with ordinality as ft(f, fo) group by ds.id),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r4_seeger_role_facets', 'label_override',
  'Role filter counts follow the Seeger Weiss role relabels; recomputed from live corpus_records.filters (same containment semantics as corpus_query_bounded).',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','semantics','filters @> {name:value} OR filters @> {name:[value]}'),
  jsonb_build_object('id', ds.id, 'listing_filters', ds.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', nf.new_filters),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from ds join nf on nf.id = ds.id where ds.metadata->'listing'->'filters' is distinct from nf.new_filters
 on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{listing,filters}', nf.new_filters)
                   || jsonb_build_object('accuracy_review_r4_roles', jsonb_build_object('version','counsel-seeger-weiss/2026-10-03.r4.1','run_id','c41d48ea-d3fb-4362-bda3-a959b127a4cb','applied_at',now())),
        updated_at = now()
   from nf join aud a on a.record_id = nf.id
  where d.id = nf.id
 returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;

-- ===== statement 10: audit (corpus_research_names.summary sync: exact copy of the source item): Seeger firm row + judges rows changed by the directory-stub flags =====
with flag as (select true as apply),
tgt as materialized (
 select n.kind, n.canonical_id, to_jsonb(n) as old_row, r.item as new_summary
 from public.corpus_research_names n join public.corpus_records r on r.dataset = n.source_dataset and r.id = n.source_id
 where n.summary is distinct from r.item),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_research_names', t.kind || '|' || t.canonical_id, 'dq20261003r4_research_names_summary_sync', 'label_override',
  'corpus_research_names.summary is an exact copy of the source item; the source item changed in this run (judges directory-stub flags; Seeger Weiss firm roles roll-up). Synced.',
  jsonb_build_object('review_version','counsel-seeger-weiss/2026-10-03.r4.1','invariant','summary = source item (held for all other 15,246 rows)'),
  jsonb_build_object('row', t.old_row),
  jsonb_build_object('summary', t.new_summary),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from tgt t where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing returning record_id)
select (select count(*) from tgt) stale_rows, (select count(*) from ins) audit_rows_written;

-- ===== statement 11: apply (corpus_research_names.summary sync) =====
with u as (
 update public.corpus_research_names n
    set summary = c.replacement->'summary', refreshed_at = now()
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'corpus_research_names' and c.issue = 'dq20261003r4_research_names_summary_sync' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and c.record_id = n.kind || '|' || n.canonical_id and n.summary = c.original_record->'row'->'summary'
 returning n.kind)
select count(*) updated from u;
