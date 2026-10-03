-- html-entity-title-decode/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Titles that still carry markup entities from the XML/HTML capture: "FD&amp;C Blue No. 1.", "Debtor&#039;s Statement".
-- Rule (deterministic, single pass, &amp; decoded last so &amp;lt; becomes &lt; and is never decoded twice):
--   &#039; &#39; &#x27; &apos; -> '   &quot; -> "   &lt; -> <   &gt; -> >   then &amp; -> &
-- Scope: federal_regulations_sections (122 rows) and url_directory (9 rows).
-- NOT changed: ecfr_hierarchy (native projection reconciled by full-field SHA; the entity is also inside text -> decode at display),
--              openFDA / CPSC text (entities are inside FDA/CPSC label narratives).
-- The exact old title string is replaced wherever it occurs as a whole JSON string value in item/detail (item.heading,
-- detail.heading, title); item.title for CFR rows is the numeric CFR title number and is untouched. text, source_url,
-- category, state, filters, ordinal untouched; search_vector is recomputed by the existing trigger.
-- Reversible exactly: audit row stores the complete original item and detail JSON and the whole-row md5.
--
-- ROLLBACK (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.issue='dq20261003_html_entity_title' and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b')
--   update public.corpus_records r set title = a.o->>'title', item = a.o->'item', detail = a.o->'detail'
--     from a where r.dataset=a.dataset and r.id=a.record_id;
with target as materialized (
 select r.dataset, r.id, r.ordinal, r.title as old_title,
        replace(replace(replace(replace(replace(replace(replace(replace(r.title,'&#039;',''''),'&#39;',''''),'&#x27;',''''),'&apos;',''''),'&quot;','"'),'&lt;','<'),'&gt;','>'),'&amp;','&') as new_title,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail, r.source_url
 from public.corpus_records r
 where r.dataset in ('federal_regulations_sections','url_directory')
   and r.title ~ '&(amp|lt|gt|quot|apos|#0?39|#x27);'),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003_html_entity_title', 'label_override',
  'Title carried undecoded markup entities from the XML/HTML capture. Entities decoded once; no wording changed; text and source URL untouched.',
  jsonb_build_object('review_version','html-entity-title-decode/2026-10-03.1','rule','decode &#039; &#39; &#x27; &apos; &quot; &lt; &gt; then &amp; (last)','source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,'row_md5',t.row_md5),
  jsonb_build_object('title',t.new_title),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t where t.new_title <> t.old_title
 on conflict (dataset,record_id,issue) do nothing
 returning record_id, dataset),
audit_ok as (
 select record_id, dataset from audited
 union
 select c.record_id, c.dataset from corpus_ingest.cleanup_decisions c join target t on c.dataset = t.dataset and c.record_id = t.id
  where c.issue = 'dq20261003_html_entity_title' and c.original_record->>'row_md5' = t.row_md5),
updated as (
 update public.corpus_records r
    set title = t.new_title,
        item = replace(t.old_item::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb,
        detail = replace(t.old_detail::text, to_jsonb(t.old_title)::text, to_jsonb(t.new_title)::text)::jsonb
   from target t join audit_ok a on a.record_id = t.id and a.dataset = t.dataset
  where r.dataset = t.dataset and r.id = t.id and t.new_title <> t.old_title and md5(to_jsonb(r)::text) = t.row_md5
  returning r.dataset, r.id)
select jsonb_build_object('contract','html-entity-title-decode/2026-10-03.1','targets',(select count(*) from target),
 'by_dataset',(select jsonb_object_agg(dataset, n) from (select dataset, count(*) n from target group by 1) q),
 'audit_rows_written',(select count(*) from audited),'records_updated',(select count(*) from updated),'checked_at',now()) as receipt;
