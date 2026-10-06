-- PREPARE ONLY. Apply as one admin migration (suggested name: corpus_gapfill_bulk_match_v2). Supersedes corpus_admin_gapfill_bulk_v1 of v1 (additive: every v1 row shape stays valid).
-- Adds (1) schema courtlistener-bulk-match/2 for ANY dated CourtListener dockets archive (quarterly refreshes) and the owner-approved civil-series
-- type-variant rule (2026-10-06), and (2) run open/finish functions pinned to this contract so a scheduled workflow can open its own run
-- (same pattern as corpus_federal_register_open_run_v1). service_role only; no deletes; private metadata only.

begin;

create or replace function public.corpus_gapfill_bulk_open_run_v1(p_run uuid, p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $gf_open$
declare existing jsonb;
begin
  if p_run is null or jsonb_typeof(p_scope) is distinct from 'object'
    or p_scope->>'source_system' is distinct from 'courtlistener'
    or p_scope->>'contract' is distinct from 'courtlistener-bulk-match/2'
    or coalesce(p_scope->>'snapshot_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'archive_url','') !~ '^https://com-courtlistener-storage\.s3-us-west-2\.amazonaws\.com/bulk-data/dockets-\d{4}-\d{2}-\d{2}\.csv\.bz2$'
    or coalesce(p_scope->>'archive_sha256','') !~ '^[0-9a-f]{64}$'
    or p_scope->>'archive_url' not like ('%dockets-' || (p_scope->>'snapshot_date') || '.csv.bz2')
    or p_scope->'private_only' is distinct from 'true'::jsonb then
    raise exception 'Invalid bulk-match run scope' using errcode='22023';
  end if;
  select scope into existing from corpus_ingest.runs where id=p_run;
  if existing is not null and existing is distinct from p_scope then
    raise exception 'Run already exists with a different scope' using errcode='22023';
  end if;
  insert into corpus_ingest.runs(id,status,scope) values (p_run,'running',p_scope) on conflict(id) do nothing;
  return (select jsonb_build_object('run_id',r.id,'status',r.status,'scope',r.scope) from corpus_ingest.runs r where r.id=p_run);
end;
$gf_open$;

create or replace function public.corpus_gapfill_bulk_finish_run_v1(p_run uuid, p_status text, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $gf_finish$
begin
  if p_status not in ('partial','completed','failed') or jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Invalid run closure' using errcode='22023';
  end if;
  update corpus_ingest.runs set status=p_status,finished_at=now(),counts=p_counts
    where id=p_run and status in ('running','partial') and scope->>'contract'='courtlistener-bulk-match/2';
  if not found then raise exception 'Open bulk-match run required' using errcode='22023'; end if;
  return (select jsonb_build_object('run_id',r.id,'status',r.status,'counts',r.counts) from corpus_ingest.runs r where r.id=p_run);
end;
$gf_finish$;

create or replace function public.corpus_admin_gapfill_bulk_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $gapfill_bulk_v2$
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 or octet_length(p_rows::text)>4194304 then
    raise exception 'Invalid bounded bulk-match intake' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs r where r.id=p_run and r.status in ('running','partial') and r.scope->>'source_system'='courtlistener') then
    raise exception 'Bulk-match namespace does not match its open run' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
      x->>'source_system' is distinct from 'courtlistener'
      or jsonb_typeof(x->'data') is distinct from 'object'
      or length(coalesce(x->>'native_id','')) not between 1 and 64
      or coalesce(x->'provenance'->>'retrieved_at','')=''
      or x->'provenance'->>'record_sha256_codec' is distinct from 'canonical-integer-jsonb/1'
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256'
      or not (
        -- v1: the 2026-09-30 dockets archive, exact-key matches
        (x->>'entity_type'='docket-bulk-match' and x->>'schema_version'='courtlistener-bulk-match/1'
          and x->'provenance'->>'source_as_of'='2026-09-30'
          and x->>'native_id'=x->'data'->>'docket_id'
          and x->'provenance'->>'source_url'='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2'
          and x->'provenance'->>'source_sha256'='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
          and x->'data'->>'archive_sha256'='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
          and x->'data'->>'key_match_rule'='exact court id + exact docket key'
          and jsonb_typeof(x->'data'->'source_row_ordinal')='number')
        or
        -- v2: any dated dockets archive; exact-key rule or the approved civil-series type-variant rule (caption confirmed)
        (x->>'entity_type'='docket-bulk-match' and x->>'schema_version'='courtlistener-bulk-match/2'
          and x->>'native_id'=x->'data'->>'docket_id'
          and coalesce(x->'provenance'->>'source_url','') ~ '^https://com-courtlistener-storage\.s3-us-west-2\.amazonaws\.com/bulk-data/dockets-\d{4}-\d{2}-\d{2}\.csv\.bz2$'
          and x->'provenance'->>'source_url' like ('%dockets-' || (x->'provenance'->>'source_as_of') || '.csv.bz2')
          and x->'data'->>'snapshot_date'=x->'provenance'->>'source_as_of'
          and coalesce(x->'provenance'->>'source_sha256','') ~ '^[0-9a-f]{64}$'
          and x->'data'->>'archive_sha256'=x->'provenance'->>'source_sha256'
          and jsonb_typeof(x->'data'->'source_row_ordinal')='number'
          and (
            x->'data'->>'key_match_rule'='exact court id + exact docket key'
            or (x->'data'->>'key_match_rule'='court+office+year+sequence, civil-series type variant, caption-confirmed'
                and jsonb_typeof(x->'data'->'type_variant')='object'
                and x->'data'->'type_variant'->>'registry_type' in ('op','md','cv','mc')
                and x->'data'->'type_variant'->>'bulk_type' in ('op','md','cv','mc')
                and x->'data'->'type_variant'->>'registry_type' is distinct from x->'data'->'type_variant'->>'bulk_type'
                and x->'data'->>'caption_basis' in ('registry_caption_blank','equal_after_whitespace_case_normalisation')
                and x->'data'->'key_unique_in_bulk'='true'::jsonb)))
        or
        -- FJC IDB MDL-number evidence (unchanged from v1)
        (x->>'entity_type'='fjc-idb-mdl-match' and x->>'schema_version'='courtlistener-fjc-idb-match/1'
          and x->'provenance'->>'source_as_of'='2026-09-30'
          and x->>'native_id'=x->'data'->>'idb_data_id'
          and x->'provenance'->>'source_url'='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2'
          and x->'provenance'->>'source_sha256'='7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
          and x->'data'->>'archive_sha256'='7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
          and x->'data'->>'join_rule'='exact idb_data_id'
          and x->'data'->>'label'='historical administrative association; not a current MDL member census'))) then
    raise exception 'Bulk-match identity, source, checksum or rule guard failed' using errcode='22023';
  end if;
  return corpus_ingest.ingest_entities(p_run,p_rows);
end;
$gapfill_bulk_v2$;

revoke all on function public.corpus_gapfill_bulk_open_run_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_gapfill_bulk_finish_run_v1(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_gapfill_bulk_open_run_v1(uuid,jsonb) to service_role;
grant execute on function public.corpus_gapfill_bulk_finish_run_v1(uuid,text,jsonb) to service_role;
grant execute on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;

-- Provenance of lake docket-entries rows (the existing read function returns only payload hash and retrieval time). Needed to build source-qualified
-- RECAP PDF queues whose origins cite the stored response hash. Read-only, service_role only; no payload body, no party or contact data.
begin;
create or replace function public.corpus_gapfill_lake_entry_provenance_v1(p_native_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $gf_prov$
begin
  if auth.role() is distinct from 'service_role' or p_native_ids is null or cardinality(p_native_ids) not between 1 and 1000 then
    raise exception 'Bounded service-only request required' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('native_id',e.native_id,'payload_sha256',e.payload_sha256,'retrieved_at',e.retrieved_at,
      'source_url',e.provenance->>'source_url','source_sha256',e.provenance->>'source_sha256','http_status',e.provenance->>'http_status') order by e.native_id)
    from corpus_ingest.entities e
    where e.source_system='courtlistener' and e.entity_type='docket-entries' and e.review_status<>'quarantined' and e.native_id=any(p_native_ids)),'[]'::jsonb);
end;
$gf_prov$;
revoke all on function public.corpus_gapfill_lake_entry_provenance_v1(text[]) from public,anon,authenticated;
grant execute on function public.corpus_gapfill_lake_entry_provenance_v1(text[]) to service_role;
notify pgrst, 'reload schema';
commit;
