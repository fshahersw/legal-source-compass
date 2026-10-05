# October 5, 10:55 UTC docket continuation

## Verified source capture; registration pending

The bounded pass ran from 10:56:15 to 11:01:46 UTC against the 16 saved incomplete native docket cursors. The fresh opening quota was 52/day, leaving 32 requests after the 20/day reserve. Thirty-one successful pages and one retried HTTP 502 used the 32-request budget.

The pass captured **620 additional unique docket-entry IDs and 716 distinct nested RECAP document IDs**, advancing 15 dockets. Docket `8408916` remains at its prior 20 observations and is the one queued task. The other targets now have 60 observations each except `69871659`, which has 80. All 16 targets remain partial with their exact next cursors. The separately completed MDL 3114 scope remains at 85 observations. Cumulative local observations are **1,025**, of which **940** belong to the 16 continuation targets.

The independent audit validated all 52 current raw response/provenance pairs, all 31 immutable raw/observation pairs, all 1,025 native IDs and record hashes, and every normalized observation's exact source page and docket association. No duplicate entry IDs or evidence mismatches were found. The failed 502 response is not used as source evidence; its URL has a subsequently verified 200 response.

**These counts are saved source captures, not new registry imports, public records, or acquired PDFs.** Public coverage still reflects the earlier 405-observation refresh. No new ingestion run or projection has been attempted: the fixed intake RPC requires an already-open administrative run, and opening that run requires the unavailable SQL browser connection. Do not reuse a completed run or claim that a queued file was acquired.

## Pinned resume packet

Evidence is under `private/audit-2026-10-05/continuation-1055/`:

- `pre-import-audit.json`: exact native scopes, hashes, source associations and deltas.
- `bundle-scope-proof.json` and 16 `bundle-<mdl>.json` files: audited master-docket identities, excluding the mismatched secondary MDL 3014 ID.
- `import-plan.json`, `open-run.sql`: new run **`68fcc730-2104-4713-bb7e-cf323d66a119`**, prepared but not opened.
- `native-entry-ids.json`: 940 exact target IDs for the bounded public projection.
- `quota-after.json`, `checkpoint.json`: fresh post-pass quota and explicit registration/publication status.

When SQL access returns, inspect the pinned `open-run.sql`, verify its checksum against `import-plan.json`, independently confirm the run is absent, and create it in **xosqzzsnhxcyehcnirpa only**. Then run the existing importer against `recent-entries` with that run ID and `--types=docket-entries,recap-documents --max-rows=2000 --max-bytes=1500000`. Inspect every acknowledgement and held-row count. The importer includes the earlier saved observations; distinguish new versions from additional observation receipts.

Use `members-project-extras.mjs` first with `--dry-run=true`, the same run, `--only=entries`, `--native-entry-ids-file=private/audit-2026-10-05/continuation-1055/native-entry-ids.json`, and `--staging=private/audit-2026-10-05/continuation-1055`. Preserve and hash-verify changed-row before-images, check exact native IDs and retained remote-only rows, then execute the bounded projection without `--ready=true`. Reconcile global catalog/facets and actual net additions; 620 newly captured IDs do not imply 620 new public rows.

Render a new coverage transaction only after the actual import/projection receipts are known. The previous coverage SQL pins 405 observations and 63,973 public rows and **must not be replayed**. Preserve previous coverage snapshots and keep partial provider totals unknown. PDF candidate screening and downloads require explicit unsealed/unrestricted eligibility, native identity, verified byte deduplication, complete object readback and receipt registration.

## Quota and queue

At 11:15 UTC, the live API reported 20/day remaining: **zero usable daily requests after the reserve**. It reported the earliest rolling reset at 11:25:37 UTC; that is not a full quota-renewal promise. Defer acquisition cleanly and recheck actual usage on a later bounded continuation. The collector is stopped and its lock released.

This pass used `max_pages: 2` per task to distribute the small allowance. The existing task for `8408916` retains that limit. The older checkpoint's example expected `max_pages: 50`; do not overwrite or blindly regenerate its queue while the two-page task exists. Resume the retained task first after a fresh quota check, then seed remaining exact cursors with an explicitly bounded allowance. Preserve the 16 partial cursors, four blocked headers, all collection holds and the staged legal-graph hold.

## Calculator and UI

The prepared calculator release remains `2026-10-05.2`: 124 rules, 85 conditional baselines in 44 jurisdictions, 39 research-only rules, 91 statutory captures covering 47 jurisdictions, and 13 judicial references. The active manifest remains `.1` until the guarded SQL transaction passes. See `state-law-release-checkpoint-2026-10-05.md` for the exact transaction checksum and publication sequence.

The user reconnected the browser, but Chrome commands still time out. The in-app browser works and has no Supabase login. The user has been asked to restart the extension connection; no new permissions or credentials were requested. Lovable publication remains unverified.

Local UI verification confirmed one state choice each for all 50 states and DC, working source links, and a captured-statute API response with exact whole-body manifest hash. The 390px viewport has no horizontal overflow. The in-app browser emitted no download event, so a browser-save result is not claimed. The state cards now show only state names, and the inaccurate claim that full state codes were not stored has been removed. Private screenshots and `local-ui-verification.json` retain the evidence. Local checks do not establish production publication.

The owner's completed financial-disclosure and URL-directory removals remain unchanged. Do not recreate those collections or acquire their missing bulk exports.
