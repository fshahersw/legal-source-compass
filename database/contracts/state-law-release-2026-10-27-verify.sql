-- Release state-codes-official-unprojected (owner decision 2026-10-27): read-only before/after checks.
-- No schema change: the editions are loaded by scripts/state_law/load.py through the existing state-law-inforce-v1
-- RPCs (begin -> nodes -> sections -> activate). Rollback: state-law-release-2026-10-27-rollback.sql.
--
-- Baseline read 2026-10-27 (execute_sql, project xosqzzsnhxcyehcnirpa):
--   state_law.editions for IL OR OK KS MD NY CO OH MA: 0 rows; active editions overall: 38;
--   state_law.sections_{il,or,ok,ks,md,ny,co,oh,ma}: 0 rows each; state_law.nodes for the nine states: 0.
--   Staged captured layer (corpus_ingest.entities, entity_type 'code-section', review_status 'source_metadata'):
--   IL 72,813; OR 65,750; OK 48,019; KS 47,489; MD 40,347; NY 37,530 (+1,358 quarantined); CO 35,791; OH 33,343;
--   MA 26,812 = 407,894. Released by this plan: IL OR KS MD NY OH MA = 324,084 staged sections.
--   Held: CO 35,791 (publisher unconfirmed) + OK 48,019 (publisher's robots.txt) = 83,810.
set local statement_timeout = '60s';

-- 1. editions of the nine (after: IL OR KS MD NY OH MA active; CO and OK absent)
select state, edition_id, lifecycle, parser, access, activated_at, left(note, 240) as note
from state_law.editions where state in ('IL','OR','OK','KS','MD','NY','CO','OH','MA') order by state, created_at;

-- 2. active editions overall (38 before, 45 after)
select count(*) as active_editions from state_law.editions where lifecycle = 'active';

-- 3. sections per state (after: each equals its edition.json counts.sections; expected near the staged counts above,
--    IL slightly higher because each two-text section becomes @1/@2; CO and OK stay 0)
select 'IL' as state, count(*) from state_law.sections_il union all select 'OR', count(*) from state_law.sections_or
union all select 'KS', count(*) from state_law.sections_ks union all select 'MD', count(*) from state_law.sections_md
union all select 'NY', count(*) from state_law.sections_ny union all select 'OH', count(*) from state_law.sections_oh
union all select 'MA', count(*) from state_law.sections_ma union all select 'CO', count(*) from state_law.sections_co
union all select 'OK', count(*) from state_law.sections_ok;

-- 4. 735 ILCS 5/13-213 is two printed versions (after: 2 rows; @1 "(Text of Section WITH the changes made by P.A.
--    89-7, which has been held unconstitutional)" not_recorded; @2 "(Text of Section WITHOUT ...)" in_force)
select section_id, version_index, version, status, status_marker
from state_law.sections_il where number = '735:5/13-213' order by version_index;
select count(*) as rows, count(distinct version_index) as versions
from state_law.sections_il where number = '735:5/13-213';

-- 5. no IL text still carries a second printed version (after: 0 rows; the staged layer has 60 such rows)
select section_id from state_law.sections_il
where text like '%(Text of Section WITHOUT the changes made by%' or text like '%(Text of Section WITH the changes made by%'
limit 20;

-- 6. NY carries its provenance label (after: terms_note and note say "captured via fetch proxy from nysenate.gov")
select edition_id, terms_note, note from state_law.editions where state = 'NY' and lifecycle = 'active';

-- 7. NY container pages never became sections (after: 0; the 1,358 quarantined title-level rows stay out)
select count(*) as container_like from state_law.sections_ny where number !~ '^[0-9]';

-- 8. citations resolve to the in-force layer (after: one hit each)
select public.state_law_resolve_v1('NY', 'N.Y. C.P.L.R. 214') as ny_cplr,
       public.state_law_resolve_v1('IL', '735 ILCS 5/13-202') as il_sol,
       public.state_law_resolve_v1('OH', 'R.C. 2305.10') as oh_pi,
       public.state_law_resolve_v1('MD', 'Md. Code Ann., Cts. & Jud. Proc. § 5-101') as md_sol,
       public.state_law_resolve_v1('KS', 'K.S.A. 60-513') as ks_sol,
       public.state_law_resolve_v1('MA', 'Mass. Gen. Laws ch. 260, § 2A') as ma_sol,
       public.state_law_resolve_v1('OR', 'ORS 12.110') as or_sol;
