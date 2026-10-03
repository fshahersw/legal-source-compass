-- Private source captures for the user-authorized PDF backfill. No UI grants.
create table if not exists corpus_ingest.pdf_backfill_captures (
 capture_sha256 text primary key check (capture_sha256 ~ '^[a-f0-9]{64}$'),
 source_system text not null check (source_system in ('courtlistener-firecrawl-html','docketbird-mcp')),
 source_url text not null,
 native_case_id text,
 retrieved_at timestamptz not null,
 capture_storage_key text not null unique,
 capture_bytes bigint not null check (capture_bytes > 0),
 metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
 metadata_storage_key text not null,
 metadata_bytes bigint not null check (metadata_bytes > 0),
 records jsonb not null,
 provenance jsonb not null,
 registered_at timestamptz not null default now(),
 check (capture_storage_key='seeger-weiss/focused-metadata-sha256/'||substr(capture_sha256,1,2)||'/'||capture_sha256||'.json'),
 check (metadata_storage_key='seeger-weiss/focused-metadata-sha256/'||substr(metadata_sha256,1,2)||'/'||metadata_sha256||'.json')
);
create index if not exists pdf_backfill_captures_case_idx on corpus_ingest.pdf_backfill_captures(source_system,native_case_id);
alter table corpus_ingest.pdf_backfill_captures enable row level security;
revoke all on corpus_ingest.pdf_backfill_captures from public,anon,authenticated;

create or replace function public.corpus_admin_register_pdf_capture_v1(p_row jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare old_row corpus_ingest.pdf_backfill_captures; matched integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if jsonb_typeof(p_row) is distinct from 'object'
  or coalesce(p_row->>'capture_sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_row->>'metadata_sha256','') !~ '^[a-f0-9]{64}$'
  or p_row->>'capture_storage_key' is distinct from ('seeger-weiss/focused-metadata-sha256/'||substr(p_row->>'capture_sha256',1,2)||'/'||(p_row->>'capture_sha256')||'.json')
  or p_row->>'metadata_storage_key' is distinct from ('seeger-weiss/focused-metadata-sha256/'||substr(p_row->>'metadata_sha256',1,2)||'/'||(p_row->>'metadata_sha256')||'.json')
  or coalesce(p_row->>'capture_bytes','') !~ '^[1-9][0-9]*$'
  or coalesce(p_row->>'metadata_bytes','') !~ '^[1-9][0-9]*$'
  or jsonb_typeof(p_row->'records') is distinct from 'object'
  or jsonb_typeof(p_row->'provenance') is distinct from 'object'
  or p_row->'provenance'->'public_projection_allowed' is distinct from 'false'::jsonb
  or p_row->'provenance'->'cloud_readback_verified' is distinct from 'true'::jsonb
  or octet_length(p_row::text)>12000000 then raise exception 'Invalid source capture'; end if;
 if p_row->>'source_system'='courtlistener-firecrawl-html' then
  if coalesce(p_row->>'native_case_id','') !~ '^[1-9][0-9]*$'
   or coalesce(p_row->>'source_url','') !~ ('^https://www[.]courtlistener[.]com/docket/'||(p_row->>'native_case_id')||'/[^/?#]+/([?]page=[1-9][0-9]*)?$')
   or p_row->'provenance'->'courtlistener_api_requests' is distinct from '0'::jsonb then raise exception 'Observed docket HTML required'; end if;
 elsif p_row->>'source_system'='docketbird-mcp' then
  if p_row->>'source_url' is distinct from 'https://mcp.docketbird.com/mcp' then raise exception 'DocketBird MCP capture required'; end if;
 else raise exception 'Unsupported source'; end if;
 select count(*) into matched from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id='corpus-originals' and b.public=false and o.name=p_row->>'capture_storage_key' and (o.metadata->>'size')::bigint=(p_row->>'capture_bytes')::bigint;
 if matched<>1 then raise exception 'Private raw capture missing'; end if;
 select count(*) into matched from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id='corpus-originals' and b.public=false and o.name=p_row->>'metadata_storage_key' and (o.metadata->>'size')::bigint=(p_row->>'metadata_bytes')::bigint;
 if matched<>1 then raise exception 'Private parsed metadata missing'; end if;
 insert into corpus_ingest.pdf_backfill_captures(capture_sha256,source_system,source_url,native_case_id,retrieved_at,capture_storage_key,capture_bytes,metadata_sha256,metadata_storage_key,metadata_bytes,records,provenance)
 values(p_row->>'capture_sha256',p_row->>'source_system',p_row->>'source_url',p_row->>'native_case_id',(p_row->>'retrieved_at')::timestamptz,p_row->>'capture_storage_key',(p_row->>'capture_bytes')::bigint,p_row->>'metadata_sha256',p_row->>'metadata_storage_key',(p_row->>'metadata_bytes')::bigint,p_row->'records',p_row->'provenance') on conflict do nothing;
 select * into old_row from corpus_ingest.pdf_backfill_captures where capture_sha256=p_row->>'capture_sha256';
 if old_row.source_system is distinct from p_row->>'source_system' or old_row.source_url is distinct from p_row->>'source_url'
  or old_row.native_case_id is distinct from p_row->>'native_case_id' or old_row.metadata_sha256 is distinct from p_row->>'metadata_sha256'
  or old_row.capture_bytes is distinct from (p_row->>'capture_bytes')::bigint or old_row.records is distinct from p_row->'records'
 then raise exception 'Immutable source capture conflict'; end if;
 return jsonb_build_object('registered',true,'private_only',true,'capture_sha256',old_row.capture_sha256);
end $$;
revoke all on function public.corpus_admin_register_pdf_capture_v1(jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_register_pdf_capture_v1(jsonb) to service_role;
