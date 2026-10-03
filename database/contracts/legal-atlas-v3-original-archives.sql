create table legal_atlas.original_archives (
  sha256 text primary key check(sha256~'^[a-f0-9]{64}$'),
  bytes bigint not null check(bytes>0),
  bucket text not null check(bucket='corpus-originals'),
  manifest_key text not null,
  manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
  provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  verified_at timestamptz not null,
  check(manifest_key='legal-atlas/originals/sha256/'||sha256||'/manifest.json')
);
alter table legal_atlas.original_archives enable row level security;
revoke all on legal_atlas.original_archives from public,anon,authenticated;
grant all on legal_atlas.original_archives to service_role;

create function public.corpus_legal_register_archive_v3(p_archive jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing legal_atlas.original_archives%rowtype;
begin
  if not exists(select 1 from storage.buckets where id='corpus-originals' and public=false)
    or not exists(select 1 from storage.objects where bucket_id='corpus-originals' and name=p_archive->>'manifest_key') then raise exception 'Private archive manifest is missing'; end if;
  insert into legal_atlas.original_archives(sha256,bytes,bucket,manifest_key,manifest_sha256,provenance,verified_at)
    values(p_archive->>'sha256',(p_archive->>'bytes')::bigint,'corpus-originals',p_archive->>'manifest_key',p_archive->>'manifest_sha256',p_archive->'provenance',(p_archive->>'verified_at')::timestamptz)
    on conflict(sha256) do nothing;
  select * into existing from legal_atlas.original_archives where sha256=p_archive->>'sha256';
  if existing.bytes<>(p_archive->>'bytes')::bigint or existing.manifest_sha256<>p_archive->>'manifest_sha256' or existing.provenance<>p_archive->'provenance' then raise exception 'Immutable archive descriptor conflict'; end if;
  return jsonb_build_object('sha256',existing.sha256,'bytes',existing.bytes,'manifest_key',existing.manifest_key,'private',true);
end;
$$;
revoke all on function public.corpus_legal_register_archive_v3(jsonb) from public,anon,authenticated;
grant execute on function public.corpus_legal_register_archive_v3(jsonb) to service_role;
