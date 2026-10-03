-- citation-index-trailing-comma/2026-10-03.r2.1  (round 2 run af6ac9c6-b834-497d-bd19-17970d4857d3)
-- Work item A (citations accuracy). Deterministic punctuation defect: 282 citation_index titles end in a stray comma that was
-- captured from the sentence around the citation ("Pub. L. No. 104-208," / "U.S. Patent No. 5,010,782,").
-- Proof (offline, eyecite 2.7.8 + reporters-db 3.2.66): for every id below the comma-stripped string parses as exactly ONE
-- FullCitation whose matched_text() and corrected_citation() both equal the stripped string, i.e. the comma is not part of the citation.
-- 250 of the 282 are fixed here. The other 32 are NOT touched: the stripped string already exists as a separate row
-- (e.g. 21 'Pub. L. No. 104-208,' 89 mentions vs 59679 'Pub. L. No. 104-208' 1 mention); merging them would need summed counts and
-- unioned document sets, which is not a formatting fix (listed in the findings table, docs/data-quality-citations-2026-10-03.md).
-- Guards in SQL: id whitelist AND title ends in [,;:] AND no other citation_index row already has the stripped title (case-insensitive)
-- AND whole-row md5 equals the audited before-image at update time.
-- Mechanics = markdown/html passes: exact old title replaced only where it is a COMPLETE JSON string in item/detail (item.title,
-- item.cells.citation, detail.title, detail.facts 'Authority'); snippets that merely contain the text are untouched; text, filters,
-- links and source_url unchanged; search_vector is recomputed by the existing trigger (token-identical: punctuation is not indexed).
-- Counts/ordinals/ids unchanged; no row deleted.
-- Execute statement 1, then statement 2.
--
-- ROLLBACK (exact):
--   update public.corpus_records r set title = c.original_record->>'title', item = c.original_record->'item', detail = c.original_record->'detail'
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='citation_index' and c.issue='dq20261003r2_citation_trailing_comma' and c.run_id='af6ac9c6-b834-497d-bd19-17970d4857d3'
--      and r.dataset='citation_index' and r.id=c.record_id;
--
-- ===== statement 1: audit (before-images) =====
with ids(id) as (select unnest(array[
    '279', '280', '372', '866', '1035', '1036', '1264', '1265', '1603', '2131', '2132', '2907',
    '4219', '4220', '4222', '4223', '4226', '4227', '4235', '4238', '4240', '4241', '4243', '4245',
    '4247', '4252', '7218', '7221', '7231', '7234', '7235', '7244', '7246', '7256', '15220', '15224',
    '15231', '15236', '15237', '15243', '15245', '15247', '15249', '15251', '15252', '15259', '15260', '15266',
    '15290', '15292', '15293', '15295', '15297', '15299', '15304', '15313', '15316', '15323', '15324', '15327',
    '15328', '15334', '15340', '15344', '15350', '15355', '15357', '15358', '15361', '15362', '15365', '15366',
    '15368', '15369', '15370', '15371', '15374', '15375', '15376', '15377', '15378', '15379', '15382', '15383',
    '15385', '15387', '15389', '15395', '15398', '15399', '15402', '15403', '15415', '15419', '15420', '15421',
    '15425', '15428', '15430', '15431', '15432', '15435', '15437', '15438', '15443', '15445', '15458', '15459',
    '15478', '15482', '15484', '59232', '59236', '59244', '59245', '59249', '59258', '59262', '59265', '59280',
    '59301', '59306', '59312', '59315', '59331', '59337', '59346', '59354', '59358', '59364', '59365', '59376',
    '59382', '59388', '59396', '59398', '59407', '59410', '59414', '59422', '59426', '59429', '59434', '59441',
    '59451', '59460', '59490', '59524', '59529', '59530', '59552', '59553', '59560', '59571', '59585', '59589',
    '59591', '59596', '59610', '59614', '59621', '59633', '59636', '59649', '59690', '59696', '59713', '59725',
    '59735', '59737', '59742', '59768', '59775', '59778', '59789', '59792', '59795', '59806', '59815', '59817',
    '59856', '59858', '59868', '59879', '59886', '59898', '59902', '59911', '59913', '59915', '59919', '59921',
    '59931', '59934', '59935', '59937', '59938', '59939', '59940', '59941', '59942', '59943', '59944', '59945',
    '59957', '59958', '59973', '59978', '59982', '60002', '60016', '60035', '60042', '60046', '60052', '60069',
    '60072', '60076', '60081', '60087', '60088', '60101', '60116', '60123', '60148', '60151', '60155', '60166',
    '60171', '60179', '60189', '60195', '60199', '60206', '60225', '60235', '60258', '60271', '60276', '60281',
    '60298', '60304', '60320', '60325', '60326', '60335', '60339', '60443', '60445', '60452'
  ]::text[])),
target as materialized (
 select r.id, r.ordinal, r.title as old_title,
        regexp_replace(btrim(r.title), '[,;:]+$', '') as new_title,
        md5(to_jsonb(r)::text) as row_md5, r.item as old_item, r.detail as old_detail
 from public.corpus_records r join ids on ids.id = r.id
 where r.dataset = 'citation_index' and r.title ~ '[,;:]$'
   and not exists (select 1 from public.corpus_records x
                    where x.dataset = 'citation_index' and lower(x.title) = lower(regexp_replace(btrim(r.title), '[,;:]+$', ''))))
insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
select 'citation_index', t.id, 'dq20261003r2_citation_trailing_comma', 'label_override',
  'Citation title ended in a stray comma taken from the surrounding sentence. eyecite parses the comma-stripped string as the same single citation (matched_text and corrected_citation equal it), so only the punctuation is removed.',
  jsonb_build_object('review_version','citation-index-trailing-comma/2026-10-03.r2.1','parser','eyecite 2.7.8','reporters_db','3.2.66',
                     'proof','comma-stripped string parses as exactly one FullCitation with matched_text = corrected_citation = stripped string'),
  jsonb_build_object('id',t.id,'ordinal',t.ordinal,'title',t.old_title,'item',t.old_item,'detail',t.old_detail,'row_md5',t.row_md5),
  jsonb_build_object('title',t.new_title),
  'af6ac9c6-b834-497d-bd19-17970d4857d3'::uuid
from target t where t.new_title <> '' and t.new_title <> t.old_title
on conflict (dataset,record_id,issue) do nothing
returning record_id;

-- ===== statement 2: apply from the audited before-images =====
update public.corpus_records r
   set title  = c.replacement->>'title',
       item   = replace(r.item::text,   to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb,
       detail = replace(r.detail::text, to_jsonb(c.original_record->>'title')::text, to_jsonb(c.replacement->>'title')::text)::jsonb
  from corpus_ingest.cleanup_decisions c
 where c.dataset = 'citation_index' and c.issue = 'dq20261003r2_citation_trailing_comma' and c.run_id = 'af6ac9c6-b834-497d-bd19-17970d4857d3'
   and r.dataset = 'citation_index' and r.id = c.record_id
   and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
returning r.id;
