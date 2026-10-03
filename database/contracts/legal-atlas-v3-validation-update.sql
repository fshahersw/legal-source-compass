create type legal_atlas.data_source as enum ('courtlistener','cap','recap','federalregister','ecfr','uscode','congress','fjc');

create type legal_atlas.mdl_section as enum ('jpml','pinned','docket','related');

create type legal_atlas.document_role as enum ('brief','transfer_order','appointment_order','order','case_page','other');

create or replace function legal_atlas.record_errors(p jsonb) returns text[] language plpgsql immutable security invoker set search_path='' as $$
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
  if p->>'type'='court' and p->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9-]*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='mdl' and p->>'id' !~ '^MDL-[1-9][0-9]*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='agency' and p->>'id' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='fr_document' and p->>'id' !~ '^(C[0-9]+-)?([0-9]{2}|[0-9]{4}|[A-Z][0-9]{1,2})-[0-9]{1,6}$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='cfr_section' and p->>'id' !~ '^[0-9]+ CFR [0-9]+(\.[0-9]+)?[a-zA-Z]?(\([a-zA-Z0-9]+\))*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='usc_section' and p->>'id' !~ '^[0-9]+ USC [0-9]+[a-zA-Z]?([–-][0-9]+[a-zA-Z]?)?(\([a-zA-Z0-9]+\))*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='rule_proceeding' and p->>'id' !~ '^[0-9]{4}-[A-Z0-9]{4}$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='bill' and p->>'id' !~ '^[0-9]{1,3}-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-[1-9][0-9]*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='public_law' and p->>'id' !~ '^PL [0-9]{1,3}-[1-9][0-9]*$' then errors:=array_append(errors,'id:canonical_format'); end if;
  if p->>'type'='court' and p->>'id_authority' not in ('courtlistener') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='judge' and p->>'id_authority' not in ('courtlistener','fjc') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='case' and p->>'id_authority' not in ('courtlistener','cap') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='docket' and p->>'id_authority' not in ('courtlistener') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='docket_entry' and p->>'id_authority' not in ('courtlistener') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='opinion' and p->>'id_authority' not in ('courtlistener','cap') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='mdl' and p->>'id_authority' not in ('jpml') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='agency' and p->>'id_authority' not in ('federal_register') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='fr_document' and p->>'id_authority' not in ('federal_register') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='cfr_section' and p->>'id_authority' not in ('ecfr') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='usc_section' and p->>'id_authority' not in ('uscode') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='bill' and p->>'id_authority' not in ('congress') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type'='public_law' and p->>'id_authority' not in ('congress') then errors:=array_append(errors,'id_authority:publisher'); end if;
  if p->>'type' in ('opinion','case','docket','docket_entry','attorney','party','judge') and p->>'id_authority' in ('courtlistener','fjc','cap') and p->>'id' !~ '^[1-9][0-9]*$' then errors:=array_append(errors,'id:native_numeric'); end if;
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

create or replace function legal_atlas.evidence_valid(p jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
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

create or replace function legal_atlas.nightly_schema_report() returns jsonb language plpgsql security invoker set search_path='' as $$
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

create or replace view legal_atlas.visible_edges with (security_invoker=true) as
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

alter table legal_atlas.edges add constraint legal_evidence_span_valid check(legal_atlas.evidence_valid(evidence));

revoke all on function legal_atlas.evidence_valid(jsonb) from public,anon,authenticated;

grant execute on function legal_atlas.evidence_valid(jsonb) to service_role;
