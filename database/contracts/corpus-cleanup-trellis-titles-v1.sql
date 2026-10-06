-- trellis-receipt-titles/2026-10-06.1  (run: the open corpus-cleanup/1 run)
-- Dataset trellis_receipts (2,550 rows): every title equals the record id (tc-0002, tc-catalog-..., tc-scout-...). The rows' own fields identify what each receipt is:
--   item.tool (connector/tool name), item.arguments (the call arguments) and item.called_at_utc (when recorded).
-- Rule (deterministic, uses only the row's own fields):  title = tool || ' — ' || key=value pairs of arguments sorted by key || ' · ' || date(called_at_utc) when present.
-- Not changed: id, item, detail, text, source_url, category, state, filters, ordinal. Rows without item.tool, or whose title is not exactly the id, are not touched.
-- Guard: the row's md5 must equal the md5 read in the same statement; the old title and md5 are archived in corpus_ingest.cleanup_decisions (label_override).
-- Run in the admin session (the RPC has no update op). Idempotent: already-retitled rows no longer match (title <> id).
with run as (select corpus_ingest.cleanup_run_v1() as id),
target as materialized (
  select r.dataset, r.id, r.title as old_title, md5(to_jsonb(r)::text) as row_md5,
         (r.item->>'tool') || ' — ' ||
         coalesce((select string_agg(a.key || '=' || btrim(a.value), ' · ' order by a.key) from jsonb_each_text(case when jsonb_typeof(r.item->'arguments') = 'object' then r.item->'arguments' else '{}'::jsonb end) a where btrim(coalesce(a.value, '')) <> ''), 'no arguments recorded')
         || coalesce(' · ' || left(r.item->>'called_at_utc', 10), '') as new_title
  from public.corpus_records r
  where r.dataset = 'trellis_receipts' and r.title = r.id and coalesce(btrim(r.item->>'tool'), '') <> ''
),
audited as (
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select t.dataset, t.id, 'cleanup_20261006_retitle_trellis_receipt', 'label_override',
         'Title was identical to the record id; replaced by a label built only from the receipt''s own tool, arguments and call date',
         jsonb_build_object('version', 'trellis-receipt-titles/2026-10-06.1', 'rule', 'tool — key=value arguments sorted — date(called_at_utc)'),
         jsonb_build_object('title', t.old_title, 'row_md5', t.row_md5), jsonb_build_object('title', t.new_title), (select id from run)
  from target t on conflict (dataset, record_id, issue) do nothing returning record_id
),
updated as (
  update public.corpus_records r set title = t.new_title
  from target t where r.dataset = t.dataset and r.id = t.id and r.title = t.old_title and md5(to_jsonb(r)::text) = t.row_md5
    and (t.id in (select record_id from audited)
         or exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = t.dataset and d.record_id = t.id and d.issue = 'cleanup_20261006_retitle_trellis_receipt' and d.original_record->>'row_md5' = t.row_md5))
  returning r.id
)
select (select count(*) from target) as candidates, (select count(*) from audited) as audit_rows_written, (select count(*) from updated) as titles_updated;

-- ROLLBACK (exact; only reverts rows still carrying the projected title):
-- update public.corpus_records r set title = d.original_record->>'title'
--   from corpus_ingest.cleanup_decisions d
--  where d.dataset = 'trellis_receipts' and d.issue = 'cleanup_20261006_retitle_trellis_receipt'
--    and r.dataset = d.dataset and r.id = d.record_id and r.title = d.replacement->>'title';
