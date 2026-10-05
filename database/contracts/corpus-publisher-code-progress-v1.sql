-- Additive read-only administrative progress contract. Requires the prepared
-- publisher-code-intake-v1 contract. Does not open/finish runs or publish data.
begin;
create function public.corpus_publisher_code_status_v1(p_run uuid,p_manifest_sha256 text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r corpus_ingest.runs; m jsonb; batches jsonb; counts jsonb; objects bigint; object_bytes bigint; missing_objects bigint;
begin
 if p_run is null or coalesce(p_manifest_sha256,'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Pinned run and packet required' using errcode='22023';
 end if;
 select * into r from corpus_ingest.runs where id=p_run;
 if not found then return jsonb_build_object('contract','publisher-code-progress/1','run_exists',false,'run_id',p_run); end if;
 if r.scope->>'source_system' is distinct from 'texas-legislature-code'
  or r.scope->>'contract' is distinct from 'publisher-code-intake/1'
  or r.scope->>'jurisdiction' is distinct from 'TX'
  or r.scope->>'packet_manifest_sha256' is distinct from p_manifest_sha256
  or r.scope->'private_only' is distinct from 'true'::jsonb
  or r.scope->'public_projection_allowed' is distinct from 'false'::jsonb
  or r.scope->'calculation_activation_allowed' is distinct from 'false'::jsonb then
  raise exception 'Run scope differs from pinned private packet' using errcode='22023';
 end if;
 select manifest into m from corpus_ingest.publisher_code_packets_v1
  where run_id=p_run and manifest_sha256=p_manifest_sha256;
 select coalesce(jsonb_agg(jsonb_build_object('index',batch_index,'sha256',batch_sha256,'records',records) order by batch_index),'[]'::jsonb)
  into batches from corpus_ingest.publisher_code_batch_receipts_v1 where run_id=p_run;
 select coalesce(jsonb_object_agg(entity_type,n),'{}'::jsonb) into counts from
  (select entity_type,count(*) n from corpus_ingest.observations where run_id=p_run group by entity_type) c;
 select count(*),coalesce(sum((a.asset->>'bytes')::bigint),0),count(*) filter(where not exists(
  select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
   where b.id='corpus-originals' and b.public is false and o.name=a.readback_receipt->>'object_key'
    and o.metadata->>'size'=a.asset->>'bytes'))
  into objects,object_bytes,missing_objects from corpus_ingest.publisher_code_packet_objects_v1 a where run_id=p_run;
 return jsonb_build_object('contract','publisher-code-progress/1','run_exists',true,'run_id',p_run,
  'run_status',r.status,'manifest_sha256',p_manifest_sha256,'scope',r.scope,'registered',m is not null,
  'batches',batches,'observation_counts',counts,'objects',objects,'object_bytes',object_bytes,
  'objects_missing_from_private_catalog',missing_objects,'private_only',true,'published',false);
end $$;

-- An accepted batch receipt alone is insufficient to skip a batch on resume.
-- Reconcile each exact payload version and observation against the pinned batch.
create function public.corpus_publisher_code_verify_batch_v1(p_run uuid,p_batch_index integer,p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb; b jsonb; expected bigint; matched bigint; receipt corpus_ingest.publisher_code_batch_receipts_v1; s jsonb;
begin
 select manifest into m from corpus_ingest.publisher_code_packets_v1 where run_id=p_run;
 if m is null or p_batch_index is null or p_batch_index<0 or p_batch_index>=jsonb_array_length(m->'batches')
  or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Registered immutable batch required' using errcode='22023';
 end if;
 s:=public.corpus_publisher_code_status_v1(p_run,corpus_ingest.canonical_integer_jsonb_sha256_v1(m));
 b:=m->'batches'->p_batch_index; expected:=jsonb_array_length(p_rows);
 if expected not between 1 and 500 or b->'records' is distinct from to_jsonb(expected)
  or b->>'sha256' is distinct from corpus_ingest.canonical_integer_jsonb_sha256_v1(p_rows)
  or (b->>'bytes')::bigint<>octet_length(corpus_ingest.canonical_integer_jsonb_v1(p_rows)) then
  raise exception 'Verification differs from immutable batch' using errcode='22023';
 end if;
 select * into receipt from corpus_ingest.publisher_code_batch_receipts_v1 where run_id=p_run and batch_index=p_batch_index;
 select count(*) into matched from jsonb_array_elements(p_rows) r
  where exists(select 1 from corpus_ingest.observations o join corpus_ingest.entity_versions v
   on v.source_system=o.source_system and v.entity_type=o.entity_type and v.native_id=o.native_id and v.payload_sha256=o.payload_sha256
   where o.run_id=p_run and o.source_system=r->>'source_system' and o.entity_type=r->>'entity_type'
    and o.native_id=r->>'native_id' and o.payload_sha256=r->'provenance'->>'record_sha256'
    and o.source_url=r->'provenance'->>'source_url' and o.source_sha256=r->'provenance'->>'source_sha256'
    and o.retrieved_at=(r->'provenance'->>'retrieved_at')::timestamptz and o.provenance=r->'provenance'
    and v.schema_version=r->>'schema_version' and v.data=r->'data'
    and corpus_ingest.canonical_integer_jsonb_sha256_v1(v.data)=o.payload_sha256);
 return jsonb_build_object('contract','publisher-code-progress/1','run_id',p_run,'batch_index',p_batch_index,
  'sha256',b->>'sha256','expected',expected,'matched',matched,'receipt_present',receipt.run_id is not null,
  'receipt_matches',coalesce(receipt.batch_sha256=b->>'sha256' and receipt.records=expected,false),
  'verified',receipt.run_id is not null and receipt.batch_sha256=b->>'sha256' and receipt.records=expected and matched=expected,
  'private_only',true,'published',false);
end $$;
revoke all on function public.corpus_publisher_code_status_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.corpus_publisher_code_verify_batch_v1(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_publisher_code_status_v1(uuid,text) to service_role;
grant execute on function public.corpus_publisher_code_verify_batch_v1(uuid,integer,jsonb) to service_role;
commit;
