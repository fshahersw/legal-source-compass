-- PREPARE ONLY. Apply as one admin migration (suggested name: corpus_gapfill_bulk_match_v1).
-- Additive, service_role-only intake of private evidence rows derived from the sha256-verified CourtListener dockets bulk export.
-- Entities (source_system 'courtlistener'): 'docket-bulk-match' (native_id = CourtListener docket id) and
-- 'fjc-idb-mdl-match' (native_id = FJC IDB row id; exact idb_data_id join, labelled historical administrative).
-- It never touches the existing 'dockets' bulk entities (distinct entity_type), so earlier full-row bulk payloads are not displaced.
-- Pinned to the open CourtListener gap-fill run (scope.source_system = 'courtlistener'). No deletes, no public projection.

create or replace function public.corpus_admin_gapfill_bulk_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $gapfill_bulk_v1$
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
      or x->'provenance'->>'source_as_of' is distinct from '2026-09-30'
      or not (
        (x->>'entity_type'='docket-bulk-match' and x->>'schema_version'='courtlistener-bulk-match/1'
          and x->>'native_id'=x->'data'->>'docket_id'
          and x->'provenance'->>'source_url'='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-2026-09-30.csv.bz2'
          and x->'provenance'->>'source_sha256'='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
          and x->'data'->>'archive_sha256'='f40588851cee0d95696c40b8740106473f83ea3ffd8745799e03c42a15b9399b'
          and x->'data'->>'key_match_rule'='exact court id + exact docket key'
          and jsonb_typeof(x->'data'->'source_row_ordinal')='number')
        or
        (x->>'entity_type'='fjc-idb-mdl-match' and x->>'schema_version'='courtlistener-fjc-idb-match/1'
          and x->>'native_id'=x->'data'->>'idb_data_id'
          and x->'provenance'->>'source_url'='https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2'
          and x->'provenance'->>'source_sha256'='7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
          and x->'data'->>'archive_sha256'='7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957'
          and x->'data'->>'join_rule'='exact idb_data_id'
          and x->'data'->>'label'='historical administrative association; not a current MDL member census'))) then
    raise exception 'Bulk-match identity, source, checksum or codec guard failed' using errcode='22023';
  end if;
  return corpus_ingest.ingest_entities(p_run,p_rows);
end;
$gapfill_bulk_v1$;
revoke all on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) to service_role;
comment on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) is
  'Server-role-only fixed intake of exact-key evidence rows from the sha256-verified 2026-09-30 CourtListener dockets bulk export. Private metadata only.';
