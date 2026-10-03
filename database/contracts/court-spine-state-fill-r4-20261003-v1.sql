-- court-spine-state-fill/2026-10-03.r4.1  (run c41d48ea-d3fb-4362-bda3-a959b127a4cb; coordinator decision 1 after the round-3 review)
-- Scope: public.corpus_records dataset='court_spine' (+ the corpus_workspace_court_map projection in statements 3-4).
-- Problem: the directory's State column is "State (only where explicit)": the builder leaves it empty when the printed state name is followed by County/City because that can be a
--   county ("Washington County Court" in Florida). 346 court rows print exactly one state name and are suppressed; the court page then highlights no state and the State filter misses them.
-- Approved: fill State for the 223 suppressed state-system rows where TWO independent signals agree, exclude the 6 homonym traps (flactyct67, nyfamctdel, nyjustctportwa, ohcirctdelaware,
--   reg-ST-vi_state, washterr), keep before-images.
--   signal 1: the name prints exactly one state / territory name (the code below is that state);
--   signal 2: either courts-db 0.10.27 lists the same court id with location = that state (63 rows; kind 'courts_db'), or every other court whose CourtListener id starts with the same
--             prefix and already has a state has this state, with at least 5 such courts (160 rows; kind 'id_prefix': 158 'texc...' Texas county courts incl. their parent texctyct, 2 New York rows).
--   Rows: 157 Texas county courts + texctyct, 58 New York county courts + nycountyct + nycityct, 5 state-level courts (colctyct, flactyct, ohctinsolv, ohiocountyct, orcc).
-- Per row: spine.state, item.cells.state, filters.state, a fact State "<CODE> - state name printed in the CourtListener court name, confirmed by <signal>" after the System fact (and in text).
--   Names are NOT changed (decision 2: CourtListener's published names stay, e.g. "Texas City Court, ..."). The map follows (state + facts) in statements 3-4. Facet counts of the State filter: statement 5.
-- Guards in the audit statement (a row that fails any guard is skipped): spine and map state empty, map system 'state', the code's state name appears in the title and is the only state name
--   printed (names contained in a longer printed name are ignored), the id-prefix evidence is re-counted, ' System State ' occurs exactly once in the text.
-- Before-image: whole title / state / item / detail / text / filters + whole-row md5 (spine, issue dq20261003r4_court_state_fill); whole map row (issue dq20261003r4_court_map_state_fill);
--   listing.filters of the dataset metadata (issue dq20261003r4_court_spine_state_facets).
-- Execute statements 1..5 in order.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set title = c.original_record->>'title', state = c.original_record->>'state', item = c.original_record->'item', detail = c.original_record->'detail',
--          text = c.original_record->>'text', filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'court_spine' and c.issue = 'dq20261003r4_court_state_fill' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'court_spine' and r.id = c.record_id;
--   update public.corpus_workspace_court_map m set state = c.original_record->'row'->>'state', facts = c.original_record->'row'->'facts'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_workspace_court_map' and c.issue = 'dq20261003r4_court_map_state_fill' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and m.court_id = c.record_id;
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata, '{listing,filters}', c.original_record->'listing_filters'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_court_spine_state_facets' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and c.record_id = d.id;
--
-- ===== statement 1: audit (spine) =====
with flag as (select true as apply),
cand(court_id, code, kind, prefix) as (values
    ('colctyct','CO','courts_db',''),
    ('flactyct','FL','courts_db',''),
    ('nyalbanyctyct','NY','courts_db',''),
    ('nyalleganyctyct','NY','courts_db',''),
    ('nybroomectyct','NY','courts_db',''),
    ('nycattctyct','NY','courts_db',''),
    ('nycayugactyct','NY','courts_db',''),
    ('nychautctyct','NY','courts_db',''),
    ('nychemungctyct','NY','courts_db',''),
    ('nychenangoctyct','NY','courts_db',''),
    ('nycityct','NY','courts_db',''),
    ('nyclintonctyct','NY','courts_db',''),
    ('nycolumctyct','NY','courts_db',''),
    ('nycortlandctyct','NY','courts_db',''),
    ('nycountyct','NY','courts_db',''),
    ('nycountyctny','NY','courts_db',''),
    ('nydutchessctyct','NY','courts_db',''),
    ('nyeriectyct','NY','courts_db',''),
    ('nyessexctyct','NY','courts_db',''),
    ('nyfrankctyct','NY','courts_db',''),
    ('nyfultonctyct','NY','courts_db',''),
    ('nygenessctyct','NY','courts_db',''),
    ('nygreenectyct','NY','courts_db',''),
    ('nyhamilctyct','NY','courts_db',''),
    ('nyherkimerctyct','NY','courts_db',''),
    ('nyjeffctyct','NY','courts_db',''),
    ('nykingsctyct','NY','courts_db',''),
    ('nylewisctyct','NY','courts_db',''),
    ('nylivingstctyct','NY','courts_db',''),
    ('nymadctyct','NY','courts_db',''),
    ('nymonroectyct','NY','courts_db',''),
    ('nymontctyct','NY','courts_db',''),
    ('nynassctyct','NY','courts_db',''),
    ('nyniagaractyct','NY','courts_db',''),
    ('nyoniedactyct','NY','id_prefix','nyo'),
    ('nyonondagactyct','NY','courts_db',''),
    ('nyontarioctyct','NY','courts_db',''),
    ('nyorangectyct','NY','courts_db',''),
    ('nyorleansctyct','NY','courts_db',''),
    ('nyoswegoctyct','NY','courts_db',''),
    ('nyotsegoctyct','NY','courts_db',''),
    ('nyputnamctyct','NY','courts_db',''),
    ('nyqueensctyct','NY','courts_db',''),
    ('nyrensctyct','NY','courts_db',''),
    ('nyrichmondctyct','NY','id_prefix','ny'),
    ('nyrocklandctyct','NY','courts_db',''),
    ('nysaratogactyct','NY','courts_db',''),
    ('nyschenctyct','NY','courts_db',''),
    ('nyschoharctyct','NY','courts_db',''),
    ('nyschuylerctyct','NY','courts_db',''),
    ('nysenctyct','NY','courts_db',''),
    ('nysteubenctyct','NY','courts_db',''),
    ('nystlawctyct','NY','courts_db',''),
    ('nysuffolkctyct','NY','courts_db',''),
    ('nysullivanctyct','NY','courts_db',''),
    ('nytiogactyct','NY','courts_db',''),
    ('nytompkinsctyct','NY','courts_db',''),
    ('nyulsterctyct','NY','courts_db',''),
    ('nywarrenctyct','NY','courts_db',''),
    ('nywaynectyct','NY','courts_db',''),
    ('nywestchcty','NY','courts_db',''),
    ('nyyatesctyct','NY','courts_db',''),
    ('ohctinsolv','OH','courts_db',''),
    ('ohiocountyct','OH','courts_db',''),
    ('orcc','OR','courts_db',''),
    ('texctyct','TX','id_prefix','texc'),
    ('texctyct1','TX','id_prefix','texc'),
    ('texctyct10','TX','id_prefix','texc'),
    ('texctyct100','TX','id_prefix','texc'),
    ('texctyct101','TX','id_prefix','texc'),
    ('texctyct102','TX','id_prefix','texc'),
    ('texctyct103','TX','id_prefix','texc'),
    ('texctyct104','TX','id_prefix','texc'),
    ('texctyct105','TX','id_prefix','texc'),
    ('texctyct106','TX','id_prefix','texc'),
    ('texctyct107','TX','id_prefix','texc'),
    ('texctyct108','TX','id_prefix','texc'),
    ('texctyct109','TX','id_prefix','texc'),
    ('texctyct11','TX','id_prefix','texc'),
    ('texctyct110','TX','id_prefix','texc'),
    ('texctyct111','TX','id_prefix','texc'),
    ('texctyct112','TX','id_prefix','texc'),
    ('texctyct113','TX','id_prefix','texc'),
    ('texctyct114','TX','id_prefix','texc'),
    ('texctyct115','TX','id_prefix','texc'),
    ('texctyct116','TX','id_prefix','texc'),
    ('texctyct117','TX','id_prefix','texc'),
    ('texctyct118','TX','id_prefix','texc'),
    ('texctyct119','TX','id_prefix','texc'),
    ('texctyct12','TX','id_prefix','texc'),
    ('texctyct120','TX','id_prefix','texc'),
    ('texctyct121','TX','id_prefix','texc'),
    ('texctyct122','TX','id_prefix','texc'),
    ('texctyct123','TX','id_prefix','texc'),
    ('texctyct124','TX','id_prefix','texc'),
    ('texctyct125','TX','id_prefix','texc'),
    ('texctyct126','TX','id_prefix','texc'),
    ('texctyct127','TX','id_prefix','texc'),
    ('texctyct128','TX','id_prefix','texc'),
    ('texctyct129','TX','id_prefix','texc'),
    ('texctyct13','TX','id_prefix','texc'),
    ('texctyct130','TX','id_prefix','texc'),
    ('texctyct131','TX','id_prefix','texc'),
    ('texctyct132','TX','id_prefix','texc'),
    ('texctyct133','TX','id_prefix','texc'),
    ('texctyct134','TX','id_prefix','texc'),
    ('texctyct135','TX','id_prefix','texc'),
    ('texctyct136','TX','id_prefix','texc'),
    ('texctyct137','TX','id_prefix','texc'),
    ('texctyct138','TX','id_prefix','texc'),
    ('texctyct139','TX','id_prefix','texc'),
    ('texctyct14','TX','id_prefix','texc'),
    ('texctyct140','TX','id_prefix','texc'),
    ('texctyct141','TX','id_prefix','texc'),
    ('texctyct142','TX','id_prefix','texc'),
    ('texctyct143','TX','id_prefix','texc'),
    ('texctyct144','TX','id_prefix','texc'),
    ('texctyct145','TX','id_prefix','texc'),
    ('texctyct146','TX','id_prefix','texc'),
    ('texctyct147','TX','id_prefix','texc'),
    ('texctyct148','TX','id_prefix','texc'),
    ('texctyct149','TX','id_prefix','texc'),
    ('texctyct15','TX','id_prefix','texc'),
    ('texctyct150','TX','id_prefix','texc'),
    ('texctyct151','TX','id_prefix','texc'),
    ('texctyct152','TX','id_prefix','texc'),
    ('texctyct153','TX','id_prefix','texc'),
    ('texctyct154','TX','id_prefix','texc'),
    ('texctyct155','TX','id_prefix','texc'),
    ('texctyct156','TX','id_prefix','texc'),
    ('texctyct157','TX','id_prefix','texc'),
    ('texctyct16','TX','id_prefix','texc'),
    ('texctyct17','TX','id_prefix','texc'),
    ('texctyct18','TX','id_prefix','texc'),
    ('texctyct19','TX','id_prefix','texc'),
    ('texctyct2','TX','id_prefix','texc'),
    ('texctyct20','TX','id_prefix','texc'),
    ('texctyct21','TX','id_prefix','texc'),
    ('texctyct22','TX','id_prefix','texc'),
    ('texctyct23','TX','id_prefix','texc'),
    ('texctyct24','TX','id_prefix','texc'),
    ('texctyct25','TX','id_prefix','texc'),
    ('texctyct26','TX','id_prefix','texc'),
    ('texctyct27','TX','id_prefix','texc'),
    ('texctyct28','TX','id_prefix','texc'),
    ('texctyct29','TX','id_prefix','texc'),
    ('texctyct3','TX','id_prefix','texc'),
    ('texctyct30','TX','id_prefix','texc'),
    ('texctyct31','TX','id_prefix','texc'),
    ('texctyct32','TX','id_prefix','texc'),
    ('texctyct33','TX','id_prefix','texc'),
    ('texctyct34','TX','id_prefix','texc'),
    ('texctyct35','TX','id_prefix','texc'),
    ('texctyct36','TX','id_prefix','texc'),
    ('texctyct37','TX','id_prefix','texc'),
    ('texctyct38','TX','id_prefix','texc'),
    ('texctyct39','TX','id_prefix','texc'),
    ('texctyct4','TX','id_prefix','texc'),
    ('texctyct40','TX','id_prefix','texc'),
    ('texctyct41','TX','id_prefix','texc'),
    ('texctyct42','TX','id_prefix','texc'),
    ('texctyct43','TX','id_prefix','texc'),
    ('texctyct44','TX','id_prefix','texc'),
    ('texctyct45','TX','id_prefix','texc'),
    ('texctyct46','TX','id_prefix','texc'),
    ('texctyct47','TX','id_prefix','texc'),
    ('texctyct48','TX','id_prefix','texc'),
    ('texctyct49','TX','id_prefix','texc'),
    ('texctyct5','TX','id_prefix','texc'),
    ('texctyct50','TX','id_prefix','texc'),
    ('texctyct51','TX','id_prefix','texc'),
    ('texctyct52','TX','id_prefix','texc'),
    ('texctyct53','TX','id_prefix','texc'),
    ('texctyct54','TX','id_prefix','texc'),
    ('texctyct55','TX','id_prefix','texc'),
    ('texctyct56','TX','id_prefix','texc'),
    ('texctyct57','TX','id_prefix','texc'),
    ('texctyct58','TX','id_prefix','texc'),
    ('texctyct59','TX','id_prefix','texc'),
    ('texctyct6','TX','id_prefix','texc'),
    ('texctyct60','TX','id_prefix','texc'),
    ('texctyct61','TX','id_prefix','texc'),
    ('texctyct62','TX','id_prefix','texc'),
    ('texctyct63','TX','id_prefix','texc'),
    ('texctyct64','TX','id_prefix','texc'),
    ('texctyct65','TX','id_prefix','texc'),
    ('texctyct66','TX','id_prefix','texc'),
    ('texctyct67','TX','id_prefix','texc'),
    ('texctyct68','TX','id_prefix','texc'),
    ('texctyct69','TX','id_prefix','texc'),
    ('texctyct7','TX','id_prefix','texc'),
    ('texctyct70','TX','id_prefix','texc'),
    ('texctyct71','TX','id_prefix','texc'),
    ('texctyct72','TX','id_prefix','texc'),
    ('texctyct73','TX','id_prefix','texc'),
    ('texctyct74','TX','id_prefix','texc'),
    ('texctyct75','TX','id_prefix','texc'),
    ('texctyct76','TX','id_prefix','texc'),
    ('texctyct77','TX','id_prefix','texc'),
    ('texctyct78','TX','id_prefix','texc'),
    ('texctyct79','TX','id_prefix','texc'),
    ('texctyct8','TX','id_prefix','texc'),
    ('texctyct80','TX','id_prefix','texc'),
    ('texctyct81','TX','id_prefix','texc'),
    ('texctyct82','TX','id_prefix','texc'),
    ('texctyct83','TX','id_prefix','texc'),
    ('texctyct84','TX','id_prefix','texc'),
    ('texctyct85','TX','id_prefix','texc'),
    ('texctyct86','TX','id_prefix','texc'),
    ('texctyct87','TX','id_prefix','texc'),
    ('texctyct88','TX','id_prefix','texc'),
    ('texctyct89','TX','id_prefix','texc'),
    ('texctyct9','TX','id_prefix','texc'),
    ('texctyct90','TX','id_prefix','texc'),
    ('texctyct91','TX','id_prefix','texc'),
    ('texctyct92','TX','id_prefix','texc'),
    ('texctyct93','TX','id_prefix','texc'),
    ('texctyct94','TX','id_prefix','texc'),
    ('texctyct95','TX','id_prefix','texc'),
    ('texctyct96','TX','id_prefix','texc'),
    ('texctyct97','TX','id_prefix','texc'),
    ('texctyct98','TX','id_prefix','texc'),
    ('texctyct99','TX','id_prefix','texc')),
st(code, name) as (values ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),('CO','Colorado'),('CT','Connecticut'),('DE','Delaware'),('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),('IL','Illinois'),('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),('ME','Maine'),('MD','Maryland'),('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),('MS','Mississippi'),('MO','Missouri'),('MT','Montana'),('NE','Nebraska'),('NV','Nevada'),('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),('NC','North Carolina'),('ND','North Dakota'),('OH','Ohio'),('OK','Oklahoma'),('OR','Oregon'),('PA','Pennsylvania'),('RI','Rhode Island'),('SC','South Carolina'),('SD','South Dakota'),('TN','Tennessee'),('TX','Texas'),('UT','Utah'),('VT','Vermont'),('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),('WI','Wisconsin'),('WY','Wyoming'),('DC','District of Columbia'),('PR','Puerto Rico'),('GU','Guam'),('VI','Virgin Islands'),('MP','Northern Mariana Islands'),('AS','American Samoa')),
tgt as materialized (
 select c.court_id, c.code, c.kind, c.prefix, s.name as st_name, r.title, r.state as old_state, r.item, r.detail, r.text, r.filters, md5(to_jsonb(r)::text) as row_md5
 from cand c
 join st s on s.code = c.code
 join public.corpus_records r on r.dataset = 'court_spine' and r.id = c.court_id
 join public.corpus_workspace_court_map m on m.court_id = c.court_id
 where r.state = '' and m.state = '' and m.system = 'state' and r.item->'cells'->>'system' = 'State'
   and position(s.name in r.title) > 0
   and (select count(*) from st s2 where position(s2.name in r.title) > 0
          and not exists (select 1 from st s3 where s3.name <> s2.name and position(s3.name in r.title) > 0 and position(s2.name in s3.name) > 0)) = 1
   and (c.kind <> 'id_prefix' or ((select count(*) from public.corpus_records p where p.dataset = 'court_spine' and p.state <> '' and p.item->'cells'->>'system' = 'State' and p.id like c.prefix || '%') >= 5
        and (select count(distinct p.state) from public.corpus_records p where p.dataset = 'court_spine' and p.state <> '' and p.item->'cells'->>'system' = 'State' and p.id like c.prefix || '%') = 1
        and (select min(p.state) from public.corpus_records p where p.dataset = 'court_spine' and p.state <> '' and p.item->'cells'->>'system' = 'State' and p.id like c.prefix || '%') = c.code))
   and (length(r.text) - length(replace(r.text, ' System State ', ''))) = length(' System State ')),
fx0 as (
 select t.*,
        t.code || ' — state name printed in the CourtListener court name, confirmed by ' ||
          case t.kind when 'courts_db' then 'courts-db 0.10.27 (location ' || t.st_name || ')'
                      else 'the CourtListener id prefix "' || t.prefix || '" (every other court with that prefix and a state is ' || t.code || ')' end as fact_text
 from tgt t),
fx as (
 select f.court_id, f.code, f.kind, f.prefix, f.title, f.old_state, f.item as old_item, f.detail as old_detail, f.text as old_text, f.filters as old_filters, f.row_md5, f.fact_text,
        jsonb_set(f.item, '{cells,state}', to_jsonb(f.code)) as new_item,
        jsonb_set(f.detail, '{facts}', (select jsonb_agg(q.x order by q.ord) from (
            select e.v as x, e.o * 2 as ord from jsonb_array_elements(f.detail->'facts') with ordinality e(v, o)
            union all
            select jsonb_build_array('State', f.fact_text), e.o * 2 + 1 from jsonb_array_elements(f.detail->'facts') with ordinality e(v, o) where e.v->>0 = 'System') q)) as new_detail,
        jsonb_set(f.filters, '{state}', jsonb_build_array(f.code)) as new_filters,
        replace(f.text, ' System State ', ' System State State ' || f.fact_text || ' ') as new_text
 from fx0 f),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'court_spine', x.court_id, 'dq20261003r4_court_state_fill', 'label_override',
  'The directory leaves State empty when the printed state name is followed by County/City. Filled where a second independent signal (courts-db location, or the CourtListener id prefix shared with courts that already have this state) agrees; the six homonym traps are excluded. The published court name is not changed.',
  jsonb_build_object('review_version','court-spine-state-fill/2026-10-03.r4.1','state',x.code,'signal',x.kind,'id_prefix',nullif(x.prefix,''),'approved_by','coordinator (decision 1 after the round-3 review)'),
  jsonb_build_object('id',x.court_id,'title',x.title,'state',x.old_state,'item',x.old_item,'detail',x.old_detail,'text',x.old_text,'filters',x.old_filters,'row_md5',x.row_md5),
  jsonb_build_object('title',x.title,'state',x.code,'item',x.new_item,'detail',x.new_detail,'text',x.new_text,'filters',x.new_filters),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from fx x where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from cand) candidates, (select count(*) from tgt) passing_guards, (select count(*) from ins) audit_rows_written,
       (select string_agg(code || '=' || n, ', ' order by code) from (select code, count(*) n from fx group by code) q) by_state;

-- ===== statement 2: apply (spine) =====
with u as (
 update public.corpus_records r
    set title = c.replacement->>'title', state = c.replacement->>'state', item = c.replacement->'item', detail = c.replacement->'detail',
        text = c.replacement->>'text', filters = c.replacement->'filters'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'court_spine' and c.issue = 'dq20261003r4_court_state_fill' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and r.dataset = 'court_spine' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: audit (map) =====
with flag as (select true as apply),
tgt as materialized (
 select m.court_id, to_jsonb(m) as old_row, md5(to_jsonb(m)::text) as row_md5, s.state as s_state, s.detail->'facts' as s_facts
 from public.corpus_workspace_court_map m
 join public.corpus_records s on s.dataset = 'court_spine' and s.id = m.court_id
 join corpus_ingest.cleanup_decisions c on c.dataset = 'court_spine' and c.record_id = m.court_id and c.issue = 'dq20261003r4_court_state_fill' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
 where m.state is distinct from s.state or m.facts is distinct from s.detail->'facts'),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_workspace_court_map', t.court_id, 'dq20261003r4_court_map_state_fill', 'label_override',
  'Map follows the directory (state and facts are byte-copies of the directory row).',
  jsonb_build_object('review_version','court-spine-state-fill/2026-10-03.r4.1','source','court_spine state and detail.facts','approved_by','coordinator (decision 1)'),
  jsonb_build_object('row', t.old_row, 'row_md5', t.row_md5),
  jsonb_build_object('state', t.s_state, 'facts', t.s_facts),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from tgt t where (select apply from flag)
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from tgt) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 4: apply (map) =====
with u as (
 update public.corpus_workspace_court_map m
    set state = c.replacement->>'state', facts = c.replacement->'facts'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'corpus_workspace_court_map' and c.issue = 'dq20261003r4_court_map_state_fill' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
    and m.court_id = c.record_id and md5(to_jsonb(m)::text) = c.original_record->>'row_md5'
 returning m.court_id)
select count(*) updated from u;

-- ===== statement 5: facet counts of the court_spine State filter (audit + apply in one statement; one dataset row) =====
with ds as (select id, metadata from public.corpus_datasets where id = 'court_spine' and not (metadata ? 'accuracy_review_r4_state')),
cnt as (
 select e.key as fname, x.val as oval, count(*) as n
 from public.corpus_records r
 cross join lateral jsonb_each(r.filters) e
 cross join lateral (
   select jsonb_array_elements_text(e.value) as val where jsonb_typeof(e.value) = 'array'
   union all
   select e.value #>> '{}' where jsonb_typeof(e.value) in ('string','number','boolean')) x
 where r.dataset = 'court_spine' and e.key not like '\_\_%' escape '\'
 group by 1, 2),
nf as (
 select jsonb_agg(
   case when f->>'type' = 'select' and jsonb_typeof(f->'options') = 'array' then
     jsonb_set(f, '{options}', coalesce((
        select jsonb_agg(jsonb_set(o, '{count}', to_jsonb(c.n)) order by ord)
        from jsonb_array_elements(f->'options') with ordinality as t(o, ord)
        join cnt c on c.fname = f->>'name' and c.oval = o->>'value'), '[]'::jsonb))
   else f end order by fo) as new_filters
 from ds, jsonb_array_elements(ds.metadata->'listing'->'filters') with ordinality as ft(f, fo)),
aud as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', ds.id, 'dq20261003r4_court_spine_state_facets', 'label_override',
  'State filter counts follow the 223 filled rows; recomputed from live corpus_records.filters (same containment semantics as corpus_query_bounded).',
  jsonb_build_object('review_version','court-spine-state-fill/2026-10-03.r4.1','semantics','filters @> {name:value} OR filters @> {name:[value]}'),
  jsonb_build_object('id', ds.id, 'listing_filters', ds.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', nf.new_filters),
  'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
 from ds cross join nf where ds.metadata->'listing'->'filters' is distinct from nf.new_filters
 on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{listing,filters}', nf.new_filters)
                   || jsonb_build_object('accuracy_review_r4_state', jsonb_build_object('version','court-spine-state-fill/2026-10-03.r4.1','run_id','c41d48ea-d3fb-4362-bda3-a959b127a4cb','applied_at',now())),
        updated_at = now()
   from ds, nf, aud a
  where d.id = 'court_spine'
 returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;
