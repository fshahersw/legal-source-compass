-- metrics-alignment/2026-10-03.r4.1  (run c41d48ea-d3fb-4362-bda3-a959b127a4cb; coordinator round 4 item B: dataset metadata counts must match the live row counts for every ready dataset)
-- Survey (all numbers from the live tables, 82 ready datasets at the time):
--   * corpus_datasets.imported_records = expected_records = count(corpus_records) for all 82 (the sw_* datasets owned by mdl-members keep growing and were equal when checked).
--   * listing totals: listing.total and listing_modes.*.total equal the live count of listed rows (filters._listing = yes) in 81 of 82. The four multi-mode datasets (counsel_directory 2170/2378/37, cpsc_injury_data
--     410201/69333, docsupload_coverage 270/11181, mdl_counsel 2213/4432/295) show the default mode in listing.total; every mode total equals the live count of its mode filter and the modes add up to the dataset size.
--     court_statistics lists 92 of 374 rows by design (282 rows are detail-only, filters._listing = no).
--     The one mismatch: court_spine says 5413 (listing.total, listing_modes.default.total, metadata.expected_records, exported_records, summary.*) but has 5411 rows since the two testing-court rows were quarantined.
--   * facet option counts equal the live counts for every ready dataset under 100,000 rows (checked option by option; sw_matter_parties_v1 has options without counts, owned by mdl-members).
--   * metadata.ready, a derived copy of corpus_datasets.ready, says false for 44 datasets that are published as ready.
--   * "About this data" (listing.qualification and its listing_modes copies): numbers checked against the live data. Wrong or misleading: court_documents says "Index of 50940 downloaded court documents" but publishes 20,861
--     (its own summary: records 20861 + excluded_uncategorized 30079 = native_default_records 50940); mdl_docket_activity says "36 of 176 JPML-registry MDLs" (176 = the 2026-09-01 registry; the directory lists 179 after the
--     2026-10-01 refresh); mdls says CourtListener links come from 20 saved connector responses, but 131 master-docket ids were added by the cl_docket_id fill; counsel_directory carries role labels the source build shifted.
--     Verified correct: mdl_appearances (878 appearances, 62 matters, 12 firms, 192 / 3 MDLs direct, 607 / 14 MDLs extended), mdl_case_inventory (4159), mdl_docket_activity (26,549 matched entries), court_statistics (92 files).
--   * corpus_context: the only dataset-meta rows are the five chunked ones (counties, county_litigation, judges, people, sources). Re-assembled, their expected_records equal the live counts (3144, 3311, 10698, 16191, 5700).
-- Kept as they are (build receipts of the export they hash, not current-size claims): metadata.summary.* and export_jsonl_sha256 (e.g. mdls summary.records 176, court_spine summary.records 5413); court_spine says why
--   (source_records_before_quarantine 5413, quarantined_records 2).
-- Changes (metadata only, nothing in corpus_records; no ready / held / publication column touched): statement 1 metadata.ready -> true for the 44 ready datasets; statement 2 court_spine counts;
--   statement 3 the four "About this data" texts.
-- Before-image: the replaced values (issues dq20261003r4_metadata_ready, dq20261003r4_metadata_counts, dq20261003r4_metadata_text). Execute statements 1..3.
--
-- ROLLBACK (exact):
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata, '{ready}', c.original_record->'metadata_ready'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_metadata_ready' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = d.id;
--   update public.corpus_datasets d
--      set metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{listing,total}', c.original_record->'listing_total'), '{listing_modes,default,total}', c.original_record->'mode_total'),
--                               '{expected_records}', c.original_record->'expected_records') - 'accuracy_review_r4_metrics_counts', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_metadata_counts' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = d.id;
--   update public.corpus_datasets d
--      set metadata = (case when c.original_record ? 'listing_modes'
--                           then jsonb_set(jsonb_set(d.metadata, '{listing,qualification}', c.original_record->'listing_qualification'), '{listing_modes}', c.original_record->'listing_modes')
--                           else jsonb_set(d.metadata, '{listing,qualification}', c.original_record->'listing_qualification') end) - 'accuracy_review_r4_metrics_text', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_metadata_text' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = d.id;
--   (mdls has no listing_modes; its before-image has no listing_modes key and the rollback leaves the key absent)
--
-- ===== statement 1: metadata.ready follows corpus_datasets.ready (audit + apply in one statement) =====
with ds as (select id, metadata from public.corpus_datasets where ready and metadata->'ready' = 'false'::jsonb),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r4_metadata_ready', 'label_override',
  'metadata.ready is a derived copy of the published corpus_datasets.ready flag; it said false for a dataset published as ready. The column is unchanged.',
  jsonb_build_object('review_version','metrics-alignment/2026-10-03.r4.1','approved_by','coordinator (round 3 review: fix derived metadata inconsistencies)'),
  jsonb_build_object('id', ds.id, 'metadata_ready', ds.metadata->'ready'),
  jsonb_build_object('metadata_ready', true),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from ds on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d set metadata = jsonb_set(d.metadata, '{ready}', 'true'::jsonb), updated_at = now()
   from aud a where d.id = a.record_id
 returning d.id)
select (select count(*) from ds) candidates, (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;

-- ===== statement 2: court_spine counts follow the 5,411 live rows (audit + apply in one statement; one dataset row) =====
with ds as (
 select d.id, d.metadata, d.expected_records as col_expected, (select count(*) from public.corpus_records r where r.dataset = d.id and r.filters @> '{"_listing":["yes"]}') as listed
 from public.corpus_datasets d where d.id = 'court_spine' and not (d.metadata ? 'accuracy_review_r4_metrics_counts')),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r4_metadata_counts', 'label_override',
  'court_spine listing totals and metadata.expected_records still said 5413 (the export) although the live directory has 5411 rows after the two testing-court rows were quarantined. summary.* and exported_records keep the export receipt (5413).',
  jsonb_build_object('review_version','metrics-alignment/2026-10-03.r4.1','live_listed_rows',ds.listed,'column_expected_records',ds.col_expected,'approved_by','coordinator (round 3 review)'),
  jsonb_build_object('id', ds.id, 'listing_total', ds.metadata->'listing'->'total', 'mode_total', ds.metadata->'listing_modes'->'default'->'total', 'expected_records', ds.metadata->'expected_records'),
  jsonb_build_object('listing_total', ds.listed, 'mode_total', ds.listed, 'expected_records', ds.col_expected),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from ds where ds.listed = ds.col_expected and (ds.metadata->'listing'->>'total')::bigint <> ds.listed
 on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{listing,total}', to_jsonb(ds.listed)), '{listing_modes,default,total}', to_jsonb(ds.listed)), '{expected_records}', to_jsonb(ds.col_expected))
                   || jsonb_build_object('accuracy_review_r4_metrics_counts', jsonb_build_object('version','metrics-alignment/2026-10-03.r4.1','run_id','c41d48ea-d3fb-4362-bda3-a959b127a4cb','applied_at',now(),
                        'kept_as_export_receipt', jsonb_build_array('exported_records','summary','export_jsonl_sha256'))),
        updated_at = now()
   from ds join aud a on a.record_id = ds.id
  where d.id = ds.id
 returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;

-- ===== statement 3: "About this data" texts (listing.qualification and its listing_modes copies; audit + apply in one statement) =====
with ds as (select id, metadata from public.corpus_datasets where id in ('court_documents','mdl_docket_activity','mdls','counsel_directory') and not (metadata ? 'accuracy_review_r4_metrics_text')),
live as (
 select (select count(*) from public.corpus_records where dataset = 'mdls') as mdl_n,
        (select count(*) from public.corpus_records where dataset = 'mdls' and item->>'cl_docket_id_basis' is not null) as clid_n,
        (select count(*) from public.corpus_records where dataset = 'mdls' and item->>'cl_docket_id_basis' like '%registry%') as clid_reg_n),
nq as (
 select ds.id, ds.metadata->'listing'->>'qualification' as q,
   case ds.id
     when 'court_documents' then
       replace(ds.metadata->'listing'->>'qualification', 'Index of 50940 downloaded court documents (manifest snapshot 2026-08-20)',
         'Index of ' || to_char((ds.metadata->'summary'->>'records')::bigint, 'FM999,999') || ' of the ' || to_char((ds.metadata->'summary'->>'native_default_records')::bigint, 'FM999,999')
         || ' downloaded court documents (manifest snapshot 2026-08-20; the other ' || to_char((ds.metadata->'summary'->>'excluded_uncategorized')::bigint, 'FM999,999') || ' manifest rows are uncategorized and are not published here)')
     when 'mdl_docket_activity' then
       replace(ds.metadata->'listing'->>'qualification', '36 of 176 JPML-registry MDLs',
         '36 of the 176 JPML-registry MDLs of the 2026-09-01 report (the MDL directory lists ' || live.mdl_n || ' after the 2026-10-01 refresh)')
     when 'mdls' then
       replace(ds.metadata->'listing'->>'qualification', 'CourtListener links come from saved connector responses (20), not original HTTP bytes.',
         'CourtListener links come from saved connector responses (20), not original HTTP bytes. ' || live.clid_n || ' master-docket ids (cl_docket_id) were added on 2026-10-03 by exact match of the CourtListener court id and the zero-padded master docket number to exactly one saved CourtListener docket header (' || live.clid_reg_n || ' of them also confirmed by the registry of Seeger Weiss tracked matters); masters that match several CourtListener dockets, conflict with the registry or are blocked at source have no id.')
     when 'counsel_directory' then
       ds.metadata->'listing'->>'qualification' || ' Role labels: the source build printed CourtListener role codes 4, 6 and 8 as terminated, inactive and unknown, whereas CourtListener means Pro hac vice, Terminated and Inactive. Seeger Weiss records were corrected on 2026-10-03; records of other firms that the source printed as terminated, inactive or unknown are not yet corrected.'
   end as new_q
 from ds cross join live),
guard as (select nq.* from nq where nq.new_q is not null and nq.new_q <> nq.q
           and not exists (select 1 from ds d2, jsonb_each(coalesce(d2.metadata->'listing_modes','{}'::jsonb)) e where d2.id = nq.id and e.value->>'qualification' is distinct from nq.q)),
nm as (
 select g.id, g.new_q, (select jsonb_object_agg(e.key, jsonb_set(e.value, '{qualification}', to_jsonb(g.new_q))) from ds d3, jsonb_each(d3.metadata->'listing_modes') e where d3.id = g.id) as new_modes
 from guard g),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r4_metadata_text', 'label_override',
  'About-this-data text corrected so its numbers and statements match the live data (see the contract header).',
  jsonb_build_object('review_version','metrics-alignment/2026-10-03.r4.1','approved_by','coordinator (round 4 item B)'),
  jsonb_build_object('id', ds.id, 'listing_qualification', ds.metadata->'listing'->'qualification') || case when ds.metadata ? 'listing_modes' then jsonb_build_object('listing_modes', ds.metadata->'listing_modes') else '{}'::jsonb end,
  jsonb_build_object('listing_qualification', nm.new_q) || case when nm.new_modes is not null then jsonb_build_object('listing_modes', nm.new_modes) else '{}'::jsonb end,
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from ds join nm on nm.id = ds.id
 on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = (case when nm.new_modes is null then jsonb_set(d.metadata, '{listing,qualification}', to_jsonb(nm.new_q))
                         else jsonb_set(jsonb_set(d.metadata, '{listing,qualification}', to_jsonb(nm.new_q)), '{listing_modes}', nm.new_modes) end)
                   || jsonb_build_object('accuracy_review_r4_metrics_text', jsonb_build_object('version','metrics-alignment/2026-10-03.r4.1','run_id','c41d48ea-d3fb-4362-bda3-a959b127a4cb','applied_at',now())),
        updated_at = now()
   from nm join aud a on a.record_id = nm.id
  where d.id = nm.id
 returning d.id)
select (select count(*) from ds) datasets_checked, (select count(*) from guard) texts_changed, (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;
