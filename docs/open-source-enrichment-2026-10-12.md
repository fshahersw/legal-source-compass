# Open source enrichment and production verification — October 12, 2026

This change builds on the current `origin/main` application, not the older modified local checkout. The original checkout and its uncommitted California/Texas intake work were preserved. The website reads protected, hash-pinned snapshots or the server-side read-only corpus. No private data or administrative credentials were added to git, and `public/data/` remains absent.

## Source roles and licensing

| Source                                                                                                         | Reviewed use                                                                         | Boundary                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Vaquill Open US Law](https://github.com/Vaquill-AI/open-us-law/tree/bcf5b2579605436ceeb5df675e3e6f1618b26915) | Publisher discovery and Apache-2.0 acquisition-code reference                        | Its current packaged dataset has separate CC BY-NC 4.0 terms. The owner-removed `open_us_law` collection was not reacquired. Code availability does not license every dataset or establish statutory accuracy.               |
| [Open Law ID](https://github.com/Vaquill-AI/open-law-id/tree/75f69acf4386fa7e198a33e3f93a58a0fe836774)         | Pinned MIT Python reference implementation, CC0 registries/specification/conformance | Optional Work-ID review candidates preserve native publisher IDs. Complete publisher hierarchy and identity review are mandatory; collisions in both directions are held. No historical Expression dates are inferred.       |
| [Awesome LegalTech](https://github.com/Vaquill-AI/awesome-legaltech)                                           | Discovery index                                                                      | Links and license descriptions are leads to inspect at the upstream source; they are not authoritative legal text or an import contract.                                                                                     |
| [Harvard LIL OLAW](https://github.com/harvard-lil/olaw)                                                        | MIT experimental research workflow reference                                         | The calculator uses confirmed facts and its deterministic rules engine. OLAW is not a verified limitations corpus or deadline engine. No LLM produces legal periods or final deadlines.                                      |
| Official court websites                                                                                        | Exact homepage anchors and existing image readback                                   | Original response bytes, readable text, labels, native court identity, retrieval timestamps and hashes are retained. A link observed on a homepage is not a certification of the destination's current requirements.         |
| [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)                        | Existing versioned ingestion with count/readback checks                              | The failed workflow's missing server secrets were repaired. [Run 38286049151](https://github.com/fshahersw/legal-source-compass/actions/runs/38286049151) succeeded. Existing held state-code collections were not released. |

Firecrawl mapping and a bounded five-page crawl of the U.S. Courts forms/rules site, together with Tavily official-domain discovery, are retained under ignored `private/source-discovery/`. Discovery responses do not become app rows automatically. The custom court capture tool fetches exact reviewed official URLs and keeps its own immutable source evidence.

## Calculator behavior

Optional description intake recognizes explicitly named states/claims and labelled dates. It displays the verbatim basis and requires confirmation before applying selected facts. Ambiguous dates, competing claims/states, uncertain/negated assertions and unlabeled dates remain manual. Injury, exposure, diagnosis, discovery and accrual keep distinct roles. Exception mentions populate existing screening questions as **Needs review**; they do not add time. Narrative text stays in the tab.

The reviewed `2026-10-12.1` candidate contains 889 rules and 1,030 source records; all prior 888 rules and 1,028 sources remain unchanged. It adds qualified Mississippi defamation and New Jersey counting evidence from official-host judicial opinions, retained through explicitly labelled proxy captures. Neither addition enables a new automatic deadline. Of 612 jurisdiction/claim cells, 539 have a baseline, 59 are flagged, one is research-only and 13 are not recorded. Georgia counting remains missing. Rules may have narrow or historical scope. The UI derives coverage and currency labels from the actual snapshot and preserves the engine's withholding behavior. See [the limitations evidence report](audits/2026-10-12-limitations-validation/README.md) for verification and remaining gaps.

## Corpus and imagery

Existing registered assets include 51 state geographic outlines, 47 agency marks and 84 court images. Tests check local bytes against recorded SHA-256 and source/license metadata. State outlines are labelled as outlines, not state seals. Five separately registered official court images were freshly fetched from their recorded official URLs and matched their local hashes. Artwork lookup no longer lends federal images to state courts with colliding IDs; image failure is scoped to its source.

Court resources are grouped into rules/orders, forms, filing/case access, fees, services and websites. Links come from exact stored profiles and a reviewed protected snapshot, with capture provenance available beside each enriched link. See `docs/court-resources-enrichment-2026-10-12.md` for the reviewed release and storage receipts.

## Repository quality

Search state follows URL changes and surfaces independent source errors. Agency profiles distinguish loading, failed, missing, capped and zero counts, expose recorded source coverage, and reset filters when the agency changes. Homepage shortcuts resolve unique exact recorded agencies and available collections, with explicit browse fallbacks. MDL membership no longer follows a docket-number suffix; explicit recorded association is required. Portable application/contract tests, private-fixture tests and optional database contracts have distinct documented commands. CI uses the checked-in dependency lock and tests Windows and Linux. Workflow dispatch values pass through environment variables, and CourtListener arguments now match its parser.

GitHub had no open Issues at the audit. Its 22 open PRs contain distinct, overlapping and sometimes inconsistent work; none was silently treated as merged or closed. `docs/github-pr-triage-2026-10-12.md` records the exact heads, stacks and substantive blockers.

## Reusable tools

- `scripts/enrichment/law_id_crosswalk.py`: reviewed publisher identity to optional Open Law ID candidates; private output, native IDs retained, no publication.
- `scripts/enrichment/capture_court_resources.py`: bounded official-page capture with immutable raw/text/anchor receipts.
- `scripts/enrichment/build_court_resource_bundle.py`: explicit per-anchor review and source validation to a private content-addressed bundle.
- `scripts/enrichment/stage_court_resources.mjs`: private evidence upload, hash readback, reversible manifest evidence, and optional activation of only the court-resource entry in the local application manifest.
- `scripts/enrichment/verify_court_artwork.mjs`: local hash checks and optional official source readback.
- `scripts/verification/fetch-private-fixtures.mjs`: restore only active manifest-pinned fixtures from the application's protected API; bounded streaming, hash/version checks and symlink rejection.

The Open Law ID tool was exercised against a captured official Montana section (`MT:10-1-1001`), its recorded publisher hierarchy and exact native corpus ID. It produced one private review candidate with zero held rows and no publication. The optional identifier does not replace the native ID. The original response and SHA-256 receipt remain under ignored `private/source-discovery/open-law-id/`.

## Observed browser checks

The local application rendered the Northern District of California's exact official seal, reviewed rules/forms/filing links and capture provenance. The FDA profile showed its recorded ID, source collection coverage, distinct document counts and recent published documents. Search navigation followed the URL and browser history. A synthetic California intake with explicitly labelled dates required confirmation; mentioning bankruptcy seeded a legal-review blocker, and assessment presented no deadline. Calculator, court and agency layouts fit a 390-pixel mobile viewport without document-level horizontal overflow.

## Release status

The private court bundle and limitations `2026-10-12.1` release passed storage readback. Their entries are activated in the branch manifest, with prior-manifest evidence retained for rollback. The reviewed branch is published in [PR #231](https://github.com/fshahersw/legal-source-compass/pull/231) after refreshing the repository owner's GitHub workflow access. Production has not been deployed; publication of the PR does not resolve the corpus deployment-baseline requirement below.

Final application verification passed 991 portable application tests, 228 Node contracts, 20 Python tests, five artwork hash checks, TypeScript and the production build, including the last agency-navigation regressions. The candidate separately passed 821 limitations integration tests and 21 SQL contracts. An independent review found no additional Linux/Windows CI portability issues.

The separate live legal-corpus deployment-gate attempt returned no result within its bounded process window, so that attempt is **unconfirmed**, not passed. A subsequent read-only query of the latest stored quality report found `passed: false`, reported at `2026-10-12T08:00:00.010417+00:00`, with the regression **“A reviewed deployment baseline has not been established.”** Its receipt is retained privately under `private/verification/legal-quality-readback.json`. This stored report establishes a remaining release blocker; it is not a fresh run against these code changes. No baseline was fabricated or changed to make the gate pass.

The code and tests improve production readiness. They do not certify all U.S. legal scenarios, make missing data complete, or turn staged changes into a deployed application without a release.
