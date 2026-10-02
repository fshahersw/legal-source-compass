# Corpus enrichment release — 2026-10-02

Target: `firastest1.com`, repository `fshahersw/legal-source-compass`, external corpus project `xosqzzsnhxcyehcnirpa`. This release adds metadata, source evidence, permanent detail pages and a cited, conditional limitations calculator. It does not download PDF documents.

## Imported evidence and counting units

The private versioned ingestion run is `494cfa52-74c5-42ac-a770-80e46b9a3035`. It stores **683,972 distinct provider/type/native identities**, **684,092 source versions and observations**, and **994,493 source-version field relationships**. Repeated source versions can repeat an association. These totals are not counts of cases, individual people, current MDL members, verdicts or settlements.

| Scope | Records | Meaning |
| --- | ---: | --- |
| FJC selected administrative records | 365,845 | Source-explicit matches for 14 of 17 requested MDL numbers; historical administrative rows |
| Scoped bulk docket versions | 187,900 | Exact native IDs with original source/version evidence, including withheld candidates |
| Live docket headers | 105 | API observations, which may share an identity with bulk versions |
| Master docket entries | 5,727 | 5,047 rows across five complete entry scopes; 680 across ten partial scopes |
| Native party / attorney identities | 1,359 / 887 | Retained privately with native docket-specific roles |
| RECAP document metadata | 6,705 | Metadata and locators only; source marks 1,076 available and 5,629 unavailable |
| Published court/person/service/education references | 92,998 | Seven separate metadata datasets; testing courts excluded |
| Formal reporter citations / directed mention rows | 26 / 201 | Small selected native scopes; mention depth does not establish treatment |
| Federal Register backfill | 3,139 | Publications from August 21 through October 2, including notices and proposed rules |
| eCFR title version rows | 50 | Title amendment/issue/currentness index, not full refreshed sections |
| Cited limitations rules | 104 | 68 conditional baseline branches and 36 research-only records |

Eleven checksum-verified nationwide originals total **9,094,264,080 compressed bytes**. They are cached outside Git. Acquisition of an original is separate from its scoped database import. The nationwide originals include 72,998,758 docket rows and 78,404,647 citation-map rows; those entire files have not been loaded into Supabase.

The FJC ordinary tape labels span 2013–2021. Its native `2099` value is the publisher's pending administrative-record marker, not a future calendar year or an independent current-2026 pending finding. MDLs 3047, 3081 and 3094 have zero matches in this complete dated FJC scan; this does not mean those litigations have no cases. See the [publisher model](https://github.com/freelawproject/courtlistener/blob/main/cl/recap/models.py).

Five complete API entry scopes are Elmiron 2973 (419), Davol/Bard polypropylene hernia mesh 2846 (994), GLP-1 gastrointestinal injury 3094 (1,034), PPI 2789 (1,263) and Benicar 2606 (1,337). Physiomesh 2782 is separate from 2846, and Testosterone 2545 is separate from Benicar. Exact source headers and corrected cumulative receipts preserve these distinctions. The 15 observed masters contain 150,029 entries, requiring 7,508 default API pages; ten scopes remain incomplete under rolling quotas.

## Identity, publication and privacy

All 684,092 stored source-version hashes were recomputed with zero mismatches. Current entities match their selected version payload and schema. Native target-presence refresh found zero mismatches across all 994,493 relationship rows. **60,310 targets lack a local imported target observation** and remain unresolved; no target is inferred from a similar name. The native appointer field points to positions, and criminal/magistrate parent-docket fields do not become MDL membership.

The source vocabulary crosswalk has **88 exact mappings**, version `2026-10-02.1`, with zero unmapped active public categories at the checkpoint. Publisher classification, content type, original labels, source version and retrieval date remain separate. Exact-URL deduplication preserves each constituent row. The narrower legacy identity audit compared 42,971 rows, found zero exact duplicate groups and verified 394 explicit person aliases. It does not certify that the entire corpus is duplicate-free.

Two publisher testing courts were reversibly quarantined with complete original records and decision evidence before removal from the active public court registry. Blank or anomalous records lacking proof of garbage were retained for review. Held collections remain held.

Public projections are independently reconciled against their source identities, entire whitelisted fields, categories, URLs, ordinals and SHA values before the ready flag is set. The docket projection omits captions, party/contact data, excerpts and raw payloads. It exposes native docket/court IDs, dates, explicit FJC MDL evidence and source/version provenance. The final whole-collection reconciliation passed: 186,923 eligible/published rows, distinct contiguous ordinals 1–186,923, zero missing/mismatched/unexpected records, and identical expected/actual complete-field SHA-256 `b63f675fdf282b4a6839b13ed9b11c0a5c16e766fce06a21cbb16f48301e89f5`. The dataset is ready.

Private ingestion is restricted to the administrative service role, with row-level security enabled and no anon/authenticated schema, table or ingestion-function access. Website server functions read only approved public datasets and aggregate context; administrative credentials never enter the repository or client.

## Legal review and calculator

All 51 state/DC jurisdictions have a source inventory. Primary statutory text was captured for 43. The bundle includes 71 statutory snapshots and 12 primary judicial opinion-copy references. Eight primary-text gaps remain due to the available publisher formats/access: AR, GA, KY, MS, NM, ND, OK and TN. No linked PDF was fetched to fill these gaps.

The calculator supports 68 conditional baseline branches across 34 jurisdictions. The user must establish governing law, accrual and rule-specific applicability/transition facts. Unresolved tolling, repose, choice of law, prior filing and other issue flags withhold a date. Holidays, closures, commencement/service cutoffs and unreviewed tolling are not computed. Nonexistent leap-day anniversaries require a verified jurisdiction-specific counting rule. Invalidated or unsupported statutory branches remain research-only.

Each result supplies the governing rule, source links, relevant qualifications, supplied facts, rule/schema versions and evidence hashes. This is a conditional calendar baseline, not a conclusion that a claim is timely. See `limitations-review-2026-10-02.md` for state-specific legal distinctions and rejected captures.

## User interface and validation

Source and corpus records open permanent full pages. Active source/record detail drawers are removed. Nested source/version provenance is available in a collapsed, escaped JSON section on permanent entity pages and remains in metadata exports. The enrichment page distinguishes historical administrative records, native docket links, master entries, public metadata counts and incomplete coverage. The four-section sidebar adds contextual access to enrichment and cited limitations.

Validation: 184 tests passed with one existing skip; TypeScript and the production build passed; the bundled original-data checksum audit passed. Original tracked public data files were preserved. Repository scans found zero supplied credential values and no file over 10 MiB. Private source/cache data remains outside Git.

Collection status remains **partial**. Current MDL member backfills, ten master entry scopes, the full nationwide citation import, unreviewed legal branches and remaining statute gaps are explicitly outstanding. Source next cursors, page-level checkpoints, source hashes and bounded ingestion contracts are retained for continuation.
