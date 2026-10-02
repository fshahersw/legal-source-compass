# US limitations corpus review — 2026-10-02

Version: schema 1.0.0; rule/reference 2026-10-02.1.

This release adds a full-page cited analysis tool at /limitations. It computes an unadjusted calendar anniversary only after the user confirms governing law, legally established trigger facts, historical statutory applicability, branch conditions and resolved exceptions. It does not certify a filing deadline, operative law, timeliness, tolling or service. Exposure/diagnosis dates are not automatically substituted for accrual.

## Evidence and coverage

- 51-jurisdiction inventory (50 states and DC), each with an official legislature/legal-publisher publication route.
- 71 statutory source snapshots covering 43 jurisdictions and four federal statutes.
- 104 claim/rule records: 68 conditional calendar baselines across 34 jurisdictions; 36 records requiring further legal review.
- 12 selected primary judicial opinion references. These are identified HTML reproductions of court opinions; official PDF URLs, where available, are metadata only.
- Zero PDF binaries downloaded or stored by this review. HTML/XML extracted statute text and HTML opinion text are retained with SHA-256 checksums.
- No jurisdiction is represented as having a comprehensive operative-law, historical-version, controlling-precedent or exception review.

The eight uncaptured statutory-text jurisdictions are AR, GA, KY, MS, NM, ND, OK and TN. Official publication bridges/current code links are recorded. KY, ND and OK include PDF-format constraints; licensed publisher interfaces, extraction failures and the OSCN human-verification challenge remain explicit gaps. Do not silently substitute an old third-party state-law table.

## Material legal corrections and distinctions

1. Alabama's ordinary-injury mapping cites § 6-2-38(l). The same-duration workers' compensation subsection (g) is not evidence for an ordinary personal-injury claim. Legacy summary data should remain separately qualified.
2. Arizona § 12-551 remains published, but Hazine v. Montgomery Elevator Co., 176 Ariz. 340 (1993), identifies its constitutional defect. It is not an automated twelve-year cutoff.
3. Pennsylvania's publisher flags § 5524.1/Act 152 of 2004; Neiman, 84 A.3d 603 (2013), supplies the primary invalidity authority. Published asbestos text is not presumed operative.
4. Indiana's published asbestos provisions require Myers, 53 N.E.3d 1160 (2016), and its treatment of protracted exposure and constitutional classification. General product delivery/repose and late-accrual exceptions remain separate from a two-year anniversary.
5. Illinois displays § 13-213 both with and without changes it labels unconstitutional. Best v. Taylor Machine Works, 179 Ill.2d 367 (1997), invalidated Public Act 89-7 as a whole. The invalid all-theories version cannot be used as a universal product-repose rule.
6. Florida current product-injury § 95.11(3)(d) supplies four years, distinct from current ordinary negligence § 95.11(5)(a). Chapter 2023-15 transition and § 95.031 discovery/useful-life/repose remain independently confirmed.
7. California product discovery is supported by CCP § 335.1 and Fox v. Ethicon, 35 Cal.4th 797 (2005), including its distinction of product wrongdoing from medical-negligence knowledge. Fox's underlying facts used the former one-year statute; its footnote 3 identifies the two-year change. Asbestos/special claims are excluded from the general branch.
8. Ohio toxic/drug/device, chromium and DES branches require qualifying injury-causing exposure during the ten-year first qualifying delivery window to use § 2305.10(C)(7). Asbestos uses its separate (C)(6) exception. The veteran/Agent Orange branch is research-only because the current official § 5903.21 URL returned Number Not Found for referenced definitions.
9. Iowa's defined harmful material includes tobacco and a pre-July 12, 1992 implant cutoff. Kansas uses a pre-July 1, 1992 implant cutoff and a different harmful-material definition. Kansas's ten-year useful-safe-life presumption is rebuttable; it is not a universal fixed cutoff.
10. Virginia branches distinguish physician communication, actual/constructive injury-and-cause knowledge, implanted devices and applicable death caps. Maryland occupational-disease death compares cause-of-death discovery plus three years with death plus ten years.
11. Current Maine death text is three years. Minnesota strict-product liability has a distinct four-year classification. Michigan's ten-year product language affects proof; no automatic repose cutoff is inferred.
12. Montana's official page contains pre/post October 1, 2026 versions. Historical applicability and current special exclusions require confirmation.

## MDL and governing-law guard

28 USC §§ 1404, 1407, 1652 and 2072 are contextual federal statute references (GovInfo 2024 edition; later amendments not comprehensively reviewed). Van Dusen, Ferens, Lexecon, Menowitz, Atlantic Marine, Dobbs and Looper/Lambert are selected primary decisions.

A § 1407 pretrial transfer does not establish a new state's limitations period. Convenience-transfer choice rules, federal causes, a valid forum-selection clause, direct-filing orders, intended originating forum and party consent require distinct analysis. Lexecon addresses statutory pretrial transfer/remand and does not establish tolling through a master complaint or registry entry. Looper/Lambert's Cook IVC-filter MDL result depended on the originating jurisdiction and the defendant's consent/conduct; it is not generalized to all MDLs.

## Bundle contract for ingestion

All files are under public/data/limitations:

- sources.json: source IDs, jurisdiction, statute title, publisher URL, extraction method, capture/verification dates, stored text path/hash/size, statutory-only validity and unreviewed historic applicability.
- rules.json: unique rule IDs, schema/rule versions, jurisdiction, PI/product/death classification, rule kind, period, computation status, source IDs, exact pinpoint, claim scope, accrual basis, conditions/exclusions, historical/effective-window limits, warnings and optional judicial-reference IDs and calculation branch.
- coverage.json: all 51 jurisdiction rows, source/rule foreign keys, official publisher/discovery links, metadata-only references, explicit gaps and conditional/research/pending status.
- case-references.json: selected court opinion metadata, decision date/citation/pinpoint, holding/application limits, identified copy publisher, stored opinion text/hash, unreviewed subsequent treatment and PDF download flag false.
- publisher-overrides.json: official publication routes and format/interface limitations for the eight statutory-text gaps.
- rejected-captures.json: unrelated-provider-content rejection and missing referenced-definition evidence.
- text/_.txt and opinion-text/_.txt: source extracts, not a certification of publisher-original bytes.

Promote each source/rule as a separate versioned record. Do not collapse source capture, statutory period verification, judicial validity, historic applicability and case-specific applicability into a single verified flag. Do not publish held open-law datasets because a statute appears in the current compilation.

## Engine limits and validation

Civil dates use exact UTC-independent year/month/day parsing. No fixed-millisecond year arithmetic. A February 29 anniversary missing in the target year is blocked until a jurisdiction-specific counting rule is verified. Historical fact dates later than the source snapshot are blocked; a calculated future anniversary is allowed. Ambiguous baseline versions, missing evidence and unresolved issue flags produce no date.

Tests cover date validity/leap years, future results versus future fact inputs, unresolved choice/repose/tolling/prior-action gates, discovery ordering, Virginia death caps, Maryland ten-year/death comparison, Ohio exposure windows and asbestos distinction, Iowa/Kansas definition differences, missing judicial evidence, all-state inventory/source checksums, dual-version invalidity and rejected capture content. Court holidays, closures, procedural commencement/service cutoffs, actual tolling duration, choice-of-law outcomes and historic amendments are uncomputed.

Rebuild inventory with node scripts/limitations/build-coverage.mjs; verify hashes with node scripts/limitations/verify.mjs. The two authored rule-building scripts are idempotent enrichment helpers; their manually reviewed specifications are not a generic statute parser.

## Applied corpus receipt

The source system `corpus-legal-review` was imported into the private versioned ingestion schema on Supabase project `xosqzzsnhxcyehcnirpa`, run `494cfa52-74c5-42ac-a770-80e46b9a3035`: 248 native entities, 248 source versions, 248 observations and 301 explicit native-ID relationships. There are no inferred or unresolved relationships. The two rejected captures remain quarantined.

Database validation checked the SHA-256 of all 82 stored text records against their source files, with zero mismatches. The 1,903,800-byte Indiana code snapshot retains its file locator and hash rather than embedding oversized full text in an ingestion batch. No PDF binaries were acquired. Administrative credentials are not part of the records or source bundle.

The separate public dataset `statutory_limitations_review` contains 104 cited rule records, qualified as conditional baselines or further legal review. Its payload, source links, record hashes, listing ordinals and qualifications matched the private versions before publication. State, claim type and computation filters are available. The legacy 459-row limitations table was not altered, and held `open_us_law` remained unreleased.

The anon and authenticated roles have no private-schema usage, private-entity SELECT or ingestion-function execution permission. All private ingestion tables have row-level security enabled. The website reads only the sanitized public projection.

Reproducible database contracts are `database/contracts/project-limitations-review-v1.sql`, `project-limitations-review-v1-publish.sql` and `project-limitations-review-v1-filters.sql`. The private receipt and batch manifest are outside Git at `../private/legal-review-import-20261002/receipt.json` and `../private/legal-review-import-20261002/sql/manifest.json`. The publish contract includes aggregate counts, text-hash checks, rejected-capture counts, role permissions and prior dataset readiness checks. Exported calculator analyses include supplied facts, rule/schema versions, source links and hashes, and selected judicial references.
