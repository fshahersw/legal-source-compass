-- de-dockets verification queries (read-only). Run before and after `apply-packet.mjs --execute`.

-- 1. Per-MDL coverage of sw_docket_entries_v1: rows, latest filing date, withheld rows by reason.
select filters->>'mdl' as mdl,
       count(*) as rows,
       max(item->'cells'->>'date_filed') as max_date,
       count(*) filter (where item->'cells'->>'description_withheld' = 'sealed_or_restricted_text') as withheld_text,
       count(*) filter (where item->'cells'->>'description_withheld' = 'sealed_document') as withheld_document,
       count(*) filter (where item->'cells'->>'description_withheld' = 'contact_or_access_data') as withheld_contact,
       string_agg(distinct item->'cells'->>'provider', ',') as providers
from corpus_records
where dataset = 'sw_docket_entries_v1'
group by 1 order by 1;

-- 2. No docket entry is published twice: one numbered entry per (MDL, entry number) across providers. Expect 0 rows,
--    except the CourtListener-internal duplicates that existed before this packet (compare with the pre-apply run).
select filters->>'mdl' as mdl, (item->'cells'->>'entry_number')::int as entry_number, count(*) as copies,
       string_agg(item->'cells'->>'provider' || ':' || (item->'cells'->>'native_entry_id'), ', ') as rows
from corpus_records
where dataset = 'sw_docket_entries_v1' and item->'cells'->>'entry_number' is not null
  and item->'cells'->>'provider' in ('courtlistener', 'docketbird')
group by 1, 2 having count(*) > 1 order by 1, 2 limit 100;

-- 3. Dataset count equals the stored rows.
select d.imported_records, (select count(*) from corpus_records r where r.dataset = d.id) as stored
from corpus_datasets d where d.id = 'sw_docket_entries_v1';

-- 4. Matter cells equal their dataset (entries_published = rows, entries_withheld = withheld rows).
select m.id, (m.item->'cells'->>'entries_published')::int as published_cell, e.rows, (m.item->'cells'->>'entries_withheld')::int as withheld_cell, e.withheld
from corpus_records m
left join (select filters->>'mdl' as mdl, count(*) as rows, count(*) filter (where item->'cells'->>'description_withheld' is not null) as withheld
           from corpus_records where dataset = 'sw_docket_entries_v1' group by 1) e on e.mdl = m.item->'cells'->>'mdl_number'
where m.dataset = 'sw_matters_v1'
order by m.id;

-- 5. No signed provider link or account id was published.
select count(*) from corpus_records
where dataset = 'sw_docket_entries_v1' and (source_url ~ '(Signature=|AWSAccessKeyId|X-Amz-|user_id=)' or item::text ~ '(Signature=|AWSAccessKeyId|X-Amz-|user_id=)');

-- 6. Estimate for the optional 2026-10-23 rule ("dont withhold filings"): rows withheld only because their text matches the
--    exclusion pattern, with the raw lake text checked for a contact field (port of members-publish-rules.mjs CONTACT_RE).
with w as (
  select r.filters->>'mdl' as mdl, r.item->'cells'->>'provider' as prov, r.item->'cells'->>'native_entry_id' as nid, (r.item->'cells'->>'documents_sealed')::int as ds
  from corpus_records r
  where r.dataset = 'sw_docket_entries_v1' and r.filters @> '{"description_withheld":"true"}'
    and r.item->'cells'->>'description_withheld' = 'sealed_or_restricted_text'
), j as (
  select w.*, coalesce(e.data->>'description', x.data->>'title') as txt, (e.native_id is not null or x.native_id is not null) as found
  from w
  left join corpus_ingest.entities e on w.prov = 'courtlistener' and e.source_system = 'courtlistener' and e.entity_type = 'docket-entries' and e.native_id = w.nid
  left join corpus_ingest.entities x on w.prov <> 'courtlistener' and x.source_system = 'sw-matter-registry' and x.entity_type = 'external-entry' and x.native_id = w.prov || ':' || w.nid
)
select mdl, count(*) as withheld_text, count(*) filter (where found) as lake_found, count(*) filter (where ds > 0) as with_sealed_documents,
       count(*) filter (where found and btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g')) <> ''
                        and txt !~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+\.[[:alnum:]_.-]+|\(\d{3}\)\s?\d{3}[-.[:space:]]?\d{4}|\m\d{3}[-.]\d{3}[-.]\d{4}\M') as would_release,
       count(*) filter (where found and txt ~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+\.[[:alnum:]_.-]+|\(\d{3}\)\s?\d{3}[-.[:space:]]?\d{4}|\m\d{3}[-.]\d{3}[-.]\d{4}\M') as would_stay_contact
from j group by rollup(mdl) order by mdl nulls last;
