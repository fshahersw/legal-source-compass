-- Read-only verification for the counsel-and-chambers-contact-redaction release (owner decision 2026-10-27).
-- Nothing here writes. The release itself is a data republish, not DDL:
--   judge_practice_documents: scripts/enrichment/judge_practices/release_contact_text.py --publish
--     (rollback: release_contact_text.py --restore private/acq/release-counsel-and-chambers-contact-redaction/backup_rows.jsonl.gz)
--   mdl_intel_court_pages / mdl_intel_summary: scripts/enrichment/mdl_intel/run_all.py (counsel rule scoped to counsel text)
--     (rollback: check out the previous build_courts_summary.py and run run_all.py again)
-- Run each block with: set local statement_timeout = '120s';

-- 1. Chambers contact markers in judge_practice_documents. The markers live in the text column (item and detail carry none).
--    Before (2026-10-27): rows_with_any_marker 2308; phone 1401; email 1675; staff_line 964; staff_block 261.
--    After: 0 in every column, except rows the release script lists as "skipped" in release_results.jsonl.
select count(*) filter (where text like '%[phone omitted]%' or text like '%[email omitted]%'
                          or text like '%[line naming courtroom staff omitted]%' or text like '%[staff contact block omitted]%') as rows_with_any_marker,
       count(*) filter (where text like '%[phone omitted]%') as phone,
       count(*) filter (where text like '%[email omitted]%') as email,
       count(*) filter (where text like '%[line naming courtroom staff omitted]%') as staff_line,
       count(*) filter (where text like '%[staff contact block omitted]%') as staff_block,
       count(*) filter (where text like '%[access code omitted]%' or text like '%pwd=[omitted]%') as access_codes_removed,
       count(*) as total
from public.corpus_records
where dataset = 'judge_practice_documents';
-- After: total 7066 (unchanged), access_codes_removed > 0 unless the release ran with --keep-access-codes.

-- 2. Every released row is self-consistent: the recorded text_sha256 is the hash of the document text in the text column.
--    Before and after: mismatches 0.
select count(*) filter (where (item->'practice_document'->>'text_sha256')
                            <> encode(sha256(convert_to(substr(text, length(id || ' ' || title || ' ' || (item->>'subtitle') || ' ') + 1), 'UTF8')), 'hex')) as mismatches,
       count(*) filter (where item->'practice_document'->>'text_sha256' is not null) as with_text
from public.corpus_records
where dataset = 'judge_practice_documents';

-- 3. Redaction facts and dataset metadata. Before: legacy_counts 6970 (every stored row carries the old count keys, zeros on rows with no
--    marker), new_counts 0. After: new_counts = rows_changed in release_summary.json, legacy_counts = 6970 - rows_changed (rows that had
--    nothing removed keep their all-zero old keys; the text is the same either way); privacy starts "Document text is shown as the court publishes it".
select count(*) filter (where item->'practice_document'->'redactions' ? 'emails') as legacy_counts,
       count(*) filter (where item->'practice_document'->'redactions' ? 'access_codes') as new_counts
from public.corpus_records
where dataset = 'judge_practice_documents';
select id, ready, expected_records, imported_records, left(metadata->'summary'->>'privacy', 80) as privacy,
       metadata->'summary'->'totals'->'redacted_emails' as redacted_emails, metadata->'summary'->'totals'->'redacted_access_codes' as redacted_access_codes
from public.corpus_datasets
where id in ('judge_practice_documents', 'judge_court_pages');

-- 4. MDL counsel contact (explicit owner policy hold, 2026-10-03: stays). Only non-counsel removals are released.
--    Before (2026-10-27): order rows with a marker 4 (0 name counsel); bellwether quotes 1 (0); settlement quotes 1 (0);
--    leadership quotes 22 (20 name counsel; leadership statements stay under the counsel rule); leadership blocks with removed lines 64 of 73.
--    After the run_all.py republish: order_rows_with_marker 0, bellwether 0, settlement 0, leadership quotes 22, blocks 64.
with o as (select x->>'row_text' t from public.corpus_records r, jsonb_array_elements(r.item->'court'->'orders') x where r.dataset = 'mdl_intel_court_pages'),
     q as (select c.key cat, x->>'text' t from public.corpus_records r, jsonb_each(r.item->'court'->'quotes') c, jsonb_array_elements(c.value) x
           where r.dataset = 'mdl_intel_court_pages'),
     b as (select x from public.corpus_records r, jsonb_array_elements(r.item->'court'->'leadership_blocks') x where r.dataset = 'mdl_intel_court_pages')
select 'order_rows' as part, count(*) filter (where t like '%[contact removed]%') as with_marker, count(*) as total from o
union all
select 'quotes_' || cat, count(*) filter (where t like '%[contact removed]%'), count(*) from q group by cat
union all
select 'leadership_blocks', count(*) filter (where (x->>'contact_lines_removed')::boolean), count(*) from b;

-- 5. Dataset sizes stay the same: judge_practice_documents 7066, mdl_intel_court_pages 67, mdl_intel_hearing_orders 2231, mdl_intel_summary 51.
select dataset, count(*) from public.corpus_records
where dataset in ('judge_practice_documents', 'mdl_intel_court_pages', 'mdl_intel_hearing_orders', 'mdl_intel_summary')
group by dataset order by dataset;
