-- Prepared additive contract; not a deployed migration. Requires corpus-ingest-v1,
-- canonical-integer-jsonb-v1, and Supabase's private Storage object catalog.
-- This revision admits the reviewed Texas parser v5 packet only. Other publisher
-- formats require their own reviewed adapter, not an invented common native ID.
begin;

create table corpus_ingest.publisher_code_packets_v1 (
 run_id uuid primary key references corpus_ingest.runs(id),
 manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 manifest jsonb not null,
 assets_sha256 text not null check(assets_sha256 ~ '^[a-f0-9]{64}$'),
 registered_at timestamptz not null default now()
);
create table corpus_ingest.publisher_code_objects_v1 (
 sha256 text primary key check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint not null check(bytes>0),
 bucket text not null check(bucket='corpus-originals'),
 object_key text not null unique,
 check(object_key='state-codes/sha256/'||left(sha256,2)||'/'||sha256),
 first_run uuid not null references corpus_ingest.runs(id),
 verified_at timestamptz not null,
 readback_receipt jsonb not null
);
create table corpus_ingest.publisher_code_packet_objects_v1 (
 run_id uuid not null references corpus_ingest.publisher_code_packets_v1(run_id),
 sha256 text not null references corpus_ingest.publisher_code_objects_v1(sha256),
 asset jsonb not null,
 readback_receipt jsonb not null,
 primary key(run_id,sha256)
);
create table corpus_ingest.publisher_code_batch_receipts_v1 (
 run_id uuid not null references corpus_ingest.publisher_code_packets_v1(run_id),
 batch_index integer not null check(batch_index>=0),
 batch_sha256 text not null check(batch_sha256 ~ '^[a-f0-9]{64}$'),
 records integer not null check(records between 1 and 500),
 result jsonb not null,
 imported_at timestamptz not null default now(),
 primary key(run_id,batch_index)
);
alter table corpus_ingest.publisher_code_packets_v1 enable row level security;
alter table corpus_ingest.publisher_code_objects_v1 enable row level security;
alter table corpus_ingest.publisher_code_packet_objects_v1 enable row level security;
alter table corpus_ingest.publisher_code_batch_receipts_v1 enable row level security;
revoke all on corpus_ingest.publisher_code_packets_v1,corpus_ingest.publisher_code_objects_v1,
 corpus_ingest.publisher_code_packet_objects_v1,corpus_ingest.publisher_code_batch_receipts_v1
 from public,anon,authenticated,service_role;
grant select on corpus_ingest.publisher_code_packets_v1,corpus_ingest.publisher_code_objects_v1,
 corpus_ingest.publisher_code_packet_objects_v1,corpus_ingest.publisher_code_batch_receipts_v1 to service_role;

create function corpus_ingest.publisher_code_open_run_v1(p_run uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb;
begin
 select scope into s from corpus_ingest.runs where id=p_run and status in ('running','partial') for share;
 if s is null or s->>'source_system' is distinct from 'texas-legislature-code'
  or s->>'contract' is distinct from 'publisher-code-intake/1'
  or s->>'jurisdiction' is distinct from 'TX'
  or coalesce(s->>'packet_manifest_sha256','') !~ '^[a-f0-9]{64}$'
  or s->'private_only' is distinct from 'true'::jsonb
  or s->'public_projection_allowed' is distinct from 'false'::jsonb
  or s->'calculation_activation_allowed' is distinct from 'false'::jsonb then
  raise exception 'Exact open private publisher-code run required' using errcode='22023';
 end if;
 return s;
end $$;

-- The authenticated uploader supplies whole-object readback receipts. SQL checks
-- their consistency and actual private object catalog rows; it cannot itself
-- hash remote object bytes. Never manufacture these receipts from asset plans.
create function public.corpus_publisher_code_register_v1(p_run uuid,p_manifest jsonb,p_assets jsonb,p_readbacks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; a jsonb; v jsonb; receipts_by_hash jsonb; old corpus_ingest.publisher_code_objects_v1; total bigint;
begin
 s:=corpus_ingest.publisher_code_open_run_v1(p_run);
 if jsonb_typeof(p_manifest) is distinct from 'object'
  or jsonb_typeof(p_assets) is distinct from 'array' or jsonb_typeof(p_readbacks) is distinct from 'array'
  or jsonb_array_length(p_assets) not between 1 and 20000
  or octet_length(p_manifest::text)+octet_length(p_assets::text)+octet_length(p_readbacks::text)>16777216
  or p_manifest->>'schema_version' is distinct from 'publisher-code-private-packet/1'
  or p_manifest->>'project_id' is distinct from 'xosqzzsnhxcyehcnirpa'
  or p_manifest->>'source_system' is distinct from s->>'source_system'
  or p_manifest->>'parser' is distinct from 'texas-publisher-html/5'
  or p_manifest->'registered' is distinct from 'false'::jsonb
  or p_manifest->'published' is distinct from 'false'::jsonb
  or p_manifest->'cloud_verified' is distinct from 'false'::jsonb
  or corpus_ingest.canonical_integer_jsonb_sha256_v1(p_manifest) is distinct from s->>'packet_manifest_sha256'
  or corpus_ingest.canonical_integer_jsonb_sha256_v1(p_assets) is distinct from p_manifest->'assets'->>'sha256'
  or p_manifest->'assets'->'unique_objects' is distinct from to_jsonb(jsonb_array_length(p_assets))
  or jsonb_array_length(p_assets)<>jsonb_array_length(p_readbacks)
  or jsonb_typeof(p_manifest->'batches') is distinct from 'array'
  or jsonb_array_length(p_manifest->'batches') not between 1 and 10000 then
  raise exception 'Packet identity, manifest or bounded asset plan mismatch' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_assets) x group by x->>'sha256' having count(*)<>1)
  or exists(select 1 from jsonb_array_elements(p_readbacks) x group by x->>'sha256' having count(*)<>1)
  or exists(select 1 from jsonb_array_elements(p_manifest->'batches') with ordinality b(x,n)
    where x->>'file' is distinct from 'batch-'||lpad((n-1)::text,5,'0')||'.json'
     or coalesce(x->>'sha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(x->>'records','') !~ '^[1-9][0-9]{0,2}$' or (x->>'records')::int>500
     or coalesce(x->>'bytes','') !~ '^[1-9][0-9]{0,6}$' or (x->>'bytes')::int>1900000) then
  raise exception 'Duplicate assets or invalid bounded batch plan' using errcode='22023';
 end if;
 select sum((x->>'records')::bigint) into total from jsonb_array_elements(p_manifest->'batches') x;
 if coalesce(p_manifest->'counts'->>'code-chapter-document','') !~ '^[1-9][0-9]{0,8}$'
  or coalesce(p_manifest->'counts'->>'code-section-occurrence','') !~ '^[1-9][0-9]{0,8}$'
  or total<>(p_manifest->'counts'->>'code-chapter-document')::bigint+(p_manifest->'counts'->>'code-section-occurrence')::bigint then
  raise exception 'Manifest record totals disagree' using errcode='22023';
 end if;
 if exists(select 1 from corpus_ingest.publisher_code_packets_v1 where run_id=p_run
    and (manifest is distinct from p_manifest or manifest_sha256 is distinct from s->>'packet_manifest_sha256')) then
  raise exception 'Run already has a different immutable packet' using errcode='22023';
 end if;
 select jsonb_object_agg(x->>'sha256',x) into receipts_by_hash from jsonb_array_elements(p_readbacks) x;
 total:=0;
 for a in select value from jsonb_array_elements(p_assets) loop
  v:=receipts_by_hash->(a->>'sha256');
  if coalesce(a->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(a->>'bytes','') !~ '^[1-9][0-9]{0,10}$'
   or v is null or v->'bytes' is distinct from a->'bytes'
   or v->>'bucket' is distinct from 'corpus-originals'
   or v->>'object_key' is distinct from 'state-codes/sha256/'||left(a->>'sha256',2)||'/'||(a->>'sha256')
   or v->>'readback_sha256' is distinct from a->>'sha256' or v->'readback_bytes' is distinct from a->'bytes'
   or v->>'verification_method' is distinct from 'authenticated-whole-object-get-sha256'
   or v->'http_status' is distinct from '200'::jsonb or coalesce(v->>'verified_at','')=''
   or not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
     where b.id='corpus-originals' and b.public is false and o.name=v->>'object_key'
      and o.metadata->>'size'=a->>'bytes') then
   raise exception 'Verified private object and whole-body receipt required' using errcode='22023';
  end if;
  total:=total+(a->>'bytes')::bigint;
  select * into old from corpus_ingest.publisher_code_objects_v1 where sha256=a->>'sha256';
  if found and (old.bytes<>(a->>'bytes')::bigint or old.object_key<>v->>'object_key' or old.bucket<>v->>'bucket') then
   raise exception 'Stored object identity conflicts with retained bytes' using errcode='22023';
  end if;
  insert into corpus_ingest.publisher_code_objects_v1(sha256,bytes,bucket,object_key,first_run,verified_at,readback_receipt)
   values(a->>'sha256',(a->>'bytes')::bigint,v->>'bucket',v->>'object_key',p_run,(v->>'verified_at')::timestamptz,v)
   on conflict do nothing;
 end loop;
 if p_manifest->'assets'->'unique_bytes' is distinct from to_jsonb(total) then
  raise exception 'Asset byte total mismatch' using errcode='22023';
 end if;
 insert into corpus_ingest.publisher_code_packets_v1(run_id,manifest_sha256,manifest,assets_sha256)
  values(p_run,s->>'packet_manifest_sha256',p_manifest,p_manifest->'assets'->>'sha256') on conflict do nothing;
 insert into corpus_ingest.publisher_code_packet_objects_v1(run_id,sha256,asset,readback_receipt)
  select p_run,pa.asset_row->>'sha256',pa.asset_row,pr.receipt_row
   from jsonb_array_elements(p_assets) pa(asset_row)
   join jsonb_array_elements(p_readbacks) pr(receipt_row)
    on pr.receipt_row->>'sha256'=pa.asset_row->>'sha256' on conflict do nothing;
 return jsonb_build_object('registered_packet',s->>'packet_manifest_sha256','objects',jsonb_array_length(p_assets),
   'bytes',total,'published',false);
end $$;

create function public.corpus_publisher_code_intake_v1(p_run uuid,p_batch_index integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; m jsonb; b jsonb; r jsonb; d jsonb; p jsonb; parent jsonb; h text; result jsonb; prior jsonb;
begin
 s:=corpus_ingest.publisher_code_open_run_v1(p_run);
 -- Serialize this run so two callers cannot race receipt/duplicate checks.
 perform 1 from corpus_ingest.publisher_code_packets_v1 where run_id=p_run for update;
 select manifest into m from corpus_ingest.publisher_code_packets_v1 where run_id=p_run and manifest_sha256=s->>'packet_manifest_sha256';
 if m is null or p_batch_index is null or p_batch_index<0 or p_batch_index>=jsonb_array_length(m->'batches')
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
  raise exception 'Registered packet and bounded batch required' using errcode='22023';
 end if;
 b:=m->'batches'->p_batch_index;
 h:=corpus_ingest.canonical_integer_jsonb_sha256_v1(p_rows);
 if h is distinct from b->>'sha256' or b->'records' is distinct from to_jsonb(jsonb_array_length(p_rows))
  or (b->>'bytes')::bigint<>octet_length(corpus_ingest.canonical_integer_jsonb_v1(p_rows)) then
  raise exception 'Intake differs from reviewed immutable batch' using errcode='22023';
 end if;
 select t.result into prior from corpus_ingest.publisher_code_batch_receipts_v1 t where t.run_id=p_run and t.batch_index=p_batch_index;
 if found then return prior||jsonb_build_object('replayed',true); end if;
 if p_batch_index<>(select count(*) from corpus_ingest.publisher_code_batch_receipts_v1 where run_id=p_run) then
  raise exception 'Intake batches must follow their recorded order' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'entity_type',x->>'native_id' having count(*)<>1) then
  raise exception 'Duplicate source occurrences in batch' using errcode='22023';
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  d:=r->'data'; p:=r->'provenance';
  if r->>'source_system' is distinct from s->>'source_system' or r->>'schema_version' is distinct from 'publisher-code-evidence/1'
   or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object'
   or length(coalesce(r->>'native_id','')) not between 1 and 512
   or coalesce(r->>'entity_type','') not in ('code-chapter-document','code-section-occurrence')
   or d->>'jurisdiction' is distinct from 'TX' or d->'publisher_native_entity' is distinct from 'false'::jsonb
   or d->'public_projection_allowed' is distinct from 'false'::jsonb or d->'current_law_verified' is distinct from 'false'::jsonb
   or d->'calculation_activation_allowed' is distinct from 'false'::jsonb
   or p->>'record_hash_codec' is distinct from 'canonical-integer-jsonb/1'
   or corpus_ingest.canonical_integer_jsonb_sha256_v1(d) is distinct from p->>'record_sha256'
   or p->>'parser' is distinct from m->>'parser' or p->>'retrieval_method' is distinct from 'publisher_zip_member'
   or p->'source_as_of' is distinct from 'null'::jsonb or coalesce(p->>'retrieved_at','')=''
   or coalesce(d->>'code','') !~ '^[A-Z][A-Z0-9]$'
   or p->>'source_url' is distinct from 'https://tcss.legis.texas.gov/resources/Zips/'||(d->>'code')||'.htm.zip'
   or coalesce(p->>'publisher_member','') !~ '^[A-Za-z0-9._ -]+\.htm$'
   or coalesce(p->>'raw_member_sha256','') !~ '^[a-f0-9]{64}$'
   or not exists(select 1 from corpus_ingest.publisher_code_packet_objects_v1 a where a.run_id=p_run and a.sha256=p->>'source_sha256'
      and a.asset->>'kind'='publisher_archive'
      and exists(select 1 from jsonb_array_elements(a.asset->'source_references') ref
       where ref->>'code'=d->>'code' and ref->>'source_url'=p->>'source_url'
        and ref->>'sha256'=p->>'source_sha256' and ref->'bytes'=a.asset->'bytes'
        and ref->>'retrieved_at'=p->>'retrieved_at' and ref->'http_status'='200'::jsonb)) then
   raise exception 'Invalid publisher identity, source, hash or private gate' using errcode='22023';
  end if;
  if r->>'entity_type'='code-chapter-document' then
   if r->>'native_id' is distinct from (d->>'code')||':'||(p->>'publisher_member')
    or d->>'identity_kind' is distinct from 'publisher_code_and_member_filename'
    or d->>'publisher_member' is distinct from p->>'publisher_member'
    or d->>'raw_member_sha256' is distinct from p->>'raw_member_sha256'
    or d->>'archive_sha256' is distinct from p->>'source_sha256'
    or not exists(select 1 from corpus_ingest.publisher_code_packet_objects_v1 a where a.run_id=p_run
      and a.sha256=d->>'text_sha256' and a.asset->'bytes'=d->'text_bytes' and a.asset->>'kind'='chapter_text_derivative'
      and exists(select 1 from jsonb_array_elements(a.asset->'source_references') ref
       where ref->>'chapter_identity'=r->>'native_id' and ref->>'archive_sha256'=p->>'source_sha256'
        and ref->>'raw_member_sha256'=p->>'raw_member_sha256' and ref->>'parser'=p->>'parser')) then
    raise exception 'Chapter derivative/source binding mismatch' using errcode='22023';
   end if;
  else
   select v.data into parent from corpus_ingest.entity_versions v
    where v.source_system=s->>'source_system' and v.entity_type='code-chapter-document'
     and v.native_id=d->>'chapter_identity' and v.data->>'text_sha256'=d->>'text_derivative_sha256'
     and v.data->>'raw_member_sha256'=p->>'raw_member_sha256' and v.data->>'archive_sha256'=p->>'source_sha256';
   if parent is null or d->>'chapter_identity' is distinct from (d->>'code')||':'||(p->>'publisher_member')
    or d->>'identity_kind' is distinct from 'publisher_member_anchor_occurrence'
    or coalesce(d->>'native_section_anchor','')='' or coalesce(d->>'occurrence','') !~ '^[1-9][0-9]{0,8}$'
    or d->>'native_citation_key' is distinct from (d->>'code')||':'||(d->>'native_section_anchor')
    or r->>'native_id' is distinct from (d->>'chapter_identity')||':'||(d->>'native_section_anchor')||':'||(d->>'occurrence')
    or d->'text_span'->>'unit' is distinct from 'unicode_code_points'
    or coalesce(d->'text_span'->>'start','') !~ '^[0-9]{1,9}$' or coalesce(d->'text_span'->>'end','') !~ '^[0-9]{1,9}$'
    or (d->'text_span'->>'start')::bigint>=(d->'text_span'->>'end')::bigint
    or (d->'text_span'->>'end')::bigint>(parent->>'text_bytes')::bigint
    or coalesce(d->>'text_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'Section composite identity or parent span mismatch' using errcode='22023';
   end if;
  end if;
  if exists(select 1 from corpus_ingest.observations o where o.run_id=p_run and o.source_system=r->>'source_system'
    and o.entity_type=r->>'entity_type' and o.native_id=r->>'native_id') then
   raise exception 'Source occurrence repeats across packet batches' using errcode='22023';
  end if;
 end loop;
 -- Base writer retains raw payload versions and HTTP observations, preserves
 -- review_status, and does not touch any public collection or legal-rule gate.
 result:=corpus_ingest.ingest_entities(p_run,p_rows);
 insert into corpus_ingest.publisher_code_batch_receipts_v1(run_id,batch_index,batch_sha256,records,result)
  values(p_run,p_batch_index,h,jsonb_array_length(p_rows),result);
 return result||jsonb_build_object('replayed',false,'published',false);
end $$;

revoke all on function corpus_ingest.publisher_code_open_run_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.corpus_publisher_code_register_v1(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_publisher_code_intake_v1(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_publisher_code_register_v1(uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.corpus_publisher_code_intake_v1(uuid,integer,jsonb) to service_role;
commit;
