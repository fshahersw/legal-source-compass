-- de-dockets: read-only SELECT behind master-targets-<date>.json (one row per registry master docket).
-- Columns map to the targets file: mdl, docket_key, court_id, docket_number, docketbird ids listed on the master row, the CourtListener
-- dockets listed on the master row with their resolution basis, and the docket number already printed on the MDL's sw_docket_entries_v1 rows.
-- cl_docket_ids in the targets file is the single listed CourtListener docket, or [] where the listing is ambiguous (several dockets share
-- the key, e.g. 2545) or the docket is blocked (cl_blocked: 2738, 2800, 2885, 2921).
-- Two target fields are not database facts and are carried from the frozen file with their recorded basis:
--   docketbird_case_id when the master row lists none ('derived_exact_docket_key': docket_key with its first ':' replaced by '-',
--     confirmed by the provider's own document ids), and cl_blocked (CourtListener answers the docket as blocked; observed by probe).
-- Per-MDL "before" aggregates come from snapshot-before.sql.
with masters as (
  select filters->>'mdl' as mdl,
         substr(id, length('sw-md:' || (filters->>'mdl') || ':') + 1) as docket_key,
         item->'cells'->>'court_id' as court_id,
         item->'cells'->>'docket_number' as docket_number,
         detail->'registry'->'native_case_ids' as nc
  from corpus_records
  where dataset = 'sw_matter_dockets_v1' and filters->>'role' = 'master'
),
printed as (
  select filters->>'mdl' as mdl, min(item->'cells'->>'docket_number') as entries_docket_number
  from corpus_records
  where dataset = 'sw_docket_entries_v1'
  group by 1
)
select m.mdl, m.docket_key, m.court_id, m.docket_number,
       (select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(m.nc, '[]'::jsonb)) x where x->>'provider' = 'docketbird') as docketbird_ids,
       (select jsonb_agg(jsonb_build_object('id', x->>'id', 'basis', x->>'resolution_basis')) from jsonb_array_elements(coalesce(m.nc, '[]'::jsonb)) x
         where x->>'provider' = 'courtlistener') as cl_dockets,
       coalesce(p.entries_docket_number, m.docket_number) as entries_docket_number
from masters m left join printed p on p.mdl = m.mdl
order by m.mdl;
