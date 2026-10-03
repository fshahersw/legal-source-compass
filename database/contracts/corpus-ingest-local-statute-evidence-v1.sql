-- Requires corpus-ingest-local-catalog-evidence-v1.sql. This adds only the exact
-- supplied Vaquill July/August state-statute Parquet roots and a separate wrapper.
-- Local snapshot and secondary dataset status claims do not establish current law.
alter table corpus_ingest.local_source_artifacts drop constraint local_source_artifacts_source_system_check;
alter table corpus_ingest.local_source_artifacts drop constraint local_source_artifacts_source_file_uri_check;
alter table corpus_ingest.local_source_artifacts add constraint local_source_artifacts_approved_source_uri_v1 check (
 (source_system='local-sw-catalog'
  and source_file_uri ~ '^file:///C:/Users/firas/Downloads/SW-BULK/(catalog|catalog_test)/([A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.(json|jsonl|csv|parquet)$'
  and source_file_uri !~ '(^|/)\.{1,2}(/|$)')
 or (source_system='local-vaquill-open-us-law'
  and source_file_uri ~ '^file:///C:/Users/firas/Downloads/SW-BULK/corpus/statutes/vaquill/(v2026\.07|v2026\.08)/us_[a-z]{2}_statutes\.parquet$')
);
alter table corpus_ingest.local_observations drop constraint local_observations_source_system_check;
alter table corpus_ingest.local_observations add constraint local_observations_approved_source_v1 check (
 source_system in ('local-sw-catalog','local-vaquill-open-us-law')
);

create or replace function corpus_ingest.ingest_local_statute_entities_v1(p_run uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $local_statute_ingest_v1$
declare rows_received bigint; versions_inserted bigint; observations_written bigint; entities_written bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then
    raise exception 'Expected at most 10000 local catalog records' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs where id=p_run and status in ('running','partial')
    and scope->>'source_system'='local-vaquill-open-us-law') then
    raise exception 'Local catalog run is not open or correctly qualified' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    left join corpus_ingest.local_source_artifacts a
      on a.source_system=r->>'source_system' and a.source_file_uri=r->'provenance'->>'source_file_uri'
      and a.source_sha256=r->'provenance'->>'source_sha256'
    where r->>'source_system' is distinct from 'local-vaquill-open-us-law'
      or r->>'schema_version' is distinct from 'local-vaquill-state-evidence/1'
      or coalesce(r->>'native_id','')='' or length(r->>'native_id')>512
      or coalesce(r->>'entity_type','') !~ '^[a-z][a-z0-9-]{0,80}$'
      or jsonb_typeof(r->'data') is distinct from 'object'
      or r->'data'->>'local_id' is distinct from r->>'native_id'
      or r->'data'->'publisher_native_entity' is distinct from 'false'::jsonb
      or r->'provenance' ? 'source_url'
      or r->'provenance'->'original_http_status' is distinct from 'null'::jsonb
      or r->'provenance'->'original_http_retrieval_at' is distinct from 'null'::jsonb
      or r->'provenance'->'remote_capture_date' is distinct from 'null'::jsonb
      or r->'provenance'->>'retrieval_method' is distinct from 'local_parquet_read'
      or r->'provenance'->>'source_original_record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
      or r->'data'->'current_law_verified' is distinct from 'false'::jsonb
      or r->'data'->'public_projection_allowed' is distinct from 'false'::jsonb
      or r->'data'->'calculation_activation_allowed' is distinct from 'false'::jsonb
      or r->'provenance'->'current_law_verified' is distinct from 'false'::jsonb
      or r->'provenance'->'public_projection_allowed' is distinct from 'false'::jsonb
      or r->'provenance'->'calculation_activation_allowed' is distinct from 'false'::jsonb
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
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(r->'data'->'source_record')<>r->'provenance'->>'source_original_record_sha256') then
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
$local_statute_ingest_v1$;
revoke all on function corpus_ingest.ingest_local_statute_entities_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function corpus_ingest.ingest_local_statute_entities_v1(uuid,jsonb) to service_role;
