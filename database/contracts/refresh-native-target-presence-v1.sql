-- Refresh only exact native target presence after private backfills.
-- Does not create inferred edges or rewrite source/version evidence.
-- Repeat this bounded statement until changed_edges=0.
with changed_targets as materialized(
 select r.*,exists(select 1 from corpus_ingest.entities t
 where t.source_system=r.source_system and t.entity_type=r.to_type and t.native_id=r.to_id
 and t.review_status<>'quarantined')as actual_target_present
 from corpus_ingest.relationships r
 where r.run_id='494cfa52-74c5-42ac-a770-80e46b9a3035'::uuid
 and r.target_present is distinct from exists(select 1 from corpus_ingest.entities t
 where t.source_system=r.source_system and t.entity_type=r.to_type and t.native_id=r.to_id
 and t.review_status<>'quarantined')
 order by r.source_system,r.from_type,r.from_id,r.field,r.to_type,r.to_id,r.evidence_sha256
 limit 10000
), refreshed as(
 update corpus_ingest.relationships r set target_present=c.actual_target_present
 from changed_targets c
 where(r.source_system,r.from_type,r.from_id,r.field,r.to_type,r.to_id,r.evidence_sha256)
 =(c.source_system,c.from_type,c.from_id,c.field,c.to_type,c.to_id,c.evidence_sha256)
 returning r.from_type,r.to_type,r.target_present
)
select jsonb_build_object('contract_version','corpus-native-target-presence/1',
'changed_edges',(select count(*)from refreshed),
'newly_resolved',(select count(*)from refreshed where target_present),
'newly_unresolved',(select count(*)from refreshed where not target_present),
'by_target',(select jsonb_agg(to_jsonb(q))from(select from_type,to_type,count(*)as changed,
count(*)filter(where target_present)as newly_resolved from refreshed group by from_type,to_type order by from_type,to_type)q),
'checked_at',now())as receipt;
