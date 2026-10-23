-- insights/1 family "state_regs" (worker REGS, wave 1025): state register issues listed per state and year, and the
-- state administrative code rules held with their official text. Registration only; nothing in insights-v1.sql changes.
--
-- Apply AFTER database/contracts/insights-v1.sql and database/contracts/state-regs-v1.sql. Idempotent (family and
-- metric rows upserted by id; functions create or replace). Then:  select insights.refresh_state_regs('initial');
-- The family reads corpus dataset state_register_issues, so the weekly register ingest (public.ingest_refresh_insights_v1
-- → insights.refresh_for_datasets) re-runs it after new issues land.
--
-- Rules (insights/1): every value is a count of records as published (issues the register's own listing shows; rules
-- whose official text is held); a state without records has no fact (not zero); facts only for states in the spine.

begin;

insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('state_regs', 130, array['state_register_issues'], '{}',
   'State register issues and state administrative code rules held from the official publishers')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
('state_register_issues_listed', 'state_regs', 13000, 'State register issues listed',
 'Issues of the state''s official register (rulemaking bulletin) dated in the year, as listed on the register publisher''s own issue list.',
 'issues', 'count', 'law', array['state'], 'year', array['state_register_issues'],
 '[{"label": "State register publishers (see each issue''s official address)", "url": "https://www.sos.texas.gov/texreg/index.shtml"}]',
 'Issues in state_register_issues whose issue date (or listed month, for monthly bulletins) falls in the year', null,
 'Count of distinct issue records per state and year; the current year is partial.',
 array['Counts what the publisher''s listing page shows; some listings show only recent issues (Minnesota and New Mexico list the latest), so earlier years can be incomplete.',
       'Only the states whose listings the weekly refresh reads have facts.'],
 'neutral'),
('state_reg_rules_held', 'state_regs', 13010, 'Administrative code rules held with official text',
 'Rules of the state''s administrative code whose current text, as printed by the official publisher, is held here and passed the exact-text check.',
 'rules', 'count', 'law', array['state'], 'snapshot', array['state_regs'],
 '[{"label": "State administrative code publishers (state_regs.codes)", "url": "https://codes.ohio.gov/ohio-administrative-code"}]',
 'Rules in state_regs.rules with text whose text_check is "confirmed"', null,
 'Count per state on the refresh date.',
 array['A validation sample or a partly loaded code counts only the rules loaded so far; see the coverage table for the state''s acquisition status.'],
 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

-- ------------------------------------------------------------------------------------------------ facts
-- plpgsql so the function can be created before state_regs is installed (the rules metric is then empty)
create or replace function insights.facts_state_regs() returns setof insights.fact_row
language plpgsql stable set search_path = '' as $$
declare v_through text; v_today date := current_date;
begin
  select max(coalesce(r.item -> 'register_issue' ->> 'date', (r.item -> 'register_issue' ->> 'period') || '-01'))
    into v_through from public.corpus_records r where r.dataset = 'state_register_issues';
  return query
    with i as (
      select r.state, left(coalesce(r.item -> 'register_issue' ->> 'date', r.item -> 'register_issue' ->> 'period'), 4) as yr
      from public.corpus_records r
      where r.dataset = 'state_register_issues' and r.state ~ '^[A-Z]{2}$'
    ), y as (
      select i.state, i.yr::integer as yr, count(*)::numeric as n from i where i.yr ~ '^[0-9]{4}$' group by i.state, i.yr
    )
    select 'state_register_issues_listed'::text, 'state'::text, y.state, y.yr::text, make_date(y.yr, 1, 1),
           make_date(y.yr, 12, 31), y.n, null::numeric, insights.year_partial(y.yr, v_through), null::numeric, null::text
    from y
    where exists (select 1 from insights.entities e where e.entity_type = 'state' and e.entity_id = y.state);
  if to_regclass('state_regs.rules') is not null then
    return query execute $q$
      select 'state_reg_rules_held'::text, 'state'::text, r.state, $1::text, $1, $1,
             count(*)::numeric, null::numeric, false, null::numeric, null::text
      from state_regs.rules r
      where r.text is not null and r.text_check ->> 'text' = 'confirmed'
        and exists (select 1 from insights.entities e where e.entity_type = 'state' and e.entity_id = r.state)
      group by r.state $q$ using v_today;
  end if;
end $$;

create or replace function insights.refresh_state_regs(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('state_regs', p_trigger) $$;

do $grants$
begin
  revoke all on function insights.facts_state_regs() from public, anon, authenticated;
  grant execute on function insights.facts_state_regs() to service_role;
  revoke all on function insights.refresh_state_regs(text) from public, anon, authenticated;
  grant execute on function insights.refresh_state_regs(text) to service_role;
end $grants$;

commit;
