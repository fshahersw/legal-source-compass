-- Rollback of trellis-ready-files-withdrawal/2026-10-27.1: sets exactly the 45 ledgered routes back to ready = true
-- (their before-image) and drops the ledger. Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f).
begin;
set local statement_timeout = '120s';

do $$
declare v_n bigint;
begin
  if to_regclass('corpus_ingest.trellis_ready_withdrawal_20261027') is null then
    raise exception 'Withdrawal ledger not found: nothing to roll back' using errcode = '55000';
  end if;
  select count(*) into v_n from corpus_ingest.trellis_ready_withdrawal_20261027 where ready_before;
  if v_n <> 45 then raise exception 'Ledger has % ready_before routes, expected 45', v_n using errcode = '55000'; end if;
end $$;

update public.corpus_artifacts a set ready = true
from corpus_ingest.trellis_ready_withdrawal_20261027 w
where w.route = a.route and w.ready_before and a.ready = false;

drop table corpus_ingest.trellis_ready_withdrawal_20261027;

commit;
