-- litigation-title-defects/2026-10-03.r2.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- Work item C. Profile of mdls, mdl_case_inventory, mdl_docket_activity, mdl_docket_documents, court_documents, cl_master_entries,
-- cl_docket_metadata, saved_pages (356,000+ rows) for empty titles, raw ids, truncation markers, entity / markdown artifacts, duplicated
-- prefixes and edge whitespace.  Result: 0 empty, 0 raw-id, 0 entity-encoded titles; mdls, mdl_case_inventory, mdl_docket_activity,
-- mdl_docket_documents, cl_master_entries and cl_docket_metadata have none of the defect classes at all.
-- Deterministic, source-faithful fixes (12 rows):
--   dot_leader  : trailing run of 4+ dots (PDF form fill-in leader, "Court File No. ........") removed            (court_documents, 6 rows)
--   edge_ws     : leading/trailing whitespace trimmed                                                              (saved_pages, 3 rows)
--   dup_segment : an adjacent exact repeat of a title segment ("A | A | B" -> "A | B", "A - A" -> "A") collapsed (saved_pages, 3 rows)
-- Everything else found is a JUDGMENT item and is NOT touched (see docs/data-quality-round2-2026-10-03.md, section 4):
--   '(untitled)' x1,578 saved_pages; U+FFFD / control characters (court_documents 3, saved_pages 43); body text captured as title;
--   trailing '**' footnote marks; Markdown links in NELIS listing titles; titles cut at the source ("... | United States Department ");
--   non-distinguishing generated titles (mdl_docket_documents 5,016 rows / 17 titles; cl_master_entries 'Docket entry N'; cl_docket_metadata).
-- Mechanics = markdown / html / lone-marker passes: old title replaced only where it is a COMPLETE JSON string in item/detail, display
-- group title updated when it equals the collapsed old title, search_vector recomputed by the existing trigger, original item/detail JSON
-- and whole-row md5 stored; text, source_url, filters unchanged.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact):
--   with a as (select c.dataset, c.record_id, c.original_record o from corpus_ingest.cleanup_decisions c
--               where c.issue='dq20261003r2_litigation_title_defect' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'),
--   rev as (update public.corpus_records r set title = a.o->>'title', item = a.o->'item', detail = a.o->'detail'
--             from a where r.dataset=a.dataset and r.id=a.record_id returning r.id)
--   update public.corpus_display_groups g set metadata = jsonb_set(g.metadata,'{title}',to_jsonb(a.o->>'display_group_title'))
--     from a where g.id = a.o->>'display_group_id' and a.o->>'display_group_id' is not null;
--
-- ===== statement 1: audit (before-images) =====
with cand as (
 select r.dataset, r.id, r.ordinal, r.title as old_title, r.item as old_item, r.detail as old_detail, r.source_url,
        r.filters->>'display_id' as display_id, md5(to_jsonb(r)::text) as row_md5,
        case when r.title ~ '\s*\.{4,}\s*$' then 'dot_leader'
             when r.title is distinct from regexp_replace(r.title, '^\s+|\s+$', '', 'g') then 'edge_ws'
             when r.title ~ '^([^|]{4,}?) ?[|] ?\1( ?[|].*)?$' then 'dup_segment_pipe'
             when r.title ~ '^(.{4,}?) - \1( - .*)?$' then 'dup_segment_dash' end as rule
 from public.corpus_records r
 where r.dataset in ('mdls','mdl_case_inventory','mdl_docket_activity','mdl_docket_documents','court_documents','cl_master_entries','cl_docket_metadata','saved_pages')),
target as materialized (
 select c.*,
        case c.rule
          when 'dot_leader' then regexp_replace(c.old_title, '\s*\.{4,}\s*$', '')
          when 'edge_ws' then regexp_replace(c.old_title, '^\s+|\s+$', '', 'g')
          when 'dup_segment_pipe' then (select string_agg(seg, ' | ' order by ord) from (
               select seg, ord, lag(seg) over (order by ord) prev from unnest(string_to_array(c.old_title, ' | ')) with ordinality t(seg, ord)) q where seg is distinct from prev)
          when 'dup_segment_dash' then regexp_replace(c.old_title, '^(.{4,}?) - \1( - .*)?$', '\1\2')
        end as new_title
 from cand c where c.rule is not null),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select t.dataset, t.id, 'dq20261003r2_litigation_title_defect', 'label_override',
  'Title carried a mechanical artifact of capture (PDF dot leader, edge whitespace or an exactly repeated segment). Only the artifact is removed; wording unchanged; text and source URL untouched.',
  jsonb_build_object('review_version','litigation-title-defects/2026-10-03.r2.1','rule',t.rule,'source_url',t.source_url),
  jsonb_build_object('dataset',t.dataset,'id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,
                     'row_md5',t.row_md5,'display_group_id',t.display_id,
                     'display_group_title',(select g.metadata->>'title' from public.corpus_display_groups g where g.id = t.display_id)),
  jsonb_build_object('title',t.new_title),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
 from target t where t.new_title is not null and t.new_title <> '' and t.new_title <> t.old_title
 on conflict (dataset,record_id,issue) do nothing
 returning record_id, dataset)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written,
       (select jsonb_object_agg(rule, n) from (select rule, count(*) n from target group by 1) q) by_rule,
       (select string_agg(rule || ': [' || old_title || '] -> [' || new_title || ']', E'\n') from target) preview;

-- ===== statement 2: apply from the audited before-images =====
with u as (
 update public.corpus_records r
    set title  = c.replacement->>'title',
        item   = replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb,
        detail = replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb
   from corpus_ingest.cleanup_decisions c
  where c.issue = 'dq20261003r2_litigation_title_defect' and c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
    and r.dataset = c.dataset and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
  returning r.dataset, r.id, c.original_record->>'display_group_id' as display_id, c.original_record->>'title' as old_title, c.replacement->>'title' as new_title),
g as (
 update public.corpus_display_groups g
    set metadata = jsonb_set(g.metadata, '{title}', to_jsonb(u.new_title))
   from u
  where u.display_id is not null and g.id = u.display_id and g.metadata->>'title' = regexp_replace(btrim(u.old_title), '\s+', ' ', 'g')
  returning g.id)
select (select count(*) from u) records_updated, (select count(*) from g) display_groups_updated;
