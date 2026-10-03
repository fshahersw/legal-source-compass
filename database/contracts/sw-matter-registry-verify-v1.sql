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

-- (2) exclusions (v1.3, "show as published": member captions ARE published; only sealed / restricted / in camera / ex parte / redacted text is excluded):
--     registry captions that match the exclusion pattern must not appear in any projected matter or docket row (leaked must be 0).
--     (Through v1.2 this check forbade every non-institutional caption; v1.3 publishes them, so the check is narrowed to the exclusion set.)
-- (materialized form: the lower-cased projected text is built once; the unmaterialized cross product times out as the registry grows)
with recs as materialized (select lower(item::text || detail::text || text || title) as t from public.corpus_records where dataset in ('sw_matters_v1','sw_matter_dockets_v1')),
caps as materialized (select distinct lower(c->>'value') as cap from corpus_ingest.entities e cross join lateral jsonb_array_elements(e.data->'captions') c
              where e.source_system='sw-matter-registry' and e.entity_type='docket' and (c->>'value') ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact' and length(c->>'value')>=8)
select (select count(*) from caps) as excluded_captions_checked_distinct,
       (select count(*) from caps where exists (select 1 from recs where position(caps.cap in recs.t) > 0)) as leaked;

-- (3) every evidence row the projection quotes exists in the registry with the same kind
select count(*) as projected_evidence_without_registry_row
from public.corpus_records r cross join lateral jsonb_array_elements(r.detail->'registry'->'evidence') ev
where r.dataset='sw_matter_dockets_v1'
  and not exists (select 1 from corpus_ingest.entities e where e.source_system='sw-matter-registry' and e.entity_type='membership-evidence'
                  and e.native_id = ev->>'evidence_id' and e.data->>'evidence_kind' = ev->>'kind');

-- (4) "X v. Y" party form (v1.3): matters never carry it, and a docket row carries it only when it publishes a caption (the first two counters must be 0;
--     dockets_with_party_form_and_caption is informational: member captions are shown as published)
select count(*) filter (where dataset='sw_matters_v1') as matters_with_party_form,
       count(*) filter (where dataset='sw_matter_dockets_v1' and item->'cells'->>'caption' is null) as dockets_with_party_form_but_no_published_caption,
       count(*) filter (where dataset='sw_matter_dockets_v1' and item->'cells'->>'caption' is not null) as dockets_with_party_form_and_caption
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

-- ===== v1.3 additions (show as published: sw_docket_entries_v1, sw_matter_parties_v1, captions in sw_matter_dockets_v1) =====
-- (7) entries: projected CourtListener rows per master docket equal the lake's rows for that docket (0 rows expected; external entries are checked in (13))
with proj as (select r.item->'cells'->>'native_docket_id' as did, count(*) as n from public.corpus_records r where r.dataset='sw_docket_entries_v1' and r.item->'cells'->>'provider'='courtlistener' group by 1),
lake as (select substring(e.data->>'docket' from '/dockets/([0-9]+)/') as did, count(*) as n from corpus_ingest.entities e
         where e.source_system='courtlistener' and e.entity_type='docket-entries' and e.review_status<>'quarantined' and substring(e.data->>'docket' from '/dockets/([0-9]+)/') in (select did from proj) group by 1)
select proj.did, proj.n as projected, lake.n as in_lake from proj left join lake using (did) where proj.n is distinct from lake.n;

-- (8) entries: field equality with the lake and every exclusion rule (all counters must be 0)
select
 (select count(*) from public.corpus_records r join corpus_ingest.entities e on e.source_system='courtlistener' and e.entity_type='docket-entries' and e.native_id = r.item->'cells'->>'native_entry_id'
   where r.dataset='sw_docket_entries_v1'
     and ( (r.item->'cells'->>'entry_number') is distinct from (e.data->>'entry_number') or (r.item->'cells'->>'date_filed') is distinct from (e.data->>'date_filed')
        or ((r.item->'cells'->>'description') is not null and left(btrim(regexp_replace(e.data->>'description', '\s+', ' ', 'g')), 499) <> left(r.item->'cells'->>'description', 499)) )) as field_mismatches,
 (select count(*) from public.corpus_records r where r.dataset='sw_docket_entries_v1' and r.item->'cells'->>'provider'='courtlistener' and not exists (select 1 from corpus_ingest.entities e where e.source_system='courtlistener' and e.entity_type='docket-entries' and e.native_id = r.item->'cells'->>'native_entry_id')) as projected_without_lake_row,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and item->'cells'->>'description' ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact') as published_descriptions_matching_exclusion,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and (item->'cells'->>'documents_sealed')::int > 0 and item->'cells'->>'description' is not null) as sealed_doc_entries_with_description,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and filters->>'native_docket_id' in ('6245245','14916674','16684846','6239202')) as blocked_docket_entries,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and length(item->'cells'->>'description') > 500) as descriptions_over_500,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and search_vector is null) as null_search_vectors,
 (select count(*) from public.corpus_records where dataset='sw_docket_entries_v1' and (detail::text ~* '"sha1"|"filepath_local"|"filepath_ia"|storage[.]courtlistener')) as file_path_leaks;

-- (9) parties: projected parties per master docket equal the lake's parties with that docket association (0 rows expected)
with proj as (select r.item->'cells'->>'native_docket_id' as did, count(*) as n from public.corpus_records r where r.dataset='sw_matter_parties_v1' group by 1),
lake as (select pt->>'docket_id' as did, count(distinct e.native_id) as n from corpus_ingest.entities e cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data->'party_types')='array' then e.data->'party_types' else '[]'::jsonb end) pt
         where e.source_system='courtlistener' and e.entity_type='parties' and e.review_status<>'quarantined' and pt->>'docket_id' in (select did from proj) group by 1)
select proj.did, proj.n as projected, lake.n as in_lake from proj left join lake using (did) where proj.n is distinct from lake.n;

-- (10) parties and counsel: no contact data, no exclusion text, counsel names exist in the lake, no sealed-group counsel, no blocked dockets (all counters must be 0)
select
 (select count(*) from public.corpus_records where dataset='sw_matter_parties_v1' and (item::text || detail::text || text) ~* '[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}|[(][0-9]{3}[)] ?[0-9]{3}-[0-9]{4}|[0-9]{3}-[0-9]{3}-[0-9]{4}') as contact_pattern_rows,
 (select count(*) from public.corpus_records where dataset='sw_matter_parties_v1' and (item->'cells'->>'party_name' ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact' or item->'cells'->>'extra_info' ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact')) as published_party_text_matching_exclusion,
 (select count(*) from (select c->>'native_attorney_id' as aid, c->>'name' as nm from public.corpus_records r cross join lateral jsonb_array_elements(r.detail->'registry'->'counsel') c where r.dataset='sw_matter_parties_v1' and c->>'name' is not null) x
    where not exists (select 1 from corpus_ingest.entities a where a.source_system='courtlistener' and a.entity_type='attorneys' and a.native_id=x.aid and regexp_replace(btrim(a.data->>'name'), '\s+', ' ', 'g') = x.nm)) as counsel_names_not_in_lake,
 (select count(*) from (select c from public.corpus_records r cross join lateral jsonb_array_elements(r.detail->'registry'->'counsel') c where r.dataset='sw_matter_parties_v1' and c->'role_codes' @> '[3]'::jsonb) y) as sealed_group_counsel_published,
 (select count(*) from public.corpus_records where dataset='sw_matter_parties_v1' and filters->>'native_docket_id' in ('6245245','14916674','16684846','6239202')) as blocked_docket_parties,
 (select count(*) from public.corpus_records where dataset='sw_matter_parties_v1' and search_vector is null) as null_search_vectors;

-- (11) captions on docket rows: title format, no exclusion text, every projected caption exists in the private registry docket entity (all counters must be 0)
select
 (select count(*) from public.corpus_records where dataset='sw_matter_dockets_v1' and item->'cells'->>'caption' ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact') as captions_matching_exclusion,
 (select count(*) from public.corpus_records where dataset='sw_matter_dockets_v1' and item->'cells'->>'caption' is not null and title <> (item->'cells'->>'caption') || ' — ' || (item->'cells'->>'docket_number') || ' (' || (item->'cells'->>'court_id') || ')') as title_format_mismatch,
 (select count(*) from public.corpus_records r where r.dataset='sw_matter_dockets_v1' and r.detail->'registry'->>'caption' is not null and not exists (
    select 1 from corpus_ingest.entities d where d.source_system='sw-matter-registry' and d.entity_type='docket' and d.native_id = r.detail->'registry'->>'docket_key'
      and exists (select 1 from jsonb_array_elements(d.data->'captions') c where regexp_replace(btrim(c->>'value'), '\s+', ' ', 'g') = r.detail->'registry'->>'caption'))) as projected_caption_not_in_registry;

-- (12) all four datasets ready and read-back validated
select id, ready, expected_records, imported_records, (metadata->'projection_validation'->>'verified')::boolean as verified, metadata->'projection_validation'->>'validated_at' as validated_at
from public.corpus_datasets where id in ('sw_matters_v1','sw_matter_dockets_v1','sw_docket_entries_v1','sw_matter_parties_v1') order by id;

-- (13) external entries (dockets CourtListener blocks at the source: GovInfo, court MDL page, DocketBird sheet), one row per provider. Every counter except rows_projected
--      must be 0: each projected row exists in the registry with the same payload hash, official hosts only for govinfo / official-court, no exclusion text.
select item->'cells'->>'provider' as provider, count(*) as rows_projected,
 count(*) filter (where item->'cells'->>'provider' <> 'courtlistener' and not exists (select 1 from corpus_ingest.entities e where e.source_system='sw-matter-registry' and e.entity_type='external-entry' and e.review_status<>'quarantined'
                    and e.native_id = r.detail->'provenance'->>'source_native_id' and e.payload_sha256 = r.detail->'provenance'->>'source_record_sha256')) as external_without_registry_row,
 count(*) filter (where item->'cells'->>'provider' in ('govinfo','official-court') and not (coalesce(source_url, '') ~ '^https://(www[.]govinfo[.]gov|www[.]njd[.]uscourts[.]gov)/')) as external_non_official_source_urls,
 count(*) filter (where item->'cells'->>'provider' <> 'courtlistener' and item->'cells'->>'description' ~* 'seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact') as external_descriptions_matching_exclusion
from public.corpus_records r where dataset='sw_docket_entries_v1' group by 1 order by 1;

-- (14) no account ids or signed links (DocketBird user_id, AWS signatures) anywhere in the entries dataset (must be 0)
select count(*) as signed_or_account_url_leaks from public.corpus_records where dataset='sw_docket_entries_v1'
  and (item::text || detail::text || coalesce(source_url, '')) ~* 'user_id=|AWSAccessKeyId|Signature=|X-Amz-|Expires=[0-9]';
