-- de-dockets: read-only snapshot that regenerates the frozen "before" inputs of build-entries-packet.mjs.
-- Run it (one SELECT, no writes) on corpussite and save the single json value it returns as
--   scripts/ingest/de-dockets/before-counts-<yyyy-mm-dd>.json   (pass it to the builder with --before=<file>)
-- after adding "schema_version": "de-dockets-before-counts/2" and "read_at": "<UTC timestamp>" (the query returns both).
-- Sections:
--   dataset                                   per-MDL aggregates of sw_docket_entries_v1 for the registry master MDLs
--   matter_cells                              sw_matters_v1 item.cells.entries_published / entries_withheld as stored
--   matter_registry                           sw_matters_v1 detail.registry.entries captures (provider, docket key, counts, observed_at)
--                                             and the "Docket entries captured" facts, as stored; the apply step re-checks them
--   existing_courtlistener_ids_since_max_date CourtListener native entry ids already published on or after the MDL's latest date
-- The CourtListener entry-text release estimate (withheld_text_release_estimate) is verify-de-dockets.sql section 6.
with masters as (
  select distinct filters->>'mdl' as mdl
  from corpus_records
  where dataset = 'sw_matter_dockets_v1' and filters->>'role' = 'master'
),
e as (
  select r.filters->>'mdl' as mdl, r.item->'cells' as c, r.filters->>'native_id' as native_id
  from corpus_records r join masters m on m.mdl = r.filters->>'mdl'
  where r.dataset = 'sw_docket_entries_v1'
),
agg as (
  select mdl,
         count(*) as rows,
         max(c->>'date_filed') as max_date,
         count(*) filter (where c->>'description_withheld' = 'sealed_or_restricted_text') as w_text,
         count(*) filter (where c->>'description_withheld' = 'sealed_document') as w_doc,
         count(*) filter (where c->>'description_withheld' = 'contact_or_access_data') as w_contact,
         max((c->>'entry_number')::int) filter (where c->>'entry_number' ~ '^\d+$') as max_entry_number,
         array_agg(distinct c->>'provider') as providers
  from e group by mdl
),
prov as (
  select mdl, jsonb_object_agg(provider, n) as provider_rows
  from (select mdl, c->>'provider' as provider, count(*) as n from e group by 1, 2) x
  group by mdl
),
cl_since as (
  select e.mdl, jsonb_agg(e.native_id order by e.native_id) as ids
  from e join agg a on a.mdl = e.mdl
  where e.c->>'provider' = 'courtlistener' and e.c->>'date_filed' >= a.max_date
  group by e.mdl
),
mat as (
  select r.item->'cells'->>'mdl_number' as mdl, r.item->'cells' as cells, r.detail as detail
  from corpus_records r join masters m on m.mdl = r.item->'cells'->>'mdl_number'
  where r.dataset = 'sw_matters_v1'
)
select jsonb_build_object(
  'schema_version', 'de-dockets-before-counts/2',
  'read_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'source', 'scripts/ingest/de-dockets/snapshot-before.sql (one read-only SELECT on corpussite)',
  'dataset', (select jsonb_object_agg(m.mdl, jsonb_build_object(
                'rows', coalesce(a.rows, 0), 'max_date', a.max_date, 'w_text', coalesce(a.w_text, 0), 'w_doc', coalesce(a.w_doc, 0),
                'w_contact', coalesce(a.w_contact, 0), 'max_entry_number', a.max_entry_number,
                'providers', coalesce(to_jsonb(a.providers), '[]'::jsonb),
                'provider_rows', coalesce(p.provider_rows, '{}'::jsonb)))
              from masters m left join agg a on a.mdl = m.mdl left join prov p on p.mdl = m.mdl),
  'matter_cells', (select jsonb_object_agg(mdl, jsonb_build_object(
                     'entries_published', (cells->>'entries_published')::int, 'entries_withheld', (cells->>'entries_withheld')::int))
                   from mat),
  'matter_registry', (select jsonb_object_agg(mdl, jsonb_build_object(
                        'captures', coalesce((select jsonb_agg(jsonb_build_object(
                                       'provider', x->>'provider', 'docket_key', x->>'docket_key',
                                       'captured', x->'captured', 'provider_total', x->'provider_total',
                                       'complete', x->'complete', 'observed_at', x->>'observed_at'))
                                     from jsonb_array_elements(coalesce(detail->'registry'->'entries', '[]'::jsonb)) x), '[]'::jsonb),
                        'entry_facts', coalesce((select jsonb_agg(f)
                                        from jsonb_array_elements(coalesce(detail->'facts', '[]'::jsonb)) f
                                        where f->>0 like 'Docket entries captured%'), '[]'::jsonb)))
                      from mat),
  'existing_courtlistener_ids_since_max_date', coalesce((select jsonb_object_agg(mdl, ids) from cl_since), '{}'::jsonb)
) as snapshot;
