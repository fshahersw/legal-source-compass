-- Additive, service_role-only intake dispatchers for the Seeger Weiss matter registry (contract sw-matter-registry/1).
-- Authored by the mdl-members agent, 2026-10-03. No arbitrary SQL, no public projection, no deletes.
-- PostgREST exposes only `public`, so the private corpus_ingest writers are reached through these fixed wrappers.
--
-- Modes (each pinned to the open run's scope->>'source_system'):
--   courtlistener-rest  -> source_system 'courtlistener'     (dockets, docket-entries, parties, attorneys, recap-documents, originating-court-information)
--   docketbird-capture  -> source_system 'docketbird-mcp'    (litigation_relationship_observation, member_case_header, member_docket_sheet_observation, ...)
--   sw-registry         -> source_system 'sw-matter-registry' (matter, docket, matter-docket, membership-evidence, transfer-link, entry-capture, party-capture, external-entry [v1.3: docket entries of blocked dockets from DocketBird / GovInfo / official court pages])
--   jpml-site           -> source_system 'jpml-site'         (source-document, schedule-a-row)
-- Registry namespaces must carry record_sha256 = corpus_ingest.canonical_integer_jsonb_sha256_v1(data).

create or replace function public.corpus_registry_intake_v1(p_run uuid, p_mode text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $registry_intake_v1$
declare
  ns text; expected_schema text; allowed text[];
begin
  ns := case p_mode when 'courtlistener-rest' then 'courtlistener' when 'docketbird-capture' then 'docketbird-mcp'
                    when 'sw-registry' then 'sw-matter-registry' when 'jpml-site' then 'jpml-site' end;
  expected_schema := case p_mode when 'courtlistener-rest' then 'courtlistener-rest-v4.7/1' when 'docketbird-capture' then 'docketbird-mcp-capture/1'
                    when 'sw-registry' then 'sw-matter-registry/1' when 'jpml-site' then 'jpml-site-document/1' end;
  allowed := case p_mode
    when 'courtlistener-rest' then array['dockets','docket-entries','parties','attorneys','recap-documents','originating-court-information']
    when 'docketbird-capture' then array['litigation_relationship_observation','member_case_header','member_docket_sheet_observation','member_case_search_observation']
    when 'sw-registry' then array['matter','docket','matter-docket','membership-evidence','transfer-link','entry-capture','party-capture','external-entry']
    when 'jpml-site' then array['source-document','schedule-a-row'] end;
  if ns is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 10000
     or octet_length(p_rows::text) > 4194304 then
    raise exception 'Invalid bounded registry intake' using errcode = '22023';
  end if;
  if not exists (select 1 from corpus_ingest.runs r where r.id = p_run and r.status in ('running','partial') and r.scope->>'source_system' = ns) then
    raise exception 'Registry namespace does not match its open run' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where
      x->>'source_system' is distinct from ns or x->>'schema_version' is distinct from expected_schema
      or not (x->>'entity_type' = any(allowed)) or jsonb_typeof(x->'data') is distinct from 'object'
      or length(coalesce(x->>'native_id','')) not between 1 and 512
      or coalesce(x->'provenance'->>'record_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(x->'provenance'->>'source_url','') !~ '^https?://'
      or coalesce(x->'provenance'->>'retrieved_at','') = '') then
    raise exception 'Invalid registry namespace, entity type, schema, identity or provenance' using errcode = '22023';
  end if;
  if p_mode = 'courtlistener-rest' and exists (select 1 from jsonb_array_elements(p_rows) x where
      x->>'native_id' is distinct from (x->'data'->>'id')
      or (x->'provenance'->>'source_url') !~ '^https://www\.courtlistener\.com/api/rest/v4/'
      or coalesce(x->'provenance'->>'http_status','') <> '200') then
    raise exception 'CourtListener REST rows need the native id, a v4 API source URL and HTTP 200' using errcode = '22023';
  end if;
  if p_mode in ('sw-registry','jpml-site') and exists (select 1 from jsonb_array_elements(p_rows) x where
      corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256') then
    raise exception 'Registry payload checksum mismatch' using errcode = '22023';
  end if;
  return corpus_ingest.ingest_entities(p_run, p_rows);
end;
$registry_intake_v1$;
revoke all on function public.corpus_registry_intake_v1(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_registry_intake_v1(uuid, text, jsonb) to service_role;
comment on function public.corpus_registry_intake_v1(uuid, text, jsonb) is
  'Server-role-only fixed intake dispatcher for the sw-matter-registry contract. Source namespace is pinned to the open run; no arbitrary SQL and no public projection.';

-- Registry relationships: edges between registry entities only (inferred is always false).
create or replace function public.corpus_registry_relationships_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $registry_rel_v1$
declare written bigint; unresolved bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20000 then
    raise exception 'Invalid bounded registry relationship batch' using errcode = '22023';
  end if;
  if not exists (select 1 from corpus_ingest.runs r where r.id = p_run and r.status in ('running','partial') and r.scope->>'source_system' = 'sw-matter-registry') then
    raise exception 'Registry relationship run is not open' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where
      coalesce(x->>'from_type','') = '' or coalesce(x->>'from_id','') = '' or coalesce(x->>'field','') = ''
      or coalesce(x->>'to_type','') = '' or coalesce(x->>'to_id','') = '' or coalesce(x->>'evidence_sha256','') !~ '^[0-9a-f]{64}$') then
    raise exception 'Invalid registry relationship row' using errcode = '22023';
  end if;
  with ins as (
    insert into corpus_ingest.relationships(source_system, from_type, from_id, field, to_type, to_id, evidence_sha256, inferred, target_present, run_id)
    select distinct 'sw-matter-registry', x->>'from_type', x->>'from_id', x->>'field', x->>'to_type', x->>'to_id', x->>'evidence_sha256', false,
      exists (select 1 from corpus_ingest.entities t where t.source_system = 'sw-matter-registry' and t.entity_type = x->>'to_type' and t.native_id = x->>'to_id' and t.review_status <> 'quarantined'),
      p_run
    from jsonb_array_elements(p_rows) x
    on conflict (source_system, from_type, from_id, field, to_type, to_id, evidence_sha256) do update set target_present = excluded.target_present
    returning target_present)
  select count(*), count(*) filter (where not target_present) into written, unresolved from ins;
  return jsonb_build_object('received', jsonb_array_length(p_rows), 'written', written, 'unresolved_targets', unresolved);
end;
$registry_rel_v1$;
revoke all on function public.corpus_registry_relationships_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_registry_relationships_v1(uuid, jsonb) to service_role;
comment on function public.corpus_registry_relationships_v1(uuid, jsonb) is
  'Server-role-only registry edge writer. Edges reference an existing entity version of the from entity; never inferred.';
