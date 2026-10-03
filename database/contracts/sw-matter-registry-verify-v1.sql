-- Independent verification of the sw-matter-registry/1 projection (read-only). Run after every projection; all mismatch counters must be 0.
-- (1) registry (corpus_ingest) vs projection (public.corpus_records)
with md as (select data->>'matter' as matter, data->>'docket_key' as docket_key, data->>'role' as role, data->>'route' as route,
              jsonb_array_length(data->'membership_basis') as nbasis, jsonb_array_length(data->'evidence_ids') as nev
            from corpus_ingest.entities where source_system='sw-matter-registry' and entity_type='matter-docket'),
     pr as (select id, detail->'registry'->>'mdl' as mdl, detail->'registry'->>'docket_key' as docket_key, detail->'registry'->>'role' as role,
              detail->'registry'->>'route' as route, jsonb_array_length(detail->'registry'->'membership_basis') as nbasis,
              jsonb_array_length(detail->'registry'->'evidence') as nev, ordinal, item->>'id' as item_id
            from public.corpus_records where dataset='sw_matter_dockets_v1')
select
  (select count(*) from md) as registry_matter_dockets,
  (select count(*) from pr) as projected_dockets,
  (select count(*) from md join pr on pr.mdl = substring(md.matter from 5) and pr.docket_key = md.docket_key) as joined,
  (select count(*) from md join pr on pr.mdl = substring(md.matter from 5) and pr.docket_key = md.docket_key
    where pr.role is distinct from md.role or pr.route is distinct from md.route or pr.nbasis <> md.nbasis or pr.nev <> md.nev) as field_mismatches,
  (select count(*) from pr where item_id is distinct from id) as item_id_mismatch,
  (select count(distinct ordinal) from pr) as distinct_ordinals, (select min(ordinal) from pr) as min_ordinal, (select max(ordinal) from pr) as max_ordinal,
  (select count(*) from public.corpus_records where dataset='sw_matters_v1') as projected_matters,
  (select count(*) from corpus_ingest.entities where source_system='sw-matter-registry' and entity_type='matter') as registry_matters,
  (select count(*) from public.corpus_workspace_docket_links where source_dataset='sw_matter_dockets_v1') as workspace_links,
  (select count(*) from public.corpus_records where dataset in ('sw_matters_v1','sw_matter_dockets_v1') and search_vector is null) as null_search_vectors,
  (select count(*) from corpus_ingest.relationships where source_system='sw-matter-registry' and (inferred or not target_present)) as inferred_or_unresolved_edges;

-- (2) privacy: non-institutional captions held in the private registry must not appear in any projected row
with caps as (select c->>'value' as cap from corpus_ingest.entities e cross join lateral jsonb_array_elements(e.data->'captions') c
              where e.source_system='sw-matter-registry' and e.entity_type='docket' and coalesce((c->>'institutional')::boolean,false)=false and length(c->>'value')>=8)
select count(*) as member_captions_checked,
       count(*) filter (where exists (select 1 from public.corpus_records r where r.dataset in ('sw_matters_v1','sw_matter_dockets_v1')
         and position(lower(caps.cap) in lower(r.item::text||r.detail::text||r.text||r.title)) > 0)) as leaked
from caps;

-- (3) every evidence row the projection quotes exists in the registry with the same kind
select count(*) as projected_evidence_without_registry_row
from public.corpus_records r cross join lateral jsonb_array_elements(r.detail->'registry'->'evidence') ev
where r.dataset='sw_matter_dockets_v1'
  and not exists (select 1 from corpus_ingest.entities e where e.source_system='sw-matter-registry' and e.entity_type='membership-evidence'
                  and e.native_id = ev->>'evidence_id' and e.data->>'evidence_kind' = ev->>'kind');

-- (4) no "X v. Y" party form anywhere in the projected rows (all three counters must be 0)
select count(*) filter (where dataset='sw_matters_v1') as matters_with_party_form, count(*) filter (where dataset='sw_matter_dockets_v1') as dockets_with_party_form
from public.corpus_records where dataset in ('sw_matters_v1','sw_matter_dockets_v1') and (item::text || detail::text || title || text) ~* '\s(v|vs)\.?\s';

-- (5) stale evidence: active membership-evidence entities that no matter-docket references any more (after a re-key or an identity correction).
--     Read-only detection; the remedy is the reversible UPDATE below (never a delete):
select ev.native_id, ev.data->>'evidence_kind' as kind, ev.data->>'matter' as matter, ev.data->'claim'->>'member_docket_key' as docket_key
from corpus_ingest.entities ev
where ev.source_system='sw-matter-registry' and ev.entity_type='membership-evidence' and ev.review_status<>'quarantined'
  and not exists (select 1 from corpus_ingest.entities md where md.source_system='sw-matter-registry' and md.entity_type='matter-docket'
                  and md.data->'evidence_ids' ? ev.native_id);
-- remedy (reversible): update corpus_ingest.entities set review_status='quarantined' where <the rows above>; restore with review_status='source_metadata'.

-- (6) CourtListener REST import reconciliation for one run: versions per entity type and versions without any recorded native relationship edge (must be 0).
--     Unresolved edges (target_present=false) are expected for parties->attorneys and for rows still in flight; they flip when the target is imported
--     (refresh: update corpus_ingest.relationships r set target_present = exists(select 1 from corpus_ingest.entities t where t.source_system=r.source_system and t.entity_type=r.to_type and t.native_id=r.to_id and t.review_status<>'quarantined') where r.run_id='<run>' and not r.target_present).
select v.entity_type, count(*) as versions,
       count(*) filter (where not exists (select 1 from corpus_ingest.relationships r where r.source_system=v.source_system and r.from_type=v.entity_type and r.from_id=v.native_id and r.evidence_sha256=v.payload_sha256)) as versions_without_edges
from corpus_ingest.entity_versions v where v.source_system='courtlistener' and v.first_run='<run uuid>'::uuid group by v.entity_type order by 1;
