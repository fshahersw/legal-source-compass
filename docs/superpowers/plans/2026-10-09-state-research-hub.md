# State research hub implementation plan

**Goal:** Implement the owner's state-first legal research navigation directly in the working repository; retain the approved calculator and all private corpus records.
**Architecture:** One canonical state identity shared by the map, court filters, judge filters, county paths, and law links. State pages use Overview, Courts, Judges, Laws & sources, and Counties rather than stacked duplicate registries. Existing profile URLs remain functional; duplicated litigation entry points are hidden, not deleted from storage.
**Tech stack:** Existing React/TanStack Router/Query, TypeScript, SVG geography, local licensed image assets; no additional UI framework.
**Authorization:** Owner explicitly requested direct implementation and continuing execution without further Lovable delegation.

- [ ] Preserve the current direct calculator work, reconcile current origin/main without overwriting published history, and retain both source-bound legal policies and reviewed-scenario safeguards.
- [ ] Regression tests: all 51 FIPS/USPS/name identities, Nebraska versus Nevada, unknown states, cross-state county rejection, exact court/judge associations, and absence of retired menu destinations.
- [ ] Implement compact navigation and state hub with searchable courts/judges, URL-backed tabs, back/forward support, error states, pagination and explicit historical association labels.
- [ ] Replace blue case-oriented homepage with an accessible neutral map, focused hover/selection, state search and direct state law/court/judge entry points; preserve unknown-count semantics.
- [ ] Acquire pinned open-source agency emblems, state illustrations and court artwork with per-asset provenance and license records. Judge pictures require an explicit matching identifier or the existing recorded portrait. Never infer identity from appearance.
- [ ] Continue statutory source reconciliation using retained official evidence. Never fabricate headings, release blocked collections, or claim every law/exception is verified.
- [ ] Typecheck, relevant unit/property tests, browser checks including mobile and map identity, build, integration review, commit and push the actual branch. Verify remote commit independently.

## Review focus
Unknown geography cannot become a named state; judge state/court lists do not prove paired current service; images must not become false official seals; hidden navigation is not permission to delete data; counts and status distinguish incomplete/failed requests from zero; state switching resets incompatible court filters but not unrelated calculator work.
