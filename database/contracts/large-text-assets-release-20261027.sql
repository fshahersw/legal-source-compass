-- large-text-assets-release/2026-10-27.1  (workstream release/dataset-large-text-assets)
-- Owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT".
--
-- What is held today (read-only survey 2026-10-27; packet private/acq/release-dataset-large-text-assets/):
--   * public.corpus_datasets large_text_assets: ready = false, metadata.reader_only = true, expected_records 155 (stale: the
--     77 open_us_law rows large-text:oul:* went on 2026-10-06), imported_records 78, 78 live rows. No row records a seal,
--     restriction or policy hold; the hold came with the bundle import (caution).
--   * public.corpus_artifacts: 156 routes /api/text?id=<id> and /api/text?id=doc%3A<alias> (two per row), all ready = false,
--     78 content-addressed objects, 977,775,112 bytes catalogued.
--   * storage.objects (bucket corpus-originals): only ONE of the 78 objects exists: 2e/2ee81cc5... (3,153,723 bytes,
--     text/plain), the full text of "Grady County Ordinances" (gradycountyga.gov, the county government's own PDF).
--     The other 77 objects are not in any bucket (checked by key and by sha256 in every bucket name).
--
-- Released here (accurate, official publisher, bytes present):
--   * large-text:f6f572ee6ca009b460712aac316397d6 "Grady County Ordinances" moves to the new ready dataset
--     large_text_official, with download and source links the record page can render, and its two /api/text routes
--     become ready. Its label "pending_publication" was a staging label, not a source restriction.
--
-- Kept out, with the evidence (not caution):
--   * 44 rows from olls.info (41 Colorado Revised Statutes 2026 titles, 3 constitution files): statute source rule
--     (official publisher only). leg.colorado.gov links the C.R.S. only to LexisNexis; no General Assembly page links
--     olls.info; the host is shared commercial hosting, not coleg.gov (scripts/state_law/states/co.py, re-checked
--     2026-10-27). Release them with the same owner confirmation of olls.info as the CO code. Their stored text objects
--     are also absent (0 of 44), so confirmation alone would not make them downloadable.
--   * 33 rows from official publishers (legis.iowa.gov 9, legislature.maine.gov 6, doa.la.gov 5, uscode.house.gov 4,
--     law.lis.virginia.gov 3, nebraskalegislature.gov 2, oregonlegislature.gov 1, pub.njleg.state.nj.us 1, govinfo.gov 1,
--     ncleg.gov 1): nothing to serve. Their full-text objects are not in storage (0 of 33), so a ready flag would only turn a
--     404 "not available in the corpus" into a 404 "not available in storage". Their parents in the ready datasets
--     focused/seeger already show the same source and a 1,000,000-character preview. Restore = re-acquire from the
--     official URL (lead action), then re-run this contract's selection rule.
--   The large_text_assets catalog row is corrected to the live counts (77) and records these two hold reasons.
--
-- ROLLBACK: database/contracts/large-text-assets-release-20261027.rollback.sql (exact before-images).
-- VERIFY:   database/contracts/verify-large-text-assets-release-20261027.sql
--
-- Run as one transaction (psql -v ON_ERROR_STOP=1 -1 -f, or paste whole into the SQL editor).

begin;
set local statement_timeout = '60s';

-- ===== statement 0: preflight (raises and aborts on any unexpected state) =====
do $$
declare
  v_ready boolean; v_meta_md5 text; v_expected bigint; v_imported bigint;
  v_rows bigint; v_row_md5 text; v_routes bigint; v_objects bigint; v_co bigint; v_present bigint;
begin
  if exists (select 1 from public.corpus_datasets where id = 'large_text_official') then
    raise exception 'large_text_official already exists: this release was applied (or a different one exists)' using errcode = '55000';
  end if;
  select d.ready, md5(d.metadata::text), d.expected_records, d.imported_records
    into v_ready, v_meta_md5, v_expected, v_imported
    from public.corpus_datasets d where d.id = 'large_text_assets';
  if v_ready is distinct from false or v_meta_md5 is distinct from '6a920e34bc334ea6fedfee88e35ea31d'
     or v_expected is distinct from 155 or v_imported is distinct from 78 then
    raise exception 'large_text_assets catalog row changed since the survey (ready %, metadata md5 %, expected %, imported %)',
      v_ready, v_meta_md5, v_expected, v_imported using errcode = '55000';
  end if;
  select count(*) into v_rows from public.corpus_records where dataset = 'large_text_assets';
  if v_rows <> 78 then raise exception 'large_text_assets has % rows, expected 78', v_rows using errcode = '55000'; end if;
  select md5((to_jsonb(r) - 'search_vector')::text) into v_row_md5
    from public.corpus_records r where r.dataset = 'large_text_assets' and r.id = 'large-text:f6f572ee6ca009b460712aac316397d6';
  if v_row_md5 is distinct from '32eeb8bdf92a1b10d2ccf7f9c627efda' then
    raise exception 'Grady County row changed since the survey (md5 %)', v_row_md5 using errcode = '55000';
  end if;
  select count(*), count(o.name) into v_routes, v_objects
    from public.corpus_artifacts a
    left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
         and (o.metadata->>'size') = a.bytes::text
    where a.route in ('/api/text?id=f6f572ee6ca009b460712aac316397d6', '/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166')
      and a.ready = false and a.bytes = 3153723
      and a.sha256 = '2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660'
      and a.object_key = '2e/2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660';
  if v_routes <> 2 or v_objects <> 2 then
    raise exception 'Grady County text routes/object not as surveyed (routes %, with stored object %)', v_routes, v_objects using errcode = '55000';
  end if;
  -- The selection rule this release applies: not olls.info, and every reader alias route has its stored object.
  with a as (
    select r.id, substring(r.source_url from '^https?://([^/]+)') as host,
           count(*) as aliases, count(o.name) as present
    from public.corpus_records r
    cross join lateral jsonb_array_elements_text(r.detail->'metadata'->'reader_aliases') al(alias)
    left join public.corpus_artifacts ca on ca.route = '/api/text?id=' || replace(al.alias, ':', '%3A')
    left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = ca.object_key and (o.metadata->>'size') = ca.bytes::text
    where r.dataset = 'large_text_assets'
    group by r.id, r.source_url)
  select count(*) filter (where host = 'olls.info'), count(*) filter (where host <> 'olls.info' and present = aliases and aliases > 0)
    into v_co, v_present from a;
  if v_co <> 44 or v_present <> 1 then
    raise exception 'Selection rule no longer gives the surveyed split (olls.info %, releasable %)', v_co, v_present using errcode = '55000';
  end if;
end $$;

-- ===== statement 1: the new ready dataset =====
insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, manifest_sha256, metadata, updated_at)
values ('large_text_official', 'Complete legal texts from official publishers', true, 1, 1, null,
  jsonb_build_object(
    'id', 'large_text_official',
    'label', 'Complete legal texts from official publishers',
    'rows', 1,
    'categories', jsonb_build_object('statutes', 1),
    'listing', jsonb_build_object('available', true, 'results', '[]'::jsonb,
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'publisher', 'label', 'Publisher'),
        jsonb_build_object('key', 'document', 'label', 'Document'),
        jsonb_build_object('key', 'captured', 'label', 'Captured'),
        jsonb_build_object('key', 'size', 'label', 'Text size')),
      'qualification', 'Plain text taken from a publisher''s own file. The publisher''s file is the authoritative version.'),
    'qualification', 'Plain text taken from a publisher''s own file. The publisher''s file is the authoritative version.',
    'source', jsonb_build_object('released_from', 'large_text_assets', 'release', 'large-text-assets-release/2026-10-27.1',
      'rule', 'Official government publisher, and the stored text object exists with its catalogued size.')),
  now());

-- ===== statement 2: move and complete the Grady County record =====
update public.corpus_records r set
  dataset = 'large_text_official',
  ordinal = 1,
  item = jsonb_build_object(
    'id', r.id,
    'dataset', 'large_text_official',
    'kind', 'cleaned_full_text',
    'category', r.category,
    'state', r.state,
    'title', r.title,
    'subtitle', 'Grady County, Georgia: complete text of the county''s published ordinances PDF',
    'cells', jsonb_build_object(
      'publisher', 'Grady County, Georgia (gradycountyga.gov)',
      'document', 'County ordinances (PDF)',
      'captured', '2026-09-18',
      'size', '3,148,045 characters'),
    'links', jsonb_build_array(
      jsonb_build_object('url', '/api/text?id=f6f572ee6ca009b460712aac316397d6', 'label', 'Complete text (plain text, 3.2 MB)'),
      jsonb_build_object('url', r.source_url, 'label', 'Official PDF (gradycountyga.gov)')),
    'source_url', r.source_url,
    'has_text', false,
    'text_url', '',
    'has_original', true,
    'original_url', '/api/text?id=f6f572ee6ca009b460712aac316397d6'),
  detail = (r.detail || jsonb_build_object(
    'dataset', 'large_text_official',
    'subtitle', 'Grady County, Georgia: complete text of the county''s published ordinances PDF',
    'qualification', 'Plain text taken from the county''s published PDF. The PDF on gradycountyga.gov is the authoritative version.',
    'facts', jsonb_build_array(
      jsonb_build_array('Publisher', 'Grady County, Georgia (gradycountyga.gov)'),
      jsonb_build_array('Document', 'County ordinances, published as one PDF'),
      jsonb_build_array('Captured', '2026-09-18'),
      jsonb_build_array('Text', '3,148,045 characters (3,153,723 bytes, UTF-8)'),
      jsonb_build_array('SHA-256 of the text', '2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660')),
    'links', jsonb_build_array(
      jsonb_build_object('url', '/api/text?id=f6f572ee6ca009b460712aac316397d6', 'label', 'Complete text (plain text, 3.2 MB)'),
      jsonb_build_object('url', r.source_url, 'label', 'Official PDF (gradycountyga.gov)'),
      jsonb_build_object('url', '#record/county_litigation/county-litigation%3A0cc4bbcfb4cd6c81e6e2d0d7d44963f1',
                         'label', 'Same PDF as a county source record')))),
  filters = r.filters || jsonb_build_object('_listing', 'yes', 'availability', jsonb_build_array('text'),
    'state', r.state, 'jurisdiction_level', 'county')
where r.dataset = 'large_text_assets' and r.id = 'large-text:f6f572ee6ca009b460712aac316397d6';

-- ===== statement 3: its two reader routes become servable =====
update public.corpus_artifacts a set ready = true
where a.route in ('/api/text?id=f6f572ee6ca009b460712aac316397d6', '/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166')
  and a.ready = false
  and exists (select 1 from storage.objects o where o.bucket_id = 'corpus-originals' and o.name = a.object_key
              and (o.metadata->>'size') = a.bytes::text);

-- ===== statement 4: large_text_assets catalog row = live counts + the recorded hold reasons =====
update public.corpus_datasets d set
  expected_records = s.n,
  imported_records = s.n,
  metadata = d.metadata || jsonb_build_object(
    'rows', s.n,
    'bundle_rows', 155,
    'categories', s.cats,
    'hold', jsonb_build_object(
      'recorded', '2026-10-27',
      'released_elsewhere', jsonb_build_object('dataset', 'large_text_official', 'rows', 1),
      'reasons', jsonb_build_array(
        jsonb_build_object('rows', s.co, 'rule', 'statute_source_official_publisher_only',
          'evidence', 'olls.info is not linked from any Colorado General Assembly page and is not on coleg.gov infrastructure; leg.colorado.gov links the C.R.S. only to LexisNexis. Release with the owner''s confirmation that olls.info is the OLLS''s own publication.'),
        jsonb_build_object('rows', s.n - s.co, 'rule', 'stored_text_missing',
          'evidence', 'The content-addressed text objects are not in corpus-originals; re-acquire from the official URL before release.')))),
  updated_at = now()
from (
  select count(*) as n,
         count(*) filter (where substring(r.source_url from '^https?://([^/]+)') = 'olls.info') as co,
         (select jsonb_object_agg(c.category, c.k) from (
            select r2.category, count(*) as k from public.corpus_records r2 where r2.dataset = 'large_text_assets' group by r2.category) c) as cats
  from public.corpus_records r where r.dataset = 'large_text_assets') s
where d.id = 'large_text_assets';

-- ===== statement 5: postflight =====
do $$
declare v_off bigint; v_held bigint; v_routes bigint; v_meta jsonb; v_exp bigint; v_imp bigint;
begin
  select count(*) into v_off from public.corpus_records where dataset = 'large_text_official';
  select count(*) into v_held from public.corpus_records where dataset = 'large_text_assets';
  select count(*) into v_routes from public.corpus_artifacts
    where route in ('/api/text?id=f6f572ee6ca009b460712aac316397d6', '/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166') and ready;
  select metadata, expected_records, imported_records into v_meta, v_exp, v_imp from public.corpus_datasets where id = 'large_text_assets';
  if v_off <> 1 or v_held <> 77 or v_routes <> 2 or v_exp <> 77 or v_imp <> 77
     or v_meta->'categories' <> '{"statutes": 63, "guidance": 6, "regulations": 5, "constitutions": 3}'::jsonb
     or (select ready from public.corpus_datasets where id = 'large_text_assets') is distinct from false
     or (select ready from public.corpus_datasets where id = 'large_text_official') is distinct from true then
    raise exception 'Postflight failed (official %, held %, ready routes %, expected %, imported %, categories %)',
      v_off, v_held, v_routes, v_exp, v_imp, v_meta->'categories' using errcode = '55000';
  end if;
end $$;

commit;
