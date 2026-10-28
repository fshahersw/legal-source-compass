-- Rollback of corpus-sw-docketbird-read-v1.sql: the function is additive (nothing else depends on it in the database), so rollback drops it.
-- Run only after sw_docket_documents_v1 has been restored or no projector run needs the function any more.
drop function if exists public.corpus_sw_docketbird_read_v1(text, text[], text, integer);
