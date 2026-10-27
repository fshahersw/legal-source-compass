-- Rollback of the clb_judge_disclosures release of 2026-10-27.
-- The release changes no schema object: it republishes the dataset's corpus_records rows and its corpus_datasets row through
-- corpus_writer. The rollback is therefore a republish of the snapshot taken right before the release (lead, with the service
-- credentials in the environment only):
--
--   python3 -I -B scripts/enrichment/courtlistener_rest/publish_judge_disclosures.py restore \
--     private/acq/release-judge-disclosure-redacted-and-unchecked/clb_judge_disclosures.before.json.gz
--
-- Then confirm with these read-only SELECTs that the "before" values are back.
with p as (select item->'profile' pr from public.corpus_records where dataset = 'clb_judge_disclosures')
select count(*) as records,
       sum((pr->'items_withheld'->>'gifts')::int + (pr->'items_withheld'->>'reimbursements')::int + (pr->'items_withheld'->>'agreements')::int) as withheld,
       count(*) filter (where pr ? 'items_withheld_by_reason') as records_with_reason_split,
       max(jsonb_array_length(pr->'reimbursements')) as max_reimbursements_one_person
from p;
-- expect: records 3392, withheld 1363, records_with_reason_split 0, max_reimbursements_one_person 250

select ready, expected_records, imported_records, metadata->'summary'->'totals'->'items_withheld' as withheld
from public.corpus_datasets where id = 'clb_judge_disclosures';
-- expect: true, 3392, 3392, {"gifts":65,"agreements":299,"reimbursements":999}
