-- markdown-wrapped-title-cleanup/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Titles captured from Markdown-rendered pages that are entirely wrapped in bold markers, e.g. "**Escrow Agreement**".
-- Rule (deterministic): title ~ '^\*\*[^*].*[^*]\*\*$' with exactly two '**' occurrences  ->  btrim(substr(title, 3, length-4)).
-- Scope: seeger, url_directory, docsupload_coverage, court_forms_expansion_20260912, court_documents (134 rows).
-- NOT changed: openFDA/CPSC asterisks (FDA label text), partial/unbalanced markers, any title with more than one pair.
-- The exact old title string is replaced by the new one wherever it occurs as a whole JSON string value in item/detail
-- (title, cells.document, subtitle, link labels ...), plus corpus_display_groups.metadata.title when it equals the collapsed old title.
-- search_vector is recomputed by the existing trigger. text, source_url, category, state, filters, ordinal untouched.
-- Reversible exactly: the audit row stores the complete original item and detail JSON and the whole-row md5.
--
-- ROLLBACK (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.issue='dq20261003_markdown_wrapped_title' and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b'),
--   rev as (update public.corpus_records r set title = a.o->>'title', item = a.o->'item', detail = a.o->'detail'
--             from a where r.dataset=a.dataset and r.id=a.record_id returning r.id)
--   update public.corpus_display_groups g set metadata = jsonb_set(g.metadata,'{title}',to_jsonb(a.o->>'display_group_title'))
--     from a where g.id = a.o->>'display_group_id' and a.o->>'display_group_id' is not null;
with target as materialized (
 select r.dataset, r.id, r.ordinal, r.title as old_title, btrim(substr(r.title, 3, length(r.title) - 4)) as new_title,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail, r.filters->>'display_id' as display_id, r.source_url
 from public.corpus_records r
 where r.dataset in ('seeger','url_directory','docsupload_coverage','court_forms_expansion_20260912','court_documents')
   and r.title ~ '^\*\*[^*].*[^*]\*\*$' and r.title !~ '\*\*.*\*\*.*\*\*'
   and btrim(substr(r.title, 3, length(r.title) - 4)) <> ''),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003_markdown_wrapped_title', 'label_override',
  'Title was entirely wrapped in Markdown bold markers by the page-to-Markdown capture. Markers removed; no wording changed; text and source URL untouched.',
  jsonb_build_object('review_version','markdown-wrapped-title-cleanup/2026-10-03.1','rule','^\*\*[^*].*[^*]\*\*$ with exactly two ** -> btrim(inner)','source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,
                     'row_md5',t.row_md5,'display_group_id',t.display_id,
                     'display_group_title',(select g.metadata->>'title' from public.corpus_display_groups g where g.id = t.display_id)),
  jsonb_build_object('title',t.new_title),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t where t.new_title <> t.old_title
 on conflict (dataset,record_id,issue) do nothing
 returning record_id, dataset),
audit_ok as (
 select record_id, dataset from audited
 union
 select c.record_id, c.dataset from corpus_ingest.cleanup_decisions c join target t on c.dataset = t.dataset and c.record_id = t.id
  where c.issue = 'dq20261003_markdown_wrapped_title' and c.original_record->>'row_md5' = t.row_md5),
updated as (
 update public.corpus_records r
    set title = t.new_title,
        item = replace(t.old_item::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb,
        detail = replace(t.old_detail::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb
   from target t join audit_ok a on a.record_id = t.id and a.dataset = t.dataset
  where r.dataset = t.dataset and r.id = t.id and md5(to_jsonb(r)::text) = t.row_md5
  returning r.dataset, r.id, t.display_id, t.old_title, t.new_title),
grouped as (
 update public.corpus_display_groups g
    set metadata = jsonb_set(g.metadata, '{title}', to_jsonb(u.new_title))
   from updated u
  where u.display_id is not null and g.id = u.display_id and g.metadata->>'title' = regexp_replace(btrim(u.old_title), '\s+', ' ', 'g')
  returning g.id)
select jsonb_build_object('contract','markdown-wrapped-title-cleanup/2026-10-03.1','targets',(select count(*) from target),
 'by_dataset',(select jsonb_object_agg(dataset, n) from (select dataset, count(*) n from target group by 1) q),
 'audit_rows_written',(select count(*) from audited),'records_updated',(select count(*) from updated),
 'display_groups_updated',(select count(*) from grouped),'checked_at',now()) as receipt;
