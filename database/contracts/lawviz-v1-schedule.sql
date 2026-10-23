-- lawviz/1 nightly refresh (pg_cron). Apply after database/contracts/lawviz-v1.sql; kept apart from the contract file
-- because the offline PGlite contract test has no scheduler.
--
-- 23:47 UTC every day, after the day's scheduled ingests (Federal Register 14:23 and 21:23 UTC on weekdays, openFDA
-- enforcement 09:41–10:29, CPSC recalls 15:52, FTC early terminations 16:11): the enforcement calendar and the other
-- three families are rebuilt from the corpus as it stands. The four families together take about a minute; each one
-- replaces only its own rows, in one transaction, so a failed family keeps its previous rows. The build id is the date
-- ('nYYYYMMDD'). Re-running this file replaces the job.
select cron.schedule('lawviz-nightly', '47 23 * * *', $cmd$
set statement_timeout = 0;
select public.lawviz_refresh_v1('n' || to_char(now() at time zone 'utc', 'YYYYMMDD'), 'all');
$cmd$);
