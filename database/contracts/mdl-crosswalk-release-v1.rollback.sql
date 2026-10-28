-- ROLLBACK for database/contracts/mdl-crosswalk-release-v1.sql (mdl-crosswalk-release/2026-10-27.v1, run b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715).
-- Restores the 59 mdl_crosswalk records and the dataset row (ready=false, original metadata) from the ledger before-images, then removes the
-- ledger rows. The run row is kept and marked failed, so a re-release needs a new run id (runs_pkey). It refuses to run unless the
-- live rows still equal the release's after-image (rows md5 3e583ffe..., ready=true, metadata.release_2026_10_27), so later edits are
-- never overwritten silently. Expected afterwards (database/contracts/mdl-crosswalk-release-v1-verify.sql): ready=false,
-- rows_md5=94e5163608c9cf200fb440d47a7cf7cc, meta_md5=660aa8f72b922a3593339983e0b6a665, ledger_records=0, ledger_dataset=0.
begin;
set local statement_timeout = '120s';

do $rollback$
declare v_n bigint; v_md5 text;
begin
  select md5(string_agg(id || item::text || detail::text || text, '|' order by id)) into v_md5
    from public.corpus_records where dataset = 'mdl_crosswalk';
  if v_md5 is distinct from '3e583ffe224cdf363576edcf64054748' then
    raise exception 'rollback refused: live rows md5 % is not the release after-image', v_md5;
  end if;
  if not exists (select 1 from public.corpus_datasets where id = 'mdl_crosswalk' and ready and metadata ? 'release_2026_10_27') then
    raise exception 'rollback refused: mdl_crosswalk is not in the released state';
  end if;

  update public.corpus_records r
     set item = c.original_record->'item', detail = c.original_record->'detail', text = c.original_record->>'text'
    from corpus_ingest.cleanup_decisions c
   where c.dataset = 'mdl_crosswalk' and c.issue = 'release20261027_mdl_crosswalk' and c.run_id = 'b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715'
     and r.dataset = 'mdl_crosswalk' and r.id = c.record_id;
  get diagnostics v_n = row_count;
  if v_n <> 59 then raise exception 'expected 59 restored records, got %', v_n; end if;

  update public.corpus_datasets d
     set ready = (c.original_record->>'ready')::boolean, metadata = c.original_record->'metadata', updated_at = now()
    from corpus_ingest.cleanup_decisions c
   where c.dataset = 'corpus_datasets' and c.record_id = 'mdl_crosswalk' and c.issue = 'release20261027_mdl_crosswalk_dataset'
     and c.run_id = 'b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715' and d.id = 'mdl_crosswalk';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'expected 1 restored dataset row, got %', v_n; end if;

  select md5(string_agg(id || item::text || detail::text || text, '|' order by id)) into v_md5
    from public.corpus_records where dataset = 'mdl_crosswalk';
  if v_md5 is distinct from '94e5163608c9cf200fb440d47a7cf7cc' then raise exception 'rollback check failed: rows md5 %', v_md5; end if;

  delete from corpus_ingest.cleanup_decisions
   where run_id = 'b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715'
     and issue in ('release20261027_mdl_crosswalk', 'release20261027_mdl_crosswalk_dataset');
  update corpus_ingest.runs set status = 'failed', counts = counts || jsonb_build_object('rolled_back_at', now())
   where id = 'b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715';
end
$rollback$;

commit;
