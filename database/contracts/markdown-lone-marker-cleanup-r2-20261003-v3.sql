-- markdown-lone-marker-cleanup/2026-10-03.3  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- Orchestrator follow-up: two seeger titles still began with '**' (***Click Here for E-Filing Instructions and
-- ***Click Here for Federal Attorney Registration Instructions: an opening bold-italic marker whose closing half was lost in capture;
-- the same two titles exist in docsupload_coverage).
-- Rules (deterministic, marker removal only, no wording change):
--   lead_run       : ^\*{2,4}[^*]+$                       -> btrim(ltrim(title,'*'))
--   balanced_inner : every '*' belongs to a '**x**' pair, no backslash/newline -> '**x**' replaced by 'x'
-- Scope: seeger, url_directory, docsupload_coverage, court_forms_expansion_20260912, court_documents (13 rows).
-- Left as captured (judgment): trailing-only '**' (could be a real footnote mark), a lone inner '**', mixed '***UPDATE***text',
-- and 16 url_directory page snippets that contain literal backslash-newline sequences.
-- Same mechanics as the v1/v2 contracts: exact old title replaced in item/detail, display group title when equal to the collapsed old
-- title, search_vector recomputed by the existing trigger, full original item/detail JSON and whole-row md5 stored.
--
-- ROLLBACK (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.issue='dq20261003r2_markdown_lone_marker' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'),
--   rev as (update public.corpus_records r set title = a.o->>'title', item = a.o->'item', detail = a.o->'detail'
--             from a where r.dataset=a.dataset and r.id=a.record_id returning r.id)
--   update public.corpus_display_groups g set metadata = jsonb_set(g.metadata,'{title}',to_jsonb(a.o->>'display_group_title'))
--     from a where g.id = a.o->>'display_group_id' and a.o->>'display_group_id' is not null;
with target as materialized (
 select r.dataset, r.id, r.ordinal, r.title as old_title,
        case when r.title ~ '^\*{2,4}[^*]+$' then btrim(ltrim(r.title, '*'))
             else btrim(regexp_replace(r.title, '\*\*([^*]+)\*\*', '\1', 'g')) end as new_title,
        case when r.title ~ '^\*{2,4}[^*]+$' then 'lead_run' else 'balanced_inner' end as rule,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail, r.filters->>'display_id' as display_id, r.source_url
 from public.corpus_records r
 where r.dataset in ('seeger','url_directory','docsupload_coverage','court_forms_expansion_20260912','court_documents')
   and r.title ~ '\*\*' and r.title !~ '[\\\n\r]'
   and (r.title ~ '^\*{2,4}[^*]+$' or (r.title ~ '\*\*[^*]+\*\*' and regexp_replace(r.title, '\*\*[^*]+\*\*', '', 'g') !~ '\*'))),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003r2_markdown_lone_marker', 'label_override',
  'Title carried Markdown bold markers from the page-to-Markdown capture (a lone opening marker run or balanced **x** pairs). Markers removed; wording unchanged; text and source URL untouched.',
  jsonb_build_object('review_version','markdown-lone-marker-cleanup/2026-10-03.3','rule',t.rule,'source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,
                     'row_md5',t.row_md5,'display_group_id',t.display_id,
                     'display_group_title',(select g.metadata->>'title' from public.corpus_display_groups g where g.id = t.display_id)),
  jsonb_build_object('title',t.new_title),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
 from target t where t.new_title <> t.old_title and t.new_title !~ '\*' and t.new_title <> ''
 on conflict (dataset,record_id,issue) do nothing
 returning record_id, dataset),
audit_ok as (
 select record_id, dataset from audited
 union
 select c.record_id, c.dataset from corpus_ingest.cleanup_decisions c join target t on c.dataset = t.dataset and c.record_id = t.id
  where c.issue = 'dq20261003r2_markdown_lone_marker' and c.original_record->>'row_md5' = t.row_md5),
updated as (
 update public.corpus_records r
    set title = t.new_title,
        item = replace(t.old_item::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb,
        detail = replace(t.old_detail::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb
   from target t join audit_ok a on a.record_id = t.id and a.dataset = t.dataset
  where r.dataset = t.dataset and r.id = t.id and t.new_title <> t.old_title and t.new_title !~ '\*' and t.new_title <> '' and md5(to_jsonb(r)::text) = t.row_md5
  returning r.dataset, r.id, t.display_id, t.old_title, t.new_title),
grouped as (
 update public.corpus_display_groups g
    set metadata = jsonb_set(g.metadata, '{title}', to_jsonb(u.new_title))
   from updated u
  where u.display_id is not null and g.id = u.display_id and g.metadata->>'title' = regexp_replace(btrim(u.old_title), '\s+', ' ', 'g')
  returning g.id)
select jsonb_build_object('contract','markdown-lone-marker-cleanup/2026-10-03.3','targets',(select count(*) from target),
 'by_rule',(select jsonb_object_agg(rule, n) from (select rule, count(*) n from target group by 1) q),
 'audit_rows_written',(select count(*) from audited),'records_updated',(select count(*) from updated),
 'display_groups_updated',(select count(*) from grouped),'checked_at',now()) as receipt;
