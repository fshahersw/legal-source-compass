-- Read-only verification for held-artifact-release/2026-10-27.1. Run before and after the contract.
-- Before: the ledger does not exist; after: it holds 27,722 rows (27,652 released, 48 olls.info, 22 naic.org held).
begin read only;
set local statement_timeout = '290s';

-- 1. Ready split by top-level route. Expected after = before with ready moved false -> true for: files 7,074,
--    supplement-files 20,535, library-assets 28, mdl-files 7, source-assets 6, api 0, agency-files 0.
select split_part(route, '/', 2) as top, ready, count(*) as routes, sum(bytes) as bytes
from public.corpus_artifacts group by 1, 2 order by 1, 2;

-- 2. Host audit of /files/* linked from focused and seeger (expect no ready = true row with host trellis.law or olls.info).
with f as (
  select r.dataset, substring(r.item::text from '/files/([0-9a-f]{32})') as fid,
         substring(r.item::text from 'https?://([^/"\\]+)') as host
  from public.corpus_records r where r.dataset in ('focused', 'seeger'))
select a.ready, f.host, count(*) as routes
from f join public.corpus_artifacts a on a.route = '/files/' || f.fid
where f.host in ('trellis.law', 'www.trellis.law', 'olls.info') or f.host like '%trellis%'
group by 1, 2 order by 1, 2;

-- 3. Invariant: every ready route has its stored object.
select count(*) as ready_without_object
from public.corpus_artifacts a
left join storage.objects o on o.bucket_id = 'corpus-originals' and o.name = a.object_key
where a.ready and o.name is null;

-- 4. Ledger summary (after only; errors before the release because the table does not exist yet).
select decision, family, count(*) as routes, sum(bytes) as bytes
from corpus_ingest.held_artifact_release_20261027 group by 1, 2 order by 1, 2;

commit;
