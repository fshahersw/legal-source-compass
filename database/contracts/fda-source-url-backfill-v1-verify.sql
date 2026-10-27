-- Read-only checks for fda-source-url-backfill-v1.sql. Run before (expect record_specific = 0) and after.
-- After the backfill: empty = 0 and other = 0 for every dataset; record_specific + key_query + bulk_file = records.
-- record_specific: an FDA query or page whose URL no other row of the dataset shares (for shortages and CRLs it must
--   also carry the record's own date term, '+AND+').
-- key_query: an FDA query that can list more than one record (rows sharing key and date, or a key-only fallback).
-- Expected split measured on 2026-10-27 (record_specific / key_query / bulk_file): drug_enforcement 18046/0/2,
-- device_enforcement 40299/0/1, food_enforcement 29507/0/2, device_pma 57101/0/0, drugsfda 29335/0/0,
-- drug_shortages 1593/10/0, crl 453/4/1.
with r as (
  select x.dataset, x.source_url,
    count(*) over (partition by x.dataset, x.source_url) as sharing
  from public.corpus_records x
  where x.dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
    'agency_safety_openfda_food_enforcement', 'agency_safety_openfda_device_pma', 'agency_safety_openfda_drugsfda',
    'agency_safety_openfda_drug_shortages', 'agency_safety_openfda_crl')
), c as (
  select r.dataset, r.source_url,
    (r.source_url like 'https://api.fda.gov/%' or r.source_url like 'https://www.accessdata.fda.gov/%') as fda_query,
    (r.sharing = 1 and (r.dataset not in ('agency_safety_openfda_drug_shortages', 'agency_safety_openfda_crl')
      or r.source_url like '%+AND+%')) as own_record
  from r
)
select c.dataset,
  count(*) as records,
  count(*) filter (where coalesce(c.source_url, '') = '') as empty,
  count(*) filter (where c.fda_query and c.own_record) as record_specific,
  count(*) filter (where c.fda_query and not c.own_record) as key_query,
  count(*) filter (where c.source_url like 'https://download.open.fda.gov/%') as bulk_file,
  count(*) filter (where coalesce(c.source_url, '') <> '' and not c.fda_query
    and c.source_url not like 'https://download.open.fda.gov/%') as other
from c
group by c.dataset
order by c.dataset;

-- Spot checks: one URL per dataset, and the ids that fall back to the bulk file.
select dataset, id, source_url
from public.corpus_records
where (dataset, id) in (
  ('agency_safety_openfda_device_enforcement', 'openfda:device/enforcement:Z-1974-2021'),
  ('agency_safety_openfda_drugsfda', 'openfda:drug/drugsfda:ANDA076189'),
  ('agency_safety_openfda_device_pma', 'openfda:device/pma:P090006:S016'),
  ('agency_safety_openfda_device_pma', 'openfda:device/pma:P060040'),
  ('agency_safety_openfda_drug_shortages', 'openfda:drug/shortages:0409-9046-01'),
  ('agency_safety_openfda_drug_shortages', 'openfda:drug/shortages:65219-086-20'),
  ('agency_safety_openfda_drug_shortages', 'openfda:drug/shortages:65219-086-20~2'),
  ('agency_safety_openfda_crl', 'openfda:transparency/crl:CRL_NDA219112_20250117.pdf'),
  ('agency_safety_openfda_crl', 'openfda:transparency/crl:210852_2024_Orig1s000OtherActionLtrs.pdf'),
  ('agency_safety_openfda_crl', 'openfda:transparency/crl:210852_2024_Orig1s000OtherActionLtrs.pdf~2'))
order by dataset, id;

select dataset, id, source_url
from public.corpus_records
where dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
  'agency_safety_openfda_food_enforcement', 'agency_safety_openfda_device_pma', 'agency_safety_openfda_drugsfda',
  'agency_safety_openfda_drug_shortages', 'agency_safety_openfda_crl')
  and source_url like 'https://download.open.fda.gov/%'
order by dataset, id
limit 50;
