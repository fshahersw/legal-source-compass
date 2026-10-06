-- state-codes-counts/2026-10-06.1  (run: the open corpus-cleanup/1 run)
-- state_codes (2 rows: Indiana Code, South Dakota Codified Laws) stores record counts as text ("83,148", "71") in item.cells.records, in the "Records" fact of the
-- detail and inside the search text. Those numbers drift whenever indiana_code / sd_statutes change. Decision: drop the stored count text; the live counts are
-- corpus_datasets.imported_records of indiana_code (83,148) and sd_statutes (71) and are shown by the app from there.
-- Changed: item.cells.records removed, detail.facts entry ["Records", ...] removed, " Records <n>" removed from text (search_vector follows). Nothing else is touched.
-- The qualification prose for SD ("71 of 71 cached titles") describes a dated capture, not a live count, and stays.
-- Ledgered (label_override, original item/detail/text kept), md5-guarded, idempotent. Admin session (the RPC has no update op).
with run as (select corpus_ingest.cleanup_run_v1() as id),
target as materialized (
  select r.dataset, r.id, md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail, r.text as old_text,
         (r.item - 'cells') || jsonb_build_object('cells', (r.item->'cells') - 'records') as new_item,
         jsonb_set(r.detail, '{facts}', coalesce((select jsonb_agg(f) from jsonb_array_elements(r.detail->'facts') f where f->>0 <> 'Records'), '[]'::jsonb)) as new_detail,
         regexp_replace(r.text, ' Records [0-9][0-9,]*(\s)', '\1') as new_text
  from public.corpus_records r
  where r.dataset = 'state_codes' and (r.item->'cells' ? 'records' or exists (select 1 from jsonb_array_elements(r.detail->'facts') f where f->>0 = 'Records'))),
audited as (
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select t.dataset, t.id, 'cleanup_20261006_drop_count_text', 'label_override',
         'Stored record counts were text that drifts; live counts come from corpus_datasets.imported_records of the underlying code datasets',
         jsonb_build_object('version', 'state-codes-counts/2026-10-06.1'),
         jsonb_build_object('item', t.old_item, 'detail', t.old_detail, 'text', t.old_text, 'row_md5', t.row_md5),
         jsonb_build_object('item', t.new_item, 'detail', t.new_detail, 'text', t.new_text), (select id from run)
  from target t on conflict (dataset, record_id, issue) do nothing returning record_id),
updated as (
  update public.corpus_records r set item = t.new_item, detail = t.new_detail, text = t.new_text
  from target t where r.dataset = t.dataset and r.id = t.id and md5(to_jsonb(r)::text) = t.row_md5
    and (t.id in (select record_id from audited) or exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = t.dataset and d.record_id = t.id and d.issue = 'cleanup_20261006_drop_count_text' and d.original_record->>'row_md5' = t.row_md5))
  returning r.id)
select (select count(*) from target) as candidates, (select count(*) from audited) as audit_rows, (select count(*) from updated) as updated;

-- ROLLBACK (exact; only rows still carrying the projected values):
-- update public.corpus_records r set item = d.original_record->'item', detail = d.original_record->'detail', text = d.original_record->>'text'
--   from corpus_ingest.cleanup_decisions d
--  where d.dataset = 'state_codes' and d.issue = 'cleanup_20261006_drop_count_text' and r.dataset = d.dataset and r.id = d.record_id and r.item = d.replacement->'item';
