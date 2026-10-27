-- Rollback for legal-atlas-rin-lineage-v1.sql: the function is new, so rollback drops it.
drop function if exists public.corpus_legal_rin_v1(text, integer);
