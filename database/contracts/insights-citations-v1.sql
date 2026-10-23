-- insights/1 family 'citations': metrics of the citation graph (citations/2, database/contracts/citations-v2.sql) in the
-- registration pattern of database/contracts/insights-v1.sql (that file is not edited). Apply after insights-v1.sql and
-- citations-v2.sql; then `select insights.refresh_citations('initial');`. Every value is a count of rows of the citation
-- graph over filings whose text the documents layer serves (text_layer / partial_text) and whose PDF is open
-- (documents.is_open); nothing is estimated. Facts are written only for MDL and court entities that are in the spine.
-- The nightly refresh is a pg_cron job in citations-v2-schedule.sql (after the nightly extraction).

begin;

insert into insights.families (id, ordinal, datasets, dataset_patterns, description) values
  ('citations', 120, array['citations_graph'], '{}', 'Citation graph of the court filings (citations/2)')
on conflict (id) do update set ordinal = excluded.ordinal, datasets = excluded.datasets,
  dataset_patterns = excluded.dataset_patterns, description = excluded.description;

insert into insights.metrics (id, family, ordinal, label, description, unit, format, topic, entity_types, period_type,
  source_datasets, source_links, numerator, denominator, method, caveats, direction) values
('citations_filings_citing', 'citations', 12000, 'Filings citing legal authority',
 'Court filings filed in the year, among those whose text is searchable, that cite at least one case, statute, regulation, constitutional provision or court rule.',
 'filings', 'count', 'litigation', array['mdl', 'court'], 'year', array['citations_graph'],
 '[{"label": "Court filings listed on the matter pages", "url": "/litigation/documents"}]',
 'Filings filed in the year with at least one citation (relation cites) read by the canonical citation extractor',
 null, 'Count of distinct filings; n is the number of filings filed in the year whose text is searchable.',
 array['Only filings with a text layer are read; scanned filings without text are not counted.',
       'A citation is counted whether or not the cited authority is in the corpus; MDL and docket numbers are mentions and do not count.',
       'The current year is partial.'], 'neutral'),
('citations_decisions_cited', 'citations', 12010, 'Court decisions cited by the MDL''s filings',
 'Distinct court decisions in the case-law corpus that the MDL''s searchable filings cite by an exact reporter citation.',
 'decisions', 'count', 'litigation', array['mdl'], 'snapshot', array['citations_graph', 'caselaw'],
 '[{"label": "Court filings listed on the matter pages", "url": "/litigation/documents"}]',
 'Distinct resolved case-law clusters cited (parallel citations of one decision count once)', null,
 'Count of distinct caselaw cluster ids over the resolved citations of the MDL''s filings, as of the refresh date.',
 array['A citation that matches two or more decisions (ambiguous) or none in the corpus is not counted.'], 'neutral'),
('citations_provisions_cited', 'citations', 12020, 'Statutes, regulations and rules cited by the MDL''s filings',
 'Distinct statutory, regulatory, constitutional and court-rule provisions in the corpus that the MDL''s searchable filings cite.',
 'provisions', 'count', 'litigation', array['mdl'], 'snapshot',
 array['citations_graph', 'us_code_sections', 'ecfr_sections_full', 'public_laws_enacted', 'court_rule_sections', 'state_constitution_sections'],
 '[{"label": "Court filings listed on the matter pages", "url": "/litigation/documents"}]',
 'Distinct resolved records of every authority kind except case law, MDL and docket numbers', null,
 'Count of distinct (dataset, record id) over the resolved citations of the MDL''s filings, as of the refresh date.',
 array['Provisions not in the corpus (repealed sections, chapters, the U.S. Constitution) are not counted.',
       'State statutes and regulations count once their resolvers are installed (state_law_resolve_v1, state_reg_resolve_v1).'], 'neutral')
on conflict (id) do update set family = excluded.family, ordinal = excluded.ordinal, label = excluded.label,
  description = excluded.description, unit = excluded.unit, format = excluded.format, topic = excluded.topic,
  entity_types = excluded.entity_types, period_type = excluded.period_type, source_datasets = excluded.source_datasets,
  source_links = excluded.source_links, numerator = excluded.numerator, denominator = excluded.denominator,
  method = excluded.method, caveats = excluded.caveats, direction = excluded.direction;

create or replace function insights.facts_citations() returns setof insights.fact_row
language sql stable set search_path = '' as $$
  with docs as materialized (
    select d.id, d.mdl, d.court_id, extract(year from d.filed_date)::integer as y
      from documents.documents d
     where d.text_status in ('text_layer', 'partial_text') and documents.is_open(d.source_system, d.native_document_id)),
  citing as materialized (
    select distinct e.citing_id from citations.edges e where e.citing_type = 'document' and e.relation = 'cites'),
  per_year as (
    select 'mdl'::text as et, docs.mdl as eid, docs.y, count(*) as filings, count(c.citing_id) as citing
      from docs left join citing c on c.citing_id = docs.id where docs.y is not null group by docs.mdl, docs.y
    union all
    select 'court', docs.court_id, docs.y, count(*), count(c.citing_id)
      from docs left join citing c on c.citing_id = docs.id where docs.y is not null and docs.court_id is not null
     group by docs.court_id, docs.y),
  nodes as (
    select docs.mdl, a.target_dataset, a.target_id
      from docs join citations.edges e on e.citing_type = 'document' and e.citing_id = docs.id and e.relation = 'cites'
      join citations.authorities a on a.key = e.key and a.resolution = 'resolved'
     group by 1, 2, 3)
  select 'citations_filings_citing', p.et, p.eid, p.y::text, make_date(p.y, 1, 1), make_date(p.y, 12, 31),
         p.citing::numeric, null::numeric, p.y >= extract(year from current_date)::integer, p.filings::numeric, null::text
    from per_year p
    join insights.entities en on en.entity_type = p.et and en.entity_id = p.eid
  union all
  select 'citations_decisions_cited', 'mdl', n.mdl, to_char(current_date, 'YYYY-MM-DD'), current_date, current_date,
         count(*) filter (where n.target_dataset = 'caselaw')::numeric, null::numeric, false, null::numeric, null::text
    from nodes n join insights.entities en on en.entity_type = 'mdl' and en.entity_id = n.mdl group by n.mdl
  union all
  select 'citations_provisions_cited', 'mdl', n.mdl, to_char(current_date, 'YYYY-MM-DD'), current_date, current_date,
         count(*) filter (where n.target_dataset not in ('caselaw', 'mdls'))::numeric, null::numeric, false, null::numeric, null::text
    from nodes n join insights.entities en on en.entity_type = 'mdl' and en.entity_id = n.mdl group by n.mdl
$$;

create or replace function insights.refresh_citations(p_trigger text default 'manual') returns jsonb
language sql security definer set search_path = '' as $$ select insights.run_family('citations', p_trigger) $$;

revoke all on function insights.facts_citations() from public, anon, authenticated;
revoke all on function insights.refresh_citations(text) from public, anon, authenticated;
grant execute on function insights.refresh_citations(text) to service_role;

commit;
