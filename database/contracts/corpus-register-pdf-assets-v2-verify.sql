-- corpus-register-pdf-assets-v2-verify.sql: read-only checks for corpus-register-pdf-assets-v2.sql
-- (release pdf-observation-privacy-label, project xosqzzsnhxcyehcnirpa). SELECTs only.
--
-- Read-only baseline 2026-10-27: 204,823 observations (max verified_at 2026-10-08 00:19:41Z), 0 with the v2 'rule' key,
-- 142,552 private_quarantine_required=true (courtlistener-public-locator 101,424, courtlistener 27,696, docketbird 13,432),
-- 204,823 public_projection_allowed=false; the live gate answers open for 204,822 and held for 1
-- (official-court, provider_flags.withheld_by_policy=true: an explicit admin policy hold).

-- 1. Function text. Before apply: beaf86b57d3ffadee3f029bbe93b7fb6. After apply: f245cb3985cf2b2bf13a6f357fb828a1.
--    After rollback: beaf86b57d3ffadee3f029bbe93b7fb6 again.
select md5(pg_get_functiondef('public.corpus_admin_register_pdf_assets_v1(jsonb)'::regprocedure)) as register_fn_md5;

-- 2. Grants unchanged: execute for service_role only (plus the owner).
select grantee, privilege_type from information_schema.routine_privileges
 where routine_schema='public' and routine_name='corpus_admin_register_pdf_assets_v1' order by 1;

-- 3. Existing observations are not rewritten by the apply. Expect total 204823, with_rule 0, quarantine_true 142552
--    until the next registration adds rows (new rows only ever add to with_rule).
set local statement_timeout='60s';
select count(*) total,
 count(*) filter (where observation->'source_privacy_qualification' ? 'rule') with_rule,
 count(*) filter (where (observation->'source_privacy_qualification'->>'private_quarantine_required')::boolean) quarantine_true
from corpus_ingest.pdf_asset_observations;

-- 4. After the next registration: the newest labels carry {rule:'corpus_pdf_availability_v2', ...}.
select source_system, verified_at, observation->'source_privacy_qualification' as label
from corpus_ingest.pdf_asset_observations order by verified_at desc limit 5;

-- 5. v2 labels agree with the live gate. Expect mismatches 0 (an admin withhold applied after registration would show
--    here as a mismatch; the live gate, evaluated at read time, is what holds the PDF).
select count(*) filter (where (o.observation->'source_privacy_qualification'->>'public_projection_allowed')::boolean
        is distinct from (public.corpus_pdf_availability_v1(a.source_system,a.provider_flags)='open')) mismatches,
       count(*) v2_rows
from corpus_ingest.pdf_asset_observations o
join corpus_ingest.pdf_document_assets a using (source_system,native_document_id,source_record_sha256,sha256)
where o.observation->'source_privacy_qualification'->>'rule'='corpus_pdf_availability_v2';
