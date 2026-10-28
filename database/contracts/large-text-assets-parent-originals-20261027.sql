-- large-text-assets-parent-originals/2026-10-27.1  (run 5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815; workstream release/dataset-large-text-assets)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- Companion to large-text-assets-release-20261027.sql (review fix). 18 of the 33 official-publisher large_text_assets
-- rows have no stored extracted text, but their parent records in the ready datasets focused/seeger record a publisher
-- original (detail.original_url = /files/<hash>) whose object IS stored in corpus-originals at its catalogued size and
-- whose /files route is ready. The record page renders only detail.links, and these 18 parents have none, so the stored
-- originals were unreachable from the record. This contract adds one link per parent:
--   "Publisher's file as captured <saved date> (PDF, <size>)" -> /files/<hash>
-- The label carries the capture date because Maine (titles 5, 12) and North Carolina (chapter 58) have re-issued their
-- files since the capture; the stored copies are earlier official editions, not wrong data (review, live hashes
-- 2026-10-27). The Oregon ORS 1981 and Iowa ICV files matched the live publisher files byte for byte.
-- Selection (re-checked live): parent of a large_text_assets row with the same source_url, host not olls.info (held by
-- the statute source rule), detail.original_url route ready, object present with the catalogued size, and the link not
-- already present. Expected exactly 18 (legislature.maine.gov 6, legis.iowa.gov 8, uscode.house.gov 2,
-- oregonlegislature.gov 1, ncleg.gov 1).
-- Ledger: whole detail before-images in corpus_ingest.cleanup_decisions, issue release20261027_large_text_parent_originals.
-- Rollback: large-text-assets-parent-originals-20261027.rollback.sql.

begin;
set local statement_timeout = '60s';

do $$
declare v_n bigint;
begin
  if exists (select 1 from corpus_ingest.runs where id = '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815') then
    raise exception 'run 5b8e0d47 already recorded; run the rollback first' using errcode = '55000';
  end if;
  create temporary table _lta_parent_links on commit drop as
  select distinct p.dataset, p.id, p.detail, a.route,
         'Publisher''s file as captured ' || left(p.detail->>'saved_at', 10) || ' (PDF, '
           || to_char(round(a.bytes / 1048576.0, 1), 'FM999990.0') || ' MB)' as label
    from public.corpus_records l
    join public.corpus_records p on p.dataset in ('focused', 'seeger') and p.source_url = l.source_url
    join public.corpus_artifacts a on a.route = p.detail->>'original_url' and a.ready and a.route like '/files/%'
    join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key and (o.metadata->>'size') = a.bytes::text
   where l.dataset = 'large_text_assets'
     and substring(l.source_url from '^https?://([^/]+)') <> 'olls.info'
     and p.detail->>'saved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and not exists (select 1 from jsonb_array_elements(coalesce(p.detail->'links', '[]'::jsonb)) x where x->>'url' = a.route);
  select count(*) into v_n from _lta_parent_links;
  if v_n <> 18 then raise exception 'expected 18 parent records to link, found %', v_n using errcode = '55000'; end if;
end $$;

insert into corpus_ingest.runs (id, contract_version, status, scope, counts, finished_at)
values ('5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815'::uuid, 'large-text-assets-parent-originals/2026-10-27.1', 'completed',
        jsonb_build_object('datasets', jsonb_build_array('focused', 'seeger'), 'owner_decision', '2026-10-27 dont withhold any data',
                           'branch', 'release/dataset-large-text-assets'),
        jsonb_build_object('parent_links_added', 18), now());

insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
select t.dataset, t.id, 'release20261027_large_text_parent_originals', 'label_override',
       'Link the stored, ready publisher original on the record page (owner decision 2026-10-27).',
       jsonb_build_object('route', t.route, 'label', t.label),
       jsonb_build_object('detail', t.detail),
       jsonb_build_object('added_link', jsonb_build_object('url', t.route, 'label', t.label)),
       '5b8e0d47-2c19-4f6a-b3d1-9e7a42c0f815'::uuid
  from _lta_parent_links t;

update public.corpus_records r
   set detail = jsonb_set(r.detail, '{links}',
                  coalesce(r.detail->'links', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('url', t.route, 'label', t.label)))
  from _lta_parent_links t
 where r.dataset = t.dataset and r.id = t.id;

do $$
begin
  if (select count(*) from public.corpus_records r join _lta_parent_links t on t.dataset = r.dataset and t.id = r.id
       where exists (select 1 from jsonb_array_elements(r.detail->'links') x where x->>'url' = t.route)) <> 18 then
    raise exception 'postflight: 18 parent links expected' using errcode = '55000';
  end if;
  if (select count(*) from corpus_ingest.cleanup_decisions where issue = 'release20261027_large_text_parent_originals') <> 18 then
    raise exception 'postflight: 18 ledger rows expected' using errcode = '55000';
  end if;
end $$;

commit;
