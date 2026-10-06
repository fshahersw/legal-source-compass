-- corpus-cleanup/1 patch 17: ledgered removal/repoint of the last app-level links into open_us_law (citation_index, limitation_periods). Requires 00-13.
-- Applying this file changes no data. Dry run is the default and needs no gate; a real run needs the matching gate released:
--   open_us_law_citation_links (citation_index) and open_us_law_limitation_links (limitation_periods).
-- citation_index: scope 'non_cfr' (U.S. Code citations; the "Saved law text" link is removed, the citation row stays; house form for no saved text is where = 'Citation only',
--   fact "In this library" = 'Citation only', no "Match to the saved text" fact). scope 'cfr' is a fallback for CFR links the eCFR projection has not repointed (that
--   projection repoints the 703 CFR links itself; run 'cfr' only afterwards, for any that remain). Classification is by the citation text (C.F.R. vs U.S.C.), never by caption.
-- limitation_periods: an oul: link is replaced by a link to the matching statutory_limitations_review record only when exactly one record has the same state, the same
--   claim type and the same section (before any subdivision); otherwise the link is dropped. The quoted sentence and look-up result stay as the historical record.
-- Everything is md5-guarded, archived in corpus_ingest.cleanup_decisions (label_override) and reversible with cleanup_oul_links_rollback_v1(target).

insert into corpus_ingest.cleanup_gates(gate) values ('open_us_law_citation_links'), ('open_us_law_limitation_links') on conflict do nothing;

create or replace function corpus_ingest.cleanup_citation_oul_links_v1(p_scope text, p_dry boolean default true, p_limit integer default 2000) returns jsonb
language plpgsql set search_path = '' as $$
declare run uuid := corpus_ingest.cleanup_run_v1(); n_cand bigint; n_upd bigint := 0; remaining bigint; sample jsonb; v_issue constant text := 'cleanup_20261006_citation_oul_link';
begin
  if p_scope not in ('non_cfr', 'cfr') then raise exception 'Unknown scope' using errcode = '22023'; end if;
  if p_limit < 1 or p_limit > 5000 then raise exception 'p_limit must be 1..5000' using errcode = '22023'; end if;
  if not p_dry and not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_citation_links' and g.released) then
    raise exception 'Gate open_us_law_citation_links is not released' using errcode = '42501';
  end if;
  create temp table if not exists _cit(id text primary key, row_md5 text, old_item jsonb, old_detail jsonb, new_item jsonb, new_detail jsonb) on commit drop;
  truncate _cit;
  insert into _cit
  select r.id, md5(to_jsonb(r)::text), r.item, r.detail,
         jsonb_set(jsonb_set(r.item, '{links}', coalesce((select jsonb_agg(l) from jsonb_array_elements(r.item->'links') l where (l->>'url') not like '#record/oul:%'), '[]'::jsonb)),
                   '{cells}', (r.item->'cells') || jsonb_build_object('where', 'Citation only')),
         jsonb_set(jsonb_set(r.detail, '{links}', coalesce((select jsonb_agg(l) from jsonb_array_elements(r.detail->'links') l where (l->>'url') not like '#record/oul:%'), '[]'::jsonb)),
                   '{facts}', coalesce((select jsonb_agg(case when f->>0 = 'In this library' then jsonb_build_array('In this library', 'Citation only') else f end)
                                          from jsonb_array_elements(r.detail->'facts') f where f->>0 <> 'Match to the saved text'), '[]'::jsonb))
  from public.corpus_records r
  where r.dataset = 'citation_index' and r.item::text ~ '#record/oul:[0-9a-f]{32}'
    and ((p_scope = 'cfr' and r.item->'cells'->>'citation' ~ 'C\.F\.R\.') or (p_scope = 'non_cfr' and r.item->'cells'->>'citation' !~ 'C\.F\.R\.'))
    and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.dataset = 'citation_index' and d.record_id = r.id and d.issue = v_issue)
  order by r.ordinal, r.id limit p_limit;
  select count(*) into n_cand from _cit;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'citation', (c.old_item->'cells'->>'citation'), 'where_after', c.new_item->'cells'->>'where')), '[]'::jsonb) into sample from (select * from _cit order by id limit 3) c;
  if not p_dry then
    insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
      select 'citation_index', c.id, v_issue, 'label_override', 'Dangling link to a deleted open_us_law record removed; the citation row stays with no saved law text',
             jsonb_build_object('scope', p_scope, 'version', 'citation-oul-link/2026-10-06.1'), jsonb_build_object('item', c.old_item, 'detail', c.old_detail, 'row_md5', c.row_md5),
             jsonb_build_object('item_md5', md5(c.new_item::text), 'detail_md5', md5(c.new_detail::text)), run from _cit c on conflict (dataset, record_id, issue) do nothing;
    update public.corpus_records r set item = c.new_item, detail = c.new_detail from _cit c where r.dataset = 'citation_index' and r.id = c.id and md5(to_jsonb(r)::text) = c.row_md5;
    get diagnostics n_upd = row_count;
  end if;
  select count(*) into remaining from public.corpus_records r where r.dataset = 'citation_index' and r.item::text ~ '#record/oul:[0-9a-f]{32}'
    and ((p_scope = 'cfr' and r.item->'cells'->>'citation' ~ 'C\.F\.R\.') or (p_scope = 'non_cfr' and r.item->'cells'->>'citation' !~ 'C\.F\.R\.'));
  return jsonb_build_object('scope', p_scope, 'dry_run', p_dry, 'candidates_this_call', n_cand, 'updated', n_upd, 'remaining_with_link', remaining, 'sample', sample);
end $$;
revoke all on function corpus_ingest.cleanup_citation_oul_links_v1(text, boolean, integer) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_citation_oul_links_v1(text, boolean, integer) to service_role;

create or replace function corpus_ingest.cleanup_limitation_oul_links_v1(p_dry boolean default true) returns jsonb
language plpgsql set search_path = '' as $$
declare run uuid := corpus_ingest.cleanup_run_v1(); n_cand bigint; n_repoint bigint; n_drop bigint; n_upd bigint := 0; v_issue constant text := 'cleanup_20261006_limitation_oul_link';
begin
  if not p_dry and not exists (select 1 from corpus_ingest.cleanup_gates g where g.gate = 'open_us_law_limitation_links' and g.released) then
    raise exception 'Gate open_us_law_limitation_links is not released' using errcode = '42501';
  end if;
  create temp table if not exists _lim(id text primary key, row_md5 text, old_item jsonb, old_detail jsonb, new_item jsonb, new_detail jsonb, target text) on commit drop;
  truncate _lim;
  with base as (
    select r.*, md5(to_jsonb(r)::text) as row_md5, lower(btrim(regexp_replace(regexp_replace(coalesce(r.item->'cells'->>'section', ''), '\(.*$', ''), '\s+', ' ', 'g'), ' .')) as sec,
           case r.detail->'facts'->1->>1 when 'Personal injury' then 'personal_injury' when 'Wrongful death' then 'wrongful_death' when 'Medical malpractice' then 'medical_malpractice' when 'Product liability' then 'product_liability' end as ctype
      from public.corpus_records r where r.dataset = 'limitation_periods' and r.item::text ~ '#record/oul:[0-9a-f]{32}'),
  match as (
    select b.id, (array_agg(s.id))[1] as target, count(*) as n, (array_agg(s.item->'cells'->>'pinpoint'))[1] as pinpoint
      from base b join public.corpus_records s on s.dataset = 'statutory_limitations_review' and s.state = b.state and s.item->'cells'->>'claim_type' = b.ctype
        and lower(btrim(regexp_replace(regexp_replace(coalesce(s.item->'cells'->>'pinpoint', ''), '\(.*$', ''), '\s+', ' ', 'g'), ' .')) = b.sec
     group by b.id)
  insert into _lim
  select b.id, b.row_md5, b.item, b.detail,
         jsonb_set(b.item, '{links}', coalesce((select jsonb_agg(l) from jsonb_array_elements(b.item->'links') l where (l->>'url') not like '#record/oul:%'), '[]'::jsonb)
             || case when m.n = 1 then jsonb_build_array(jsonb_build_object('url', '#record/statutory_limitations_review/' || replace(m.target, ':', '%3A'), 'label', 'Open ' || (b.item->'cells'->>'section') || ' in the cited rule review (primary source)')) else '[]'::jsonb end),
         jsonb_set(jsonb_set(b.detail, '{links}', coalesce((select jsonb_agg(l) from jsonb_array_elements(b.detail->'links') l where (l->>'url') not like '#record/oul:%'), '[]'::jsonb)
             || case when m.n = 1 then jsonb_build_array(jsonb_build_object('url', '#record/statutory_limitations_review/' || replace(m.target, ':', '%3A'), 'label', 'Open ' || (b.item->'cells'->>'section') || ' in the cited rule review (primary source)')) else '[]'::jsonb end),
                   '{facts}', coalesce(b.detail->'facts', '[]'::jsonb) || case when m.n = 1 then jsonb_build_array(jsonb_build_array('Primary-source rule review', m.pinpoint || ' (statutory_limitations_review)')) else '[]'::jsonb end),
         case when m.n = 1 then m.target end
    from base b left join match m on m.id = b.id;
  select count(*), count(*) filter (where target is not null), count(*) filter (where target is null) into n_cand, n_repoint, n_drop from _lim;
  if not p_dry then
    insert into corpus_ingest.cleanup_decisions(dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
      select 'limitation_periods', c.id, v_issue, 'label_override', 'Link to a deleted open_us_law record replaced by the exactly matching primary-source rule review, or dropped when none matches uniquely',
             jsonb_build_object('target', c.target, 'version', 'limitation-oul-link/2026-10-06.1'), jsonb_build_object('item', c.old_item, 'detail', c.old_detail, 'row_md5', c.row_md5),
             jsonb_build_object('item_md5', md5(c.new_item::text), 'detail_md5', md5(c.new_detail::text)), run from _lim c on conflict (dataset, record_id, issue) do nothing;
    update public.corpus_records r set item = c.new_item, detail = c.new_detail from _lim c where r.dataset = 'limitation_periods' and r.id = c.id and md5(to_jsonb(r)::text) = c.row_md5;
    get diagnostics n_upd = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry, 'candidates', n_cand, 'repoint_to_rule_review', n_repoint, 'drop_link', n_drop, 'updated', n_upd,
    'remaining_with_link', (select count(*) from public.corpus_records r where r.dataset = 'limitation_periods' and r.item::text ~ '#record/oul:[0-9a-f]{32}'));
end $$;
revoke all on function corpus_ingest.cleanup_limitation_oul_links_v1(boolean) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_limitation_oul_links_v1(boolean) to service_role;

create or replace function corpus_ingest.cleanup_oul_links_rollback_v1(p_target text) returns jsonb language plpgsql set search_path = '' as $$
declare v_issue text; n bigint;
begin
  v_issue := case p_target when 'citation_index' then 'cleanup_20261006_citation_oul_link' when 'limitation_periods' then 'cleanup_20261006_limitation_oul_link' end;
  if v_issue is null then raise exception 'Unknown target' using errcode = '22023'; end if;
  update public.corpus_records r set item = d.original_record->'item', detail = d.original_record->'detail'
    from corpus_ingest.cleanup_decisions d
   where d.dataset = p_target and d.issue = v_issue and r.dataset = d.dataset and r.id = d.record_id
     and md5(r.item::text) = d.replacement->>'item_md5' and md5(r.detail::text) = d.replacement->>'detail_md5';
  get diagnostics n = row_count;
  return jsonb_build_object('target', p_target, 'restored', n);
end $$;
revoke all on function corpus_ingest.cleanup_oul_links_rollback_v1(text) from public, anon, authenticated;
grant execute on function corpus_ingest.cleanup_oul_links_rollback_v1(text) to service_role;

create or replace function public.corpus_admin_cleanup_v1(p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid; ph text := p_args->>'phase';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_op = 'open_run' then
    insert into corpus_ingest.runs(id, status, scope)
    select gen_random_uuid(), 'running', jsonb_build_object('contract', 'corpus-cleanup/1',
      'purpose', 'taxonomy and useless-row cleanup, then exact/native-ID de-duplication; reversible via corpus_ingest.cleanup_decisions',
      'owner_instruction', '2026-10-06: corpus development resumes; remove gaps/duplicates/useless data/unnecessary taxonomy',
      'excluded', jsonb_build_array('open_us_law','cpsc_injury_data','matter PDFs','held collections (not released or overwritten)','people/judge merges','MDL membership changes'))
    where not exists (select 1 from corpus_ingest.runs where scope->>'contract' = 'corpus-cleanup/1' and status in ('running','partial'));
    return jsonb_build_object('run', corpus_ingest.cleanup_run_v1());
  end if;
  run := corpus_ingest.cleanup_run_v1();
  if p_op = 'plan' then return corpus_ingest.cleanup_plan_step_v1(p_args->>'step', p_args);
  elsif p_op = 'counts' then return corpus_ingest.cleanup_capture_counts_v1(run, ph, p_args->>'stage');
  elsif p_op = 'apply' then return corpus_ingest.cleanup_apply_v1(run, ph, coalesce((p_args->>'limit')::int, 1000), coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'fix_counters' then return corpus_ingest.cleanup_fix_counters_v1(run, ph);
  elsif p_op = 'rollback' then return corpus_ingest.cleanup_rollback_v1(run, ph, coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'status' then
    return jsonb_build_object('run', run, 'plan', coalesce((select jsonb_agg(x) from (select phase, action, status, status_note, count(*) as n from corpus_ingest.cleanup_plan where run_id = run group by 1,2,3,4 order by 1,2,3,4) x), '[]'::jsonb),
      'counts', coalesce((select jsonb_agg(c order by phase, dataset, stage) from (select phase, stage, dataset, rows, id_md5 from corpus_ingest.cleanup_counts where run_id = run) c), '[]'::jsonb),
      'ledger', coalesce((select jsonb_agg(l) from (select issue, disposition, count(*) as n from corpus_ingest.cleanup_decisions where run_id = run group by 1,2 order by 1,2) l), '[]'::jsonb));
  elsif p_op = 'plan_sample' then
    return coalesce((select jsonb_agg(x) from (select action, dataset, record_id, survivor_id, status, status_note, reason from corpus_ingest.cleanup_plan where run_id = run and phase = ph order by seq limit coalesce((p_args->>'limit')::int, 50)) x), '[]'::jsonb);
  elsif p_op = 'ledger_export' then
    return coalesce((select jsonb_agg(x) from (select dataset, record_id, issue, disposition, reason, evidence, original_record, replacement from corpus_ingest.cleanup_decisions
      where run_id = run and issue = coalesce(p_args->>'issue', issue) order by dataset, record_id limit coalesce((p_args->>'limit')::int, 1000) offset coalesce((p_args->>'offset')::int, 0)) x), '[]'::jsonb);
  elsif p_op = 'verify' then
    return jsonb_build_object('applied_without_ledger', (select count(*) from corpus_ingest.cleanup_plan p where p.run_id = run and p.status = 'applied'
          and not exists (select 1 from corpus_ingest.cleanup_decisions d where d.run_id = p.run_id and d.dataset = p.dataset and d.record_id = p.record_id and d.issue = 'cleanup_20261006_' || p.action)),
      'counter_mismatch', (select count(*) from public.corpus_datasets d where d.imported_records is distinct from (select count(*) from public.corpus_records r where r.dataset = d.id)),
      'docket_links_missing_source', (select count(*) from public.corpus_workspace_docket_links l where not exists (select 1 from public.corpus_records r where r.dataset = l.source_dataset and r.id = l.source_record_id)));
  elsif p_op = 'delete_open_us_law_batch' then
    return corpus_ingest.cleanup_delete_open_us_law_batch_v1(coalesce((p_args->>'limit')::int, 1000));
  elsif p_op = 'strip_oul_links' then
    return corpus_ingest.cleanup_strip_oul_links_v1(p_args->>'scope');
  elsif p_op = 'strip_oul_links_rollback' then
    return jsonb_build_object('restored', corpus_ingest.cleanup_strip_oul_links_rollback_v1());
  elsif p_op = 'carry_over' then
    return corpus_ingest.cleanup_carry_over_v1(p_args->>'merge', coalesce((p_args->>'limit')::int, 2000));
  elsif p_op = 'carry_over_rollback' then
    return corpus_ingest.cleanup_carry_over_rollback_v1(p_args->>'merge');
  elsif p_op = 'citation_oul_links' then
    return corpus_ingest.cleanup_citation_oul_links_v1(p_args->>'scope', coalesce((p_args->>'dry')::boolean, true), coalesce((p_args->>'limit')::int, 2000));
  elsif p_op = 'limitation_oul_links' then
    return corpus_ingest.cleanup_limitation_oul_links_v1(coalesce((p_args->>'dry')::boolean, true));
  elsif p_op = 'oul_links_rollback' then
    return corpus_ingest.cleanup_oul_links_rollback_v1(p_args->>'target');
  elsif p_op = 'schema_probe' then
    return jsonb_build_object('corpus_ingest_tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'corpus_ingest' and c.relkind = 'r'),
      'category_map_rows', (select count(*) from corpus_ingest.category_map), 'runs', (select count(*) from corpus_ingest.runs), 'entities', (select count(*) from corpus_ingest.entities));
  end if;
  raise exception 'Unknown operation' using errcode = '22023';
end $$;



revoke all on function public.corpus_admin_cleanup_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.corpus_admin_cleanup_v1(text, jsonb) to service_role;
