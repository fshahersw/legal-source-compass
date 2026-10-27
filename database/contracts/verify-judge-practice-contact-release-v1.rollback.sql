-- Rollback of release judge-practice-contact-redaction (verify-judge-practice-contact-release-v1.sql).
-- The release republished judge_practice_documents with corpus_writer.publish; the rollback republishes the snapshot the dry run saved
-- before anything was written (private/acq/release-judge-practice-contact-redaction/prior_rows.jsonl and prior_dataset.json, hash-checked
-- against report.json):
--   python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --rollback
-- No SQL changes data here; the queries below are read-only and confirm the rollback.
--
-- Expected after the rollback (the state read 2026-10-27, before the release):
--   r1 total 7066, marker3 2284, marker4 2308
--   r2 ready true, expected_records 7066, imported_records 7066, manifest_sha256 = report.json prior_rows_digest
--      (4b15798452fd5a638ead2a88eee00e2b66db678f45d2407c76bd4ef133b8d5ef when report.json shows prior_rows_digest equal to prior_manifest_sha256),
--      privacy "No chambers telephone number, e-mail address or courtroom deputy name is extracted ..."
--   r3 text_sha_ok 6745, method_says_omitted 363, redacted_fact_rows 7066

set local statement_timeout = '120s';

-- r1
select count(*) as total,
       count(*) filter (where text like '%[email omitted]%' or text like '%[phone omitted]%' or text like '%[line naming courtroom staff omitted]%') as marker3,
       count(*) filter (where text like '%[email omitted]%' or text like '%[phone omitted]%' or text like '%[line naming courtroom staff omitted]%'
                           or text like '%[staff contact block omitted]%') as marker4
from public.corpus_records where dataset = 'judge_practice_documents';

-- r2
select id, ready, expected_records, imported_records, manifest_sha256, metadata->'summary'->>'privacy' as privacy
from public.corpus_datasets where id = 'judge_practice_documents';

-- r3
with r as (select id, text, detail, item->'practice_document' pd, (id || ' ' || title || ' ' || (item->>'subtitle') || ' ') pre
           from public.corpus_records where dataset = 'judge_practice_documents'),
s as (select *, left(text, length(pre)) = pre prefix_ok, substr(text, length(pre) + 1) doc from r)
select count(*) filter (where coalesce((pd->>'text_chars')::int, 0) > 0 and prefix_ok
                          and encode(sha256(convert_to(doc, 'UTF8')), 'hex') = pd->>'text_sha256') as text_sha_ok,
       count(*) filter (where pd->>'text_method' like '%staff contact blocks in the page header omitted%') as method_says_omitted,
       count(*) filter (where exists (select 1 from jsonb_array_elements(detail->'facts') f where f->>0 = 'Redacted from the text')) as redacted_fact_rows
from s;
