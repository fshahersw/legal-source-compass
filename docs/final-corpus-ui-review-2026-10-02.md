# Final corpus UI review — October 2, 2026

This review inspected the current working-tree changes in `DatasetBrowser`, `SectionPage`, `directoryTree`, `lawTree`, `recordIdentity`, `entityView`, the full-page record and timeline routes, `corpus.functions`, and the additive category mappings. It used source tracing, focused regression tests and the separate development SSR browser on port 4177. No database writes, CourtListener API calls, PDF downloads or changes to other owners' UI files were made during this review.

## Concrete findings and corrections

1. **Timeline loader rejected the actual published V3 artifact.** `loadEntryAnalysis` accepted only `courtlistener-entry-analysis/1`; the promoted artifact declared `/3`. This made the real timeline request fail with “Unsupported native entry analysis snapshot.” The loader now accepts only the reviewed `/1`, `/3` and `/4` schemas. It validates aggregate units, unique native scopes, date and count partitions, exact native evidence links, source hashes, the public field whitelist and the scope/privacy qualifications before rendering. Unsupported versions, malformed dates, inconsistent totals, private caption fields and mismatched parent identities are rejected.
2. **Historical tests were reading the moving current artifact.** The original tests expected V1's 600 partial captured entries and V1 source signature, while the current V3 artifact correctly contained 9,580. Historical assertions now read the preserved V1 file. Current-publication assertions accept only the frozen V3 or V4 source signature and the corresponding exact total and per-docket receipts; counts are not accepted merely because they match a claimed header.
3. **The public download retained a prepared publication label.** The V3 aggregate originally retained `prepared-pending-private-intake-and-full-public-reconciliation` after publication. The root corrected the published copies to a verified publication state and added the actual public reconciliation proof. The loader validates that proof's exact dataset, eligible record count, ready flag, hash and zero missing/mismatched/unexpected records. The prepared V4 fixture remains separate and makes no publication claim.

The V4 test fixture is an exact copy of the reviewed, public-safe prepared aggregate, outside the public asset directory. Its byte SHA-256 is `b8629925004814bffeabaedf2b1e8672f9823e9433edcdcf5dc8d4d1f9895831`. Loading that fixture establishes parser compatibility, not database publication readiness.

## Exact reviewed snapshot receipts

All counts below measure unique native docket entries in source-selected, dated captures; they do not measure cases, litigants, current membership, merits or outcomes.

| Snapshot | Captured | Eligible | Excluded | Partial captured | Partial eligible | Source signature |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Preserved V1 | 15,053 | 14,947 | 106 | 600 | 552 | `3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1` |
| Published V3 at browser review | 24,033 | 23,919 | 114 | 9,580 | 9,524 | `3908b6e5b2a216e87acc3fde4f44127f6d5bfaa93c49e4cbc2f4733925f14ba9` |
| Prepared V4 fixture | 33,033 | 32,898 | 135 | 18,580 | 18,503 | `a9eeb88c2ac73f376ae6a18c8cbf5e491b8c2e236b32e24be5eecea49ad2145d` |

Each snapshot retains seven complete and eight partial collections. The complete partition remains 14,453 captured / 14,395 eligible entries. V3 excludes 40 source-blocked and 74 explicitly sealed entries; V4 excludes 40 source-blocked and 95 explicitly sealed entries. No excluded filing date contributes to a timeline. Filing-year and source-court sums independently reconcile to the eligible dated and eligible entry denominators respectively.

## Guards checked

- **Full-page navigation:** generic native record tokens use permanent `/records/$dataset/$id` routes; courts, judges, MDLs and true provision collections retain their explicit destination mapping. eCFR hierarchy and note metadata open as reference records rather than being presented as operative provision text. New record links do not open the former right-side panel.
- **Native identity and parent links:** the measured 369-character eCFR identity preserves literal publisher percent escapes through a TanStack route round trip. The 512-character decoded and 1,536-character encoded bounds remain enforced. Malformed percent encodings, query/hash suffixes, control characters, backslashes and `.`/`..` traversal segments remain inert. Master-entry parent links require an exact ready public docket identity and native-ID fields, not a guessed title or MDL membership.
- **Unknown counts and values:** section lists distinguish `records === 0` from null counts; null inventory values display “Not recorded.” Matching counts are separate from imported inventory counts. Shared fact formatting now displays empty and whitespace-only source strings as “Not recorded” while preserving zero, false and native `N`, `U` and `f` codes.
- **Privacy boundary:** blocked or missing docket eligibility is held. An explicitly sealed document excludes the whole mixed entry. Unknown seal flags may preserve minimal entry metadata but cannot add public document IDs or inflate the explicitly unsealed document count. Public entry projections omit descriptions, captions, party/contact data and PDF locators. The focused privacy and facet tests independently cover these distinctions.
- **Court/judge mapping:** source arrays define recorded court, state and system associations. Combined scalar labels are not split into inferred associations. Folder intersections describe profile-level associations, not verified court–state service pairs or governing law; separate profile layers are not presented as unique persons. Name links still require a unique exact normalized match.
- **Source dates and grain:** dated openFDA classification and enforcement collections keep separate native grains; device class is not recall class or a litigation outcome. eCFR structural nodes are heading metadata, and authority notes preserve separate historical source dates and publisher CITA text. Category additions retain native categories and versioned crosswalks; broad source categories are not used to claim document semantics.
- **Publication reads:** generic listing/search reads use the publication-aware bounded RPC result, including authoritative empty results. Search is scoped to ready dataset identities. Provision retrieval remains restricted to the explicit provision dataset enum, so the enlarged native-ID bound does not expose new metadata collections through the stored-provision route. This is code-path review; database publication reconciliation remains the root's separate responsibility.
- **Timeline interpretation:** complete pagination is qualified as the publisher-returned collection at capture, not PACER completeness or member-case coverage. Partial selections display the sampling warning. Source court location is explicitly separate from applicable state law. No probability, causality, judicial treatment or outcome inference is made from these entry counts.

## Verification

Seven focused UI test files pass **66 tests**. The separate Node date-analysis, master-entry privacy and facet tests pass **10 tests**. Direct `tsc --noEmit` passes. Browser review of `/sources/analysis` on development SSR port 4177 confirms the V3 header (24,033 captured / 23,919 eligible), the default completed denominator (14,395), and the partial denominator (9,524) with its warning. The blocked native docket `14916674` displays zero eligible rows, no date range and “Entry rows withheld.”

The corrected timeline screenshot is retained privately at `C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T115000Z/timeline-v3-loader-review-4177.png`. Earlier browser receipts independently cover the deep eCFR parent/child round trip, dated CITA notes and the ready openFDA classification reference link. This review does not claim that prepared V4 is published or that the development browser constitutes production deployment validation. Fresh full-suite/build/deployment checks remain with the root after the final shared-tree changes.

No further actionable defect was confirmed in the reviewed changes after the corrections above.
