-- documents/2 entry flag — the documents layer withholds a filing's text only on an explicit flag from the docket source
-- itself (owner decision 2026-10-27: "dont withhold any data. If its accurate and valuable, USE IT").
-- Apply order: documents-v1.sql, documents-v2-scope.sql, documents-v2-sources.sql, then this file LAST. Each of those
-- three redefines public.documents_refresh_v1 with the old inline rule (and so do their rollbacks); this file patches
-- whichever definition is live. Re-apply this file after any of them, or any of their rollbacks, runs, and check V1 of
-- documents-v2-entry-flag.verify.sql after every documents-v2-* apply: otherwise the next refresh (including the nightly
-- job) re-withholds the 62 filings.
-- Today the explicit source holds are enforced upstream as well: the sw_* projections leave out DocketBird documents that
-- are restricted and give CourtListener entries with a sealed document no document ids, and _doc_out excludes bytes with
-- a provider seal / restriction / policy flag or a local seal. documents.source_entry_flag is the guard for the case
-- where a projection carries such a row.
--
-- Before: documents_refresh_v1 set entry_flag = 'entry_withheld' (text_status 'withheld_policy') whenever the published
-- docket row had description_withheld set, whatever its value, or cells.held = true. Our own projections
-- (scripts/ingest/members-entry-record.mjs, scripts/ingest/gap-fill/project-docketbird-documents.mjs) set
-- description_withheld = 'contact_or_access_data' when a description carries a phone, email or hearing dial-in, and
-- 'sealed_or_restricted_text' (with held = true) when it merely contains a sealing word. Neither is a court or provider
-- flag, yet both withheld the filing's text and the UI told readers the docket source had sealed it. Live on 2026-10-27:
-- 62 documents (60 DocketBird, 2 CourtListener), every one labelled 'contact_or_access_data'.
-- Now (documents.source_entry_flag): the flag is set only when
--   * a CourtListener entry reports a sealed document: cells.documents_sealed > 0 (RECAP is_sealed = true), or
--     cells.description_withheld = 'sealed_document', which the projection sets exactly in that case;
--   * a DocketBird document row reports the provider's restriction: cells.restricted = true.
-- Second change, so released text actually becomes searchable: the refresh drops documents.page_sets with the pages
-- (bytes no text_layer / partial_text / pending_index document serves). Before, a withheld document kept its page_sets row
-- while its pages were deleted, and on release it was marked 'text_layer' with no pages indexed.
-- Unchanged: bytes with an explicit seal / restriction / policy flag on any association, or a local
-- 'locally_flagged_sealed' occurrence, stay out of the layer (_doc_out); the same-bytes rule (one source-withheld
-- listing withholds every listing of those bytes); exact links only; "Not recorded" for missing metadata.
-- Released text is indexed by the next documents_build_pages_v1 pass (text_status 'pending_index' until then; a
-- DocketBird PDF with no stored text becomes 'not_extracted'). The description itself stays as the sw_* row publishes it
-- (null for these rows until workstream de-dockets republishes the descriptions), so such titles read "Not recorded".
-- Rollback: documents-v2-entry-flag.rollback.sql. Tests: src/lib/documents/contract.test.mjs (offline PGlite).
-- Posture: search_path = '', revoked from public/anon/authenticated, granted to service_role; the refresh stays
-- SECURITY DEFINER (create or replace from its own pg_get_functiondef). Idempotent: a second run changes nothing.

begin;

-- Same definition as documents-v1.sql.
create or replace function documents.source_entry_flag(p_cl jsonb, p_db jsonb) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_cl is not null and (case when p_cl ->> 'documents_sealed' ~ '^[0-9]{1,9}$' then (p_cl ->> 'documents_sealed')::integer else 0 end > 0
                               or p_cl ->> 'description_withheld' = 'sealed_document') then 'entry_withheld'
    when p_db is not null and p_db ->> 'restricted' = 'true' then 'entry_withheld'
  end
$$;
revoke all on function documents.source_entry_flag(jsonb, jsonb) from public, anon, authenticated;
grant execute on function documents.source_entry_flag(jsonb, jsonb) to service_role;

-- Exact replacements inside the live public.documents_refresh_v1. Each old text must occur exactly once (any run of
-- whitespace matches any other) unless its new text is already there; otherwise the file aborts and nothing changes.
do $patch$
declare
  v_pairs constant text[][] := array[
    [$old$case when b.cl_cells is not null and (coalesce((b.cl_cells ->> 'held')::boolean, false)
                                            or coalesce((b.cl_cells ->> 'documents_sealed')::integer, 0) > 0
                                            or b.cl_cells ->> 'description_withheld' is not null) then 'entry_withheld'
           when b.db_cells is not null and b.db_cells ->> 'description_withheld' is not null then 'entry_withheld' end as entry_flag,$old$,
     $new$documents.source_entry_flag(b.cl_cells, b.db_cells) as entry_flag,$new$],
    [$old$delete from documents.page_sets s where not exists (select 1 from documents.documents d where d.sha256 = s.sha256) returning 1)$old$,
     $new$delete from documents.page_sets s where not exists (select 1 from documents.documents d where d.sha256 = s.sha256 and d.text_status in ('text_layer', 'partial_text', 'pending_index')) returning 1)$new$]];
  v_def text := pg_get_functiondef('public.documents_refresh_v1(text)'::regprocedure);
  v_orig text := v_def;
  v_pat text;
  v_hits integer;
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    if position(v_pairs[i][2] in v_def) > 0 then
      raise notice 'documents_refresh_v1: change % already in place', i;
      continue;
    end if;
    v_pat := regexp_replace(regexp_replace(v_pairs[i][1], '([][(){}.*+?^$|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g');
    select count(*) into v_hits from regexp_matches(v_def, v_pat, 'g');
    if v_hits <> 1 then
      raise exception 'documents_refresh_v1: change %: expected exactly one old text, found %', i, v_hits;
    end if;
    v_def := regexp_replace(v_def, v_pat, replace(v_pairs[i][2], '\', '\\'));
  end loop;
  if v_def is distinct from v_orig then
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.documents_refresh_v1(text)'::regprocedure);
  for i in 1 .. array_length(v_pairs, 1) loop
    if position(v_pairs[i][2] in v_def) = 0 then
      raise exception 'documents_refresh_v1: change % was not applied', i;
    end if;
  end loop;
end $patch$;

-- One-time cleanup under the second change: index state left by the old refresh for bytes no indexable document serves
-- (0 rows live on 2026-10-27; derived rows of this schema only, rebuilt by documents_build_pages_v1).
delete from documents.page_sets s
 where not exists (select 1 from documents.documents d where d.sha256 = s.sha256
                     and d.text_status in ('text_layer', 'partial_text', 'pending_index'));

-- create or replace keeps the owner and grants; restate the posture anyway
revoke all on function public.documents_refresh_v1(text) from public, anon, authenticated;
grant execute on function public.documents_refresh_v1(text) to service_role;

commit;
