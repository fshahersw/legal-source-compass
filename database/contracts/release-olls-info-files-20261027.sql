-- olls-info-files-release/2026-10-27.2  (follow-up to held-artifact-release/2026-10-27.1)
-- Owner confirmation 2026-10-27: olls.info is the Colorado General Assembly's Office of Legislative Legal Services
-- distribution host (the OLLS page "2026 CRS Titles for Download" links every title there), and the owner has filed the
-- section 2-5-118 C.R.S. statement with the Committee on Legal Services. The 48 stored Colorado Revised Statutes
-- title files (195,902,790 bytes) that held-artifact-release/2026-10-27.1 kept with decision
-- 'held:statute_publisher_unconfirmed' are released: public.corpus_artifacts.ready = true, ledger decision = 'released'.
-- Only these 48 routes change. Colorado statute sections (state_law) and the 44 large-text rows are separate workstreams.
-- ROLLBACK: database/contracts/release-olls-info-files-20261027.rollback.sql
-- Run as one transaction.
begin;

do $$
declare v_n bigint; v_bytes numeric; v_ready bigint; v_missing bigint;
begin
  select count(*), coalesce(sum(l.bytes), 0), count(*) filter (where a.ready)
    into v_n, v_bytes, v_ready
  from corpus_ingest.held_artifact_release_20261027 l
  join public.corpus_artifacts a on a.route = l.route
  where l.decision = 'held:statute_publisher_unconfirmed' and 'olls.info' = any (l.provenance_hosts);
  if v_n <> 48 or v_bytes <> 195902790 or v_ready <> 0 then
    raise exception 'olls.info hold differs from the survey: % routes, % bytes, % already ready', v_n, v_bytes, v_ready
      using errcode = '55000';
  end if;
  select count(*) into v_missing
  from corpus_ingest.held_artifact_release_20261027 l
  join public.corpus_artifacts a on a.route = l.route
  left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
  where l.decision = 'held:statute_publisher_unconfirmed' and 'olls.info' = any (l.provenance_hosts)
    and (o.name is null or (o.metadata ->> 'size')::bigint is distinct from a.bytes);
  if v_missing <> 0 then
    raise exception '% olls.info routes have no stored object of the catalogued size', v_missing using errcode = '55000';
  end if;
end $$;

update public.corpus_artifacts a set ready = true
from corpus_ingest.held_artifact_release_20261027 l
where l.route = a.route and l.decision = 'held:statute_publisher_unconfirmed'
  and 'olls.info' = any (l.provenance_hosts) and a.ready = false;

update corpus_ingest.held_artifact_release_20261027 l set decision = 'released'
where l.decision = 'held:statute_publisher_unconfirmed' and 'olls.info' = any (l.provenance_hosts);

do $$
declare v_released bigint;
begin
  select count(*) into v_released
  from corpus_ingest.held_artifact_release_20261027 l
  join public.corpus_artifacts a on a.route = l.route and a.ready
  where l.decision = 'released' and 'olls.info' = any (l.provenance_hosts);
  if v_released <> 48 then raise exception 'Released % olls.info routes, expected 48', v_released using errcode = '55000'; end if;
end $$;

commit;
