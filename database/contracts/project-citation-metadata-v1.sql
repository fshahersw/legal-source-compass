-- Scoped native citation references, without case captions, opinion text or party data.
-- An opinion ID is never substituted for a cluster ID. Depth is mention count only.
insert into public.corpus_datasets(id,label,ready,expected_records,imported_records,metadata)
select x.id,x.label,false,count(e.*),0,jsonb_build_object(
 'schema_version','native-citation-view/1','aliases',jsonb_build_array(x.id),
 'qualification',x.qualification,
 'listing',jsonb_build_object('columns',x.columns,'filters','[]'::jsonb))
from (values
 ('cl_reporter_citations','CourtListener reporter citations — scoped September 2026 snapshot','citations',
  'Formal reporter references selected through exact native cluster IDs. This is a partial metadata index, not an authority or treatment determination.',
  '[{"key":"volume","label":"Volume"},{"key":"reporter","label":"Reporter"},{"key":"page","label":"Page"},{"key":"cluster_id","label":"Native cluster ID"}]'::jsonb),
 ('cl_citation_edges','CourtListener directed citation mentions — scoped September 2026 snapshot','opinions-cited',
  'Directed edges touching 12 source-identified opinion IDs. Coverage is partial. Native depth is the number of mentions, not positive/negative treatment, precedential weight, binding authority or outcome probability. Unresolved opinion metadata remains unresolved.',
  '[{"key":"citing_opinion_id","label":"Citing opinion ID"},{"key":"cited_opinion_id","label":"Cited opinion ID"},{"key":"depth","label":"Mentions"}]'::jsonb)
) x(id,label,entity_type,qualification,columns)
left join corpus_ingest.entities e on e.source_system='courtlistener' and e.entity_type=x.entity_type and e.review_status<>'quarantined'
group by x.id,x.label,x.qualification,x.columns
on conflict(id) do update set ready=false,expected_records=excluded.expected_records,metadata=excluded.metadata,updated_at=now();

with source as (
 select e.*,case when entity_type='citations' then 'cl_reporter_citations' else 'cl_citation_edges' end dataset,
 case when entity_type='citations' then concat_ws(' ',data->>'volume',data->>'reporter',data->>'page') else 'Opinion '||(data->>'citing_opinion_id')||' cites opinion '||(data->>'cited_opinion_id') end title,
 case when entity_type='citations' then jsonb_build_object('volume',data->>'volume','reporter',data->>'reporter','page',data->>'page','type',data->>'type','cluster_id',data->>'cluster_id')
 else jsonb_build_object('citing_opinion_id',data->>'citing_opinion_id','cited_opinion_id',data->>'cited_opinion_id','depth',data->>'depth') end safe_fields,
 case when entity_type='citations' then jsonb_build_array(jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/clusters/'||(data->>'cluster_id')||'/','label','Native cluster resource'))
 else jsonb_build_array(jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/opinions/'||(data->>'citing_opinion_id')||'/','label','Citing native opinion resource'),jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/opinions/'||(data->>'cited_opinion_id')||'/','label','Cited native opinion resource')) end links
 from corpus_ingest.entities e where source_system='courtlistener' and entity_type in ('citations','opinions-cited') and review_status<>'quarantined'
)
insert into public.corpus_records(dataset,id,category,title,source_url,ordinal,item,detail,text,filters)
select s.dataset,'cl:'||native_id,'citation_index',s.title,provenance->>'source_url',row_number() over(partition by s.dataset order by native_id),
 jsonb_build_object('id','cl:'||native_id,'title',s.title,'cells',safe_fields,'links',links,'badges',jsonb_build_array('Scoped metadata')),
 jsonb_build_object('id','cl:'||native_id,'title',s.title,'facts',
  (select jsonb_agg(jsonb_build_array(key,value)) from jsonb_each_text(safe_fields))||jsonb_build_array(
   jsonb_build_array('Native record ID',native_id),jsonb_build_array('Source as of',source_as_of::text),jsonb_build_array('Retrieved at',retrieved_at::text),
   jsonb_build_array('Source SHA-256',provenance->>'source_sha256'),jsonb_build_array('Payload SHA-256',payload_sha256),jsonb_build_array('Schema version',schema_version)),
  'links',links,'sections','[]'::jsonb,'qualification',d.metadata->>'qualification'),
 jsonb_pretty(safe_fields),jsonb_build_object('_listing','true','native_id',native_id)
from source s join public.corpus_datasets d on d.id=s.dataset
on conflict(dataset,id) do update set category=excluded.category,title=excluded.title,source_url=excluded.source_url,ordinal=excluded.ordinal,item=excluded.item,detail=excluded.detail,text=excluded.text,filters=excluded.filters;

-- Reconcile every public field against the current whitelisted source projection.
with source as (
 select e.*,case when entity_type='citations' then 'cl_reporter_citations' else 'cl_citation_edges' end dataset,
 case when entity_type='citations' then concat_ws(' ',data->>'volume',data->>'reporter',data->>'page') else 'Opinion '||(data->>'citing_opinion_id')||' cites opinion '||(data->>'cited_opinion_id') end title,
 case when entity_type='citations' then jsonb_build_object('volume',data->>'volume','reporter',data->>'reporter','page',data->>'page','type',data->>'type','cluster_id',data->>'cluster_id')
 else jsonb_build_object('citing_opinion_id',data->>'citing_opinion_id','cited_opinion_id',data->>'cited_opinion_id','depth',data->>'depth') end safe_fields,
 case when entity_type='citations' then jsonb_build_array(jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/clusters/'||(data->>'cluster_id')||'/','label','Native cluster resource'))
 else jsonb_build_array(jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/opinions/'||(data->>'citing_opinion_id')||'/','label','Citing native opinion resource'),jsonb_build_object('url','https://www.courtlistener.com/api/rest/v4/opinions/'||(data->>'cited_opinion_id')||'/','label','Cited native opinion resource')) end links
 from corpus_ingest.entities e where source_system='courtlistener' and entity_type in ('citations','opinions-cited') and review_status<>'quarantined'
) , expected(dataset,id,category,title,source_url,ordinal,item,detail,text,filters) as (select s.dataset,'cl:'||native_id,'citation_index',s.title,provenance->>'source_url',row_number() over(partition by s.dataset order by native_id),
 jsonb_build_object('id','cl:'||native_id,'title',s.title,'cells',safe_fields,'links',links,'badges',jsonb_build_array('Scoped metadata')),
 jsonb_build_object('id','cl:'||native_id,'title',s.title,'facts',
  (select jsonb_agg(jsonb_build_array(key,value)) from jsonb_each_text(safe_fields))||jsonb_build_array(
   jsonb_build_array('Native record ID',native_id),jsonb_build_array('Source as of',source_as_of::text),jsonb_build_array('Retrieved at',retrieved_at::text),
   jsonb_build_array('Source SHA-256',provenance->>'source_sha256'),jsonb_build_array('Payload SHA-256',payload_sha256),jsonb_build_array('Schema version',schema_version)),
  'links',links,'sections','[]'::jsonb,'qualification',d.metadata->>'qualification'),
 jsonb_pretty(safe_fields),jsonb_build_object('_listing','true','native_id',native_id)
from source s join public.corpus_datasets d on d.id=s.dataset), differences as(select coalesce(e.dataset,r.dataset) dataset,count(e.id) expected,count(r.id) actual,count(*) filter(where row(e.dataset,e.id,e.category,e.title,e.source_url,e.ordinal,e.item,e.detail,e.text,e.filters) is distinct from row(r.dataset,r.id,r.category,r.title,r.source_url,r.ordinal,r.item,r.detail,r.text,r.filters)) mismatches from expected e full join(select dataset,id,category,title,source_url,ordinal,item,detail,text,filters from public.corpus_records where dataset in ('cl_reporter_citations','cl_citation_edges'))r using(dataset,id) group by coalesce(e.dataset,r.dataset)) update public.corpus_datasets d set imported_records=x.actual,ready=d.expected_records=x.expected and x.expected=x.actual and x.mismatches=0,updated_at=now() from differences x where d.id=x.dataset;
select id,expected_records,imported_records,ready from public.corpus_datasets where id in ('cl_reporter_citations','cl_citation_edges');
