-- Read-only checks for fda-source-url-backfill-v1.sql. Run before (expect record_specific = 0) and after.
-- After the backfill: empty = 0 for every dataset; record_specific + bulk_file = records; the per-dataset expected
-- split measured on 2026-10-27 is in the de-fda-exact report (lead_actions).
select r.dataset,
  count(*) as records,
  count(*) filter (where coalesce(r.source_url, '') = '') as empty,
  count(*) filter (where r.source_url like 'https://api.fda.gov/%' or r.source_url like 'https://www.accessdata.fda.gov/%') as record_specific,
  count(*) filter (where r.source_url like 'https://download.open.fda.gov/%') as bulk_file,
  count(*) filter (where coalesce(r.source_url, '') <> ''
    and r.source_url not like 'https://api.fda.gov/%'
    and r.source_url not like 'https://www.accessdata.fda.gov/%'
    and r.source_url not like 'https://download.open.fda.gov/%') as other
from public.corpus_records r
where r.dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
  'agency_safety_openfda_food_enforcement', 'agency_safety_openfda_device_pma', 'agency_safety_openfda_drugsfda',
  'agency_safety_openfda_drug_shortages', 'agency_safety_openfda_crl')
group by r.dataset
order by r.dataset;

-- Spot checks: one URL per dataset, and the ids that fall back to the bulk file.
select dataset, id, source_url
from public.corpus_records
where (dataset, id) in (
  ('agency_safety_openfda_device_enforcement', 'openfda:device/enforcement:Z-1974-2021'),
  ('agency_safety_openfda_drugsfda', 'openfda:drug/drugsfda:ANDA076189'),
  ('agency_safety_openfda_device_pma', 'openfda:device/pma:P090006:S016'),
  ('agency_safety_openfda_device_pma', 'openfda:device/pma:P060040'),
  ('agency_safety_openfda_drug_shortages', 'openfda:drug/shortages:0409-9046-01'),
  ('agency_safety_openfda_crl', 'openfda:transparency/crl:CRL_NDA219112_20250117.pdf'))
order by dataset, id;

select dataset, id, source_url
from public.corpus_records
where dataset in ('agency_safety_openfda_drug_enforcement', 'agency_safety_openfda_device_enforcement',
  'agency_safety_openfda_food_enforcement', 'agency_safety_openfda_device_pma', 'agency_safety_openfda_drugsfda',
  'agency_safety_openfda_drug_shortages', 'agency_safety_openfda_crl')
  and source_url like 'https://download.open.fda.gov/%'
order by dataset, id
limit 50;
