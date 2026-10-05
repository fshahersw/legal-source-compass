-- Complete only after the official Storage API receipt and retained-body readback.
-- Mapping before-images are private cleanup_decisions; no source/occurrence is removed.
begin;
set local statement_timeout='120s';
do $$ begin
 if not exists(select 1 from corpus_ingest.runs where id='af9b4c2b-30a7-4044-8db1-3f3121228467'
 and scope->>'plan_sha256'='674e48f52312470422b1c98af1e24e3b15adc4aa42bf2d5f8b890d6223d33bff')
 then raise exception 'Pinned plan is not recorded'; end if;
 if (select count(*) from corpus_ingest.cleanup_decisions d join public.corpus_artifacts a on a.route=d.record_id
 where d.dataset='corpus_artifacts' and d.issue='artifact_storage_alias_20261005'
 and d.run_id='af9b4c2b-30a7-4044-8db1-3f3121228467' and to_jsonb(a)=d.replacement)<>30
 then raise exception 'Expected 30 exact retained artifact mappings'; end if;
 if exists(select 1 from corpus_ingest.cleanup_decisions d join storage.objects o
 on o.bucket_id='corpus-originals' and o.name=d.original_record->>'object_key'
 where d.run_id='af9b4c2b-30a7-4044-8db1-3f3121228467' and d.issue='artifact_storage_alias_20261005')
 then raise exception 'Legacy copy still exists'; end if;
 if (select count(distinct o.name) from corpus_ingest.cleanup_decisions d join storage.objects o
 on o.bucket_id='corpus-originals' and o.name=d.replacement->>'object_key'
 and (o.metadata->>'size')::bigint=(d.original_record->>'bytes')::bigint
 where d.run_id='af9b4c2b-30a7-4044-8db1-3f3121228467' and d.issue='artifact_storage_alias_20261005')<>29
 then raise exception 'Retained object metadata missing or changed'; end if;
 if (select sum(bytes) from (select distinct original_record->>'object_key' as key,(original_record->>'bytes')::bigint as bytes
 from corpus_ingest.cleanup_decisions where run_id='af9b4c2b-30a7-4044-8db1-3f3121228467' and issue='artifact_storage_alias_20261005') k)<>9833011
 then raise exception 'Unexpected byte total'; end if;
end $$;
update corpus_ingest.runs set status='completed',finished_at=now(),counts=jsonb_build_object(
 'artifact_routes_consolidated',30,'objects_removed',29,'bytes_removed',9833011,
 'source_occurrences_removed',0,'held_routes_released',0,'immutable_duplicate_groups_retained',1)
where id='af9b4c2b-30a7-4044-8db1-3f3121228467';
commit;
select jsonb_build_object('run_id',id,'status',status,'counts',counts) as artifact_consolidation_verified
from corpus_ingest.runs where id='af9b4c2b-30a7-4044-8db1-3f3121228467';
