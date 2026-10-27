-- release/dataset-regulatory-links-staged-empty v1 (2026-10-27): retire the empty catalog row public.corpus_datasets
-- 'sw_matter_regulatory_links_v1_staged'. NOTHING IS WITHHELD BY OR RELEASED BY THIS FILE: the row holds 0 records.
--
-- Why it is empty: on 2026-10-03 its 38 links (MDL 2846: 19, 2921: 15, 3125: 4; reviewed 38/38) were moved, ids unchanged,
-- into the published sw_matter_regulatory_links_v1 (ready=true, 165 rows; contract sw-matter-regulatory-links-flip-staged-r6-20261003-v1.sql,
-- ledger issue dq20261003r6_regulatory_links_flip). The staged row stayed behind with ready=false and the label
-- "staged extension (not published)", so catalogs and audits list it as a held collection although it holds nothing.
-- Under the owner decision of 2026-10-27 ("dont withhold any data") a caution-style "Held" shell is noise; it is retired,
-- ledgered and reversible (owner decisions 2026-10-05/06: removals ledgered, reversible and in the audit reports).
--
-- What this does, in one transaction, only when every guard passes:
--   1 opens a corpus_ingest.runs row for this release (closed as completed at the end);
--   2 archives the full catalog row (label, metadata incl. rules, review and the per-matter funnels) into corpus_ingest.cleanup_decisions,
--     dataset 'public.corpus_datasets', record_id 'sw_matter_regulatory_links_v1_staged', issue 'release20261027_retire_empty_staged_catalog';
--   3 deletes the catalog row.
-- It does not touch corpus_records, the live sw_matter_regulatory_links_v1 row, the 2026-10-03 before-images or any other dataset.
-- The site redirects /data/sw_matter_regulatory_links_v1_staged and /records/sw_matter_regulatory_links_v1_staged/<id> to the live
-- collection (src/lib/external/groups.ts datasetSuccessor), so former URLs keep working.
-- Rollback: release-dataset-regulatory-links-staged-empty-v1.rollback.sql. Checks: release-dataset-regulatory-links-staged-empty-v1.verify.sql.

begin;
set local statement_timeout = '30s';

do $$
declare
  v_id constant text := 'sw_matter_regulatory_links_v1_staged';
  v_live constant text := 'sw_matter_regulatory_links_v1';
  v_issue constant text := 'release20261027_retire_empty_staged_catalog';
  v_md5 constant text := '4f60eb85ba4b4d5e6bac80ffd05b46cc'; -- md5(to_jsonb(row)::text) read 2026-10-27 in the dry run
  d public.corpus_datasets;
  run uuid := gen_random_uuid();
  n bigint;
begin
  select * into d from public.corpus_datasets where id = v_id for update;
  if not found then
    raise notice '% is already retired; nothing to do', v_id;
    return;
  end if;

  -- guards: the row must still be exactly the empty shell that was reviewed
  if md5(to_jsonb(d)::text) <> v_md5 then
    raise exception 'catalog row % changed since the dry run (md5 %); re-run the dry run before retiring', v_id, md5(to_jsonb(d)::text) using errcode = '22023';
  end if;
  if d.ready or coalesce(d.imported_records, 0) <> 0 then
    raise exception '% is ready=% with imported_records=%; only an empty unpublished shell is retired', v_id, d.ready, d.imported_records using errcode = '22023';
  end if;
  select count(*) into n from public.corpus_records where dataset = v_id;
  if n <> 0 then raise exception '% still has % records; nothing is retired', v_id, n using errcode = '22023'; end if;
  select count(*) into n from public.corpus_records where dataset = v_live and id ~ '^sw-reg:(2846|2921|3125):';
  if n <> 38 then raise exception 'expected the 38 moved links in %, found %', v_live, n using errcode = '22023'; end if;
  if not exists (select 1 from public.corpus_datasets where id = v_live and ready) then
    raise exception 'successor % is not published', v_live using errcode = '22023';
  end if;
  if exists (select 1 from public.corpus_context c where c.key like '%' || v_id || '%')
     or exists (select 1 from public.corpus_artifacts a where a.route like '%' || v_id || '%')
     or exists (select 1 from public.corpus_display_groups g where g.metadata::text like '%' || v_id || '%')
     or exists (select 1 from public.corpus_datasets o where o.id <> v_id and o.metadata::text like '%' || v_id || '%')
     or exists (select 1 from corpus_ingest.runs ru where ru.status in ('running','partial') and ru.scope::text like '%' || v_id || '%') then
    raise exception '% is still referenced (context, artifact, display group, other catalog row or open run)', v_id using errcode = '22023';
  end if;

  insert into corpus_ingest.runs(id, status, scope)
  values (run, 'running', jsonb_build_object(
    'contract', 'release/dataset-regulatory-links-staged-empty/1',
    'purpose', 'retire the empty catalog row ' || v_id || '; its 38 links live in ' || v_live,
    'owner_instruction', '2026-10-27: dont withhold any data. If its accurate and valuable, USE IT',
    'file', 'database/contracts/release-dataset-regulatory-links-staged-empty-v1.sql'));

  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  values ('public.corpus_datasets', v_id, v_issue, 'quarantine',
    'Empty catalog row retired: 0 records, ready=false. Its 38 reviewed links (MDL 2846, 2921, 3125) were moved, ids unchanged, into the published '
      || v_live || ' on 2026-10-03, so the row only showed a "held, not published" collection that holds nothing. Rollback restores it from original_record.',
    jsonb_build_object('row_md5', v_md5, 'records', 0, 'successor', v_live, 'moved_links', 38,
      'moved_by', 'sw-matter-regulatory-links-flip-staged-r6-20261003-v1.sql (ledger issue dq20261003r6_regulatory_links_flip)',
      'owner_decision', '2026-10-27 dont withhold any data',
      'rollback', 'database/contracts/release-dataset-regulatory-links-staged-empty-v1.rollback.sql'),
    to_jsonb(d),
    jsonb_build_object('deleted', true, 'redirect_to', v_live),
    run)
  on conflict (dataset, record_id, issue) do update
    set reason = excluded.reason, evidence = excluded.evidence, original_record = excluded.original_record,
        replacement = excluded.replacement, run_id = excluded.run_id, reviewed_at = now();

  delete from public.corpus_datasets where id = v_id;

  update corpus_ingest.runs set status = 'completed', finished_at = now(),
         counts = jsonb_build_object('catalog_rows_deleted', 1, 'records_deleted', 0, 'ledger_rows', 1)
   where id = run;
  raise notice 'retired % (run %)', v_id, run;
end $$;

commit;
