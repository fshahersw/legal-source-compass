# Document titles (court_documents, saved_pages, uscourts_pages)

Replaces placeholder titles with a title read from the document's own text, and otherwise labels the row `<file name> (title not recorded)`. No title is ever composed from words that are not on the page. No credentials live in this directory; tools read `EXTERNAL_SUPABASE_URL` and `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` from the environment.

Scope (exactly these placeholders): `court_documents` titles ending ` (title not yet extracted)`, `saved_pages` and `uscourts_pages` titles `(untitled)` / `Untitled`.

## Pipeline

| Step | Tool | Reads | Writes |
|---|---|---|---|
| 1 | `fetch-inputs.py` | PostgREST: records + `corpus_artifacts` rows | local JSON(L) snapshot |
| 2 | `extract-first-pages.py` | private `corpus-originals` objects (SHA-256 verified against `corpus_artifacts`) | local first-page layout lines + PDF metadata; no bytes kept |
| 3 | `build_plan.py` (uses `derive_titles.py`) | snapshots only | `plan.jsonl`, `document-map.csv`, `stats.json`, `samples.json` |
| 4 | `database/contracts/document-titles-v1.sql` | installed once by the admin role | `corpus_ingest.title_projection_plan`, `public.corpus_admin_title_projection_v1` |
| 5 | `push-plan.py` | `plan.jsonl` | through the RPC: `plan` (md5 captured), dry `apply`, `apply`, `verify`; dry unless `--execute` |

## Derivation rules (`derive_titles.py`)

Priority, recorded per row as `method`:

1. Linked docket-entry description: none of these records carries a docket link (`corpus_workspace_docket_links` has 0 rows from `court_documents`; they are court-website files), so this method yields 0 rows. It is not guessed.
2. `first_page_title_block`: the one typographically distinct (largest/bold) block at the top of page 1, at most 4 lines, wording kept, whitespace collapsed. Rejected when several equally prominent blocks exist, when the block is only a court name/caption, when it does not start near the top, when it contains no document-type word (table, order, notice, report, rules, form ...), when it looks like body text, a letterhead/stamp, OCR noise, non-Latin watermark text, or an opinion headnote.
3. `first_page_doctype_heading`: exactly one standalone document-type heading in the first 18 lines (`ORDER`, `GENERAL ORDER NO. 22-01`, `MOTION TO ...`); one-word types gain the court caption printed directly above them and are rejected without one.
4. `first_h1_markdown` (saved/uscourts pages): the first level-1 heading of the stored text, only when it is also the page's first heading and passes the same gates plus a letterhead/caption check.
5. Otherwise `not_recorded` with a reason code (stored in the plan, in the ledger evidence and in the row's "Title basis" fact).

No keyword withholding (owner decision 2026-10-27): a title is no longer hidden because the page mentions sealed, restricted, in camera, ex parte or redacted material. These records are files the courts publish on their own websites; a title is held back only on explicit evidence from its source (a court- or provider-reported seal or restriction). `file_name` is the decoded last path segment of the recorded source URL; there is no document date in these records (the manifest holds download timestamps only), so the date stays "Not recorded".

## Verification

```
python3 -m unittest discover -s scripts/document-titles -p 'test_*.py'
npm i --prefix /tmp/pgt @electric-sql/pglite && PGLITE_DIR=/tmp/pgt node scripts/document-titles/test-contract.mjs
```

`test-contract.mjs` runs the contract on a throwaway in-memory database with synthetic rows: plan, dry run (writes nothing), apply, idempotent re-apply, md5 guard (a row edited after planning is skipped), verify, exact rollback (whole-table md5 equals the pre-apply md5), and rollback holding a hand-edited row.

## OCR stage (owner-authorised 2026-10-07)

Rows whose saved PDF has no text layer on page 1 (1,192, applied as `<file name> (title not recorded)`, reason `no_text_layer`; the PDF-text pipeline holds no text for any of them) are read by OCR, with the same rules:

| Step | Tool |
|---|---|
| OCR top 60% of page 1 at 200 dpi (RapidOCR ONNX, local; `pip install rapidocr-onnxruntime pymupdf`) | `ocr-first-pages.py` |
| Derive: box heights quantised to body/emphasised, text-layer rules, plus OCR gates (line confidence >= 0.93, no run-together words, no letter/digit confusions, no stray symbols) | `derive_titles.title_from_ocr_first_page`, `build_ocr_plan.py` |
| Contract `database/contracts/document-titles-v2-ocr.sql` (methods `first_page_ocr_title_block`, `first_page_ocr_doctype_heading`; eligibility only for rows still `(title not recorded)` with an applied `no_text_layer` v1 plan row; separate ledger issue `doc_titles_20261007_ocr_title`; unresolved rows planned as `not_recorded` with reason `ocr_*` so their Title basis no longer says no OCR was applied) | `push-plan.py` unchanged |

Production note (2026-10-27): only the v1 contract is installed; v2-ocr was never applied. `document-titles-v3-keyword-release.sql` keeps the OCR stage unchanged, so install v3 (not v2) if the OCR stage is run later.

## Keyword release (owner decision 2026-10-27)

Run dc2371a4 labelled 64 court_documents `<file name> (title not recorded)` with reason `policy_withheld` only because their first page mentions sealing-related words. None carries a court- or provider-reported seal. They are re-derived with the same rules minus the keyword rule:

| Step | Tool |
|---|---|
| Snapshot the 64 rows + `corpus_artifacts`, read page 1 (SHA-256 verified) | `fetch-inputs.py`-style PostgREST GETs, `extract-first-pages.py` |
| Derive and plan (`plan.jsonl`, `document-map.csv`, `stats.json`) | `build_keyword_release_plan.py` |
| Contract `database/contracts/document-titles-v3-keyword-release.sql` (stage `keyword_release`, taken from the run; eligible only while the row still carries the v1 `policy_withheld` label; ledger issue `doc_titles_20261027_keyword_release`; rollback/verify/status take `{"run": ...}`) | `push-plan.py --stage keyword_release`, `--run` |
| Function rollback after the data rollback | `database/contracts/document-titles-v3-keyword-release.rollback.sql` |

Rows that still give no title keep their label and only get their Title basis corrected. A reviewed accuracy hold (`REVIEWED_NOT_TITLES`, keyed by record id and the exact derived text) keeps a derived string that is not the document's title out (reason `heading_is_instructions_label`).

Verification: `python3 -m unittest discover -s scripts/document-titles -p 'test_*.py'`; `PGLITE_DIR=/tmp/pgt node scripts/document-titles/test-contract-keyword.mjs`; `OCR_CONTRACT=document-titles-v3-keyword-release.sql PGLITE_DIR=/tmp/pgt node scripts/document-titles/test-contract-ocr.mjs`.

OCR verification: `python3 -m unittest discover -s scripts/document-titles -p 'test_*.py'`; `PGLITE_DIR=/tmp/pgt node scripts/document-titles/test-contract-ocr.mjs` (v1 run, v2 over it, OCR plan with rejects, apply, verify, rollback restores the exact post-v1 state).
