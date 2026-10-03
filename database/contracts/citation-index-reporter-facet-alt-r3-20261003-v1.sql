-- citation-index-reporter-facet-alt/2026-10-03.r3.1  (round 3 run c490cdf1-b32e-46ae-95c5-788cdeba3f33; approved by the coordinator after the round-2 review)
-- Work item A follow-up. After the round-2 spacing/punctuation pass, 1,353 citation_index rows still carried a reporter facet that is an ALTERNATE ABBREVIATION of the reporter
-- eyecite parses out of the title ('Fed. Reg.' vs 'FR' 907+17, 'Public Law' vs 'Pub. L.' 154, 'Fed. Appx.' vs "F. App'x" 103, 'U.S.C.A.' / 'United States Code' / 'U.S. Code' vs 'U.S.C.' 73, ...).
-- Rule (approved: canonical form from reporters-db, originals kept in the before-images): the facet is set to the canonical reporter ONLY when reporters-db itself says both spellings are the same reporter -
-- the facet is a key or unique variation (VARIATIONS_ONLY / LAWS.variations / JOURNALS.variations, spacing-insensitive) of the very canonical the title reporter resolves to.
-- 1,332 rows / 30 spellings qualify (mapping below, old facet, reporter in the title, canonical). In every case canonical = the reporter already written in the title.
-- NOT changed (21 rows, reporters-db has no canonical for them): N.Y. consolidated-law names ('N.Y. Penal Law', 'N.Y. Tax Law', ... vs 'N.Y.') and 'Johns. (N.Y.)'.
-- Statement 3 rebuilds metadata.listing.filters[reporter].options (top 60 by count) from the live rows; before-image stored.
-- Execute statements 1, 2, 3 in order.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r3_citation_reporter_facet_alt' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33'
--      and r.dataset='citation_index' and r.id=c.record_id;
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata,'{listing,filters}', c.original_record->'listing_filters'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003r3_citation_reporter_options' and c.run_id='c490cdf1-b32e-46ae-95c5-788cdeba3f33' and c.record_id=d.id;
--
-- ===== statement 1: audit (before-images of filters) =====
with m(old_v, title_reporter, canonical) as (values
    ('Fed. Reg.', 'FR', 'FR'),
    ('Public Law', 'Pub. L.', 'Pub. L.'),
    ('Fed. Appx.', 'F. App''x', 'F. App''x'),
    ('U.S.C.A.', 'U.S.C.', 'U.S.C.'),
    ('T.C.M. (CCH)', 'T.C.M.', 'T.C.M.'),
    ('United States Code', 'U.S.C.', 'U.S.C.'),
    ('Fed.Reg.', 'FR', 'FR'),
    ('U.S.P.Q.2d', 'U.S.P.Q. 2d (BNA)', 'U.S.P.Q. 2d (BNA)'),
    ('Fed.', 'F.', 'F.'),
    ('Fed. R. Serv. 3d (West)', 'Fed. R. Serv. 3d', 'Fed. R. Serv. 3d'),
    ('U.S. Code', 'U.S.C.', 'U.S.C.'),
    ('O.S.H. Cas. (BNA)', 'BNA OSHC', 'BNA OSHC'),
    ('A.F.T.R.2d', 'A.F.T.R.2d (RIA)', 'A.F.T.R.2d (RIA)'),
    ('T.C. at', 'T.C.', 'T.C.'),
    ('USTC', 'U.S. Tax Cas. (CCH)', 'U.S. Tax Cas. (CCH)'),
    ('Nev. Adv. Op.', 'Nev. Adv. Op. No.', 'Nev. Adv. Op. No.'),
    ('Mar.', 'A.K. Marsh.', 'A.K. Marsh.'),
    ('Trade Cas.', 'Trade Cas. (CCH)', 'Trade Cas. (CCH)'),
    ('U.S.P.Q.', 'U.S.P.Q. (BNA)', 'U.S.P.Q. (BNA)'),
    ('Fed. Cas.', 'F. Cas.', 'F. Cas.'),
    ('Fed.Appx.', 'F. App''x', 'F. App''x'),
    ('C.I.T.', 'Ct. Int''l Trade', 'Ct. Int''l Trade'),
    ('Wn.2d', 'Wash. 2d', 'Wash. 2d'),
    ('Pa.Cmwlth.', 'Pa. Commw.', 'Pa. Commw.'),
    ('Peters', 'Pet.', 'Pet.'),
    ('C.', 'Cow.', 'Cow.'),
    ('A.R.', 'A.', 'A.'),
    ('Fed. Appx', 'F. App''x', 'F. App''x'),
    ('U. S. Code', 'U.S.C.', 'U.S.C.'),
    ('Cal.App.4th Supp.', 'Cal. App. Supp. 4th', 'Cal. App. Supp. 4th')
  ),
target as materialized (
 select r.id, r.ordinal, r.title, r.filters as old_filters, m.old_v, m.canonical, m.title_reporter, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r join m on r.filters->'reporter' = jsonb_build_array(m.old_v)
 where r.dataset = 'citation_index' and strpos(r.title, m.title_reporter) > 0),
ins as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'citation_index', t.id, 'dq20261003r3_citation_reporter_facet_alt', 'label_override',
  'Reporter facet held an alternate abbreviation of the reporter named in the title. reporters-db lists both spellings as the same reporter, so the facet is set to the canonical form (one filter option per reporter).',
  jsonb_build_object('review_version','citation-index-reporter-facet-alt/2026-10-03.r3.1','reporters_db','3.2.66','rule','facet is a key or unique variation of the canonical the title reporter resolves to','title_reporter',t.title_reporter,'title',t.title,'approved_by','coordinator (round 2 review)'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'filters',t.old_filters,'row_md5',t.row_md5),
  jsonb_build_object('reporter',t.canonical),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from target t
 on conflict (dataset,record_id,issue) do nothing
 returning record_id)
select (select count(*) from target) targets, (select count(*) from ins) audit_rows_written;

-- ===== statement 2: apply from the audited before-images =====
with u as (
 update public.corpus_records r
    set filters = jsonb_set(r.filters, '{reporter}', jsonb_build_array(c.replacement->>'reporter'))
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'citation_index' and c.issue = 'dq20261003r3_citation_reporter_facet_alt' and c.run_id = 'c490cdf1-b32e-46ae-95c5-788cdeba3f33'
    and r.dataset = 'citation_index' and r.id = c.record_id
    and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) updated from u;

-- ===== statement 3: rebuild the facet option list (audit + apply) =====
with dist as (
 select r.filters->'reporter'->>0 as v, count(*) as n
 from public.corpus_records r where r.dataset = 'citation_index' and jsonb_array_length(r.filters->'reporter') > 0
 group by 1),
top as (select v, n from dist order by n desc, v asc limit 60),
newopts as (select jsonb_agg(jsonb_build_object('count', n, 'label', v, 'value', v) order by n desc, v asc) as o from top),
cur as (select d.id, d.metadata from public.corpus_datasets d where d.id = 'citation_index'),
newf as (
 select cur.id, cur.metadata, jsonb_agg(case when f->>'name' = 'reporter' then jsonb_set(f, '{options}', (select o from newopts)) else f end order by fo) as new_filters
 from cur, jsonb_array_elements(cur.metadata->'listing'->'filters') with ordinality as ft(f, fo)
 group by cur.id, cur.metadata),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', n.id, 'dq20261003r3_citation_reporter_options', 'label_override',
  'Reporter facet alternate abbreviations were mapped to the reporters-db canonical form; the stored option list (top 60 by count) is rebuilt from the live rows so every option count equals the rows the filter returns.',
  jsonb_build_object('review_version','citation-index-reporter-facet-alt/2026-10-03.r3.1','semantics','filters @> {name:[value]}','cap',60),
  jsonb_build_object('id', n.id, 'listing_filters', n.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', n.new_filters),
  'c490cdf1-b32e-46ae-95c5-788cdeba3f33'::uuid
 from newf n
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
updated as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{listing,filters}', n.new_filters)
                   || jsonb_build_object('citation_reporter_facet_review', jsonb_build_object('version','citation-index-reporter-facet-alt/2026-10-03.r3.1','run_id','c490cdf1-b32e-46ae-95c5-788cdeba3f33','recomputed_at',now())),
        updated_at = now()
   from newf n join audited a on a.record_id = n.id
  where d.id = n.id and d.metadata->'listing'->'filters' = n.metadata->'listing'->'filters'
  returning d.id)
select jsonb_build_object('contract','citation-index-reporter-facet-alt/2026-10-03.r3.1 (options)','audit_rows',(select count(*) from audited),'datasets_updated',(select count(*) from updated),
  'options',(select jsonb_array_length(o) from newopts),'checked_at',now()) as receipt;
