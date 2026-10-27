-- Rollback of held-artifact-release/2026-10-27.1 (database/contracts/release-held-artifacts-20261027.sql).
-- Exact before-image: every route the release flipped is in corpus_ingest.held_artifact_release_20261027 with
-- decision = 'released' and ready_before = false. This sets exactly those routes back to ready = false and drops the ledger,
-- which returns public.corpus_artifacts and corpus_ingest to the pre-release state. No object in storage is touched.
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f).

begin;
set local statement_timeout = '300s';

do $$
declare v_ledger bigint; v_released bigint; v_ready bigint;
begin
  if to_regclass('corpus_ingest.held_artifact_release_20261027') is null then
    raise exception 'Ledger corpus_ingest.held_artifact_release_20261027 not found: nothing to roll back' using errcode = '55000';
  end if;
  select count(*), count(*) filter (where decision = 'released') into v_ledger, v_released
    from corpus_ingest.held_artifact_release_20261027;
  if v_ledger <> 27722 or v_released <> 27652 then
    raise exception 'Ledger is not the one this release wrote (rows %, released %)', v_ledger, v_released using errcode = '55000';
  end if;
  if exists (select 1 from corpus_ingest.held_artifact_release_20261027 where ready_before is distinct from false) then
    raise exception 'Ledger records a route that was ready before the release' using errcode = '55000';
  end if;
  select count(*) into v_ready from public.corpus_artifacts a
    join corpus_ingest.held_artifact_release_20261027 l on l.route = a.route and l.decision = 'released' where a.ready;
  raise notice 'Routes still ready from this release: % of %', v_ready, v_released;
end $$;

update public.corpus_artifacts a set ready = false
from corpus_ingest.held_artifact_release_20261027 l
where l.route = a.route and l.decision = 'released' and l.ready_before = false and a.ready = true;

do $$
begin
  if exists (select 1 from public.corpus_artifacts a
             join corpus_ingest.held_artifact_release_20261027 l on l.route = a.route
             where a.ready) then
    raise exception 'A ledger route is still ready after rollback' using errcode = '55000';
  end if;
end $$;

drop table corpus_ingest.held_artifact_release_20261027;

commit;

select split_part(route, '/', 2) as top, ready, count(*) from public.corpus_artifacts group by 1, 2 order by 1, 2;
