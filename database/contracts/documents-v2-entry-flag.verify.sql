-- documents-v2-entry-flag: read-only checks, before and after (release documents-contact-description-as-seal).
-- Counts recorded 2026-10-27 before apply are in the comments; run each block on its own (set local needs a transaction
-- in psql: wrap with begin; ... rollback;).

-- V1 the patch targets match the live refresh exactly once each.
--    before: (1, 1, false, false), (2, 1, false, false)   after: (1, 0, true, true), (2, 0, true, true)
set local statement_timeout = '15s';
with p(i, old) as (values
 (1, $old$case when b.cl_cells is not null and (coalesce((b.cl_cells ->> 'held')::boolean, false)
                                            or coalesce((b.cl_cells ->> 'documents_sealed')::integer, 0) > 0
                                            or b.cl_cells ->> 'description_withheld' is not null) then 'entry_withheld'
           when b.db_cells is not null and b.db_cells ->> 'description_withheld' is not null then 'entry_withheld' end as entry_flag,$old$),
 (2, $old$delete from documents.page_sets s where not exists (select 1 from documents.documents d where d.sha256 = s.sha256) returning 1)$old$)),
d as (select pg_get_functiondef('public.documents_refresh_v1(text)'::regprocedure) def)
select p.i, (select count(*) from regexp_matches(d.def, regexp_replace(regexp_replace(p.old, '([][(){}.*+?^$|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g'), 'g')) old_hits,
       position('documents.source_entry_flag(b.cl_cells, b.db_cells)' in d.def) > 0 uses_helper,
       to_regprocedure('documents.source_entry_flag(jsonb,jsonb)') is not null helper_exists
  from p, d order by 1;

-- V2 withheld documents.
--    before: courtlistener entry_withheld 2 (2 with text), docketbird entry_withheld 60 (0 with text)   after: no rows
set local statement_timeout = '30s';
select source_system, withheld_reason, count(*) n, count(*) filter (where pages_with_text > 0) with_text
  from documents.documents where text_status = 'withheld_policy' group by 1, 2 order by 1, 2;

-- V3 the documents whose published row carries description_withheld = 'contact_or_access_data'.
--    before: courtlistener withheld_policy 2, docketbird withheld_policy 60
--    after refresh: courtlistener pending_index 2 (text_layer 2 after the pages pass), docketbird not_extracted 60
set local statement_timeout = '30s';
select d.source_system, d.text_status, count(*) n
  from documents.documents d
  join public.corpus_records r on r.dataset = split_part(d.published_record, '/', 1)
                              and r.id = substr(d.published_record, strpos(d.published_record, '/') + 1)
 where r.item -> 'cells' ->> 'description_withheld' = 'contact_or_access_data'
 group by 1, 2 order by 1, 2;

-- V4 explicit source flags among listed documents (the only rows the new rule withholds). before and after: no rows
set local statement_timeout = '60s';
select split_part(d.published_record, '/', 1) ds, count(*) n
  from documents.documents d
  join public.corpus_records r on r.dataset = split_part(d.published_record, '/', 1)
                              and r.id = substr(d.published_record, strpos(d.published_record, '/') + 1)
 where (r.dataset = 'sw_docket_entries_v1' and (case when r.item -> 'cells' ->> 'documents_sealed' ~ '^[0-9]{1,9}$'
                                                     then (r.item -> 'cells' ->> 'documents_sealed')::integer else 0 end > 0
                                                or r.item -> 'cells' ->> 'description_withheld' = 'sealed_document'))
    or (r.dataset = 'sw_docket_documents_v1' and r.item -> 'cells' ->> 'restricted' = 'true')
 group by 1;

-- V5 index state integrity. before and after: page_sets 22034 (grows after the pages pass), stale 0, indexed_without_pages 0
set local statement_timeout = '60s';
select count(*) page_sets,
  count(*) filter (where not exists (select 1 from documents.documents d where d.sha256 = s.sha256
                                       and d.text_status in ('text_layer', 'partial_text', 'pending_index'))) stale,
  count(*) filter (where s.pages > 0 and not exists (select 1 from documents.pages p where p.sha256 = s.sha256)) indexed_without_pages
  from documents.page_sets s;

-- V6 posture. after: both rows prosecdef as before (refresh true, helper false), proconfig {search_path=""},
--    anon false, service_role true
select f, p.prosecdef, p.proconfig, has_function_privilege('anon', f, 'execute') anon,
       has_function_privilege('service_role', f, 'execute') service_role
  from unnest(array['public.documents_refresh_v1(text)', 'documents.source_entry_flag(jsonb,jsonb)']) f
  join pg_proc p on p.oid = to_regprocedure(f);
