-- Read-only verification for large-text-assets-release/2026-10-27.1. Safe to run before and after.
-- Before the release: official_rows 0, held_rows 78, held_expected 155, ready_text_routes 0 (of the 156 large-text routes),
--   official_dataset_ready null.
-- After the release:  official_rows 1, held_rows 77, held_expected 77, ready_text_routes 2, official_dataset_ready true,
--   held_dataset_ready false, grady_object_present true, served_detail_links 3.
set local statement_timeout = '30s';

select
  (select count(*) from public.corpus_records where dataset = 'large_text_official') as official_rows,
  (select count(*) from public.corpus_records where dataset = 'large_text_assets') as held_rows,
  (select expected_records from public.corpus_datasets where id = 'large_text_assets') as held_expected,
  (select ready from public.corpus_datasets where id = 'large_text_assets') as held_dataset_ready,
  (select ready from public.corpus_datasets where id = 'large_text_official') as official_dataset_ready,
  (select count(*) from public.corpus_artifacts a
     where a.ready and a.route in (
       select '/api/text?id=' || replace(al.alias, ':', '%3A')
       from public.corpus_records r cross join lateral jsonb_array_elements_text(r.detail->'metadata'->'reader_aliases') al(alias)
       where r.dataset in ('large_text_assets', 'large_text_official'))) as ready_text_routes,
  exists (select 1 from storage.objects o where o.bucket_id = 'corpus-originals'
          and o.name = '2e/2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660'
          and (o.metadata->>'size') = '3153723') as grady_object_present,
  (select jsonb_array_length(public.corpus_detail('large-text:f6f572ee6ca009b460712aac316397d6', array['large_text_official'], false)->'links')) as served_detail_links;

-- Host split of what stays held (expect olls.info 44 and the ten official hosts with 33 in total):
select substring(source_url from '^https?://([^/]+)') as host, count(*)
from public.corpus_records where dataset = 'large_text_assets' group by 1 order by 2 desc, 1;

-- The listing the Sources section shows (expect total 1):
select public.corpus_query_bounded('large_text_official', '{}'::jsonb, '', 25, 0, 10000)->'total' as listed;

-- Per-row survey (input of scripts/admin/large-text-assets-release-packet.mjs). Before the release it lists all 78 rows;
-- after it, the 77 held rows (add 'large_text_official' to the dataset list to include the released one).
with a as (
  select r.id, r.category, r.state, r.title, r.source_url, substring(r.source_url from '^https?://([^/]+)') as host,
         r.detail->'metadata'->>'source_dataset' as sd, r.detail->'metadata'->>'source_record_id' as sid,
         (r.detail->'metadata'->>'utf8_bytes')::bigint as utf8_bytes, r.detail->'metadata'->>'display_text_sha256' as text_sha256,
         jsonb_agg(jsonb_build_object('route', ca.route, 'object_key', ca.object_key, 'bytes', ca.bytes, 'ready', ca.ready,
           'object_present', o.name is not null) order by ca.route) as routes
  from public.corpus_records r
  cross join lateral jsonb_array_elements_text(r.detail->'metadata'->'reader_aliases') al(alias)
  left join public.corpus_artifacts ca on ca.route = '/api/text?id=' || replace(al.alias, ':', '%3A')
  left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = ca.object_key and (o.metadata->>'size') = ca.bytes::text
  where r.dataset = 'large_text_assets' group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
select jsonb_agg(to_jsonb(a) order by host, id)::text as survey from a;
