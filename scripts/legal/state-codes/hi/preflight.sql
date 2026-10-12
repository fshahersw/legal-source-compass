-- Read-only readiness and retention evidence. Run twice around an activity
-- observation window before considering closure of an existing run. Age alone
-- is not evidence that its worker has stopped. This SQL performs no mutation.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';
set local lock_timeout = '3s';
with state as (
 select * from corpus_ingest.publisher_code_states_v2 where jurisdiction = 'HI'
), runs as (
 select r.*, (select count(*) from corpus_ingest.publisher_code_batches_v2 b where b.run_id = r.id) batch_count,
 (select max(imported_at) from corpus_ingest.publisher_code_batches_v2 b where b.run_id = r.id) latest_batch_at,
 (select max(retrieved_at) from corpus_ingest.publisher_code_object_sources_v2 o where o.run_id = r.id) latest_source_retrieved_at,
 (select max(o.verified_at) from corpus_ingest.publisher_code_objects_v2 o where o.first_run = r.id) latest_original_verified_at
 from corpus_ingest.runs r where scope->>'source_system' = 'hi-hrs'
), current_groups as (
 select entity_type, review_status, last_run, provenance->>'parser' parser,
 provenance->>'manifest_sha256' manifest_sha256, count(*) records,
 count(distinct native_id) native_ids, count(distinct provenance->>'source_url') source_urls,
 min(native_id) first_native_id, max(native_id) last_native_id,
 encode(sha256(convert_to(string_agg(jsonb_build_array(native_id,payload_sha256,data,provenance,review_status)::text,
 E'\n' order by native_id), 'UTF8')), 'hex') current_digest
 from corpus_ingest.entities where source_system = 'hi-hrs'
 group by entity_type, review_status, last_run, provenance->>'parser', provenance->>'manifest_sha256'
), version_groups as (
 select entity_type, first_run, count(*) versions,
 encode(sha256(convert_to(string_agg(jsonb_build_array(native_id,payload_sha256,data,storage_sha256)::text,
 E'\n' order by native_id,payload_sha256), 'UTF8')), 'hex') immutable_version_digest
 from corpus_ingest.entity_versions where source_system = 'hi-hrs'
 group by entity_type, first_run
), objects as (
 select o.kind, count(*) objects, sum(o.bytes) bytes,
 count(*) filter(where b.public or so.id is null) missing_or_public_storage
 from corpus_ingest.publisher_code_objects_v2 o
 join (select distinct sha256 from corpus_ingest.publisher_code_object_sources_v2 where jurisdiction = 'HI') s using(sha256)
 left join storage.objects so on so.bucket_id = o.bucket and so.name = o.object_key
 left join storage.buckets b on b.id = o.bucket group by o.kind
)
select jsonb_build_object('schema', 'hi-preflight/1', 'checked_at', now(),
 'read_only', current_setting('transaction_read_only'), 'state', (select to_jsonb(s) from state s),
 'runs', (select jsonb_agg(to_jsonb(r) order by started_at) from runs r),
 'current_groups', (select jsonb_agg(to_jsonb(g)) from current_groups g),
 'version_groups', (select jsonb_agg(to_jsonb(g)) from version_groups g),
 'objects', (select jsonb_agg(to_jsonb(o)) from objects o),
 'manifests', (select jsonb_agg(to_jsonb(m)) from corpus_ingest.publisher_code_manifests_v2 m where source_system = 'hi-hrs'),
 'active_statements', (select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active'
    and (query ilike '%hi-hrs%' or query ilike '%corpus_publisher_code%')),
 'rpc_controls', (select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text,
    'definer', p.prosecdef, 'settings', p.proconfig, 'anon', has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated', has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_role', has_function_privilege('service_role',p.oid,'EXECUTE')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'corpus_publisher_code_%')) packet;
commit;
