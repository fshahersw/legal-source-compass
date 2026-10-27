-- FDA source_url backfill v1 (owner rule: every record carries its source URL).
--
-- Before this contract, source_url was empty on every row of the openFDA-derived corpus datasets. Each statement
-- below sets an official per-record FDA URL built only from the record's own publisher identifier, exactly as stored
-- in detail.publisher_record. Nothing is matched across records or inferred:
--   enforcement (drug, device, food)  https://api.fda.gov/<kind>/enforcement.json?search=recall_number:%22<recall_number>%22
--   device PMA                        https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=<pma_number><supplement_number>
--   Drugs@FDA                         https://api.fda.gov/drug/drugsfda.json?search=application_number:%22<application_number>%22
--   drug shortages                    https://api.fda.gov/drug/shortages.json?search=package_ndc:%22<package_ndc>%22
--   complete response letters         https://api.fda.gov/transparency/crl.json?search=file_name:%22<file_name>%22
-- A record whose identifier is missing or not in the published format ('N/A', '', a placeholder such as
-- 'Under Review for Release') gets the dated openFDA bulk file it was read from (detail.original_file.final_url on
-- download.open.fda.gov), which is official but not record-specific; with neither, source_url stays empty.
--
-- The enforcement rule is the same string src/lib/ingest/sources/openfdaEnforcement.ts (enforcementSourceUrl) writes
-- for new rows. Deploy that edge function (ingest-openfda-enforcement) before running this file: the deployed
-- function compares stored rows with its own output, and an older build that still writes '' would put the empty
-- value back on rows inside its 14-day recheck window.
--
-- Idempotent: only rows whose source_url is null or '' are touched, so a rerun updates 0 rows. Only source_url and
-- corpus_datasets.metadata.source_url_rule change; item, detail, text and filters are untouched, so the
-- search-vector trigger (UPDATE OF title, text, search_vector) does not fire.
-- Production: run by the lead only, one statement at a time; verification in fda-source-url-backfill-v1-verify.sql.

-- 1. openFDA drug enforcement reports
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'recall_number' ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$'
        and upper(x.detail->'publisher_record'->>'recall_number') <> 'N/A'
        then 'https://api.fda.gov/drug/enforcement.json?search=recall_number:%22' || (x.detail->'publisher_record'->>'recall_number') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/drug/enforcement/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_drug_enforcement' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_drug_enforcement' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 2. openFDA device enforcement reports
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'recall_number' ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$'
        and upper(x.detail->'publisher_record'->>'recall_number') <> 'N/A'
        then 'https://api.fda.gov/device/enforcement.json?search=recall_number:%22' || (x.detail->'publisher_record'->>'recall_number') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/device/enforcement/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_device_enforcement' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_device_enforcement' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 3. openFDA food enforcement reports
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'recall_number' ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$'
        and upper(x.detail->'publisher_record'->>'recall_number') <> 'N/A'
        then 'https://api.fda.gov/food/enforcement.json?search=recall_number:%22' || (x.detail->'publisher_record'->>'recall_number') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/food/enforcement/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_food_enforcement' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_food_enforcement' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 4. openFDA device PMA approvals and supplements: FDA's Premarket Approval database page for the exact record
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'pma_number' ~ '^[PN][0-9]{4,6}$'
        and coalesce(x.detail->'publisher_record'->>'supplement_number', '') ~ '^(S[0-9]{3,4})?$'
        then 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id='
          || (x.detail->'publisher_record'->>'pma_number') || coalesce(x.detail->'publisher_record'->>'supplement_number', '')
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/device/pma/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_device_pma' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_device_pma' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 5. openFDA Drugs@FDA applications
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'application_number' ~ '^(NDA|ANDA|BLA)[0-9]{4,6}$'
        then 'https://api.fda.gov/drug/drugsfda.json?search=application_number:%22' || (x.detail->'publisher_record'->>'application_number') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/drug/drugsfda/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_drugsfda' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_drugsfda' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 6. openFDA drug shortages (a package NDC can have more than one posting; the query lists every posting for it)
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'package_ndc' ~ '^[0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2}$'
        then 'https://api.fda.gov/drug/shortages.json?search=package_ndc:%22' || (x.detail->'publisher_record'->>'package_ndc') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/drug/shortages/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_drug_shortages' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_drug_shortages' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 7. openFDA complete response letters (file names may hold spaces and commas; they are percent-encoded)
update public.corpus_records r
set source_url = s.url
from (
  select x.id,
    case
      when x.detail->'publisher_record'->>'file_name' ~* '^[A-Za-z0-9][A-Za-z0-9._, -]{0,200}\.pdf$'
        then 'https://api.fda.gov/transparency/crl.json?search=file_name:%22'
          || replace(replace(x.detail->'publisher_record'->>'file_name', ' ', '%20'), ',', '%2C') || '%22'
      when x.detail->'original_file'->>'final_url' like 'https://download.open.fda.gov/transparency/crl/%'
        then x.detail->'original_file'->>'final_url'
    end as url
  from public.corpus_records x
  where x.dataset = 'agency_safety_openfda_crl' and coalesce(x.source_url, '') = ''
) s
where r.dataset = 'agency_safety_openfda_crl' and r.id = s.id and s.url is not null
  and coalesce(r.source_url, '') = '';

-- 8. Record the rule on each catalog entry (shown with the dataset's method notes).
update public.corpus_datasets d
set metadata = jsonb_set(coalesce(d.metadata, '{}'::jsonb), '{source_url_rule}', to_jsonb(v.rule), true)
from (values
  ('agency_safety_openfda_drug_enforcement', 'openFDA query by the record''s recall_number; records without a usable recall number cite the dated openFDA bulk file they were read from.'),
  ('agency_safety_openfda_device_enforcement', 'openFDA query by the record''s recall_number; records without a usable recall number cite the dated openFDA bulk file they were read from.'),
  ('agency_safety_openfda_food_enforcement', 'openFDA query by the record''s recall_number; records without a usable recall number cite the dated openFDA bulk file they were read from.'),
  ('agency_safety_openfda_device_pma', 'FDA Premarket Approval database page for the record''s PMA number and supplement number.'),
  ('agency_safety_openfda_drugsfda', 'openFDA Drugs@FDA query by the record''s application number.'),
  ('agency_safety_openfda_drug_shortages', 'openFDA drug shortages query by the record''s package NDC (lists every posting for that NDC).'),
  ('agency_safety_openfda_crl', 'openFDA complete response letter query by the record''s published file name; records without a file name cite the dated openFDA bulk file.')
) v(id, rule)
where d.id = v.id and d.metadata->>'source_url_rule' is distinct from v.rule;
