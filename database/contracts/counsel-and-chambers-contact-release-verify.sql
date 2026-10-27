-- Read-only verification for the counsel-and-chambers-contact-redaction release (owner decision 2026-10-27, lead decision 2026-10-27:
-- professional contact details that courts publish for attorneys and chambers are shown as published; AGENTS.md).
-- Nothing here writes.
--
-- Scope of this branch: the MDL court pages (counsel leadership lists, leadership / bellwether / settlement statements, order rows).
-- Chambers contact text in judge_practice_documents is released by release/judge-practice-contact-redaction
-- (scripts/enrichment/judge_practices/release_contact_text.py); this branch no longer carries a second copy of that script.
--
-- The MDL release is a republish, not DDL: in the environment that holds private/acq/mdl-intel/ (court_pages_extracted.json, jpml/, txt/):
--   python3 build_courts_summary.py --preview <ACQ>/court_pages_extracted.json <tmp>/preview.json   (offline, compare with the live rows)
--   python3 run_all.py --courts-only    (backs up mdl_intel_court_pages and mdl_intel_summary to private/acq/mdl-intel/backups/ first,
--                                        then republishes only those two datasets; stats and hearing orders are not touched)
-- Rollback: republish the rows of the backup file written by that run.
-- Run each block with: set local statement_timeout = '120s';

-- 1. Contact removals left in mdl_intel_court_pages.
--    Before (2026-10-27): order rows with a marker 4; quotes: bellwether 1, settlement 1, leadership 22; leadership blocks with removed
--    lines 64 of 73.
--    After the --courts-only republish: 0 in every with_marker column (nothing is removed any more); totals unchanged unless the court
--    pages were re-fetched.
with o as (select x->>'row_text' t from public.corpus_records r, jsonb_array_elements(r.item->'court'->'orders') x where r.dataset = 'mdl_intel_court_pages'),
     q as (select c.key cat, x->>'text' t from public.corpus_records r, jsonb_each(r.item->'court'->'quotes') c, jsonb_array_elements(c.value) x
           where r.dataset = 'mdl_intel_court_pages'),
     b as (select x from public.corpus_records r, jsonb_array_elements(r.item->'court'->'leadership_blocks') x where r.dataset = 'mdl_intel_court_pages')
select 'order_rows' as part, count(*) filter (where t like '%[contact removed]%') as with_marker, count(*) as total from o
union all
select 'quotes_' || cat, count(*) filter (where t like '%[contact removed]%'), count(*) from q group by cat
union all
select 'leadership_blocks', count(*) filter (where (x->>'contact_lines_removed')::boolean), count(*) from b;

-- 2. Dataset sizes stay the same: mdl_intel_court_pages 67, mdl_intel_summary 51, mdl_intel_hearing_orders 2231 (not republished).
select dataset, count(*) from public.corpus_records
where dataset in ('mdl_intel_court_pages', 'mdl_intel_hearing_orders', 'mdl_intel_summary')
group by dataset order by dataset;
