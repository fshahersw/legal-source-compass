-- Removal: Oct 7 scratch objects from the TX/VT state-code reconciliation (task 6248) and the
-- finished one-off documents build job. Ledger: docs/corpus-cleanup-2026-10-28.md.
-- Checks before removal: no repo references, no dependent views, no calling functions, no cron
-- references, no primary key, no writes since 2026-10-07. The guard below refuses to run if the
-- row counts differ from the ledger.
begin;

do $g$
declare n_tx bigint; n_vt bigint;
begin
  select count(*) into n_tx from corpus_ingest.tx_corpus_paths_6248;
  select count(*) into n_vt from corpus_ingest.vt_section_hash_before_6248;
  if n_tx <> 121902 or n_vt <> 26263 then
    raise exception 'Row counts changed (tx %, vt %); re-check before dropping', n_tx, n_vt;
  end if;
  if exists (select 1 from pg_proc where prosrc ~ 'corpus_export_tx_paths_6248' and proname <> 'corpus_export_tx_paths_6248') then
    raise exception 'corpus_export_tx_paths_6248 has callers';
  end if;
end $g$;

drop function if exists public.corpus_export_tx_paths_6248(integer, integer);
drop function if exists corpus_ingest.corpus_export_tx_paths_6248(integer, integer);
drop table corpus_ingest.tx_corpus_paths_6248;
drop table corpus_ingest.vt_section_hash_before_6248;

select cron.unschedule('release-docs-ef-build')
where exists (select 1 from cron.job where jobname = 'release-docs-ef-build');

commit;
