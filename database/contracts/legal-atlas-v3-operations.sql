-- Administrative ingestion only. No source is approved or released by this API.
create or replace function public.corpus_legal_stage_v3(p_run uuid,p_manifest jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; candidate jsonb; issues jsonb; accepted integer:=0; rejected integer:=0;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'schema_version' is distinct from 'legal-atlas/3.1' then raise exception 'Schema manifest required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then raise exception 'Bounded rows required'; end if;
  insert into legal_atlas.ingest_runs(run_id,schema_version,source_manifest,status)
    values(p_run,'legal-atlas/3.1',p_manifest,'partial') on conflict(run_id) do nothing;
  if exists(select 1 from legal_atlas.ingest_runs where run_id=p_run and source_manifest<>p_manifest) then raise exception 'Immutable run manifest conflict'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r->'candidates') is distinct from 'array' or jsonb_typeof(r->'errors') is distinct from 'array' or jsonb_typeof(r->'raw') is distinct from 'object' then raise exception 'Malformed staging row'; end if;
    issues:=r->'errors';
    for candidate in select value from jsonb_array_elements(r->'candidates') loop
      issues:=issues||to_jsonb(legal_atlas.record_errors(candidate));
    end loop;
    if exists(select 1 from legal_atlas.staging where input_key=r->>'input_key' and (source_record<>r->'raw' or candidate_records<>r->'candidates' or schema_errors<>issues)) then raise exception 'Immutable staging version conflict'; end if;
    insert into legal_atlas.staging(input_key,run_id,source_name,source_year,source_record,candidate_records,schema_errors)
      values(r->>'input_key',p_run,r->>'source_name',(r->>'source_year')::integer,r->'raw',r->'candidates',issues) on conflict(input_key) do nothing;
    if jsonb_array_length(issues)=0 then
      for candidate in select value from jsonb_array_elements(r->'candidates') loop
        if exists(select 1 from legal_atlas.records where record_key=legal_atlas.ref_key(candidate) and payload<>candidate) then raise exception 'Conflicting canonical version'; end if;
        insert into legal_atlas.records(record_key,input_key,type,id,version,payload)
          values(legal_atlas.ref_key(candidate),r->>'input_key',(candidate->>'type')::legal_atlas.entity_type,candidate->>'id',candidate->>'version',candidate) on conflict(record_key) do nothing;
        accepted:=accepted+1;
      end loop;
    else rejected:=rejected+jsonb_array_length(r->'candidates'); end if;
  end loop;
  return jsonb_build_object('run_id',p_run,'received',jsonb_array_length(p_rows),'accepted_candidates',accepted,'rejected_candidates',rejected,'review_status','pending','complete',false);
end;
$$;
revoke all on function public.corpus_legal_stage_v3(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_legal_stage_v3(uuid,jsonb,jsonb) to service_role;

create or replace function public.corpus_legal_deploy_check_v3()
returns jsonb language sql volatile security invoker set search_path='' as $$
  select legal_atlas.nightly_schema_report();
$$;
revoke all on function public.corpus_legal_deploy_check_v3() from public,anon,authenticated;
grant execute on function public.corpus_legal_deploy_check_v3() to service_role;

-- Run in UTC, with no external credentials stored in the scheduled command.
create extension if not exists pg_cron;
select cron.schedule('legal-atlas-v3-nightly-schema','0 8 * * *','select legal_atlas.nightly_schema_report();');
