-- Independent read-only verification after the reviewed hold is actually executed.
SELECT jsonb_build_object(
 'scope_id','b410de75-1b8d-4937-87f9-1a202d6a9672',
 'archive_record_count',(SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records'),
 'archive_record_sha256',(SELECT encode(extensions.digest(convert_to(string_agg(row_key||':'||row_sha256,E'\n' ORDER BY row_key),'UTF8'),'sha256'),'hex') FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records'),
 'expected_archive_record_sha256','7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646',
 'archive_hash_mismatches',(SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(original_record::text,'UTF8'),'sha256'),'hex')),
 'archive_supporting_rows',(SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation<>'public.corpus_records'),
 'archive_supporting_snapshot_mismatches',(SELECT count(*) FROM (VALUES ('public.corpus_context','supplement:verdict_settlement_reports_20260919','efcb67743bac660937f15b6ed1d7354068b30ba2759cd9badb0b3d6fc33ba283'),('public.corpus_context','supplements:part:5fbfab3e59682dbe:000012','d3dbfddac8405c4bf8c384afb65df838a54287103dc63c0b469ca37ef2619476'),('public.corpus_datasets','verdict_reports','d8b904cb5f9f7e666a529a608afbabd30a5be8468fff2f2bb238b938e1b1e80f')) e(source_relation,row_key,row_sha256) LEFT JOIN corpus_ingest.public_visibility_quarantine_v1 a ON a.scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND a.source_relation=e.source_relation AND a.row_key=e.row_key WHERE a.row_sha256 IS DISTINCT FROM e.row_sha256),
 'remaining_public_verdict_records',(SELECT count(*) FROM public.corpus_records WHERE dataset='verdict_reports'),
 'dataset_ready',(SELECT ready FROM public.corpus_datasets WHERE id='verdict_reports'),
 'dataset_imported_records',(SELECT imported_records FROM public.corpus_datasets WHERE id='verdict_reports'),
 'research_names_remaining',(SELECT count(*) FROM public.corpus_research_names WHERE source_dataset='verdict_reports'),
 'law_paths_remaining',(SELECT count(*) FROM public.corpus_research_law_paths WHERE dataset='verdict_reports'),
 'ready_context_references',(SELECT count(*) FROM public.corpus_context WHERE key IN ('supplement:verdict_settlement_reports_20260919','supplements:part:5fbfab3e59682dbe:000012') AND ready),
 'archive_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='corpus_ingest.public_visibility_quarantine_v1'::regclass),
 'archive_anon_select',has_table_privilege('anon','corpus_ingest.public_visibility_quarantine_v1','SELECT'),
 'archive_authenticated_select',has_table_privilege('authenticated','corpus_ingest.public_visibility_quarantine_v1','SELECT'),
 'matching_artifact_hash_rows',(SELECT count(*) FROM public.corpus_artifacts WHERE sha256 IN ('ecede0e85501609322d3160f3dfe0ccf79f6c6f6b73983cdae2b544f37be951a','78825251e7a9156a88ed9d326b649e287eb7147a514e2f3b4fe4641c3f90c5b5'))
) AS verification;
