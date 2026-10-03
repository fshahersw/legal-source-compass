-- Prepared only. Root reviews and executes; source originals and private PDF assets are untouched.
-- Fixed scope b410de75-1b8d-4937-87f9-1a202d6a9672; a changed source snapshot aborts the whole transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE TABLE IF NOT EXISTS corpus_ingest.public_visibility_quarantine_v1 (
  scope_id uuid NOT NULL,
  source_relation text NOT NULL CHECK(source_relation IN ('public.corpus_records','public.corpus_datasets','public.corpus_context')),
  row_key text NOT NULL,
  row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[0-9a-f]{64}$'),
  original_record jsonb NOT NULL CHECK(jsonb_typeof(original_record)='object'),
  reason text NOT NULL CHECK(reason='source_license_export_prohibited'),
  source_evidence jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_id,source_relation,row_key),
  CHECK(row_sha256=encode(extensions.digest(convert_to(original_record::text,'UTF8'),'sha256'),'hex'))
);
ALTER TABLE corpus_ingest.public_visibility_quarantine_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON corpus_ingest.public_visibility_quarantine_v1 FROM PUBLIC,anon,authenticated;
-- No new RPC or public view exposes this archive; server-side administrator inspection only.
LOCK TABLE public.corpus_records,public.corpus_datasets,public.corpus_context,
  public.corpus_research_names,public.corpus_research_law_paths IN SHARE ROW EXCLUSIVE MODE;
DO $hold$
DECLARE n bigint; h text;
BEGIN
  IF (SELECT count(*) FROM public.corpus_records WHERE dataset='verdict_reports')=0
     AND (SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records')=3312 THEN
    SELECT encode(extensions.digest(convert_to(string_agg(row_key||':'||row_sha256,E'\n' ORDER BY row_key),'UTF8'),'sha256'),'hex') INTO h
      FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records';
    IF h IS DISTINCT FROM '7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646' OR (SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672')<>3315
       OR EXISTS(SELECT 1 FROM (VALUES ('public.corpus_context','supplement:verdict_settlement_reports_20260919','efcb67743bac660937f15b6ed1d7354068b30ba2759cd9badb0b3d6fc33ba283'),('public.corpus_context','supplements:part:5fbfab3e59682dbe:000012','d3dbfddac8405c4bf8c384afb65df838a54287103dc63c0b469ca37ef2619476'),('public.corpus_datasets','verdict_reports','d8b904cb5f9f7e666a529a608afbabd30a5be8468fff2f2bb238b938e1b1e80f')) e(source_relation,row_key,row_sha256) LEFT JOIN corpus_ingest.public_visibility_quarantine_v1 a ON a.scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND a.source_relation=e.source_relation AND a.row_key=e.row_key WHERE a.row_sha256 IS DISTINCT FROM e.row_sha256)
       OR EXISTS(SELECT 1 FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(original_record::text,'UTF8'),'sha256'),'hex'))
       OR (SELECT ready FROM public.corpus_datasets WHERE id='verdict_reports') IS DISTINCT FROM false
       OR EXISTS(SELECT 1 FROM public.corpus_context WHERE key IN ('supplement:verdict_settlement_reports_20260919','supplements:part:5fbfab3e59682dbe:000012') AND ready) THEN
      RAISE EXCEPTION 'VERDICT_QUARANTINE_REPLAY_MISMATCH';
    END IF;
    RETURN;
  END IF;
  SELECT count(*),encode(extensions.digest(convert_to(string_agg(id||':'||encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex'),E'\n' ORDER BY id),'UTF8'),'sha256'),'hex')
    INTO n,h FROM public.corpus_records r WHERE dataset='verdict_reports';
  IF n<>3312 OR h IS DISTINCT FROM '7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646' THEN RAISE EXCEPTION 'VERDICT_RECORD_SNAPSHOT_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM public.corpus_records WHERE dataset='verdict_reports' AND (source_url IS NULL OR source_url !~ '^https://topverdict[.]com/')) THEN RAISE EXCEPTION 'VERDICT_ORIGIN_BINDING_CHANGED'; END IF;
  IF (SELECT encode(extensions.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex') FROM public.corpus_datasets d WHERE id='verdict_reports') IS DISTINCT FROM 'd8b904cb5f9f7e666a529a608afbabd30a5be8468fff2f2bb238b938e1b1e80f' THEN RAISE EXCEPTION 'VERDICT_DATASET_SNAPSHOT_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM public.corpus_research_names WHERE source_dataset='verdict_reports') OR EXISTS(SELECT 1 FROM public.corpus_research_law_paths WHERE dataset='verdict_reports') THEN RAISE EXCEPTION 'VERDICT_NEW_DERIVED_ROWS_NEED_REVIEW'; END IF;
  IF (SELECT encode(extensions.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex') FROM public.corpus_context c WHERE key='supplement:verdict_settlement_reports_20260919') IS DISTINCT FROM 'efcb67743bac660937f15b6ed1d7354068b30ba2759cd9badb0b3d6fc33ba283' THEN RAISE EXCEPTION 'VERDICT_CONTEXT_SNAPSHOT_CHANGED'; END IF;
  IF (SELECT encode(extensions.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex') FROM public.corpus_context c WHERE key='supplements:part:5fbfab3e59682dbe:000012') IS DISTINCT FROM 'd3dbfddac8405c4bf8c384afb65df838a54287103dc63c0b469ca37ef2619476' THEN RAISE EXCEPTION 'VERDICT_CONTEXT_SNAPSHOT_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672') THEN RAISE EXCEPTION 'VERDICT_ARCHIVE_SCOPE_ALREADY_PARTIAL'; END IF;
  INSERT INTO corpus_ingest.public_visibility_quarantine_v1(scope_id,source_relation,row_key,row_sha256,original_record,reason,source_evidence)
    SELECT 'b410de75-1b8d-4937-87f9-1a202d6a9672','public.corpus_records',id,encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex'),to_jsonb(r),'source_license_export_prohibited','{"source_url":"https://topverdict.com/","terms_url":"https://store.topverdict.com/pages/terms","source_database_sha256":"ecede0e85501609322d3160f3dfe0ccf79f6c6f6b73983cdae2b544f37be951a","validation_sha256":"78825251e7a9156a88ed9d326b649e287eb7147a514e2f3b4fe4641c3f90c5b5","source_input_sha256":"52d6e23383b8f85a9b606b2c2519c2caa7b69a09872dbc0501a98be545bf0113","license_ref":"publisher_terms_prohibit_reuse_local_research_only","export_allowed":false,"exact_source_id_count":3312,"binding_basis":"Same exact 3312 IDs plus original SQLite and validation hashes match registered dataset source_files. No source-URL keyword deletion.","snapshot_sha256_codec":"PostgreSQL to_jsonb(source row)::text UTF-8 sha256; ordered id:row_sha256 lines joined with LF without final LF.","artifact_matches":0,"private_storage_deletion":false}'::jsonb FROM public.corpus_records r WHERE dataset='verdict_reports';
  INSERT INTO corpus_ingest.public_visibility_quarantine_v1(scope_id,source_relation,row_key,row_sha256,original_record,reason,source_evidence)
    SELECT 'b410de75-1b8d-4937-87f9-1a202d6a9672','public.corpus_datasets',id,encode(extensions.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex'),to_jsonb(d),'source_license_export_prohibited','{"source_url":"https://topverdict.com/","terms_url":"https://store.topverdict.com/pages/terms","source_database_sha256":"ecede0e85501609322d3160f3dfe0ccf79f6c6f6b73983cdae2b544f37be951a","validation_sha256":"78825251e7a9156a88ed9d326b649e287eb7147a514e2f3b4fe4641c3f90c5b5","source_input_sha256":"52d6e23383b8f85a9b606b2c2519c2caa7b69a09872dbc0501a98be545bf0113","license_ref":"publisher_terms_prohibit_reuse_local_research_only","export_allowed":false,"exact_source_id_count":3312,"binding_basis":"Same exact 3312 IDs plus original SQLite and validation hashes match registered dataset source_files. No source-URL keyword deletion.","snapshot_sha256_codec":"PostgreSQL to_jsonb(source row)::text UTF-8 sha256; ordered id:row_sha256 lines joined with LF without final LF.","artifact_matches":0,"private_storage_deletion":false}'::jsonb FROM public.corpus_datasets d WHERE id='verdict_reports';
  INSERT INTO corpus_ingest.public_visibility_quarantine_v1(scope_id,source_relation,row_key,row_sha256,original_record,reason,source_evidence)
    SELECT 'b410de75-1b8d-4937-87f9-1a202d6a9672','public.corpus_context',key,encode(extensions.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex'),to_jsonb(c),'source_license_export_prohibited','{"source_url":"https://topverdict.com/","terms_url":"https://store.topverdict.com/pages/terms","source_database_sha256":"ecede0e85501609322d3160f3dfe0ccf79f6c6f6b73983cdae2b544f37be951a","validation_sha256":"78825251e7a9156a88ed9d326b649e287eb7147a514e2f3b4fe4641c3f90c5b5","source_input_sha256":"52d6e23383b8f85a9b606b2c2519c2caa7b69a09872dbc0501a98be545bf0113","license_ref":"publisher_terms_prohibit_reuse_local_research_only","export_allowed":false,"exact_source_id_count":3312,"binding_basis":"Same exact 3312 IDs plus original SQLite and validation hashes match registered dataset source_files. No source-URL keyword deletion.","snapshot_sha256_codec":"PostgreSQL to_jsonb(source row)::text UTF-8 sha256; ordered id:row_sha256 lines joined with LF without final LF.","artifact_matches":0,"private_storage_deletion":false}'::jsonb FROM public.corpus_context c WHERE key IN ('supplement:verdict_settlement_reports_20260919','supplements:part:5fbfab3e59682dbe:000012');
  SELECT count(*),encode(extensions.digest(convert_to(string_agg(row_key||':'||row_sha256,E'\n' ORDER BY row_key),'UTF8'),'sha256'),'hex') INTO n,h FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records';
  IF n<>3312 OR h IS DISTINCT FROM '7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646' THEN RAISE EXCEPTION 'VERDICT_ARCHIVE_COPY_MISMATCH'; END IF;
  IF (SELECT count(*) FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672')<>3315 THEN RAISE EXCEPTION 'VERDICT_ARCHIVE_SUPPORTING_SNAPSHOT_MISSING'; END IF;
  DELETE FROM public.corpus_records WHERE dataset='verdict_reports';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>3312 THEN RAISE EXCEPTION 'VERDICT_REMOVAL_COUNT_CHANGED'; END IF;
  UPDATE public.corpus_datasets SET ready=false,imported_records=0,
    metadata=metadata||jsonb_build_object('ready',false,'imported_records',0,'visibility_hold',jsonb_build_object('scope_id','b410de75-1b8d-4937-87f9-1a202d6a9672','reason','source_license_export_prohibited','preserved_records',3312,'license_ref','publisher_terms_prohibit_reuse_local_research_only','source_manifest_sha256','9383edd6d0fdc948566e9fe987fa85da5f50368f1f1592c3a2147ac35fd7690d')),updated_at=now() WHERE id='verdict_reports';
  UPDATE public.corpus_context SET ready=false WHERE key IN ('supplement:verdict_settlement_reports_20260919','supplements:part:5fbfab3e59682dbe:000012');
  IF EXISTS(SELECT 1 FROM public.corpus_records WHERE dataset='verdict_reports') OR (SELECT ready FROM public.corpus_datasets WHERE id='verdict_reports') IS DISTINCT FROM false THEN RAISE EXCEPTION 'VERDICT_PUBLIC_HOLD_FAILED'; END IF;
END $hold$;
COMMIT;
