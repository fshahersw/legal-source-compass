with expected as (
 select count(*)as n from corpus_ingest.entities where source_system='corpus-legal-review' and entity_type='limitation-rules' and review_status<>'quarantined'
), mismatches as (
 select e.native_id from corpus_ingest.entities e
 left join public.corpus_records r on r.dataset='statutory_limitations_review' and r.id='legal-review:'||e.native_id
 where e.source_system='corpus-legal-review' and e.entity_type='limitation-rules' and e.review_status<>'quarantined'
 and (r.id is null or r.text::jsonb is distinct from e.data or r.source_url is distinct from e.provenance->>'source_url'
 or r.detail->'provenance'->>'record_sha256' is distinct from e.payload_sha256 or r.filters->>'_listing' is distinct from 'true'
 or coalesce(r.detail->>'qualification','')='' or r.item->'links' is null or jsonb_array_length(r.item->'links')<1)
), inventory as (
 select count(*)as n,count(distinct ordinal) as ordinals,min(ordinal)as first,max(ordinal)as last from public.corpus_records where dataset='statutory_limitations_review'
), published as (
 update public.corpus_datasets d set ready=true,imported_records=i.n,updated_at=now(),
 metadata=metadata||jsonb_build_object('projection_validation',jsonb_build_object('version','statutory-limitations-review/1','validated_at',now(),'records',i.n,'source_payload_and_provenance_match',true))
 from inventory i,expected e where d.id='statutory_limitations_review' and e.n=104 and i.n=e.n and d.expected_records=e.n and i.ordinals=i.n and i.first=1 and i.last=i.n and not exists(select 1 from mismatches)
 returning d.id,d.ready,d.imported_records
)
select jsonb_build_object(
 'public_projection',(select to_jsonb(p) from published p),'projection_mismatches',(select count(*)from mismatches),
 'entity_counts',(select jsonb_object_agg(entity_type,n)from(select entity_type,count(*)as n from corpus_ingest.entities where source_system='corpus-legal-review' group by entity_type)c),
 'versions',(select count(*)from corpus_ingest.entity_versions where source_system='corpus-legal-review'),
 'observations',(select count(*)from corpus_ingest.observations where source_system='corpus-legal-review' and run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'),
 'native_relationships',(select count(*)from corpus_ingest.relationships where source_system='corpus-legal-review'),
 'inferred_relationships',(select count(*)from corpus_ingest.relationships where source_system='corpus-legal-review' and inferred),
 'unresolved_relationships',(select count(*)from corpus_ingest.relationships where source_system='corpus-legal-review' and not target_present),
 'quarantined_rejections',(select count(*)from corpus_ingest.entities where source_system='corpus-legal-review' and entity_type='rejected-captures' and review_status='quarantined'),
 'text_checks',(select jsonb_build_object('full_text_records',count(*)filter(where data?'text'),'hash_mismatches',count(*)filter(where data?'text' and encode(sha256(convert_to(data->>'text','UTF8')),'hex')is distinct from data->>'sha256'),'file_locator_only',jsonb_agg(jsonb_build_object('id',native_id,'sha256',data->>'sha256','bytes',data->'byteLength','text_storage',data->'full_text_storage'))filter(where not(data?'text')))from corpus_ingest.entities where source_system='corpus-legal-review' and entity_type in('statutory-sources','judicial-references')),
 'permissions',(select jsonb_agg(jsonb_build_object('role',r,'schema_usage',has_schema_privilege(r,'corpus_ingest','USAGE'),'entities_select',has_table_privilege(r,'corpus_ingest.entities','SELECT'),'ingest_execute',has_function_privilege(r,'corpus_ingest.ingest_entities(uuid,jsonb)','EXECUTE')))from unnest(array['anon','authenticated'])r),
 'rls_disabled_private_tables',(select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='corpus_ingest' and c.relkind='r' and not c.relrowsecurity),
 'legacy_limitations',(select jsonb_build_object('ready',ready,'records',imported_records)from public.corpus_datasets where id='limitation_periods'),
 'held_law',(select jsonb_agg(jsonb_build_object('dataset',id,'ready',ready))from public.corpus_datasets where id in('open_us_law','state_codes','indiana_code','sd_statutes'))
)as receipt;
