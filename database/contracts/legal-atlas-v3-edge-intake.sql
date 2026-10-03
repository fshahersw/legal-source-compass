-- Preserve every proposed relationship, including unresolved or malformed edges.
-- Intake never approves records or relationships for website display.
create table legal_atlas.edge_inputs (
  edge_key text primary key check(edge_key~'^[a-f0-9]{64}$'),
  run_id uuid not null references legal_atlas.ingest_runs,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  schema_errors text[] not null,
  staged_at timestamptz not null default now()
);
alter table legal_atlas.edge_inputs enable row level security;
revoke all on legal_atlas.edge_inputs from public,anon,authenticated;
grant all on legal_atlas.edge_inputs to service_role;

create function legal_atlas.edge_errors(p jsonb) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare errors text[]:='{}'; k text; r jsonb; parsed_date date;
begin
  if jsonb_typeof(p) is distinct from 'object' then return array['edge:not_object']; end if;
  foreach k in array array['type','from','to','source_record','source_url','date','extraction_method','confidence','evidence','review_status','treatment','role'] loop
    if not p ? k then errors:=array_append(errors,k||':missing'); end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p) key where key<>all(array['type','from','to','source_record','source_url','date','extraction_method','confidence','evidence','review_status','treatment','role'])) then errors:=array_append(errors,'edge:unknown_fields'); end if;
  foreach k in array array['from','to','source_record'] loop
    r:=p->k;
    if jsonb_typeof(r) is distinct from 'object' then errors:=array_append(errors,k||':reference'); continue; end if;
    if not(r ?& array['id','type','id_authority','version']) or (select count(*) from jsonb_object_keys(r))<>4
      or jsonb_typeof(r->'id') is distinct from 'string' or length(btrim(r->>'id'))=0
      or jsonb_typeof(r->'version') is distinct from 'string' or length(btrim(r->>'version'))=0
      or not coalesce(r->>'type'=any(enum_range(null::legal_atlas.entity_type)::text[]),false)
      or not coalesce(r->>'id_authority'=any(enum_range(null::legal_atlas.id_authority)::text[]),false) then errors:=array_append(errors,k||':reference'); end if;
  end loop;
  if not exists(select 1 from legal_atlas.edge_contract where kind::text=p->>'type' and from_type::text=p->'from'->>'type' and to_type::text=p->'to'->>'type') then errors:=array_append(errors,'type:endpoints'); end if;
  if legal_atlas.ref_key(p->'from')=legal_atlas.ref_key(p->'to') then errors:=array_append(errors,'edge:self'); end if;
  if p->>'type'='same_as' and p->'from'->>'type' is distinct from p->'to'->>'type' then errors:=array_append(errors,'same_as:endpoints'); end if;
  if p->>'type'='coordinated_with' and p->'from'->>'type'=p->'to'->>'type' then errors:=array_append(errors,'coordinated_with:endpoints'); end if;
  if not coalesce(p->>'extraction_method'=any(enum_range(null::legal_atlas.edge_method)::text[]),false) then errors:=array_append(errors,'extraction_method:enum'); end if;
  if not coalesce(p->>'review_status'=any(enum_range(null::legal_atlas.review_status)::text[]),false) then errors:=array_append(errors,'review_status:enum'); end if;
  if p->'treatment' is distinct from 'null'::jsonb and (p->>'type'<>'cites' or not coalesce(p->>'treatment'=any(enum_range(null::legal_atlas.treatment)::text[]),false)) then errors:=array_append(errors,'treatment:enum_or_edge'); end if;
  if p->'role' is distinct from 'null'::jsonb and (p->>'type'<>'represents' or not coalesce(p->>'role'=any(enum_range(null::legal_atlas.counsel_role)::text[]),false)) then errors:=array_append(errors,'role:enum_or_edge'); end if;
  if jsonb_typeof(p->'confidence') is distinct from 'number' then errors:=array_append(errors,'confidence:type');
  elsif (p->>'confidence')::numeric<0 or (p->>'confidence')::numeric>1 then errors:=array_append(errors,'confidence:range'); end if;
  if not legal_atlas.evidence_valid(p->'evidence') then errors:=array_append(errors,'evidence:invalid'); end if;
  if jsonb_typeof(p->'source_url') is distinct from 'string' or p->>'source_url' !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then errors:=array_append(errors,'source_url:invalid'); end if;
  begin
    parsed_date:=(p->>'date')::date;
    if parsed_date is null or parsed_date::text is distinct from p->>'date' then errors:=array_append(errors,'date:format'); end if;
  exception when others then errors:=array_append(errors,'date:invalid'); end;
  return errors;
end;
$$;
revoke all on function legal_atlas.edge_errors(jsonb) from public,anon,authenticated;
grant execute on function legal_atlas.edge_errors(jsonb) to service_role;

create function public.corpus_legal_edges_v3(p_run uuid,p_edges jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; p jsonb; errors text[]; source jsonb; f jsonb; t jsonb; received integer:=0; resolved integer:=0; invalid integer:=0;
begin
  if not exists(select 1 from legal_atlas.ingest_runs where run_id=p_run) then raise exception 'Record intake run is required'; end if;
  if jsonb_typeof(p_edges) is distinct from 'array' or jsonb_array_length(p_edges)>500 then raise exception 'Bounded edges required'; end if;
  for item in select value from jsonb_array_elements(p_edges) loop
    p:=item->'payload';
    errors:=legal_atlas.edge_errors(p);
    if exists(select 1 from legal_atlas.edge_inputs where edge_key=item->>'edge_key' and payload<>p) then raise exception 'Immutable edge version conflict'; end if;
    insert into legal_atlas.edge_inputs(edge_key,run_id,payload,schema_errors) values(item->>'edge_key',p_run,p,errors) on conflict(edge_key) do nothing;
    received:=received+1;
    if cardinality(errors)>0 then invalid:=invalid+1; continue; end if;
    select payload into source from legal_atlas.records where record_key=legal_atlas.ref_key(p->'source_record');
    select payload into f from legal_atlas.records where record_key=legal_atlas.ref_key(p->'from');
    select payload into t from legal_atlas.records where record_key=legal_atlas.ref_key(p->'to');
    if source is null or f is null or t is null or source->>'source_url' is distinct from p->>'source_url' then continue; end if;
    if not coalesce((p->'evidence' ? 'paragraph_id' and jsonb_typeof(source->'attributes'->'paragraphs')='object' and source->'attributes'->'paragraphs' ? (p->'evidence'->>'paragraph_id'))
      or (p->'evidence' ? 'end' and jsonb_typeof(source->'attributes'->'text')='string' and (p->'evidence'->>'end')::numeric<=length(source->'attributes'->>'text')),false) then continue; end if;
    if p->>'type'='transferred_by' and not coalesce(t->>'court_id'='jpml' and t->'attributes'->>'document_role'='transfer_order',false) then continue; end if;
    if p->>'type'='cites' and f->>'type'='source_doc' and f->'attributes'->>'document_role' is distinct from 'brief' then continue; end if;
    if p->>'type'='proposes' and f->'attributes'->>'fr_document_type' is distinct from 'PRORULE' then continue; end if;
    if p->>'type'='finalizes' and f->'attributes'->>'fr_document_type' is distinct from 'RULE' then continue; end if;
    insert into legal_atlas.edges(edge_key,type,from_key,to_key,source_key,from_type,to_type,extraction_method,confidence,review_status,treatment,role,source_url,source_date,evidence)
      values(item->>'edge_key',(p->>'type')::legal_atlas.edge_type,legal_atlas.ref_key(p->'from'),legal_atlas.ref_key(p->'to'),legal_atlas.ref_key(p->'source_record'),
      (f->>'type')::legal_atlas.entity_type,(t->>'type')::legal_atlas.entity_type,(p->>'extraction_method')::legal_atlas.edge_method,(p->>'confidence')::numeric,'pending',
      (p->>'treatment')::legal_atlas.treatment,(p->>'role')::legal_atlas.counsel_role,p->>'source_url',(p->>'date')::date,p->'evidence') on conflict(edge_key) do nothing;
    resolved:=resolved+1;
  end loop;
  return jsonb_build_object('run_id',p_run,'received',received,'resolved',resolved,'invalid',invalid,'review_status','pending','complete',false);
end;
$$;
revoke all on function public.corpus_legal_edges_v3(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_legal_edges_v3(uuid,jsonb) to service_role;
