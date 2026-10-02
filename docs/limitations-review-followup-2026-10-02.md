# U.S. limitations authority follow-up — October 2, 2026

This follow-up uses schema 1.0.0 and adds rule version 2026-10-02.2. Existing rules retain their original versions. It supplements the [first release receipt](limitations-review-2026-10-02.md); it does not retrospectively change that receipt.

The bundle now contains 79 statutory/federal source captures covering 46 state/DC jurisdictions and four federal provisions; 13 selected court-opinion HTML copies; and 118 rules. There are 73 conditional calendar baselines across 37 jurisdictions and 45 research-only records. All 50 states and DC remain in the coverage inventory. No jurisdiction has a comprehensive operative-law, historical-version, precedent, exception or case-specific review.

## Recovered primary text

| State | Actual acquired authority | Supported new conditional baseline | Limits |
| --- | --- | --- | --- |
| North Dakota | Official documented Century Code JSON: Chapters 28-01, 28-01.3 and 32-21 | Ordinary personal injury: six years under § 28-01-16(5); ordinary wrongful death: two years from death under § 28-01-18(4) | Products/asbestos dates withheld; malpractice death excluded; § 28-01-38 commencement ordinarily depends on summons service, not complaint filing alone |
| New Mexico | Official NMOneSource rendered HTML: Chapter 37 first fragment, §§ 37-1-1–37-1-29; Chapter 41 first fragment, including Article 2 and ending after § 41-4-2 | Ordinary personal injury: three years under § 37-1-8 after confirmed accrual; ordinary wrongful death: three years from death under § 41-2-2 | Later fragments, government claims, product/latent discovery and historical applicability remain unreviewed |
| Oklahoma | Public Official Oklahoma Statutes (Unannotated), maintained by Thomson Reuters: title 12 §§ 95, 96 and 1053 | Ordinary noncontractual injury: two years under § 95(A)(3) after confirmed accrual | Product classification/discovery withheld; § 1053 states a two-year death period without itself establishing the captured accrual trigger, so no automatic wrongful-death date |

North Dakota's publisher reports an update of `2026-09-15T11:11:14` without a timezone; that is preserved without inventing a UTC offset. The documented official API's entire response was held in memory, with a response SHA-256 recorded. Only the three selected chapter JSON records are retained. Text hashes cover deterministic headings and exact section-text strings, not the full API response bytes.

Oklahoma's public publisher reports currentness through the Second Regular Session of the 60th Legislature (2026). This is a publication notice, not proof of historical applicability. The earlier OSCN human-verification barrier was not retried. New Mexico captures are explicitly partial rendered fragments, not entire chapters. Public robots directives and the scope of the ordinary HTML reads are recorded in capture provenance.

## Material classification and validity guards

1. The current North Dakota JSON still prints the ten-year purchase / eleven-year manufacture product-repose text in § 28-01.3-08. **Dickie v. Farmers Union Oil Co., 2000 ND 111, 611 N.W.2d 168 (May 25, 2000), ¶¶ 1, 4–9, 12–13**, identifies the constitutional classification defect. The identified Justia reproduction of the court opinion is retained with an opinion-body hash and a separate complete extraction record. Publisher AI disclaimer, subscription and CAPTCHA footer text is excluded from the court-opinion body. No automatic repose cutoff or asbestos period is emitted; subsequent treatment and asbestos-subparagraph severability remain unreviewed.
2. North Dakota § 28-01-47 concerns public-building asbestos removal/abatement property costs and a fixed August 1, 1997 cutoff/revival provision. It is not an asbestos personal-injury limitation period. This finding is kept outside the three injury-calculator claim categories.
3. North Dakota wrongful-death claimant priority under § 32-21-03 places the personal representative fifth. The rule does not mislabel the representative as the sole permitted claimant. The existing-claim survival timing in § 28-01-26 is distinct from a new wrongful-death claim.
4. New Mexico § 37-1-8 contains both a two-year fiduciary-surety provision and a three-year injury provision. The calculator maps only the latter to ordinary injury. The express discovery language in § 37-1-7 covers fraud, mistake and property claims; it is not generalized to every personal-injury or product claim.
5. Oklahoma's fraud-discovery language in § 95(A)(3) is not generalized to personal-injury or product claims. Separate intentional-tort, sexual-injury, incarcerated-person and disability provisions remain excluded from the ordinary baseline.

## Remaining acquisition gaps

- **AR, MS, TN:** public-code navigation exposed express terms-agreement gates. No agreement was submitted; no statutory body admitted.
- **GA:** ordinary navigation to § 9-3-33 reached CAPTCHA on the first statute-document request. No CAPTCHA solved or access evaded; no statutory body admitted.
- **KY:** current official Chapter 413 index points to KRS 413.140's section endpoint. HEAD returned `200 application/PDF` on October 2. The PDF body, effective-date text and injury mapping were not acquired. A heading alone is insufficient proof of claim applicability.

Acquisition outcomes and short gate evidence are in `public/data/limitations/followup/acquisition-audit-20261002-v2.json`. Rejected/denied acquisitions are separate from admitted statute sources. The five missing jurisdictions do not acquire calculator dates merely because a third-party table supplies a duration.

## Validation and private import

All 79 statute/federal text hashes and 13 opinion-body hashes passed verification. The existing 23 engine tests passed. Independent follow-up checks exercised all five new conditional branches, each confirmation gate, unresolved repose blocking, withheld product/asbestos/death branches, unique rule selection and missing-primary-text states. Calculated future anniversaries remain permitted; future fact dates beyond the snapshot remain blocked.

The changed-only import contains 44 records: eight statutory sources, fourteen rules, eight coverage updates, one judicial reference, eight publisher routes and five rejected-acquisition audits. The 232 unchanged prior records are retained. The metadata-only run is `76552380-b324-43ec-bcfb-5bbb5565e78a` on Supabase project `xosqzzsnhxcyehcnirpa`; root owns run finalization. Normalized JSONL, checksums, count-guarded SQL and receipts live outside Git at `../private/legal-review-followup-20261002-v2/`. No PDFs were downloaded. The original oversized Indiana text remains a file locator plus hash rather than a database full-text value.

Public publication requires independent full-field reconciliation with the private cited rules, exact native source/case targets, matching source text hashes, safe ordinals and qualifications. The legacy 459-row summary dataset and held open-law release gates remain separate.

The applied follow-up receipt records 44 distinct changed entities, 44 initial new versions/observations and one corrective judicial-reference metadata observation, for 45 new versions/observations in total. The correction aligns explicit per-record schema/reference version, judicial authority kind, review status and text scope with the other opinions; Dickie's text hash is unchanged and both versions are retained. The legal source system now has 276 native entities, 293 preserved versions and 344 explicit relationships (43 new), with zero inferred or unresolved targets. All thirteen current opinions have schema parity; all seven rejected-acquisition audits remain quarantined. The 118-rule public projection is ready, with three reconciled listing filters. Independent checks found zero full-field, citation-target, source-version, stored-version or text-hash mismatches. All 91 database full-text records match their captured text hashes; the Indiana locator-only exception is unchanged.

Anonymous and authenticated roles retain no private-schema usage, entity SELECT or ingestion-function execution permission; private-table RLS remains enabled. The original 459-row limitations summary and held `open_us_law` readiness were unchanged. The shared follow-up run remains running for root's separate cleanup decision and finalization. Receipt and source-hash manifest paths are `../private/legal-review-followup-20261002-v2/receipt.json` and `source-hash-receipt.json`; the independent drilldown query is `sql/full-field-reconciliation.sql`. These artifacts contain no administrative credentials.

The additive tracked publication contract is [`project-limitations-review-v2-20261002.sql`](../database/contracts/project-limitations-review-v2-20261002.sql). It preserves the historical v1 104-rule contract, requires this exact reviewed 118-rule snapshot, and independently reconciles all rule/listing/detail fields, full citation links, source/version/text hashes, opinion schema and every listing-filter option/count. A failed check sets the dataset's readiness to false. It does not finalize the shared run. Root executed the combined guard at 2026-10-02T11:38:55Z: publication passed with 118 rows and zero reconciliation mismatches.

## Guided calculator release

The default page starts with an unselected jurisdiction and claim. It reveals only the dates required by the supported branch, with plain-language date explanations. Detailed authorities, all-state coverage, source versions and MDL context remain available in expandable on-page sections. Governing-law, accrual and applicability confirmations start unset; unresolved exceptions or missing dates withhold a result. No legal engine or date formula was changed by the interface simplification.

Five focused guidance/rendering checks and the existing 23 engine checks passed. The repository suite passed 202 tests with one existing skip; TypeScript and production build passed. Browser checks confirmed the California product branch requests both legally relevant discovery dates, withholds a date before legal confirmations, and uses the earlier confirmed discovery date for its conditional anniversary. Native keyboard date entry was used to commit browser date fields; DOM-only automation filling was not treated as evidence of React state.
