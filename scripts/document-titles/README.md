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

Withheld by policy: first-page text or title mentioning sealed, restricted, in camera, ex parte or redacted material gets `policy_withheld` and shows no title. `file_name` is the decoded last path segment of the recorded source URL; there is no document date in these records (the manifest holds download timestamps only), so the date stays "Not recorded".

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

Verification: `python3 -m unittest discover -s scripts/document-titles -p 'test_*.py'`; `PGLITE_DIR=/tmp/pgt node scripts/document-titles/test-contract-ocr.mjs` (v1 run, v2 over it, OCR plan with rejects, apply, verify, rollback restores the exact post-v1 state).
