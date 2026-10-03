-- citation-index-reporter-facet/2026-10-03.r2.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- Work item A (citations accuracy). The 'Reporter or code' facet (filters.reporter) stored the RAW spelling found in each saved
-- document while the row title holds the eyecite-normalized citation, so one reporter was split over several filter options:
-- 'Cal.App.4th' 641 vs 'Cal. App. 4th' 19, 'L.Ed.2d' 450 vs 'L. Ed. 2d' 554, 'S.Ct.' 190 vs 'S. Ct.' 2,313, 'CFR' 204 vs 'C.F.R.' 656,
-- 'US' 29 / 'U. S.' 7 vs 'U.S.' 10,886, 'F. 3d' 22 / 'F.3d.' 3 / 'F3d' 1 vs 'F.3d' 11,182 ... (94 split reporters, 673 distinct values).
-- Rule (deterministic, proof by the title itself): facet value differs from the reporter eyecite parses out of the title ONLY by
-- spacing, punctuation, case or apostrophe style (alphanumerics identical after lower-casing) -> facet := reporter exactly as written in the title.
-- 6,223 rows / 140 distinct spellings qualify (mapping below; every row also must contain the canonical spelling literally in its title).
-- NOT changed (alternate abbreviations, publisher editions or ambiguous reporters; see findings): 'Fed. Reg.' vs 'FR', 'Public Law' vs
-- 'Pub. L.', 'U.S.C.A.' vs 'U.S.C.', 'Fed. Appx.' vs "F. App'x", 'T.C.M. (CCH)' vs 'T.C.M.', the N.Y. code names, etc. (1,361 rows).
-- Also unchanged: item.links / source_url (CourtListener's /c/ lookup slugifies every spelling: /c/US/.. /c/U.%20S./.. /c/F3d/.. all
-- 302 to /c/us/.., /c/f3d/..; probed 2026-10-03), titles, text, counts, ids.
-- Statement 3 rebuilds metadata.listing.filters[reporter].options (top 60 values by count, count desc then value asc = the builder's
-- 60-option cap) from the live rows, using the corpus_query_bounded semantics (filters @> {name:[value]}); before-image stored.
-- Execute statements 1, 2, 3 in order.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r2_citation_reporter_facet' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'
--      and r.dataset='citation_index' and r.id=c.record_id;
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata,'{listing,filters}', c.original_record->'listing_filters') - 'citation_reporter_facet_review', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003r2_citation_reporter_options' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3' and c.record_id=d.id;
--
-- ===== statement 1: audit (before-images of filters) =====
with m(old_v, new_v) as (values
    ('Cal.App.4th', 'Cal. App. 4th'),
    ('Cal.Rptr.3d', 'Cal. Rptr. 3d'),
    ('Cal.Rptr.', 'Cal. Rptr.'),
    ('L.Ed.2d', 'L. Ed. 2d'),
    ('Cal.Rptr.2d', 'Cal. Rptr. 2d'),
    ('Cal.App.3d', 'Cal. App. 3d'),
    ('Ill.Dec.', 'Ill. Dec.'),
    ('Ill.App.3d', 'Ill. App. 3d'),
    ('Ill.2d', 'Ill. 2d'),
    ('CFR', 'C.F.R.'),
    ('S.Ct.', 'S. Ct.'),
    ('Cal.App.5th', 'Cal. App. 5th'),
    ('Cal.App.2d', 'Cal. App. 2d'),
    ('Cal.4th', 'Cal. 4th'),
    ('L.Ed.', 'L. Ed.'),
    ('Or', 'Or.'),
    ('Cal.3d', 'Cal. 3d'),
    ('Cal.2d', 'Cal. 2d'),
    ('P2d', 'P.2d'),
    ('F. App’x', 'F. App''x'),
    ('Ohio St.3d', 'Ohio St. 3d'),
    ('P3d', 'P.3d'),
    ('F. 2d', 'F.2d'),
    ('Or App', 'Or. App.'),
    ('N.E. 2d', 'N.E.2d'),
    ('F.Supp.', 'F. Supp.'),
    ('F. Supp.2d', 'F. Supp. 2d'),
    ('Pub.L.', 'Pub. L.'),
    ('So.2d', 'So. 2d'),
    ('US', 'U.S.'),
    ('Ill.App.2d', 'Ill. App. 2d'),
    ('S Ct', 'S. Ct.'),
    ('F. 3d', 'F.3d'),
    ('P', 'P.'),
    ('F.Supp.2d', 'F. Supp. 2d'),
    ('USC', 'U.S.C.'),
    ('L Ed', 'L. Ed.'),
    ('Cal.5th', 'Cal. 5th'),
    ('Ill.App.', 'Ill. App.'),
    ('Cal.App.', 'Cal. App.'),
    ('Ohio App.3d', 'Ohio App. 3d'),
    ('L Ed2d', 'L. Ed. 2d'),
    ('Cal.Rptr. 2d', 'Cal. Rptr. 2d'),
    ('Shipping Reg. (P&F)', 'Shipping Reg. (P & F)'),
    ('F.2d.', 'F.2d'),
    ('Ill. App.3d', 'Ill. App. 3d'),
    ('J.App. Prac. & Process', 'J. App. Prac. & Process'),
    ('N.W. 2d', 'N.W.2d'),
    ('Ohio St.2d', 'Ohio St. 2d'),
    ('U. S.', 'U.S.'),
    ('F. Supp', 'F. Supp.'),
    ('F.R.', 'FR'),
    ('L. Ed.2d', 'L. Ed. 2d'),
    ('S.W. 2d', 'S.W.2d'),
    ('L.Ed. 2d', 'L. Ed. 2d'),
    ('P. 2d', 'P.2d'),
    ('F.3d.', 'F.3d'),
    ('F.Supp. 2d', 'F. Supp. 2d'),
    ('N.Y.S. 2d', 'N.Y.S.2d'),
    ('So.3d', 'So. 3d'),
    ('U. S. C.', 'U.S.C.'),
    ('U.S. C.', 'U.S.C.'),
    ('U.S.Patent', 'U.S. Patent'),
    ('Vand.L.Rev.', 'Vand. L. Rev.'),
    ('Wis.2d', 'Wis. 2d'),
    ('A.D. 2d', 'A.D.2d'),
    ('B.C. L.Rev.', 'B.C. L. Rev.'),
    ('Cal. L.Rev.', 'Cal. L. Rev.'),
    ('Cal.Rptr. 3d', 'Cal. Rptr. 3d'),
    ('F 2d', 'F.2d'),
    ('F Supp.', 'F. Supp.'),
    ('F. Appx.', 'F. App''x'),
    ('F. App’x.', 'F. App''x'),
    ('F.Supp', 'F. Supp.'),
    ('F2d', 'F.2d'),
    ('Harv. L.Rev.', 'Harv. L. Rev.'),
    ('MJ', 'M.J.'),
    ('Misc.2d', 'Misc. 2d'),
    ('N.E. 3d', 'N.E.3d'),
    ('Pa.Super.', 'Pa. Super.'),
    ('S.Ct', 'S. Ct.'),
    ('Stan. L.Rev.', 'Stan. L. Rev.'),
    ('T.C. Memo', 'T.C. Memo.'),
    ('U.S.P.Q.2d (BNA)', 'U.S.P.Q. 2d (BNA)'),
    ('Wash.2d', 'Wash. 2d'),
    ('Yale L. J.', 'Yale L.J.'),
    ('A. 2d', 'A.2d'),
    ('A. 3d', 'A.3d'),
    ('A.L.R.2d', 'A.L.R. 2d'),
    ('Am. Bankr. L. J.', 'Am. Bankr. L.J.'),
    ('Am.St.Rep.', 'Am. St. Rep.'),
    ('C. F. R.', 'C.F.R.'),
    ('C.F. R.', 'C.F.R.'),
    ('Cal. Rptr.2d', 'Cal. Rptr. 2d'),
    ('Cal.App. LEXIS', 'Cal. App. LEXIS'),
    ('Cal.L.Rev.', 'Cal. L. Rev.'),
    ('Colum. L.Rev.', 'Colum. L. Rev.'),
    ('Cornell L.Rev.', 'Cornell L. Rev.'),
    ('Duke L. J.', 'Duke L.J.'),
    ('Emory L. J.', 'Emory L.J.'),
    ('F Supp', 'F. Supp.'),
    ('F3d', 'F.3d'),
    ('Fordham Urb. L. J.', 'Fordham Urb. L.J.'),
    ('Ga.L.Rev.', 'Ga. L. Rev.'),
    ('Geo. Wash. L.Rev.', 'Geo. Wash. L. Rev.'),
    ('Harv.L.Rev.', 'Harv. L. Rev.'),
    ('IL App. (1st)', 'IL App (1st)'),
    ('ILApp (4th)', 'IL App (4th)'),
    ('Ill.B.J.', 'Ill. B.J.'),
    ('J. L. & Econ.', 'J.L. & Econ.'),
    ('Mich. L.Rev.', 'Mich. L. Rev.'),
    ('N.Y.U. L.Rev.', 'N.Y.U. L. Rev.'),
    ('NW', 'N.W.'),
    ('Nw. U.L. Rev.', 'Nw. U. L. Rev.'),
    ('Ohio St. L. J.', 'Ohio St. L.J.'),
    ('Okla. City U.L. Rev.', 'Okla. City U. L. Rev.'),
    ('P. 3d', 'P.3d'),
    ('P3.d', 'P.3d'),
    ('Pa. D.&C. 4th', 'Pa. D. & C.4th'),
    ('Pa. D.&C.4th', 'Pa. D. & C.4th'),
    ('Pa.Code', 'Pa. Code'),
    ('Rad. Reg. 2d (P&F)', 'Rad. Reg. 2d (P & F)'),
    ('S. C.', 'S.C.'),
    ('S. C. Code Ann.', 'S.C. Code Ann.'),
    ('S.Cal.L. Rev.', 'S. Cal. L. Rev.'),
    ('S.D. L.Rev.', 'S.D. L. Rev.'),
    ('S.W,2d', 'S.W.2d'),
    ('S.W.2d.', 'S.W.2d'),
    ('SW 3d', 'S.W.3d'),
    ('Stetson L.Rev.', 'Stetson L. Rev.'),
    ('Tenn.App.', 'Tenn. App.'),
    ('Tul. L.Rev.', 'Tul. L. Rev.'),
    ('U. S. App. D. C.', 'U.S. App. D.C.'),
    ('U.Kan. L. Rev.', 'U. Kan. L. Rev.'),
    ('U.Mich.J.L. Reform', 'U. Mich. J.L. Reform'),
    ('U.S.App. LEXIS', 'U.S. App. LEXIS'),
    ('Vet.App.', 'Vet. App.'),
    ('W.Va.', 'W. Va.'),
    ('Wash.U.L.Q.', 'Wash. U. L.Q.'),
    ('Wm. Mitchell L.Rev.', 'Wm. Mitchell L. Rev.')
  ),
target as materialized (
 select r.id, r.ordinal, r.title, r.filters as old_filters, m.old_v, m.new_v, md5(to_jsonb(r)::text) as row_md5
 from public.corpus_records r join m on r.filters->'reporter' = jsonb_build_array(m.old_v)
 where r.dataset = 'citation_index' and strpos(r.title, m.new_v) > 0)
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'citation_index', t.id, 'dq20261003r2_citation_reporter_facet', 'label_override',
  'Reporter facet held the raw spelling from the saved document; the row title holds the eyecite-normalized reporter. Facet differs from it only by spacing/punctuation/case/apostrophe style, so it is set to the reporter exactly as written in the title (one filter option per reporter).',
  jsonb_build_object('review_version','citation-index-reporter-facet/2026-10-03.r2.1','parser','eyecite 2.7.8','rule','alphanumerics identical after lower-casing; canonical spelling literally present in title','title',t.title),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'filters',t.old_filters,'row_md5',t.row_md5),
  jsonb_build_object('reporter',t.new_v),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
from target t
on conflict (dataset,record_id,issue) do nothing
returning record_id;

-- ===== statement 2: apply from the audited before-images =====
update public.corpus_records r
   set filters = jsonb_set(r.filters, '{reporter}', jsonb_build_array(c.replacement->>'reporter'))
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'citation_index' and c.issue = 'dq20261003r2_citation_reporter_facet' and c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
   and r.dataset = 'citation_index' and r.id = c.record_id
   and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
returning r.id;

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
 select 'corpus_datasets', n.id, 'dq20261003r2_citation_reporter_options', 'label_override',
  'Reporter facet values were consolidated (one spelling per reporter); the stored option list (top 60 by count) is rebuilt from the live rows so every option count equals the rows the filter returns.',
  jsonb_build_object('review_version','citation-index-reporter-facet/2026-10-03.r2.1','semantics','filters @> {name:[value]}','cap',60),
  jsonb_build_object('id', n.id, 'listing_filters', n.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', n.new_filters),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
 from newf n
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
updated as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{listing,filters}', n.new_filters)
                   || jsonb_build_object('citation_reporter_facet_review', jsonb_build_object('version','citation-index-reporter-facet/2026-10-03.r2.1','run_id','af6ac9c6-b834-497d-bd19-17970d4857d3','recomputed_at',now())),
        updated_at = now()
   from newf n join audited a on a.record_id = n.id
  where d.id = n.id and d.metadata->'listing'->'filters' = n.metadata->'listing'->'filters'
  returning d.id)
select jsonb_build_object('contract','citation-index-reporter-facet/2026-10-03.r2.1 (options)','audit_rows',(select count(*) from audited),'datasets_updated',(select count(*) from updated),
  'options',(select jsonb_array_length(o) from newopts),'checked_at',now()) as receipt;
