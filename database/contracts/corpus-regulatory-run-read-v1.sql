-- Administrative recovery read. No website endpoint; source-run scope is immutable after opening.
-- Install after corpus-regulatory-monitor-v1.sql.
begin;
create or replace function public.corpus_regulatory_run_v1(p_run uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'source',r.source_id,'mode',r.mode,'status',r.status,
    'startedAt',r.started_at,'finishedAt',r.finished_at,'windowFrom',r.window_from,'windowTo',r.window_to,
    'expectedCount',r.expected_count,'observedCount',r.observed_count,'errorCode',r.error_code,'scope',r.scope)
  from corpus_regulatory.runs r where r.id=p_run;
$$;
revoke all on function public.corpus_regulatory_run_v1(uuid) from public,anon,authenticated;
grant execute on function public.corpus_regulatory_run_v1(uuid) to service_role;
comment on function public.corpus_regulatory_run_v1(uuid) is 'Administrative exact-run read for immutable packet recovery; does not enumerate or modify source runs.';
commit;
