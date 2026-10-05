# Connected deployment checkpoint — October 5, 2026

The authenticated in-app browser now works for the existing Supabase project `xosqzzsnhxcyehcnirpa` and Lovable project `0eaa0e9a-7dcd-41f1-a5ef-3a5305288c1c`. Dedicated connector bindings were still absent from this chat's tool catalog. The working browser connection removes the earlier SQL-administration blocker; another sign-in is not needed. Lovable visibly lists GitHub commit message “Verify resumed code bytes and preserve exact source recovery evidence” (local commit `04b0071`). This is synchronization evidence, not publication.

## Private Texas import

Live dependency definitions matched the reviewed local importer. The read-only structural check found no existing publisher tables or RPCs, and the original bucket remained private. One guarded additive transaction installed four private RLS tables and four service-role-only RPCs. It verified empty function search paths, denied anonymous/authenticated access and direct service-role table mutations, and refreshed the API schema. No public corpus rows, calculator rules or held collections changed.

The database reports successful deployment at `2026-10-05T18:24:07.065956+00:00`. The subsequent direct Data API probe exposed all four RPCs. Local receipt clocks differ from the database clock; retain the original timestamps rather than rewriting them into an assumed common order.

Actual private run `f0fc7010-2a8e-4cd2-a72e-c681934b7699` was opened and read back with exact Texas scope and packet hash `87b76b96ba6ce3130167193a474f992307c0856cc9a162f2848aeb8ed711a5da`. The first bounded real pass uploaded and read back 100 objects with exact whole-object hashes, then exited normally at its object cap. The second pass added **393 verified objects** and stopped on asset SHA-256 `75a678b0b74ee38839bde6c15b20efb03481995dc614064fb5dcaee6fe13d108` (88,165 bytes) after an unknown upload transport outcome and HTTP 400 follow-up readback. A later single authenticated read-only GET of that exact key returned HTTP 400 with parsed `NoSuchKey`, establishing that object was absent from readable storage at that check. Its preserved 88-byte response body SHA-256 is `9d2505709301f205e4135106c7c92c66a58d85a1009b5b823475c6a047de1a9c`; the receipt is under `live-intake-1824/failure-readback-1838/`.

A third bounded pass (500-object / one-batch cap) added **111 verified objects**, bringing the durable journal to **604 unique whole-object receipts**, and wrote no packet or record batches. It stopped on asset SHA-256 `ac28cbf30ef938328edeb67c90acb1a141acb2bff137ed8fbedf02a63f46b21a` (75,934 bytes): the initial HTTP 400 readback was treated as missing by the runner, the upload had an unknown transport outcome, and the follow-up HTTP 400 led to `PUBLISHER_OBJECT_MISSING_AFTER_UPLOAD`. That response body was not retained; the missing-object interpretation follows the runner's branch that accepts HTTP 400 only when its body identifies `NoSuchKey`. This second failed asset has no verified receipt or separate read-only confirmation. The run remains open/running. The durable `journal.jsonl` is authoritative across these attempts (current SHA-256 `0dba4492b36ed59e9c40f1fb4e4edf2383191c2373ddd0c7316ddba1e9755b49`); the only `result-*.json` still records the initial 100-object cap because subsequent failure paths did not write result summaries. The runner process exited and released its lock. This remains an incomplete private intake, not publication.

Private evidence: `private/audit-2026-10-05/publisher-browser-preflight-1816/`, including `full-export.json`, `structural-export.json`, the exact `deploy-publisher-contracts.sql`, `deployment-result.json`, `deployed-api-probe.json` and `open-texas-run-result.json`. The deployment SQL SHA-256 is `b75309cd2046a59f500b0edac8c35151d499a93f875f6298d431cdcedadcf908`. Actual object receipts are under `full-state-codes/tx/live-intake-1824/`.

The current Unicode-aware SQL contract also completed a separate isolated simulation of all 254 batches, 126,895 records and 5,023 simulated asset receipts. Its exact contract SHA-256 is `599f411c775eaecf27141544974d6766c806857c055fcf591a1dc9194bd11150`; the report SHA-256 is `ed795c219247336962d645c1c09700e657d01f94a9c79b0eb035f39b1cd0371c`. The older full runner simulation remains revision-specific evidence and cannot validate later changes or real cloud bytes.

## State-law release preflight

Fresh live preflight found exactly 118 public and private rule records. All 118 private payload hashes matched the preserved release `.1` before-image, and all public rule payloads equaled their private source rows. There were no missing, changed, quarantined or unexpected IDs. Neither proposed `.2` nor `.3` run existed. Open US Law remained held.

The first SELECT-only readiness query had a VALUES-CTE syntax error and made no mutation. Its corrected v2 preserves all 118 pins and passed an isolated syntax/execution check before returning the live result. Both queries and the successful `live-preflight-v2.json` remain under `state-law-next/release-readiness-20261005/`. Corrected query SHA-256: `ebca614951c743d3a0982245f3292cfad988f4ced67999fb5a375220be5c1c68`.

Fresh full-object readbacks verified all 14 changed `.2` protected bundles and all ten `.3` bundle/raw objects against the pinned manifests and intake sources: 24 distinct objects, 1,352,125 bytes, zero mismatches. Receipt SHA-256: `f45063cabf925f2ed30b8c6dc2b561a62c7be5ac46de9fbbc53c46013feda8f6`. Storage verification alone does not activate either release.

## Committed calculator releases

An additional fresh readback verified all ten `.2` raw statute objects (297,599 bytes) and every changed source row's raw-file/intake/receipt association. Receipt SHA-256: `207902506dca63398f49a037a3ae40da3d1867e5fd1ce412c27e8b5a3f293108`.

The original frozen `.2` transaction failed because its generated listing-filter statement referenced validation CTEs outside their scope. The entire transaction rolled back; a new independent read verified the exact original 118 rules and absent release runs. The defect was CRLF-sensitive extraction of the filter block. `apply-reviewed-coverage-v2.sql` (198,724 bytes, SHA-256 `61dd0dec4fd4f6f28bb455b48fc925a711c19a35280929129040377805ead4de`) replaces only that statement. An independent comparison confirmed all other imports, relationships, guards and projection checks were unchanged. Both failed SQL and error evidence remain preserved; never replay the superseded file.

The complete corrected `.2` transaction passed an actual database test ending in explicit ROLLBACK, then was committed. Run `2ff88e16-2fdd-4672-bbf3-d65795542271` is completed with 29 ingested entities, 12 changed/new rules, 124 projected rules, 91 statutory sources and 44 baseline jurisdictions. An independent SELECT-only projection query and direct REST comparison of every rule payload and citation link passed.

The unchanged frozen `.3` v2 transaction also passed a full rollback test before commit. Run `0547dd04-0941-43e1-aed7-811d3d42c5b4` is completed with five ingested entities, one changed NC rule, 124 projected rules, 92 statutory sources, 14 judicial references, 86 conditional baselines across 45 jurisdictions and 38 research-only rules. Independent SQL validation reports zero field, native citation, source-version, stored-version, text-storage, raw-capture, opinion-schema or judicial-text-hash mismatches. Direct REST comparison confirmed all 124 expected rule payloads and citation links. Open US Law remains held.

The app manifest has been advanced locally to `.3`, exact SHA-256 `b3bb3c19dc4f5b73dea1d256ef7b510b909651006d0afea7f6a66e868d4b1834`, only after those proofs. The 47 focused limitations tests, 18 candidate boundary cases, TypeScript and production build passed. Lovable publication and actual public-site interaction checks are still pending at this checkpoint. This coverage remains conditional statutory arithmetic, not complete full-code coverage or case-specific filing advice.

Evidence: `state-law-restoration/live-commit-result-v2.json`, `live-independent-projection-v2.json`, and corresponding files in `state-law-next/release-3/`; independent REST evidence under `live-law-release-2-2026-10-05T183502953Z/` and `live-law-release-3-2026-10-05T183659644Z/`. Runtime rollback receipts are explicitly labelled and never substitute for the later commit evidence.

## Verified public release

Commit `35f14ab` appeared in the connected Lovable editor as “Activate verified state-law coverage across 45 jurisdictions.” The existing publication control then reported “Your website was updated.” On `firastest1.com`, fresh whole-response hashes for rules, sources, coverage, case references and the NC 1-52 text all match the `.3` manifest exactly. Production readback receipt SHA-256: `31daf4143671a99d623d8db9725503c4128ebfb6da2ffce72f69f57a2d00e023` under `state-law-next/production-readback-2026-10-05T1845Z/`.

Live browser checks confirmed:

- NC ordinary injury, sample accrual May 1, 2025 and last act May 1, 2016: conditional May 1, 2026 anniversary, showing both statutory clocks and the source/case links. Missing repose confirmation prevented advancement.
- KY July 14, 2026 trigger: no date, with historical-version explanation. July 15, 2026 trigger: conditional July 15, 2027 anniversary.
- LA July 1, 2024 trigger: no date, preserving the unresolved transition-day boundary.
- State-law navigation: exactly 51 distinct jurisdiction links, one per state and DC. NC expands to five saved statute extracts with official citations and capture dates.

Screenshots are preserved as `lovable-published-1842.png`, `live-nc-two-clock-result.png`, `live-ky-before-effective.png` and `live-la-transition.png` in `state-law-next/release-3/`. A subsequent copy-only patch corrects “1 calendar years” and removes internal publication/hold explanations from ordinary law navigation; its deployment is tracked separately. Full state-code integration, six general-baseline jurisdictions (AR, GA, MS, NJ, OR, TN), special-claim coverage, and the recorded docket gaps remain open.
