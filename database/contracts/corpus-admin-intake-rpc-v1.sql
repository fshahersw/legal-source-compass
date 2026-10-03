-- Administrative metadata intake only. The existing private wrappers remain the
-- authority for registered artifacts, source identities, provenance and versions.
-- This fixed dispatcher cannot execute SQL or expose retained source records.
create or replace function public.corpus_admin_intake_v1(p_run uuid,p_mode text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $admin_intake_v1$
declare source_namespace text;
begin
  source_namespace:=case p_mode when 'openfda' then 'openfda'
    when 'local-catalog' then 'local-sw-catalog'
    when 'local-statute' then 'local-vaquill-open-us-law'
    when 'local-registry' then 'local-source-registry' end;
  if source_namespace is null or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 10000
    or octet_length(p_rows::text)>2097152 then
    raise exception 'Invalid bounded administrative intake' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs r where r.id=p_run
    and r.status in ('running','partial') and r.scope->>'source_system'=source_namespace)
    or exists(select 1 from jsonb_array_elements(p_rows) x where x->>'source_system' is distinct from source_namespace) then
    raise exception 'Administrative source namespace does not match its open run' using errcode='22023';
  end if;
  if p_mode='openfda' then
    if exists(select 1 from jsonb_array_elements(p_rows) x where
      x->>'schema_version' is distinct from 'openfda-selected-native-metadata/1'
      or x->>'entity_type' not in ('device-classification','device-enforcement','drug-enforcement','device-recalls')
      or jsonb_typeof(x->'data') is distinct from 'object'
      or length(coalesce(x->>'native_id','')) not between 1 and 512
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256'
      or x->>'native_id' is distinct from case x->>'entity_type'
        when 'device-classification' then x->'data'->>'product_code'
        when 'device-recalls' then x->'data'->>'cfres_id'
        else x->'data'->>'recall_number' end) then
      raise exception 'Invalid selected FDA identity, schema or canonical payload' using errcode='22023';
    end if;
    return corpus_ingest.ingest_entities(p_run,p_rows);
  elsif p_mode='local-catalog' then
    return corpus_ingest.ingest_local_catalog_entities_v1(p_run,p_rows);
  elsif p_mode='local-statute' then
    return corpus_ingest.ingest_local_statute_entities_v1(p_run,p_rows);
  elsif p_mode='local-registry' then
    return corpus_ingest.ingest_local_registry_entities_v1(p_run,p_rows);
  end if;
  raise exception 'Unsupported administrative intake mode' using errcode='22023';
end;
$admin_intake_v1$;
revoke all on function public.corpus_admin_intake_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_intake_v1(uuid,text,jsonb) to service_role;
comment on function public.corpus_admin_intake_v1(uuid,text,jsonb) is
  'Server-role-only fixed metadata intake dispatcher. Source-qualified private wrappers enforce provenance and identity. No public projection or arbitrary SQL.';
