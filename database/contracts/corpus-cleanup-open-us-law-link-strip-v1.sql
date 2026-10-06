-- corpus-cleanup/1 patch 11: ledgered strip of `#record/oul:` links from corpus_context, and null-out of dangling limitation-period record ids.
-- Owner decision 2026-10-06: the 2,649 generic:extra blocks stay (their citations are independent); only the link to an open_us_law record is removed.
-- Applying this file only defines functions and a closed gate; nothing is changed. At deletion time (after the dependents are repointed) the owner releases gate
-- 'open_us_law_link_strip' and the strip runs through the RPC op strip_oul_links (scope generic:extra | related:blocks). Both scopes are md5-guarded, archive the
-- original `data` in corpus_ingest.cleanup_decisions (label_override) and have an exact rollback (corpus_ingest.cleanup_strip_oul_links_rollback_v1).

create or replace function corpus_ingest.strip_oul_links_v1(j jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text; v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if k = 'links' and jsonb_typeof(v) = 'array' then
        r := r || jsonb_build_object(k, (select coalesce(jsonb_agg(corpus_ingest.strip_oul_links_v1(e)), '[]'::jsonb) from jsonb_array_elements(v) e
                                          where not (jsonb_typeof(e) = 'object' and (e->>'url') like '#record/oul:%')));
      else
        r := r || jsonb_build_object(k, corpus_ingest.strip_oul_links_v1(v));
      end if;
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(corpus_ingest.strip_oul_links_v1(e)) from jsonb_array_elements(j) e), '[]'::jsonb);
  end if;
  return j;
end $$;
revoke all on function corpus_ingest.strip_oul_links_v1(jsonb) from public, anon, authenticated;
grant execute on function corpus_ingest.strip_oul_links_v1(jsonb) to service_role;


create or replace function corpus_ingest.strip_oul_links_v1(j jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text; v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if k = 'links' and jsonb_typeof(v) = 'array' then
        r := r || jsonb_build_object(k, (select coalesce(jsonb_agg(corpus_ingest.strip_oul_links_v1(e)), '[]'::jsonb) from jsonb_array_elements(v) e
                                          where not (jsonb_typeof(e) = 'object' and (e->>'url') like '#record/oul:%')));
      else
        r := r || jsonb_build_object(k, corpus_ingest.strip_oul_links_v1(v));
      end if;
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(corpus_ingest.strip_oul_links_v1(e)) from jsonb_array_elements(j) e), '[]'::jsonb);
  end if;
  return j;
end $$;
revoke all on function corpus_ingest.strip_oul_links_v1(jsonb) from public, anon, authenticated;
grant execute on function corpus_ingest.strip_oul_links_v1(jsonb) to service_role;

insert into corpus_ingest.cleanup_gates(gate) values ('open_us_law_link_strip') on conflict do nothing;

-- scope 'generic:extra' (expected 2,649 rows): remove only link objects whose url starts with '#record/oul:'; citations and titles are untouched.
-- scope 'related:blocks' (expected 98 rows): preferred path is regeneration with the re-sourced official record ids (limitations release 2026-10-06.1);
--   fallback here sets limitation_periods.rows[].record_id = null where it starts with 'oul:' ("Not recorded"; nothing is invented).
create or replace function corpus_ingest.cleanup_strip_oul_links_v1(p_scope text) returns jsonb language plpgsql set search_path = '' as $$
declare run uuid := corpus_ingest.cleanup_run_v1(); v_issue text; n_cand bigint; n_audit bigint; n_upd bigint; still bigint;
begin
  if not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_link_strip' and g.released) then
    raise exception 'Gate open_us_law_link_strip is not released' using errcode = '42501';
  end if;
  if p_scope not in ('generic:extra', 'related:blocks') then raise exception 'Unknown scope' using errcode = '22023'; end if;
  v_issue := case p_scope when 'generic:extra' then 'cleanup_20261006_strip_oul_link' else 'cleanup_20261006_null_oul_record_id' end;
  create temp table if not exists _strip_target(key text primary key, row_md5 text, old_data jsonb, new_data jsonb) on commit drop;
  truncate _strip_target;
  if p_scope = 'generic:extra' then
    insert into _strip_target select c.key, md5(to_jsonb(c)::text), c.data, corpus_ingest.strip_oul_links_v1(c.data)
      from public.corpus_context c where c.key like 'generic:extra:%' and c.data::text like '%#record/oul:%';
  else
    insert into _strip_target select c.key, md5(to_jsonb(c)::text), c.data,
        jsonb_set(c.data, '{limitation_periods,rows}', (select coalesce(jsonb_agg(case when (r->>'record_id') like 'oul:%' then jsonb_set(r, '{record_id}', 'null'::jsonb) else r end), '[]'::jsonb) from jsonb_array_elements(c.data->'limitation_periods'->'rows') r))
      from public.corpus_context c where c.key like 'related:blocks:state:%' and jsonb_typeof(c.data->'limitation_periods'->'rows') = 'array' and c.data::text ~ 'oul:[0-9a-f]{32}';
  end if;
  select count(*) into n_cand from _strip_target;
  insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
    select 'public.corpus_context', t.key, v_issue, 'label_override',
           case p_scope when 'generic:extra' then 'Owner decision 2026-10-06: remove only the #record/oul: link; the cited authorities are independent content'
                        else 'Dangling oul: record id of a deleted open_us_law record set to null (Not recorded); no replacement id exists yet' end,
           jsonb_build_object('version', 'oul-link-strip/2026-10-06.1', 'scope', p_scope),
           jsonb_build_object('data', t.old_data, 'row_md5', t.row_md5), jsonb_build_object('data_md5', md5(t.new_data::text)), run
      from _strip_target t on conflict (dataset, record_id, issue) do nothing;
  get diagnostics n_audit = row_count;
  update public.corpus_context c set data = t.new_data from _strip_target t
   where c.key = t.key and md5(to_jsonb(c)::text) = t.row_md5
     and exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'public.corpus_context' and d.record_id = t.key and d.issue = v_issue and d.original_record->>'row_md5' = t.row_md5);
  get diagnostics n_upd = row_count;
  select count(*) into still from public.corpus_context c where c.key like p_scope || '%' and c.data::text ~ 'oul:[0-9a-f]{32}';
  return jsonb_build_object('scope', p_scope, 'candidates', n_cand, 'audit_rows_written', n_audit, 'updated', n_upd, 'still_referencing', still);
end $$;
revoke all on function corpus_ingest.cleanup_strip_oul_links_v1(text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_strip_oul_links_v1(text) to service_role;

-- exact rollback: only rows still carrying the projected value are restored
create or replace function corpus_ingest.cleanup_strip_oul_links_rollback_v1() returns bigint language plpgsql set search_path = '' as $$
declare n bigint;
begin
  update public.corpus_context c set data = d.original_record->'data'
    from corpus_ingest.cleanup_decisions d
   where d.dataset = 'public.corpus_context' and d.issue in ('cleanup_20261006_strip_oul_link', 'cleanup_20261006_null_oul_record_id')
     and c.key = d.record_id and md5(c.data::text) = d.replacement->>'data_md5';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function corpus_ingest.cleanup_strip_oul_links_rollback_v1() from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_strip_oul_links_rollback_v1() to service_role;
