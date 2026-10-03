-- Additive private verification receipts. Apply through a migration, never public.
-- Original observations/versions and prior failed receipts are retained unchanged.
create table if not exists corpus_ingest.projection_slice_checks_v2 (
  check_id bigint generated always as identity primary key,
  projection_schema text not null,
  plan_sha256 text not null check(plan_sha256 ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references corpus_ingest.runs(id),
  dataset text not null check(dataset ~ '^[a-z0-9_]+$'),
  lower_ordinal bigint not null check(lower_ordinal >= 0),
  upper_ordinal bigint not null check(upper_ordinal > lower_ordinal),
  source_expected_signature text not null check(source_expected_signature ~ '^[0-9a-f]{64}$'),
  expected_records bigint not null check(expected_records = upper_ordinal - lower_ordinal),
  actual_records bigint not null check(actual_records >= 0),
  expected_fullfield_signature text,
  actual_fullfield_signature text,
  missing bigint not null check(missing >= 0),
  unexpected bigint not null check(unexpected >= 0),
  mismatched bigint not null check(mismatched >= 0),
  source_payload_mismatches bigint not null check(source_payload_mismatches >= 0),
  native_topology_mismatches bigint not null check(native_topology_mismatches >= 0),
  verified boolean not null,
  validated_at timestamptz not null default clock_timestamp(),
  check(not verified or (expected_records = actual_records
    and expected_fullfield_signature is not null
    and actual_fullfield_signature is not null
    and expected_fullfield_signature ~ '^[0-9a-f]{64}$'
    and actual_fullfield_signature ~ '^[0-9a-f]{64}$'
    and expected_fullfield_signature = actual_fullfield_signature
    and missing = 0 and unexpected = 0 and mismatched = 0
    and source_payload_mismatches = 0 and native_topology_mismatches = 0))
);
create index if not exists projection_slice_checks_v2_plan
  on corpus_ingest.projection_slice_checks_v2(plan_sha256,dataset,lower_ordinal,upper_ordinal,check_id desc);
alter table corpus_ingest.projection_slice_checks_v2 enable row level security;
revoke all on corpus_ingest.projection_slice_checks_v2 from public,anon,authenticated,service_role;
revoke all on sequence corpus_ingest.projection_slice_checks_v2_check_id_seq from public,anon,authenticated,service_role;
grant select,insert on corpus_ingest.projection_slice_checks_v2 to service_role;
grant usage on sequence corpus_ingest.projection_slice_checks_v2_check_id_seq to service_role;
comment on table corpus_ingest.projection_slice_checks_v2 is
  'Append-only private independent full-field/source-payload projection verification receipts. A verified slice is not full-dataset publication.';
