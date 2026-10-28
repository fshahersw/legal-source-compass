-- Read-only verification for the clb_judge_disclosures release of 2026-10-27 (owner decision "dont withhold any data").
-- Released: the published text of lines CourtListener marks redacted (marker kept), items of reports whose original file name
-- could not be read (labelled attribution 'not_checked'), and the 97 reimbursements past the old 250-per-person display cap.
-- Still held, on evidence from the report files themselves: items of reports whose file name carries another surname
-- ('mismatch', 258 items before the conflict rule changed) and items of conflict reports. Conflicts are resolved per report
-- (rest_common.resolve_conflict, lead fix 2026-10-27): of the 67 people whose matching reports carry two numbered circuits,
-- 34 name one district only (circuit digit differs: everything listed, 574 items held before), 23 name more than one district
-- and the district most reports carry is the recorded court's (only those reports listed; 212 items held before, part of them
-- released) and 10 cannot be settled (162 items stay held). Estimated from the live report_list on 2026-10-27; the exact
-- after-values come from publish_judge_disclosures.py diff.
-- The release is a republish through scripts/enrichment/courtlistener_rest/publish_judge_disclosures.py, not DDL; this file has
-- no side effects. Run it before and after the publish (and after a rollback, which must give the "before" values again).

-- 1. Withheld items.
with p as (select item->'profile' pr from public.corpus_records where dataset = 'clb_judge_disclosures')
select count(*) as records,
       sum((pr->'items_withheld'->>'gifts')::int + (pr->'items_withheld'->>'reimbursements')::int + (pr->'items_withheld'->>'agreements')::int) as withheld,
       sum((pr->'items_withheld_by_reason'->'attribution_conflict'->>'gifts')::int + (pr->'items_withheld_by_reason'->'attribution_conflict'->>'reimbursements')::int
           + (pr->'items_withheld_by_reason'->'attribution_conflict'->>'agreements')::int) as withheld_conflict,
       sum((pr->'items_withheld_by_reason'->'other_surname'->>'gifts')::int + (pr->'items_withheld_by_reason'->'other_surname'->>'reimbursements')::int
           + (pr->'items_withheld_by_reason'->'other_surname'->>'agreements')::int) as withheld_other_surname
from p;
-- before (read 2026-10-27): records 3392, withheld 1363, withheld_conflict null, withheld_other_surname null
-- after:                    records 3392, withheld < 1206, withheld_conflict between 162 and 374, withheld_other_surname >= 258
--                            (mismatch reports of the 34 one-district people now count as other_surname, not conflict)

-- 2. Listed items and the reimbursement cap.
with p as (select item->'profile' pr from public.corpus_records where dataset = 'clb_judge_disclosures')
select sum(jsonb_array_length(pr->'gifts')) as gifts, sum(jsonb_array_length(pr->'reimbursements')) as reimbursements,
       sum(jsonb_array_length(pr->'agreements')) as agreements, sum((pr->>'reimbursements_listed')::int) as reimbursements_listed,
       max(jsonb_array_length(pr->'reimbursements')) as max_reimbursements_one_person
from p;
-- before: gifts 1960, reimbursements 32376, agreements 9708, reimbursements_listed 32376, max 250
-- after:  gifts 1974, reimbursements 32595, agreements 9729, reimbursements_listed 32595, max 300

-- 3. Listed items by label; nothing from a mismatch or conflict report.
with p as (select id, item->'profile' pr from public.corpus_records where dataset = 'clb_judge_disclosures'),
it as (select p.id, p.pr, k, x from p, lateral (values ('gifts'), ('reimbursements'), ('agreements')) v(k), jsonb_array_elements(p.pr->k) x),
chk as (select it.*, (select r->>'file_check' from jsonb_array_elements(it.pr->'report_list') r where (r->>'id')::bigint = (it.x->>'report_id')::bigint) as fc from it)
select k,
       count(*) filter (where (x->>'redacted')::boolean) as listed_redacted,
       count(*) filter (where (x->>'redacted')::boolean
                          and coalesce(x->>'source', x->>'description', x->>'value_as_filed', x->>'purpose', x->>'location', x->>'items_paid_or_provided',
                                       x->>'dates_as_filed', x->>'date_as_filed', x->>'parties_and_terms') is not null) as redacted_with_text,
       count(*) filter (where x->>'attribution' = 'not_checked') as not_checked,
       count(*) filter (where fc is distinct from 'match' and fc is distinct from 'unchecked') as from_mismatch_or_missing,
       count(*) filter (where pr->'attribution'->>'status' = 'conflict'
                          and (select r->>'conflict_hold' from jsonb_array_elements(pr->'report_list') r
                               where (r->>'id')::bigint = (x->>'report_id')::bigint) is distinct from 'false') as from_conflict
from chk group by k order by k;
-- before: agreements 139/0/0/0/0, gifts 89/0/0/0/0, reimbursements 73/0/0/0/0
-- after:  agreements >=139/>0/21/0/0, gifts >=89/>0/14/0/0, reimbursements >=73/>0/122/0/0
--         (listed_redacted grows by the redacted lines among the released unchecked items; the last two columns must be 0)

-- 4. Catalog row.
select id, ready, expected_records, imported_records,
       metadata->'summary'->'totals'->'items_withheld' as withheld,
       metadata->'summary'->'totals'->'items_withheld_by_reason' as by_reason,
       metadata->'summary'->'totals'->'items_listed_attribution_not_checked' as not_checked
from public.corpus_datasets where id = 'clb_judge_disclosures';
-- before: ready true, 3392, 3392, {"gifts":65,"agreements":299,"reimbursements":999}, null, null
-- after:  ready true, 3392, 3392, totals equal to the publish diff tally (see section 1 for the expected range),
--         items_listed_attribution_not_checked {"gifts":14,"reimbursements":122,"agreements":21}
