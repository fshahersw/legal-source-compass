-- Release judge-practice-contact-redaction (owner decision 2026-10-27, "dont withhold any data"; owner rule 2026-10-22 (3)).
-- Read-only verification for public.corpus_records / public.corpus_datasets, dataset judge_practice_documents.
-- No DDL and no DML: the release itself is a republish of the dataset by
--   python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py            (dry run, writes the rollback snapshot)
--   python3 -I -B scripts/enrichment/judge_practices/release_contact_text.py --publish  (corpus_writer.publish)
-- Rollback: verify-judge-practice-contact-release-v1.rollback.sql.
--
-- Expected (read 2026-10-27, before the release):
--   q1 total 7066, marker3 2284, marker4 2308, email_docs 1675, phone_docs 1401, staff_line_docs 964, staff_block_docs 261
--   q2 targets 2312, target_ids_sha256 a8b05e80d5f945941866c048dbe00f544d49974002cd05f8a028242d7abde191
--   q3 total 7066, with_text 6745, text_sha_ok 6745, stored 6970, truncated 47, method_says_omitted 363, redacted_fact_rows 7066
--      (2312 of them with a value other than "None")
--   q5 rows_with_email_address 5
--   q4 ready true, expected_records 7066, imported_records 7066, manifest_sha256 4b15798452fd5a638ead2a88eee00e2b66db678f45d2407c76bd4ef133b8d5ef,
--      privacy "No chambers telephone number, e-mail address or courtroom deputy name is extracted ..."
-- Expected after a full release (report.json not_released = 0):
--   q1 total 7066, marker3 0, marker4 0 (all marker columns 0)
--   q2 targets 0
--   q3 total 7066, with_text 6745, text_sha_ok 6745, stored 6970, truncated >= 47 (a released text can pass the cap), method_says_omitted 0,
--      redacted_fact_rows 0 (released rows lose the fact; rows never redacted lose their "None" fact)
--   q4 ready true, expected_records 7066, imported_records 7066, manifest_sha256 = report.json release_rows_digest, privacy = extract_text.PRIVACY
--   q5 rows_with_email_address >= 1675 (5 before: addresses the legacy pattern did not match)
-- A partial release (--allow-partial) leaves exactly report.json not_released rows in q2 and their markers in q1.

set local statement_timeout = '120s';

-- q1. marker counts (the release plan's query, plus the judge-page marker "[staff contact block omitted]")
select count(*) as total,
       count(*) filter (where text like '%[email omitted]%' or text like '%[phone omitted]%' or text like '%[line naming courtroom staff omitted]%') as marker3,
       count(*) filter (where text like '%[email omitted]%' or text like '%[phone omitted]%' or text like '%[line naming courtroom staff omitted]%'
                           or text like '%[staff contact block omitted]%') as marker4,
       count(*) filter (where text like '%[email omitted]%') as email_docs,
       count(*) filter (where text like '%[phone omitted]%') as phone_docs,
       count(*) filter (where text like '%[line naming courtroom staff omitted]%') as staff_line_docs,
       count(*) filter (where text like '%[staff contact block omitted]%') as staff_block_docs
from public.corpus_records where dataset = 'judge_practice_documents';

-- q2. targets: non-zero redaction counts or a marker (2,308 with a marker + 4 capped texts whose redaction fell past the cap)
with t as (
  select id from public.corpus_records
  where dataset = 'judge_practice_documents'
    and ((jsonb_typeof(item->'practice_document'->'redactions') = 'object'
          and (select coalesce(sum(v::int), 0) from jsonb_each_text(item->'practice_document'->'redactions') e(k, v)) > 0)
         or text like '%[email omitted]%' or text like '%[phone omitted]%' or text like '%[line naming courtroom staff omitted]%'
         or text like '%[staff contact block omitted]%'))
select count(*) as targets, encode(sha256(convert_to(string_agg(id, E'\n' order by id), 'UTF8')), 'hex') as target_ids_sha256 from t;

-- q3. integrity: row text = id, title, subtitle, document text; the document text matches item.practice_document.text_sha256 and text_chars
with r as (select id, text, detail, item->'practice_document' pd, (id || ' ' || title || ' ' || (item->>'subtitle') || ' ') pre
           from public.corpus_records where dataset = 'judge_practice_documents'),
s as (select *, left(text, length(pre)) = pre prefix_ok, substr(text, length(pre) + 1) doc from r)
select count(*) as total,
       count(*) filter (where coalesce((pd->>'text_chars')::int, 0) > 0) as with_text,
       count(*) filter (where coalesce((pd->>'text_chars')::int, 0) > 0 and prefix_ok
                          and encode(sha256(convert_to(doc, 'UTF8')), 'hex') = pd->>'text_sha256'
                          and length(doc) = (pd->>'text_chars')::int) as text_sha_ok,
       count(*) filter (where (pd->>'stored')::boolean) as stored,
       count(*) filter (where (pd->>'text_truncated')::boolean) as truncated,
       count(*) filter (where pd->>'text_method' like '%staff contact blocks in the page header omitted%') as method_says_omitted,
       count(*) filter (where exists (select 1 from jsonb_array_elements(detail->'facts') f where f->>0 = 'Redacted from the text')) as redacted_fact_rows
from s;

-- q4. catalog entry
select id, ready, expected_records, imported_records, manifest_sha256, metadata->'summary'->>'privacy' as privacy
from public.corpus_datasets where id = 'judge_practice_documents';

-- q5. released contact details are in the searchable text
select count(*) filter (where text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+') as rows_with_email_address
from public.corpus_records where dataset = 'judge_practice_documents';
