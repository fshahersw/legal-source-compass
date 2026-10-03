-- dataset-label-accuracy-addendum/2026-10-03.1  (run 664a081e-b5a6-4ab0-af5a-41c260b0d09b)
-- expert_rulings: the label "Expert rulings" overstates the content. Measured kinds (2,035 rows): order 810, motion 511,
-- opposition 436, reply 148, exhibit 79, other 51. The dataset qualification states it is a keyword/category scan of docket
-- entries for expert admissibility (Daubert ...). A litigator reading "rulings" would assume court decisions on admissibility.
-- New label: "Expert-admissibility docket entries (keyword scan)". UI vocabulary (domainRegistry LABELS.expert_rulings) should follow.
-- Reversible: before-image in corpus_ingest.cleanup_decisions (issue dq20261003_dataset_label_accuracy).
--
-- ROLLBACK (exact):
--   update public.corpus_datasets d set label = c.original_record->>'label', metadata = d.metadata - 'label_accuracy_review', updated_at = now()
--     from corpus_ingest.cleanup_decisions c
--    where c.dataset='corpus_datasets' and c.issue='dq20261003_dataset_label_accuracy' and c.record_id=d.id
--      and c.run_id='664a081e-b5a6-4ab0-af5a-41c260b0d09b';
with target as materialized (
 select d.id, d.label as old_label, d.metadata
 from public.corpus_datasets d
 where d.id = 'expert_rulings' and d.label = 'Expert rulings' and not (d.metadata ? 'label_accuracy_review')),
audited as (
 insert into corpus_ingest.cleanup_decisions(dataset,record_id,issue,disposition,reason,evidence,original_record,replacement,run_id)
 select 'corpus_datasets', t.id, 'dq20261003_dataset_label_accuracy', 'label_override',
  'Label said rulings but 60% of rows are motions, oppositions, replies or exhibits found by a keyword scan of docket entries; label corrected to describe the content. Data and flags unchanged.',
  jsonb_build_object('review_version','dataset-label-accuracy-addendum/2026-10-03.1','basis','record_kind_evidence',
     'kinds', (select jsonb_object_agg(k, n) from (select coalesce(item->'cells'->>'kind','(none)') k, count(*) n from public.corpus_records where dataset='expert_rulings' group by 1) q),
     'qualification_excerpt','Keyword/category scan of docket entries for expert-admissibility (Daubert ...)'),
  jsonb_build_object('id', t.id, 'label', t.old_label),
  jsonb_build_object('label', 'Expert-admissibility docket entries (keyword scan)'),
  '664a081e-b5a6-4ab0-af5a-41c260b0d09b'::uuid
 from target t on conflict (dataset,record_id,issue) do nothing returning record_id),
updated as (
 update public.corpus_datasets d
    set label = 'Expert-admissibility docket entries (keyword scan)',
        metadata = d.metadata || jsonb_build_object('label_accuracy_review', jsonb_build_object('version','dataset-label-accuracy-addendum/2026-10-03.1','previous_label',t.old_label,'run_id','664a081e-b5a6-4ab0-af5a-41c260b0d09b')),
        updated_at = now()
   from target t join audited a on a.record_id = t.id
  where d.id = t.id and d.label = t.old_label
  returning d.id)
select jsonb_build_object('contract','dataset-label-accuracy-addendum/2026-10-03.1','targets',(select count(*) from target),
 'audit_rows_written',(select count(*) from audited),'rows_updated',(select count(*) from updated),'checked_at',now()) as receipt;
