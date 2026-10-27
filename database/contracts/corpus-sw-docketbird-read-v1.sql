-- public.corpus_sw_docketbird_read_v1 — paged, read-only access (service_role only) to the DocketBird lake rows that
-- sw_docket_documents_v1 projects (scripts/ingest/gap-fill/project-docketbird-documents.mjs --lake=true / --mcp=true).
-- Additive: a new function; corpus_sw_registry_read_v1 is not changed. Release docket-metadata-sw-builders, owner decision 2026-10-27
-- ("dont withhold any data. If its accurate and valuable, USE IT").
--
--   p_kind 'rest-cases'      : docketbird-rest `case` rows (optionally only p_case_ids)
--   p_kind 'rest-documents'  : docketbird-rest `docket-document` rows (optionally only data->>'case_id' in p_case_ids)
--   p_kind 'mcp-documents'   : docketbird-mcp `document_metadata` rows (optionally only data->>'native_case_id' in p_case_ids), each with
--                              the lake CourtListener docket named by data->'source_qualified_courtlistener_docket_ids' when exactly one id
--                              is named and that docket is in the lake (id, court_id, docket_number, case_name only). The caller links it
--                              only when its court and docket number give the same docket key as the DocketBird case id (exact match).
-- Only the provenance fields the projector records are returned (record/source hashes, retrieval time and, for mcp rows, the capture
-- file and document hashes used to verify the title from the private capture). No locator, signed URL or account identifier is returned
-- (the lake does not hold the personalized DocketBird locators; their values were withheld at intake).
-- Quarantined entities are skipped. Cursor p_after = native id (text). Returns {rows:[{native_id, payload_sha256, retrieved_at, data,
-- provenance[, cl_docket]}], next}; next is null when the page was not full.
create or replace function public.corpus_sw_docketbird_read_v1(p_kind text, p_case_ids text[] default null, p_after text default null, p_limit integer default 500)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  lim integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  out jsonb;
  n integer;
  last_id text;
begin
  if p_kind = 'rest-cases' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data,
             'provenance', jsonb_build_object('record_sha256', x.provenance->'record_sha256', 'source_sha256', x.provenance->'source_sha256', 'retrieved_at', x.provenance->'retrieved_at', 'source_tool', x.provenance->'source_tool'))
             order by x.native_id), '[]'::jsonb), count(*), max(x.native_id)
      into out, n, last_id
    from (select e.native_id, e.payload_sha256, e.retrieved_at, e.data, e.provenance
          from corpus_ingest.entities e
          where e.source_system = 'docketbird-rest' and e.entity_type = 'case' and e.review_status <> 'quarantined'
            and (p_case_ids is null or e.native_id = any (p_case_ids))
            and (p_after is null or p_after = '' or e.native_id > p_after)
          order by e.native_id limit lim) x;
  elsif p_kind = 'rest-documents' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data,
             'provenance', jsonb_build_object('record_sha256', x.provenance->'record_sha256', 'source_sha256', x.provenance->'source_sha256', 'retrieved_at', x.provenance->'retrieved_at', 'source_tool', x.provenance->'source_tool'))
             order by x.native_id), '[]'::jsonb), count(*), max(x.native_id)
      into out, n, last_id
    from (select e.native_id, e.payload_sha256, e.retrieved_at, e.data, e.provenance
          from corpus_ingest.entities e
          where e.source_system = 'docketbird-rest' and e.entity_type = 'docket-document' and e.review_status <> 'quarantined'
            and (p_case_ids is null or e.data->>'case_id' = any (p_case_ids))
            and (p_after is null or p_after = '' or e.native_id > p_after)
          order by e.native_id limit lim) x;
  elsif p_kind = 'mcp-documents' then
    select coalesce(jsonb_agg(jsonb_build_object('native_id', x.native_id, 'payload_sha256', x.payload_sha256, 'retrieved_at', x.retrieved_at, 'data', x.data,
             'provenance', jsonb_build_object('record_sha256', x.provenance->'record_sha256', 'source_sha256', x.provenance->'source_sha256', 'retrieved_at', x.provenance->'retrieved_at',
               'source_tool', x.provenance->'source_tool', 'source_tool_sort', x.provenance->'source_tool_sort', 'source_capture_file_uri', x.provenance->'source_capture_file_uri',
               'source_capture_file_sha256', x.provenance->'source_capture_file_sha256', 'source_original_document_sha256', x.provenance->'source_original_document_sha256'),
             'cl_docket', x.cl_docket)
             order by x.native_id), '[]'::jsonb), count(*), max(x.native_id)
      into out, n, last_id
    from (select e.native_id, e.payload_sha256, e.retrieved_at, e.data, e.provenance,
                 (select jsonb_build_object('id', d.native_id, 'court_id', d.data->'court_id', 'docket_number', d.data->'docket_number', 'case_name', d.data->'case_name')
                    from corpus_ingest.entities d
                   where d.source_system = 'courtlistener' and d.entity_type = 'dockets' and d.review_status <> 'quarantined'
                     -- CourtListener-blocked dockets lend no caption or link (their own privacy restriction; lead 2026-10-27)
                     and lower(coalesce(d.data->>'blocked', 'false')) in ('false', 'f', '0') and nullif(d.data->>'date_blocked', '') is null
                     and jsonb_typeof(e.data->'source_qualified_courtlistener_docket_ids') = 'array'
                     and jsonb_array_length(e.data->'source_qualified_courtlistener_docket_ids') = 1
                     and d.native_id = e.data->'source_qualified_courtlistener_docket_ids'->>0) as cl_docket
          from corpus_ingest.entities e
          where e.source_system = 'docketbird-mcp' and e.entity_type = 'document_metadata' and e.review_status <> 'quarantined'
            and (p_case_ids is null or e.data->>'native_case_id' = any (p_case_ids))
            and (p_after is null or p_after = '' or e.native_id > p_after)
          order by e.native_id limit lim) x;
  else
    raise exception 'corpus_sw_docketbird_read_v1: unsupported kind %', p_kind using errcode = '22023';
  end if;
  return jsonb_build_object('rows', out, 'next', case when n >= lim then last_id else null end);
end;
$function$;

revoke all on function public.corpus_sw_docketbird_read_v1(text, text[], text, integer) from public, anon, authenticated;
grant execute on function public.corpus_sw_docketbird_read_v1(text, text[], text, integer) to service_role;
