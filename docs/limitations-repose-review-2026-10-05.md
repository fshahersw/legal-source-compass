# Separate accrual and repose review — October 5, 2026

The calculator now supports a narrowly bounded `accrual_repose_min` mode for a future reviewed ordinary-personal-injury branch. No North Carolina or Oregon calculator rule was activated by this implementation. The actual protected rules remain research-only. Prepared release `2026-10-05.2`, its frozen SQL, and the active `.1` manifest are unchanged.

The mode requires separate confirmed accrual and defendant-specific act/omission dates, a supported repose period and trigger, an explicitly supported historical start for the repose act date, and the existing governing-law, applicability and exception review confirmations. It compares the accrual anniversary and independent repose cutoff and uses the earlier. An act date after accrual, a repose cutoff before accrual, unresolved leap-day arithmetic, missing historical support, or any special issue withholds the date. Historical bounds for repose are checked separately from accrual bounds; the test-only dates do not assert statutory effective dates. Changing either input date clears repose confirmation. State, claim and subtype changes clear the prior inputs and confirmations.

The date fields and additional confirmation appear only for this calculation mode. Existing branches keep their current flow. This remains conditional civil-date arithmetic: court closures, holidays, commencement and service rules are not computed, and no calculated anniversary establishes a final filing deadline.

## Retained primary authority

Five official responses were captured on October 5 at 11:25:51–11:25:54 UTC. Their whole-body hashes, readback checks, retrieval receipts, and extracted text are retained in `private/audit-2026-10-05/state-law-next/nc-or-authorities/`.

- [N.C. Gen. Stat. § 1-52](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_1/GS_1-52.html), subsections (5) and (16): the ordinary period, discovery provision and separate last-act provision. The professional, groundwater and other statutory exceptions need their own treatment.
- [Oregon Revised Statutes chapter 12](https://www.oregonlegislature.gov/bills_laws/ors/ors012.html), §§ 12.010, 12.110(1) and 12.115(1)–(2): accrual, ordinary injury limitations, and the negligent-injury outer period that cannot extend another limitation.
- [CTS Corp. v. Waldburger, 573 U.S. 1 (2014)](https://www.govinfo.gov/content/pkg/USREPORTS-573/pdf/USREPORTS-573-1.pdf), 8–9 and 16–17, distinguishes limitations and repose. Its holding concerns CERCLA preemption in contamination litigation.
- [Marshall v. PricewaterhouseCoopers, LLP, 371 Or. 536 (2023)](https://ojd.contentdm.oclc.org/digital/api/collection/p17027coll3/id/10540/download), 539–40 and 556–58, construes ORS 12.115. Its facts concern legal-negligence economic loss.
- [Whalen v. American Medical Response Northwest, Inc., 256 Or. App. 278 (2013)](https://ojd.contentdm.oclc.org/digital/api/collection/p17027coll5/id/163/download), 284–90, discusses discovery in a bodily-injury battery claim. It does not establish a universal discovery date for negligence claims.

The earlier-of comparison is an implementation of independently applicable constraints, not a quotation or universal holding from these opinions. Historical enactment and transition review, exact branch exclusions and current-law reconciliation remain prerequisites to activation. Products, professional negligence, latent disease, construction, public defendants, wrongful death and unresolved tolling cannot be included by implication.

New Jersey's official indexed § 2A:14-2 was located, but both direct browser retrieval and native HTTPS retrieval timed out. The indexed text is a discovery lead; no direct primary response was captured and no NJ rule was activated. Evidence is in `state-law-next/nj-current/discovery-block.json`.

Validation after the separate repose-history correction: 72 test files passed, 648 tests passed and one existing test skipped; TypeScript, scoped ESLint and the production build passed. A GPT-6 Luna review identified the missing independent historical range before the correction. This is a committed implementation checkpoint, not a published-data or nationwide completeness claim.
