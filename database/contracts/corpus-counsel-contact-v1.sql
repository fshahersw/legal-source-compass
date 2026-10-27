-- public.corpus_counsel_contact_v1 — read-only, paged access (service_role only) to the counsel contact block as filed on the court record
-- (CourtListener RECAP attorneys staged in corpus_ingest.entities: contact_raw, email, phone, fax).
--
-- GATE: the owner decision of 2026-10-03 ("counsel without contact fields", AGENTS.md) is an explicit owner policy hold, and the 2026-10-27
-- decision ("dont withhold any data") keeps explicit owner/admin policy holds. Apply this file ONLY after the owner confirms in writing that
-- the 2026-10-27 decision supersedes the 2026-10-03 counsel rule, and record that decision in AGENTS.md in the same change.
--
-- What it returns, per attorney: native_attorney_id, name, contact_raw (the attorney block exactly as CourtListener holds it, outer whitespace
-- trimmed), email, phone, fax (empty strings become null), as_of (CourtListener date_modified), retrieved_at, payload_sha256, source_api_url
-- (CourtListener resource_uri as recorded) and docket_ids (the dockets the attorney appears on in parties_represented). Nothing is inferred or
-- normalised; a field the source does not carry is null ("Not recorded" in the UI).
--
-- Held on explicit source evidence only (contact fields are null and contact_hold says why; name and id still returned):
--   'sealed_group_role'  : any parties_represented role 3 (CourtListener people_db Role "Attorney in sealed group")
--   'blocked_docket'     : any represented docket whose staged CourtListener docket record has blocked=true (provider-reported restriction;
--                          CourtListener keeps one attorney block per attorney, so the block may come from that docket)
-- Quarantined entities are skipped.
--
-- p_ids     : native attorney ids to read (null = all, paged); p_after: cursor (native id, numeric); p_limit: 1..1000 (default 500).
-- Returns {rows:[...], next}; next is null when the page was not full.
create or replace function public.corpus_counsel_contact_v1(p_ids text[] default null, p_after text default null, p_limit integer default 500)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  after_id bigint := coalesce(nullif(p_after, '')::bigint, 0);
  out jsonb;
  n integer;
  last_id text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'native_attorney_id', y.native_id,
           'name', y.data->>'name',
           'contact_raw', case when y.hold is null then nullif(btrim(y.data->>'contact_raw'), '') end,
           'email', case when y.hold is null then nullif(btrim(y.data->>'email'), '') end,
           'phone', case when y.hold is null then nullif(btrim(y.data->>'phone'), '') end,
           'fax', case when y.hold is null then nullif(btrim(y.data->>'fax'), '') end,
           'contact_hold', y.hold,
           'as_of', y.data->>'date_modified',
           'retrieved_at', y.retrieved_at,
           'payload_sha256', y.payload_sha256,
           'source_system', 'courtlistener',
           'source_api_url', y.data->>'resource_uri',
           'docket_ids', y.docket_ids) order by y.nid), '[]'::jsonb), count(*), max(y.nid)::text
    into out, n, last_id
  from (
    select x.native_id, x.nid, x.data, x.retrieved_at, x.payload_sha256, d.docket_ids,
           case when d.sealed_role then 'sealed_group_role'
                when d.blocked then 'blocked_docket' end as hold
    from (select e.native_id, e.native_id::bigint as nid, e.data, e.retrieved_at, e.payload_sha256
          from corpus_ingest.entities e
          where e.source_system = 'courtlistener' and e.entity_type = 'attorneys' and e.review_status <> 'quarantined'
            and (p_ids is null or e.native_id = any (p_ids))
            and e.native_id ~ '^[0-9]+$' and e.native_id::bigint > after_id
          order by e.native_id::bigint limit lim) x
    cross join lateral (
      select coalesce(jsonb_agg(distinct r.did) filter (where r.did is not null), '[]'::jsonb) as docket_ids,
             coalesce(bool_or(r.role = '3'), false) as sealed_role,
             coalesce(bool_or(exists (select 1 from corpus_ingest.entities b
                                      where b.source_system = 'courtlistener' and b.entity_type = 'dockets' and b.native_id = r.did
                                        and b.data->>'blocked' = 'true')), false) as blocked
      from (select substring(p->>'docket' from '/dockets/([0-9]+)/') as did, p->>'role' as role
            from jsonb_array_elements(case when jsonb_typeof(x.data->'parties_represented') = 'array' then x.data->'parties_represented' else '[]'::jsonb end) p) r
    ) d
  ) y;
  return jsonb_build_object('rows', out, 'next', case when n >= lim then last_id else null end);
end;
$function$;

revoke all on function public.corpus_counsel_contact_v1(text[], text, integer) from public, anon, authenticated;
grant execute on function public.corpus_counsel_contact_v1(text[], text, integer) to service_role;
