# Seeger Weiss backfill coverage — October 2, 2026

**Per-docket PDF-target snapshot: 16:07:36 UTC.** Jobs continue; the later independently verified database checkpoint is 16:16:29.982293 UTC.

**439/509 targeted provider metadata snapshots are complete (86.25%)**: 96 prior plus 343 recent. Another 53 are partial or missing and 17 remain unresolved. The recent run targeted 345 scopes; 343 reached complete provider document-metadata snapshots. The 1,810-result CourtListener firm-query index was fully captured; this does not establish the entire firm portfolio or a current counsel roster.

PDF percentages count **provider document identities with durable whole-object verification at the selected source version / eligible known PDF identities in the frozen queue**. Held/restricted/no-locator records stay outside that denominator. Metadata percentages use captured unique metadata / the provider-reported total when recorded and consistent. Neither measure asserts the whole court docket, every member case, or current firm representation. Provider IDs and source targets are never merged into unique CAS-object counts.

| Provider | Eligible known PDFs | Verified source targets | Held queue rows | PDF coverage |
|---|---:|---:|---:|---:|
| courtlistener | 12907 | 2725 | 10838 | 21.113% |
| courtlistener-public-locator | 2201 | 661 | 0 | 30.032% |
| docketbird | 27597 | 27596 | 49609 | 99.996% |
| official-court | 281 | 280 | 0 | 99.644% |

The public-locator acquisition also excluded **325 candidate URLs before queueing**: 251 already represented by exact native API evidence and 83 sealing-related candidates, with 9 overlapping reasons. These are additional acquisition exclusions; the 2,201 selected public-URL queue itself has 0 held rows.

## Major matters and master dockets

Captions are exact sourced records displayed through qualified references; provider identities remain separate. **100% eligible PDF coverage can coexist with a partial metadata snapshot and many held documents.**

| Sourced matter caption | Provider / native docket | Metadata captured / provider-listed | Verified / eligible PDFs | Held PDF rows |
|---|---|---:|---:|---:|
| APPLE INC. SMARTPHONE ANTITRUST LITIGATION | docketbird · njd-2:2024-md-03113 | 558 / 558 (100.0%) | 427 / 427 (100.0%) | 131 |
| IN RE: DEPO-PROVERA (DEPOT MEDROXYPROGESTERONE ACETATE) PRODUCTS LIABILITY LITIGATION | docketbird · flnd-3:2025-md-03140 | 1000 / 1732 (57.74%) | 785 / 785 (100.0%) | 215 |
| INSULIN PRICING LITIGATION | docketbird · njd-2:2023-md-03080 | 1000 / 2011 (49.73%) | 784 / 784 (100.0%) | 216 |
| IN RE: SOCIAL MEDIA ADOLESCENT ADDICTION/PERSONAL INJURY PRODUCTS LIABILITY LITIGATION | docketbird · cand-4:2022-md-03047 | 1000 / 11388 (8.78%) | 847 / 847 (100.0%) | 153 |
| In re: Roblox Corporation Child Sexual Exploitation and Assault Litigation | docketbird · cand-3:2025-md-03166 | 703 / 703 (100.0%) | 604 / 604 (100.0%) | 99 |
| In Re: Change Healthcare, Inc. Customer Data Security Breach Litigation | docketbird · mnd-0:2024-md-03108 | 876 / 876 (100.0%) | 644 / 644 (100.0%) | 232 |
| In re: Davol, Inc./C.R. Bard, Inc. Polypropylene Hernia Mesh Products Liability Litigation | docketbird · ohsd-2:2018-md-02846 | 1000 / 1249 (80.06%) | 476 / 477 (99.79%) | 523 |
| IN RE: 3M COMBAT ARMS EARPLUG PRODUCTS LIABILITY LITIGATION | docketbird · flnd-3:2019-md-02885 | 1000 / 9784 (10.22%) | 843 / 843 (100.0%) | 157 |
| In Re: Apple Inc. Device Performance Litigation | docketbird · cand-5:2018-md-02827 | 1000 / 1123 (89.05%) | 914 / 914 (100.0%) | 86 |
| In re Facebook, Inc., Consumer Privacy User Profile Litigation | docketbird · cand-3:2018-md-02843 | 1000 / 3038 (32.92%) | 810 / 810 (100.0%) | 190 |
| IN RE: EQUIFAX, INC., Customer Data Security Breach Litigation | docketbird · gand-1:2017-md-02800 | 1000 / 1999 (50.03%) | 803 / 803 (100.0%) | 197 |
| IN RE: ZANTAC (RANITIDINE) PRODUCTS LIABILITY LITIGATION | docketbird · flsd-9:2020-md-02924 | 1000 / 9842 (10.16%) | 785 / 785 (100.0%) | 215 |
| In Re: Cattle and Beef Antitrust Litigation | docketbird · mnd-0:2022-md-03031 | 1000 / 3301 (30.29%) | 813 / 813 (100.0%) | 187 |
| In re: Volkswagen "Clean Diesel" Marketing, Sales Practices, and Products Liability Litigation | docketbird · cand-3:2015-md-02672 | 1000 / 15926 (6.28%) | 677 / 677 (100.0%) | 323 |
| IN RE: ALLERGAN BIOCELL TEXTURED BREAST IMPLANT PRODUCTS LIABILITY LITIGATION | docketbird · njd-2:2019-md-02921 | 1000 / 1782 (56.12%) | 677 / 677 (100.0%) | 323 |

## Named gaps and separate provider tracks

This includes native CourtListener API targets, public-URL targets, and DocketBird targets independently. A completed DocketBird PDF subset does not imply the CourtListener target or provider metadata backfill is complete.

| Sourced matter caption | Provider / native docket | Metadata captured / provider-listed | Verified / eligible PDFs | Held PDF rows |
|---|---|---:|---:|---:|
| In Re: National Prescription Opiate Litigation | courtlistener · 6240169 | 7028 known; total not recorded | 2337 / 5713 (40.907%) | 1315 |
| IN RE: Bard Implanted Port Catheter Products Liability Litigation | courtlistener · 67678440 | 3303 known; total not recorded | 0 / 35 (0.0%) | 3268 |
| In Re Aqueous Film-Forming Foams Products Liability Litigation MDL 2873 | courtlistener · 8408916 | 4261 known; total not recorded | 0 / 236 (0.0%) | 4025 |
| In Re: National Prescription Opiate Litigation | courtlistener-public-locator · 6240169 | 210 known; total not recorded | 0 / 210 (0.0%) | 0 |
| IN RE: Bard Implanted Port Catheter Products Liability Litigation | courtlistener-public-locator · 67678440 | 5 known; total not recorded | 5 / 5 (100.0%) | 0 |
| In Re: AT&T Inc Customer Data Security Breach Litigation | courtlistener-public-locator · 68936135 | 21 known; total not recorded | 0 / 21 (0.0%) | 0 |
| in re Angiodynamics, Inc., and Navilyst Medical, Inc., Port Catheter Products Liability Litigation | courtlistener-public-locator · 69255166 | 10 known; total not recorded | 0 / 10 (0.0%) | 0 |
| In Re PowerSchool Holdings, Inc., and PowerSchool Group, LLC Customer Data Security Breach Litigation | courtlistener-public-locator · 69912599 | 58 known; total not recorded | 0 / 58 (0.0%) | 0 |
| In re: Cognizant Technology Solutions Corporation And TriZetto Provider Solutions, LLC, Data Security Breach Litigation | courtlistener-public-locator · 73454806 | 10 known; total not recorded | 0 / 10 (0.0%) | 0 |
| In re: Davol, Inc./C.R. Bard, Inc. Polypropylene Hernia Mesh Products Liability Litigation | courtlistener-public-locator · 7603829 | 44 known; total not recorded | 0 / 44 (0.0%) | 0 |
| IN RE: Bard Implanted Port Catheter Products Liability Litigation | docketbird · azd-2:2023-md-03081 | 1000 / 34845 (2.87%) | 40 / 40 (100.0%) | 960 |
| in re Angiodynamics, Inc., and Navilyst Medical, Inc., Port Catheter Products Liability Litigation | docketbird · casd-3:2024-md-03125 | 943 / 943 (100.0%) | 52 / 52 (100.0%) | 891 |
| In Re PowerSchool Holdings, Inc., and PowerSchool Group, LLC Customer Data Security Breach Litigation | docketbird · casd-3:2025-md-03149 | 726 / 726 (100.0%) | 537 / 537 (100.0%) | 189 |
| BURGE v. COGNIZANT TECHNOLOGY SOLUTIONS CORPORATION | docketbird · moed-4:2026-cv-00916 | 136 / 136 (100.0%) | 3 / 3 (100.0%) | 133 |
| In re: Cognizant Technology Solutions Corporation And TriZetto Provider Solutions, LLC, Data Security Breach Litigation | docketbird · moed-4:2026-md-03185 | 89 / 89 (100.0%) | 79 / 79 (100.0%) | 10 |
| BURGE v. COGNIZANT TECHNOLOGY SOLUTIONS CORPORATION | docketbird · njd-2:2025-cv-18908 | 149 / 149 (100.0%) | 89 / 89 (100.0%) | 60 |
| In re: Davol, Inc./C.R. Bard, Inc. Polypropylene Hernia Mesh Products Liability Litigation | docketbird · ohsd-2:2018-md-02846 | 1000 / 1249 (80.06%) | 476 / 477 (99.79%) | 523 |
| In Re: AT&T Inc Customer Data Security Breach Litigation | docketbird · txnd-3:2024-md-03114 | 101 / 101 (100.0%) | 72 / 72 (100.0%) | 29 |

**Talc / Roundup:** no qualified unique caption-to-provider-master join is established in this frozen target report. Coverage is not assigned using account aliases or an assumed MDL number.

The independent database checkpoint at **16:16:29.982293 UTC** records **74,276 document entities**, **31,869 distinct verified PDF objects**, **19,157,638,383 bytes**, and **zero missing private objects or size mismatches**. Those are database/CAS units and must not be divided by the provider target counts above.

**752 supplied-local PDF occurrences are now registered.** The separate 701-occurrence packet accounts for 591 distinct bodies / 236,643,456 bytes, all read-back verified and independently registered with matched proofs. Its 12 local sealing flags, null backend IDs, and private quarantine remain intact; the original 51 scope was preserved. Local occurrences are not silently merged into native-provider coverage.

Full private CSV: `C:\Users\firas\.codex\corpus-cache\seeger-weiss\2026-10-02\coverage-snapshots\20261002T160724Z\reviewed-v2\full-native-case-coverage.csv`. Full private JSON: `C:\Users\firas\.codex\corpus-cache\seeger-weiss\2026-10-02\coverage-snapshots\20261002T160724Z\reviewed-v2\coverage-snapshot.json`. The reviewed artifact retains the original 16:07 snapshot hash, source-file and receipt-prefix hashes, every one of 576 native-case queue rows, and caption/source-version lineage.

This report used existing local snapshots only: no APIs, database queries, downloads, uploads, or deletions.
