-- PREPARE ONLY. Not applied by the gap-fill tooling; the release owner applies it with an administrative SQL session.
-- Additive, service_role-only intake for the DocketBird REST namespace used by scripts/ingest/gap-fill.
-- No arbitrary SQL, no public projection, no deletes. Writes only via corpus_ingest.ingest_entities (versioned, native-ID keyed).
--
-- Open one run per source before intake (PostgREST cannot insert into corpus_ingest.runs):
--   insert into corpus_ingest.runs(id,status,scope) values
--     ('<uuid-1>','running','{"source_system":"docketbird-rest","purpose":"gap-fill","contract":"corpus-gapfill-docketbird-rest/1"}'),
--     ('<uuid-2>','running','{"source_system":"courtlistener","purpose":"gap-fill","contract":"courtlistener-rest-v4.7/1"}');
-- CourtListener rows go through the existing public.corpus_registry_intake_v1(p_run,'courtlistener-rest',p_rows).

create or replace function public.corpus_admin_gapfill_docketbird_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $gapfill_db_v1$
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 or octet_length(p_rows::text)>4194304 then
    raise exception 'Invalid bounded DocketBird REST intake' using errcode='22023';
  end if;
  if not exists(select 1 from corpus_ingest.runs r where r.id=p_run and r.status in ('running','partial') and r.scope->>'source_system'='docketbird-rest') then
    raise exception 'DocketBird REST namespace does not match its open run' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
      x->>'source_system' is distinct from 'docketbird-rest' or x->>'schema_version' is distinct from 'docketbird-rest/1'
      or x->>'entity_type' not in ('case','docket-document') or jsonb_typeof(x->'data') is distinct from 'object'
      or length(coalesce(x->>'native_id','')) not between 1 and 512 or x->>'native_id' is distinct from x->'data'->>'id'
      or (x->>'entity_type'='docket-document' and left(x->>'native_id',length(x->'data'->>'case_id')+1) is distinct from (x->'data'->>'case_id')||'-')
      or x->'provenance'->>'source_url' is distinct from 'https://api.docketbird.com/documents'
      or coalesce(x->'provenance'->>'source_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(x->'provenance'->>'retrieved_at','')=''
      or x->'provenance'->>'record_sha256_codec' is distinct from 'canonical-integer-jsonb/1'
      or corpus_ingest.canonical_integer_jsonb_sha256_v1(x->'data') is distinct from x->'provenance'->>'record_sha256'
      or x->'provenance'->'pdf_downloaded' is distinct from 'false'::jsonb
      or exists(select 1 from jsonb_path_query(x,'$.** ? (@.type() == "string")') v
         where v #>> '{}' ~* '^https?://[^[:space:]]*[?&](x-amz-[^=]+|awsaccesskeyid|signature|expires|token|api[_-]?key|user[_-]?id)=')) then
    raise exception 'DocketBird REST identity, provenance, checksum or signed-URL guard failed' using errcode='22023';
  end if;
  return corpus_ingest.ingest_entities(p_run,p_rows);
end;
$gapfill_db_v1$;
revoke all on function public.corpus_admin_gapfill_docketbird_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_gapfill_docketbird_v1(uuid,jsonb) to service_role;
comment on function public.corpus_admin_gapfill_docketbird_v1(uuid,jsonb) is
  'Server-role-only fixed intake for DocketBird REST case headers and docket-sheet rows. Signed storage URLs are rejected; no PDF bytes; no public projection.';
