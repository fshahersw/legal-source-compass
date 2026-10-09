# Resource-first navy workspace

Owner-requested interface update: dense, aligned, useful research resources; navy/blue contrast; less technical metadata and no prominent JSON download controls.

## Delivered code

- State overview: compact statutes entry, immediately usable source links, exact-state court entries, judge and deadline shortcuts, and a smaller county map.
- Resource grouping is presentation-only and based on express title words. It does not change recorded categories or imply that a source is official, complete, current, or controlling. Statutes, court rules and opinions sort before general references.
- Source destinations are validated; stored titles, URLs and legal text remain unchanged.
- Statutory text comes before optional source/version details. Repeated clauses and printed repeal/status notices remain intact.
- Primary JSON exports were removed from calculator and state-reader controls. Printing recomputes the current assessment and preserves the result's legal qualifications. A failed source refresh still withholds cached dates.
- State-scoped code loading does not require unrelated private statute snapshots. Wrong-state county URLs are rejected.

## Verification

- 1,187 targeted tests passed with zero failures.
- TypeScript, changed-code lint and production build passed. Existing non-blocking fast-refresh warnings remain.
- Eight resource-workspace browser checks, nine calculator checks and two refresh checks passed. Tested pages reported no uncaught errors and no accessibility violations.
- Browser data is described in each report: synthetic bounded court/agency fixtures with actual protected research bundles and pinned image assets. These reports are not independent verification of every production record.
- The whole repository test suite is not claimed green; older unrelated private fixtures are not part of this targeted verification run.

## Statutory continuity

The existing source-bound California hierarchy builder and its six regression tests are now preserved in this checkout. Fresh reconstruction against the retained publisher ZIP reconciled 162,526 section paths and retained the publisher's one spacing-only Water Code anomaly. It recorded no missing ancestor headings. This UI commit does not import that enrichment, publish held states, change statutory periods, or activate a new limitations manifest.

Production deployment is recorded separately after the exact committed UI release is observed on the live site. The application root carries `data-ui-release="resource-workspace-20261009"` for that check; it is not a user-facing metadata badge.

## Production readback and follow-up

The first UI commit, 9072fd0, was published and observed on the real custom domain on October 9, 2026. Six live browser checks passed without network interception or synthetic directory fixtures. Production courts, judicial profiles, resources and the calculator loaded successfully, with no uncaught errors or failed server responses during those checks.

Live review also identified non-court reference collections in the court spine. The follow-up uses only the source's explicit attorney-general or umbrella-judiciary record type to keep those entries out of individual-court navigation. Original data and research-resource links are preserved. Three additional regression tests cover the filtering, misleading names and unknown types.

The California hierarchy artifact was reconstructed and checked, but the attempted bulk transfer did not complete. No statutory corpus data or publication flag changed. Temporary empty staging database objects were removed and the unused upload endpoint was retired with JWT verification enabled; no ingestion job remains running.
