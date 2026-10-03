-- mdls-cl-docket-id-fill/2026-10-03.r4.1  (run c41d48ea-d3fb-4362-bda3-a959b127a4cb; coordinator decision 3 after the round-3 review)
-- Scope: public.corpus_records dataset='mdls' (179 rows) and the mdls metadata copies in public.corpus_datasets.
-- Decision (coordinator): "fill mdls.cl_docket_id where the zero-padded master docket matches exactly one CourtListener docket, but where mdl-members' registry already resolved the master
--   CL id, use the registry's id; never fill ambiguous ones (2804 has three CL dockets, 3014 has a crosswalk conflict)."
-- Registry: _work/contracts/registry-master-ids.md (owner mdl-members, generated 2026-10-03T15:37Z): fill only when exactly one "CourtListener id used" is listed and it is not blocked; leave AMBIGUOUS, CONFLICT and
--   BLOCKED rows empty. The registry rows are the VALUES list "reg" below (31 exact, not blocked).
-- Problem: 161 of 179 MDLs have no item.cl_docket_id (18 have one from the September CourtListener search). 158 of the 161 print a master docket and a CourtListener court id.
-- Rule (per MDL without an id): normalise the printed master docket by zero-padding its last number to 5 digits (4:22-md-3047 -> 4:22-md-03047, the form CourtListener stores) and look it up in the
--   CourtListener docket headers saved in corpus_ingest.entities (source courtlistener, entity_type dockets; court_id + docket_number):
--     exactly 1 header   -> fill (132 MDLs; 21 of them are also registry rows and agree on the id);
--     2 or more headers  -> leave empty (2804 three dockets, 3143 three, 3014 two, 3010 two);
--     0 headers          -> leave empty (22 MDLs whose master is a member-style civil number not saved here).
--   Registry-only row: MDL 2606 prints no master docket in the JPML data; the registry resolved njd 1:15-md-02606 -> 5838695 by exact header join, and the saved header agrees -> fill.
--   Excluded although the header matches exactly: 2885 (3:19-md-02885 -> 14916674) and 2921 (2:19-md-02921 -> 16684846), blocked at source in the registry (leave empty by the registry contract); 2738, 2800
--   are blocked as well (2738 already has its September id; 2800 prints no master docket); 2545 is ambiguous in the registry (4261857 and 18704765); 3014 is a registry CONFLICT.
--   Cross-check: where the MDL has a CourtListener person id for its transferee judge (judge_cl_person_id) and the docket header has assigned_to, they must agree (21 compared, 0 disagree).
-- Change (additive, nothing removed): item.cl_docket_id (number, same type as the 18 existing) and item.cl_docket_id_basis (hidden from the page as a "basis" field; values
--   cl_docket_header_exact_court_and_number | cl_docket_header_exact_court_and_number+sw_matter_registry | sw_matter_registry_exact_header_join); detail.summary (an exact copy of item) follows.
--   filters, text, ordinals are unchanged. Dataset metadata: listing.results and filter_index (exact copies of the live item / filters) are regenerated; accuracy_review_r4_cl_docket_id records the run.
-- Before-image: whole item / detail + whole-row md5 (issue dq20261003r4_mdls_cl_docket_id); metadata keys (issue dq20261003r4_mdls_cl_docket_metadata). Execute statements 1..3 in order.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'mdls' and c.issue = 'dq20261003r4_mdls_cl_docket_id' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and r.dataset = 'mdls' and r.id = c.record_id;
--   update public.corpus_datasets d
--      set metadata = (jsonb_set(jsonb_set(d.metadata, '{listing,results}', c.original_record->'listing_results'), '{filter_index}', c.original_record->'filter_index')) - 'accuracy_review_r4_cl_docket_id', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'corpus_datasets' and c.issue = 'dq20261003r4_mdls_cl_docket_metadata' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb' and d.id = c.record_id;
--
-- ===== statement 1: audit =====
with flag as (select true as apply),
excl(id, why) as (values
  ('2738','blocked at source (registry)'),('2885','blocked at source (registry)'),('2921','blocked at source (registry)'),('2800','blocked at source (registry)'),
  ('2804','ambiguous: three CourtListener dockets share court and number'),('3143','ambiguous: three CourtListener dockets share court and number'),
  ('3010','ambiguous: two CourtListener dockets share court and number'),('2545','ambiguous (registry): two CourtListener dockets share court and number'),
  ('3014','registry CONFLICT: the firm crosswalk id is excluded, no id is filled')),
reg(id, cl_id, court, dn) as (values
  ('3047',65407433,'cand','4:22-md-03047'),('3140',69674950,'flnd','3:25md3140'),('3094',68222905,'paed','2:24-md-03094'),('3163',72052106,'paed','2:25-md-03163'),
  ('3180',73443394,'njd','3:26-md-03180'),('3166',72030009,'cand','3:25-md-03166'),('3080',67665081,'njd','2:23-md-3080'),('3113',68869775,'njd','2:24-md-3113'),
  ('3081',67678440,'azd','2:23-md-03081'),('2846',7603829,'ohsd','2:18-md-02846'),('2873',8408916,'scd','2:18-mn-02873'),('3108',68837976,'mnd','0:24-md-03108'),
  ('3149',69912599,'casd','3:25-md-03149'),('3114',68936135,'txnd','3:24-md-03114'),('3185',73454806,'moed','4:26-md-03185'),('3125',69255166,'casd','3:24-md-03125'),
  ('3144',69871659,'cacd','2:25-ml-03144'),('3043',65408277,'nysd','1:22-md-03043'),('3060',66801859,'ilnd','1:23-cv-00818'),('2741',5981306,'cand','3:16-md-02741'),
  ('3026',61690868,'ilnd','1:22-cv-00071'),('2924',16813256,'flsd','9:20-md-02924'),('2323',4369937,'paed','2:12-md-02323'),('2973',18753355,'njd','2:20-md-02973'),
  ('2789',6224301,'njd','2:17-md-02789'),('2672',4182438,'cand','3:15-md-02672'),('2843',7067512,'cand','3:18-md-02843'),('3031',63363039,'mnd','0:22-md-03031'),
  ('2606',5838695,'njd','1:15-md-02606'),('2592',4270519,'laed','2:14-md-02592'),('2782',6078886,'gand','1:17-md-02782')),
d as materialized (
  select e.native_id, e.data->>'court_id' as court, e.data->>'docket_number' as dn, substring(e.data->>'assigned_to' from '/people/([0-9]+)/') as aid
  from corpus_ingest.entities e where e.source_system = 'courtlistener' and e.entity_type = 'dockets'),
tgt as materialized (
  select r.id, r.item, r.detail, md5(to_jsonb(r)::text) as row_md5, r.item->>'master_docket' as md, r.item->>'cl_court_id' as court, r.item->>'judge_cl_person_id' as jid,
         regexp_match(r.item->>'master_docket', '^(.*?)([0-9]+)$') as mm
  from public.corpus_records r where r.dataset = 'mdls' and (r.item->>'cl_docket_id') is null and r.detail->'summary' = r.item),
m1 as (
  select t.*, t.mm[1] || lpad(t.mm[2], 5, '0') as norm_dn,
         (select count(*) from d where d.court = t.court and d.dn = t.mm[1] || lpad(t.mm[2], 5, '0')) as n_match,
         (select min(d.native_id) from d where d.court = t.court and d.dn = t.mm[1] || lpad(t.mm[2], 5, '0')) as cand_id,
         (select min(d.aid) from d where d.court = t.court and d.dn = t.mm[1] || lpad(t.mm[2], 5, '0')) as cand_aid
  from tgt t where t.md is not null and t.court is not null and t.mm is not null),
cand as (
  select m.id, m.row_md5, m.item, m.detail, m.cand_id::bigint as cl_id,
         case when r.id is not null then 'cl_docket_header_exact_court_and_number+sw_matter_registry' else 'cl_docket_header_exact_court_and_number' end as basis
  from m1 m left join reg r on r.id = m.id
  where m.n_match = 1 and m.id not in (select id from excl)
    and (m.jid is null or m.cand_aid is null or m.jid = m.cand_aid)
    and (r.id is null or r.cl_id::text = m.cand_id)
  union all
  select t.id, t.row_md5, t.item, t.detail, r.cl_id::bigint, 'sw_matter_registry_exact_header_join'
  from tgt t join reg r on r.id = t.id
  join d on d.native_id = r.cl_id::text and d.court = r.court and d.dn = r.dn
  where (t.md is null or t.court is null) and t.id not in (select id from excl)),
fx as (
  select c.*, c.item || jsonb_build_object('cl_docket_id', c.cl_id, 'cl_docket_id_basis', c.basis) as new_item from cand c),
ins as (
  insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
  select 'mdls', x.id, 'dq20261003r4_mdls_cl_docket_id', 'label_override',
   'Additive CourtListener docket id of the MDL master docket: the printed master docket (last number zero-padded to 5 digits) and the CourtListener court id match exactly one saved CourtListener docket header; the registry id is used where the registry resolved it. No value removed.',
   jsonb_build_object('review_version','mdls-cl-docket-id-fill/2026-10-03.r4.1','basis',x.basis,'cl_docket_id',x.cl_id,'registry_file','_work/contracts/registry-master-ids.md','approved_by','coordinator (decision 3, with the registry coordination)'),
   jsonb_build_object('id',x.id,'item',x.item,'detail',x.detail,'row_md5',x.row_md5),
   jsonb_build_object('item',x.new_item,'detail',jsonb_set(x.detail, '{summary}', x.new_item)),
   'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
  from fx x where (select apply from flag)
  on conflict (dataset,record_id,issue) do nothing
  returning record_id)
select (select count(*) from tgt) mdls_without_id, (select count(*) from m1 where n_match = 1) exactly_one_header, (select count(*) from m1 where n_match > 1) ambiguous, (select count(*) from m1 where n_match = 0) no_header,
       (select count(*) from fx) candidates, (select count(*) from fx where basis like '%registry%') with_registry, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply =====
with u as (
  update public.corpus_records r
     set item = c.replacement->'item', detail = c.replacement->'detail'
    from corpus_ingest.cleanup_decisions c
   where c.dataset = 'mdls' and c.issue = 'dq20261003r4_mdls_cl_docket_id' and c.run_id = 'c41d48ea-d3fb-4362-bda3-a959b127a4cb'
     and r.dataset = 'mdls' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
  returning r.id)
select count(*) updated from u;

-- ===== statement 3: regenerate the mdls metadata copies of item / filters and record the run (audit + apply in one statement; one row) =====
with old as (select d.id, d.metadata from public.corpus_datasets d where d.id = 'mdls' and not (d.metadata ? 'accuracy_review_r4_cl_docket_id')),
live as (select r.id, r.title, r.ordinal, r.item, r.filters from public.corpus_records r where r.dataset = 'mdls'),
oldfi as (select f.value->>'id' as id, f.value->>'search' as search from old, jsonb_array_elements(old.metadata->'filter_index') f),
newres as (select jsonb_agg(l.item order by l.ordinal) as o from live l),
newfi as (
  select jsonb_agg(jsonb_build_object('id', l.id, 'item', l.item, 'filters', l.filters,
           'search', coalesce(o.search, lower(l.title) || ' ' || l.id || ' mdl-' || l.id || ' mdl ' || l.id)) order by l.ordinal) as o
  from live l left join oldfi o on o.id = l.id),
sums as (select count(*) filter (where item->>'cl_docket_id' is not null) as with_id, count(*) as records from live),
aud as (
  insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
  select 'corpus_datasets', 'mdls', 'dq20261003r4_mdls_cl_docket_metadata', 'label_override',
   'listing.results and filter_index are exact copies of the live item/filters; regenerated after the additive cl_docket_id fill.',
   jsonb_build_object('review_version','mdls-cl-docket-id-fill/2026-10-03.r4.1','approved_by','coordinator (decision 3)'),
   jsonb_build_object('id','mdls','listing_results',o.metadata->'listing'->'results','filter_index',o.metadata->'filter_index'),
   jsonb_build_object('records', s.records, 'with_cl_docket_id', s.with_id),
   'c41d48ea-d3fb-4362-bda3-a959b127a4cb'::uuid
  from old o cross join sums s on conflict (dataset,record_id,issue) do nothing returning record_id),
upd as (
  update public.corpus_datasets d
     set metadata = jsonb_set(jsonb_set(o.metadata, '{listing,results}', nr.o), '{filter_index}', nf.o)
                    || jsonb_build_object('accuracy_review_r4_cl_docket_id', jsonb_build_object('version','mdls-cl-docket-id-fill/2026-10-03.r4.1','run_id','c41d48ea-d3fb-4362-bda3-a959b127a4cb','as_of','2026-10-03',
                         'added_item_fields', jsonb_build_array('cl_docket_id','cl_docket_id_basis'),'mdls_with_cl_docket_id', s.with_id,'mdls', s.records,
                         'rule','exact CourtListener court id + zero-padded master docket number (one header), registry id where resolved; ambiguous, conflict and blocked masters stay empty')),
         updated_at = now()
    from old o, newres nr, newfi nf, sums s, aud a
   where d.id = 'mdls'
  returning d.id)
select (select count(*) from aud) audit_rows, (select count(*) from upd) datasets_updated;
