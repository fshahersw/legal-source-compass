-- public.corpus_sw_registry_read_v1 — paged, read-only access (service_role only) to the lake rows that the matter registry projects (contract
-- sw-matter-registry/1 v1.3). The projection scripts read the lake through this function so that what is published is exactly what is in
-- corpus_ingest (no dependence on local pass files).
--
--   p_kind 'docket-entries'   : CourtListener entries whose docket resource URL id is in p_docket_ids          (cursor p_after = native entry id, numeric)
--   p_kind 'parties'          : CourtListener parties with a party_types[].docket_id in p_docket_ids            (cursor p_after = native party id, numeric)
--   p_kind 'attorneys'        : CourtListener attorneys whose native id is in p_ids; only id, name and the first two non-empty lines of contact_raw
--                               (contact_lines) are returned: the caller derives the firm from line 1/2; phone, fax, email, the address block and the
--                               parties_represented array are never returned
--   p_kind 'external-entries' : registry `external-entry` entities (docket entries of dockets CourtListener blocks, from DocketBird / GovInfo / official
--                               court pages) whose data->>'matter' is in p_ids (e.g. 'mdl:2738'); cursor p_after = native id (text)
-- Quarantined entities are skipped. Returns {rows:[{native_id, payload_sha256, retrieved_at, data}], next}. next is null when the page was not full.
create or replace function public.corpus_sw_registry_read_v1(p_kind text, p_docket_ids text[] default null, p_ids text[] default null, p_after text default null, p_limit integer default 500)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  after_id bigint := case when p_kind in ('docket-entries', 'parties', 'attorneys') then coalesce(nullif(p_after, '')::bigint, 0) else 0 end;
  out jsonb;
  n integer;
  last_id text;
begin
  if p_kind = 'docket-entries' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data) order by x.nid), '[]'::jsonb), count(*), max(x.nid)::text
      into out, n, last_id
    from (select e.native_id, e.native_id::bigint as nid, e.payload_sha256, e.retrieved_at, e.data
          from corpus_ingest.entities e
          where e.source_system = 'courtlistener' and e.entity_type = 'docket-entries' and e.review_status <> 'quarantined'
            and e.native_id::bigint > after_id
            and substring(e.data->>'docket' from '/dockets/([0-9]+)/') = any (p_docket_ids)
          order by e.native_id::bigint limit lim) x;
  elsif p_kind = 'parties' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data) order by x.nid), '[]'::jsonb), count(*), max(x.nid)::text
      into out, n, last_id
    from (select e.native_id, e.native_id::bigint as nid, e.payload_sha256, e.retrieved_at, e.data
          from corpus_ingest.entities e
          where e.source_system = 'courtlistener' and e.entity_type = 'parties' and e.review_status <> 'quarantined'
            and e.native_id::bigint > after_id
            and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.data->'party_types') = 'array' then e.data->'party_types' else '[]'::jsonb end) pt
                        where pt->>'docket_id' = any (p_docket_ids))
          order by e.native_id::bigint limit lim) x;
  elsif p_kind = 'attorneys' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at,
             'data', jsonb_build_object('id', x.data->'id', 'name', x.data->'name',
               'contact_lines', coalesce((select to_jsonb(array_agg(left(btrim(q.l), 200) order by q.i)) from (select t.l, t.i from regexp_split_to_table(coalesce(x.data->>'contact_raw', ''), E'\\r?\\n') with ordinality t(l, i) where btrim(t.l) <> '' order by t.i limit 2) q), '[]'::jsonb))) order by x.nid), '[]'::jsonb), count(*), max(x.nid)::text
      into out, n, last_id
    from (select e.native_id, e.native_id::bigint as nid, e.payload_sha256, e.retrieved_at, e.data
          from corpus_ingest.entities e
          where e.source_system = 'courtlistener' and e.entity_type = 'attorneys' and e.review_status <> 'quarantined'
            and e.native_id = any (p_ids) and e.native_id::bigint > after_id
          order by e.native_id::bigint limit lim) x;
  elsif p_kind = 'external-entries' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data) order by x.native_id), '[]'::jsonb), count(*), max(x.native_id)
      into out, n, last_id
    from (select e.native_id, e.payload_sha256, e.retrieved_at, e.data
          from corpus_ingest.entities e
          where e.source_system = 'sw-matter-registry' and e.entity_type = 'external-entry' and e.review_status <> 'quarantined'
            and (p_ids is null or e.data->>'matter' = any (p_ids))
            and (p_after is null or p_after = '' or e.native_id > p_after)
          order by e.native_id limit lim) x;
  else
    raise exception 'corpus_sw_registry_read_v1: unsupported kind %', p_kind using errcode = '22023';
  end if;
  return jsonb_build_object('rows', out, 'next', case when n >= lim then last_id else null end);
end;
$function$;

revoke all on function public.corpus_sw_registry_read_v1(text, text[], text[], text, integer) from public, anon, authenticated;
grant execute on function public.corpus_sw_registry_read_v1(text, text[], text[], text, integer) to service_role;
