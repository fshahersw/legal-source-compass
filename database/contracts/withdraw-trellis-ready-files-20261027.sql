-- trellis-ready-files-withdrawal/2026-10-27.1  (workstream release/held-artifact-downloads; optional, separate from the release)
-- Found during the held-artifact survey 2026-10-27: 45 /files/* routes are ALREADY ready = true although every published
-- record that links them is a focused "judge_directory" capture whose source_url is trellis.law (stored files
-- judges_<state>.firecrawl.json, 11,575,411 bytes). Trellis is a commercial legal publisher, and commercial sites are not
-- data sources (AGENTS.md owner decisions 2026-10-19 and 2026-10-22 (4)); this is a source rule, not caution.
-- The held-artifact release expects "no ready=true row with host trellis.law"; this withdrawal makes that true.
-- Only the download flag changes: the focused records themselves are another workstream's decision and are untouched.
-- Ledger: corpus_ingest.trellis_ready_withdrawal_20261027 (route, ready_before = true). Rollback re-enables exactly those.
-- ROLLBACK: database/contracts/withdraw-trellis-ready-files-20261027.rollback.sql

begin;
set local statement_timeout = '300s';

do $$
begin
  if to_regclass('corpus_ingest.trellis_ready_withdrawal_20261027') is not null then
    raise exception 'Withdrawal ledger exists: already applied' using errcode = '55000';
  end if;
end $$;

create temporary table trw_eval on commit drop as
with links as (
  select u.route, lower(substring(coalesce(nullif(r.source_url, ''), r.item->>'source_url') from '^https?://([^/:?#]+)')) as host
  from public.corpus_records r
  cross join lateral (values (r.item->>'original_url'), (r.item->>'extracted_url')) u(route)
  where r.dataset in ('focused', 'seeger') and u.route like '/files/%'),
trellis_only as (
  select route from links group by route having bool_and(host ~ '(^|\.)trellis\.law$'))
select a.route, a.sha256, a.bytes
from trellis_only t join public.corpus_artifacts a on a.route = t.route
where a.ready;

do $$
declare v_n bigint; v_bytes numeric; v_md5 text;
begin
  select count(*), coalesce(sum(bytes), 0), md5(string_agg(route, ',' order by route)) into v_n, v_bytes, v_md5 from trw_eval;
  if v_n <> 45 or v_bytes <> 11575411 or v_md5 is distinct from '6d515a3f5e34dfbe34721265f713ffcd' then
    raise exception 'Trellis-only ready routes differ from the survey (routes %, bytes %, md5 %)', v_n, v_bytes, v_md5 using errcode = '55000';
  end if;
end $$;

create table corpus_ingest.trellis_ready_withdrawal_20261027 (
  route text primary key,
  sha256 text not null,
  bytes bigint not null,
  ready_before boolean not null,
  reason text not null default 'commercial legal publisher (trellis.law) is not a data source',
  release text not null default 'trellis-ready-files-withdrawal/2026-10-27.1',
  withdrawn_at timestamptz not null default now());
revoke all on table corpus_ingest.trellis_ready_withdrawal_20261027 from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table corpus_ingest.trellis_ready_withdrawal_20261027 from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table corpus_ingest.trellis_ready_withdrawal_20261027 from authenticated'; end if;
end $$;

insert into corpus_ingest.trellis_ready_withdrawal_20261027 (route, sha256, bytes, ready_before)
select route, sha256, bytes, true from trw_eval;

update public.corpus_artifacts a set ready = false
from corpus_ingest.trellis_ready_withdrawal_20261027 w
where w.route = a.route and a.ready;

do $$
begin
  if exists (select 1 from public.corpus_artifacts a join corpus_ingest.trellis_ready_withdrawal_20261027 w on w.route = a.route where a.ready) then
    raise exception 'A withdrawn route is still ready' using errcode = '55000';
  end if;
end $$;

commit;

select count(*) as withdrawn, sum(bytes) as bytes from corpus_ingest.trellis_ready_withdrawal_20261027;
