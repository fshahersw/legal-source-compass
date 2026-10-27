-- SUPERSEDED, DO NOT APPLY (2026-10-27). Production received revision .2 from branch release/dataset-court-reference
-- (same run id c36e2186): all 253 records released, 250 seal files ready, only ilsd/mdd/nyappdiv seal files held.
-- This revision's extra hold of the aoc, cbca and compliance records was rejected under the owner decision of 2026-10-27
-- ("dont withhold any data"): the 'every id must exist in court_spine' gate has no source in the repo or the release plan,
-- the seal images are accurate, and they are shown only on their own court_reference records, never bound to a court page.
-- This file's preflight refuses anyway (run c36e2186 already exists). Use release/dataset-court-reference's rollback.
-- court-reference-release/2026-10-27.3  (run c36e2186-fb92-42bb-8632-4bd599772cff; branch release/dataset-court-reference-seals,
-- which carries and supersedes release/dataset-court-reference at f816a656; the run id was never applied: 0 runs rows, 0 ledger rows)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What is held today (read-only survey 2026-10-27, re-checked before this revision):
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
--     CourtListener court id only. 250 of 253 ids exist in court_spine; aoc, cbca and compliance do not (see below).
--   * No record mentions a seal, restriction or hold of its own (keyword scan of corpus_records.text: 0 rows).
--
-- Every one of the 253 seal images was looked at against its record's court name (contact sheets, 2026-10-27).
-- Kept out, with the evidence (the image itself names a different court; inaccurate, not a caution hold):
--   * ilsd (District Court, S.D. Illinois): its seal file is byte-identical to insd's (sha256 5f1302fa...), and the image reads
--     "United States District Court - Southern District of Indiana". insd keeps the same object.
--   * mdd (District Court, D. Maryland, a federal court): the image (sha256 92dafe7e...) reads "District Court of Maryland" and
--     shows the handshake-and-scales seal of the State of Maryland's District Court, a different (state) court.
--   * nyappdiv (Appellate Division of the Supreme Court of the State of New York): the image (sha256 e22c5eee...) reads
--     "State of New York Court of Appeals", the seal of the state's highest court, not of the Appellate Division.
--   For these three the artifact stays ready = false and the record keeps its courts-db facts without the seal link
--   (ledgered before-images). The court pages fall back to their other marks or the labelled court-type emblem.
--   * me (Maine Supreme Judicial Court): held by the source build itself (validation.json seals_held: the original does not match
--     the SHA-256 printed in the seal-rookery index). It was never imported; nothing to release.
-- Reviewed and kept (accurate for the court id): idb/idd share the "United States Courts District of Idaho" seal (one court
-- house for both); tennworkcompapp/tennworkcompcl carry the Great Seal of the State of Tennessee as seal-rookery publishes it;
-- nmib/vib show the territorial district court seal (those district courts hear the bankruptcy cases themselves).
-- Kept out as whole records (revision .3; the release plan's gate "every record id exists in court_spine, do not publish any
-- that fail"): aoc (Administrative Office of the United States Courts), cbca (Civilian Board of Contract Appeals) and
-- compliance (Office of Compliance, United States Congress). Their seal images are genuine, but each record is a seal and
-- nothing else: no courts-db facts (detail.facts = []), no CourtListener court (corpus_ingest.entities: 0 rows) and no
-- court_spine row, so the "Open in the court registry" link resolves to nothing and the seal cannot be bound to a court page
-- by an exact court id (owner rules: court artwork and images bind only by exact identifiers). Two of the three are not courts.
-- The complete rows go to corpus_ingest.cleanup_decisions (issue court_reference_no_court_spine_id) and leave
-- public.corpus_records; their artifacts stay held. If the lead or owner prefers to publish them as unbound seals, the
-- rollback re-inserts them byte-for-byte.
--   Everything else is released: 250 records, 247 seal files (6 artifacts stay held).
--
-- Prerequisite (storage, not SQL): upload the 250 objects with read-back verification:
--   node scripts/admin/upload-court-reference-seals.mjs --seals=C:/Users/firas/Downloads/SCRAPE/sources/court_reference_flp_20260920/seals \
--        --out=private/acq/release-dataset-court-reference --execute
-- The preflight below refuses to run until every object exists with the recorded size. (The objects behind the three held
-- artifacts are uploaded too; the bucket is private and the held rows are not served.)
--
-- ROLLBACK: database/contracts/court-reference-release-20261027.rollback.sql (exact; restores the six records from the ledger).
-- VERIFY:   database/contracts/verify-court-reference-release-20261027.sql
--
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f, or paste whole into the SQL editor).

begin;
set local statement_timeout = '60s';

create temporary table court_reference_kept_out_20261027 (
  id text primary key,
  sha256 text not null,
  before_md5 text not null,
  court text not null,
  reason text not null,
  image_text text not null,
  shown_text text not null
) on commit drop;

insert into court_reference_kept_out_20261027 values
  ('ilsd', '5f1302fa5bb3fc389550f1e1576377bac64377356835f7e86b4bf6c32df6476b',
   '26a85010599051ab3d736d308a71d811' || '4984c7540e8f3a8fdcefb99b85e9a7f5' || '6110ae89cd4f5159cb2d372d9d17e0ba',
   'District Court, S.D. Illinois',
   'The seal file published for ilsd (S.D. Illinois) is byte-identical to the insd file and shows the Southern District of Indiana seal.',
   'United States District Court Southern District of Indiana',
   'The publisher''s seal file for this court id is the S.D. Indiana seal, so it is not shown here.'),
  ('mdd', '92dafe7e777490d5ff30f3f7b93ebc9ed075300f431ae78026b3fd42ec3ed358',
   '3bf9c9c885770d7410b4b0a1b2108ac5' || 'b4177322ee56f2b84b6c6898b38c99c6' || '96fde658896969e6f5da7aaa94105f97',
   'District Court, D. Maryland',
   'The seal file published for mdd (the federal District Court, D. Maryland) reads "District Court of Maryland" and is the seal of the State of Maryland''s District Court, a different court.',
   'District Court of Maryland',
   'The publisher''s seal file for this court id is the seal of the state District Court of Maryland, a different court, so it is not shown here.'),
  ('nyappdiv', 'e22c5eeeffda6b83f67fa7a5efb67aa01487e8ff4d91cd206fb07942c2bc401e',
   '89980b68c7b80473296134a73c05cf52' || 'f2a2f1b86ea41595d5c7b08ec169677a' || '0e4f0253ac3b8b235cd1a8de28d28143',
   'Appellate Division of the Supreme Court of the State of New York',
   'The seal file published for nyappdiv (Appellate Division) reads "State of New York Court of Appeals": it is the seal of a different court.',
   'State of New York Court of Appeals',
   'The publisher''s seal file for this court id is the New York Court of Appeals seal, a different court, so it is not shown here.');

-- Whole records kept out: seal-only records whose id has no court_spine (CourtListener) court to bind to.
create temporary table court_reference_unbound_20261027 (
  id text primary key,
  sha256 text not null,
  before_md5 text not null,
  body text not null
) on commit drop;

insert into court_reference_unbound_20261027 values
  ('aoc', '4605374fc146fbbe1cc06ead46998b58de18f0cfe7ba681bcdfacf17c5ef809e',
   'f6f4d6bf8604b30ea192a725d11a0851' || '54761f62e8f2ee2a839fa78fd171aab0' || 'b9c30fe78895b5056b352ba41e1648cf',
   'Administrative Office of the United States Courts'),
  ('cbca', '5ba8cca66d243fc907ea7256795cc5c7f32c2417ec6cad4813ce36e32dd37201',
   '6b7f11755106d3da21ff246c639cc59f' || '648982d736a159887f4230e1b6c14f9d' || '1a14756eaaf43a9e547500c325d4908b',
   'Civilian Board of Contract Appeals'),
  ('compliance', '5680bce6eb50b0c44ffc8844b79165b4dc7595f239bb85fd5c323dcb7b4790e1',
   'e015f25af49bc5315bb604ac9b12ad48' || '4b60564735d0d0590c2d389051c57b7e' || '6c5cf781381c954d2373d339846f03dc',
   'Office of Compliance, United States Congress');

-- ===== statement 0: preflight (raises and aborts on any unexpected state) =====
do $$
declare
  v_ready boolean; v_meta_ready jsonb; v_records bigint; v_art bigint; v_art_ready bigint; v_missing bigint; v_changed bigint;
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
  -- the three kept-out records and artifacts are exactly as reviewed
  select count(*) into v_changed
    from court_reference_kept_out_20261027 k
    left join public.corpus_records r on r.dataset = 'court_reference' and r.id = k.id
    left join public.corpus_artifacts a on a.route = '/supplement-files/court_reference/' || k.id
   where r.id is null or a.route is null
      or md5(r.item::text) || md5(r.detail::text) || md5(r.text) is distinct from k.before_md5
      or a.sha256 is distinct from k.sha256;
  if v_changed <> 0 then
    raise exception 'PREFLIGHT: % kept-out records or seal files changed since the review; re-review before release', v_changed;
  end if;
  -- the unbound records are exactly the ids without a court_spine row, unchanged since the review
  select count(*) into v_changed
    from court_reference_unbound_20261027 u
    left join public.corpus_records r on r.dataset = 'court_reference' and r.id = u.id
    left join public.corpus_artifacts a on a.route = '/supplement-files/court_reference/' || u.id
   where r.id is null or a.route is null
      or md5(r.item::text) || md5(r.detail::text) || md5(r.text) is distinct from u.before_md5
      or a.sha256 is distinct from u.sha256
      or exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = u.id);
  if v_changed <> 0 then
    raise exception 'PREFLIGHT: % unbound records changed or gained a court_spine row since the review; re-review before release', v_changed;
  end if;
  if (select string_agg(r.id, ',' order by r.id) from public.corpus_records r
       where r.dataset = 'court_reference'
         and not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id))
     is distinct from 'aoc,cbca,compliance' then
    raise exception 'PREFLIGHT: the court_reference ids without a court_spine row are no longer exactly aoc, cbca, compliance';
  end if;
  if exists (select 1 from corpus_ingest.runs where id = 'c36e2186-fb92-42bb-8632-4bd599772cff') then
    raise exception 'PREFLIGHT: run c36e2186 already recorded; run the rollback first or use a new run id';
  end if;
end $$;

-- ===== statement 1: run row =====
insert into corpus_ingest.runs (id, contract_version, status, scope, counts)
values ('c36e2186-fb92-42bb-8632-4bd599772cff'::uuid, 'court-reference-release/2026-10-27.3', 'completed',
        jsonb_build_object('dataset', 'court_reference', 'owner_decision', '2026-10-27 dont withhold any data',
                           'branch', 'release/dataset-court-reference-seals'),
        jsonb_build_object('records_released', 250, 'records_kept_held', 3, 'artifacts_released', 247, 'artifacts_kept_held', 6));

-- ===== statement 2: ilsd, mdd, nyappdiv keep their facts and lose the wrong court's seal (ledgered before-images) =====
with src as (
  select r.id, r.item, r.detail, r.text, k.sha256, k.court, k.reason, k.image_text, k.shown_text
    from public.corpus_records r join court_reference_kept_out_20261027 k on k.id = r.id
   where r.dataset = 'court_reference'
),
aud as (
  insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'court_reference', src.id, 'court_reference_seal_wrong_court', 'quarantine',
         src.reason || ' The record keeps its courts-db facts; the seal link is removed and the artifact stays held.',
         jsonb_build_object('review_version', 'court-reference-release/2026-10-27.3',
                            'sha256', src.sha256, 'image_text', src.image_text,
                            'artifact_route', '/supplement-files/court_reference/' || src.id),
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
                    'items', jsonb_build_array(jsonb_build_object('title', 'Seal not shown', 'subtitle', src.shown_text)))) ||
                  coalesce((select jsonb_agg(s order by o) from jsonb_array_elements(r.detail->'sections') with ordinality t(s, o)
                             where s->>'heading' <> 'Court seal'), '[]'::jsonb)),
       text = replace(r.text,
                'Court seal ' || src.court || ' Hash-verified original, reduced to 256 px. A seal identifies the court; it is not an endorsement. Court seal image',
                'Court seal Seal not shown ' || src.shown_text)
  from aud join src on src.id = aud.record_id
 where r.dataset = 'court_reference' and r.id = aud.record_id;

-- ===== statement 2b: aoc, cbca, compliance leave the dataset (complete rows ledgered first; delete only what was ledgered) =====
with src as (
  select r.*, u.body, u.sha256
    from public.corpus_records r join court_reference_unbound_20261027 u on u.id = r.id
   where r.dataset = 'court_reference'
),
aud as (
  insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
  select 'court_reference', src.id, 'court_reference_no_court_spine_id', 'quarantine',
         'Seal-only record for ' || src.body || ': the id has no court_spine (CourtListener) court and no courts-db facts, so the seal '
           || 'cannot be bound to a court by an exact court id. The image is genuine; the record is kept out, not corrected. '
           || 'The complete row is kept here and the seal artifact stays held.',
         jsonb_build_object('review_version', 'court-reference-release/2026-10-27.3',
                            'gate', 'release plan: every court_reference record id exists in court_spine',
                            'court_spine_row', false, 'courtlistener_court_entity', false, 'courts_db_facts', 0,
                            'sha256', src.sha256, 'artifact_route', '/supplement-files/court_reference/' || src.id),
         to_jsonb(src) - 'body' - 'sha256' - 'search_vector',
         null, 'c36e2186-fb92-42bb-8632-4bd599772cff'::uuid
    from src
  returning record_id
)
delete from public.corpus_records r
 using aud
 where r.dataset = 'court_reference' and r.id = aud.record_id;

-- ===== statement 3: release 247 seal files (the six kept-out files stay held) =====
update public.corpus_artifacts a
   set ready = true
 where a.route like '/supplement-files/court_reference/%'
   and a.route not in (select '/supplement-files/court_reference/' || id from court_reference_kept_out_20261027)
   and a.route not in (select '/supplement-files/court_reference/' || id from court_reference_unbound_20261027)
   and a.ready = false
   and exists (select 1 from storage.objects o
                where o.bucket_id = 'corpus-originals' and o.name = a.object_key and (o.metadata->>'size')::bigint = a.bytes);

-- ===== statement 4: release the dataset (column, its derived metadata copy, and the live record count) =====
-- expected/imported_records and the listing totals follow the 250 records left (the court_spine quarantine pattern);
-- metadata.summary, export_jsonl_sha256 and manifest_sha256 stay as the export receipt of the 253-row build.
update public.corpus_datasets d
   set ready = true,
       expected_records = c.n,
       imported_records = c.n,
       metadata = jsonb_set(jsonb_set(jsonb_set(d.metadata, '{ready}', 'true'::jsonb),
                    '{listing,total}', to_jsonb(c.n)), '{listing_modes,default,total}', to_jsonb(c.n))
                  || jsonb_build_object('release_20261027', jsonb_build_object(
                       'run_id', 'c36e2186-fb92-42bb-8632-4bd599772cff',
                       'contract_version', 'court-reference-release/2026-10-27.3',
                       'basis', 'owner decision 2026-10-27: release caution-only holds',
                       'records_before', 253,
                       'kept_held', (select jsonb_agg(jsonb_build_object('route', '/supplement-files/court_reference/' || id,
                                       'reason', 'seal file shows another court: ' || image_text) order by id)
                                       from court_reference_kept_out_20261027),
                       'records_kept_held', (select jsonb_agg(jsonb_build_object('court_id', id, 'name', body,
                                       'reason', 'seal-only record; no court_spine court and no courts-db facts to bind it to') order by id)
                                       from court_reference_unbound_20261027),
                       'not_imported_by_source', jsonb_build_array(jsonb_build_object('court_id', 'me',
                                     'reason', 'seal-rookery original does not match the published index SHA-256')))),
       updated_at = now()
  from (select count(*)::bigint as n from public.corpus_records where dataset = 'court_reference') c
 where d.id = 'court_reference' and d.ready = false;

-- ===== statement 5: postflight (aborts the transaction if the result is not exact) =====
do $$
begin
  if (select ready from public.corpus_datasets where id = 'court_reference') is distinct from true then
    raise exception 'POSTFLIGHT: dataset not ready';
  end if;
  if (select count(*) from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and ready) <> 247 then
    raise exception 'POSTFLIGHT: expected 247 ready seal artifacts';
  end if;
  if (select string_agg(replace(route, '/supplement-files/court_reference/', ''), ',' order by route)
        from public.corpus_artifacts where route like '/supplement-files/court_reference/%' and not ready)
     is distinct from 'aoc,cbca,compliance,ilsd,mdd,nyappdiv' then
    raise exception 'POSTFLIGHT: the held seal files must be exactly aoc, cbca, compliance, ilsd, mdd, nyappdiv';
  end if;
  if (select count(*) from public.corpus_records where dataset = 'court_reference') <> 250
     or (select imported_records from public.corpus_datasets where id = 'court_reference') <> 250 then
    raise exception 'POSTFLIGHT: expected 250 court_reference records and imported_records = 250';
  end if;
  if exists (select 1 from public.corpus_records r where r.dataset = 'court_reference'
              and not exists (select 1 from public.corpus_records s where s.dataset = 'court_spine' and s.id = r.id)) then
    raise exception 'POSTFLIGHT: a released court_reference record has no court_spine row';
  end if;
  -- every ready seal is linked only from its own released record; no released record links a held seal
  if exists (select 1 from public.corpus_records r
               join public.corpus_artifacts a on a.route = '/supplement-files/court_reference/' || r.id and not a.ready
              where r.dataset = 'court_reference' and (r.item::text || r.detail::text) like '%' || a.route || '%') then
    raise exception 'POSTFLIGHT: a released record links a held seal';
  end if;
  if exists (select 1 from public.corpus_records r join court_reference_kept_out_20261027 k on k.id = r.id
              where r.dataset = 'court_reference'
                and (r.item::text like '%/supplement-files/court_reference/%' or r.detail::text like '%/supplement-files/court_reference/%'
                     or r.text like '%Court seal image%')) then
    raise exception 'POSTFLIGHT: a kept-out record still links its held seal';
  end if;
  if (select count(*) from corpus_ingest.cleanup_decisions where run_id = 'c36e2186-fb92-42bb-8632-4bd599772cff') <> 6 then
    raise exception 'POSTFLIGHT: expected six ledger rows';
  end if;
end $$;

commit;
