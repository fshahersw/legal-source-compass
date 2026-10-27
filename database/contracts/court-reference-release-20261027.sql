-- court-reference-release/2026-10-27.1  (run c36e2186-fb92-42bb-8632-4bd599772cff; workstream release/dataset-court-reference)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What is held today (read-only survey 2026-10-27):
--   * public.corpus_datasets court_reference: ready = false, metadata.ready = false, 253 records (expected = imported = 253,
--     manifest_sha256 8558cd4e...). The hold came with the imported bundle (docs/corpus-audit-2026-10-02.md "held collection
--     inventory") and has no recorded reason: caution only.
--   * public.corpus_artifacts: 253 seal PNGs at /supplement-files/court_reference/<court id>, all ready = false, 250 distinct
--     content-addressed objects; NONE of the 250 objects is in the corpus-originals bucket yet. The files are the source bundle
--     C:/Users/firas/Downloads/SCRAPE/sources/court_reference_flp_20260920/seals; all 253 match the artifact rows exactly
--     (md5 of the C-sorted "id sha256 bytes" lines = 3f00f295bafaa7489b512301fed90676 on both sides;
--     database/contracts/court-reference-seals-20261027.sha256). court_reference.sqlite3 and validation.json match the
--     dataset metadata's recorded SHA-256s (525787817c47... and 4e3314ff799b...).
--   * Source: Free Law Project courts-db (BSD-2-Clause, commit be4fe57b) and seal-rookery (commit 784c3238); bound by identical
--     CourtListener court id only. 250 of 253 ids exist in court_spine; aoc, cbca and compliance do not and stay unlinked.
--   * No record mentions a seal, restriction or hold of its own (keyword scan of corpus_records.text: 0 rows).
--
-- Kept out, with the evidence:
--   * ilsd (District Court, S.D. Illinois): its seal file is byte-identical to insd's (sha256 5f1302fa...), and the image reads
--     "United States District Court - Southern District of Indiana". It is the wrong court's seal, so the ilsd artifact stays
--     ready = false and the ilsd record loses its seal link (its courts-db facts stay). insd keeps the same object.
--     The ilsd court page keeps its labelled court-type emblem. (The visual registry's stateCourts.ilsd entry carries the same
--     wrong file; it does not render for a federal court today; see the release notes.)
--   * me (Maine Supreme Judicial Court): held by the source build itself (validation.json seals_held: the original does not match
--     the SHA-256 printed in the seal-rookery index). It was never imported; nothing to release.
--   Everything else is released: 253 records, 252 seal files (230 hash-verified originals and 22 project renditions of SVG-only
--   seals, marked as such; ilsd was a hash-verified original).
--
-- Prerequisite (storage, not SQL): upload the 250 objects with read-back verification:
--   node scripts/admin/upload-court-reference-seals.mjs --seals=C:/Users/firas/Downloads/SCRAPE/sources/court_reference_flp_20260920/seals \
--        --out=private/acq/release-dataset-court-reference --execute
-- The preflight below refuses to run until every object exists with the recorded size.
--
-- ROLLBACK: database/contracts/court-reference-release-20261027.rollback.sql (exact; restores the ilsd record from the ledger).
-- VERIFY:   database/contracts/verify-court-reference-release-20261027.sql
--
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f, or paste whole into the SQL editor).

begin;
set local statement_timeout = '60s';

-- ===== statement 0: preflight (raises and aborts on any unexpected state) =====
do $$
declare
  v_ready boolean; v_meta_ready jsonb; v_records bigint; v_art bigint; v_art_ready bigint; v_missing bigint; v_ilsd text;
begin
  select ready, metadata->'ready' into v_ready, v_meta_ready from public.corpus_datasets where id = 'court_reference';
  if v_ready is distinct from false or v_meta_ready is distinct from 'false'::jsonb then
    raise exception 'PREFLIGHT: court_reference is not in the held state (ready=%, metadata.ready=%)', v_ready, v_meta_ready;
  end if;
  select count(*) into v_records from public.corpus_records where dataset = 'court_reference';
  if v_records <> 253 then raise exception 'PREFLIGHT: expected 253 court_reference records, found %', v_records; end if;
  select count(*), count(*) filter (where ready) into v_art, v_art_ready
    from public.corpus_artifacts where route like '/supplement-files/court_reference/%';
  if v_art <> 253 or v_art_ready <> 0 then
    raise exception 'PREFLIGHT: expected 253 held seal artifacts, found % (% ready)', v_art, v_art_ready;
  end if;
  select count(*) into v_missing
    from public.corpus_artifacts a
    left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
   where a.route like '/supplement-files/court_reference/%'
     and (o.name is null or (o.metadata->>'size')::bigint is distinct from a.bytes or a.object_key <> left(a.sha256, 2) || '/' || a.sha256);
  if v_missing <> 0 then
    raise exception 'PREFLIGHT: % seal artifacts have no stored object of the recorded size; run upload-court-reference-seals.mjs --execute first', v_missing;
  end if;
  select md5(item::text) || md5(detail::text) || md5(text) into v_ilsd
    from public.corpus_records where dataset = 'court_reference' and id = 'ilsd';
  if v_ilsd is distinct from '26a85010599051ab3d736d308a71d811' || '4984c7540e8f3a8fdcefb99b85e9a7f5' || '6110ae89cd4f5159cb2d372d9d17e0ba' then
    raise exception 'PREFLIGHT: the ilsd record changed since the survey';
  end if;
  if (select sha256 from public.corpus_artifacts where route = '/supplement-files/court_reference/ilsd')
     is distinct from (select sha256 from public.corpus_artifacts where route = '/supplement-files/court_reference/insd') then
    raise exception 'PREFLIGHT: ilsd and insd no longer share one seal file; re-review before release';
  end if;
end $$;

-- ===== statement 1: run row =====
insert into corpus_ingest.runs (id, contract_version, status, scope, counts)
values ('c36e2186-fb92-42bb-8632-4bd599772cff'::uuid, 'court-reference-release/2026-10-27.1', 'completed',
        jsonb_build_object('dataset', 'court_reference', 'owner_decision', '2026-10-27 dont withhold any data',
                           'branch', 'release/dataset-court-reference'),
        jsonb_build_object('records_released', 253, 'artifacts_released', 252, 'artifacts_kept_held', 1));

-- ===== statement 2: ilsd keeps its facts, loses the wrong court's seal (ledgered before-image) =====
with src as (
  select id, item, detail, text from public.corpus_records where dataset = 'court_reference' and id = 'ilsd'
),
aud as (
  insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'court_reference', 'ilsd', 'court_reference_seal_wrong_court', 'quarantine',
         'The seal file published for ilsd (S.D. Illinois) is byte-identical to the insd file and shows the Southern District of Indiana seal. The record keeps its courts-db facts; the seal link is removed and the ilsd artifact stays held.',
         jsonb_build_object('review_version', 'court-reference-release/2026-10-27.1',
                            'sha256', '5f1302fa5bb3fc389550f1e1576377bac64377356835f7e86b4bf6c32df6476b',
                            'same_file_as', 'insd', 'image_text', 'United States District Court Southern District of Indiana',
                            'artifact_route', '/supplement-files/court_reference/ilsd'),
         jsonb_build_object('item', src.item, 'detail', src.detail, 'text', src.text),
         null, 'c36e2186-fb92-42bb-8632-4bd599772cff'::uuid
    from src
  returning record_id
)
update public.corpus_records r
   set item = jsonb_set(jsonb_set(r.item, '{links}', '[]'::jsonb), '{cells,origin}', to_jsonb('Seal held: the published file is another court''s seal'::text)),
       detail = jsonb_set(r.detail, '{sections}',
                  jsonb_build_array(jsonb_build_object(
                    'heading', 'Court seal',
                    'items', jsonb_build_array(jsonb_build_object(
                      'title', 'Seal not shown',
                      'subtitle', 'The publisher''s seal file for this court id is the S.D. Indiana seal, so it is not shown here.')))) ||
                  coalesce((select jsonb_agg(s) from jsonb_array_elements(r.detail->'sections') s where s->>'heading' <> 'Court seal'), '[]'::jsonb)),
       text = replace(r.text,
                'Court seal District Court, S.D. Illinois Hash-verified original, reduced to 256 px. A seal identifies the court; it is not an endorsement. Court seal image',
                'Court seal Seal not shown The publisher''s seal file for this court id is the S.D. Indiana seal, so it is not shown here.')
  from aud
 where r.dataset = 'court_reference' and r.id = aud.record_id;

-- ===== statement 3: release 252 seal files (ilsd stays held) =====
update public.corpus_artifacts a
   set ready = true
 where a.route like '/supplement-files/court_reference/%'
   and a.route <> '/supplement-files/court_reference/ilsd'
   and a.ready = false
   and exists (select 1 from storage.objects o
                where o.bucket_id = 'corpus-originals' and o.name = a.object_key and (o.metadata->>'size')::bigint = a.bytes);

-- ===== statement 4: release the dataset (column and its derived metadata copy) =====
update public.corpus_datasets
   set ready = true,
       metadata = jsonb_set(metadata, '{ready}', 'true'::jsonb)
                  || jsonb_build_object('release_20261027', jsonb_build_object(
                       'run_id', 'c36e2186-fb92-42bb-8632-4bd599772cff',
                       'basis', 'owner decision 2026-10-27: release caution-only holds',
                       'kept_held', jsonb_build_array(jsonb_build_object('route', '/supplement-files/court_reference/ilsd',
                                     'reason', 'file is the S.D. Indiana seal (same bytes as insd)')),
                       'not_imported_by_source', jsonb_build_array(jsonb_build_object('court_id', 'me',
                                     'reason', 'seal-rookery original does not match the published index SHA-256')))),
       updated_at = now()
 where id = 'court_reference' and ready = false;

-- ===== statement 5: postflight (aborts the transaction if the result is not exact) =====
do $$
begin
  if (select ready from public.corpus_datasets where id = 'court_reference') is distinct from true then
    raise exception 'POSTFLIGHT: dataset not ready';
  end if;
  if (select count(*) from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and ready) <> 252 then
    raise exception 'POSTFLIGHT: expected 252 ready seal artifacts';
  end if;
  if (select ready from public.corpus_artifacts where route = '/supplement-files/court_reference/ilsd') then
    raise exception 'POSTFLIGHT: ilsd seal must stay held';
  end if;
  if exists (select 1 from public.corpus_records where dataset = 'court_reference' and id = 'ilsd'
              and (item::text like '%/supplement-files/court_reference/ilsd%' or detail::text like '%/supplement-files/court_reference/ilsd%')) then
    raise exception 'POSTFLIGHT: ilsd record still links its held seal';
  end if;
  if (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff') <> 1 then
    raise exception 'POSTFLIGHT: expected one ledger row';
  end if;
end $$;

commit;
