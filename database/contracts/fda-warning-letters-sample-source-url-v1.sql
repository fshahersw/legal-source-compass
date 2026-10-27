-- Source URLs for the legacy FDA warning-letter sample (agency_safety_fda_warning_letters, 1,000 rows from an
-- FDA.gov XLSX export that carried no letter links), taken from the complete index
-- (agency_safety_fda_warning_letters_index, built by scripts/enrichment/fda_warning_letters/).
--
-- Run only after the index is published and ready. A sample row gets the letter page URL of the index row with the
-- same Posted Date, Letter Issue Date and company name as FDA lists them (whitespace collapsed on both sides), and
-- only when that key is unique in the sample and unique in the index; anything else keeps an empty source_url.
-- This is equality on the publisher's own fields, never a similarity match.
-- Idempotent (only empty source_url values are set); only source_url and the catalog's source_url_rule change.
-- Production: run by the lead only; read-only preview and checks in fda-warning-letters-sample-source-url-v1-verify.sql.

update public.corpus_records r
set source_url = m.url
from (
  with sample as (
    select x.id, coalesce(x.source_url, '') as current_url,
      (x.detail->'fields'->>'posted_date') as posted,
      (x.detail->'fields'->>'letter_issue_date') as issued,
      regexp_replace(btrim(x.detail->'fields'->>'company_name'), '\s+', ' ', 'g') as company
    from public.corpus_records x
    where x.dataset = 'agency_safety_fda_warning_letters'
  ),
  idx as (
    select x.source_url as url,
      (x.item->'letter'->>'posted_date') as posted,
      (x.item->'letter'->>'letter_issue_date') as issued,
      regexp_replace(btrim(x.item->'letter'->>'company_name'), '\s+', ' ', 'g') as company
    from public.corpus_records x
    where x.dataset = 'agency_safety_fda_warning_letters_index'
      and x.source_url like 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/%'
      and exists (select 1 from public.corpus_datasets d where d.id = x.dataset and d.ready)
  ),
  sample_unique as (
    select posted, issued, company from sample
    where posted is not null and issued is not null and company is not null
    group by posted, issued, company having count(*) = 1
  ),
  idx_unique as (
    select posted, issued, company, min(url) as url from idx
    where posted is not null and issued is not null and company is not null
    group by posted, issued, company having count(*) = 1
  )
  select s.id, i.url
  from sample s
  join sample_unique su using (posted, issued, company)
  join idx_unique i using (posted, issued, company)
  where s.current_url = ''
) m
where r.dataset = 'agency_safety_fda_warning_letters' and r.id = m.id and coalesce(r.source_url, '') = '';

update public.corpus_datasets d
set metadata = jsonb_set(coalesce(d.metadata, '{}'::jsonb), '{source_url_rule}', to_jsonb(
  'The letter''s FDA.gov page, from the complete index (agency_safety_fda_warning_letters_index) where Posted Date, Letter Issue Date and company name are equal and unique on both sides; otherwise empty.'::text), true)
where d.id = 'agency_safety_fda_warning_letters'
  and exists (select 1 from public.corpus_datasets i where i.id = 'agency_safety_fda_warning_letters_index' and i.ready)
  and d.metadata->>'source_url_rule' is distinct from
    'The letter''s FDA.gov page, from the complete index (agency_safety_fda_warning_letters_index) where Posted Date, Letter Issue Date and company name are equal and unique on both sides; otherwise empty.';
