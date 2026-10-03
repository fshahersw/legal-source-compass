-- Read-only recomputation from actual current DB data, not from a claimed source SHA.
-- Apply the private canonical-integer-jsonb-v1.sql helper first and run its vectors.
-- The original file-domain audit must report no float, NUL or surrogate values.
-- Full expected count: hierarchy 274752 + corrected authority notes 36.
-- If a connector timeout requires paging, change only the two ordinal bounds and
-- retain each returned range receipt. Do not infer a full verification from one range.
with verification_range as (
  select 0::bigint lower_ordinal_exclusive,
         9223372036854775807::bigint upper_ordinal_inclusive
), expected_scopes(entity_type,expected_records,expected_signature) as (
  values
    ('hierarchy-nodes'::text,274752::bigint,'0585074dcd6d84eb934db5d6c979d660f1a688ce48df6fed99b26550c9455116'::text),
    ('part-authority-notes'::text,36::bigint,'a3af43b0499ccd28ca44be6b793225a35b6680bd784c87e31bcb6a5f2c70c285'::text)
), scoped as materialized (
  select e.*,row_number() over(order by entity_type collate "C",native_id collate "C") verification_ordinal
  from corpus_ingest.entities e
  where e.source_system='ecfr'
    and e.last_run='4cccf130-063b-4c6f-84ad-96bbfcfa0d84'::uuid
    and ((e.entity_type='hierarchy-nodes' and e.schema_version='ecfr-hierarchy-metadata/1')
      or (e.entity_type='part-authority-notes' and e.schema_version='ecfr-authority-notes/1.1'))
), bounded as materialized (
  select s.* from scoped s cross join verification_range r
  where s.verification_ordinal>r.lower_ordinal_exclusive
    and s.verification_ordinal<=r.upper_ordinal_inclusive
), recomputed as materialized (
  select b.*,corpus_ingest.canonical_integer_jsonb_sha256_v1(b.data) actual_payload_sha256
  from bounded b
), checked as (
  select r.*,v.native_id is not null matching_source_version_present,
    v.data is not distinct from r.data and v.schema_version is not distinct from r.schema_version current_version_data_matches
  from recomputed r
  left join corpus_ingest.entity_versions v
    on (v.source_system,v.entity_type,v.native_id,v.payload_sha256)=
       (r.source_system,r.entity_type,r.native_id,r.payload_sha256)
)
select t.entity_type,t.expected_records,count(c.native_id) records_checked,
  (select count(*) from scoped s where s.entity_type=t.entity_type) current_scope_records,
  min(verification_ordinal) first_ordinal,max(verification_ordinal) last_ordinal,
  count(c.native_id) filter(where actual_payload_sha256 is distinct from payload_sha256) recomputed_payload_mismatches,
  count(c.native_id) filter(where not matching_source_version_present or not current_version_data_matches) current_version_mismatches,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    string_agg(native_id||':'||actual_payload_sha256,E'\n' order by native_id collate "C"),'UTF8')),'hex') recomputed_identity_signature,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    string_agg(native_id||':'||payload_sha256,E'\n' order by native_id collate "C"),'UTF8')),'hex') claimed_identity_signature,
  case when (select r.lower_ordinal_exclusive=0 and r.upper_ordinal_inclusive>=(select count(*) from scoped)
             from verification_range r)
    then count(c.native_id)=t.expected_records and
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        string_agg(native_id||':'||actual_payload_sha256,E'\n' order by native_id collate "C"),'UTF8')),'hex')=t.expected_signature
    else null
  end full_original_signature_matches,
  (select jsonb_agg(jsonb_build_object('native_id',x.native_id,'claimed',x.payload_sha256,'recomputed',x.actual_payload_sha256))
   from (select native_id,payload_sha256,actual_payload_sha256 from checked x
         where x.entity_type=t.entity_type and x.actual_payload_sha256 is distinct from x.payload_sha256
         order by native_id collate "C" limit 5)x) mismatch_sample
from expected_scopes t left join checked c on c.entity_type=t.entity_type
group by t.entity_type,t.expected_records,t.expected_signature order by t.entity_type collate "C";
