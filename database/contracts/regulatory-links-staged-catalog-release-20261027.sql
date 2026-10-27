-- SUPERSEDED, DO NOT APPLY (2026-10-27): the same row was retired in production by
-- release/dataset-regulatory-links-staged-empty (database/contracts/release-dataset-regulatory-links-staged-empty-v1.sql,
-- ledger issue release20261027_retire_empty_staged_catalog), which also adds URL redirects. Use that branch's rollback.
-- This file's preflight refuses anyway: the catalog row is gone.
-- regulatory-links-staged-catalog-release/2026-10-27.1  (run 19a391c2-f6b8-4c10-8567-50e2ec054bea; workstream release/dataset-regulatory-links-staged)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What is "held" today (read-only survey 2026-10-27):
--   * public.corpus_datasets sw_matter_regulatory_links_v1_staged: ready = false, expected_records = imported_records = 0,
--     0 rows in public.corpus_records (it is the only thing that references it besides the ledger), row md5 4f60eb85ba4b4d5e6bac80ffd05b46cc,
--     updated_at 2026-10-03 19:59:42.529201+00. Label "... staged extension (not published)".
--   * Its metadata still advertises the staged rules for MDLs 2846, 2921, 3125, listing.total = 38, results.links = 38 and the
--     qualification "STAGED, not published". metadata.status already says the 38 links were flipped into
--     sw_matter_regulatory_links_v1 (contract sw-matter-regulatory-links-flip-staged-r6-20261003-v1.sql).
--   * The 38 links ARE published: sw_matter_regulatory_links_v1 is ready with 165 rows, of which MDL 2846 = 19, 2921 = 15,
--     3125 = 4 (= 38), every row labelled "Topical association - not MDL membership".
--   * Nothing else references the id: 0 rows in display groups, corpus_context, insights links/entities/families, semantic
--     chunks/corpora/refresh tables, docket links, cleanup plan/batches/counts/removal candidates, ingest.sources/runs; no
--     function, view or materialized view names it. The only references are 4 corpus_ingest.cleanup_decisions before-images
--     (issue dq20261003r6_regulatory_links_staged, run 2ebec9bb-...), which stay ("Must stay" in docs/corpus-audit.md).
--   * No repository builder creates this dataset (the staged/flip contracts lived in the wt-quality worktree).
--
-- Basis of the hold: caution only ("staged, not published" until the coordinator saw the per-matter report). There is no seal,
-- restriction or owner/admin hold. Nothing is withheld by it: it holds 0 rows. Its catalog entry (listed by
-- src/lib/external/catalog.functions.ts, which reads every corpus_datasets row) only implies 38 held links that are already public.
--
-- Action: remove the empty catalog row, with its full before-image in the ledger (exactly reversible). The published
-- sw_matter_regulatory_links_v1 is not touched. No record is released or changed: before = after = 165 published links.
--
-- Kept held: nothing. (The links' accuracy rules are unchanged: topical association only, never MDL membership.)
--
-- ROLLBACK: database/contracts/regulatory-links-staged-catalog-release-20261027.rollback.sql (restores the row byte-for-byte).
-- VERIFY:   database/contracts/verify-regulatory-links-staged-catalog-release-20261027.sql
--
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f, or paste whole into the SQL editor).

begin;
set local statement_timeout = '30s';

-- ===== statement 0: preflight (raises and aborts on any unexpected state) =====
do $$
declare
  v_md5 text; v_records bigint; v_pub_ready boolean; v_pub bigint; v_moved bigint;
begin
  select md5(to_jsonb(d)::text) into v_md5 from public.corpus_datasets d where d.id = 'sw_matter_regulatory_links_v1_staged';
  if v_md5 is null then
    raise exception 'PREFLIGHT: sw_matter_regulatory_links_v1_staged is not in the catalog (already removed?)';
  end if;
  if v_md5 <> '4f60eb85ba4b4d5e6bac80ffd05b46cc' then
    raise exception 'PREFLIGHT: the staged catalog row changed since the survey (md5 %); re-review', v_md5;
  end if;
  select count(*) into v_records from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1_staged';
  if v_records <> 0 then
    raise exception 'PREFLIGHT: the staged dataset holds % records; this contract only removes an empty catalog row', v_records;
  end if;
  select ready into v_pub_ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1';
  select count(*), count(*) filter (where filters->>'mdl' in ('2846', '2921', '3125'))
    into v_pub, v_moved from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1';
  if v_pub_ready is distinct from true or v_pub <> 165 or v_moved <> 38 then
    raise exception 'PREFLIGHT: published sw_matter_regulatory_links_v1 is not as surveyed (ready=%, rows=%, 2846/2921/3125 rows=%)',
      v_pub_ready, v_pub, v_moved;
  end if;
  if exists (select 1 from corpus_ingest.cleanup_decisions
              where dataset = 'public.corpus_datasets' and record_id = 'sw_matter_regulatory_links_v1_staged'
                and issue = 'release_20261027_drop_empty_staged_catalog') then
    raise exception 'PREFLIGHT: ledger row already present; this contract was applied before';
  end if;
end $$;

-- ===== statement 1: run row =====
insert into corpus_ingest.runs (id, contract_version, status, scope, counts, finished_at)
values ('19a391c2-f6b8-4c10-8567-50e2ec054bea'::uuid, 'regulatory-links-staged-catalog-release/2026-10-27.1', 'completed',
        jsonb_build_object('dataset', 'sw_matter_regulatory_links_v1_staged',
                           'owner_decision', '2026-10-27 dont withhold any data',
                           'action', 'remove empty caution-held catalog row; its 38 links are already in sw_matter_regulatory_links_v1'),
        jsonb_build_object('catalog_rows_removed', 1, 'records_released', 0, 'records_changed', 0,
                           'published_links_before', 165, 'published_links_after', 165),
        now());

-- ===== statement 2: ledger the full before-image (rollback restores from here) =====
insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
select 'public.corpus_datasets', d.id, 'release_20261027_drop_empty_staged_catalog', 'review',
       'Empty caution-held catalog row removed under the owner decision of 2026-10-27 ("dont withhold any data"). It held 0 records; '
       || 'its 38 staged links were flipped into sw_matter_regulatory_links_v1 on 2026-10-03 and are published there '
       || '(MDL 2846 = 19, 2921 = 15, 3125 = 4), labelled "Topical association - not MDL membership". Rollback re-inserts this before-image.',
       jsonb_build_object('row_md5', md5(to_jsonb(d)::text),
                          'records_in_dataset', 0,
                          'published_dataset', 'sw_matter_regulatory_links_v1',
                          'published_rows_by_mdl', jsonb_build_object('2846', 19, '2921', 15, '3125', 4),
                          'flip_contract', 'sw-matter-regulatory-links-flip-staged-r6-20261003-v1.sql',
                          'earlier_ledger', jsonb_build_object('issue', 'dq20261003r6_regulatory_links_staged',
                                                               'run_id', '2ebec9bb-4d02-4da4-9d66-637a2b9f35ef', 'rows', 4),
                          'contract', 'database/contracts/regulatory-links-staged-catalog-release-20261027.sql'),
       to_jsonb(d),
       jsonb_build_object('deleted', true),
       '19a391c2-f6b8-4c10-8567-50e2ec054bea'::uuid
  from public.corpus_datasets d
 where d.id = 'sw_matter_regulatory_links_v1_staged';

-- ===== statement 3: remove the empty catalog row =====
delete from public.corpus_datasets
 where id = 'sw_matter_regulatory_links_v1_staged'
   and md5(to_jsonb(corpus_datasets)::text) = '4f60eb85ba4b4d5e6bac80ffd05b46cc'
   and not exists (select 1 from public.corpus_records r where r.dataset = 'sw_matter_regulatory_links_v1_staged');

-- ===== statement 4: postflight =====
do $$
begin
  if exists (select 1 from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1_staged') then
    raise exception 'POSTFLIGHT: staged catalog row still present';
  end if;
  if (select md5(original_record::text) from corpus_ingest.cleanup_decisions
       where dataset = 'public.corpus_datasets' and record_id = 'sw_matter_regulatory_links_v1_staged'
         and issue = 'release_20261027_drop_empty_staged_catalog')
     is distinct from (select md5(to_jsonb(jsonb_populate_record(null::public.corpus_datasets, original_record))::text)
                         from corpus_ingest.cleanup_decisions
                        where dataset = 'public.corpus_datasets' and record_id = 'sw_matter_regulatory_links_v1_staged'
                          and issue = 'release_20261027_drop_empty_staged_catalog') then
    raise exception 'POSTFLIGHT: ledger before-image does not round-trip to a corpus_datasets row';
  end if;
  if (select count(*) from public.corpus_records where dataset = 'sw_matter_regulatory_links_v1') <> 165
     or (select ready from public.corpus_datasets where id = 'sw_matter_regulatory_links_v1') is distinct from true then
    raise exception 'POSTFLIGHT: published sw_matter_regulatory_links_v1 changed';
  end if;
  if (select count(*) from corpus_ingest.cleanup_decisions
       where dataset = 'sw_matter_regulatory_links_v1_staged' and issue = 'dq20261003r6_regulatory_links_staged') <> 4 then
    raise exception 'POSTFLIGHT: the 2026-10-03 staged before-images must stay (expected 4)';
  end if;
end $$;

commit;
