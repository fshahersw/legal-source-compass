-- Rollback of corpus-pdf-assets-v2.sql: the four comments back to NULL (their state before 2026-10-27).
-- The registration function is not touched here; its rollback is corpus-register-pdf-assets-v2.rollback.sql.

begin;

comment on table corpus_ingest.pdf_asset_observations is null;
comment on column corpus_ingest.local_pdf_asset_occurrences.private_quarantine_required is null;
comment on column corpus_ingest.local_pdf_asset_occurrences.public_projection_allowed is null;
comment on column corpus_ingest.local_pdf_asset_occurrences.source_seal_status is null;

commit;
