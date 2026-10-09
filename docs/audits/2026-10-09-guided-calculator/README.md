# Guided calculator and source-bound minority policies

This change replaces the calculator's long single form with Case facts → Exceptions → Assessment. It keeps the existing source and coverage views, existing statutory baselines and historical variants, and the original corpus boundaries.

## Scope of the implemented review

The UI reviews 17 exception topic families in five small groups. Every recorded condition, exclusion, warning, flag, tolling note and repose note is retained in a searchable inventory and in an exported assessment. No note is discarded merely because it does not match a topic; unmatched text is retained as Other. Notes appearing in conditions (including New York cross-checks) are not overlooked.

A positive or uncertain unmodelled issue withholds the date. Missing answers are not negatives. An explicit group-level action can mark only the currently shown unanswered questions No; it never overwrites an existing Yes. Changing a date, selected statutory variant or release invalidates the applicable confirmations. The assessment export includes the input, rule-release identity, all answers, every stored qualification and sources, and the actual computation trace.

This is NOT a complete survey of all law and NOT a universally verified filing-deadline engine. Holidays, local closure orders, commencement/service cutoffs, unmodelled tolling and complex interactions remain review items rather than hidden arithmetic assumptions.

## Newly executable minority path

Three narrowly scoped, evidence-backed policies are prepared for ordinary private-party personal-injury claims: California, Illinois and New York. They do not activate from frontend hardcoded durations; the policy is carried in the versioned private rules bundle. Each policy binds the exact parent rule, jurisdiction, claim, subtype, source IDs and SHA-256 fingerprints. The offline release builder verifies literal excerpts and operative predicates in those source bytes before attaching any policy.

The claimant must have been a minor at accrual and must since have attained majority. The legally established majority date is supplied and explicitly confirmed; the code does not infer age-attainment law or a leap-day convention from a date of birth. The claimant must be living and have no other relevant disability. Government claims, malpractice, childhood sexual abuse, special statutory claims, products/latent injury, penalties, sheriff-escape actions, derivative claims and independent repose are excluded from this policy.

California and Illinois permit only accrual on/after the conservative reviewed window 2015-01-01; New York on/after 2019-02-15. Earlier periods are not inferred from the current enactments. Dates later than the relevant retained evidence review are withheld. No unsupported tolling is stacked, and no existing later period is shortened.

Authorities retained and excerpt-bound: California CCP §§352(a)-(b),357–358 with the parent's §335.1 baseline; 735 ILCS5/13-211(a) with the parent's13-202 baseline; New York CPLR208(a) with the parent's214(5) baseline. This bounded statutory implementation is not a comprehensive claim-specific case-law opinion.

## Release procedure

1. Read the complete current private limitations manifest and acquire every referenced file with exact hash and length verification. The tested input is release2026-10-08.8, 1,317 files.
2. Run `bun scripts/legal/prepare-guided-limitations-release.ts --bundle=PATH --out=FRESH_PATH --release=2026-10-09.1 --reviewed=2026-10-09`. This produces a candidate, not a live manifest change. It preserves all1,317 original files, changes only the rules file, and adds a policy-addition ledger.
3. Test the candidate with `LIM_BUNDLE_DIR=FRESH_PATH bun run test src/lib/limitations src/components/limitations`; run TypeScript, changed-file lint and production build.
4. Use the EXISTING stage-limitations-release.mjs, hash readback, then activate-limitations-release.mjs --verify. Preserve all existing raw capture objects and verify their existing references; no new raw capture is invented. The frontend code must be applied before the new policy-bearing release is published.

## Recorded tests

Candidate bundle: 976 tests passed across25 files, TypeScript and lint passed, production build passed. Browser interactions: ordinary calculation, unsupported bankruptcy withholding, source-bound CA/IL/NY minority calculations, resetting stale confirmations, complete JSON export, and390px mobile layout without horizontal overflow passed; no uncaught page errors. Browser tests used the real retained bundle plus the exact candidate policy construction, not invented laws. Screenshots and runtime logs remain in the working checkpoint; the included browser-checks.json is the concise result.

The whole project is not claimed legally complete. State-code ingestion is a separate running workstream; this patch does not flip any corpus publication flag.
