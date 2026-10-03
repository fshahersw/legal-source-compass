-- Requires both local catalog and local statute evidence migrations.
-- Source-claim records remain private. These fifteen original artifact locators
-- certify a local occurrence only, not HTTP freshness, legal outcomes, or binaries.
alter table corpus_ingest.local_source_artifacts drop constraint local_source_artifacts_approved_source_uri_v1;
alter table corpus_ingest.local_source_artifacts add constraint local_source_artifacts_approved_source_uri_v2 check (
 (source_system='local-sw-catalog'
  and source_file_uri ~ '^file:///C:/Users/firas/Downloads/SW-BULK/(catalog|catalog_test)/([A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(json|jsonl|csv|parquet)$'
  and source_file_uri !~ '(^|/)\.{1,2}(/|$)')
 or (source_system='local-vaquill-open-us-law'
  and source_file_uri ~ '^file:///C:/Users/firas/Downloads/SW-BULK/corpus/statutes/vaquill/(v2026\.07|v2026\.08)/us_[a-z]{2}_statutes\.parquet$')
 or (source_system='local-source-registry' and source_file_uri in ('file:///C:/Users/firas/Downloads/SW-BULK/registry_v06_1.jsonl','file:///C:/Users/firas/Downloads/courtformsTHREE/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-TWO/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-THREE/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/Court-Expansion-Federal-Part-TWO/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/Court-Expansion-States-Part-ONE/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/courtformsfederalONE/SOURCE-INDEX.csv','file:///C:/Users/firas/Downloads/courtformsTWO/court_forms/MANIFEST.csv','file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/00_CURATED_PRIORITY_SOURCES.jsonl','file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/08_MDL_MASS_TORT_AND_MATTER_HUBS.jsonl','file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/09_MDL_DOCKET_DOCUMENTS.jsonl','file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/11_STATUTES_CODES_AND_LEGISLATION.jsonl','file:///C:/Users/firas/Downloads/SW-Source-Registry-CLEAN/jsonl/12_FEDERAL_REGULATIONS_AND_RULEMAKING.jsonl','file:///C:/Users/firas/Downloads/returnedfiles/court_access_registry_2026-08-21/registry.jsonl','file:///C:/Users/firas/Downloads/returnedfiles/settlementsverdicts/vli_records.csv'))
);
alter table corpus_ingest.local_observations drop constraint local_observations_approved_source_v1;
alter table corpus_ingest.local_observations add constraint local_observations_approved_source_v2 check (
 source_system in ('local-sw-catalog','local-vaquill-open-us-law','local-source-registry')
);

-- Reference-only hold ledger. Original bodies stay in the pinned private files;
-- this table never stores credential locators or a truncated source record.
create table corpus_ingest.local_held_occurrences (
 run_id uuid not null references corpus_ingest.runs(id),
 source_system text not null check(source_system='local-source-registry'),
 source_file_uri text not null,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_record_ordinal bigint not null check(source_record_ordinal>0),
 source_original_record_sha256 text not null check(source_original_record_sha256 ~ '^[a-f0-9]{64}$'),
 entity_type text not null check(entity_type ~ '^[a-z][a-z0-9-]{0,80}$'),
 local_id text not null check(length(local_id) between 1 and 512),
 original_packet_sha256 text not null check(original_packet_sha256 ~ '^[a-f0-9]{64}$'),
 original_packet_ordinal bigint not null check(original_packet_ordinal>0),
 original_payload_sha256 text not null check(original_payload_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_payload_sha256 text not null check(reviewed_payload_sha256 ~ '^[a-f0-9]{64}$'),
 original_envelope_bytes bigint not null check(original_envelope_bytes>0),
 reviewed_envelope_bytes bigint not null check(reviewed_envelope_bytes>0),
 hold_reasons jsonb not null check(jsonb_typeof(hold_reasons)='array'
   and jsonb_array_length(hold_reasons)>0
   and hold_reasons <@ '["credential_parameter_locator","oversized_envelope_750000_bytes"]'::jsonb),
 held_ledger_sha256 text not null check(held_ledger_sha256 ~ '^[a-f0-9]{64}$'),
 database_body_import_allowed boolean not null default false check(not database_body_import_allowed),
 public_projection_allowed boolean not null default false check(not public_projection_allowed),
 calculation_activation_allowed boolean not null default false check(not calculation_activation_allowed),
 primary key(run_id,source_system,source_file_uri,source_sha256,source_record_ordinal),
 foreign key(source_system,source_file_uri,source_sha256)
   references corpus_ingest.local_source_artifacts(source_system,source_file_uri,source_sha256)
);
alter table corpus_ingest.local_held_occurrences enable row level security;
revoke all on corpus_ingest.local_held_occurrences from public,anon,authenticated;
grant select,insert,update,delete on corpus_ingest.local_held_occurrences to service_role;

-- JSONL original hashes pin raw UTF8 physical line bytes, including BOM/CRLF.
-- Registered file SHA + ordinal + independent reconstruction are mandatory.
-- Parsed JSONB cannot reconstruct those exact raw byte hashes. CSV row hashes
-- are canonical parsed-string JSON and are additionally verified inside SQL.
create or replace function corpus_ingest.ingest_local_registry_entities_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $local_registry_ingest_v1$
declare rows_received bigint; versions_inserted bigint; observations_written bigint; entities_written bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'Expected at most 10000 local catalog records' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs where id=p_run and status in ('running','partial')
    and scope->>'source_system'='local-source-registry'
    and scope->>'schema_version'='local-source-registry-evidence/2'
    and scope->>'normalizer_version'='local-source-registry-reviewed/3'
    and scope->'public_projection_allowed'='false'::jsonb and scope->'calculation_activation_allowed'='false'::jsonb
    and scope->'raw_source_occurrences_independently_verified'='true'::jsonb
    and scope->>'raw_source_verification_sha256' ~ '^[a-f0-9]{64}$') then
    raise exception 'Local catalog run is not open or correctly qualified' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    left join corpus_ingest.local_source_artifacts a
      on a.source_system=r->>'source_system' and a.source_file_uri=r->'provenance'->>'source_file_uri'
      and a.source_sha256=r->'provenance'->>'source_sha256'
    where r->>'source_system' is distinct from 'local-source-registry'
      or r->>'schema_version' is distinct from 'local-source-registry-evidence/2'
      or coalesce(r->>'native_id','')='' or length(r->>'native_id')>512
      or coalesce(r->>'entity_type','') !~ '^[a-z][a-z0-9-]{0,80}$'
      or jsonb_typeof(r->'data') is distinct from 'object'
      or r->'data'->>'local_id' is distinct from r->>'native_id'
      or r->'data'->'publisher_native_entity' is distinct from 'false'::jsonb
      or r->'data'->>'normalizer_version' is distinct from 'local-source-registry-reviewed/3'
      or r->'provenance' ? 'source_url'
      or coalesce(r->'provenance'->'http_status','null'::jsonb) is distinct from 'null'::jsonb
      or coalesce(r->'provenance'->'original_http_status','null'::jsonb) is distinct from 'null'::jsonb
      or coalesce(r->'provenance'->'original_http_retrieval_at','null'::jsonb) is distinct from 'null'::jsonb
      or coalesce(r->'provenance'->>'source_original_record_hash_codec','') not in ('utf8-jsonl-line/1','canonical-string-csv-row/1')
      or r->'data'->'public_projection_eligible' is distinct from 'false'::jsonb
      or r->'data'->'fresh_http_verification' is distinct from 'false'::jsonb
      or r->'data'->'legal_authority_or_outcome_verified' is distinct from 'false'::jsonb
      or r->'data'->'binary_checksum_independently_verified' is distinct from 'false'::jsonb
      or r->'data'->'public_projection_allowed' is distinct from 'false'::jsonb
      or r->'data'->'calculation_activation_allowed' is distinct from 'false'::jsonb
      or r->'data'->'credential_locator_held' is distinct from 'false'::jsonb
      or r->'provenance'->>'normalizer_version' is distinct from 'local-source-registry-reviewed/3'
      or (r->'provenance'->>'source_file_uri' like '%.jsonl' and r->'provenance'->>'source_original_record_hash_codec'<>'utf8-jsonl-line/1')
      or (r->'provenance'->>'source_file_uri' like '%.csv' and r->'provenance'->>'source_original_record_hash_codec'<>'canonical-string-csv-row/1')
      or r->'provenance'->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or coalesce(r->'provenance'->>'record_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->'provenance'->>'source_original_record_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->'provenance'->>'source_record_ordinal','') !~ '^[1-9][0-9]{0,14}$'
      or coalesce(r->'provenance'->>'observed_at','')=''
      or a.source_file_uri is null) then
    raise exception 'Invalid local identity, codec, registered artifact, ordinal or observation provenance' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    join corpus_ingest.local_source_artifacts a
      on a.source_system=r->>'source_system' and a.source_file_uri=r->'provenance'->>'source_file_uri'
      and a.source_sha256=r->'provenance'->>'source_sha256'
    where (r->'provenance'->>'source_record_ordinal')::bigint>a.source_record_count
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data')<>r->'provenance'->>'record_sha256'
      or r->'data'->>'source_original_record_sha256' is distinct from r->'provenance'->>'source_original_record_sha256'
      or jsonb_typeof(r->'data'->'source_record') is distinct from 'object'
      or (r->'provenance'->>'source_original_record_hash_codec'='canonical-string-csv-row/1' and corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data'->'source_record')<>r->'provenance'->>'source_original_record_sha256')) then
    raise exception 'Local payload hash, original-row hash or registered ordinal mismatch' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r join corpus_ingest.entity_versions v
    on v.source_system=r->>'source_system' and v.entity_type=r->>'entity_type' and v.native_id=r->>'native_id'
    and v.payload_sha256=r->'provenance'->>'record_sha256'
    where v.data is distinct from r->'data' or v.schema_version is distinct from r->>'schema_version') then
    raise exception 'Local version hash conflicts with retained payload or schema' using errcode='22023';
  end if;
  rows_received:=jsonb_array_length(p_rows);
  insert into corpus_ingest.entity_versions(source_system,entity_type,native_id,payload_sha256,schema_version,data,storage_sha256,first_run)
  select distinct r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->>'schema_version',r->'data',encode(sha256(convert_to((r->'data')::text,'UTF8')),'hex'),p_run
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics versions_inserted=row_count;
  insert into corpus_ingest.local_observations(run_id,source_system,entity_type,native_id,payload_sha256,
    source_file_uri,source_sha256,source_record_ordinal,source_original_record_sha256,local_snapshot_as_of,observed_at,provenance)
  select distinct p_run,r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',
    r->'provenance'->>'source_file_uri',r->'provenance'->>'source_sha256',(r->'provenance'->>'source_record_ordinal')::bigint,
    r->'provenance'->>'source_original_record_sha256',nullif(r->'provenance'->>'local_snapshot_as_of','')::date,
    (r->'provenance'->>'observed_at')::timestamptz,r->'provenance'
  from jsonb_array_elements(p_rows) r on conflict do nothing;
  get diagnostics observations_written=row_count;
  insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,
    provenance,source_as_of,retrieved_at,last_run)
  select distinct on (r->>'source_system',r->>'entity_type',r->>'native_id')
    r->>'source_system',r->>'entity_type',r->>'native_id',r->'provenance'->>'record_sha256',r->>'schema_version',r->'data',r->'provenance',
    nullif(r->'provenance'->>'local_snapshot_as_of','')::date,(r->'provenance'->>'observed_at')::timestamptz,p_run
  from jsonb_array_elements(p_rows) r
  order by r->>'source_system',r->>'entity_type',r->>'native_id',
    coalesce(nullif(r->'provenance'->>'local_snapshot_as_of','')::date,(r->'provenance'->>'observed_at')::timestamptz::date) desc,
    (r->'provenance'->>'observed_at')::timestamptz desc,r->'provenance'->>'record_sha256'
  -- Preserve existing review_status, including quarantined dispositions.
  on conflict(source_system,entity_type,native_id) do update set
    payload_sha256=excluded.payload_sha256,schema_version=excluded.schema_version,data=excluded.data,provenance=excluded.provenance,
    source_as_of=excluded.source_as_of,retrieved_at=excluded.retrieved_at,last_run=excluded.last_run
  where (coalesce(excluded.source_as_of,excluded.retrieved_at::date),excluded.retrieved_at)>
        (coalesce(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at::date),corpus_ingest.entities.retrieved_at)
    or ((coalesce(excluded.source_as_of,excluded.retrieved_at::date),excluded.retrieved_at)=
        (coalesce(corpus_ingest.entities.source_as_of,corpus_ingest.entities.retrieved_at::date),corpus_ingest.entities.retrieved_at)
        and excluded.payload_sha256<corpus_ingest.entities.payload_sha256);
  get diagnostics entities_written=row_count;
  return jsonb_build_object('received',rows_received,'new_versions',versions_inserted,
    'new_local_observations',observations_written,'entities_written',entities_written,'publisher_native_entities_written',0);
end;
$local_registry_ingest_v1$;
revoke all on function corpus_ingest.ingest_local_registry_entities_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function corpus_ingest.ingest_local_registry_entities_v1(uuid,jsonb) to service_role;
