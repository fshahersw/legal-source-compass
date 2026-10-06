-- PREPARE ONLY. Apply as one admin migration (suggested name: corpus_gapfill_bulk_match_v3). Tiny follow-up to v2 (owner decision 2026-10-06): the civil-series
-- type-variant rule may also record caption_basis = 'equal_after_et_al_and_punctuation_normalisation' (caption equal after whitespace/case normalisation,
-- stripping a trailing ", ET AL" / "ET AL." suffix on either side, and stripping punctuation). Truncation-prefix matching is NOT allowed. The function is
-- v2's corpus_admin_gapfill_bulk_v1 unchanged except for that one value in the caption_basis list.

begin;

create or replace function public.corpus_admin_gapfill_bulk_v1(p_run uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $gapfill_bulk_v3$
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
                and x->'data'->>'caption_basis' in ('registry_caption_blank','equal_after_whitespace_case_normalisation','equal_after_et_al_and_punctuation_normalisation')
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
$gapfill_bulk_v3$;

revoke all on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_admin_gapfill_bulk_v1(uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
