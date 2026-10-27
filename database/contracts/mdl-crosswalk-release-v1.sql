-- mdl-crosswalk-release/2026-10-27.v1  (run b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715)
-- Releases the held dataset public.corpus_datasets 'mdl_crosswalk' (59 records) under the owner decision of 2026-10-27 (AGENTS.md):
--   "dont withhold any data. If its accurate and valuable, USE IT".
--
-- Why it was held: ready=false with the qualification "Local personal-testing view; derived from a private firm dataset (SW-BULK) built from
--   CourtListener/RECAP API data; not for redistribution". That is the firm's own label on its own derived dataset, not a third-party licence and
--   not a court- or provider-reported seal or restriction -> a caution hold, released.
-- Accuracy (read-only checks 2026-10-27): all 59 rows match a published mdls row on MDL number + CourtListener court id, master docket and JPML
--   status (59/59 each). 49 CourtListener docket ids equal mdls.summary.cl_docket_id; 9 add an id where mdls deliberately left it empty; 1 conflicts.
--   Data that is not accurate is corrected, never published as is:
--     mdl:3014  the firm release's id 63571952 is a member case that shares pawd 2:21-mc-01230 (CourtListener header "... v. Philips RS North
--               America LLC", different PACER case id), not the master (60866823, as mdls and docs/sw-matter-registry-contract.md record) -> the fact
--               value now says so.
--     mdl:2804, mdl:3010  several CourtListener dockets share the master's court and number -> the value is annotated with all of them (not resolved).
--   Rows whose CourtListener docket is blocked=true at the source (2885: 14916674, 2921: 16684846) are kept: the crosswalk carries only the docket id,
--   which the published mdls rows already show in their case samples; no entries, parties or text of those dockets are added.
-- Other changes: the "personal-testing / not for redistribution" sentence leaves the qualification (detail, search text, dataset metadata); the
--   record links "#mdls?mdl=<n>" (mdls has no "mdl" filter) become the exact entity link "#mdl/<n>". Nothing else in item/detail/text changes;
--   title, source_url (empty, as for mdls), filters, ordinals and the 59-row count are unchanged. manifest_sha256 keeps the original export hash; the
--   release receipt in metadata.release_2026_10_27 records the new content md5.
-- Ledger: whole before-images in corpus_ingest.cleanup_decisions (issue release20261027_mdl_crosswalk for the 59 records,
--   release20261027_mdl_crosswalk_dataset for the dataset row). Rollback: database/contracts/mdl-crosswalk-release-v1.rollback.sql.
-- Verify before and after: database/contracts/mdl-crosswalk-release-v1-verify.sql.
-- Guarded: aborts (nothing written) unless the live rows still equal the reviewed before-image
--   (rows md5 94e5163608c9cf200fb440d47a7cf7cc, metadata md5 660aa8f72b922a3593339983e0b6a665, ready=false) and the result equals the reviewed
--   dry-run (rows md5 3e583ffe224cdf363576edcf64054748).

begin;
set local statement_timeout = '120s';

do $release$
declare
  v_run constant uuid := 'b6a1e2c4-5d3f-4a7e-9c21-8f0d3e6a2715';
  v_issue constant text := 'release20261027_mdl_crosswalk';
  v_q_old constant text := 'Local personal-testing view; derived from a private firm dataset (SW-BULK) built from CourtListener/RECAP API data; not for redistribution. ';
  v_q_new constant text := 'Derived from the firm''s SW-BULK dataset, built from CourtListener/RECAP API data. ';
  v_before_rows constant text := '94e5163608c9cf200fb440d47a7cf7cc';
  v_before_meta constant text := '660aa8f72b922a3593339983e0b6a665';
  v_after_rows constant text := '3e583ffe224cdf363576edcf64054748';
  v_n bigint; v_md5 text; v_ready boolean; v_meta_md5 text;
begin
  -- 1. guard: the live state is the reviewed before-image
  select count(*), md5(string_agg(id || item::text || detail::text || text, '|' order by id))
    into v_n, v_md5 from public.corpus_records where dataset = 'mdl_crosswalk';
  select ready, md5(metadata::text) into v_ready, v_meta_md5 from public.corpus_datasets where id = 'mdl_crosswalk';
  if v_n <> 59 or v_md5 is distinct from v_before_rows or v_ready is distinct from false or v_meta_md5 is distinct from v_before_meta then
    raise exception 'mdl_crosswalk changed since review: records=% rows_md5=% ready=% meta_md5=%', v_n, v_md5, v_ready, v_meta_md5;
  end if;
  if exists (select 1 from corpus_ingest.cleanup_decisions where issue in (v_issue, v_issue || '_dataset')) then
    raise exception 'ledger rows for % already exist; run the rollback first or investigate', v_issue;
  end if;

  -- 2. proposed rows (identical to the reviewed dry-run)
  create temp table _mdl_xw_proposed on commit drop as
  with fix(id, old_val, new_val) as (values
    ('mdl:2804', '6240169',  '6240169 (one of three CourtListener dockets with court ohnd and number 1:17-md-02804: 6240169, 61465334, 62647370)'),
    ('mdl:3010', '60149069', '60149069 (one of two CourtListener dockets with court nysd and number 1:21-md-03010: 60149069, 72318783)'),
    ('mdl:3014', '63571952', '63571952 is not the MDL master: that CourtListener docket is a member case sharing the number (different PACER case id and caption). The MDL directory records the master as 60866823 (exact header join).')
  ), src as (
    select r.dataset, r.id, r.item, r.detail, r.text from public.corpus_records r where r.dataset = 'mdl_crosswalk'
  )
  select s.dataset, s.id,
    jsonb_set(s.item, '{links}', (
      select coalesce(jsonb_agg(case when l->>'url' ~ '^#mdls\?mdl=[0-9]+$'
                                     then jsonb_set(l, '{url}', to_jsonb('#mdl/' || substring(l->>'url' from '[0-9]+$'))) else l end order by o), '[]'::jsonb)
      from jsonb_array_elements(coalesce(s.item->'links', '[]'::jsonb)) with ordinality t(l, o))) as new_item,
    jsonb_set(jsonb_set(jsonb_set(s.detail,
      '{links}', (
        select coalesce(jsonb_agg(case when l->>'url' ~ '^#mdls\?mdl=[0-9]+$'
                                       then jsonb_set(l, '{url}', to_jsonb('#mdl/' || substring(l->>'url' from '[0-9]+$'))) else l end order by o), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s.detail->'links', '[]'::jsonb)) with ordinality t(l, o))),
      '{qualification}', to_jsonb(replace(s.detail->>'qualification', v_q_old, v_q_new))),
      '{facts}', (
        select coalesce(jsonb_agg(case when fx.id is not null and f->>0 = 'CourtListener docket id (matter_aliases.courtlistener_docket_id)' and f->>1 = fx.old_val
                                       then jsonb_build_array(f->>0, fx.new_val) else f end order by o), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s.detail->'facts', '[]'::jsonb)) with ordinality t(f, o))) as new_detail,
    case when fx.id is null then replace(s.text, v_q_old, v_q_new)
         else replace(replace(s.text, v_q_old, v_q_new),
                      'CourtListener docket id (matter_aliases.courtlistener_docket_id) ' || fx.old_val || ' AWS release matter id',
                      'CourtListener docket id (matter_aliases.courtlistener_docket_id) ' || fx.new_val || ' AWS release matter id') end as new_text,
    s.item as old_item, s.detail as old_detail, s.text as old_text, fx.id as fixed_id
  from src s left join fix fx on fx.id = s.id;

  select md5(string_agg(id || new_item::text || new_detail::text || new_text, '|' order by id)) into v_md5 from _mdl_xw_proposed;
  if v_md5 is distinct from v_after_rows then
    raise exception 'proposed rows differ from the reviewed dry-run: %', v_md5;
  end if;

  -- 3. run + ledger (whole before-images)
  insert into corpus_ingest.runs(id, status, scope, finished_at, counts)
  values (v_run, 'completed', jsonb_build_object(
      'contract', 'mdl-crosswalk-release/2026-10-27.v1',
      'purpose', 'release held dataset mdl_crosswalk (ready=false caution hold) with accuracy corrections',
      'owner_instruction', '2026-10-27: dont withhold any data. If its accurate and valuable, USE IT',
      'dataset', 'mdl_crosswalk'),
    now(), jsonb_build_object('records', 59, 'facts_corrected', 3, 'links_rewritten', 59, 'qualifications_rewritten', 59));

  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select p.dataset, p.id, v_issue, 'review',
    case when p.fixed_id = 'mdl:3014' then 'release under owner decision 2026-10-27; CourtListener id 63571952 is a member case (header conflict), corrected'
         when p.fixed_id is not null then 'release under owner decision 2026-10-27; several CourtListener dockets share court+number, annotated'
         else 'release under owner decision 2026-10-27; caution qualification removed, exact entity link' end,
    jsonb_build_object('mdls_match', 'same MDL number, CourtListener court, master docket and JPML status as the published mdls row',
                       'before_rows_md5', v_before_rows, 'after_rows_md5', v_after_rows),
    jsonb_build_object('item', p.old_item, 'detail', p.old_detail, 'text', p.old_text),
    jsonb_build_object('item', p.new_item, 'detail', p.new_detail, 'text', p.new_text),
    v_run
  from _mdl_xw_proposed p;

  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'corpus_datasets', d.id, v_issue || '_dataset', 'review',
    'release held dataset mdl_crosswalk (ready false -> true) under owner decision 2026-10-27',
    jsonb_build_object('before_metadata_md5', v_before_meta),
    jsonb_build_object('ready', d.ready, 'metadata', d.metadata, 'updated_at', d.updated_at),
    jsonb_build_object('ready', true),
    v_run
  from public.corpus_datasets d where d.id = 'mdl_crosswalk';

  -- 4. records
  update public.corpus_records r
     set item = p.new_item, detail = p.new_detail, text = p.new_text
    from _mdl_xw_proposed p
   where r.dataset = p.dataset and r.id = p.id;
  get diagnostics v_n = row_count;
  if v_n <> 59 then raise exception 'expected 59 record updates, got %', v_n; end if;

  -- 5. dataset row
  update public.corpus_datasets d
     set ready = true,
         metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata,
                      '{ready}', 'true'::jsonb),
                      '{listing,qualification}', to_jsonb(replace(d.metadata->'listing'->>'qualification', v_q_old, v_q_new))),
                      '{listing_modes,default,qualification}', to_jsonb(replace(d.metadata->'listing_modes'->'default'->>'qualification', v_q_old, v_q_new)))
                    || jsonb_build_object('release_2026_10_27', jsonb_build_object(
                         'version', 'mdl-crosswalk-release/2026-10-27.v1', 'run_id', v_run, 'released_at', now(),
                         'owner_decision', '2026-10-27: dont withhold any data. If its accurate and valuable, USE IT',
                         'hold_basis_released', 'caution: firm''s own "local personal-testing / not for redistribution" label; no source seal or restriction',
                         'facts_corrected', jsonb_build_array('mdl:3014', 'mdl:2804', 'mdl:3010'),
                         'links', '#mdls?mdl=<n> -> #mdl/<n>',
                         'rows_md5_before', v_before_rows, 'rows_md5_after', v_after_rows,
                         'manifest_sha256_note', 'manifest_sha256 is the original export hash; records changed as listed here')),
         updated_at = now()
   where d.id = 'mdl_crosswalk' and d.ready = false;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'expected 1 dataset update, got %', v_n; end if;

  -- 6. post-check
  select md5(string_agg(id || item::text || detail::text || text, '|' order by id)) into v_md5
    from public.corpus_records where dataset = 'mdl_crosswalk';
  if v_md5 is distinct from v_after_rows then raise exception 'post-check failed: rows md5 %', v_md5; end if;
end
$release$;

commit;
