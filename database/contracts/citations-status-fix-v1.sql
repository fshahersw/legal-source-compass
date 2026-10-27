-- citations-status-fix-v1.sql: fixes the case-law resolver check in the citations contract (citations-v2.sql).
--
-- citations-v2.sql probes to_regprocedure('public.caselaw_resolve_v2(text)'), but caselaw-v2.sql defines the resolver as
-- public.caselaw_resolve_v2(p_citation text, p_year integer, p_court text) returning one jsonb object. The probe never
-- matches, so citations_status_v2 reports the resolver absent and case authorities fall back to the exact cite_keys
-- lookup (no reporter-alias step). This contract:
--   * citations.call_resolver: probes the real signature first and calls it with one citation (year and court null).
--     Its answer is normalised for citations.read_resolver: 'unresolved/not_held' reads as not_in_corpus, ambiguous
--     candidates become cluster ids (as the cite_keys path writes them, at most 10), and a text the case-law parser does
--     not read as a citation ('not_a_citation', e.g. a Westlaw "WL" cite) answers {"present": false}, so resolve_key keeps
--     its exact cite_keys path and reason for it. The older one-argument, set-returning form is still accepted.
--   * public.citations_status_v2: reports the resolver present when either form is installed.
-- Every other branch is unchanged. Idempotent; apply after citations-v2.sql (and caselaw-v2.sql where installed).
-- ORDERING: citations-v2.sql redefines both functions with the old probe, so every later apply of citations-v2.sql
-- silently reverts this fix. Re-apply this file after each apply of citations-v2.sql, until the probe and the
-- normalisation are folded into citations-v2.sql itself (then this file is a no-op and can be retired).
-- Rows already resolved are not changed by this file; re-resolving case authorities is a separate, deliberate step.

create or replace function citations.call_resolver(p_fn text, p_a text, p_b text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_one jsonb;
begin
  if p_fn = 'caselaw_resolve_v2' then
    if to_regprocedure('public.caselaw_resolve_v2(text,integer,text)') is not null then
      begin
        execute 'select public.caselaw_resolve_v2($1, null::integer, null::text)' into v_one using p_a;
      exception when others then return jsonb_build_object('present', true, 'error', left(sqlerrm, 200));
      end;
      if v_one is null or jsonb_typeof(v_one) <> 'object' then
        return jsonb_build_object('present', true, 'rows', '[]'::jsonb);
      end if;
      if v_one ->> 'status' = 'unresolved' and v_one ->> 'reason' = 'not_a_citation' then
        return jsonb_build_object('present', false);
      end if;
      if v_one ->> 'status' = 'unresolved' and v_one ->> 'reason' = 'not_held' then
        v_one := jsonb_set(v_one, '{status}', to_jsonb('not_in_corpus'::text));
      elsif v_one ->> 'status' = 'ambiguous' then
        v_one := jsonb_set(v_one, '{candidates}', coalesce(
          (select jsonb_agg(e.c ->> 'cluster_id' order by e.i)
             from jsonb_array_elements(coalesce(v_one -> 'candidates', '[]'::jsonb)) with ordinality e(c, i)
            where e.i <= 10 and e.c ->> 'cluster_id' is not null), '[]'::jsonb));
      end if;
      return jsonb_build_object('present', true, 'rows', jsonb_build_array(v_one));
    end if;
    if to_regprocedure('public.caselaw_resolve_v2(text)') is null then return jsonb_build_object('present', false); end if;
    begin
      execute 'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from public.caselaw_resolve_v2($1) r' into v using p_a;
    exception when others then return jsonb_build_object('present', true, 'error', left(sqlerrm, 200));
    end;
  elsif p_fn in ('state_law_resolve_v1', 'state_reg_resolve_v1') then
    if to_regprocedure('public.' || p_fn || '(text,text)') is null then return jsonb_build_object('present', false); end if;
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from public.%I($1, $2) r', p_fn) into v using p_a, p_b;
    exception when others then return jsonb_build_object('present', true, 'error', left(sqlerrm, 200));
    end;
  else
    raise exception 'Unknown resolver' using errcode = '22023';
  end if;
  return jsonb_build_object('present', true, 'rows', v);
end $$;

create or replace function public.citations_status_v2() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pages_extracted', (select count(*) from citations.page_state),
    'pages_by_version', (select coalesce(jsonb_object_agg(extractor_version, n), '{}'::jsonb) from
                          (select extractor_version, count(*) n from citations.page_state group by 1) s),
    'byte_sets_extracted', (select count(distinct src_id) from citations.page_state),
    'byte_sets_indexed', (select count(*) from documents.page_sets where status = 'indexed'),
    'occurrences', (select count(*) from citations.occurrences),
    'occurrences_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from citations.occurrences group by 1) s),
    'authorities', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select kind || ':' || resolution k, count(*) n from citations.authorities group by 1) s),
    'unresolved_reasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
                            (select kind || ':' || coalesce(reason, '') k, count(*) n from citations.authorities
                              where resolution in ('unresolved', 'not_in_corpus', 'ambiguous') group by 1) s),
    'edges', (select count(*) from citations.edges),
    'documents_with_edges', (select count(distinct citing_id) from citations.edges),
    'index_rows', jsonb_build_object('fr', (select count(*) from citations.fr_index), 'pl', (select count(*) from citations.pl_index)),
    'resolvers', jsonb_build_object('caselaw_resolve_v2', (to_regprocedure('public.caselaw_resolve_v2(text,integer,text)') is not null
                                                           or to_regprocedure('public.caselaw_resolve_v2(text)') is not null),
                                    'state_law_resolve_v1', to_regprocedure('public.state_law_resolve_v1(text,text)') is not null,
                                    'state_reg_resolve_v1', to_regprocedure('public.state_reg_resolve_v1(text,text)') is not null),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) - 'rejected' order by r.started_at desc), '[]'::jsonb) from
              (select * from citations.runs order by started_at desc limit 10) r),
    'bytes', jsonb_build_object('occurrences', pg_total_relation_size('citations.occurrences'), 'edges', pg_total_relation_size('citations.edges'),
                                'authorities', pg_total_relation_size('citations.authorities'), 'page_state', pg_total_relation_size('citations.page_state')))
$$;

do $grants$
declare f text;
begin
  foreach f in array array['public.citations_status_v2()', 'citations.call_resolver(text,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;
