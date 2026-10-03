-- The same immutable private intake contract, evaluated in bounded SQL batches.
-- Validation still runs server-side and on the records table constraint.
create or replace function public.corpus_legal_stage_v3(p_run uuid,p_manifest jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prepared jsonb; accepted integer; rejected integer;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'schema_version' is distinct from 'legal-atlas/3.1' then raise exception 'Schema manifest required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then raise exception 'Bounded rows required'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r->'candidates') is distinct from 'array' or jsonb_typeof(r->'errors') is distinct from 'array' or jsonb_typeof(r->'raw') is distinct from 'object') then raise exception 'Malformed staging row'; end if;
  if (select count(distinct r->>'input_key') from jsonb_array_elements(p_rows) r)<>jsonb_array_length(p_rows) then raise exception 'Unique staging keys required in each batch'; end if;
  insert into legal_atlas.ingest_runs(run_id,schema_version,source_manifest,status)
    values(p_run,'legal-atlas/3.1',p_manifest,'partial') on conflict(run_id) do nothing;
  if exists(select 1 from legal_atlas.ingest_runs where run_id=p_run and source_manifest<>p_manifest) then raise exception 'Immutable run manifest conflict'; end if;
  select coalesce(jsonb_agg(r||jsonb_build_object('all_errors',(r->'errors')||coalesce((
    select jsonb_agg(e) from jsonb_array_elements(r->'candidates') c cross join lateral unnest(legal_atlas.record_errors(c)) e
  ),'[]'::jsonb))),'[]'::jsonb) into prepared from jsonb_array_elements(p_rows) r;
  insert into legal_atlas.staging(input_key,run_id,source_name,source_year,source_record,candidate_records,schema_errors)
    select r->>'input_key',p_run,r->>'source_name',(r->>'source_year')::integer,r->'raw',r->'candidates',r->'all_errors' from jsonb_array_elements(prepared) r
    on conflict(input_key) do nothing;
  -- Check after ON CONFLICT waits as well, so concurrent batches cannot hide a
  -- different immutable payload that committed while this batch was waiting.
  if exists(select 1 from jsonb_array_elements(prepared) r join legal_atlas.staging s on s.input_key=r->>'input_key'
    where s.source_record<>r->'raw' or s.candidate_records<>r->'candidates' or s.schema_errors<>r->'all_errors') then raise exception 'Immutable staging version conflict'; end if;
  if exists(select legal_atlas.ref_key(c) from jsonb_array_elements(prepared) r cross join lateral jsonb_array_elements(r->'candidates') c
    where jsonb_array_length(r->'all_errors')=0 group by legal_atlas.ref_key(c) having count(distinct c)>1) then raise exception 'Conflicting canonical versions within batch'; end if;
  insert into legal_atlas.records(record_key,input_key,type,id,version,payload)
    select distinct on (legal_atlas.ref_key(c)) legal_atlas.ref_key(c),r->>'input_key',(c->>'type')::legal_atlas.entity_type,c->>'id',c->>'version',c
    from jsonb_array_elements(prepared) r cross join lateral jsonb_array_elements(r->'candidates') c where jsonb_array_length(r->'all_errors')=0
    order by legal_atlas.ref_key(c),r->>'input_key' on conflict(record_key) do nothing;
  if exists(select 1 from jsonb_array_elements(prepared) r cross join lateral jsonb_array_elements(r->'candidates') c
    join legal_atlas.records old on old.record_key=legal_atlas.ref_key(c)
    where jsonb_array_length(r->'all_errors')=0 and old.payload<>c) then raise exception 'Conflicting canonical version'; end if;
  select coalesce(sum(jsonb_array_length(r->'candidates')) filter(where jsonb_array_length(r->'all_errors')=0),0),
    coalesce(sum(jsonb_array_length(r->'candidates')) filter(where jsonb_array_length(r->'all_errors')>0),0)
    into accepted,rejected from jsonb_array_elements(prepared) r;
  return jsonb_build_object('run_id',p_run,'received',jsonb_array_length(p_rows),'accepted_candidates',accepted,'rejected_candidates',rejected,'review_status','pending','complete',false);
end;
$$;
