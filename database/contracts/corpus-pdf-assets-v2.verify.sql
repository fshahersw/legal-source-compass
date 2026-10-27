-- corpus-pdf-assets-v2.verify.sql: read-only verification for corpus-pdf-assets-v2.sql (run before and after applying it).
-- Every statement is a SELECT; none writes. Expected values were read on 2026-10-27.
set local statement_timeout = '90s';

-- V1. live function body fingerprint. before: c9cc6c7aee5d16b6d4b4ef293f8c8099 / 10595 / writes_ppa true.
--     after: 395ddc99322510b0fe34cbf6543ccd6d / 10635 / writes_ppa false / writes_pqr false.
select md5(prosrc) body_md5, length(prosrc) len, prosecdef, proconfig,
       prosrc ~ 'public_projection_allowed' writes_ppa, prosrc ~ 'private_quarantine_required' writes_pqr
  from pg_proc where oid = 'public.corpus_admin_register_pdf_assets_v1(jsonb)'::regprocedure;

-- V2. grants unchanged: {postgres:EXECUTE, service_role:EXECUTE}
select array_agg(grantee || ':' || privilege_type order by grantee) grants from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'corpus_admin_register_pdf_assets_v1';

-- V3. history untouched (before = after):
--   courtlistener explicit_false/false 7,283 obs | courtlistener unknown/true 27,696 | courtlistener-public-locator unknown/true 101,424
--   docketbird provider_restricted_false/false 47,224 | docketbird unknown/true 13,432 | govinfo source_locator_not_sealing_related 1,179
--   official-court source_locator_not_sealing_related 6,585; total 204,823 (142,552 with pqr=true, 130,643 distinct PDFs)
select source_system,
       coalesce(observation->'source_privacy_qualification'->>'source_seal_status', observation->>'source_seal_status') seal,
       observation->'source_privacy_qualification'->>'private_quarantine_required' pqr,
       observation ? 'source_privacy_qualification' v1_annotation,
       count(*) obs, count(distinct sha256) pdfs
  from corpus_ingest.pdf_asset_observations group by 1,2,3,4 order by 1,2,3,4;

-- V4. availability unchanged (before = after): 204,687 associations; 204,686 open; 1 held
--     (official-court, withheld_by_policy=true: robots.txt-disallowed capture, owner/admin policy hold).
select source_system, public.corpus_pdf_availability_v1(source_system, provider_flags) availability, count(*) assoc, count(distinct sha256) pdfs
  from corpus_ingest.pdf_document_assets group by 1,2 order by 1,2;

-- V5. local bundle occurrences (before = after): unknown_local_blank 740 occ / 628 PDFs; locally_flagged_sealed 12 / 12.
select source_seal_status, private_quarantine_required, public_projection_allowed, count(*) occ, count(distinct sha256) pdfs
  from corpus_ingest.local_pdf_asset_occurrences group by 1,2,3 order by 1;

-- V6. comments. before: all NULL. after: the four texts from corpus-pdf-assets-v2.sql.
select a.attname, obj_description('corpus_ingest.pdf_asset_observations'::regclass, 'pg_class') table_comment,
       col_description('corpus_ingest.local_pdf_asset_occurrences'::regclass, a.attnum) col_comment
  from pg_attribute a
 where a.attrelid = 'corpus_ingest.local_pdf_asset_occurrences'::regclass
   and a.attname in ('private_quarantine_required', 'public_projection_allowed', 'source_seal_status');

-- V7. live functions that mention the PDF annotation keys. before: corpus_admin_register_pdf_assets_v1 (pqr, spq),
--     corpus_admin_register_local_bundle_pdf_assets_v1 (pqr), corpus_admin_local_bundle_pdf_assets_status_v1 (pqr).
--     after: corpus_admin_register_pdf_assets_v1 still matches spq (it strips the key) but not pqr; the two local
--     intake functions are unchanged (they assert the frozen packet values, they do not gate any reader).
select n.nspname || '.' || p.proname fn, p.prosrc ~ 'private_quarantine_required' pqr, p.prosrc ~ 'source_privacy_qualification' spq
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosrc ~ '(private_quarantine_required|source_privacy_qualification)' order by 1;

-- V8. after the next real registration batch: new observations carry source_seal_status and no v1 annotation.
select count(*) filter (where observation ? 'source_privacy_qualification') with_v1_annotation,
       count(*) filter (where observation ? 'source_seal_status' and not observation ? 'source_privacy_qualification') v2_rows
  from corpus_ingest.pdf_asset_observations where registered_at > now() - interval '1 day';
