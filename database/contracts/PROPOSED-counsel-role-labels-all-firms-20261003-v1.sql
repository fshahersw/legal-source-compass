-- PROPOSED, NOT EXECUTED (round 4 item A, wider scope than the approved Seeger Weiss scope). Awaiting the coordinator's decision. Dry-run counts below are from the live tables, 2026-10-03.
-- Defect: the source build printed CourtListener role code 4 as "terminated", code 6 as "inactive", code 8 as "unknown" (CourtListener: 4 Pro hac vice, 6 Terminated, 8 Inactive; evidence in
--   counsel-seeger-weiss-r4-20261003-v1.sql). The Seeger Weiss records are corrected (12 attorney records, 1 firm record, 19 appearances). The same shift sits in the rest of counsel_directory:
--     attorney records with raw "terminated": 213 outside Seeger Weiss -> Pro hac vice          attorney records with raw "inactive": 261 -> Terminated
--     (23 records have both; 451 attorney records pass all guards below)                          attorney records with raw "unknown": 5 -> Inactive (NOT in this file: verify each against CourtListener first)
--     firm records whose roll-up shows Terminated or Inactive: 165, of which 126 satisfy the roll-up invariant (role set = union of the linked attorney records) and would change; 39 do not
--     satisfy it and need a source check first (not in this file).
--   mdl_appearances: 1 row with raw "unknown" (verify first, not in this file); no other row is affected (the uppercase text family is correct).
--   Facets (today: Terminated 282, Inactive 390, Pro hac vice 19, Unknown 63): the Pro hac vice count would grow by the 213 records, Terminated would be the 261 inactive records plus the legitimately
--   terminated ones, and Inactive would fall to the records whose code 8 is verified; the exact numbers come from the recount statement.
-- Effects on the page if approved: a Role filter of Terminated / Inactive / Pro hac vice that means what CourtListener means; the dataset's caveat sentence (added by metrics-alignment-r4) is removed.
-- Statement order: 1 audit attorneys, 2 audit firms (both read the pre-apply state), 3 apply attorneys, 4 apply firms, 5 facet recount + qualification, 6 research-names sync (same statement as counsel-seeger statement 10/11).
-- Not tested end to end: statements 1 and 2 are the dry-run SELECTs turned into audit inserts (they returned 451 passing attorney records and 126 passing firm records); run them with flag = false first.
--
-- ROLLBACK: restore filters / detail / text (attorneys) and item / filters / detail / text (firms) from the before-image rows of issues dq20261003r4_all_role_labels_cd and dq20261003r4_all_role_labels_firm,
--   exactly as in counsel-seeger-weiss-r4-20261003-v1.sql.
--
-- ===== statement 1: audit (attorney records, all firms; Seeger Weiss records are already corrected and fail the text guard) =====
with flag as (select false as apply),
tgt as materialized (
 select r.id, r.title, r.filters, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r
 where r.dataset = 'counsel_directory' and r.filters @> '{"kind":["attorney"]}'
   and exists (select 1 from jsonb_array_elements(r.detail->'sections') s, jsonb_array_elements(coalesce(s->'rows','[]'::jsonb)) x where s->>'heading' = 'Roles seen' and x->>0 in ('terminated','inactive'))
   and not exists (select 1 from jsonb_array_elements(r.detail->'sections') s, jsonb_array_elements(coalesce(s->'rows','[]'::jsonb)) x where s->>'heading' = 'Roles seen' and x->>0 = 'unknown')),
rw as (
 select t.id, x.ord, x.r->>0 as raw, x.r->>1 as old_norm, x.r->>2 as cnt,
        case x.r->>0 when 'terminated' then 'Pro hac vice' when 'inactive' then 'Terminated' else x.r->>1 end as new_norm
 from tgt t, jsonb_array_elements(t.detail->'sections') as s(sec), jsonb_array_elements(s.sec->'rows') with ordinality as x(r, ord)
 where s.sec->>'heading' = 'Roles seen'),
old_set as (select id, jsonb_agg(distinct old_norm order by old_norm) as arr from rw group by id),
cur_set as (select t.id, jsonb_agg(distinct q.e order by q.e) as arr from tgt t, jsonb_array_elements_text(t.filters->'role') as q(e) group by t.id),
roles_new as (select id, jsonb_agg(v order by o) as arr from (select id, new_norm as v, min(ord) as o from rw group by id, new_norm) q group by id),
rows_new as (select id, jsonb_agg(jsonb_build_array(raw, new_norm, cnt) order by ord) as arr from rw group by id),
k as (select id, count(*) filter (where raw = 'terminated') as k1, count(*) filter (where raw = 'inactive') as k2 from rw group by id),
fx as (
 select t.id, t.row_md5, t.filters as old_filters, t.detail as old_detail, t.text as old_text,
        jsonb_set(t.filters, '{role}', rn.arr) as new_filters,
        jsonb_set(jsonb_set(t.detail, '{sections}',
            (select jsonb_agg(case when s.sec->>'heading' = 'Roles seen' then jsonb_set(s.sec, '{rows}', rwn.arr) else s.sec end order by s.ord) from jsonb_array_elements(t.detail->'sections') with ordinality as s(sec, ord))),
          '{facts}', (t.detail->'facts') || jsonb_build_array(jsonb_build_array('Role label correction',
             'The source build printed CourtListener role codes with a shifted dictionary: ' || case when k.k1 > 0 then 'code 4 as terminated (it is Pro hac vice)' else '' end || case when k.k1 > 0 and k.k2 > 0 then ' and ' else '' end
             || case when k.k2 > 0 then 'code 6 as inactive (it is Terminated)' else '' end || '. The role is shown as CourtListener defines it; the raw value is kept. Corrected on 2026-10-03.'))) as new_detail,
        replace(replace(replace(t.text, ' terminated Terminated ', ' terminated Pro hac vice '), ' inactive Inactive ', ' inactive Terminated '), ' Firm(s) as printed ',
          ' Role label correction The source build printed CourtListener role codes with a shifted dictionary: ' || case when k.k1 > 0 then 'code 4 as terminated (it is Pro hac vice)' else '' end
          || case when k.k1 > 0 and k.k2 > 0 then ' and ' else '' end || case when k.k2 > 0 then 'code 6 as inactive (it is Terminated)' else '' end
          || '. The role is shown as CourtListener defines it; the raw value is kept. Corrected on 2026-10-03. Firm(s) as printed ') as new_text
 from tgt t join old_set o on o.id = t.id join cur_set c on c.id = t.id join k on k.id = t.id join roles_new rn on rn.id = t.id join rows_new rwn on rwn.id = t.id
 where o.arr = c.arr
   and length(t.text) - length(replace(t.text, ' terminated Terminated ', '')) = k.k1 * length(' terminated Terminated ')
   and length(t.text) - length(replace(t.text, ' inactive Inactive ', '')) = k.k2 * length(' inactive Inactive ')
   and length(t.text) - length(replace(t.text, ' Firm(s) as printed ', '')) = length(' Firm(s) as printed ')),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'counsel_directory', x.id, 'dq20261003r4_all_role_labels_cd', 'label_override',
  'Attorney record: the source printed CourtListener role code 4 as terminated and code 6 as inactive; code 4 is Pro hac vice and code 6 is Terminated.',
  jsonb_build_object('review_version','counsel-role-labels-all-firms/2026-10-03.proposed.1','source','CourtListener cl/people_db/models.py Role enumeration; live CourtListener parties data'),
  jsonb_build_object('id',x.id,'filters',x.old_filters,'detail',x.old_detail,'text',x.old_text,'row_md5',x.row_md5),
  jsonb_build_object('filters',x.new_filters,'detail',x.new_detail,'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) candidates, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: audit (firm roll-ups: roles = union of the linked attorney records, recomputed from the audited attorney replacements) =====
with flag as (select false as apply),
firms as materialized (
 select r.id, r.filters, r.item, r.detail, r.text, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r where r.dataset = 'counsel_directory' and r.filters @> '{"kind":["firm"]}' and (r.filters->'role' ? 'Terminated' or r.filters->'role' ? 'Inactive')),
link as materialized (
 select f.id as firm_id, a.id as att_id, a.filters->'role' as cur_roles, c.replacement->'filters'->'role' as new_roles
 from firms f join public.corpus_records a on a.dataset = 'counsel_directory' and a.filters @> '{"kind":["attorney"]}' and a.detail::text like '%#counsel?id=' || f.id || '%'
 left join corpus_ingest.cleanup_decisions c on c.dataset = 'counsel_directory' and c.record_id = a.id and c.issue = 'dq20261003r4_all_role_labels_cd' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'),
old_u as (select firm_id, array_agg(distinct e order by e) as arr from link, jsonb_array_elements_text(link.cur_roles) e group by firm_id),
new_u as (select l.firm_id, array_agg(distinct e order by e) as arr from link l, jsonb_array_elements_text(coalesce(l.new_roles, l.cur_roles)) e group by l.firm_id),
fx as (
 select f.id, f.row_md5, f.item as old_item, f.filters as old_filters, f.detail as old_detail, f.text as old_text,
        jsonb_set(f.item, '{cells,roles}', to_jsonb(array_to_string(n.arr, ', '))) as new_item,
        jsonb_set(f.filters, '{role}', (select jsonb_agg(v order by (v not in (select jsonb_array_elements_text(f.filters->'role'))), v) from unnest(n.arr) v)) as new_filters,
        jsonb_set(f.detail, '{facts}', (select jsonb_agg(case when x.v->>0 = 'Roles seen' then jsonb_build_array('Roles seen', array_to_string(n.arr, ', ')) else x.v end order by x.o) from jsonb_array_elements(f.detail->'facts') with ordinality as x(v, o))) as new_detail,
        replace(f.text, f.item->'cells'->>'roles', array_to_string(n.arr, ', ')) as new_text
 from firms f join old_u o on o.firm_id = f.id join new_u n on n.firm_id = f.id
 where o.arr = (select array_agg(e order by e) from jsonb_array_elements_text(f.filters->'role') e)
   and o.arr = (select array_agg(c order by c) from unnest(string_to_array(f.item->'cells'->>'roles', ', ')) c)
   and n.arr <> o.arr
   and length(f.text) - length(replace(f.text, f.item->'cells'->>'roles', '')) = length(f.item->'cells'->>'roles')),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'counsel_directory', x.id, 'dq20261003r4_all_role_labels_firm', 'label_override',
  'Firm record: the roles roll-up follows the corrected attorney records.',
  jsonb_build_object('review_version','counsel-role-labels-all-firms/2026-10-03.proposed.1'),
  jsonb_build_object('id',x.id,'item',x.old_item,'filters',x.old_filters,'detail',x.old_detail,'text',x.old_text,'row_md5',x.row_md5),
  jsonb_build_object('item',x.new_item,'filters',x.new_filters,'detail',x.new_detail,'text',x.new_text),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from firms) candidates, (select count(*) from fx) passing_guards, (select count(*) from ins) audit_rows_written;

-- ===== statement 3: apply attorneys =====
with u as (
 update public.corpus_records r set filters = c.replacement->'filters', detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'counsel_directory' and c.issue = 'dq20261003r4_all_role_labels_cd' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'counsel_directory' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 4: apply firms =====
with u as (
 update public.corpus_records r set item = c.replacement->'item', filters = c.replacement->'filters', detail = c.replacement->'detail', text = c.replacement->>'text'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'counsel_directory' and c.issue = 'dq20261003r4_all_role_labels_firm' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'counsel_directory' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- statements 5 and 6: run the facet recount of counsel-seeger-weiss-r4 statement 9 (with the marker key accuracy_review_r4_roles removed first), replace the caveat sentence of
--   counsel_directory.listing.qualification (and its three mode copies) by nothing, and re-run the corpus_research_names.summary sync (statements 10 and 11 of counsel-seeger-weiss-r4).
