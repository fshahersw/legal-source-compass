-- Rollback of documents-v2-entry-flag.sql: public.documents_refresh_v1 again sets entry_flag on any description_withheld
-- value or cells.held = true and keeps page_sets of every listed document (the documents-v1 rule as live before
-- 2026-10-27), and documents.source_entry_flag is dropped when no other function calls it. Run
-- public.documents_refresh_v1('<build>') afterwards to rebuild the rows. Idempotent: a second run changes nothing.

begin;

do $rollback$
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
  v_hits integer;
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_hits := (length(v_def) - length(replace(v_def, v_pairs[i][2], ''))) / length(v_pairs[i][2]);
    if v_hits = 0 then
      raise notice 'documents_refresh_v1: change % not in place; nothing to restore', i;
    elsif v_hits > 1 then
      raise exception 'documents_refresh_v1: change %: expected one occurrence, found %', i, v_hits;
    else
      v_def := replace(v_def, v_pairs[i][2], v_pairs[i][1]);
    end if;
  end loop;
  if v_def is distinct from v_orig then
    execute v_def;
  end if;
  if not exists (select 1 from pg_proc p where p.prosrc like '%documents.source_entry_flag(%') then
    drop function if exists documents.source_entry_flag(jsonb, jsonb);
  else
    raise notice 'documents.source_entry_flag kept: another function still calls it';
  end if;
end $rollback$;

revoke all on function public.documents_refresh_v1(text) from public, anon, authenticated;
grant execute on function public.documents_refresh_v1(text) to service_role;

commit;
