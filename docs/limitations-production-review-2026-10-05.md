# Limitations calculator review — October 5, 2026

The calculator remains a conditional statutory anniversary calculator. It does not certify a filing deadline, calculate tolling, choose governing law, or apply court calendars/service rules. There are 118 rule records: 73 supported branches across 37 jurisdictions and 45 research-only records. Primary statutory text is available for 46 jurisdictions, which is different from calculator coverage. The five statutory-text gaps and unsupported claim branches remain explicit.

## Corrected legal boundaries

- Florida ordinary negligence: current §95.11(5)(a) supplies two years. Chapter 2023-15 §28 applies the amendment to causes accruing after the act’s effective date; §31 and the approval record establish March 24, 2023. The date-only branch now starts March 25, 2023 and withholds earlier dates and the effective-day boundary. This is a conservative calculator boundary, not a determination of every same-day claim’s applicable law. The four-year product-injury branch remains distinct. Sources: [current §95.11](https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0095/Sections/0095.11.html), [enacted act](https://laws.flrules.org/2023/15).
- Maine ordinary wrongful death: PL 2023 c.390 §3 lengthened the period to three years, effective October 25, 2023. The branch now withholds earlier death dates because the act does not expressly resolve retrospective application. Its damages inflation provision does not establish a limitations transition. Sources: [enacted law and effective-date front matter](https://lldc.mainelegislature.org/Open/Laws/2023/2023_PL_c390.pdf), [current §2-807](https://legislature.maine.gov/statutes/18-C/title18-Csec2-807.html).
- Other historical applicability remains subject to the explicit legal-review confirmation; absence of an encoded boundary is not proof that a current rule applies to all earlier facts. Montana’s temporary and October 1, 2026 versions retain the ordinary three-year period, but their exception cross-references differ.

The engine uses the oldest review date among each branch’s required statutory sources, bounded by the bundle release date. Updating one source never refreshes all other authorities. It rejects unknown calculation modes and malformed date windows and requires literal boolean confirmations. Runtime loading rejects malformed rule periods, source links, unsupported calculations, duplicate branch identities, unsafe URLs, inconsistent versions and coverage facets.

## Preserved evidence and projection

Administrative run `841cf6a6-5210-4380-8283-eeb9027541ef` completed on the authorized project. Twelve source/rule/coverage entities were ingested through the private versioned contract; seven rules changed. The public 118-rule projection exactly matches the protected bundle, with no field, source-hash, stored-version, text-storage or citation-target mismatches. Dataset counts and filter facets reconcile. There are now 81 statutory captures and 13 judicial references.

Three original official HTTP responses (Florida current HTML, Florida act PDF, Maine act PDF) are retained in private content-addressed storage, with whole-object SHA-256 readback receipts. The seven changed protected bundle objects also passed full readback verification. Earlier rule/source versions and all 118 published-row before-images were preserved; no source rows were deleted. Private evidence, reversible before-images and receipts are under `private/audit-2026-10-05/limitations-production/`. Credentials and original source payloads remain outside Git.

Five regression tests reproduced the prior defects before the corrections. The focused engine/validation/guidance suite then passed 38 tests, and the complete suite passed 633 tests with one existing skip. UI and source-family delivery checks are recorded below after publication.

## Consolidation scope

An exact native-identity audit found all 7,093 earlier FDA classification product codes in the October 2, 2026 collection of 7,094 codes, and all 16,191 earlier CourtListener person IDs in `cl_people`. The projections differ, so current browsing/search uses one source version and preserves earlier versions separately. This is not byte-level storage deduplication, and aliases remain distinct native people. The 459 historical limitations summaries have a different record grain from the 118 reviewed rules; they remain secondary reference evidence behind one calculator/research destination.

The CourtListener docket acquisition continuation remains deferred until at least 10:55 UTC, followed by an actual quota check. This calculator work does not close any docket cursor or held-corpus gap.

## Interface verification

The calculator now has Claim → Dates and review → Result steps. Claim selection no longer skips the product fact-pattern choice. Unknown dates stay blank; exception-checklist disclosure never answers the exception question. State and claim changes clear answers; dates and legal confirmations do not enter the URL. One result has adjacent citations, a readable date and one qualification; source hashes, exports and broader research are secondary. Conditions and exclusions are accessible beside the applicability confirmation.

Browser checks confirmed blank-date focus/error, the Florida May 1, 2024 → May 1, 2026 conditional anniversary, withholding for a May 1, 2020 Florida trigger, unchanged exception answers when opening the checklist, cleared answers after switching to Ohio, and Ohio’s four required toxic-product date fields. A narrow 355-CSS-pixel viewport had no horizontal overflow. The FDA view contains one 7,094-code current collection and a working selector for its 7,093-code prior version. Law Reference tools contains one limitations destination. TypeScript and the production build pass. Final focused tests passed 38/38; the full suite passed 633 with one existing skip before the final presentation-only refinements. Scoped lint has no errors; the existing `SectionPage` helper-export refresh warning remains.
