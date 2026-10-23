-- lawviz/1 — precomputed aggregates and bounded read RPCs for four law visualizations (wave 1025, VIZ-A):
--   1. Law atlas         (icicle of the U.S. Code title › chapter › section and the CFR title › chapter › part › section)
--   2. Regulatory lineage (swimlanes for one CFR part: authorizing U.S. Code sections, Federal Register documents that
--                          cite the part, and its sections' eCFR version dates)
--   3. Bill-to-law flow   (introduced › reported › passed one chamber › passed both › became law, 108th–119th Congress)
--   4. Enforcement calendar (daily counts of Federal Register documents, recalls, SEC releases, FTC early-termination
--                          notices and DOJ press releases)
--
-- Everything is computed inside the database from public.corpus_records; nothing is estimated or interpolated.
--   Atlas size   = sections (leaf units) or stored text characters (length of the record's text column for the U.S.
--                  Code; the eCFR builder's `characters` cell for the CFR).
--   Atlas colour = recency of change. U.S. Code: the latest enactment date of a law the Office of the Law Revision
--                  Counsel cites in the section's source credit, Amendments note or status heading
--                  (us_code_amendment_links kinds source_credit / amendment_note / status_note, joined by exact law id
--                  to public_laws_enacted). CFR: the latest version date the eCFR lists for the section
--                  (ecfr_section_versions, same record id). A parent's colour is the median of its sections' years
--                  (sections without a recorded date are left out of the median and counted as not recorded). An
--                  impossible date (before 1789-03-04, after the refresh day, malformed) is not recorded, never repaired.
--   Lineage      = live, bounded reads by exact keys only (payload <= ~200 KB: the latest 600 or 200 documents, monthly
--                  counts by type, every substantive version date of the part, and lanes for up to 16 sections — the
--                  8 most changed when the part has more — each with its latest 100 version dates and the Federal Register
--                  document numbers the eCFR gives for them): the Federal Register documents whose CFR references list the
--                  exact "<title>:<part>" pair (filters.cfr_pair), the part's section version records
--                  (filters.title + filters.part), and the laws linked to U.S. Code section ids the caller resolved by
--                  exact citation (the app passes at most 24 ids; ids that are not stored come back in `missing`).
--   Bill flow    = counts of congress_bills by Congress, bill type, policy area and the milestones the builder derived
--                  only from published action codes/text (filters.milestone; vitiated passages already excluded).
--                  A bill without a recorded introduction is counted as not recorded.
--   Calendar     = one count per series and day. Inside a series' coverage window (its first to last dated record) a
--                  day with no record is 0; outside it the day is not recorded. Undated records are counted apart.
--
-- Objects: schema `lawviz` (tables atlas_nodes, bill_paths, bill_laws, event_series, daily_events, builds; private
-- helpers). Public RPCs (SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
-- service_role): lawviz_atlas_v1, lawviz_part_lineage_v1, lawviz_bill_flow_v1, lawviz_calendar_v1, lawviz_status_v1,
-- lawviz_refresh_v1. Only lawviz_refresh_v1 writes, and only to schema `lawviz`.
--
-- Idempotent (create ... if not exists / create or replace). Apply this file, then
--   select public.lawviz_refresh_v1('initial');           -- all four families, about a minute
-- and (separately, deliberately) database/contracts/lawviz-v1-schedule.sql for the nightly refresh.
-- Tests: src/lib/lawviz/contract.test.mjs (offline PGlite, synthetic rows).

begin;

create schema if not exists lawviz;
revoke all on schema lawviz from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ tables
create table if not exists lawviz.builds (
  build text not null check (build ~ '^[a-z0-9_.-]{1,40}$'),
  family text not null check (family in ('usc', 'cfr', 'bills', 'calendar')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_written integer,
  detail jsonb not null default '{}'::jsonb,
  primary key (build, family)
);

create table if not exists lawviz.atlas_nodes (
  corpus text not null check (corpus in ('usc', 'cfr')),
  id text not null check (char_length(id) between 1 and 300),
  parent text,
  depth smallint not null check (depth between 0 and 4),
  kind text not null check (kind in ('root', 'title', 'chapter', 'division', 'group', 'part', 'section',
                                     'appendix', 'courtRule', 'reorganizationPlan')),
  ord bigint not null,
  num text,
  label text not null,
  sections integer not null check (sections >= 0),
  chars bigint not null check (chars >= 0),
  recorded integer not null check (recorded >= 0 and recorded <= sections),
  last_change date,
  median_year smallint,
  children integer not null check (children >= 0),
  status text,
  build text not null,
  primary key (corpus, id),
  check ((recorded = 0) = (last_change is null)),
  check ((recorded = 0) = (median_year is null))
);
create index if not exists atlas_nodes_parent on lawviz.atlas_nodes (corpus, parent, ord);

create table if not exists lawviz.bill_paths (
  congress smallint not null check (congress between 1 and 200),
  bill_type text not null check (bill_type in ('hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres')),
  policy_area text not null,
  introduced boolean not null,
  reported boolean not null,
  chambers smallint not null check (chambers between 0 and 2),
  became_law boolean not null,
  with_law_number integer not null check (with_law_number >= 0),
  n integer not null check (n > 0),
  build text not null,
  primary key (congress, bill_type, policy_area, introduced, reported, chambers, became_law)
);

create table if not exists lawviz.bill_laws (
  congress smallint primary key check (congress between 1 and 200),
  public_laws integer not null check (public_laws >= 0),
  build text not null
);

create table if not exists lawviz.event_series (
  series text primary key check (series ~ '^[a-z][a-z0-9_]{1,31}$'),
  label text not null,
  unit text not null,
  agencies text[] not null,
  ord smallint not null,
  datasets text[] not null,
  source_label text not null,
  source_url text not null check (source_url ~ '^https://'),
  first_day date,
  last_day date,
  total bigint not null default 0,
  undated bigint not null default 0,
  build text not null
);

create table if not exists lawviz.daily_events (
  series text not null,
  day date not null,
  n integer not null check (n > 0),
  primary key (series, day)
);

alter table lawviz.builds enable row level security;
alter table lawviz.atlas_nodes enable row level security;
alter table lawviz.bill_paths enable row level security;
alter table lawviz.bill_laws enable row level security;
alter table lawviz.event_series enable row level security;
alter table lawviz.daily_events enable row level security;
revoke all on all tables in schema lawviz from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ helpers
-- A stored ISO date, or null when malformed or impossible (never repaired). The refresh also drops dates after its day.
create or replace function lawviz.iso_date(p text) returns date
language plpgsql immutable parallel safe set search_path = '' as $$
declare d date;
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  begin
    d := p::date;
  exception when others then
    return null;
  end;
  return case when d >= date '1789-03-04' and d <= date '2100-12-31' then d end;
end $$;

create or replace function lawviz.int_or_null(p text) returns integer
language sql immutable parallel safe set search_path = '' as $$
  select case when p ~ '^[0-9]{1,9}$' then p::integer end
$$;

create or replace function lawviz.arr(p jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
$$;

-- "CHAPTER 21—" -> "CHAPTER 21" (the designation as printed, trailing dash dropped).
create or replace function lawviz.designation(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '[[:space:]]*[—–-]+[[:space:]]*$', '')), '')
$$;

-- One atlas node as a compact array (the app's parseAtlasTuple reads the same positions).
create or replace function lawviz.node_tuple(n lawviz.atlas_nodes) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_build_array(n.id, n.parent, n.kind, n.num, left(n.label, 140), n.sections, n.chars, n.recorded,
                           n.last_change, n.median_year, n.children, n.status, n.ord)
$$;

create or replace function lawviz.begin_build(p_build text, p_family text) returns void
language sql security definer set search_path = '' as $$
  insert into lawviz.builds (build, family, started_at) values (p_build, p_family, clock_timestamp())
  on conflict (build, family) do update set started_at = clock_timestamp(), finished_at = null, rows_written = null,
                                            detail = '{}'::jsonb
$$;

create or replace function lawviz.end_build(p_build text, p_family text, p_rows integer, p_detail jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  update lawviz.builds set finished_at = clock_timestamp(), rows_written = p_rows, detail = coalesce(p_detail, '{}'::jsonb)
  where build = p_build and family = p_family
  returning jsonb_build_object('family', family, 'rows', rows_written, 'ms',
                               round(extract(epoch from finished_at - started_at) * 1000), 'detail', detail)
$$;

-- ------------------------------------------------------------------------------------------------ refresh: U.S. Code
create or replace function lawviz.refresh_usc(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_del integer; n_leaf integer; n_mid integer; n_top integer; n_rec integer; v_today date := current_date;
begin
  perform lawviz.begin_build(p_build, 'usc');
  with d as (delete from lawviz.atlas_nodes where corpus = 'usc' returning 1) select count(*) into n_del from d;

  -- Sections (and court rules, reorganization plans): one leaf each, under the first chapter among its containers
  -- (else its first division, else the title's "not in a chapter" group).
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with o as materialized (
    select r.id as tk, lawviz.int_or_null(n ->> 0) as idx, coalesce(lawviz.int_or_null(n ->> 2), 0) as depth,
           n ->> 3 as kind
    from public.corpus_records r
    cross join lateral jsonb_array_elements(lawviz.arr(r.detail -> 'usc_title' -> 'outline')) n
    where r.dataset = 'us_code_titles' and jsonb_typeof(n) = 'array'
  ), s as materialized (
    select r.id, r.ordinal, split_part(r.id, ':', 1) as tk, r.item -> 'cells' as c,
           coalesce(r.filters -> 'kind' ->> 0, 'section') as kind, nullif(r.filters -> 'status' ->> 0, 'none') as status,
           coalesce(length(r.text), 0)::bigint as chars, r.filters -> 'container' as cont
    from public.corpus_records r
    where r.dataset = 'us_code_sections'
      and r.id ~ '^(?:[1-9]|[1-4][0-9]|5[0-4])a?:[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$'
  ), sc0 as materialized (
    select s.id, s.tk, lawviz.int_or_null(split_part(ce.v, ':', 2)) as idx
    from s cross join lateral jsonb_array_elements_text(lawviz.arr(s.cont)) as ce(v)
    where split_part(ce.v, ':', 1) = s.tk
  ), sc as materialized (
    select distinct on (sc0.id) sc0.id, o.idx
    from sc0 join o on o.tk = sc0.tk and o.idx = sc0.idx
    where o.depth > 0
    order by sc0.id, (o.kind = 'chapter') desc, o.depth, o.idx
  ), lk as materialized (
    select r.detail -> 'link' ->> 'section' as sid, r.detail -> 'link' ->> 'law' as law
    from public.corpus_records r
    where r.dataset = 'us_code_amendment_links'
      and jsonb_typeof(r.detail -> 'link' -> 'kinds') = 'array'
      and (r.detail -> 'link' -> 'kinds') ?| array['source_credit', 'amendment_note', 'status_note']
  ), lc as materialized (
    select lk.sid, max(p.enacted) as last_change
    from lk
    join (select r.id, lawviz.iso_date(r.detail -> 'law' ->> 'enacted') as enacted
          from public.corpus_records r where r.dataset = 'public_laws_enacted') p on p.id = lk.law
    where p.enacted is not null and p.enacted <= v_today
    group by lk.sid
  )
  select 'usc', s.id, 'usc/' || s.tk || '/c' || coalesce(sc.idx::text, '_'), 3,
         case when s.kind in ('courtRule', 'reorganizationPlan') then s.kind else 'section' end,
         s.ordinal,
         coalesce(nullif(regexp_replace(coalesce(s.c ->> 'citation', ''),
                                        '^[0-9]{1,2}a? U\.S\.C\.( App\.)? ', ''), ''), substr(s.id, strpos(s.id, ':') + 1)),
         coalesce(nullif(btrim(s.c ->> 'heading'), ''), 'Not recorded'),
         1, s.chars, (lc.last_change is not null)::integer, lc.last_change,
         extract(year from lc.last_change)::smallint, 0, s.status, p_build
  from s left join sc on sc.id = s.id left join lc on lc.sid = s.id;
  get diagnostics n_leaf = row_count;

  -- Chapters / divisions / the "not in a chapter" group.
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with o as materialized (
    select r.id as tk, lawviz.int_or_null(n ->> 0) as idx, n ->> 3 as kind, n ->> 4 as num, n ->> 5 as heading
    from public.corpus_records r
    cross join lateral jsonb_array_elements(lawviz.arr(r.detail -> 'usc_title' -> 'outline')) n
    where r.dataset = 'us_code_titles' and jsonb_typeof(n) = 'array'
  ), g as (
    select l.parent as id, split_part(l.parent, '/', 2) as tk,
           lawviz.int_or_null(substr(split_part(l.parent, '/', 3), 2)) as idx,
           count(*)::integer as sections, sum(l.chars)::bigint as chars, count(l.last_change)::integer as recorded,
           max(l.last_change) as last_change,
           (percentile_disc(0.5) within group (order by l.median_year))::smallint as median_year
    from lawviz.atlas_nodes l
    where l.corpus = 'usc' and l.depth = 3
    group by l.parent
  )
  select 'usc', g.id, 'usc/' || g.tk, 2,
         case when g.idx is null then 'group' when o.kind = 'chapter' then 'chapter' else 'division' end,
         coalesce(g.idx, 1000000000),
         case when g.idx is null then null else lawviz.designation(o.num) end,
         case when g.idx is null then 'Not in a chapter'
              else coalesce(nullif(btrim(o.heading), ''), lawviz.designation(o.num), 'Not recorded') end,
         g.sections, g.chars, g.recorded, g.last_change, g.median_year, g.sections, null, p_build
  from g left join o on o.tk = g.tk and o.idx = g.idx;
  get diagnostics n_mid = row_count;

  -- Titles (every stored title, also one without sections).
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with t as (
    select r.id as tk,
           coalesce(nullif(r.detail -> 'usc_title' ->> 'label', ''), 'Title ' || r.id) as num,
           coalesce(nullif(r.detail -> 'usc_title' ->> 'name', ''), r.title, 'Not recorded') as name,
           (lawviz.int_or_null(regexp_replace(r.id, 'a$', '')) * 10 + case when r.id ~ 'a$' then 1 else 0 end) as ord
    from public.corpus_records r
    where r.dataset = 'us_code_titles' and r.id ~ '^(?:[1-9]|[1-4][0-9]|5[0-4])a?$'
  ), leaf as (
    select split_part(l.parent, '/', 2) as tk, l.parent, l.chars, l.last_change, l.median_year
    from lawviz.atlas_nodes l where l.corpus = 'usc' and l.depth = 3
  )
  select 'usc', 'usc/' || t.tk, 'usc', 1, 'title', t.ord, t.num, t.name,
         count(leaf.tk)::integer, coalesce(sum(leaf.chars), 0)::bigint, count(leaf.last_change)::integer,
         max(leaf.last_change), (percentile_disc(0.5) within group (order by leaf.median_year))::smallint,
         count(distinct leaf.parent)::integer, null, p_build
  from t left join leaf on leaf.tk = t.tk
  group by t.tk, t.ord, t.num, t.name;
  get diagnostics n_top = row_count;

  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  select 'usc', 'usc', null, 0, 'root', 0, null, 'United States Code',
         count(*)::integer, coalesce(sum(l.chars), 0)::bigint, count(l.last_change)::integer, max(l.last_change),
         (percentile_disc(0.5) within group (order by l.median_year))::smallint,
         (select count(*)::integer from lawviz.atlas_nodes t where t.corpus = 'usc' and t.depth = 1), null, p_build
  from lawviz.atlas_nodes l where l.corpus = 'usc' and l.depth = 3;

  select count(*) into n_rec from lawviz.atlas_nodes where corpus = 'usc' and depth = 3 and recorded = 1;
  return lawviz.end_build(p_build, 'usc', n_leaf + n_mid + n_top + 1,
    jsonb_build_object('replaced', n_del, 'sections', n_leaf, 'chapters', n_mid, 'titles', n_top,
                       'sections_with_change', n_rec));
end $$;

-- ------------------------------------------------------------------------------------------------ refresh: CFR
create or replace function lawviz.refresh_cfr(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_del integer; n_leaf integer; n_part integer; n_chap integer; n_top integer; n_rec integer;
        v_today date := current_date;
begin
  perform lawviz.begin_build(p_build, 'cfr');
  with d as (delete from lawviz.atlas_nodes where corpus = 'cfr' returning 1) select count(*) into n_del from d;

  -- Current sections and appendices (ecfr_sections_full), coloured by the eCFR's latest version date.
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with s as materialized (
    select r.id, r.ordinal, r.title as rtitle, r.item -> 'cells' as c,
           coalesce(r.filters -> 'title' ->> 0, r.item -> 'cells' ->> 'title_number') as t,
           -- a unit printed outside any part (chapter-level appendices) goes to its chapter's "not in a part" group
           coalesce(nullif(r.item -> 'cells' ->> 'part', ''), nullif(r.filters -> 'part' ->> 0, ''),
                    '_' || coalesce(nullif(r.filters -> 'chapter' ->> 0, ''), '')) as part
    from public.corpus_records r
    where r.dataset = 'ecfr_sections_full' and r.item -> 'cells' ->> 'kind' in ('section', 'appendix')
  ), v as materialized (
    select r.id, lawviz.iso_date(r.item -> 'cells' ->> 'latest_date') as d
    from public.corpus_records r where r.dataset = 'ecfr_section_versions'
  ), x as (
    select s.*, s.c ->> 'kind' as kind, coalesce(s.c ->> 'identifier', '') as ident,
           case when v.d <= v_today then v.d end as d
    from s left join v on v.id = s.id
    where s.t ~ '^(?:[1-9]|[1-4][0-9]|50)$' and s.part is not null and s.part <> ''
  )
  select 'cfr', x.id, 'cfr/' || x.t || '/p/' || x.part, 4, x.kind, x.ordinal,
         case when x.kind = 'section' and x.ident <> '' then '§ ' || x.ident else nullif(x.ident, '') end,
         coalesce(nullif(btrim(case when left(coalesce(x.rtitle, ''), length(x.t || ' CFR ' || x.ident)) = x.t || ' CFR ' || x.ident
                                    then substr(x.rtitle, length(x.t || ' CFR ' || x.ident) + 1)
                                    else x.rtitle end), ''), 'Not recorded'),
         1, coalesce(case when (x.c ->> 'characters') ~ '^[0-9]{1,12}$' then (x.c ->> 'characters')::bigint end, 0),
         (x.d is not null)::integer, x.d, extract(year from x.d)::smallint, 0,
         case when x.c -> 'reserved' = 'true'::jsonb then 'reserved' end, p_build
  from x;
  get diagnostics n_leaf = row_count;

  -- Parts: every stored part record, plus any part only its sections name.
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with pr as materialized (
    select distinct on (t, part) t, part, ordinal, rtitle, chapter, reserved
    from (select coalesce(r.filters -> 'title' ->> 0, r.item -> 'cells' ->> 'title_number') as t,
                 coalesce(r.item -> 'cells' ->> 'part', r.filters -> 'part' ->> 0) as part, r.ordinal,
                 r.title as rtitle, nullif(r.filters -> 'chapter' ->> 0, '') as chapter,
                 r.item -> 'cells' -> 'reserved' = 'true'::jsonb as reserved
          from public.corpus_records r
          where r.dataset = 'ecfr_sections_full' and r.item -> 'cells' ->> 'kind' = 'part') z
    where t ~ '^(?:[1-9]|[1-4][0-9]|50)$' and part is not null and part <> ''
    order by t, part, ordinal
  ), sch as materialized (
    select coalesce(r.filters -> 'title' ->> 0, r.item -> 'cells' ->> 'title_number') as t,
           coalesce(nullif(r.item -> 'cells' ->> 'part', ''), nullif(r.filters -> 'part' ->> 0, ''),
                    '_' || coalesce(nullif(r.filters -> 'chapter' ->> 0, ''), '')) as part,
           min(nullif(r.filters -> 'chapter' ->> 0, '')) as chapter
    from public.corpus_records r
    where r.dataset = 'ecfr_sections_full' and r.item -> 'cells' ->> 'kind' in ('section', 'appendix')
    group by 1, 2
  ), lp as (
    select l.parent as pid, count(*)::integer as sections, sum(l.chars)::bigint as chars,
           count(l.last_change)::integer as recorded, max(l.last_change) as last_change,
           (percentile_disc(0.5) within group (order by l.median_year))::smallint as median_year,
           min(l.ord) as min_ord
    from lawviz.atlas_nodes l where l.corpus = 'cfr' and l.depth = 4 group by l.parent
  ), parts as (
    select coalesce('cfr/' || pr.t || '/p/' || pr.part, lp.pid) as id,
           coalesce(pr.t, split_part(lp.pid, '/', 2)) as t,
           coalesce(pr.part, substr(lp.pid, length('cfr/' || split_part(lp.pid, '/', 2) || '/p/') + 1)) as part,
           pr.ordinal, pr.rtitle, pr.chapter, pr.reserved, lp.sections, lp.chars, lp.recorded, lp.last_change,
           lp.median_year, lp.min_ord
    from pr full join lp on lp.pid = 'cfr/' || pr.t || '/p/' || pr.part
  )
  select 'cfr', p.id, 'cfr/' || p.t || '/c/' || coalesce(p.chapter, sch.chapter, '_'), 3,
         case when p.part like '\_%' then 'group' else 'part' end,
         coalesce(p.ordinal, p.min_ord, 0), case when p.part like '\_%' then null else 'Part ' || p.part end,
         case when p.part like '\_%' then 'Not in a part' else
         coalesce(nullif(btrim(substring(p.rtitle from '—(.*)$')), ''),
                  nullif(btrim(regexp_replace(coalesce(p.rtitle, ''),
                                              '^[0-9]{1,2} CFR Part [^[:space:]—]+[[:space:]]*', '')), ''),
                  'Not recorded') end,
         coalesce(p.sections, 0), coalesce(p.chars, 0), coalesce(p.recorded, 0), p.last_change, p.median_year,
         coalesce(p.sections, 0), case when p.reserved then 'reserved' end, p_build
  from parts p left join sch on sch.t = p.t and sch.part = p.part;
  get diagnostics n_part = row_count;

  -- Chapters (parts with no chapter form the title's "not in a chapter" group).
  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with pth as materialized (
    select distinct on (t, ch) t, ch, label
    from (select coalesce(r.filters -> 'title' ->> 0, r.item -> 'cells' ->> 'title_number') as t,
                 nullif(r.filters -> 'chapter' ->> 0, '') as ch, e ->> 2 as label, r.ordinal
          from public.corpus_records r
          cross join lateral jsonb_array_elements(lawviz.arr(r.detail -> 'path')) e
          where r.dataset = 'ecfr_sections_full' and r.item -> 'cells' ->> 'kind' = 'part'
            and jsonb_typeof(e) = 'array' and e ->> 0 = 'chapter') z
    where ch is not null
    order by t, ch, ordinal
  ), parts as (
    select p.id, p.parent, p.ord from lawviz.atlas_nodes p where p.corpus = 'cfr' and p.depth = 3
  ), g as (
    select parts.parent as id, split_part(parts.parent, '/', 2) as t,
           nullif(substr(parts.parent, length('cfr/' || split_part(parts.parent, '/', 2) || '/c/') + 1), '_') as ch,
           count(l.id)::integer as sections, coalesce(sum(l.chars), 0)::bigint as chars,
           count(l.last_change)::integer as recorded, max(l.last_change) as last_change,
           (percentile_disc(0.5) within group (order by l.median_year))::smallint as median_year,
           count(distinct parts.id)::integer as children, min(parts.ord) as ord
    from parts left join lawviz.atlas_nodes l on l.corpus = 'cfr' and l.depth = 4 and l.parent = parts.id
    group by parts.parent
  )
  select 'cfr', g.id, 'cfr/' || g.t, 2, case when g.ch is null then 'group' else 'chapter' end, g.ord,
         case when g.ch is null then null else 'Chapter ' || g.ch end,
         case when g.ch is null then 'Not in a chapter'
              else coalesce(nullif(btrim(substring(pth.label from '—(.*)$')), ''), 'Not recorded') end,
         g.sections, g.chars, g.recorded, g.last_change, g.median_year, g.children, null, p_build
  from g left join pth on pth.t = g.t and pth.ch = g.ch;
  get diagnostics n_chap = row_count;

  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  with names as materialized (
    select distinct on (t) t, label
    from (select coalesce(r.filters -> 'title' ->> 0, r.item -> 'cells' ->> 'title_number') as t,
                 r.detail -> 'path' -> 0 ->> 2 as label, r.ordinal
          from public.corpus_records r
          where r.dataset = 'ecfr_sections_full' and r.item -> 'cells' ->> 'kind' = 'part'
            and r.detail -> 'path' -> 0 ->> 0 = 'title') z
    order by t, ordinal
  ), ch as (
    select c.id, split_part(c.id, '/', 2) as t from lawviz.atlas_nodes c where c.corpus = 'cfr' and c.depth = 2
  ), leaf as (
    select ch.t, l.chars, l.last_change, l.median_year, l.id
    from lawviz.atlas_nodes l
    join lawviz.atlas_nodes p on p.corpus = 'cfr' and p.depth = 3 and p.id = l.parent
    join ch on ch.id = p.parent
    where l.corpus = 'cfr' and l.depth = 4
  ), titles as (select distinct t from ch)
  select 'cfr', 'cfr/' || titles.t, 'cfr', 1, 'title', titles.t::bigint, 'Title ' || titles.t,
         coalesce(nullif(btrim(substring(names.label from '—(.*)$')), ''), 'Not recorded'),
         count(leaf.id)::integer, coalesce(sum(leaf.chars), 0)::bigint, count(leaf.last_change)::integer,
         max(leaf.last_change), (percentile_disc(0.5) within group (order by leaf.median_year))::smallint,
         (select count(*)::integer from ch where ch.t = titles.t), null, p_build
  from titles left join names on names.t = titles.t left join leaf on leaf.t = titles.t
  group by titles.t, names.label;
  get diagnostics n_top = row_count;

  insert into lawviz.atlas_nodes (corpus, id, parent, depth, kind, ord, num, label, sections, chars, recorded,
                                  last_change, median_year, children, status, build)
  select 'cfr', 'cfr', null, 0, 'root', 0, null, 'Code of Federal Regulations',
         count(*)::integer, coalesce(sum(l.chars), 0)::bigint, count(l.last_change)::integer, max(l.last_change),
         (percentile_disc(0.5) within group (order by l.median_year))::smallint,
         (select count(*)::integer from lawviz.atlas_nodes t where t.corpus = 'cfr' and t.depth = 1), null, p_build
  from lawviz.atlas_nodes l where l.corpus = 'cfr' and l.depth = 4;

  select count(*) into n_rec from lawviz.atlas_nodes where corpus = 'cfr' and depth = 4 and recorded = 1;
  return lawviz.end_build(p_build, 'cfr', n_leaf + n_part + n_chap + n_top + 1,
    jsonb_build_object('replaced', n_del, 'sections', n_leaf, 'parts', n_part, 'chapters', n_chap, 'titles', n_top,
                       'sections_with_version_date', n_rec));
end $$;

-- ------------------------------------------------------------------------------------------------ refresh: bills
create or replace function lawviz.refresh_bills(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_del integer; n_del2 integer; n_rows integer; n_laws integer; n_bills bigint;
begin
  perform lawviz.begin_build(p_build, 'bills');
  with d as (delete from lawviz.bill_paths returning 1) select count(*) into n_del from d;
  with d as (delete from lawviz.bill_laws returning 1) select count(*) into n_del2 from d;

  insert into lawviz.bill_paths (congress, bill_type, policy_area, introduced, reported, chambers, became_law,
                                 with_law_number, n, build)
  select b.congress::smallint, b.bill_type, b.policy_area, b.introduced, b.reported, b.chambers, b.became_law,
         count(*) filter (where b.law_number)::integer, count(*)::integer, p_build
  from (
    select lawviz.int_or_null(r.filters -> 'congress' ->> 0) as congress,
           r.filters -> 'type' ->> 0 as bill_type,
           coalesce(nullif(btrim(r.filters -> 'policy_area' ->> 0), ''), '') as policy_area,
           lawviz.arr(r.filters -> 'milestone') ? 'introduced' as introduced,
           lawviz.arr(r.filters -> 'milestone') ? 'reported' as reported,
           ((lawviz.arr(r.filters -> 'milestone') ? 'passed_house')::integer
             + (lawviz.arr(r.filters -> 'milestone') ? 'passed_senate')::integer)::smallint as chambers,
           lawviz.arr(r.filters -> 'milestone') ? 'became_law' as became_law,
           jsonb_array_length(lawviz.arr(r.filters -> 'law')) > 0 as law_number
    from public.corpus_records r
    where r.dataset = 'congress_bills'
  ) b
  where b.congress between 108 and 119
    and b.bill_type in ('hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres')
  group by 1, 2, 3, 4, 5, 6, 7;
  get diagnostics n_rows = row_count;

  -- Public laws of the same Congresses in the Statutes at Large table (public_laws_enacted), for the cross-check.
  insert into lawviz.bill_laws (congress, public_laws, build)
  select c, count(*)::integer, p_build
  from (select lawviz.int_or_null(r.detail -> 'law' ->> 'congress') as c
        from public.corpus_records r
        where r.dataset = 'public_laws_enacted' and r.detail -> 'law' ->> 'kind' = 'Public law') z
  where c between 108 and 119
  group by c;
  get diagnostics n_laws = row_count;

  select coalesce(sum(n), 0) into n_bills from lawviz.bill_paths;
  return lawviz.end_build(p_build, 'bills', n_rows + n_laws,
    jsonb_build_object('replaced', n_del + n_del2, 'path_rows', n_rows, 'bills', n_bills, 'congresses_with_laws', n_laws));
end $$;

-- ------------------------------------------------------------------------------------------------ refresh: calendar
create or replace function lawviz.refresh_calendar(p_build text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_del integer; n_rows integer; n_series integer; v_today date := current_date;
begin
  perform lawviz.begin_build(p_build, 'calendar');
  with d as (delete from lawviz.daily_events returning 1) select count(*) into n_del from d;

  -- Series registry (labels, the agency views that show each series, the datasets it counts, the public source).
  insert into lawviz.event_series (series, label, unit, agencies, ord, datasets, source_label, source_url, build)
  values
    ('fr_all', 'Federal Register documents, all agencies', 'documents', array['all'], 1,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/documents/search', p_build),
    ('fr_84', 'Federal Register documents listing the CPSC', 'documents', array['cpsc'], 2,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/agencies/consumer-product-safety-commission', p_build),
    ('fr_199', 'Federal Register documents listing the FDA', 'documents', array['fda'], 3,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/agencies/food-and-drug-administration', p_build),
    ('fr_466', 'Federal Register documents listing the SEC', 'documents', array['sec'], 4,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/agencies/securities-and-exchange-commission', p_build),
    ('fr_192', 'Federal Register documents listing the FTC', 'documents', array['ftc'], 5,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/agencies/federal-trade-commission', p_build),
    ('fr_268', 'Federal Register documents listing the Justice Department', 'documents', array['doj'], 6,
     array['federal_register_history'], 'Federal Register', 'https://www.federalregister.gov/agencies/justice-department', p_build),
    ('cpsc_recalls', 'CPSC recalls', 'recalls', array['all', 'cpsc'], 10,
     array['agency_safety_cpsc_recalls_api'], 'CPSC recalls', 'https://www.cpsc.gov/Recalls', p_build),
    ('fda_all', 'FDA enforcement report entries (drugs, devices, food)', 'report entries', array['all'], 20,
     array['agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
           'agency_safety_openfda_food_enforcement'], 'FDA Enforcement Report', 'https://www.accessdata.fda.gov/scripts/ires/', p_build),
    ('fda_drug', 'FDA enforcement report entries: drugs', 'report entries', array['fda'], 21,
     array['agency_safety_openfda_drug_enforcement'], 'openFDA drug enforcement', 'https://open.fda.gov/apis/drug/enforcement/', p_build),
    ('fda_device', 'FDA enforcement report entries: devices', 'report entries', array['fda'], 22,
     array['agency_safety_openfda_device_enforcement'], 'openFDA device enforcement', 'https://open.fda.gov/apis/device/enforcement/', p_build),
    ('fda_food', 'FDA enforcement report entries: food', 'report entries', array['fda'], 23,
     array['agency_safety_openfda_food_enforcement'], 'openFDA food enforcement', 'https://open.fda.gov/apis/food/enforcement/', p_build),
    ('sec_actions', 'SEC litigation releases and administrative proceedings', 'releases', array['all', 'sec'], 30,
     array['sec_enforcement_actions'], 'SEC enforcement', 'https://www.sec.gov/enforcement-litigation', p_build),
    ('ftc_hsr', 'FTC early termination notices (premerger)', 'notices', array['all', 'ftc'], 40,
     array['ftc_hsr_early_terminations'], 'FTC early termination notices', 'https://www.ftc.gov/legal-library/browse/early-termination-notices', p_build),
    ('doj_press', 'Justice Department press releases', 'press releases', array['all', 'doj'], 50,
     '{}'::text[], 'Justice Department news', 'https://www.justice.gov/news', p_build)
  on conflict (series) do update set label = excluded.label, unit = excluded.unit, agencies = excluded.agencies,
    ord = excluded.ord, datasets = excluded.datasets, source_label = excluded.source_label,
    source_url = excluded.source_url, build = excluded.build;

  -- The yearly DOJ press-release datasets present in the catalog (doj_press_releases_<year>).
  update lawviz.event_series es
  set datasets = coalesce((select array_agg(d.id order by d.id) from public.corpus_datasets d
                           where d.id ~ '^doj_press_releases_(19|20)[0-9]{2}$'), '{}')
  where es.series = 'doj_press';

  with fr as materialized (
    select lawviz.iso_date(r.item -> 'cells' ->> 'published') as day, lawviz.arr(r.filters -> 'agency') as ag
    from public.corpus_records r where r.dataset = 'federal_register_history'
  ), fda as materialized (
    select r.dataset, lawviz.iso_date(r.filters ->> 'report_date') as day
    from public.corpus_records r
    where r.dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
                        'agency_safety_openfda_food_enforcement')
  ), ev as (
    select 'fr_all' as series, fr.day from fr
    union all
    select 'fr_' || a, fr.day from fr cross join lateral jsonb_array_elements_text(fr.ag) a
    where a in ('84', '199', '466', '192', '268')
    union all
    select 'cpsc_recalls', lawviz.iso_date(r.item -> 'cells' ->> 'date')
    from public.corpus_records r where r.dataset = 'agency_safety_cpsc_recalls_api'
    union all
    select case fda.dataset when 'agency_safety_openfda_drug_enforcement' then 'fda_drug'
                            when 'agency_safety_openfda_device_enforcement' then 'fda_device' else 'fda_food' end,
           fda.day
    from fda
    union all
    select 'fda_all', fda.day from fda
    union all
    select 'sec_actions', lawviz.iso_date(r.item -> 'cells' ->> 'date')
    from public.corpus_records r where r.dataset = 'sec_enforcement_actions'
    union all
    select 'ftc_hsr', lawviz.iso_date(r.item -> 'cells' ->> 'date')
    from public.corpus_records r
    where r.dataset = 'ftc_hsr_early_terminations' and r.filters @> '{"kind":["notice"]}'::jsonb
    union all
    select 'doj_press', lawviz.iso_date(r.item -> 'cells' ->> 'date')
    from public.corpus_records r
    where r.dataset in (select d.id from public.corpus_datasets d where d.id ~ '^doj_press_releases_(19|20)[0-9]{2}$')
      and r.id like 'doj-pr:%'
  ), counted as materialized (
    select ev.series, ev.day, count(*) as n from ev group by ev.series, ev.day
  ), upd as (
    update lawviz.event_series es
    set first_day = x.first_day, last_day = x.last_day, total = coalesce(x.total, 0), undated = coalesce(u.undated, 0)
    from (select c.series from counted c group by c.series) k
    left join (select c.series, min(c.day) as first_day, max(c.day) as last_day, sum(c.n) as total
               from counted c where c.day is not null and c.day <= v_today group by c.series) x on x.series = k.series
    left join (select c.series, sum(c.n) as undated
               from counted c where c.day is null or c.day > v_today group by c.series) u on u.series = k.series
    where es.series = k.series
    returning 1
  )
  insert into lawviz.daily_events (series, day, n)
  select c.series, c.day, c.n::integer from counted c where c.day is not null and c.day <= v_today;
  get diagnostics n_rows = row_count;

  -- A series with no dated record keeps null coverage (shown as not recorded).
  update lawviz.event_series es set first_day = null, last_day = null, total = 0
  where not exists (select 1 from lawviz.daily_events d where d.series = es.series);
  select count(*) into n_series from lawviz.event_series where total > 0;
  return lawviz.end_build(p_build, 'calendar', n_rows,
    jsonb_build_object('replaced', n_del, 'day_rows', n_rows, 'series_with_data', n_series));
end $$;

-- ------------------------------------------------------------------------------------------------ public RPCs
-- Refresh one family or all four. Writes only schema lawviz; each family replaces its own rows in one transaction.
create or replace function public.lawviz_refresh_v1(p_build text, p_family text default 'all') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb;
begin
  if p_build is null or p_build !~ '^[a-z0-9_.-]{1,40}$' then
    raise exception 'lawviz: build id must match ^[a-z0-9_.-]{1,40}$';
  end if;
  if p_family not in ('all', 'usc', 'cfr', 'bills', 'calendar') then
    raise exception 'lawviz: unknown family %', p_family;
  end if;
  if p_family in ('all', 'usc') then out := out || jsonb_build_array(lawviz.refresh_usc(p_build)); end if;
  if p_family in ('all', 'cfr') then out := out || jsonb_build_array(lawviz.refresh_cfr(p_build)); end if;
  if p_family in ('all', 'bills') then out := out || jsonb_build_array(lawviz.refresh_bills(p_build)); end if;
  if p_family in ('all', 'calendar') then out := out || jsonb_build_array(lawviz.refresh_calendar(p_build)); end if;
  return jsonb_build_object('build', p_build, 'families', out);
end $$;

create or replace function public.lawviz_status_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'families', coalesce((select jsonb_agg(jsonb_build_object('family', b.family, 'build', b.build,
                                 'started_at', b.started_at, 'finished_at', b.finished_at, 'rows', b.rows_written,
                                 'detail', b.detail) order by b.family)
                          from (select distinct on (family) * from lawviz.builds
                                order by family, finished_at desc nulls last, started_at desc) b), '[]'::jsonb),
    'atlas_nodes', (select count(*) from lawviz.atlas_nodes),
    'bill_paths', (select count(*) from lawviz.bill_paths),
    'daily_events', (select count(*) from lawviz.daily_events))
$$;

-- The latest finished build of a family (shown as "computed on").
create or replace function lawviz.built(p_family text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('build', b.build, 'finished_at', b.finished_at)
          from lawviz.builds b where b.family = p_family and b.finished_at is not null
          order by b.finished_at desc limit 1)
$$;

-- Atlas: a node, its ancestors, its children and (when they are few) its grandchildren.
--   > 600 leaf children are returned as consecutive ranges (<= 24 bins, exact sums and medians); open a range with
--   p_from/p_to (its first and last `ord`). Grandchildren are included only when they number <= 800.
create or replace function public.lawviz_atlas_v1(p_corpus text, p_node text default null,
                                                   p_from bigint default null, p_to bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f lawviz.atlas_nodes;
  v_path jsonb; v_kids jsonb; v_grand jsonb := '[]'::jsonb;
  n_kids integer; n_grand integer := 0; n_nonleaf integer;
  v_binned boolean := false; v_truncated boolean := false; v_grand_included boolean := false;
  k_bins constant integer := 24; k_kids constant integer := 600; k_grand constant integer := 800;
  v_step integer;
begin
  if p_corpus is null or p_corpus not in ('usc', 'cfr') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (p_from is null) <> (p_to is null) or (p_from is not null and p_to < p_from) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into f from lawviz.atlas_nodes n where n.corpus = p_corpus and n.id = coalesce(p_node, p_corpus);
  if not found then
    return jsonb_build_object('status',
      case when exists (select 1 from lawviz.atlas_nodes n where n.corpus = p_corpus) then 'not_found' else 'empty' end,
      'built', lawviz.built(p_corpus));
  end if;

  with recursive up(node, lvl) as (
    select n, 0 from lawviz.atlas_nodes n where n.corpus = p_corpus and n.id = f.parent
    union all
    select n, up.lvl + 1 from lawviz.atlas_nodes n join up on n.corpus = p_corpus and n.id = (up.node).parent
    where up.lvl < 6
  )
  select coalesce(jsonb_agg(lawviz.node_tuple(node) order by lvl desc), '[]'::jsonb) into v_path from up;

  select count(*), count(*) filter (where c.children > 0) into n_kids, n_nonleaf
  from lawviz.atlas_nodes c
  where c.corpus = p_corpus and c.parent = f.id and (p_from is null or c.ord between p_from and p_to);

  if p_from is null and n_kids > k_kids and n_nonleaf = 0 then
    v_binned := true;
    v_step := ceil(n_kids::numeric / k_bins)::integer;
    with c as (
      select c.*, ((row_number() over (order by c.ord, c.id)) - 1) / v_step as b
      from lawviz.atlas_nodes c where c.corpus = p_corpus and c.parent = f.id
    ), agg as (
      select b, min(ord) as lo, max(ord) as hi, count(*)::integer as cnt, sum(sections)::integer as sections,
             sum(chars)::bigint as chars, sum(recorded)::integer as recorded, max(last_change) as last_change,
             (percentile_disc(0.5) within group (order by median_year))::smallint as median_year,
             (array_agg(num order by ord, id))[1] as first_num,
             (array_agg(num order by ord desc, id desc))[1] as last_num
      from c group by b
    )
    select jsonb_agg(jsonb_build_array(f.id || '#' || lo || '-' || hi, f.id, 'range', first_num, last_num,
                                       sections, chars, recorded, last_change, median_year, cnt, null, lo, hi)
                     order by b)
    into v_kids from agg;
  else
    if n_kids > k_kids then v_truncated := true; end if;
    select coalesce(jsonb_agg(z.t order by z.o1, z.o2), '[]'::jsonb) into v_kids
    from (select lawviz.node_tuple(c) as t, c.ord as o1, c.id as o2 from lawviz.atlas_nodes c
          where c.corpus = p_corpus and c.parent = f.id and (p_from is null or c.ord between p_from and p_to)
          order by c.ord, c.id limit k_kids) z;
    if p_from is null and not v_truncated then
      select coalesce(sum(c.children), 0) into n_grand
      from lawviz.atlas_nodes c where c.corpus = p_corpus and c.parent = f.id;
      if n_grand between 1 and k_grand then
        v_grand_included := true;
        select coalesce(jsonb_agg(lawviz.node_tuple(g) order by c.ord, c.id, g.ord, g.id), '[]'::jsonb) into v_grand
        from lawviz.atlas_nodes c
        join lawviz.atlas_nodes g on g.corpus = p_corpus and g.parent = c.id
        where c.corpus = p_corpus and c.parent = f.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ok', 'corpus', p_corpus, 'focus', lawviz.node_tuple(f), 'path', v_path,
    'children', coalesce(v_kids, '[]'::jsonb), 'children_total', n_kids, 'binned', v_binned,
    'truncated', v_truncated, 'grandchildren', v_grand, 'grandchildren_total', n_grand,
    'grandchildren_included', v_grand_included, 'range', case when p_from is null then null
                                                             else jsonb_build_array(p_from, p_to) end,
    'built', lawviz.built(p_corpus));
end $$;

-- Regulatory lineage of one CFR part (live, bounded, exact keys only).
create or replace function public.lawviz_part_lineage_v1(p_title text, p_part text, p_usc text[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k_pair text; v_part jsonb; v_fr jsonb; v_versions jsonb; v_statutes jsonb; v_missing jsonb;
  n_fr integer; n_sec integer; k_docs integer;
  v_usc text[] := coalesce(p_usc, '{}');
begin
  if p_title is null or p_title !~ '^(?:[1-9]|[1-4][0-9]|50)$'
     or p_part is null or p_part !~ '^[0-9A-Za-z][0-9A-Za-z .-]{0,59}$'
     or coalesce(array_length(v_usc, 1), 0) > 24
     or exists (select 1 from unnest(v_usc) u
                where u is null or u !~ '^(?:[1-9]|[1-4][0-9]|5[0-4])a?:[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$') then
    return jsonb_build_object('status', 'invalid');
  end if;
  k_pair := p_title || ':' || p_part;

  select jsonb_build_object('id', r.id, 'title', r.title, 'as_of', r.item -> 'cells' ->> 'as_of',
                            'sections', r.item -> 'cells' -> 'sections')
  into v_part
  from public.corpus_records r
  where r.dataset = 'ecfr_sections_full' and r.id = 'cfr:' || p_title || ':part-' || p_part;

  -- Federal Register documents that list this exact title + part among their CFR references.
  select count(*) into n_fr
  from public.corpus_records r
  where r.dataset = 'federal_register_history' and r.filters @> jsonb_build_object('cfr_pair', jsonb_build_array(k_pair));
  k_docs := case when n_fr <= 600 then 600 else 200 end;
  with d as materialized (
    select r.id, lawviz.iso_date(r.item -> 'cells' ->> 'published') as day,
           coalesce(nullif(btrim(r.item -> 'cells' ->> 'type'), ''), 'Not recorded') as type,
           r.item -> 'cells' ->> 'citation' as citation, left(r.title, 140) as title, r.source_url
    from public.corpus_records r
    where r.dataset = 'federal_register_history'
      and r.filters @> jsonb_build_object('cfr_pair', jsonb_build_array(k_pair))
  )
  select jsonb_build_object(
    'total', n_fr,
    'undated', (select count(*) from d where d.day is null),
    'months', (select coalesce(jsonb_agg(jsonb_build_array(m, type, n) order by m, type), '[]'::jsonb)
               from (select to_char(d.day, 'YYYY-MM') as m, d.type, count(*) as n from d where d.day is not null
                     group by 1, 2) x),
    'docs', (select coalesce(jsonb_agg(jsonb_build_array(y.id, y.day, y.type, y.citation, y.title, y.source_url)
                                       order by y.day desc, y.id desc), '[]'::jsonb)
             from (select * from d where d.day is not null order by d.day desc, d.id desc limit k_docs) y),
    'complete', n_fr <= 600)
  into v_fr;

  -- Section version dates (eCFR versioner) for the part's sections, current and removed.
  with s as materialized (
    select r.id, r.ordinal, coalesce(r.item -> 'cells' ->> 'identifier', '') as ident, left(r.title, 160) as title,
           r.item -> 'cells' -> 'removed' = 'true'::jsonb as removed, r.detail -> 'versions' as vs
    from public.corpus_records r
    where r.dataset = 'ecfr_section_versions'
      and r.filters @> jsonb_build_object('title', jsonb_build_array(p_title), 'part', jsonb_build_array(p_part))
  ), v as materialized (
    select s.id, lawviz.iso_date(e ->> 'date') as day,
           bool_or(e -> 'substantive' = 'true'::jsonb) as substantive,
           coalesce(jsonb_agg(distinct jsonb_build_array(f ->> 'citation',
                                                         substring(f ->> 'url' from '/d/([0-9A-Za-z-]{4,40})$')))
                    filter (where jsonb_typeof(f) = 'object'), '[]'::jsonb) as fr
    from s
    cross join lateral jsonb_array_elements(lawviz.arr(s.vs)) e
    left join lateral jsonb_array_elements(lawviz.arr(e -> 'fr')) f on true
    where jsonb_typeof(e) = 'object'
    group by s.id, 2
  ), sub as (
    select v.* from v where v.substantive and v.day is not null
  ), counts as (
    select s.id, s.ordinal, s.ident, s.title, s.removed, count(sub.day) as n
    from s left join sub on sub.id = s.id group by s.id, s.ordinal, s.ident, s.title, s.removed
  ), chosen as (
    select * from counts
    order by case when (select count(*) from counts) <= 16 then 0 else -n end, ordinal, id
    limit case when (select count(*) from counts) <= 16 then 16 else 8 end
  )
  select jsonb_build_object(
    'sections', (select count(*) from s),
    'removed', (select count(*) from s where s.removed),
    'dates', (select coalesce(jsonb_agg(jsonb_build_array(day, n) order by day), '[]'::jsonb)
              from (select sub.day, count(distinct sub.id) as n from sub group by sub.day) x),
    'lanes', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.ident, c.title, c.removed, c.n,
                     (select coalesce(jsonb_agg(jsonb_build_array(z.day, z.fr) order by z.day), '[]'::jsonb)
                      from (select sub.day, sub.fr from sub where sub.id = c.id order by sub.day desc limit 100) z))
                     order by c.ordinal, c.id), '[]'::jsonb) from chosen c),
    'selection', case when (select count(*) from s) <= 16 then 'all' else 'most_changed' end)
  into v_versions;
  n_sec := (v_versions ->> 'sections')::integer;

  -- Laws linked to the U.S. Code sections the caller resolved by exact citation.
  with u as (select x as id, ord from unnest(v_usc) with ordinality t(x, ord)),
  s as (
    select u.id, u.ord, r.item -> 'cells' ->> 'citation' as citation, r.item -> 'cells' ->> 'heading' as heading,
           nullif(r.filters -> 'status' ->> 0, 'none') as status, r.source_url
    from u join public.corpus_records r on r.dataset = 'us_code_sections' and r.id = u.id
  ), l as (
    select s.id as sid, r.detail -> 'link' ->> 'law' as law, r.detail -> 'link' -> 'kinds' as kinds
    from s join public.corpus_records r
      on r.dataset = 'us_code_amendment_links' and r.filters @> jsonb_build_object('section', jsonb_build_array(s.id))
    where jsonb_typeof(r.detail -> 'link' -> 'kinds') = 'array'
      and (r.detail -> 'link' -> 'kinds') ?| array['source_credit', 'amendment_note', 'status_note']
      and r.detail -> 'link' ->> 'section' = s.id
  ), p as (
    select l.sid, l.law, l.kinds, lawviz.iso_date(r.detail -> 'law' ->> 'enacted') as enacted,
           coalesce(r.detail -> 'law' ->> 'label', r.item ->> 'title') as label, left(r.title, 180) as title
    from l join public.corpus_records r on r.dataset = 'public_laws_enacted' and r.id = l.law
  )
  select coalesce(jsonb_agg(jsonb_build_array(s.id, s.citation, s.heading, s.status, s.source_url,
           (select coalesce(jsonb_agg(jsonb_build_array(z.law, z.label, case when z.enacted <= current_date then z.enacted end,
                                                        z.kinds, z.title) order by z.enacted nulls first, z.law), '[]'::jsonb)
            from (select * from p where p.sid = s.id order by p.enacted desc nulls last, p.law limit 200) z),
           (select count(*) from p where p.sid = s.id))
         order by s.ord), '[]'::jsonb)
  into v_statutes from s;
  select coalesce(jsonb_agg(u.x order by u.ord), '[]'::jsonb) into v_missing
  from unnest(v_usc) with ordinality u(x, ord)
  where not exists (select 1 from public.corpus_records r where r.dataset = 'us_code_sections' and r.id = u.x);

  return jsonb_build_object('status', 'ok', 'title', p_title, 'part', p_part, 'part_record', v_part,
                            'fr', v_fr, 'versions', v_versions, 'statutes', v_statutes, 'missing', v_missing,
                            'empty', n_fr = 0 and n_sec = 0 and jsonb_array_length(v_statutes) = 0);
end $$;

-- Bill-to-law flow: every precomputed path row (small by construction) plus the public-law cross-check.
create or replace function public.lawviz_bill_flow_v1() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', case when exists (select 1 from lawviz.bill_paths) then 'ok' else 'empty' end,
    'policy_areas', (select coalesce(jsonb_agg(pa order by pa), '[]'::jsonb)
                     from (select distinct policy_area as pa from lawviz.bill_paths) x),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(congress, bill_type, policy_area, introduced, reported,
                                                         chambers, became_law, n, with_law_number)
                                       order by congress, bill_type, policy_area, introduced, reported, chambers,
                                                became_law), '[]'::jsonb)
             from lawviz.bill_paths),
    'public_laws', (select coalesce(jsonb_object_agg(congress::text, public_laws), '{}'::jsonb) from lawviz.bill_laws),
    'built', lawviz.built('bills'))
$$;

-- Enforcement calendar: the agency view's series, its days in one year, and monthly totals for every year.
create or replace function public.lawviz_calendar_v1(p_agency text, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_series text[];
begin
  if p_agency is null or p_agency not in ('all', 'cpsc', 'fda', 'sec', 'ftc', 'doj')
     or p_year is null or p_year < 1950 or p_year > 2100 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(array_agg(series order by ord), '{}') into v_series
  from lawviz.event_series where p_agency = any (agencies);
  if coalesce(array_length(v_series, 1), 0) = 0 then
    return jsonb_build_object('status', 'empty', 'built', lawviz.built('calendar'));
  end if;
  return jsonb_build_object(
    'status', 'ok', 'agency', p_agency, 'year', p_year,
    'series', (select jsonb_agg(jsonb_build_array(es.series, es.label, es.unit, es.first_day, es.last_day, es.total,
                                                  es.undated, es.source_label, es.source_url, es.datasets)
                                order by es.ord)
               from lawviz.event_series es where es.series = any (v_series)),
    'days', (select coalesce(jsonb_agg(jsonb_build_array(d.series, d.day, d.n) order by d.series, d.day), '[]'::jsonb)
             from lawviz.daily_events d
             where d.series = any (v_series) and d.day >= make_date(p_year, 1, 1) and d.day < make_date(p_year + 1, 1, 1)),
    'months', (select coalesce(jsonb_agg(jsonb_build_array(series, m, n) order by series, m), '[]'::jsonb)
               from (select d.series, to_char(d.day, 'YYYY-MM') as m, sum(d.n) as n
                     from lawviz.daily_events d where d.series = any (v_series) group by 1, 2) x),
    'built', lawviz.built('calendar'));
end $$;

-- ------------------------------------------------------------------------------------------------ privileges
revoke all on function lawviz.iso_date(text), lawviz.int_or_null(text), lawviz.arr(jsonb), lawviz.designation(text),
  lawviz.node_tuple(lawviz.atlas_nodes), lawviz.begin_build(text, text), lawviz.end_build(text, text, integer, jsonb),
  lawviz.refresh_usc(text), lawviz.refresh_cfr(text), lawviz.refresh_bills(text), lawviz.refresh_calendar(text),
  lawviz.built(text)
  from public, anon, authenticated;
revoke all on function public.lawviz_refresh_v1(text, text), public.lawviz_status_v1(),
  public.lawviz_atlas_v1(text, text, bigint, bigint), public.lawviz_part_lineage_v1(text, text, text[]),
  public.lawviz_bill_flow_v1(), public.lawviz_calendar_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.lawviz_refresh_v1(text, text), public.lawviz_status_v1(),
  public.lawviz_atlas_v1(text, text, bigint, bigint), public.lawviz_part_lineage_v1(text, text, text[]),
  public.lawviz_bill_flow_v1(), public.lawviz_calendar_v1(text, integer)
  to service_role;

commit;
