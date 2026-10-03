-- nj-statute-title-dedupe/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Dataset seeger, kind statutory_provision, New Jersey: the stored title repeats the citation because the published
-- heading line itself starts with it:  "2A:4-30.124 — 2A:4-30.124  Short title."  (the 839 federal rows in the same
-- dataset already use the house form "9 U.S.C. § 1 — Heading").
-- Rule (deterministic, source-derived):  ^(\S+) — \1\.?\s+(\S.*)$  ->  \1 — \2,  then collapse whitespace.
-- Proof guards in the statement: whitespace-collapsed old title == whitespace-collapsed first line of the record's own
-- text; item.title and detail.title equal the old title; md5 of the whole row must still match when the UPDATE runs.
-- Fields changed: corpus_records.title, item->title, detail->title (search_vector is recomputed by the existing trigger),
-- and corpus_display_groups.metadata->title (a collapsed copy of the old title, one group per record).
-- text, source_url, category, state, filters, ordinal and every other field are untouched. 5,856 records (ordinal 52449-58304).
-- Run in ordinal windows of <= 1,000 rows by substituting :lo / :hi.
--
-- ROLLBACK for a window (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.dataset='seeger' and c.issue='dq20261003_nj_statute_citation_prefix'
--                 and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b'
--                 and (c.original_record->>'ordinal')::bigint >= :lo and (c.original_record->>'ordinal')::bigint < :hi),
--   rev as (update public.corpus_records r set title = a.o->>'title',
--                  item = jsonb_set(r.item,'{title}',a.o->'item_title'), detail = jsonb_set(r.detail,'{title}',a.o->'detail_title')
--             from a where r.dataset=a.dataset and r.id=a.record_id returning r.id)
--   update public.corpus_display_groups g set metadata = jsonb_set(g.metadata,'{title}',to_jsonb(a.o->>'display_group_title'))
--     from a where g.id = a.o->>'display_group_id';
with target as materialized (
 select r.dataset, r.id, r.ordinal, r.title as old_title,
        regexp_replace(regexp_replace(btrim(r.title), '^(\S+) — \1\.?\s+(\S.*)$', '\1 — \2'), '\s+', ' ', 'g') as new_title,
        md5(to_jsonb(r)::text) as row_md5,
        r.filters->>'display_id' as display_id,
        r.source_url
 from public.corpus_records r
 where r.dataset = 'seeger' and r.ordinal >= :lo and r.ordinal < :hi
   and r.item->>'kind' = 'statutory_provision'
   and r.title ~ '^(\S+) — \1\.?\s+\S'
   and regexp_replace(btrim(r.title), '\s+', ' ', 'g') = regexp_replace(btrim(split_part(r.text, E'\n', 1)), '\s+', ' ', 'g')
   and r.item->>'title' = r.title and r.detail->>'title' = r.title),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003_nj_statute_citation_prefix', 'label_override',
  'The published NJ heading line already begins with the citation, so the stored title repeated it. Title is now citation — heading text with whitespace collapsed; record text, source URL and all other fields are unchanged.',
  jsonb_build_object('review_version','nj-statute-title-dedupe/2026-10-03.1','rule','^(\S+) — \1\.?\s+(\S.*)$ -> \1 — \2; collapse whitespace',
                     'proof','collapsed old title equals collapsed first line of the record text; item.title and detail.title equal title','source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item_title',t.old_title,'detail_title',t.old_title,
                     'row_md5',t.row_md5,'display_group_id',t.display_id,
                     'display_group_title',(select g.metadata->>'title' from public.corpus_display_groups g where g.id = t.display_id)),
  jsonb_build_object('title',t.new_title,'item_title',t.new_title,'detail_title',t.new_title,'display_group_title',t.new_title),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t where t.new_title <> t.old_title
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
audit_ok as (
 select record_id from audited
 union
 select c.record_id from corpus_ingest.cleanup_decisions c join target t on c.dataset = t.dataset and c.record_id = t.id
  where c.issue = 'dq20261003_nj_statute_citation_prefix' and c.original_record->>'row_md5' = t.row_md5),
updated as (
 update public.corpus_records r
    set title = t.new_title,
        item = jsonb_set(r.item, '{title}', to_jsonb(t.new_title)),
        detail = jsonb_set(r.detail, '{title}', to_jsonb(t.new_title))
   from target t join audit_ok a on a.record_id = t.id
  where r.dataset = t.dataset and r.id = t.id and t.new_title <> t.old_title and md5(to_jsonb(r)::text) = t.row_md5
  returning r.id, t.display_id, t.old_title, t.new_title),
grouped as (
 update public.corpus_display_groups g
    set metadata = jsonb_set(g.metadata, '{title}', to_jsonb(u.new_title))
   from updated u
  where g.id = u.display_id and g.metadata->>'title' = regexp_replace(btrim(u.old_title), '\s+', ' ', 'g')
  returning g.id)
select jsonb_build_object('contract','nj-statute-title-dedupe/2026-10-03.1','window',jsonb_build_array(:lo,:hi),
 'targets',(select count(*) from target),'audit_rows_written',(select count(*) from audited),
 'records_updated',(select count(*) from updated),'display_groups_updated',(select count(*) from grouped),'checked_at',now()) as receipt;
