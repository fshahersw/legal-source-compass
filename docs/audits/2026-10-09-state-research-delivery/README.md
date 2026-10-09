# State-first research delivery

Implemented directly in a Git worktree of fshahersw/legal-source-compass. Existing published history and both calculator implementations are retained.

- Four primary entries: States & courts, Law & regulation, Time limits, Sources. Duplicated matters/MDLs/cases/expert-rulings/people navigation is removed; source records and old direct URLs are not deleted.
- State hubs have Overview, Courts, Judges, Laws & sources and Counties, with canonical FIPS/USPS identity and URL-backed filters. Nebraska never falls through to Nevada.
- Neutral map palette, county layer toggle, keyboard interaction, distinct geographic illustrations, and compact agency/court/profile artwork. Artwork is pinned, checksummed and attributed; geography is not presented as an official seal.
- Independent geography loading: removed case catalogs cannot block state research. State directories use bounded server-side queries with jurisdiction checks. Unknown counts remain unknown.
- Court homepages with a conflicting federal/state identity are withheld; original records remain unchanged.
- Reviewed-scenario arithmetic and source-bound statutory policies remain separate, with explicit unsupported-scenario handling and source-change invalidation.

## Verification

1149 selected tests passed across 40 files; typecheck and production build passed; lint had no errors. 19 browser checks passed with no reported uncaught errors or scanned accessibility violations. Local map tests used unchanged bundle bytes served by the existing application; they do not certify live directory counts. See verification.json.

## Outstanding legal work

This delivery does not claim complete all-50-state statutory coverage or every possible tolling/filing rule. Missing state imports, current-law reconciliation, historical versions and source review remain distinct data work. No unavailable statute or unverified date is invented to close those gaps.
