-- Publisher tree reciprocity and evidence-version association; no inferred hierarchy.
select count(*) edges,count(*)filter(where inferred) inferred_edges,
count(*)filter(where not target_present) absent_target_flags,
count(*)filter(where p.native_id is null or not(p.data->'child_native_ids' ? r.from_id)) missing_or_unpaired_parents,
count(*)filter(where v.native_id is null or v.data->>'parent_native_id' is distinct from r.to_id) source_version_mismatches
from corpus_ingest.relationships r
left join corpus_ingest.entities p on p.source_system=r.source_system and p.entity_type=r.to_type and p.native_id=r.to_id
left join corpus_ingest.entity_versions v on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(r.source_system,r.from_type,r.from_id,r.evidence_sha256)
where r.source_system='ecfr' and r.field='source_tree.parent_path' and r.run_id='4cccf130-063b-4c6f-84ad-96bbfcfa0d84'::uuid;
