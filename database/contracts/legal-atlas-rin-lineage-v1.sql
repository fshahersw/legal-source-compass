-- Rule lineage by RIN (Regulation Identifier Number), read-only, service_role only.
-- Apply after legal-atlas-approve-api-v1.sql has released the records and edges; before that it returns empty.
-- Rollback: legal-atlas-rin-lineage-v1.rollback.sql.
--
-- A rule_proceeding record is versioned per referencing Federal Register document (version = that document's
-- payload hash), so corpus_legal_node_v3 on one record shows a single document. This function gathers every
-- approved proposes/finalizes edge into any rule_proceeding record with the exact RIN, ordered by publication
-- date, so a reader sees the proposed-to-final history the Federal Register itself states (regulation_id_numbers).
-- Exact match only: no fuzzy RIN matching, no inference between documents. Only legal_atlas.visible_edges
-- rows are returned, so the structural accuracy checks apply unchanged. Uses legal_records_type_id and
-- legal_edges_to; pages of 100 because one RIN can carry tens of thousands of documents.

create or replace function public.corpus_legal_rin_v1(p_rin text, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with rin as (
    select upper(btrim(p_rin)) as id where upper(btrim(coalesce(p_rin, ''))) ~ '^[0-9]{4}-[A-Z0-9]{4}$'
  ), proceedings as (
    select r.record_key, r.payload from legal_atlas.records r join rin on r.type = 'rule_proceeding' and r.id = rin.id
    where r.review_status = 'approved'
  ), lineage as (
    select e.type, e.edge_key, e.source_url, e.source_date, e.from_key, e.evidence
    from proceedings p join legal_atlas.visible_edges e on e.to_key = p.record_key
    where e.type in ('proposes', 'finalizes')
  ), page as (
    select l.* from lineage l order by l.source_date, l.type, l.edge_key
    limit 100 offset greatest(0, least(coalesce(p_offset, 0), 1000000))
  )
  select case when not exists (select 1 from rin) then null else jsonb_build_object(
    'rin', (select id from rin),
    'title', (select p.payload->'attributes'->'native'->'regulation_id_number_info'->(select id from rin)->>'title'
              from proceedings p order by p.payload->>'date' desc, p.record_key::text limit 1),
    'proceeding', (select p.payload from proceedings p order by p.payload->>'date' desc, p.record_key::text limit 1),
    'counts', jsonb_build_object(
      'proposes', (select count(*) from lineage where type = 'proposes'),
      'finalizes', (select count(*) from lineage where type = 'finalizes'),
      'first_published', (select min(source_date) from lineage),
      'last_published', (select max(source_date) from lineage)),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'relation', pg.type, 'edge_key', pg.edge_key, 'published', pg.source_date, 'source_url', pg.source_url,
        'evidence', pg.evidence,
        'document_number', d.payload->>'id', 'title', d.payload->>'title',
        'fr_document_type', d.payload->'attributes'->>'fr_document_type',
        'citation', d.payload->'attributes'->'native'->>'citation',
        'action', d.payload->'attributes'->'native'->>'action',
        'agencies', d.payload->'attributes'->'agencies')
      order by pg.source_date, pg.type, pg.edge_key)
      from page pg join legal_atlas.records d on d.record_key = pg.from_key and d.review_status = 'approved'), '[]'::jsonb),
    'total', (select count(*) from lineage),
    'page_size', 100,
    'source', 'Federal Register (federalregister.gov API), public domain US government work') end
$$;

revoke all on function public.corpus_legal_rin_v1(text, integer) from public, anon, authenticated;
grant execute on function public.corpus_legal_rin_v1(text, integer) to service_role;
