-- Narrow reviewed selection of the retained CA parser-4 version of the SAME archive.
-- Earlier source retrieval dates are truthful; no timestamp or global ingestion policy is changed.
-- Prepared for owner application. No row is promoted merely by installing these functions.
begin;

create or replace function corpus_ingest.ca_parser4_promotion_guard_v1()
returns void language plpgsql set search_path='' as $$
declare st corpus_ingest.publisher_code_states_v2;
begin
 select * into st from corpus_ingest.publisher_code_states_v2 where jurisdiction='CA' for update;
 if not found or st.source_system is distinct from 'ca-leginfo-pubinfo'
  or st.current_manifest_sha256 is distinct from '4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03'
  or st.public_projection_allowed is distinct from false
  or exists(select 1 from corpus_ingest.publisher_code_codes_v3 where source_system='ca-leginfo-pubinfo' and public_projection_allowed)
  or not exists(select 1 from corpus_ingest.runs where id='48f97671-5852-5965-8b45-1adbe689b8ce'
    and status='completed' and scope->>'source_system'='ca-leginfo-pubinfo'
    and scope->>'manifest_sha256'='4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03')
  or exists(select 1 from corpus_ingest.runs where status in ('running','partial') and scope->>'source_system'='ca-leginfo-pubinfo') then
  raise exception 'Completed exact CA parser-4 run, closed publication gates and no competing run required' using errcode='22023';
 end if;
end $$;

create or replace function public.corpus_ca_parser4_promote_v1(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r jsonb; e corpus_ingest.entities; target record; prior corpus_ingest.cleanup_decisions;
 after_image jsonb; promoted integer:=0; replayed integer:=0; record_key text;
begin
 perform corpus_ingest.ca_parser4_promotion_guard_v1();
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
  or octet_length(p_rows::text)>262144
  or exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'entity_type',x->>'native_id' having count(*)>1) then
  raise exception 'Bounded unique CA row identities required' using errcode='22023';
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'entity_type','') not in ('code-section','code-source-unit')
   -- Printed identifiers include spaces, brackets and a fraction character.
   -- Bound the source scope here; the exact retained run identity+hash below is authoritative.
   or coalesce(r->>'native_id','') !~ '^CA:(unit:code-[A-Z]{2,4}|[A-Z]{2,4}:.{1,250})$'
   or (r->>'native_id') ~ '[[:cntrl:]]'
   or coalesce(r->>'payload_sha256','') !~ '^[a-f0-9]{64}$' then
   raise exception 'Exact CA target identity and hash required' using errcode='22023';
  end if;
  select v.data,v.schema_version,o.provenance,o.source_as_of,o.retrieved_at,o.payload_sha256
   into target from corpus_ingest.observations o join corpus_ingest.entity_versions v
   on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(o.source_system,o.entity_type,o.native_id,o.payload_sha256)
   where o.run_id='48f97671-5852-5965-8b45-1adbe689b8ce' and o.source_system='ca-leginfo-pubinfo'
    and o.entity_type=r->>'entity_type' and o.native_id=r->>'native_id' and o.payload_sha256=r->>'payload_sha256'
    and o.source_url='https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip';
  if not found or target.schema_version is distinct from 'publisher-code-evidence/2'
   or target.provenance->>'parser' is distinct from 'california-pubinfo-xml/4'
   or target.provenance->>'manifest_sha256' is distinct from '4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03'
   or target.provenance->>'source_sha256' is distinct from '2b443092fc6ad7fbee78d694dd885ec9a44337ebc2b9557980c8846d27978f2c'
   or target.retrieved_at is distinct from '2026-10-05T22:24:52.030Z'::timestamptz or target.source_as_of is not null
   or (target.provenance->>'retrieved_at')::timestamptz is distinct from target.retrieved_at
   or target.provenance->'source_as_of' is distinct from 'null'::jsonb
   or target.provenance->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
   or target.provenance->>'record_sha256' is distinct from target.payload_sha256
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(target.data) is distinct from target.payload_sha256
   or target.data->'jurisdiction' is distinct from '"CA"'::jsonb
   or target.data->'publisher_native_entity' is distinct from 'false'::jsonb
   or target.data->'public_projection_allowed' is distinct from 'false'::jsonb
   or target.data->'current_law_verified' is distinct from 'false'::jsonb
   or target.data->'calculation_activation_allowed' is distinct from 'false'::jsonb then
   raise exception 'Target is not the verified retained CA parser-4 observation' using errcode='22023';
  end if;
  select * into e from corpus_ingest.entities where source_system='ca-leginfo-pubinfo'
   and entity_type=r->>'entity_type' and native_id=r->>'native_id' for update;
  if not found then raise exception 'CA current identity missing' using errcode='22023'; end if;
  record_key=e.entity_type||':'||e.native_id;
  select * into prior from corpus_ingest.cleanup_decisions where dataset='ca_parser4_source_selection'
   and record_id=record_key and issue='ca_parser4_exact_archive_20261012';
  if e.payload_sha256=target.payload_sha256 and e.data=target.data and e.provenance=target.provenance
   and e.retrieved_at=target.retrieved_at and e.source_as_of is not distinct from target.source_as_of
   and e.last_run='48f97671-5852-5965-8b45-1adbe689b8ce' and prior.record_id is not null
   and (to_jsonb(e)-'data')=prior.replacement then
   replayed:=replayed+1;continue;
  end if;
  if e.provenance->>'parser' is distinct from 'california-pubinfo-xml/3'
   or e.provenance->>'manifest_sha256' is distinct from '8c4d8025e4f8a5055a2f420a77bbc22f9b9e376886496d795e8aacbcdba90599'
   or e.provenance->>'source_sha256' is distinct from target.provenance->>'source_sha256'
   or e.retrieved_at is distinct from '2026-10-09T02:19:34Z'::timestamptz or e.source_as_of is not null
   or e.last_run is distinct from '124b4562-8590-5a0c-9509-96af3d444054'::uuid
   or e.review_status='quarantined' or e.schema_version is distinct from target.schema_version
   or e.data->'current_law_verified' is distinct from 'false'::jsonb
   or e.data->'calculation_activation_allowed' is distinct from 'false'::jsonb
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(e.data) is distinct from e.payload_sha256
   or not exists(select 1 from corpus_ingest.entity_versions v where
    (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(e.source_system,e.entity_type,e.native_id,e.payload_sha256)
    and v.data=e.data and v.schema_version=e.schema_version) then
   raise exception 'Current CA row changed from the diagnosed parser-3 source version' using errcode='22023';
  end if;
  after_image=to_jsonb(e)||jsonb_build_object('payload_sha256',target.payload_sha256,'schema_version',target.schema_version,
    'data',target.data,'provenance',target.provenance,'source_as_of',target.source_as_of,'retrieved_at',target.retrieved_at,
    'last_run','48f97671-5852-5965-8b45-1adbe689b8ce');
  if prior.record_id is not null and (prior.original_record is distinct from to_jsonb(e) or prior.replacement is distinct from after_image-'data') then
   raise exception 'Existing correction ledger differs; never overwrite before-images' using errcode='22023';
  end if;
  insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
   values('ca_parser4_source_selection',record_key,'ca_parser4_exact_archive_20261012','label_override',
    'Explicit reviewed parser selection over the same retained archive; generic retrieval-time ordering kept parser 3. Original retrieval timestamps and all authority gates preserved.',
    jsonb_build_object('contract','ca-parser4-promotion/1','archive_sha256',target.provenance->>'source_sha256',
     'target_payload_sha256',target.payload_sha256,'source_run','48f97671-5852-5965-8b45-1adbe689b8ce',
     'verification','packet-v4-independent-verification-crosslinked.json; whole-cloud comparison required before review'),
    to_jsonb(e),after_image-'data','48f97671-5852-5965-8b45-1adbe689b8ce') on conflict do nothing;
  update corpus_ingest.entities set payload_sha256=target.payload_sha256,schema_version=target.schema_version,
   data=target.data,provenance=target.provenance,source_as_of=target.source_as_of,retrieved_at=target.retrieved_at,
   last_run='48f97671-5852-5965-8b45-1adbe689b8ce' where source_system=e.source_system and entity_type=e.entity_type and native_id=e.native_id;
  promoted:=promoted+1;
 end loop;
 return jsonb_build_object('promoted',promoted,'already_promoted',replayed,'public_projection_allowed',false,
   'current_law_verified',false,'retrieval_timestamp_fabricated',false);
end $$;

create or replace function public.corpus_ca_parser4_restore_v1(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r jsonb; e corpus_ingest.entities; old corpus_ingest.entities; d corpus_ingest.cleanup_decisions;
 restored integer:=0; replayed integer:=0;
begin
 perform corpus_ingest.ca_parser4_promotion_guard_v1();
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
  or octet_length(p_rows::text)>262144 then raise exception 'Bounded restore identities required' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  select * into d from corpus_ingest.cleanup_decisions where dataset='ca_parser4_source_selection'
   and issue='ca_parser4_exact_archive_20261012' and record_id=(r->>'entity_type')||':'||(r->>'native_id');
  if not found or d.replacement->>'payload_sha256' is distinct from r->>'payload_sha256' then
   raise exception 'Exact recorded CA correction required for restore' using errcode='22023';
  end if;
  select * into e from corpus_ingest.entities where source_system='ca-leginfo-pubinfo'
   and entity_type=r->>'entity_type' and native_id=r->>'native_id' for update;
  if not found then raise exception 'Current CA identity missing' using errcode='22023'; end if;
  if to_jsonb(e)=d.original_record then replayed:=replayed+1;continue;end if;
  if (to_jsonb(e)-'data') is distinct from d.replacement
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(e.data) is distinct from e.payload_sha256 then
   raise exception 'Current CA row changed after promotion; rollback refused' using errcode='22023';
  end if;
  old=jsonb_populate_record(null::corpus_ingest.entities,d.original_record);
  if corpus_ingest.canonical_integer_jsonb_sha256_v1(old.data) is distinct from old.payload_sha256 then
   raise exception 'CA before-image integrity mismatch' using errcode='22023';
  end if;
  update corpus_ingest.entities set payload_sha256=old.payload_sha256,schema_version=old.schema_version,data=old.data,
    provenance=old.provenance,source_as_of=old.source_as_of,retrieved_at=old.retrieved_at,last_run=old.last_run,review_status=old.review_status
   where source_system=e.source_system and entity_type=e.entity_type and native_id=e.native_id;
  restored:=restored+1;
 end loop;
 return jsonb_build_object('restored',restored,'already_restored',replayed,'public_projection_allowed',false);
end $$;

revoke all on function corpus_ingest.ca_parser4_promotion_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.corpus_ca_parser4_promote_v1(jsonb) from public,anon,authenticated;
revoke all on function public.corpus_ca_parser4_restore_v1(jsonb) from public,anon,authenticated;
grant execute on function public.corpus_ca_parser4_promote_v1(jsonb) to service_role;
grant execute on function public.corpus_ca_parser4_restore_v1(jsonb) to service_role;
commit;
