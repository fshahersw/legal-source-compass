-- ecfr-section-text/1 setup data (apply after ecfr-section-text-v1.sql). Opens the private run and registers the dataset as NOT ready.
-- Idempotent. The run id below is fixed so tooling can reference it; rerunning never creates a second run.
begin;

insert into corpus_ingest.runs(id, contract_version, status, scope, counts)
values ('f71cd778-f3b5-4674-942a-4979554e1e05', 'corpus-ingest/1', 'running',
  jsonb_build_object(
    'contract', 'ecfr-section-text/1', 'source_system', 'ecfr', 'entity_type', 'section-text',
    'source', 'https://www.ecfr.gov/api/versioner/v1 (public, gate-free eCFR Versioner API)',
    'selection', 'every CFR section cited by federal_regulations_sections and by citation_index links to open_us_law',
    'raw_retention', 'private storage bucket corpus-originals, key ecfr-text/sha256/<2>/<sha256>.xml',
    'purpose', 'replace unverified open_us_law CFR text with official eCFR text before the owner-directed removal',
    'public_projection_allowed', true),
  '{}'::jsonb)
on conflict (id) do nothing;

insert into public.corpus_datasets(id, label, ready, expected_records, imported_records, manifest_sha256, metadata)
values ('ecfr_section_text', 'Official eCFR section text (as of October 2026)', false, 0, 0, null,
  jsonb_build_object(
    'aliases', jsonb_build_array('ecfr_section_text'),
    'source_system', 'ecfr', 'schema_version', 'ecfr-section-text/1', 'projection_run_id', null,
    'qualification', 'Plain text of eCFR sections as served by the public eCFR Versioner API for a stated point-in-time date. Authoritative but unofficial: the official legal edition is the annual CFR. The date is the title currency date, not a legal effective date. Scope is the set of CFR sections cited elsewhere in this library, not the whole CFR. Text does not establish applicability to any claim.'))
on conflict (id) do nothing;

commit;
