# Time limits validation — October 12, 2026

The complete downloaded protected Time Limits snapshot passed the limitations test suites and existing source-text checksum verifier. This validates the recorded implementation and retained evidence; it does not establish comprehensive legal coverage or revalidate the law against today's publishers.

## Scope and checks

- Snapshot date: **2026-10-08**; rule release: **2026-10-08.8**.
- `node node_modules/vitest/vitest.mjs run --config vitest.private.config.ts src/lib/limitations src/components/limitations`: **821 tests / 9 files passed**, using the complete private fixture set. The private configuration fails when required evidence files are absent.
- `node node_modules/vitest/vitest.mjs run src/lib/limitations src/components/limitations`: initially **266 tests / 28 files passed**; subsequent source-kind, extraction and navigation regressions increased the suite (see candidate checks below). Python extraction tests ran with the bundled Python interpreter and the pinned `scripts/test/requirements.txt` dependencies in an isolated local test dependency directory.
- The initial disjoint configurations covered **1,087 limitations tests / 37 files**. Later tests are additive, not a repeated count of the private tests.
- `node scripts/limitations/verify.mjs`: **passed**, without `--update`. It checked retained text byte lengths and SHA-256 values for **1,028 sources** and **11 judicial references**, plus declared raw-capture metadata. It reported 51 source jurisdictions, four federal statutes, 281 declared official PDF captures and ten declared judicial PDF captures. It does **not** independently retrieve or verify raw PDF binaries; separate raw-byte receipt verification is required for that claim.
- TypeScript and changed calculator file lint checks passed. This initial pass did not change the downloaded release. A separate, qualified research candidate was subsequently built as described below; no existing rule or source record was changed.

Existing substantive edge coverage includes leap-day and month-end arithmetic, independent repose caps, actual and constructive discovery, competing clocks, historical applicability, unsupported weekend/holiday adjustments, stale or lost authority, source-change invalidation, and suspension intervals that cannot revive an already-expired claim. A seeded property suite compares 1,000 suspension scenarios with an independent day-by-day oracle. No engine defect was found during this pass; no extra legal behavior was inferred to increase a coverage count.

New intake tests cover conflicting states and claims, multiple/ambiguous dates, negation and uncertainty, invalid dates, explicit date roles, exceptions requiring manual review, confirmation before applying facts, and text that asks the parser to invent a result. New UI state tests distinguish initial case selection from an actual evidence refresh, preserving authority-removal invalidation.

## Recorded coverage and remaining gaps

All counts below are derived from the downloaded JSON, not from a previous audit. [coverage.json](coverage.json) preserves the counts and missing-cell reasons exactly as recorded in that snapshot.

| Measure                                                        | Recorded value |
| -------------------------------------------------------------- | -------------: |
| Rules, including historical and narrow variants                |            888 |
| Jurisdictions with at least one rule                           |             51 |
| General state/claim cells                                      |            612 |
| Baseline cells                                                 |            539 |
| Flagged cells                                                  |             58 |
| Research-only cells                                            |              1 |
| Cells with no general rule recorded                            |             14 |
| Rules graded `official_capture_verified`                       |            792 |
| Rules graded `lower_evidence_grade`                            |             96 |
| Rule currency: confirmed / partially confirmed / not rechecked |  709 / 175 / 4 |
| Source currency: evidence intact / unchanged / not rechecked   | 573 / 442 / 13 |

The 14 missing general cells are:

- **Arkansas:** defamation, intentional tort, breach of warranty, legal malpractice.
- **Georgia:** intentional tort, breach of warranty, legal malpractice.
- **Mississippi:** defamation, intentional tort, breach of warranty, legal malpractice.
- **Tennessee:** defamation, intentional tort, breach of warranty.

Tennessee has narrow flagged libel and false-imprisonment variants; those do not fill the missing general claim cells. The stored explanations identify missing current official captures, publisher-gated compilations, and rejected inference from general provisions or unenacted/archived bills. These are explanations of the released bundle's limitations, not findings that the relevant law does not exist.

Counting rules are not recorded for **Georgia and New Jersey**. They are flagged for **Alabama, Arizona, Connecticut, District of Columbia, Florida, Idaho, Louisiana, Montana, New Hampshire, New York, Rhode Island, South Carolina, South Dakota, Tennessee, Vermont, Washington, Wisconsin and Wyoming**. The engine must not silently extend weekends using these missing or flagged rules.

The source currency routes are 544 direct, 260 official-code captures, 211 proxied and 13 with no successful route. `confirmed_evidence_intact` means the retained passage is supported by the recorded comparison; it does not mean the entire statute is currently unchanged. Rule grades and currency are snapshot metadata and can contain qualifications in their recorded basis.

Fifty-one represented jurisdictions therefore does not mean complete rule coverage, complete exception review, complete historical coverage, or a verified last filing date. Court holidays, local filing cutoffs, service/commencement requirements and unresolved applicability still require the specific evidence and review identified by the calculator.

## Qualified research candidate: 2026-10-12.1

The candidate contains **889 rules, 1,030 sources and 748 calculable baseline rules**. Every one of the prior 888 rule records and 1,028 source records compares unchanged as a JSON object. It adds one flagged Mississippi defamation research rule and two judicial source records; New Jersey's counting row is now flagged. It creates **no new calculable baseline or automatic weekend extension**.

- **Mississippi defamation:** the Supreme Court majority in [Dollar General Corp. v. Dobbs, No. 2023-IA-00617-SCT (March 13, 2025)](https://courts.ms.gov/appellatecourts/Opinions/CO182835.pdf), paragraph 10, quotes the one-year libel/slander provision in Miss. Code Ann. § 15-1-35 (Rev. 2019). The current compilation, subsequent developments and case-specific accrual/exception questions remain unverified. The entry is `flagged`, `research_only` and `research_text_verified`, and produces no date even with all calculator confirmations supplied. It is not treated as a general intentional-tort period.
- **New Jersey counting:** [Barron v. Gersten, No. A-0912-20 (June 13, 2022)](https://www.njcourts.gov/system/files/court-opinions/2022/a0912-20.pdf), pages 6–7, applies Rule 1:3-1 in the specific context of COVID-era orders. Its last-day treatment is distinguished from adding intervening holidays or reviving an expired period. The current Rule 1:3-1 link redirected to a September 2026 rules index with no matching result, so the candidate retains this historical judicial evidence as `flagged`; the engine's automatic weekend extension remains disabled.

Direct MS retrieval closed the connection; NJ returned HTTP 403. Both official-host opinions were retrieved through Firecrawl. The retained raw files are **exact proxy JSON response bytes (`application/json`), not downloaded official PDFs**. The source method, fetch route, confidence notes and flags all disclose this distinction. Their extracted text and raw SHA-256 values are retained in [candidate.json](candidate.json). Local verification compared both raw files against capture metadata and source records, and both text files against capture metadata, source records, built files and the quoted passages.

The candidate has **539 baseline, 59 flagged, one research-only and 13 unrecorded general cells**. Counting coverage is 31 verified, 19 flagged and one unrecorded (Georgia). The 13 missing general cells are the original list above minus Mississippi defamation. The increase in recorded research is not an increase in calculable coverage. Source currency is 575 evidence-intact, 442 unchanged and 13 not rechecked; routes are 544 direct, 260 official-code captures, 213 proxy and 13 none. These totals are calculated from final candidate JSON; the older builder's intermediate currency summary runs before new counting sources are inserted.

Other examined material did not justify new rows: a 2009 Mississippi warranty opinion involves a mixed services/software contract and does not establish a currently applicable general warranty rule; a Tennessee opinion route returned a browser-validation page rather than an opinion; Georgia's former appellate rules do not establish general civil limitation counting; Arkansas's captured unenacted bill is still not current law. No missing cell was filled by analogy or by a guessed period.

Candidate validation:

- `npx bun scripts/limitations/backfill/verify-entries.ts MS NJ` with `LIM_WORK=private/limitations-gap-research-2026-10-12`: one flagged entry and one flagged counting rule, zero errors or warnings.
- `node scripts/limitations/verify.mjs --root=private/limitations-gap-research-2026-10-12/candidate-bundle`: passed all 1,030 source text checksums and declared raw metadata, without `--update`.
- `LIM_BUNDLE_DIR=private/limitations-gap-research-2026-10-12/candidate-bundle` private limitations suite: **821 tests / 9 files passed** after the final source metadata changes.
- Final portable limitations suite: **277 tests / 30 files passed**, including source-kind, extraction and research-navigation regressions. Together the disjoint suites passed **1,098 tests / 39 files**. TypeScript, changed calculator/domain lint and `git diff --check` passed.
- The local `verify-candidate.ts` in that research workspace passed exact old-record comparisons, both new raw/text hash checks, literal excerpt checks, Mississippi date withholding and New Jersey flagged-weekend withholding. [candidate.json](candidate.json) records those results and exact missing-cell reasons.
- Stage execution: **two raw objects / 56,356 bytes; 1,319 release files / 1,257 distinct content objects**. Both raw objects and seven release objects were newly uploaded; 1,250 release objects already existed. Every object passed byte-length and SHA-256 readback. The capture index and staged manifest were also uploaded and verified.

The private candidate is at `private/limitations-gap-research-2026-10-12/candidate-bundle`. Only `private/limitations-gap-research-2026-10-12/release-captures` is the selected raw-capture input; the wider research directory retains failed and alternative retrieval attempts. Use release `2026-10-12.1` with the existing `stage-limitations-release.mjs`, then the existing activation script with `--verify` after reviewing its receipt. Deploy the accompanying `judicial_opinion` and `research_text_verified` validation support with the manifest. The activation script preserves unrelated manifest entries, including court resources.

The coordinator completed `activate-limitations-release.mjs --verify` against staged manifest SHA-256 `b4c970fef9da4a84253d68e7453bd0adde2f5f9d43711af731d909106acb3d07`. All 1,319 limitations entries match the staged manifest; no other entry changed, and the court-resource bundle remains intact. The prior manifest, raw/release receipts, capture index and activation proof are retained in the ignored research workspace's `staging/` directory. This updates the **local release manifest only; the production website has not been deployed**.

Code guards now reject conflicting source classifications for repeated or seeded captures, preserve judicial authority types, and prevent a non-statutory entry from becoming a baseline merely because its passage is marked verified. Markdown extraction preserves multi-line opinion emphasis, table text and common inline formatting without altering retained raw bytes. Calculator research navigation keeps the intake case mounted while sources and coverage are inspected; choosing a different case still starts a new calculator review.
