-- Recovery only, never a publication license. Default restores bytes while readiness stays false.
-- This transaction requires explicit administrator setting: SET LOCAL atlas.verdict_recovery_scope='b410de75-1b8d-4937-87f9-1a202d6a9672'.
BEGIN;
-- Insert the explicit SET LOCAL authorization above the DO block only for a reviewed recovery.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.corpus_records,public.corpus_datasets,public.corpus_context IN SHARE ROW EXCLUSIVE MODE;
DO $recover$
DECLARE n bigint; h text;
BEGIN
  IF current_setting('atlas.verdict_recovery_scope',true) IS DISTINCT FROM 'b410de75-1b8d-4937-87f9-1a202d6a9672' THEN RAISE EXCEPTION 'VERDICT_RECOVERY_NOT_EXPLICITLY_AUTHORIZED'; END IF;
  SELECT count(*),encode(extensions.digest(convert_to(string_agg(row_key||':'||row_sha256,E'\n' ORDER BY row_key),'UTF8'),'sha256'),'hex') INTO n,h FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records';
  IF n<>3312 OR h IS DISTINCT FROM '7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646' OR EXISTS(SELECT 1 FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(original_record::text,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'VERDICT_RECOVERY_ARCHIVE_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.corpus_records WHERE dataset='verdict_reports') OR (SELECT ready FROM public.corpus_datasets WHERE id='verdict_reports') IS DISTINCT FROM false THEN RAISE EXCEPTION 'VERDICT_RECOVERY_TARGET_NOT_HELD_EMPTY'; END IF;
  IF (SELECT metadata#>>'{visibility_hold,scope_id}' FROM public.corpus_datasets WHERE id='verdict_reports') IS DISTINCT FROM 'b410de75-1b8d-4937-87f9-1a202d6a9672' THEN RAISE EXCEPTION 'VERDICT_RECOVERY_HOLD_CHANGED'; END IF;
  IF (SELECT encode(extensions.digest(convert_to(pg_get_functiondef('public.corpus_set_search_vector()'::regprocedure),'UTF8'),'sha256'),'hex')) IS DISTINCT FROM 'bd4a2313af56239ee51918c5f08696aebf1e149bb8b02e422496bb0d38ec71a1'
     OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.corpus_records'::regclass AND tgname='corpus_records_search_vector_trg') IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'VERDICT_RECOVERY_TRIGGER_CHANGED'; END IF;
  -- The captured trigger rewrites even non-null vectors. Disable only that exact trigger while
  -- the table is exclusively write-locked, restore original vectors, then re-enable before commit.
  -- Failure rolls all DDL/data changes back together. RLS/security triggers stay enabled.
  ALTER TABLE public.corpus_records DISABLE TRIGGER corpus_records_search_vector_trg;
  INSERT INTO public.corpus_records SELECT (jsonb_populate_record(NULL::public.corpus_records,original_record)).* FROM corpus_ingest.public_visibility_quarantine_v1 WHERE scope_id='b410de75-1b8d-4937-87f9-1a202d6a9672' AND source_relation='public.corpus_records';
  ALTER TABLE public.corpus_records ENABLE TRIGGER corpus_records_search_vector_trg;
  SELECT count(*),encode(extensions.digest(convert_to(string_agg(id||':'||encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex'),E'\n' ORDER BY id),'UTF8'),'sha256'),'hex') INTO n,h FROM public.corpus_records r WHERE dataset='verdict_reports';
  IF n<>3312 OR h IS DISTINCT FROM '7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646' THEN RAISE EXCEPTION 'VERDICT_RECOVERY_FULL_ROW_MISMATCH'; END IF;
  UPDATE public.corpus_datasets SET ready=false,imported_records=3312,metadata=metadata||jsonb_build_object('ready',false,'imported_records',3312,'recovered_while_held',true),updated_at=now() WHERE id='verdict_reports';
  UPDATE public.corpus_context SET ready=false WHERE key IN ('supplement:verdict_settlement_reports_20260919','supplements:part:5fbfab3e59682dbe:000012');
  -- Exact original dataset/context JSON remains in the private archive for later review. Never reopen readiness here.
END $recover$;
COMMIT;
