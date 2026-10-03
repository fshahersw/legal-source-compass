-- markdown-form-title-cleanup/2026-10-03.2  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Second, separately audited pass for court-form titles captured with a bold form name:
--   (a) **Summons in a Civil Action**(AO 440)        ->  Summons in a Civil Action (AO 440)     [25 rows]
--   (b) **Mortgage** — THIS MORTGAGE is made ...      ->  Mortgage — THIS MORTGAGE is made ...  [2 rows]
-- Rule (a): ^\*\*([^*]+)\*\*\(([^)]*)\)$ -> \1 (\2)   (markers removed; one space separates the form name and its form number)
-- Rule (b): ^\*\*([^*]+)\*\* — -> \1 —                 (markers removed)
-- Scope: seeger, docsupload_coverage, court_forms_expansion_20260912 (27 rows). Everything else as in the v1 contract:
-- exact old title string replaced in item/detail, display group title when it equals the collapsed old title,
-- search_vector recomputed by the existing trigger, text/source_url/filters/category/state untouched,
-- full original item/detail JSON and whole-row md5 stored for an exact revert.
--
-- ROLLBACK (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.issue='dq20261003_markdown_form_title' and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b'),
--   rev as (update public.corpus_records r set title = a.o->>'title', item = a.o->'item', detail = a.o->'detail'
--             from a where r.dataset=a.dataset and r.id=a.record_id returning r.id)
--   update public.corpus_display_groups g set metadata = jsonb_set(g.metadata,'{title}',to_jsonb(a.o->>'display_group_title'))
--     from a where g.id = a.o->>'display_group_id' and a.o->>'display_group_id' is not null;
with target as materialized (
 select r.dataset, r.id, r.ordinal, r.title as old_title,
        case when r.title ~ '^\*\*([^*]+)\*\*\(([^)]*)\)$' then regexp_replace(r.title, '^\*\*([^*]+)\*\*\(([^)]*)\)$', '\1 (\2)')
             else regexp_replace(r.title, '^\*\*([^*]+)\*\* — ', '\1 — ') end as new_title,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail, r.filters->>'display_id' as display_id, r.source_url
 from public.corpus_records r
 where r.dataset in ('seeger','docsupload_coverage','court_forms_expansion_20260912')
   and (r.title ~ '^\*\*([^*]+)\*\*\(([^)]*)\)$' or r.title ~ '^\*\*([^*]+)\*\* — ')),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003_markdown_form_title', 'label_override',
  'Court-form title captured with a Markdown-bold form name. Markers removed; wording unchanged; text and source URL untouched.',
  jsonb_build_object('review_version','markdown-form-title-cleanup/2026-10-03.2','rule','(a) **X**(Y) -> X (Y); (b) **X** — -> X —','source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,
                     'row_md5',t.row_md5,'display_group_id',t.display_id,
                     'display_group_title',(select g.metadata->>'title' from public.corpus_display_groups g where g.id = t.display_id)),
  jsonb_build_object('title',t.new_title),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t where t.new_title <> t.old_title and t.new_title !~ '\*'
 on conflict (dataset,record_id,issue) do nothing
 returning record_id, dataset),
audit_ok as (
 select record_id, dataset from audited
 union
 select c.record_id, c.dataset from corpus_ingest.cleanup_decisions c join target t on c.dataset = t.dataset and c.record_id = t.id
  where c.issue = 'dq20261003_markdown_form_title' and c.original_record->>'row_md5' = t.row_md5),
updated as (
 update public.corpus_records r
    set title = t.new_title,
        item = replace(t.old_item::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb,
        detail = replace(t.old_detail::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb
   from target t join audit_ok a on a.record_id = t.id and a.dataset = t.dataset
  where r.dataset = t.dataset and r.id = t.id and t.new_title <> t.old_title and t.new_title !~ '\*' and md5(to_jsonb(r)::text) = t.row_md5
  returning r.dataset, r.id, t.display_id, t.old_title, t.new_title),
grouped as (
 update public.corpus_display_groups g
    set metadata = jsonb_set(g.metadata, '{title}', to_jsonb(u.new_title))
   from updated u
  where u.display_id is not null and g.id = u.display_id and g.metadata->>'title' = regexp_replace(btrim(u.old_title), '\s+', ' ', 'g')
  returning g.id)
select jsonb_build_object('contract','markdown-form-title-cleanup/2026-10-03.2','targets',(select count(*) from target),
 'by_dataset',(select jsonb_object_agg(dataset, n) from (select dataset, count(*) n from target group by 1) q),
 'audit_rows_written',(select count(*) from audited),'records_updated',(select count(*) from updated),
 'display_groups_updated',(select count(*) from grouped),'checked_at',now()) as receipt;
