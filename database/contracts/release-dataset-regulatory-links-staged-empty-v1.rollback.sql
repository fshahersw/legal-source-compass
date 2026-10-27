-- Rollback for release-dataset-regulatory-links-staged-empty-v1.sql: restore the catalog row sw_matter_regulatory_links_v1_staged
-- exactly as archived (all columns, including updated_at) from corpus_ingest.cleanup_decisions. The ledger row is kept and marked rolled back.
-- Afterwards also revert the datasetSuccessor entry in src/lib/external/groups.ts if the staged page should open again
-- (it would show 0 rows either way: its 38 links live in sw_matter_regulatory_links_v1).

begin;
set local statement_timeout = '30s';

do $$
declare
  v_id constant text := 'sw_matter_regulatory_links_v1_staged';
  v_issue constant text := 'release20261027_retire_empty_staged_catalog';
  led corpus_ingest.cleanup_decisions;
begin
  if exists (select 1 from public.corpus_datasets where id = v_id) then
    raise notice '% exists; nothing to restore', v_id;
    return;
  end if;
  select * into led from corpus_ingest.cleanup_decisions
   where dataset = 'public.corpus_datasets' and record_id = v_id and issue = v_issue;
  if not found then raise exception 'no ledger row % for %', v_issue, v_id using errcode = '22023'; end if;

  insert into public.corpus_datasets
  select * from jsonb_populate_record(null::public.corpus_datasets, led.original_record);

  if md5(to_jsonb((select d from public.corpus_datasets d where d.id = v_id))::text) <> led.evidence->>'row_md5' then
    raise exception 'restored row does not match the archived md5 %', led.evidence->>'row_md5' using errcode = '22023';
  end if;

  update corpus_ingest.cleanup_decisions
     set replacement = coalesce(replacement, '{}'::jsonb) || jsonb_build_object('rolled_back_at', now(), 'deleted', false)
   where dataset = 'public.corpus_datasets' and record_id = v_id and issue = v_issue;
  raise notice 'restored %', v_id;
end $$;

commit;
