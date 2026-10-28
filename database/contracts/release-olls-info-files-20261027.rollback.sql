-- Rollback of release-olls-info-files-20261027.sql: the 48 olls.info routes go back to ready = false and to the
-- ledger decision 'held:statute_publisher_unconfirmed'. Run as one transaction.
begin;

do $$
declare v_n bigint;
begin
  select count(*) into v_n
  from corpus_ingest.held_artifact_release_20261027 l
  join public.corpus_artifacts a on a.route = l.route and a.ready
  where l.decision = 'released' and l.ready_before = false and 'olls.info' = any (l.provenance_hosts);
  if v_n <> 48 then raise exception 'Expected 48 released olls.info routes, found %', v_n using errcode = '55000'; end if;
end $$;

update public.corpus_artifacts a set ready = false
from corpus_ingest.held_artifact_release_20261027 l
where l.route = a.route and l.decision = 'released' and l.ready_before = false
  and 'olls.info' = any (l.provenance_hosts) and a.ready = true;

update corpus_ingest.held_artifact_release_20261027 l set decision = 'held:statute_publisher_unconfirmed'
where l.decision = 'released' and l.ready_before = false and 'olls.info' = any (l.provenance_hosts);

commit;
