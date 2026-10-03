"""Write wt-quality/database/contracts/mdls-jpml-2026-10-01-refresh-r3-20261003-v1.sql and the four statements separately (jpml/stmt_*.sql)."""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "wt-quality", "database", "contracts"))
RUN = "c490cdf1-b32e-46ae-95c5-788cdeba3f33"
src = json.load(open(os.path.join(HERE, "refresh_sources.json")))
SHA, DOC = src["sha"], src["doc"]
VALS = open(os.path.join(HERE, "oct_values.sql.txt"), encoding="utf-8").read()
URL_A = "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_Actions_Pending-October-1-2026.pdf"
URL_D = "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_MDL_Number-October-1-2026.pdf"
URL_T = "https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf"
L = "as listed in the JPML report dated 2026-10-01"
GONE_TXT = "No longer listed in the JPML reports dated 2026-10-01 (Status: Transferred; Limited to Active Litigations) although listed as active on 2026-09-01; recorded as terminated as of the 2026-10-01 report. The reports do not state a closing date, so date_closed stays empty."

HEADER = f"""-- mdls-jpml-2026-10-01-refresh/2026-10-03.r3.1  (round 3 run {RUN}; coordinator round-3 item A)
-- ADDITIVE refresh of the public.corpus_records dataset 'mdls' (JPML multidistrict litigation directory) to the JPML CM/ECF reports dated 2026-10-01.
-- Sources (captured under C:\\Users\\firas\\.codex\\corpus-cache\\seeger-weiss\\2026-10-02\\full-matter-audit\\; mdl-members reads the same jpml-census.json):
--   jpml-2026-10-01.pdf/.txt           Distribution of Pending MDL Dockets by Actions Pending   sha256 {SHA['actions']}  ({URL_A})
--   jpml-master-dockets-2026-10-01.pdf Docket Summary Listing (by MDL number)                   sha256 {SHA['dockets']}  ({URL_D})
--   jpml-terminated-2025.pdf           JPML Fiscal Year 2025 Terminated Litigations Report      sha256 {SHA['terminated']}  ({URL_T})
-- Findings of the comparison (all reproducible with _work/agents/data-quality/jpml/parse_jpml.py):
--   * 162 MDLs are listed active on 2026-10-01; all 162 are already rows of 'mdls'. NEW MDLs since 2026-09-01: none (highest number 3193 on both dates).
--   * District, master docket, date transferred, transferee judge name and caption of all 162 are IDENTICAL to the stored 2026-09-01 values.
--   * 74 of 162 changed actions pending, 51 changed total actions; 4 printed judge TITLES changed (3047 now Chief Judge, 3166 and 3062 no longer Chief Judge, 2913 Sr. District Judge).
--   * 4 MDLs listed active on 2026-09-01 are absent from the 2026-10-01 active reports: 2358, 2775, 2938, 3134 -> recorded as terminated (no closing date stated).
--   * 3 closed MDLs absent from 'mdls' are listed by a dated official source (FY2025 Terminated Litigations Report, 2025-09-30): 2545 (terminated 2023), 2606 (2020), 2800 (2022) -> added as terminated rows
--     carrying only what that report states (caption as abbreviated there, termination year, cumulative action counts); no court, judge or docket is invented.
-- Pattern kept from the 2026-09-01 refresh: item and detail top level carry the LATEST report (as_of 2026-10-01); every earlier dated value stays in detail.snapshots
-- (2026-03-31, 2026-06-30, 2026-09-01 are untouched) and the new 2026-10-01 snapshot / report entries are APPENDED; nothing is deleted. detail.temporal and the 2026-09-01
-- provenance entries keep describing the 2026-09-01 listing capture; provenance.counts_as_of says which report the counts come from.
-- metadata.listing.results and metadata.filter_index are exact copies of the live item/filters (176 of 176 equal before) and are regenerated from the live rows; registry_summary, summary
-- and manifest_sha256 are the dated 2026-09-01 build record and are left untouched (metadata.refresh_2026_10_01 records this refresh).
-- Execute statements 1, 2, 3, 4 in order. Row guard everywhere: whole-row md5 equals the audited before-image.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set item=c.original_record->'item', detail=c.original_record->'detail', filters=c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c where c.dataset='mdls' and c.issue='dq20261003r3_mdls_jpml_20261001' and c.run_id='{RUN}' and r.dataset='mdls' and r.id=c.record_id;
--   delete from public.corpus_records r using corpus_ingest.cleanup_decisions c where c.dataset='mdls' and c.issue='dq20261003r3_mdls_added_terminated' and c.run_id='{RUN}' and r.dataset='mdls' and r.id=c.record_id;
--   update public.corpus_datasets d set expected_records=(c.original_record->>'expected_records_col')::bigint, imported_records=(c.original_record->>'imported_records_col')::bigint, updated_at=now(),
--          metadata = (d.metadata - 'refresh_2026_10_01') || (c.original_record->'metadata_keys')
--     from corpus_ingest.cleanup_decisions c where c.dataset='corpus_datasets' and c.issue='dq20261003r3_mdls_directory_metadata' and c.run_id='{RUN}' and c.record_id=d.id;
--   (metadata_keys holds the original listing, filter_index, source_id_aliases and expected_records values.)
"""

S1 = f"""-- ===== statement 1: audit (before-images of the 166 pending rows that change) =====
with oct(mdl, pending, total, jtitle) as (values
    {VALS}
  ),
gone(mdl) as (values (2358), (2775), (2938), (3134)),
target as materialized (
 select r.id, r.ordinal, r.item, r.detail, r.filters, r.text, md5(to_jsonb(r)::text) as row_md5, o.pending, o.total, o.jtitle, (g.mdl is not null) as left_active
 from public.corpus_records r
 left join oct o on o.mdl = (r.item->>'mdl_number')::int
 left join gone g on g.mdl = (r.item->>'mdl_number')::int
 where r.dataset = 'mdls' and r.item->>'status' = 'pending' and (o.mdl is not null or g.mdl is not null)),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'mdls', t.id, 'dq20261003r3_mdls_jpml_20261001', 'label_override',
  case when t.left_active then '{GONE_TXT}'
       else 'Actions pending / total actions and the printed judge title refreshed to the JPML report dated 2026-10-01; the 2026-09-01 values stay in detail.snapshots.' end,
  jsonb_build_object('review_version','mdls-jpml-2026-10-01/r3.1','report_date','2026-10-01','approved_by','coordinator (round 3 item A)',
     'sources', jsonb_build_array(
        jsonb_build_object('kind','by_actions_pending','url','{URL_A}','sha256','{SHA['actions']}'),
        jsonb_build_object('kind','by_mdl_number','url','{URL_D}','sha256','{SHA['dockets']}'))),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'item',t.item,'detail',t.detail,'filters',t.filters,'text',t.text,'row_md5',t.row_md5),
  jsonb_build_object('action', case when t.left_active then 'left_active_list' else 'counts_2026_10_01' end, 'pending', t.pending, 'total', t.total, 'judge_title', t.jtitle),
  '{RUN}'::uuid
 from target t
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target) targets, (select count(*) from target where left_active) left_active_list, (select count(*) from ins) audit_rows_written;
"""

S2 = f"""-- ===== statement 2: apply from the audited before-images =====
with a as (
 select c.record_id, c.replacement->>'action' as action, (c.replacement->>'pending')::int as pending, (c.replacement->>'total')::int as total, c.replacement->>'judge_title' as jtitle, c.original_record->>'row_md5' as row_md5
 from corpus_ingest.cleanup_decisions c where c.dataset = 'mdls' and c.issue = 'dq20261003r3_mdls_jpml_20261001' and c.run_id = '{RUN}'),
rep as (
 select jsonb_build_object('as_of','2026-10-01','captured_at',null,'printed_header_local','10/1/26, 8:38 AM','document_id','{DOC['actions']}','report_kind','by_actions_pending','sha256','{SHA['actions']}','source_url','{URL_A}') as ra,
        jsonb_build_object('as_of','2026-10-01','captured_at',null,'printed_header_local','10/1/26, 8:30 AM','document_id','{DOC['dockets']}','report_kind','by_mdl_number','sha256','{SHA['dockets']}','source_url','{URL_D}') as rd),
n as (
 select r.id, a.action, a.pending, a.total, a.jtitle, r.item, r.detail,
        (a.action = 'counts_2026_10_01' and (r.item->>'judge_title_as_printed') is distinct from a.jtitle) as title_changed
 from a join public.corpus_records r on r.dataset = 'mdls' and r.id = a.record_id and md5(to_jsonb(r)::text) = a.row_md5),
e1 as (
 select n.*,
  case when n.action = 'counts_2026_10_01'
       then n.item || jsonb_build_object('as_of','2026-10-01','counts_label','{L}','total_actions',n.total,'actions_pending',n.pending)
                   || case when n.title_changed then jsonb_build_object('judge_title_as_printed', n.jtitle) else '{{}}'::jsonb end
       else n.item || jsonb_build_object('status','terminated') end as new_item,
  case when n.action = 'counts_2026_10_01'
       then n.detail || jsonb_build_object('counts_label','{L}','total_actions',n.total,'actions_pending',n.pending)
       else n.detail || jsonb_build_object('status','terminated') end as d
 from n),
e2 as (
 select e1.*, jsonb_set(e1.d, '{{summary}}', e1.d->'summary' ||
   case when e1.action = 'counts_2026_10_01'
        then jsonb_build_object('as_of','2026-10-01','counts_label','{L}','total_actions',e1.total,'actions_pending',e1.pending)
             || case when e1.title_changed then jsonb_build_object('judge_title_as_printed', e1.jtitle) else '{{}}'::jsonb end
        else jsonb_build_object('status','terminated') end) as d2 from e1),
e3 as (
 select e2.*, case when e2.action = 'counts_2026_10_01' and jsonb_typeof(e2.d2->'cases') = 'object'
                   then jsonb_set(e2.d2, '{{cases}}', e2.d2->'cases' || jsonb_build_object('jpml_counts_label','{L}','jpml_total_actions',e2.total,'jpml_actions_pending',e2.pending))
                   else e2.d2 end as d3 from e2),
e4 as (
 select e3.*, case when e3.title_changed then jsonb_set(e3.d3, '{{transferee_judge}}', e3.d3->'transferee_judge' || jsonb_build_object('title_as_printed', e3.jtitle)) else e3.d3 end as d4 from e3),
e5 as (
 select e4.*, jsonb_set(e4.d4, '{{snapshots}}',
   (select coalesce(jsonb_agg(case when s->>'as_of' = '2026-09-01' and e4.title_changed then s || jsonb_build_object('judge_title_as_printed', e4.item->>'judge_title_as_printed') else s end order by ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(e4.d4->'snapshots','[]'::jsonb)) with ordinality t(s, ord))
   || jsonb_build_array(
        case when e4.action = 'counts_2026_10_01'
             then jsonb_build_object('as_of','2026-10-01','document_id','{DOC['actions']}','report_kind','by_actions_pending','counts_label','{L}','total_actions',e4.total,'actions_pending',e4.pending)
                  || case when e4.title_changed then jsonb_build_object('judge_title_as_printed', e4.jtitle) else '{{}}'::jsonb end
             else jsonb_build_object('as_of','2026-10-01','document_id','{DOC['actions']}','report_kind','by_actions_pending','listed_active',false,
                    'counts_label','not listed in the JPML report dated 2026-10-01 (Status: Transferred; Limited to Active Litigations)','total_actions',null,'actions_pending',null) end)) as d5
 from e4),
e6 as (
 select e5.*, jsonb_set(e5.d5, '{{reports}}', coalesce(e5.d5->'reports','[]'::jsonb) ||
   case when e5.action = 'counts_2026_10_01' then jsonb_build_array(rep.ra, rep.rd)
        else jsonb_build_array(rep.ra || jsonb_build_object('listed',false), rep.rd || jsonb_build_object('listed',false)) end) as d6
 from e5 cross join rep),
e7 as (
 select e6.*, jsonb_set(e6.d6, '{{provenance}}', (e6.d6->'provenance') ||
   jsonb_build_object('reports', coalesce(e6.d6->'provenance'->'reports','[]'::jsonb) ||
        case when e6.action = 'counts_2026_10_01' then jsonb_build_array(rep.ra, rep.rd)
             else jsonb_build_array(rep.ra || jsonb_build_object('listed',false), rep.rd || jsonb_build_object('listed',false)) end,
      'counts_as_of', case when e6.action = 'counts_2026_10_01' then '2026-10-01' else e6.d6->'provenance'->>'source_as_of' end) ||
   case when e6.action = 'left_active_list' then jsonb_build_object('status_basis_2026_10_01', '{GONE_TXT}') else '{{}}'::jsonb end) as d7
 from e6 cross join rep),
u as (
 update public.corpus_records r
    set item = e7.new_item, detail = e7.d7,
        filters = case when e7.action = 'left_active_list' then jsonb_set(r.filters, '{{status}}', '"terminated"') else r.filters end
   from e7 where r.dataset = 'mdls' and r.id = e7.id
 returning r.id)
select (select count(*) from u) updated;
"""

# statement 3: inserted terminated rows (values come from the FY2025 terminated report in jpml-census.json)
census = json.load(open("C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/full-matter-audit/jpml-census.json", encoding="utf-8"))
term = {x["mdl"]: x for x in census if x["report_date"] == "2025-09-30" and x["mdl"] in (2545, 2606, 2800)}
assert set(term) == {2545, 2606, 2800}


def q(s):
    return "'" + s.replace("'", "''") + "'"


tvals = ",\n    ".join(
    f"({m}, {q(x['caption'])}, {x['historical']}, {x['transferred_actions']}, {x['actions_filed_in_transferee_court']}, {x['closed']}, {x['remanded']}, {x['termination_year']})"
    for m, x in sorted(term.items())
)
TL = "as listed in the JPML Fiscal Year 2025 Terminated Litigations Report dated 2025-09-30"
S3 = f"""-- ===== statement 3: add the 3 closed MDLs that a dated official source lists =====
with t(mdl, caption, historical, transferred, filed_in_transferee, closed, remanded, term_year) as (values
    {tvals}
  ),
rows_ as (
 select t.mdl, 176 + row_number() over (order by t.mdl) - 1 as ordinal,
  jsonb_build_object('id','mdl:' || t.mdl,'as_of','2025-09-30','title',t.caption,'status','terminated','circuit',null,'court_name',null,'mdl_number',t.mdl,'cl_court_id',null,'date_closed',null,'cl_docket_id',null,
     'counts_label','{TL}','district_code',null,'master_docket',null,'total_actions',t.historical,'judge_relation',null,'judge_resolved',null,'actions_pending',null,'judge_entity_id',null,
     'litigation_type',null,'date_transferred',null,'judge_link_basis',null,'judge_match_kind',null,'cl_assigned_to_id',null,'has_local_collection',false,'judge_name_as_printed',null,'judge_title_as_printed',null,
     'termination_year',t.term_year,'transferred_actions',t.transferred,'actions_filed_in_transferee_court',t.filed_in_transferee,'closed_actions',t.closed,'remanded_actions',t.remanded) as item,
  jsonb_build_object('document_id','{DOC['terminated']}','report_kind','terminated_fy2025','sha256','{SHA['terminated']}','source_url','{URL_T}','as_of','2025-09-30','captured_at',null) as rep
 from t),
built as (
 select r.mdl, r.ordinal, r.item,
  jsonb_build_object('id','mdl:' || r.mdl,'cases',null,'court',null,'edges','[]'::jsonb,'title',r.item->>'title','status','terminated','circuit',null,'reports',jsonb_build_array(r.rep),
    'summary',r.item,'cl_links',null,
    'temporal',jsonb_build_object('captured_at',null,'effective_to',null,'published_at',null,'source_as_of','2025-09-30','effective_from',null,'captured_at_basis',null,
       'effective_to_basis',null,'published_at_basis',null,'source_as_of_basis','report date of the JPML Fiscal Year 2025 Terminated Litigations Report (census report_date 2025-09-30)','effective_from_basis',null),
    'documents','[]'::jsonb,
    'snapshots',jsonb_build_array(jsonb_build_object('as_of','2025-09-30','document_id',r.rep->>'document_id','report_kind','terminated_fy2025','counts_label','{TL}','total_actions',(r.item->>'total_actions')::bigint,'actions_pending',null,
        'termination_year',(r.item->>'termination_year')::int,'transferred_actions',(r.item->>'transferred_actions')::int,'actions_filed_in_transferee_court',(r.item->>'actions_filed_in_transferee_court')::int,
        'closed_actions',(r.item->>'closed_actions')::int,'remanded_actions',(r.item->>'remanded_actions')::int)),
    'court_name',null,'date_filed',null,'mdl_number',r.mdl,
    'provenance',jsonb_build_object('reports',jsonb_build_array(r.rep),'publisher','United States Judicial Panel on Multidistrict Litigation (FY2025 Terminated Litigations Report)','captured_at',null,'source_as_of','2025-09-30','connector_note',null,
       'temporal',jsonb_build_object('captured_at',null,'effective_to',null,'published_at',null,'source_as_of','2025-09-30','effective_from',null)),
    'unresolved','[]'::jsonb,'appearances',null,'cl_court_id',null,'date_closed',null,'judge_links','[]'::jsonb,
    'title_basis','caption as printed (abbreviated, without the IN RE prefix) in the JPML Fiscal Year 2025 Terminated Litigations Report; the report gives the termination year only',
    'counts_label','{TL}','district_code',null,'master_docket',null,'total_actions',(r.item->>'total_actions')::bigint,'expert_rulings',null,'fjc_court_name',null,'actions_pending',null,'docket_activity',null,'litigation_type',null,
    'verdict_reports',null,'date_transferred',null,'docket_documents',null,'transferee_judge',null,'counsel_directory',null,'local_collections','[]'::jsonb,'state_proceedings',null) as detail
 from rows_ r),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'mdls', b.mdl::text, 'dq20261003r3_mdls_added_terminated', 'label_override',
  'Closed MDL listed by a dated official source (JPML Fiscal Year 2025 Terminated Litigations Report, 2025-09-30) but absent from the mdls directory. Added with only the fields the report states.',
  jsonb_build_object('review_version','mdls-jpml-2026-10-01/r3.1','source_url','{URL_T}','sha256','{SHA['terminated']}','approved_by','coordinator (round 3 item A)'),
  jsonb_build_object('inserted',true,'id',b.mdl::text,'ordinal',b.ordinal),
  jsonb_build_object('item',b.item,'ordinal',b.ordinal),
  '{RUN}'::uuid
 from built b on conflict (dataset,record_id,issue) do nothing returning record_id),
ins as (
 insert into public.corpus_records(dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters)
 select 'mdls', b.mdl::text, 'multidistrict_litigation', null, '{{}}'::text[], b.item->>'title', null, b.ordinal, b.item, b.detail,
        'MDL ' || b.mdl,
        jsonb_build_object('id', b.mdl::text, 'court', '[]'::jsonb, '__rank', b.ordinal, 'status', 'terminated', 'circuit', '', 'entity_id', '[]'::jsonb, 'cl_person_id', '', 'judge_resolved', '', 'litigation_type', '')
 from built b join aud a on a.record_id = b.mdl::text
 where not exists (select 1 from public.corpus_records x where x.dataset = 'mdls' and x.id = b.mdl::text)
 returning id)
select (select count(*) from built) built, (select count(*) from aud) audit_rows_written, (select count(*) from ins) rows_inserted;
"""

S4 = f"""-- ===== statement 4: dataset metadata (regenerate the exact copies of the live rows; counts; refresh record) =====
with old as (select d.metadata, d.expected_records, d.imported_records from public.corpus_datasets d where d.id = 'mdls'),
live as (select r.id, r.title, r.ordinal, r.item, r.filters from public.corpus_records r where r.dataset = 'mdls'),
oldfi as (select f.value->>'id' as id, f.value->>'search' as search from old, jsonb_array_elements(old.metadata->'filter_index') f),
newres as (select jsonb_agg(l.item order by l.ordinal) as o from live l),
newfi as (
 select jsonb_agg(jsonb_build_object('id', l.id, 'item', l.item, 'filters', l.filters,
          'search', coalesce(o.search, lower(l.title) || ' ' || l.id || ' mdl-' || l.id || ' mdl ' || l.id)) order by l.ordinal) as o
 from live l left join oldfi o on o.id = l.id),
sums as (
 select count(*) filter (where l.item->>'status' = 'pending') as pending_mdls, count(*) filter (where l.item->>'status' = 'terminated') as terminated_mdls,
        sum((l.item->>'total_actions')::bigint) filter (where l.item->>'status' = 'pending') as total_actions, sum((l.item->>'actions_pending')::bigint) filter (where l.item->>'status' = 'pending') as actions_pending,
        count(*) as records
 from live l),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', 'mdls', 'dq20261003r3_mdls_directory_metadata', 'label_override',
  'mdls refreshed to the JPML 2026-10-01 reports: metadata.listing.results and metadata.filter_index (exact copies of the live item/filters) regenerated, listing date/label/qualification date updated, record counts and id aliases extended for the 3 added terminated MDLs, refresh record added.',
  jsonb_build_object('review_version','mdls-jpml-2026-10-01/r3.1','approved_by','coordinator (round 3 item A)'),
  jsonb_build_object('id','mdls','expected_records_col',o.expected_records,'imported_records_col',o.imported_records,
     'metadata_keys', jsonb_build_object('listing', o.metadata->'listing', 'filter_index', o.metadata->'filter_index', 'source_id_aliases', o.metadata->'source_id_aliases', 'expected_records', o.metadata->'expected_records')),
  jsonb_build_object('records', s.records),
  '{RUN}'::uuid
 from old o cross join sums s on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(o.metadata,
          '{{listing,results}}', nr.o), '{{filter_index}}', nf.o), '{{listing,as_of}}', '"2026-10-01"'),
          '{{listing,counts_label}}', '"{L}"'),
          '{{listing,qualification}}', to_jsonb(replace(o.metadata->'listing'->>'qualification', '(2026-09-01)', '(2026-10-01)'))),
          '{{source_id_aliases}}', (o.metadata->'source_id_aliases') || jsonb_build_object('mdl:2545','2545','mdl:2606','2606','mdl:2800','2800')),
          '{{expected_records}}', to_jsonb(s.records))
        || jsonb_build_object('refresh_2026_10_01', jsonb_build_object(
             'as_of','2026-10-01','run_id','{RUN}','method','additive: latest report at the top level of item/detail, earlier dated values kept in detail.snapshots',
             'sources', jsonb_build_array(
                jsonb_build_object('kind','by_actions_pending','document_id','{DOC['actions']}','sha256','{SHA['actions']}','url','{URL_A}'),
                jsonb_build_object('kind','by_mdl_number','document_id','{DOC['dockets']}','sha256','{SHA['dockets']}','url','{URL_D}'),
                jsonb_build_object('kind','terminated_fy2025','document_id','{DOC['terminated']}','sha256','{SHA['terminated']}','url','{URL_T}','as_of','2025-09-30')),
             'counts', jsonb_build_object('mdls_pending', s.pending_mdls, 'mdls_terminated', s.terminated_mdls, 'total_actions', s.total_actions, 'actions_pending', s.actions_pending, 'records', s.records,
                'listed_active_2026_10_01', 162, 'new_mdls_since_2026_09_01', 0, 'left_active_list', jsonb_build_array(2358, 2775, 2938, 3134),
                'added_terminated_fy2025', jsonb_build_array(2545, 2606, 2800), 'judge_titles_changed', jsonb_build_array(2913, 3047, 3062, 3166)),
             'unchanged_since_2026_09_01', jsonb_build_array('title','district_code','master_docket','date_transferred','judge_name_as_printed (162 of 162)'),
             'registry_summary_note', 'registry_summary, summary and manifest_sha256 describe the 2026-09-01 build and are left as recorded')),
        expected_records = s.records, imported_records = s.records, updated_at = now()
   from old o, newres nr, newfi nf, sums s, aud a
  where d.id = 'mdls'
 returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;
"""

full = HEADER + "\n" + S1 + "\n" + S2 + "\n" + S3 + "\n" + S4
open(os.path.join(CONTRACTS, "mdls-jpml-2026-10-01-refresh-r3-20261003-v1.sql"), "w", encoding="utf-8").write(full)
for i, s in enumerate((S1, S2, S3, S4), 1):
    open(os.path.join(HERE, f"stmt_{i}.sql"), "w", encoding="utf-8").write(s)
print("contract bytes", len(full), [len(s) for s in (S1, S2, S3, S4)])
