-- Metadata view only. Official legal editions remain the unfetched GovInfo locators.
insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata)
select 'regulatory_backfill','Federal Register — August 21–October 2, 2026 metadata',false,count(*),0,
jsonb_build_object('schema_version','federal-register-view/1','aliases',jsonb_build_array('regulatory_backfill'),
 'qualification','Publisher metadata index captured October 2, 2026. Notices, proposed rules, rules and presidential documents are distinct publisher types. This is not an operative-regulation inventory; publication and effective dates do not resolve provision-level applicability. Linked GovInfo PDFs are the official editions and were not downloaded.',
 'listing',jsonb_build_object('columns','[{"key":"document_number","label":"Native document number"},{"key":"type","label":"Publisher type"},{"key":"publication_date","label":"Published"},{"key":"effective_on","label":"Recorded effective date"},{"key":"citation","label":"FR citation"}]'::jsonb,'filters','[]'::jsonb))
from corpus_ingest.entities where source_system='federalregister' and entity_type='documents'
on conflict(id) do update set ready=false,expected_records=excluded.expected_records,metadata=excluded.metadata,updated_at=now();

insert into public.corpus_records(dataset,id,category,title,source_url,ordinal,item,detail,text,filters)
select 'regulatory_backfill','fr:'||native_id,'regulatory_backfill',data->>'title',data->>'html_url',row_number()over(order by data->>'publication_date',native_id),
 jsonb_build_object('id','fr:'||native_id,'title',data->>'title','subtitle',data->>'citation','cells',data-'title',
  'badges',jsonb_build_array('Publisher metadata',data->>'type'),
  'links',jsonb_build_array(jsonb_build_object('url',data->>'html_url','label','Publisher document'),jsonb_build_object('url',data->>'pdf_url','label','Official GovInfo edition — not downloaded'))),
 jsonb_build_object('id','fr:'||native_id,'title',data->>'title','subtitle',data->>'citation',
  'facts',jsonb_build_array(jsonb_build_array('Native document number',native_id),jsonb_build_array('Publisher type',data->>'type'),jsonb_build_array('Publication date',data->>'publication_date'),jsonb_build_array('Recorded effective date',data->>'effective_on'),jsonb_build_array('Schema version',schema_version),jsonb_build_array('Source as of',source_as_of::text),jsonb_build_array('Retrieved at',retrieved_at::text),jsonb_build_array('Original response SHA-256',provenance->>'source_sha256'),jsonb_build_array('Payload SHA-256',payload_sha256)),
  'links',jsonb_build_array(jsonb_build_object('url',data->>'html_url','label','Publisher document'),jsonb_build_object('url',data->>'pdf_url','label','Official GovInfo edition — not downloaded')),
  'sections','[]'::jsonb,'qualification','Native publisher metadata. Corrections, related-document IDs and CFR references remain source-recorded fields. No finding that a rule is currently operative; no PDF bytes retrieved.'),
 jsonb_pretty(data),jsonb_build_object('_listing','true','type',data->>'type','published',data->>'publication_date','native_id',native_id)
from corpus_ingest.entities where source_system='federalregister' and entity_type='documents' and review_status<>'quarantined'
on conflict(dataset,id)do update set category=excluded.category,title=excluded.title,source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters;

-- Reconcile every public field against the current whitelisted source projection.
with expected(dataset,id,category,title,source_url,ordinal,item,detail,text,filters) as (select 'regulatory_backfill','fr:'||native_id,'regulatory_backfill',data->>'title',data->>'html_url',row_number()over(order by data->>'publication_date',native_id),
 jsonb_build_object('id','fr:'||native_id,'title',data->>'title','subtitle',data->>'citation','cells',data-'title',
  'badges',jsonb_build_array('Publisher metadata',data->>'type'),
  'links',jsonb_build_array(jsonb_build_object('url',data->>'html_url','label','Publisher document'),jsonb_build_object('url',data->>'pdf_url','label','Official GovInfo edition — not downloaded'))),
 jsonb_build_object('id','fr:'||native_id,'title',data->>'title','subtitle',data->>'citation',
  'facts',jsonb_build_array(jsonb_build_array('Native document number',native_id),jsonb_build_array('Publisher type',data->>'type'),jsonb_build_array('Publication date',data->>'publication_date'),jsonb_build_array('Recorded effective date',data->>'effective_on'),jsonb_build_array('Schema version',schema_version),jsonb_build_array('Source as of',source_as_of::text),jsonb_build_array('Retrieved at',retrieved_at::text),jsonb_build_array('Original response SHA-256',provenance->>'source_sha256'),jsonb_build_array('Payload SHA-256',payload_sha256)),
  'links',jsonb_build_array(jsonb_build_object('url',data->>'html_url','label','Publisher document'),jsonb_build_object('url',data->>'pdf_url','label','Official GovInfo edition — not downloaded')),
  'sections','[]'::jsonb,'qualification','Native publisher metadata. Corrections, related-document IDs and CFR references remain source-recorded fields. No finding that a rule is currently operative; no PDF bytes retrieved.'),
 jsonb_pretty(data),jsonb_build_object('_listing','true','type',data->>'type','published',data->>'publication_date','native_id',native_id)
from corpus_ingest.entities where source_system='federalregister' and entity_type='documents' and review_status<>'quarantined'), differences as(select coalesce(e.dataset,r.dataset) dataset,count(e.id) expected,count(r.id) actual,count(*) filter(where row(e.dataset,e.id,e.category,e.title,e.source_url,e.ordinal,e.item,e.detail,e.text,e.filters) is distinct from row(r.dataset,r.id,r.category,r.title,r.source_url,r.ordinal,r.item,r.detail,r.text,r.filters)) mismatches from expected e full join(select dataset,id,category,title,source_url,ordinal,item,detail,text,filters from public.corpus_records where dataset in ('regulatory_backfill'))r using(dataset,id) group by coalesce(e.dataset,r.dataset)) update public.corpus_datasets d set imported_records=x.actual,ready=d.expected_records=x.expected and x.expected=x.actual and x.mismatches=0,updated_at=now() from differences x where d.id=x.dataset;
select id,expected_records,imported_records,ready from public.corpus_datasets where id in ('regulatory_backfill');
