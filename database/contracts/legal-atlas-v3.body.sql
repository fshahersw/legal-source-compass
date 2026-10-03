
create function legal_atlas.ref_key(p jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_array(p->>'id_authority',p->>'type',p->>'id',p->>'version');
$$;

-- Canonical identifier rules below are generated from the same definitions as
-- the application validator. Retained ingest errors also count in nightly reports.
create function legal_atlas.record_errors(p jsonb) returns text[] language plpgsql immutable security invoker set search_path='' as $$
declare errors text[] := '{}'; k text; v text; item jsonb; parsed_date date;
begin
  if jsonb_typeof(p) is distinct from 'object' then return array['record:not_object']; end if;
  foreach k in array array['id','type','id_authority','title','title_source','jurisdiction','court_id','date','date_type','source_url','source_name','licence','retrieved_at','version','confidence','extraction_method','identifiers','attributes'] loop
    if not p ? k then errors := array_append(errors,k||':missing'); end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p) key where key<>all(array['id','type','id_authority','title','title_source','jurisdiction','court_id','date','date_type','source_url','source_name','licence','retrieved_at','version','confidence','extraction_method','identifiers','attributes'])) then errors:=array_append(errors,'record:unknown_fields'); end if;
  foreach k in array array['id','title','source_url','source_name','licence','version'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k))=0 then errors := array_append(errors,k||':blank_or_nontext'); end if;
  end loop;
  begin perform (p->>'type')::legal_atlas.entity_type; exception when invalid_text_representation then errors := array_append(errors,'type:enum'); end;
  begin perform (p->>'id_authority')::legal_atlas.id_authority; exception when invalid_text_representation then errors := array_append(errors,'id_authority:enum'); end;
  begin perform (p->>'title_source')::legal_atlas.title_source; exception when invalid_text_representation then errors := array_append(errors,'title_source:enum'); end;
  begin perform (p->>'jurisdiction')::legal_atlas.jurisdiction; exception when invalid_text_representation then errors := array_append(errors,'jurisdiction:enum'); end;
  begin perform (p->>'date_type')::legal_atlas.date_type; exception when invalid_text_representation then errors := array_append(errors,'date_type:enum'); end;
  begin perform (p->>'extraction_method')::legal_atlas.extraction_method; exception when invalid_text_representation then errors := array_append(errors,'extraction_method:enum'); end;
  if p->>'type' is null or p->>'id_authority' is null or p->>'title_source' is null or p->>'jurisdiction' is null or p->>'date_type' is null or p->>'extraction_method' is null then errors := array_append(errors,'enum:null'); end if;
  begin
    parsed_date := (p->>'date')::date;
    if parsed_date is null or parsed_date::text is distinct from p->>'date' then errors := array_append(errors,'date:format'); end if;
  exception when others then errors := array_append(errors,'date:invalid'); end;
  begin
    if p->>'retrieved_at' is null or (p->>'retrieved_at') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then errors := array_append(errors,'retrieved_at:format');
    else perform (p->>'retrieved_at')::timestamptz; end if;
  exception when others then errors := array_append(errors,'retrieved_at:invalid'); end;
  if p->>'source_url' !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then errors := array_append(errors,'source_url:invalid'); end if;
  if btrim(p->>'licence') ~* '^(unknown|not recorded|n/a|unverified)$' then errors := array_append(errors,'licence:unverified'); end if;
  if p->'court_id' is distinct from 'null'::jsonb and (jsonb_typeof(p->'court_id') is distinct from 'string' or coalesce(p->>'court_id','') !~ '^[A-Za-z0-9][A-Za-z0-9-]*$') then errors := array_append(errors,'court_id:invalid'); end if;
  if jsonb_typeof(p->'confidence') is distinct from 'number' then errors := array_append(errors,'confidence:type');
  elsif (p->>'confidence')::numeric < 0 or (p->>'confidence')::numeric > 1 then errors := array_append(errors,'confidence:range'); end if;
  if jsonb_typeof(p->'identifiers') is distinct from 'object' or jsonb_typeof(p->'attributes') is distinct from 'object' then return array_append(errors,'metadata:type'); end if;
  for k,item in select key,value from jsonb_each(p->'identifiers') loop
    if jsonb_typeof(item)='array' then
      if jsonb_array_length(item)=0 or exists(select 1 from jsonb_array_elements(item) e where jsonb_typeof(e)<>'string' or length(btrim(e#>>'{}'))=0) then errors:=array_append(errors,'identifiers:invalid_array'); end if;
    elsif jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}'))=0 then errors:=array_append(errors,'identifiers:invalid_value'); end if;
  end loop;
  -- GENERATED_RECORD_ID_RULES
  if p->>'type'='court' and p->>'court_id' is distinct from p->>'id' then errors:=array_append(errors,'court:identity'); end if;
  if p->>'type'='judge' then
    k:=case when p->>'id_authority'='fjc' then 'fjc_nid' else 'courtlistener_person_id' end;
    if jsonb_typeof(p->'identifiers'->k) is distinct from 'string' or p->'identifiers'->>k is distinct from p->>'id' then errors:=array_append(errors,'judge:identity'); end if;
  end if;
  if p->>'type'='agency' and (not(p->'attributes' ? 'parent_agency') or jsonb_typeof(p->'attributes'->'parent_agency') not in ('null','string')) then errors:=array_append(errors,'agency:parent'); end if;
  if p->'attributes' ? 'order_class' then
    begin
      if p->'attributes'->>'order_class' is null then raise invalid_text_representation; end if;
      perform (p->'attributes'->>'order_class')::legal_atlas.order_class;
    exception when invalid_text_representation then errors:=array_append(errors,'order_class:enum'); end;
  end if;
  if p->'attributes' ? 'document_role' then
    begin
      if p->'attributes'->>'document_role' is null then raise invalid_text_representation; end if;
      perform (p->'attributes'->>'document_role')::legal_atlas.document_role;
    exception when invalid_text_representation then errors:=array_append(errors,'document_role:enum'); end;
  end if;
  if p->>'type'='image' then
    foreach k in array array['alt','object_key'] loop
      if jsonb_typeof(p->'attributes'->k) is distinct from 'string' or length(btrim(p->'attributes'->>k))=0 then errors:=array_append(errors,'image:'||k); end if;
    end loop;
    if jsonb_typeof(p->'attributes'->'origin_verified') is distinct from 'boolean' then errors:=array_append(errors,'image:origin_verified'); end if;
    begin
      if p->'attributes'->>'kind' is null or p->'attributes'->>'origin' is null or p->'attributes'->>'review_status' is null then raise invalid_text_representation; end if;
      perform (p->'attributes'->>'kind')::legal_atlas.image_kind;
      perform (p->'attributes'->>'origin')::legal_atlas.image_origin;
      perform (p->'attributes'->>'review_status')::legal_atlas.review_status;
    exception when invalid_text_representation then errors:=array_append(errors,'image:enum'); end;
  end if;
  if p->>'date_type'='retrieved' and p->>'date' is distinct from left(p->>'retrieved_at',10) then errors := array_append(errors,'retrieval_date:mismatch'); end if;
  if p->>'date_type'='retrieved' and p->>'type' in ('opinion','docket','case','docket_entry','fr_document','bill','public_law') then errors := array_append(errors,'date_type:source_event_required'); end if;
  if p->>'type'='cfr_section' and (p->'attributes'->>'version_date' is distinct from p->>'version' or coalesce(p->>'version','') !~ '^\d{4}-\d{2}-\d{2}$') then errors := array_append(errors,'cfr:version'); end if;
  if p->>'type'='cfr_section' then
    begin
      parsed_date:=(p->>'version')::date;
      if parsed_date::text is distinct from p->>'version' then errors:=array_append(errors,'cfr:invalid_date'); end if;
    exception when others then errors:=array_append(errors,'cfr:invalid_date'); end;
  end if;
  if p->>'type'='usc_section' and p->'attributes'->>'release_point' is distinct from p->>'version' then errors := array_append(errors,'usc:release_point'); end if;
  if p->>'type'='fr_document' then
    begin
      if p->'attributes'->>'fr_document_type' is null then errors := array_append(errors,'fr_document_type:missing'); else perform (p->'attributes'->>'fr_document_type')::legal_atlas.fr_document_type; end if;
    exception when others then errors := array_append(errors,'fr_document_type:enum'); end;
  end if;
  return errors;
end;
$$;

-- Character offsets are Unicode code points in retained source text.
create function legal_atlas.evidence_valid(p jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if p ? 'paragraph_id' then
    return (select count(*) from jsonb_object_keys(p))=1 and jsonb_typeof(p->'paragraph_id')='string' and length(btrim(p->>'paragraph_id'))>0;
  end if;
  if jsonb_typeof(p->'start') is distinct from 'number' or jsonb_typeof(p->'end') is distinct from 'number' then return false; end if;
  return (select count(*) from jsonb_object_keys(p))=2 and (p->>'start')::numeric>=0 and (p->>'end')::numeric>(p->>'start')::numeric
    and trunc((p->>'start')::numeric)=(p->>'start')::numeric and trunc((p->>'end')::numeric)=(p->>'end')::numeric;
end;
$$;

create table legal_atlas.ingest_runs (
  run_id uuid primary key, schema_version text not null check(schema_version='legal-atlas/3.1'),
  source_manifest jsonb not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status legal_atlas.load_status not null default 'running', original_source_checks integer not null default 0 check(original_source_checks>=0),
  check(status<>'verified' or (finished_at is not null and original_source_checks>=50))
);
create table legal_atlas.staging (
  input_key text primary key check(input_key~'^[a-f0-9]{64}$'), run_id uuid not null references legal_atlas.ingest_runs,
  source_name text not null, source_year integer check(source_year between 1000 and 2200),
  source_record jsonb not null, candidate_records jsonb not null check(jsonb_typeof(candidate_records)='array'),
  schema_errors jsonb not null check(jsonb_typeof(schema_errors)='array'), staged_at timestamptz not null default now()
);
create table legal_atlas.records (
  record_key jsonb primary key, input_key text not null references legal_atlas.staging(input_key),
  type legal_atlas.entity_type not null, id text not null, version text not null,
  payload jsonb not null, review_status legal_atlas.review_status not null default 'pending',
  check(record_key=legal_atlas.ref_key(payload)),
  check(type::text=payload->>'type' and id=payload->>'id' and version=payload->>'version'),
  check(cardinality(legal_atlas.record_errors(payload))=0)
);
create index legal_records_type_id on legal_atlas.records(type,id);
create table legal_atlas.edges (
  edge_key text primary key check(edge_key~'^[a-f0-9]{64}$'),
  type legal_atlas.edge_type not null,
  from_key jsonb not null references legal_atlas.records(record_key),
  to_key jsonb not null references legal_atlas.records(record_key),
  source_key jsonb not null references legal_atlas.records(record_key),
  from_type legal_atlas.entity_type not null, to_type legal_atlas.entity_type not null,
  extraction_method legal_atlas.edge_method not null, confidence numeric not null check(confidence between 0 and 1),
  review_status legal_atlas.review_status not null default 'pending',
  treatment legal_atlas.treatment, role legal_atlas.counsel_role,
  source_url text not null check(source_url~'^https?://'), source_date date not null,
  evidence jsonb not null check(legal_atlas.evidence_valid(evidence)),
  foreign key(type,from_type,to_type) references legal_atlas.edge_contract,
  check(from_key->>1=from_type::text and to_key->>1=to_type::text),
  check(from_key<>to_key), check(treatment is null or type='cites'), check(role is null or type='represents'),
  check((evidence ? 'paragraph_id' and jsonb_typeof(evidence->'paragraph_id')='string' and length(evidence->>'paragraph_id')>0)
    or (evidence ?& array['start','end'] and jsonb_typeof(evidence->'start')='number' and jsonb_typeof(evidence->'end')='number'
      and (evidence->>'start')::numeric>=0 and (evidence->>'end')::numeric>(evidence->>'start')::numeric))
);
create index legal_edges_from on legal_atlas.edges(from_key,type);
create index legal_edges_to on legal_atlas.edges(to_key,type);
create index legal_edges_source on legal_atlas.edges(source_key);
create table legal_atlas.source_coverage (
  source_name text not null, year integer not null check(year>=2000),
  source_rows bigint not null check(source_rows>=0), accepted_rows bigint not null check(accepted_rows>=0),
  rejected_rows bigint not null check(rejected_rows>=0), status legal_atlas.load_status not null,
  as_of timestamptz not null, original_source_checks integer not null default 0,
  primary key(source_name,year), check(accepted_rows+rejected_rows<=source_rows),
  check(status<>'verified' or original_source_checks>=50)
);
create table legal_atlas.quality_reports (
  reported_at timestamptz primary key default now(), schema_version text not null,
  population text not null, counts_by_type jsonb not null, coverage jsonb not null,
  regressions jsonb not null, passed boolean not null
);
create table legal_atlas.quality_baselines (
  name text primary key, approved_at timestamptz not null, reviewed_by text not null,
  schema_version text not null, population text not null, counts_by_type jsonb not null
);
create table legal_atlas.audit_samples (
  sample_key text primary key, population_sha256 text not null, seed text not null,
  entity_type legal_atlas.entity_type, source_name text, required integer not null,
  record_keys jsonb not null check(jsonb_typeof(record_keys)='array'), created_at timestamptz not null default now(),
  check((entity_type is null)<>(source_name is null))
);
create table legal_atlas.audit_reviews (
  sample_key text not null references legal_atlas.audit_samples, record_key jsonb not null,
  type_correct boolean not null, title_correct boolean not null, source_matches boolean not null,
  source_status integer not null, checked_at timestamptz not null, reviewer text not null,
  primary key(sample_key,record_key)
);

create view legal_atlas.review_queue with (security_invoker=true) as
  select edge_key,type,source_url,source_date,confidence,evidence from legal_atlas.edges
  where review_status='pending' or (extraction_method='llm' and confidence<0.8);
create view legal_atlas.visible_edges with (security_invoker=true) as
  select e.* from legal_atlas.edges e
  join legal_atlas.records f on f.record_key=e.from_key and f.review_status='approved'
  join legal_atlas.records t on t.record_key=e.to_key and t.review_status='approved'
  join legal_atlas.records s on s.record_key=e.source_key and s.review_status='approved'
  where e.review_status='approved' and not(e.extraction_method='llm' and e.confidence<0.8)
  and e.source_url=s.payload->>'source_url' and legal_atlas.evidence_valid(e.evidence)
  and (e.type<>'transferred_by' or (t.payload->>'court_id'='jpml' and t.payload->'attributes'->>'document_role'='transfer_order'))
  and (e.type<>'cites' or e.from_type<>'source_doc' or f.payload->'attributes'->>'document_role'='brief')
  and (e.type<>'proposes' or f.payload->'attributes'->>'fr_document_type'='PRORULE')
  and (e.type<>'finalizes' or f.payload->'attributes'->>'fr_document_type'='RULE')
  and ((e.evidence ? 'paragraph_id' and jsonb_typeof(s.payload->'attributes'->'paragraphs')='object' and s.payload->'attributes'->'paragraphs' ? (e.evidence->>'paragraph_id'))
    or (e.evidence ? 'end' and jsonb_typeof(s.payload->'attributes'->'text')='string' and (e.evidence->>'end')::numeric <= length(s.payload->'attributes'->>'text')));

create function legal_atlas.nightly_schema_report() returns jsonb language plpgsql security invoker set search_path='' as $$
declare counts jsonb; coverage jsonb; failures jsonb := '[]'; baseline legal_atlas.quality_baselines%rowtype; item record;
begin
  with candidates as (
    select c.row, jsonb_array_length(s.schema_errors)>0 as ingest_invalid, case when c.row->>'type'=any(enum_range(null::legal_atlas.entity_type)::text[]) then c.row->>'type' else 'unrecognized' end as kind
    from legal_atlas.staging s cross join lateral jsonb_array_elements(s.candidate_records) c(row)
  ), kinds as (select unnest(enum_range(null::legal_atlas.entity_type)::text[]) as kind union all select 'unrecognized'),
  totals as (select kind,count(*) as total,count(*) filter(where ingest_invalid or cardinality(legal_atlas.record_errors(row))>0) as invalid from candidates group by kind)
  select jsonb_object_agg(k.kind,jsonb_build_object('total',coalesce(t.total,0),'invalid',coalesce(t.invalid,0))) into counts from kinds k left join totals t using(kind);
  select coalesce(jsonb_agg(to_jsonb(c) order by c.source_name,c.year),'[]') into coverage from legal_atlas.source_coverage c;
  select * into baseline from legal_atlas.quality_baselines where name='deploy';
  if not found then failures:=jsonb_build_array('A reviewed deployment baseline has not been established');
  else
    if baseline.schema_version<>'legal-atlas/3.1' or baseline.population<>'legal-atlas-v3-all-staging' then failures:=failures||jsonb_build_array('Deployment baseline schema or population does not match'); end if;
    for item in select key,value from jsonb_each(counts) loop
      if baseline.counts_by_type->item.key is null or (item.value->>'invalid')::bigint>(baseline.counts_by_type->item.key->>'invalid')::bigint then failures:=failures||jsonb_build_array(item.key||': invalid count increased or baseline missing'); end if;
      if (item.value->>'total')::bigint<(baseline.counts_by_type->item.key->>'total')::bigint then failures:=failures||jsonb_build_array(item.key||': population decreased'); end if;
    end loop;
  end if;
  insert into legal_atlas.quality_reports(schema_version,population,counts_by_type,coverage,regressions,passed)
  values('legal-atlas/3.1','legal-atlas-v3-all-staging',counts,coverage,failures,jsonb_array_length(failures)=0);
  return jsonb_build_object('counts_by_type',counts,'regressions',failures,'passed',jsonb_array_length(failures)=0);
end;
$$;

-- Service-role-only read API. The website still enforces its existing access middleware.
create function public.corpus_legal_quality_v3() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('schema_version','legal-atlas/3.1',
    'report',(select to_jsonb(q) from legal_atlas.quality_reports q order by reported_at desc limit 1),
    'coverage',coalesce((select jsonb_agg(to_jsonb(c) order by source_name,year) from legal_atlas.source_coverage c),'[]'),
    'review_pending',(select count(*) from legal_atlas.records where review_status='pending'));
$$;
create function public.corpus_legal_node_v3(p_ref jsonb, p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
  with node as (select payload from legal_atlas.records where record_key=legal_atlas.ref_key(p_ref) and review_status='approved'),
  neighbors as (select * from legal_atlas.visible_edges where from_key=legal_atlas.ref_key(p_ref) or to_key=legal_atlas.ref_key(p_ref)),
  page as (select * from neighbors order by type,edge_key limit 100 offset greatest(0,least(p_offset,1000000))),
  refs as (select from_key as k from page union select to_key from page union select source_key from page)
  select jsonb_build_object('record',(select payload from node),
    'records',coalesce((select jsonb_agg(r.payload) from legal_atlas.records r join refs on refs.k=r.record_key),'[]'),
    'edges',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),
    'total',(select count(*) from neighbors),'page_size',100);
$$;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='legal_atlas' loop
    execute format('alter table legal_atlas.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema legal_atlas from public,anon,authenticated;
revoke all on all functions in schema legal_atlas from public,anon,authenticated;
revoke all on function public.corpus_legal_quality_v3() from public,anon,authenticated;
revoke all on function public.corpus_legal_node_v3(jsonb,integer) from public,anon,authenticated;
grant usage on schema legal_atlas to service_role;
grant select,insert,update on all tables in schema legal_atlas to service_role;
grant execute on all functions in schema legal_atlas to service_role;
grant execute on function public.corpus_legal_quality_v3() to service_role;
grant execute on function public.corpus_legal_node_v3(jsonb,integer) to service_role;
