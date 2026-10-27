-- Rollback of the 2026-10-27 "Not classified" release (bundle-unclassified-release-20261027-v1.sql).
-- Admin role only. One transaction: for each dataset that carries metadata.release_bundle_unclassified_20261027, the
-- released rows are identified exactly (their filter value; no row had it before the release, PRE check 1), their id
-- digest must equal the one recorded at release, then they are deleted and the catalog entry's listing, listing_modes,
-- summary, expected/exported counts and columns are restored from the stored before-state. Any mismatch raises and
-- nothing changes. Rows that were already live are never touched.
begin;
set local statement_timeout = '300s';

do $$
declare
  ds record;
  rel jsonb;
  before_md jsonb;
  digest text;
  removed bigint;
begin
  for ds in
    select * from (values
      ('court_documents', 'doc_type', 'other_unknown'),
      ('source_documents', 'agency', 'uncategorized')
    ) v(dataset, filter_key, filter_value)
  loop
    select metadata->'release_bundle_unclassified_20261027' into rel
    from public.corpus_datasets where id = ds.dataset for update;
    if rel is null then
      raise notice '%: no release recorded; skipped', ds.dataset;
      continue;
    end if;

    select encode(sha256(convert_to(string_agg(id, E'\n' order by id collate "C"), 'UTF8')), 'hex') into digest
    from public.corpus_records
    where dataset = ds.dataset and filters->ds.filter_key ? ds.filter_value;
    if digest is distinct from rel->>'ids_sha256' then
      raise exception '%: released id digest % differs from recorded %', ds.dataset, digest, rel->>'ids_sha256';
    end if;

    delete from public.corpus_records
    where dataset = ds.dataset and filters->ds.filter_key ? ds.filter_value;
    get diagnostics removed = row_count;
    if removed <> (rel->>'added_rows')::bigint then
      raise exception '%: removed % rows, release recorded %', ds.dataset, removed, rel->>'added_rows';
    end if;

    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into before_md
    from jsonb_each(rel->'before'->'metadata') where value <> 'null'::jsonb;

    update public.corpus_datasets
    set metadata = ((metadata - 'release_bundle_unclassified_20261027' - 'listing' - 'listing_modes' - 'summary'
                     - 'expected_records' - 'exported_records') || before_md),
        imported_records = (rel->'before'->'columns'->>'imported_records')::bigint,
        expected_records = (rel->'before'->'columns'->>'expected_records')::bigint,
        manifest_sha256 = rel->'before'->'columns'->>'manifest_sha256',
        updated_at = now()
    where id = ds.dataset;
    raise notice '%: removed % released rows; catalog entry restored', ds.dataset, removed;
  end loop;
end $$;

-- Verify inside the transaction before commit: PRE checks 1 and 5 of the release contract return their PRE values
-- (court_documents 20819 | 359a84b3c04cb8459ff77e5eccaa855e; source_documents 612 | a01f44a7facfcc9f61a15768f5309bd1).
select dataset, count(*) as live_rows, md5(string_agg(id, E'\n' order by id collate "C")) as ids_md5
from public.corpus_records where dataset in ('court_documents', 'source_documents') group by dataset order by dataset;
select id, imported_records, expected_records, metadata->'summary'->>'excluded_uncategorized' as excluded_uncategorized,
       metadata ? 'release_bundle_unclassified_20261027' as release_recorded
from public.corpus_datasets where id in ('court_documents', 'source_documents') order by id;

commit;
