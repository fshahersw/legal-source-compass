# Corpus cleanup 2026-10-28

Contract: `database/contracts/drop-scratch-6248-20261028.sql` (applied 2026-10-28 on corpussite).

## Removed

| Object | Rows | Size | Why it was safe |
|---|---|---|---|
| `corpus_ingest.tx_corpus_paths_6248` | 121,902 | 9 MB | Oct 7 export scratch for the TX path reconciliation. No primary key, no repo reference, no view or function dependency except its own export function, no writes since 2026-10-07. |
| `public.corpus_export_tx_paths_6248(int,int)` | | | Only reader of the table above; no callers in the database or repo. |
| `corpus_ingest.vt_section_hash_before_6248` | 26,263 | 3 MB | Oct 7 "before" hash snapshot for the VT section check, long since verified. Same checks as above. |
| cron job `release-docs-ef-build` | | | One-time documents build scheduled `32 23 27 10 *`; ran once on 2026-10-27 23:32 UTC and succeeded. Left in place it would run again on 2027-10-27. |

Rollback: the scratch tables were derived from `state_law.sections_tx` / `sections_vt` paths and hashes on 2026-10-07 and are not recoverable byte for byte; nothing reads them. The cron job can be recreated from the command recorded in git history of this file's contract notes if a rebuild is wanted (`public.documents_refresh_v1` + `documents_build_pages_v1` loop).

## Reviewed and kept

| Object | Size | Reason kept |
|---|---|---|
| `corpus_ingest.cl_docket_metadata_fields_backup_20261027` (+ `_dataset_backup_`) | 667 MB | Rollback source for `cl-docket-metadata-fields-v2.rollback.sql` (applied yesterday). Drop once that change has held for a few weeks. |
| `corpus_ingest.trellis_ready_withdrawal_20261027`, `held_artifact_release_20261027`, `ecfr_text_ledger_v1`, `public_visibility_quarantine_v1`, `legal_atlas.release_ledger_v1` | ~830 MB | Rollback ledgers named by rollback contracts. |
| `legal_atlas.staging` | 3.9 GB | Immutable source records; `legal_atlas.records.input_key` references it. |
| `caselaw.text_v2_t*` `tsv` GIN indexes (unused per advisor, ~2.4 GB) | | Back the tiered full-text opinion search in `caselaw-v2.sql`; low use is not no use. |
| `corpus_ingest.publisher_code_*_v1` | ~16 MB | Read by the v1/v2 intake and progress contracts and their tests. |
| `corpus_ingest.cleanup_*` | 2.1 GB | The removal ledger itself. |

## company_ir_kpis: two error pages removed (2026-10-28, 13:00 UTC)

The first live runs of `company_ir_kpis` stored two Baxter URLs whose site answered with its "page not found" page
(Firecrawl returns HTTP 200 and puts the site's 404 in `metadata.statusCode`). Removed; no figures had been read from
them. The adapter now refuses any page whose site status is 400 or above (`src/lib/ingest/sources/companyIr.ts`).

| id | source_url |
|---|---|
| ir:0000010456:2457c65f4c6fd9c2 | https://www.baxter.com/sites/default/files/2026-01/Baxter_Q3_2025_Earnings_Release_Schedules_FINAL.pdf |
| ir:0000010456:f635d6f545165f5e | https://www.baxter.com/sites/default/files/2026-03/q4_2025_earnings_release_financial_schedules.pdf |

Reversible: the next scheduled visit of Baxter re-reads both URLs and stores them if the site serves them.
corpus_datasets counts restated from the table (2 rows).
