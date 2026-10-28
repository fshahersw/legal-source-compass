-- corpus-pdf-assets-v2.sql — comments only (release category pdf-asset-projection-annotation).
-- Owner decision 2026-10-27 (AGENTS.md): "dont withhold any data. If its accurate and valuable, USE IT".
--
-- The stored PDF intake annotations are history, not holds. No reader in database/contracts, src/ or the live database
-- gates on them; availability, matter documents, object streaming, page text, search and documents_refresh_v1 all go
-- through public.corpus_pdf_availability_v1 on pdf_document_assets.provider_flags.
--
-- This file only sets four comments; it changes no function and no table data. The registration function change this
-- category first proposed (record source_seal_status only) was superseded by corpus-register-pdf-assets-v2.sql
-- (category pdf-observation-privacy-label, applied 2026-10-27), which replaces the same function: new observations carry
-- source_privacy_qualification {rule 'corpus_pdf_availability_v2', source_seal_status, availability,
-- public_projection_allowed = availability 'open', hold_basis = the explicit flag or null}. Both could not be live.
--
-- Counts read on 2026-10-27 (unchanged by this file): pdf_asset_observations 204,823, of which 142,552 carry the v1
-- private_quarantine_required=true (130,643 PDFs), all on associations corpus_pdf_availability_v1 reports 'open'.
-- local_pdf_asset_occurrences 752: 740 unknown_local_blank (628 PDFs), 12 locally_flagged_sealed (12 PDFs). The CHECK
-- constraints forcing private_quarantine_required=true / public_projection_allowed=false on local occurrences stay: the
-- frozen local packets assert those values and their hashes are pinned (scripts/ingest, de-dockets workstream).
-- Rollback: corpus-pdf-assets-v2.rollback.sql (comments back to NULL). Verify: corpus-pdf-assets-v2.verify.sql.

begin;

comment on table corpus_ingest.pdf_asset_observations is 'Repeated verified observations of a native PDF association. Observations registered before 2026-10-27 carry observation.source_privacy_qualification {source_seal_status, private_quarantine_required, public_projection_allowed=false}: a historical intake annotation, not a hold. From 2026-10-27 (corpus-register-pdf-assets-v2.sql) it records rule corpus_pdf_availability_v2: source_seal_status, availability, public_projection_allowed (availability = open) and hold_basis (an explicit flag only), as a registration-time snapshot. Availability comes only from public.corpus_pdf_availability_v1 on pdf_document_assets.provider_flags.';
comment on column corpus_ingest.local_pdf_asset_occurrences.private_quarantine_required is 'Historical intake annotation forced true by the v1 contract for every local bundle occurrence. Not a hold: no reader gates on it (owner decision 2026-10-27).';
comment on column corpus_ingest.local_pdf_asset_occurrences.public_projection_allowed is 'Historical intake annotation forced false by the v1 contract for every local bundle occurrence. Not a hold: no reader gates on it (owner decision 2026-10-27).';
comment on column corpus_ingest.local_pdf_asset_occurrences.source_seal_status is 'Seal status as recorded in the firm''s local bundle. Only ''locally_flagged_sealed'' is an explicit seal flag and is used for exclusion (documents_refresh_v1); ''unknown_local_blank'' and ''unknown_local_literal'' mean the bundle recorded nothing and are not holds.';

commit;
