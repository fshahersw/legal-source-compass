-- State codes: stop projecting the four third-party statute editions (GA, AR, TN, MS).
-- Release key: state-codes-staged-not-projected (2026-10-27). Lead applies; workers never write production.
--
-- Why: corpus_ingest.publisher_code_states_v2 marks these four reviewed with public_projection_allowed = true, so
-- public.corpus_publisher_code_projected_* (the State codes catalog) serves them today. Their publishers are not the
-- states' official government publishers:
--   GA  ga-georgiacommons-2025      "Georgia Commons (third-party edition archive)", 29,682 sections
--   AR  ar-historical-rtf-20201106  "Public.Resource.Org / Internet Archive (third-party historical source)", 37,504
--   TN  tn-historical-rtf-20210521  same, 34,356
--   MS  ms-historical-rtf-20200708  same, 28,913
-- AGENTS.md owner instruction 2026-10-19 (statutes, constitutions, regulations and court rules only from the official
-- government publishers) and owner decision 2026-10-27 ("It does not relax ... the source rules (official publishers
-- for statutes ...)") keep them out. This is a source-rule exclusion, not a caution hold. Nothing is deleted: the
-- intake rows, originals and manifests stay; the flag flips back with the rollback file.
-- The trigger publisher_code_states_v2_mirror_v3 copies the flag and note to corpus_ingest.publisher_code_codes_v3.
--
-- Before (read-only):
--   select jurisdiction, source_system, public_projection_allowed from corpus_ingest.publisher_code_states_v2
--    where jurisdiction in ('GA','AR','TN','MS') order by 1;                          -- 4 rows, all true
--   select count(*) from jsonb_array_elements(public.corpus_publisher_code_projected_states_v2());   -- 51
-- After:
--   same first query -> 4 rows, all false; second -> 47;
--   select jurisdiction, public_projection_allowed from corpus_ingest.publisher_code_codes_v3
--    where jurisdiction in ('GA','AR','TN','MS');                                     -- 4 rows, all false
-- Rollback: database/contracts/state-codes-third-party-projection-off-v1.rollback.sql

begin;
set local statement_timeout = '30s';

do $$
declare n int;
begin
  select count(*) into n
  from corpus_ingest.publisher_code_states_v2
  where (jurisdiction, source_system) in (('GA', 'ga-georgiacommons-2025'), ('AR', 'ar-historical-rtf-20201106'),
                                          ('TN', 'tn-historical-rtf-20210521'), ('MS', 'ms-historical-rtf-20200708'))
    and public_projection_allowed
    and publisher ~* 'third-party';
  if n <> 4 then
    raise exception 'expected 4 projected third-party state codes, found %; nothing changed', n;
  end if;
end $$;

update corpus_ingest.publisher_code_states_v2
set public_projection_allowed = false,
    notes = coalesce(notes, '') || E'\n[state-codes-third-party-projection-off-v1 2026-10-27] projection withdrawn: '
      || 'third-party edition, not the official government publisher (AGENTS.md owner instruction 2026-10-19; '
      || 'source rule kept by owner decision 2026-10-27). Rollback: '
      || 'database/contracts/state-codes-third-party-projection-off-v1.rollback.sql',
    updated_at = now()
where (jurisdiction, source_system) in (('GA', 'ga-georgiacommons-2025'), ('AR', 'ar-historical-rtf-20201106'),
                                        ('TN', 'tn-historical-rtf-20210521'), ('MS', 'ms-historical-rtf-20200708'))
  and public_projection_allowed;

do $$
declare n int;
begin
  select count(*) into n from jsonb_array_elements(public.corpus_publisher_code_projected_states_v2()) x
  where x->>'jurisdiction' in ('GA', 'AR', 'TN', 'MS');
  if n <> 0 then
    raise exception 'third-party states still projected (%); rolled back', n;
  end if;
end $$;

commit;
