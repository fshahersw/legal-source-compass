-- Rollback for documents-text-backlog-v1.sql: removes the read-only worklist function. No data was written by it.
-- Text already stored through public.corpus_admin_register_pdf_texts_v1 is not affected by this rollback; to take a
-- loaded byte set back out, see the lead_actions rollback in the release packet
-- (private/acq/release-documents-not-extracted-backlog/README.md).
begin;
drop function if exists public.documents_text_backlog_v1(text, integer);
commit;
