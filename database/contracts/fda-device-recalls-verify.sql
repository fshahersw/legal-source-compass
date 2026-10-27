-- Read-only checks after publishing agency_safety_openfda_device_recalls
-- (scripts/enrichment/openfda_device_recalls/build_device_recalls.py --publish).

-- 1. Catalog and rows: expect ready = true, 59,618 records (openFDA export 2026-10-27), every row with its openFDA query.
select d.id, d.ready, d.imported_records, d.expected_records, d.manifest_sha256,
  (select count(*) from public.corpus_records r where r.dataset = d.id) as stored,
  (select count(*) from public.corpus_records r where r.dataset = d.id
     and r.source_url like 'https://api.fda.gov/device/recall.json?search=product_res_number:%') as with_source_url
from public.corpus_datasets d
where d.id = 'agency_safety_openfda_device_recalls';

-- 2. Exact-key coverage (equality only). Measured from the packet: 59,259 rows carry a product code, 38,878 a 510(k)
--    number, 2,766 a PMA number, 59,610 a cfRES id; a 300-recall sample initiated 2012-2025 found 287 in device
--    enforcement by recall number.
select
  count(*) as recalls,
  count(*) filter (where exists (
    select 1 from public.corpus_records e
    where e.dataset = 'agency_safety_openfda_device_enforcement'
      and e.id = 'openfda:device/enforcement:' || (r.filters->>'recall_number'))) as in_device_enforcement,
  count(*) filter (where jsonb_array_length(r.filters->'product_code') = 1 and exists (
    select 1 from public.corpus_records c
    where c.dataset = 'agency_safety_openfda_device_classification_20261002'
      and c.filters->>'product_code' = r.filters->'product_code'->>0)) as product_code_in_classification
from public.corpus_records r
where r.dataset = 'agency_safety_openfda_device_recalls';

-- 3. Product recalls and recall events by initiation year (compare events, not rows, across years; the export year
--    is partial). Expected from the reviewed packet (year: product_recalls / recall_events):
--    2026: 2,176 / 696 (partial, initiated to 2026-09-25); 2025: 2,838 / 945; 2024: 3,279 / 972; 2023: 2,612 / 917;
--    2022: 2,276 / 839; 2021: 2,260 / 900; 2020: 2,602 / 916; 2019: 3,011 / 969; 2018: 3,013 / 1,074;
--    2017: 3,313 / 1,091; 2016: 3,029 / 1,232; 2015: 2,907 / 1,153. 21 rows (12 events) have no usable initiation date.
select left(r.filters->>'event_date_initiated', 4) as year,
  count(*) as product_recalls,
  count(distinct r.filters->>'event_id') as recall_events
from public.corpus_records r
where r.dataset = 'agency_safety_openfda_device_recalls'
group by 1 order by 1 desc nulls last
limit 12;
