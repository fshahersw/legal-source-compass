-- Independent original-normalization vs current database identity/hash reconciliation.
-- Expected hashes were calculated from the SHA-verified local JSONL, not database output.
with current_rows as (
 select * from corpus_ingest.entities where source_system='ecfr'
 and entity_type in ('hierarchy-nodes','part-authority-notes')
 and last_run='4cccf130-063b-4c6f-84ad-96bbfcfa0d84'::uuid
), signatures as (
 select entity_type,count(*) records,
 encode(sha256(convert_to(string_agg(native_id||':'||payload_sha256,E'\n' order by native_id collate "C"),'UTF8')),'hex') signature
 from current_rows group by entity_type
)
select s.*,case entity_type when 'hierarchy-nodes' then records=274752 and signature='0585074dcd6d84eb934db5d6c979d660f1a688ce48df6fed99b26550c9455116'
 else records=36 and signature='a3af43b0499ccd28ca44be6b793225a35b6680bd784c87e31bcb6a5f2c70c285' end original_signature_matches,
 (select count(*) from current_rows e left join corpus_ingest.entity_versions v
 on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=(e.source_system,e.entity_type,e.native_id,e.payload_sha256)
 where e.entity_type=s.entity_type and (v.native_id is null or v.data is distinct from e.data or v.schema_version is distinct from e.schema_version)) current_version_mismatches,
 (select count(*) from corpus_ingest.entity_versions v where v.source_system='ecfr' and v.entity_type=s.entity_type
 and v.first_run='4cccf130-063b-4c6f-84ad-96bbfcfa0d84'::uuid
 and v.storage_sha256 is distinct from encode(sha256(convert_to(v.data::text,'UTF8')),'hex')) storage_hash_mismatches
from signatures s order by entity_type;
