-- documents/1 nightly refresh (pg_cron). Apply after database/contracts/documents-v1.sql; kept apart from the contract file
-- because the offline PGlite contract test has no scheduler.
--
-- Every night: documents_refresh_v1 (eligible documents and their published metadata), documents_build_pages_v1 until no
-- byte set is pending (display rule, page tsvector, ECF header), then documents_refresh_v1 again (folds ECF dates in).
-- New filings become searchable and listed on court, judge and MDL pages without a manual run. Citation extraction and
-- links (scripts/documents/run_pipeline.py extract | load, then resolve and link) stay a deliberate run: the extractor is
-- Python outside the database, so a new filing is searchable before its citations are linked.
--
-- The build id is the date ('nYYYYMMDD'). The loop stops when nothing is pending or a pass indexes nothing (pending byte sets
-- whose stored text is missing stay pending and are reported by documents_status_v1). Re-running this file replaces the job.
select cron.schedule('documents-nightly', '41 5 * * *', $cmd$
set statement_timeout = 0;
do $nightly$
declare
  b text := 'n' || to_char(now() at time zone 'utc', 'YYYYMMDD');
  r jsonb;
begin
  perform public.documents_refresh_v1(b);
  loop
    r := public.documents_build_pages_v1(b, 500);
    exit when coalesce((r ->> 'remaining')::integer, 0) = 0
           or coalesce((r ->> 'indexed')::integer, 0) + coalesce((r ->> 'withheld')::integer, 0) = 0;
  end loop;
  perform public.documents_refresh_v1(b);
end $nightly$;
$cmd$);
