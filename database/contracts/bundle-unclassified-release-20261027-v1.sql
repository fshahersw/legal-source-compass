-- Release of the bundle rows left out as "uncategorized" (owner decision 2026-10-27: "dont withhold any data. If its
-- accurate and valuable, USE IT"). Read-only verification contract: the rows are added by
-- scripts/enrichment/bundle_unclassified/publish_unclassified.py (corpus_writer.append: insert only, no delete, no
-- overwrite); this file holds the SELECTs the lead runs before and after. Rollback:
-- bundle-unclassified-release-20261027-v1.rollback.sql.
--
-- Packet: private/acq/release-bundle-uncategorized-exclusions/ (report.json, <dataset>.rows.jsonl, <dataset>.held.json,
-- live_before.json). Source snapshots (SHA-256 = the source_files in each dataset's live metadata):
--   court_documents   SCRAPE sources/court_document_library_20260919/index.sqlite3   38392e5e20fb435bdb703a9bc3a5f51f5fd4b9e29c6535ae43a23b5491509fc5
--   source_documents  SCRAPE sources/source_directory_documents_20260919/documents.sqlite3 4a23b7577218a12b36534650bbcef8beeb3de2c5fc594355ad968a68f080d06a
--
-- Expected numbers (dry run 2026-10-27):
--   court_documents   live 20,819 (= 20,861 imported - 42 ledgered url-alias quarantines); +30,049 Not classified
--                     (30,079 left out at build - 30 byte-identical files at an address alias) = 50,868
--   source_documents  live 612; +380 Not classified (381 - 1 github.com page view saved for a .json address) = 992
--   mdl_docket_documents  not in this release (bundle unit not on the build machine); 30,846 stay excluded.
--
-- Applied 2026-10-27 (lead): checks 1, 1b and 5 matched before; after: court_documents 50,868 (30,049 Not classified,
-- ordinals 20861-50909, ids_sha256 060036ea...), source_documents 992 (380, ordinals 612-991, ids_sha256 f9e081dc...),
-- check 4 = 0 mismatches. Check 5 after: source_documents unchanged (fd68a7a1...); court_documents changed to
-- de7ae989... because the court-document-titles keyword release applied 64 title updates at 22:51 UTC between the pre-
-- and post-checks (corpus_ingest.title_projection_plan stage keyword_release); the append itself only inserts new ids.

-- 1. PRE: the live state the packet was prepared against (must equal live_before.json).
-- expect court_documents 20819 | 359a84b3c04cb8459ff77e5eccaa855e | 20860 | 0
--        source_documents 612 | a01f44a7facfcc9f61a15768f5309bd1 | 611 | 0
set local statement_timeout = '60s';
select dataset,
       count(*) as live_rows,
       md5(string_agg(id, E'\n' order by id collate "C")) as ids_md5,
       max(ordinal) as max_ordinal,
       count(*) filter (where filters->'doc_type' ? 'other_unknown' or filters->'agency' ? 'uncategorized') as not_classified_rows
from public.corpus_records
where dataset in ('court_documents', 'source_documents')
group by dataset
order by dataset;

-- 1b. PRE: live + ledgered quarantines = the snapshot's classified set (expect 20861 | 761d6ecd6004bb17f108e433550048b2).
select count(*) as n, md5(string_agg(id, E'\n' order by id collate "C")) as ids_md5
from (select id from public.corpus_records where dataset = 'court_documents'
      union
      select record_id from corpus_ingest.cleanup_decisions
      where dataset = 'court_documents' and issue = 'cleanup_20261007_court_documents_url_norm_extra') s;

-- 2. POST: rows and catalog counts.
-- expect court_documents 50868 | 30049 | 50868 | 50868 | 0 | 30049 | true
--        source_documents 992 | 380 | 992 | 992 | 0 | 380 | true
select d.id,
       (select count(*) from public.corpus_records r where r.dataset = d.id) as live_rows,
       (select count(*) from public.corpus_records r where r.dataset = d.id
          and (r.filters->'doc_type' ? 'other_unknown' or r.filters->'agency' ? 'uncategorized')) as not_classified_rows,
       d.imported_records,
       d.expected_records,
       (d.metadata->'summary'->>'excluded_uncategorized')::int as excluded_uncategorized,
       (d.metadata->'summary'->>'not_classified_records')::int as not_classified_records,
       d.metadata ? 'release_bundle_unclassified_20261027' as release_recorded
from public.corpus_datasets d
where d.id in ('court_documents', 'source_documents')
order by d.id;

-- 3. POST: the released ids are exactly the packet's (sha256 of ids sorted by code point, newline-joined).
-- expect court_documents 060036eace1878bec28952c09efd39f5b362607c0db4956a2871b57f112ba22f
--        source_documents f9e081dcdf584f6a50b2a2457754cacc1d39f0f685171a7e6a0c4597f7019fd5
select r.dataset,
       encode(sha256(convert_to(string_agg(r.id, E'\n' order by r.id collate "C"), 'UTF8')), 'hex') as ids_sha256,
       min(r.ordinal) as first_ordinal,
       max(r.ordinal) as last_ordinal
from public.corpus_records r
where (r.dataset = 'court_documents' and r.filters->'doc_type' ? 'other_unknown')
   or (r.dataset = 'source_documents' and r.filters->'agency' ? 'uncategorized')
group by r.dataset
order by r.dataset;

-- 4. POST: listing option counts equal the rows (expect 0 rows).
with opts as (
  select d.id as dataset, f->>'name' as name, o->>'value' as value, (o->>'count')::bigint as listed
  from public.corpus_datasets d
  cross join lateral jsonb_array_elements(d.metadata->'listing'->'filters') f
  cross join lateral jsonb_array_elements(coalesce(f->'options', '[]'::jsonb)) o
  where d.id in ('court_documents', 'source_documents') and f->>'type' = 'select'
), names as (select distinct dataset, name from opts),
actual as (
  select r.dataset, n.name, v.value, count(*) as stored
  from public.corpus_records r
  join names n on n.dataset = r.dataset
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.filters->n.name) = 'array' then r.filters->n.name else '[]'::jsonb end) v(value)
  where r.dataset in ('court_documents', 'source_documents')
  group by 1, 2, 3
)
select coalesce(o.dataset, a.dataset) as dataset, coalesce(o.name, a.name) as name, coalesce(o.value, a.value) as value, o.listed, a.stored
from opts o
full join actual a on a.dataset = o.dataset and a.name = o.name and a.value = o.value
where o.listed is distinct from a.stored
order by 1, 2, 3
limit 50;

-- 5. PRE and POST: the rows already live (with every later title/label correction) are byte-for-byte untouched.
-- expect, before and after: court_documents 20819 | 0e206aec9d93a85eefcc5b4074c895e3
--                           source_documents 612 | fd68a7a1a16700d04e8f4aec4be0c4a1
select dataset,
       count(*) as rows,
       md5(string_agg(md5(id || '|' || coalesce(title, '') || '|' || coalesce(source_url, '') || '|' || ordinal::text || '|'
                          || item::text || '|' || coalesce(detail::text, '') || '|' || coalesce(filters::text, '') || '|'
                          || coalesce(text, '')), '' order by id collate "C")) as rows_md5
from public.corpus_records
where dataset in ('court_documents', 'source_documents')
  and not coalesce(filters->'doc_type' ? 'other_unknown' or filters->'agency' ? 'uncategorized', false)
group by dataset
order by dataset;
