-- Authorized exact label cleanup. Preserve the original row and its source fields.
with target as materialized (
 select r.* from public.corpus_records r
 where r.dataset='court_forms_expansion_20260912'
 and r.id='court-forms-20260912:eee201431ecd085aabdd34a0'
 and r.source_url='https://www.ca1.uscourts.gov/sites/ca1/files/Best_Practices_for_Filing_CJA_24_and_Transcript_Order_Forms.pdf'
 and r.title='Best Practices for Filing CJA 24 and Transcript Order Forms'
 and r.category='court_documents' and r.item->'cells'->>'doc_type'='Court form'
 and md5(to_jsonb(r)::text)='3d19728b9d879713f106b39106b94526'
), reviewed as (
 select t.*,jsonb_build_object('reviewed_doc_type','Instructions / supporting material','reviewed_doc_type_version','source-type-review/2026-10-02.1') overlay from target t
 where (select count(*)from target)=1
), audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select dataset,id,'source_document_label_review','label_override',
 'Saved publisher title and already captured first-page text identify filing instructions; source-native Court form label is retained.',
 jsonb_build_object('source_url',source_url,'source_file_sha256','eee201431ecd085aabdd34a0027dff06860b15c97d575e1593e978d8399a6254','original_row_md5','3d19728b9d879713f106b39106b94526','review_version','source-type-review/2026-10-02.1','current_applicability_reviewed',false,'new_pdf_downloads',0),
 to_jsonb(reviewed)-'overlay',overlay,'76552380-b324-43ec-bcfb-5bbb5565e78a'::uuid from reviewed
 on conflict(dataset,record_id,issue)do nothing returning dataset,record_id
), updated as (
 update public.corpus_records r set item=jsonb_set(r.item,'{cells}',(r.item->'cells')||t.overlay),detail=r.detail||t.overlay
 from reviewed t join audited a on a.dataset=t.dataset and a.record_id=t.id
 where r.dataset=t.dataset and r.id=t.id and md5(to_jsonb(r)::text)='3d19728b9d879713f106b39106b94526'
 returning r.dataset,r.id
)
select jsonb_build_object('exact_original_matches',(select count(*)from target),'audit_decisions_written',(select count(*)from audited),'display_overlays_written',(select count(*)from updated),'pdf_downloads',0)receipt;

-- Separate independent reconciliation, preserving category, filters, raw text,
-- source URL, original cells, subtitle, and every other original detail field.
with review as(
 select original_record,replacement from corpus_ingest.cleanup_decisions
 where dataset='court_forms_expansion_20260912' and record_id='court-forms-20260912:eee201431ecd085aabdd34a0' and issue='source_document_label_review'
), actual as(
 select to_jsonb(r)doc from public.corpus_records r where r.dataset='court_forms_expansion_20260912' and r.id='court-forms-20260912:eee201431ecd085aabdd34a0'
)
select jsonb_build_object('records_checked',count(*),'item_mismatches',count(*)filter(where jsonb_set(original_record->'item','{cells}',(original_record->'item'->'cells')||replacement)is distinct from doc->'item'),'detail_mismatches',count(*)filter(where (original_record->'detail')||replacement is distinct from doc->'detail'),'other_field_mismatches',count(*)filter(where original_record-'item'-'detail' is distinct from doc-'item'-'detail'))receipt from review cross join actual;
