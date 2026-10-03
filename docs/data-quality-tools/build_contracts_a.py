"""Generate the two Round-2 citation contracts from the offline eyecite proof files (no DB access)."""
import collections
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "wt-quality", "database", "contracts"))
RUN = "af6ac9c6-b834-497d-bd19-17970d4857d3"


def q(s):
    return "'" + s.replace("'", "''") + "'"


trail = json.load(open(os.path.join(HERE, "results", "trailing_and_dups.json"), encoding="utf-8"))
plan = json.load(open(os.path.join(HERE, "results", "reporter_facet_plan.json"), encoding="utf-8"))

# ---------------------------------------------------------------- A1: trailing comma
ids = sorted(trail["safe_ids"], key=lambda x: int(x))
assert len(ids) == 250, len(ids)
id_lines = []
line = []
for i in ids:
    line.append(q(i))
    if len(line) == 12:
        id_lines.append(", ".join(line))
        line = []
if line:
    id_lines.append(", ".join(line))
ids_sql = ",\n    ".join(id_lines)

a1 = f"""-- citation-index-trailing-comma/2026-10-03.r2.1  (round 2 run {RUN})
-- Work item A (citations accuracy). Deterministic punctuation defect: 282 citation_index titles end in a stray comma that was
-- captured from the sentence around the citation ("Pub. L. No. 104-208," / "U.S. Patent No. 5,010,782,").
-- Proof (offline, eyecite 2.7.8 + reporters-db 3.2.66): for every id below the comma-stripped string parses as exactly ONE
-- FullCitation whose matched_text() and corrected_citation() both equal the stripped string, i.e. the comma is not part of the citation.
-- 250 of the 282 are fixed here. The other 32 are NOT touched: the stripped string already exists as a separate row
-- (e.g. 21 'Pub. L. No. 104-208,' 89 mentions vs 59679 'Pub. L. No. 104-208' 1 mention); merging them would need summed counts and
-- unioned document sets, which is not a formatting fix (listed in the findings table, docs/data-quality-citations-2026-10-03.md).
-- Guards in SQL: id whitelist AND title ends in [,;:] AND no other citation_index row already has the stripped title (case-insensitive)
-- AND whole-row md5 equals the audited before-image at update time.
-- Mechanics = markdown/html passes: exact old title replaced only where it is a COMPLETE JSON string in item/detail (item.title,
-- item.cells.citation, detail.title, detail.facts 'Authority'); snippets that merely contain the text are untouched; text, filters,
-- links and source_url unchanged; search_vector is recomputed by the existing trigger (token-identical: punctuation is not indexed).
-- Counts/ordinals/ids unchanged; no row deleted.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set title = c.original_record->>'title', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r2_citation_trailing_comma' and c.run_id='{RUN}'
--      and r.dataset='citation_index' and r.id=c.record_id;
--
-- ===== statement 1: audit (before-images) =====
with ids(id) as (select unnest(array[
    {ids_sql}
  ]::text[])),
target as materialized (
 select r.id, r.ordinal, r.title as old_title,
        regexp_replace(btrim(r.title), '[,;:]+$', '') as new_title,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail
 from public.corpus_records r join ids on ids.id = r.id
 where r.dataset = 'citation_index' and r.title ~ '[,;:]$'
   and not exists (select 1 from public.corpus_records x
                    where x.dataset = 'citation_index' and lower(x.title) = lower(regexp_replace(btrim(r.title), '[,;:]+$', ''))))
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'citation_index', t.id, 'dq20261003r2_citation_trailing_comma', 'label_override',
  'Citation title ended in a stray comma taken from the surrounding sentence. eyecite parses the comma-stripped string as the same single citation (matched_text and corrected_citation equal it), so only the punctuation is removed.',
  jsonb_build_object('review_version','citation-index-trailing-comma/2026-10-03.r2.1','parser','eyecite 2.7.8','reporters_db','3.2.66',
                     'proof','comma-stripped string parses as exactly one FullCitation with matched_text = corrected_citation = stripped string'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,'row_md5',t.row_md5),
  jsonb_build_object('title',t.new_title),
  '{RUN}'::uuid
from target t where t.new_title <> '' and t.new_title <> t.old_title
on conflict (dataset,record_id,issue) do nothing
returning record_id;

-- ===== statement 2: apply from the audited before-images =====
update public.corpus_records r
   set title  = c.replacement->>'title',
       item   = replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb,
       detail = replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'citation_index' and c.issue = 'dq20261003r2_citation_trailing_comma' and c.run_id = '{RUN}'
   and r.dataset = 'citation_index' and r.id = c.record_id
   and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
returning r.id;
"""
open(os.path.join(CONTRACTS, "citation-index-trailing-comma-r2-20261003-v1.sql"), "w", encoding="utf-8").write(a1)

# ---------------------------------------------------------------- A2: reporter facet
pairs = collections.OrderedDict()
cnt = collections.Counter()
for p in plan["plan"]:
    if p["rule"] != "squash":
        continue
    pairs[p["old"]] = p["new"]
    cnt[p["old"]] += 1
assert len(pairs) == 140 and sum(cnt.values()) == 6223
vals = ",\n    ".join(f"({q(o)}, {q(n)})" for o, n in sorted(pairs.items(), key=lambda kv: (-cnt[kv[0]], kv[0])))

a2 = f"""-- citation-index-reporter-facet/2026-10-03.r2.1  (round 2 run {RUN})
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
-- 60-option cap) from the live rows, using the corpus_query_bounded semantics (filters @> {{name:[value]}}); before-image stored.
-- Execute statements 1, 2, 3 in order.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set filters = c.original_record->'filters'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r2_citation_reporter_facet' and c.run_id='{RUN}'
--      and r.dataset='citation_index' and r.id=c.record_id;
--   update public.corpus_datasets d set metadata = jsonb_set(d.metadata,'{{listing,filters}}', c.original_record->'listing_filters') - 'citation_reporter_facet_review', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003r2_citation_reporter_options' and c.run_id='{RUN}' and c.record_id=d.id;
--
-- ===== statement 1: audit (before-images of filters) =====
with m(old_v, new_v) as (values
    {vals}
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
  '{RUN}'::uuid
from target t
on conflict (dataset,record_id,issue) do nothing
returning record_id;

-- ===== statement 2: apply from the audited before-images =====
update public.corpus_records r
   set filters = jsonb_set(r.filters, '{{reporter}}', jsonb_build_array(c.replacement->>'reporter'))
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'citation_index' and c.issue = 'dq20261003r2_citation_reporter_facet' and c.run_id = '{RUN}'
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
 select cur.id, cur.metadata, jsonb_agg(case when f->>'name' = 'reporter' then jsonb_set(f, '{{options}}', (select o from newopts)) else f end order by fo) as new_filters
 from cur, jsonb_array_elements(cur.metadata->'listing'->'filters') with ordinality as ft(f, fo)
 group by cur.id, cur.metadata),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', n.id, 'dq20261003r2_citation_reporter_options', 'label_override',
  'Reporter facet values were consolidated (one spelling per reporter); the stored option list (top 60 by count) is rebuilt from the live rows so every option count equals the rows the filter returns.',
  jsonb_build_object('review_version','citation-index-reporter-facet/2026-10-03.r2.1','semantics','filters @> {{name:[value]}}','cap',60),
  jsonb_build_object('id', n.id, 'listing_filters', n.metadata->'listing'->'filters'),
  jsonb_build_object('listing_filters', n.new_filters),
  '{RUN}'::uuid
 from newf n
 on conflict (dataset,record_id,issue) do nothing
 returning record_id),
updated as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{{listing,filters}}', n.new_filters)
                   || jsonb_build_object('citation_reporter_facet_review', jsonb_build_object('version','citation-index-reporter-facet/2026-10-03.r2.1','run_id','{RUN}','recomputed_at',now())),
        updated_at = now()
   from newf n join audited a on a.record_id = n.id
  where d.id = n.id and d.metadata->'listing'->'filters' = n.metadata->'listing'->'filters'
  returning d.id)
select jsonb_build_object('contract','citation-index-reporter-facet/2026-10-03.r2.1 (options)','audit_rows',(select count(*) from audited),'datasets_updated',(select count(*) from updated),
  'options',(select jsonb_array_length(o) from newopts),'checked_at',now()) as receipt;
"""
open(os.path.join(CONTRACTS, "citation-index-reporter-facet-r2-20261003-v1.sql"), "w", encoding="utf-8").write(a2)
print("written", len(a1), len(a2))
