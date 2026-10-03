create table legal_atlas.mdl_packets (
  mdl_id text not null check(mdl_id~'^MDL-[1-9][0-9]*$'),
  sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  packet jsonb not null check(jsonb_typeof(packet)='object'),
  approved_at timestamptz not null,
  primary key(mdl_id,sha256),
  check(packet->'mdl'->>'id'=mdl_id and packet->'mdl'->>'type'='mdl')
);
alter table legal_atlas.mdl_packets enable row level security;
revoke all on legal_atlas.mdl_packets from public,anon,authenticated;
grant all on legal_atlas.mdl_packets to service_role;

create function public.corpus_legal_mdl_v3(p_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select p.packet from legal_atlas.mdl_packets p where p.mdl_id=p_id
  and not exists(select 1 from jsonb_array_elements(p.packet->'records') item
    where not exists(select 1 from legal_atlas.records r where r.record_key=legal_atlas.ref_key(item) and r.payload=item and r.review_status='approved'))
  and not exists(select 1 from jsonb_array_elements(p.packet->'edges') item
    where not exists(select 1 from legal_atlas.visible_edges e where e.type::text=item->>'type'
      and e.from_key=legal_atlas.ref_key(item->'from') and e.to_key=legal_atlas.ref_key(item->'to') and e.source_key=legal_atlas.ref_key(item->'source_record')
      and e.extraction_method::text=item->>'extraction_method' and e.confidence=(item->>'confidence')::numeric
      and e.source_url=item->>'source_url' and e.source_date::text=item->>'date' and e.evidence=item->'evidence'
      and e.treatment::text is not distinct from item->>'treatment' and e.role::text is not distinct from item->>'role'))
  order by p.approved_at desc limit 1;
$$;
revoke all on function public.corpus_legal_mdl_v3(text) from public,anon,authenticated;
grant execute on function public.corpus_legal_mdl_v3(text) to service_role;

create function public.corpus_legal_register_mdl_v3(p_packet jsonb,p_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity text:=p_packet->'mdl'->>'id'; actual jsonb;
begin
  if p_packet->>'schema_version' is distinct from 'legal-atlas/3.1' or jsonb_typeof(p_packet->'records') is distinct from 'array'
    or jsonb_typeof(p_packet->'edges') is distinct from 'array' or jsonb_array_length(p_packet->'records')=0 then raise exception 'Reviewed MDL packet required'; end if;
  insert into legal_atlas.mdl_packets(mdl_id,sha256,packet,approved_at) values(identity,p_sha256,p_packet,clock_timestamp()) on conflict do nothing;
  if exists(select 1 from legal_atlas.mdl_packets where mdl_id=identity and sha256=p_sha256 and packet<>p_packet) then raise exception 'Immutable packet conflict'; end if;
  actual:=public.corpus_legal_mdl_v3(identity);
  if actual is distinct from p_packet then raise exception 'Packet includes unapproved or unresolved record evidence'; end if;
  return jsonb_build_object('id',identity,'sha256',p_sha256,'records',jsonb_array_length(p_packet->'records'),'private',true,'complete',p_packet->'complete');
end;
$$;
revoke all on function public.corpus_legal_register_mdl_v3(jsonb,text) from public,anon,authenticated;
grant execute on function public.corpus_legal_register_mdl_v3(jsonb,text) to service_role;
