-- READ-ONLY review contract. No database mutation.
-- A reviewer must receive exactly one original record before applying any overlay.
-- Source-native values and PDF bytes remain unchanged. Store original_record and
-- the reviewed decision privately before a separately authorized presentation change.
with target as (
  select r.*
  from public.corpus_records r
  where r.dataset = 'court_forms_expansion_20260912'
    and r.id = 'court-forms-20260912:eee201431ecd085aabdd34a0'
    and r.source_url = 'https://www.ca1.uscourts.gov/sites/ca1/files/Best_Practices_for_Filing_CJA_24_and_Transcript_Order_Forms.pdf'
    and r.title = 'Best Practices for Filing CJA 24 and Transcript Order Forms'
    and r.category = 'court_documents'
    and r.item->'cells'->>'doc_type' = 'Court form'
    and md5(to_jsonb(r)::text) = '3d19728b9d879713f106b39106b94526'
)
select
  dataset,
  id as record_id,
  'source_document_label_review' as issue,
  'label_override' as proposed_disposition,
  to_jsonb(target) as original_record,
  jsonb_build_object(
    'reviewVersion', 'source-type-review/2026-10-02.1',
    'reviewedDocumentType', 'Instructions / supporting material',
    'sourceDocumentType', item->'cells'->>'doc_type',
    'sourceLabelPreserved', true,
    'categoryUnchanged', category,
    'sourceFiltersUnchanged', true,
    'sourceFileSHA256', 'eee201431ecd085aabdd34a0027dff06860b15c97d575e1593e978d8399a6254',
    'evidence', jsonb_build_object(
      'sourceUrl', source_url,
      'publisherTitle', title,
      'basis', 'Saved publisher title and first-page extracted text identify best-practice filing instructions',
      'retrievalDateIsEffectiveDate', false,
      'currentApplicabilityReviewed', false
    ),
    'intendedDisplayOverlay', jsonb_build_object(
      'reviewed_doc_type', 'Instructions / supporting material',
      'reviewed_doc_type_version', 'source-type-review/2026-10-02.1'
    )
  ) as proposed_review
from target;
