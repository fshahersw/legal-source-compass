-- Legal atlas release v1: owner decision 2026-10-27 ("dont withhold any data. If its accurate and valuable, USE IT").
-- Apply over legal-atlas-v3.generated.sql + legal-atlas-v3-validation-update.sql + legal-atlas-v3-fr-refresh.sql.
-- Rollback: legal-atlas-approve-api-v1.rollback.sql (sets every ledgered row back to 'pending', then drops this contract).
--
-- legal_atlas.records/edges.review_status defaulted to 'pending' and nothing was ever reviewed, so the
-- Federal Register lineage (proposes/finalizes by RIN), rule proceedings, courts, judges, CAP opinions and
-- CourtListener dockets were invisible to corpus_legal_node_v3 / visible_edges. 'pending' carried no evidence
-- against any row: it was a caution hold, which the 2026-10-27 decision releases.
--
-- What changes: this file only creates objects. The release itself happens when the lead calls
--   legal_atlas.release_pending_records_v1(type, limit)   -- per entity type, repeated until it returns 0
--   legal_atlas.release_pending_edges_v1(limit)           -- after the records, repeated until it returns 0
-- Each call is one bounded statement (no long table lock, safe to re-run) and ledgers every key it approves.
-- Cost: the records CHECK re-runs legal_atlas.record_errors on every updated row (measured 0.6 ms per
-- fr_document row on 2026-10-27), so a 20,000-row call takes about 15 s; edges are cheaper.
--
-- What stays held, and why (legal_atlas.release_hold_reason_v1):
--   * attorney records: the payload carries CourtListener email, phone, fax and contact_raw. Owner decision
--     2026-10-03 "counsel without contact fields" is an explicit owner policy hold. They return when a
--     contact-free attorney projection exists; nothing here strips payloads.
--   * docket_entry records whose provider (CourtListener RECAP) reports is_sealed=true on a document of the
--     entry, or any record whose native payload reports is_sealed=true: explicit source seal evidence.
-- Unchanged: the structural accuracy checks of legal_atlas.visible_edges (source_url match, PRORULE/RULE
-- document type, JPML transfer order, brief-only citations, paragraph/offset evidence, low-confidence LLM
-- exclusion). An edge is approved only when those predicates already hold with its from, to and source records
-- approved, so every approved edge is immediately served by visible_edges. Records still pass the table's
-- record_errors CHECK (official publisher / permissive licence, exact identifiers).

create table if not exists legal_atlas.release_ledger_v1 (
  kind text not null check (kind in ('record','edge')),
  item_key text not null,
  record_key jsonb,
  edge_key text,
  entity_type legal_atlas.entity_type,
  released_at timestamptz not null default clock_timestamp(),
  basis text not null default 'owner-2026-10-27-dont-withhold',
  primary key (kind, item_key),
  check ((kind = 'record' and record_key is not null and edge_key is null and item_key = record_key::text)
      or (kind = 'edge' and edge_key is not null and record_key is null and item_key = edge_key))
);
alter table legal_atlas.release_ledger_v1 enable row level security;
revoke all on legal_atlas.release_ledger_v1 from public, anon, authenticated;
grant select, insert, delete on legal_atlas.release_ledger_v1 to service_role;

-- Null when nothing in the record's own source holds it back; otherwise the explicit reason.
create or replace function legal_atlas.release_hold_reason_v1(p_type legal_atlas.entity_type, p jsonb)
returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when p_type = 'attorney' then 'owner_policy_counsel_contact_fields'
    when p->'attributes'->'native'->'is_sealed' = 'true'::jsonb then 'provider_sealed'
    when jsonb_typeof(p->'attributes'->'native'->'recap_documents') = 'array'
      and exists (select 1 from jsonb_array_elements(p->'attributes'->'native'->'recap_documents') d
                  where d->'is_sealed' = 'true'::jsonb) then 'provider_sealed_document'
  end
$$;

create or replace function legal_atlas.release_pending_records_v1(p_type legal_atlas.entity_type, p_limit integer default 20000)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare released integer;
begin
  if p_type is null then raise exception 'Entity type required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200000 then raise exception 'Bounded limit required (1..200000)'; end if;
  with picked as (
    select r.record_key from legal_atlas.records r
    where r.type = p_type and r.review_status = 'pending'
      and legal_atlas.release_hold_reason_v1(r.type, r.payload) is null
    limit p_limit
    for update skip locked
  ), upd as (
    update legal_atlas.records r set review_status = 'approved'
    from picked where r.record_key = picked.record_key and r.review_status = 'pending'
    returning r.record_key, r.type
  ), led as (
    insert into legal_atlas.release_ledger_v1 (kind, item_key, record_key, entity_type)
    select 'record', u.record_key::text, u.record_key, u.type from upd u
    on conflict (kind, item_key) do nothing
    returning 1
  )
  select count(*) into released from upd;
  return jsonb_build_object('kind', 'record', 'type', p_type, 'released', released,
    'still_pending', (select count(*) from legal_atlas.records where type = p_type and review_status = 'pending'));
end;
$$;

-- Mirrors the predicates of legal_atlas.visible_edges (validation-update definition) except e.review_status.
create or replace function legal_atlas.release_pending_edges_v1(p_limit integer default 20000)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare released integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200000 then raise exception 'Bounded limit required (1..200000)'; end if;
  with picked as (
    select e.edge_key from legal_atlas.edges e
    join legal_atlas.records f on f.record_key = e.from_key and f.review_status = 'approved'
    join legal_atlas.records t on t.record_key = e.to_key and t.review_status = 'approved'
    join legal_atlas.records s on s.record_key = e.source_key and s.review_status = 'approved'
    where e.review_status = 'pending' and not (e.extraction_method = 'llm' and e.confidence < 0.8)
      and e.source_url = s.payload->>'source_url' and legal_atlas.evidence_valid(e.evidence)
      and (e.type <> 'transferred_by' or (t.payload->>'court_id' = 'jpml' and t.payload->'attributes'->>'document_role' = 'transfer_order'))
      and (e.type <> 'cites' or e.from_type <> 'source_doc' or f.payload->'attributes'->>'document_role' = 'brief')
      and (e.type <> 'proposes' or f.payload->'attributes'->>'fr_document_type' = 'PRORULE')
      and (e.type <> 'finalizes' or f.payload->'attributes'->>'fr_document_type' = 'RULE')
      and ((e.evidence ? 'paragraph_id' and jsonb_typeof(s.payload->'attributes'->'paragraphs') = 'object'
              and s.payload->'attributes'->'paragraphs' ? (e.evidence->>'paragraph_id'))
        or (e.evidence ? 'end' and jsonb_typeof(s.payload->'attributes'->'text') = 'string'
              and (e.evidence->>'end')::numeric <= length(s.payload->'attributes'->>'text')))
    limit p_limit
    for update of e skip locked
  ), upd as (
    update legal_atlas.edges e set review_status = 'approved'
    from picked where e.edge_key = picked.edge_key and e.review_status = 'pending'
    returning e.edge_key
  ), led as (
    insert into legal_atlas.release_ledger_v1 (kind, item_key, edge_key)
    select 'edge', u.edge_key, u.edge_key from upd u
    on conflict (kind, item_key) do nothing
    returning 1
  )
  select count(*) into released from upd;
  return jsonb_build_object('kind', 'edge', 'released', released,
    'still_pending', (select count(*) from legal_atlas.edges where review_status = 'pending'));
end;
$$;

-- What is still held and why: the lead's after-check and the audit report.
create or replace view legal_atlas.release_holds_v1 with (security_invoker = true) as
  select r.type, legal_atlas.release_hold_reason_v1(r.type, r.payload) as reason, count(*) as records
  from legal_atlas.records r
  where r.review_status = 'pending'
  group by 1, 2;

revoke all on function legal_atlas.release_hold_reason_v1(legal_atlas.entity_type, jsonb) from public, anon, authenticated;
revoke all on function legal_atlas.release_pending_records_v1(legal_atlas.entity_type, integer) from public, anon, authenticated;
revoke all on function legal_atlas.release_pending_edges_v1(integer) from public, anon, authenticated;
revoke all on legal_atlas.release_holds_v1 from public, anon, authenticated;
grant execute on function legal_atlas.release_hold_reason_v1(legal_atlas.entity_type, jsonb) to service_role;
grant execute on function legal_atlas.release_pending_records_v1(legal_atlas.entity_type, integer) to service_role;
grant execute on function legal_atlas.release_pending_edges_v1(integer) to service_role;
grant select on legal_atlas.release_holds_v1 to service_role;
