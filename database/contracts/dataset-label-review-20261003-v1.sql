-- dataset-label-review/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- Replaces raw-id labels (14) and mechanically title-cased id labels (46) in public.corpus_datasets.label
-- with human labels taken from evidence: the product vocabulary in src/lib/external/domainRegistry.ts LABELS,
-- dataset metadata (metadata.summary.native_dataset / qualification) or record-kind distributions measured on
-- 2026-10-03. Nothing else changes: ids, counts, ready/held flags, listing metadata and data are untouched.
-- Reversible: the before-image of every changed row is in corpus_ingest.cleanup_decisions
-- (dataset='corpus_datasets', issue='dq20261003_dataset_label', disposition='label_override').
--
-- ROLLBACK (exact):
--   update public.corpus_datasets d
--      set label = c.original_record->>'label',
--          metadata = d.metadata - 'label_review',
--          updated_at = (c.original_record->>'updated_at')::timestamptz
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003_dataset_label'
--      and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b' and c.record_id=d.id;
--
-- Product-label conflicts reported to ui-integration (DB label follows the content, not the UI label):
--   mdl_appearances  UI "Judge MDL appearances"  vs rows = attorney/firm/role/side per matter
--   judge_entities   UI "Judge relationships"    vs rows = consolidated judge profiles
with crosswalk(id,new_label,basis,note) as (values
 ('coverage_labels','Coverage labels','product_vocabulary','domainRegistry LABELS; 10,013 held rows, category guidance, source coverage_labels.jsonl'),
 ('coverage_topics','Coverage topics','product_vocabulary','domainRegistry LABELS; 17,942 held rows (statutes 15,670 / regulations 1,148 / guidance 1,124)'),
 ('federal','Federal court websites and legal reference resources','record_kind_evidence','kinds: federal_legal_reference_resource 118, federal_order_document_link 66, federal_court_practice_or_case_resource 36, federal_court_of_appeals_website 12, doj_manual_resource 11, federal_rule_or_practice_resource 8, district/bankruptcy/probation/defender website kinds (577 rows)'),
 ('focused','Focused state and county legal-source captures','record_kind_evidence','kinds incl. needs_content_review, law_document_title_evidence_needs_review, coverage_county, county_government_entry_unreviewed, legal_inventory_navigation, local_rules, court_clerk_office (16,450 rows)'),
 ('judge_enrichment','Judge profile source observations','record_kind_evidence','kinds: trellis_directory 4,458, federal_biographies (FJC) 4,074, official_observation 1,978, trellis_profile 1,300, state_evaluations 116 (11,926 rows)'),
 ('judge_entities','Consolidated judge profiles','record_kind_evidence','all 10,669 rows have kind "Judge profile"; domainRegistry RECORD_GRAINS: consolidated profile records'),
 ('judge_vendor','Judge vendor analysis previews','record_kind_evidence','kind "Vendor preview and reported analysis"; source advance.lexis.com permalinks (2 rows)'),
 ('library_assets','Library files','product_vocabulary','domainRegistry LABELS; single held row "Allowlisted library illustrations and documents"'),
 ('open_us_law','U.S. law collection','product_vocabulary','domainRegistry LABELS; held collection of 2,968,623 provisions behind corpus_law_collections/nodes'),
 ('pending_publication','Law and court-rule captures pending publication','record_kind_evidence','kinds: local_laws_codes 182, statutes 81, local_rules 24, court_forms_filing_documents 14 (301 rows)'),
 ('provider_laws','Provider laws','casing_only','single law_directory row (New York State Human Rights Law); no evidence of narrower scope, so the id words are kept'),
 ('seeger','Saved court forms, court rules and statutory provisions','record_kind_evidence','kinds: court_form_or_other_document 10,543, statutory_provision 6,695, court_rule_or_order 635, rule_provision 238, regulatory_provision 233, reference_original 13 (18,357 rows)'),
 ('trellis_browser_counties','Trellis county coverage pages','record_kind_evidence','kind coverage_county; trellis.law/coverage URLs (6 rows)'),
 ('trellis_receipts','Trellis connector receipts','record_kind_evidence','2,550 rows with tool, arguments and called_at fields; record_kind "connector text payload ... not original HTTP bytes"'),
 ('agency_safety_cpsc_recalls_local','CPSC product recalls','manifest_evidence','metadata.summary: native_dataset cpsc_recalls_local, id_prefix cpsc:rcl:, group cpsc'),
 ('agency_safety_fda_press_recalls','FDA press-release recalls','manifest_evidence','metadata.summary: native_dataset fda_press_recalls, id_prefix fda-press:'),
 ('agency_safety_fda_warning_letters','FDA warning letters','manifest_evidence','metadata.summary: native_dataset fda_warning_letters, id_prefix fda-wl:'),
 ('agency_safety_openfda_crl','FDA complete response letters (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_crl, id_prefix openfda:transparency/crl:; safetyKind vocabulary crl = complete response letters'),
 ('agency_safety_openfda_device_classification','FDA device classification (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_device_classification'),
 ('agency_safety_openfda_device_enforcement','FDA device enforcement reports (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_device_enforcement'),
 ('agency_safety_openfda_device_pma','FDA device PMA approvals (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_device_pma; safetyKind vocabulary pma = PMA approvals'),
 ('agency_safety_openfda_drug_enforcement','FDA drug enforcement reports (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_drug_enforcement'),
 ('agency_safety_openfda_drug_shortages','FDA drug shortages (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_drug_shortages'),
 ('agency_safety_openfda_drugsfda','Drugs@FDA approvals (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_drugsfda; safetyKind vocabulary drugsfda = Drugs@FDA approvals'),
 ('agency_safety_openfda_food_enforcement','FDA food enforcement reports (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_food_enforcement'),
 ('agency_safety_openfda_orangebook','FDA Orange Book (openFDA)','manifest_evidence','metadata.summary: native_dataset openfda_orangebook; safetyKind vocabulary orangebook = Orange Book'),
 ('agency_science_documents','Agency science documents','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('citation_index','Citation index','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('citation_reference','Citation reference','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('counsel_directory','Counsel directory','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('court_documents','Court documents','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('court_reference','Court profiles & seals','product_vocabulary','domainRegistry LABELS; qualification: court facts and seals from the Free Law Project court and seal databases'),
 ('court_spine','Court directory','product_vocabulary','domainRegistry LABELS; court registry records'),
 ('court_statistics','Court statistics','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('cpsc_injury_data','CPSC injury data','product_vocabulary','domainRegistry LABELS; acronym CPSC; qualification states NEISS is a probability sample, not a census'),
 ('docsupload_coverage','Document coverage','product_vocabulary','domainRegistry LABELS'),
 ('expert_rulings','Expert rulings','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('federal_register_history','Federal Register history','product_vocabulary','domainRegistry LABELS'),
 ('federal_regulations_documents','CFR source documents','product_vocabulary','domainRegistry LABELS'),
 ('federal_regulations_parts','CFR parts','product_vocabulary','domainRegistry LABELS'),
 ('federal_regulations_sections','CFR sections','product_vocabulary','domainRegistry LABELS'),
 ('judge_disclosures','Judge financial disclosures','record_evidence','qualification: judge financial disclosures built from CourtListener bulk data; product label "Financial disclosures" made explicit'),
 ('judge_portraits','Judge portraits','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('limitation_periods','Limitation periods','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('mdl_appearances','MDL counsel appearances','record_kind_evidence','rows are attorney/firm/role/side appearances per matter (item.cells.firm, role, side, linkage); product label "Judge MDL appearances" conflicts with the content'),
 ('mdl_case_inventory','MDL case inventory','record_evidence','docket-level case inventory (cells: docket, court, filed, status, mdl); acronym MDL'),
 ('mdl_counsel','MDL counsel and parties','record_kind_evidence','listing_modes kind: firm 2,213 / attorney 4,432 / party 295'),
 ('mdl_crosswalk','MDL crosswalk','record_evidence','qualification: id spine joining the JPML MDL registry; acronym MDL'),
 ('mdl_docket_activity','MDL docket activity','record_evidence','docket-entry activity per MDL master docket; acronym MDL'),
 ('mdl_docket_documents','MDL docket documents','record_evidence','master-docket paper trail per MDL; acronym MDL'),
 ('public_laws','Public laws','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('saved_pages','Saved source pages','product_vocabulary','domainRegistry LABELS'),
 ('sd_statutes','South Dakota Codified Laws','manifest_evidence','qualification: South Dakota Codified Laws title-level cache'),
 ('source_documents','Source documents','product_vocabulary','domainRegistry LABELS (sentence case)'),
 ('state_codes','State codes','casing_only','sentence case of the id words'),
 ('state_proceedings','State proceedings','casing_only','sentence case of the id words'),
 ('url_directory','URL directory','product_vocabulary','domainRegistry LABELS; acronym URL'),
 ('uscourts_pages','U.S. Courts pages','product_vocabulary','domainRegistry LABELS'),
 ('verdict_reports','Verdict reports','casing_only','held collection; sentence case of the id words')
), target as materialized (
 select d.id, d.label as old_label, d.updated_at as old_updated_at, c.new_label, c.basis, c.note
 from public.corpus_datasets d join crosswalk c on c.id = d.id
 where d.label is distinct from c.new_label and not (d.metadata ? 'label_review')
), audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', t.id, 'dq20261003_dataset_label', 'label_override',
  'Stored label was the raw dataset id or a mechanically title-cased id. Replaced with an evidence-based human label; dataset id, rows, counts and publication flags are unchanged.',
  jsonb_build_object('review_version','dataset-label-review/2026-10-03.1','basis',t.basis,'note',t.note),
  jsonb_build_object('id',t.id,'label',t.old_label,'updated_at',t.old_updated_at),
  jsonb_build_object('label',t.new_label),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t
 on conflict(dataset,record_id,issue) do nothing
 returning record_id
), updated as (
 update public.corpus_datasets d
    set label = t.new_label,
        metadata = d.metadata || jsonb_build_object('label_review', jsonb_build_object('version','dataset-label-review/2026-10-03.1','previous_label',t.old_label,'basis',t.basis,'run_id','664a081e-b5a6-4ab0-af5a-41c260b0d09b')),
        updated_at = now()
   from target t join audited a on a.record_id = t.id
  where d.id = t.id and d.label = t.old_label
  returning d.id
)
select jsonb_build_object('contract','dataset-label-review/2026-10-03.1','crosswalk_rows',(select count(*) from crosswalk),
 'targets',(select count(*) from target),'audit_rows_written',(select count(*) from audited),'rows_updated',(select count(*) from updated),
 'ready_flags_changed',0,'checked_at',now()) as receipt;
