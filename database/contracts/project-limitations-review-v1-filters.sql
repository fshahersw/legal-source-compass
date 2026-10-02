update public.corpus_records set category='statutory_limitations_review' where dataset='statutory_limitations_review';
with state_options as(
 select jsonb_agg(jsonb_build_object('value',state,'label',state,'count',n) order by state)as options from(select state,count(*)as n from public.corpus_records where dataset='statutory_limitations_review' group by state)s
), claim_options as(
 select jsonb_agg(jsonb_build_object('value',claim,'label',replace(claim,'_',' '),'count',n) order by claim)as options from(select filters->>'claim_type'as claim,count(*)as n from public.corpus_records where dataset='statutory_limitations_review' group by filters->>'claim_type')s
), computation_options as(
 select jsonb_agg(jsonb_build_object('value',computation,'label',case when computation='baseline_only' then 'Conditional calendar baseline'else'Further legal review'end,'count',n)order by computation)as options from(select filters->>'computation'as computation,count(*)as n from public.corpus_records where dataset='statutory_limitations_review' group by filters->>'computation')s
), changed as(
 update public.corpus_datasets d set metadata=jsonb_set(metadata,'{listing,filters}',jsonb_build_array(
 jsonb_build_object('name','state','type','select','label','Jurisdiction','options',s.options),
 jsonb_build_object('name','claim_type','type','select','label','Claim category','options',c.options),
 jsonb_build_object('name','computation','type','select','label','Review/computation scope','options',o.options))),updated_at=now()
 from state_options s,claim_options c,computation_options o where d.id='statutory_limitations_review'
 returning d.id,d.ready,d.imported_records,d.metadata->'listing'->'filters'as filters
)select to_jsonb(changed)as receipt from changed;
