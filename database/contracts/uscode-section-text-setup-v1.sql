-- uscode-section-text/1 setup data (apply after uscode-section-text-v1.sql). Opens the private run and registers the dataset as NOT ready. Idempotent.
begin;

insert into corpus_ingest.runs(id, contract_version, status, scope, counts)
values ('3412a1b2-0ace-40fc-9271-2fc705ce3308', 'corpus-ingest/1', 'running',
  jsonb_build_object(
    'contract', 'uscode-section-text/1', 'source_system', 'uscode', 'entity_type', 'section-text',
    'source', 'https://www.govinfo.gov/content/pkg/USCODE-2024-title<N>/html/ (official per-section pages, United States Code 2024 Edition)',
    'selection', 'every U.S. Code section linked from citation_index rows to open_us_law',
    'raw_retention', 'private storage bucket corpus-originals, key uscode-text/sha256/<2>/<sha256>.htm',
    'purpose', 'replace unverified open_us_law U.S. Code text links before the owner-directed removal',
    'public_projection_allowed', true),
  '{}'::jsonb)
on conflict (id) do nothing;

insert into public.corpus_datasets(id, label, ready, expected_records, imported_records, manifest_sha256, metadata)
values ('uscode_section_text', 'Official U.S. Code section text (2024 Edition)', false, 0, 0, null,
  jsonb_build_object(
    'aliases', jsonb_build_array('uscode_section_text'),
    'source_system', 'uscode', 'schema_version', 'uscode-section-text/1', 'projection_run_id', null,
    'qualification', 'Section text from the official United States Code pages published by the U.S. Government Publishing Office on govinfo.gov (2024 Edition, current through the stated date). A Code edition is a point in time; later amendments are not reflected, and the date is the edition currency, not a legal effective date. Scope is the set of sections cited elsewhere in this library, not the whole Code. Text does not establish applicability to any claim.'))
on conflict (id) do nothing;

commit;
