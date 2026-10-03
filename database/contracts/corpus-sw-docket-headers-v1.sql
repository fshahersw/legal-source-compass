-- public.corpus_sw_docket_headers_v1 — read-only access (service_role only) to CourtListener docket headers already stored in the lake (corpus_ingest.entities,
-- entity_type 'dockets': the REST observations and the 2026-09-30 bulk snapshot). Used by the matter-registry bundle builder to
--   (a) attach the court-record caption of a member docket whose CourtListener id is already known, and
--   (b) resolve a member docket to a CourtListener docket by EXACT court + docket key (no similarity, no REST quota).
--   p_mode 'by-id'  : p_ids are CourtListener docket ids
--   p_mode 'by-key' : p_ids are registry docket keys "<court>:<office>:<yyyy>-<type>-<seq5>"; a CourtListener docket matches when its court_id equals the key's court and
--                     its docket_number parses (^office:yy|yyyy-type-seq(-judge initials)*$) to the same office, year, type and sequence. Several matches are returned as
--                     several rows (the caller treats them as ambiguous).
-- Returns [{docket_key?, cl_id, retrieved_at, payload_sha256, header:{court_id, docket_number, case_name, date_filed, date_terminated, pacer_case_id, blocked}}]. Quarantined entities are skipped.
create or replace function public.corpus_sw_docket_headers_v1(p_mode text, p_ids text[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
 set statement_timeout to '180s'
as $function$
declare
  out jsonb;
begin
  if p_mode = 'by-id' then
    select coalesce(jsonb_agg(jsonb_build_object('cl_id', e.native_id, 'retrieved_at', e.retrieved_at, 'payload_sha256', e.payload_sha256,
             'header', jsonb_build_object('court_id', e.data->'court_id', 'docket_number', e.data->'docket_number', 'case_name', e.data->'case_name', 'date_filed', e.data->'date_filed',
                                          'date_terminated', e.data->'date_terminated', 'pacer_case_id', e.data->'pacer_case_id', 'blocked', coalesce(e.data->'blocked', 'false'::jsonb))) order by e.native_id::bigint), '[]'::jsonb)
      into out
    from corpus_ingest.entities e
    where e.source_system = 'courtlistener' and e.entity_type = 'dockets' and e.review_status <> 'quarantined' and e.native_id = any (p_ids);
  elsif p_mode = 'by-key' then
    with cl as (
      select e.native_id, e.retrieved_at, e.payload_sha256, e.data,
             regexp_match(e.data->>'docket_number', '^([0-9]{1,2}):([0-9]{2}|[0-9]{4})-?([A-Za-z]{2,4})-?([0-9]{1,6})(?:-[A-Za-z]{2,5})*$') as m
      from corpus_ingest.entities e
      where e.source_system = 'courtlistener' and e.entity_type = 'dockets' and e.review_status <> 'quarantined' and e.data->>'docket_number' is not null
    ), keyed as (
      select cl.*, (cl.data->>'court_id') || ':' || (cl.m[1]::int) || ':'
             || (case when length(cl.m[2]) = 2 then (case when cl.m[2]::int < 70 then 2000 + cl.m[2]::int else 1900 + cl.m[2]::int end) else cl.m[2]::int end)
             || '-' || lower(cl.m[3]) || '-' || lpad(cl.m[4], 5, '0') as docket_key
      from cl where cl.m is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object('docket_key', k.docket_key, 'cl_id', k.native_id, 'retrieved_at', k.retrieved_at, 'payload_sha256', k.payload_sha256,
             'header', jsonb_build_object('court_id', k.data->'court_id', 'docket_number', k.data->'docket_number', 'case_name', k.data->'case_name', 'date_filed', k.data->'date_filed',
                                          'date_terminated', k.data->'date_terminated', 'pacer_case_id', k.data->'pacer_case_id', 'blocked', coalesce(k.data->'blocked', 'false'::jsonb))) order by k.docket_key, k.native_id::bigint), '[]'::jsonb)
      into out
    from keyed k where k.docket_key = any (p_ids);
  else
    raise exception 'corpus_sw_docket_headers_v1: unsupported mode %', p_mode using errcode = '22023';
  end if;
  return out;
end;
$function$;

revoke all on function public.corpus_sw_docket_headers_v1(text, text[]) from public, anon, authenticated;
grant execute on function public.corpus_sw_docket_headers_v1(text, text[]) to service_role;
