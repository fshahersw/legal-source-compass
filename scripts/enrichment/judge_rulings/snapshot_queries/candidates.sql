-- Candidate expert-admissibility rulings (read-only): MDL documents typed order/opinion and master-docket entries whose printed text names an
-- expert / Daubert / Rule 702 motion together with a disposition word. The builder decides what is a ruling; this only narrows the scan.
with doc as (
  select jsonb_build_object('source', 'documents', 'id', d.id, 'mdl', d.mdl, 'court_id', d.court_id, 'docket_number', d.docket_number,
         'entry_number', d.entry_number, 'date', d.filed_date, 'doc_type', d.doc_type, 'text', d.title, 'source_url', d.source_url,
         'withheld', d.withheld_reason) as j
  from documents.documents d
  where d.mdl is not null and d.doc_type in ('order', 'opinion') and d.withheld_reason is null
    and d.title ~* '(expert|daubert|rule 702|evid(ence)?\.? 702)' and d.title ~* '(grant|den(y|ie)|moot|defer|reserv)'),
ent as (
  select jsonb_build_object('source', 'sw_docket_entries_v1', 'id', r.id, 'mdl', r.item->'cells'->>'mdl', 'court_id', r.item->'cells'->>'court_id',
         'docket_number', r.item->'cells'->>'docket_number', 'entry_number', r.item->'cells'->'entry_number', 'date', r.item->'cells'->>'date_filed',
         'doc_type', 'docket_entry', 'text', r.item->'cells'->>'description', 'source_url', r.source_url,
         'withheld', r.item->'cells'->>'description_withheld', 'truncated', r.item->'cells'->'description_truncated') as j
  from public.corpus_records r
  where r.dataset = 'sw_docket_entries_v1' and coalesce(r.item->'cells'->>'description_withheld', '') = ''
    and (r.item->'cells'->>'description') ~* '(expert|daubert|rule 702|evid(ence)?\.? 702)'
    and (r.item->'cells'->>'description') ~* '(grant|den(y|ie)|moot|defer|reserv)'
    and (r.item->'cells'->>'description') ~* '^\s*\*?\s*(memorandum )?(opinion|order)')
select jsonb_agg(j order by j->>'source', j->>'mdl', j->>'date', j->>'id') as candidates from (select j from doc union all select j from ent) q
