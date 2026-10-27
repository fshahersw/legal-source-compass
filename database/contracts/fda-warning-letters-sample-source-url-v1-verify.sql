-- Read-only checks for the warning-letter index publish and fda-warning-letters-sample-source-url-v1.sql.

-- 1. The index: expect ready = true, 3,778 records (FDA table total on 2026-10-27), every record with its letter page.
select d.id, d.ready, d.imported_records, d.expected_records,
  (select count(*) from public.corpus_records r where r.dataset = d.id) as stored,
  (select count(*) from public.corpus_records r where r.dataset = d.id
     and r.source_url like 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/%') as with_letter_url,
  (select min(r.filters->>'posted_date') from public.corpus_records r where r.dataset = d.id) as posted_from,
  (select max(r.filters->>'posted_date') from public.corpus_records r where r.dataset = d.id) as posted_to
from public.corpus_datasets d
where d.id = 'agency_safety_fda_warning_letters_index';

-- 2. Letters per posted year in the index (2026 is a partial year).
select r.filters->>'posted_date' is null as no_date, left(r.filters->>'posted_date', 4) as year, count(*)
from public.corpus_records r
where r.dataset = 'agency_safety_fda_warning_letters_index'
group by 1, 2 order by 2;

-- 3. The legacy sample: measured before the update on 2026-10-27, 985 of its 1,000 rows have a key that is unique in
--    the sample and in the index (the other 15 rows share 7 keys inside the sample and stay empty).
select count(*) as records,
  count(*) filter (where coalesce(source_url, '') = '') as empty,
  count(*) filter (where source_url like 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/%') as letter_page
from public.corpus_records
where dataset = 'agency_safety_fda_warning_letters';
