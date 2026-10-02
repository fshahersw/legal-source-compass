# Corpus audit and first enhancement release

Audit date: October 2, 2026 UTC. Target: [firastest1.com](https://firastest1.com/) and [fshahersw/legal-source-compass](https://github.com/fshahersw/legal-source-compass). This report supersedes work scoped to the earlier, incorrect site and repository.

## Findings that matter

The corpus has a substantial, useful foundation: 5,272,705 imported records across 71 datasets, a structurally clean URL directory, an intact registry hierarchy, and native court/docket keys that usually resolve. Independent record counts reconcile with expected and catalog counts for every dataset. That establishes import completeness against the supplied inventory; it does not establish nationwide coverage, current law, or substantive accuracy.

The main problems are interpretation and publication boundaries. Only 63 datasets containing 2,275,659 records were marked ready at the audit. Eight held datasets contain 2,997,046 records. Collection IDs also overlap: 200,104 record IDs occur in more than one dataset, involving 565,252 rows. An ID alone cannot safely identify a record. Those rows are not proven duplicates.

The implemented changes make these distinctions visible, correct category and jurisdiction handling, preserve publication restrictions, repair dataset-qualified search links, and add two independently reconciled public reference supplements. They do not certify every record or release held collections.

## Evidence and populations

The exact database snapshot is [database-audit.json](../public/data/quality/database-audit.json). The reproducible bundled-file audit is [bundled-audit.json](../public/data/quality/bundled-audit.json). Dates, source hashes, native categories, and count denominators travel with the data.

| Population | Observed result | Interpretation |
| --- | ---: | --- |
| External corpus records | 5,272,705 | Imported rows, including held datasets; no cross-collection deduplication claim |
| Ready / held records | 2,275,659 / 2,997,046 | Recorded publication flags, not an accuracy score |
| Database category/state combinations | 2,165 | All combinations sum to the database total; native values retained |
| Directory | 4,633 unique URLs; 6,372 mentions | URLs and mentions are different units |
| Directory structural URL issues | 0 | No malformed or non-HTTP URLs, domain mismatches, duplicate IDs or duplicate URLs detected |
| Directory jurisdiction tagging | 888 without a tag; 21 with several | Each exact tagged jurisdiction gets one count; unknown geography is not inferred |
| Registry | 9,348 rows / unique URLs | No invalid JSON lines, duplicate IDs or orphan parent references detected |
| Registry classification | 3,648 rows without a category | Includes parent and navigation resources; not automatically classification errors |
| Registry checks | 1,017 recorded non-2xx; 999 without a dated check | Latest dated observation is August 19, 2026; observations are historical |
| Saved case catalog | 2,122 rows; 131 scoped dockets | A selected catalog, not a national court workload population |
| Saved case geography / citations | 968 without a recognized state code; 2,803 recorded citation edges | Structural coverage only; citations are not outcome evidence |

The registry's non-2xx observations include 517 responses recorded as 403, 358 as 503, and 87 as 401. Access restrictions and transient failures need separate rechecks; they are not proof that a legal source is missing or obsolete.

### Held collection inventory

| Dataset | Records |
| --- | ---: |
| open_us_law | 2,968,623 |
| coverage_topics | 17,942 |
| coverage_labels | 10,013 |
| court_reference | 253 |
| large_text_assets | 155 |
| mdl_crosswalk | 59 |
| library_assets | 1 |
| judge_portraits | 0 |

No ready flag, database row, schema, or stored artifact was modified. The law outline can still expose its existing stored previews, with an explicit publication qualification. Held metadata is not silently treated as a published full-text collection.

### Relationships checked

| Native projection | Rows | Missing docket ID | Missing entry number | Missing / unmapped court ID |
| --- | ---: | ---: | ---: | ---: |
| MDL case inventory | 4,159 | 0 | Not applicable: case level | 0 / 0 |
| MDL docket activity | 26,549 | 0 | 0 | 0 / 0 |
| MDL docket documents | 5,016 | 1 | 96 | 0 / 0 |

These are checks of native stored identifiers and court mappings. They do not verify that every attached document belongs to the claimed entry, that a citation changes a legal rule, or that a name identifies a particular person. Existing exact-match and native-ID rules remain in force.

## Corrections implemented

- **Record identity:** Global search now resolves returned native items against dataset-qualified stored rows, preserving search order. It handles the recorded MDL prefix and county GEOID forms without fuzzy matching. Ambiguous/unresolved hits are reported instead of being linked to a guessed dataset. Law provision links carry their dataset; an ambiguous bare ID does not select an arbitrary provision.
- **Publication boundaries:** An empty bounded RPC listing remains authoritative. The old raw-record fallback could bypass readiness and search semantics. Artifact lookup and relevant context reads now require `ready=true`; held collections display their status.
- **Categories:** The source heading crosswalk uses explicit matches. Broad legal-resource trees are mixed resources; topical regulator headings do not establish that every URL is a regulation. Raw headings and native database categories are preserved. The mixed U.S. law collection is no longer presented as wholly statutes.
- **Geography and totals:** A source tagged to several jurisdictions is counted once in each. Unknown map counts remain unknown while loading or after an error. All state provisions are no longer appended to the federal outline count; overlapping state collections are not added to the outline as if they were disjoint.
- **Coverage:** The interactive quality page distinguishes URLs, registry rows, database records, source dates, release status, and national reference populations. It exposes all 71 datasets, raw category/state filters, paginated registry types, source qualifications, and the audited MDL key gaps. Snapshot dates remain visible when live metadata is unavailable.
- **Provenance:** Bundled imported files retain their original bytes. `.gitattributes` disables text conversion for `public/data/**`, preventing Windows line endings from invalidating original source hashes. Original imports and their raw records were not edited to make tests pass.

## Verified public-source additions

### Federal Register update index

The existing history contains 1,006,725 documents published through August 20, 2026. A bounded publisher acquisition now supplies **3,045 distinct metadata entries published August 21 through October 1, 2026**: 2,480 notices, 343 final rules, 188 proposed rules, and 34 presidential documents. Of these, 531 have publisher CFR references, 397 have recorded effective dates, and nine have native correction references.

Four original API response pages are preserved with byte counts, SHA-256 hashes, query URLs, and acquisition times in the [manifest](../public/data/quality/reference/federal-register-gap/manifest.json). Browser loading verifies those bytes before displaying the searchable, paginated index. Native correction document numbers remain intact. This is a bundled supplement, separate from the external database total; no database merge has occurred.

Publication, effectiveness, and legal currency are separate concepts. A document mentioning a CFR part may propose, discuss, correct, or amend it. The official legal editions are the linked GovInfo PDFs; FederalRegister.gov's API representation is an informational edition. [Publisher API documentation](https://www.federalregister.gov/developers/documentation/api/v1).

### Official court workload benchmark

The unmodified official FY 2025 Table C workbook and a derived JSON benchmark are bundled. Every one of its **94 district rows**, grouped into **55 native jurisdiction codes**, reconciles to all six national totals for FY 2024 and FY 2025. Circuit subtotals are excluded from jurisdiction sums. The native `NMI` code is retained.

FY 2025 reports **303,563 civil filings, 407,539 civil terminations, and 432,923 cases pending at period end**. The dashboard provides a measure selector and jurisdiction chart. These national workload statistics are a separate population from the saved case catalog, and do not imply outcome likelihoods. Pending counts include MDL transfers. [U.S. Courts Table C and workbook](https://www.uscourts.gov/data-news/data-tables/2025/09/30/judicial-business/c).

## Local acquisition candidates

The local V2.4 query toolkit contains 36,817 distinct resource URLs, 2,276 publishers, 4,058 collections, and 8,531 navigation nodes. Its referenced publisher, collection, and related-resource IDs have no detected orphans. Exact URL comparison identifies **27,488 URLs absent from both bundled registries**, including 22,786 with `.gov` hosts.

Those are acquisition candidates, not 27,488 proven missing legal documents. The toolkit explicitly describes metadata and external locators, records zero downloaded documents and zero live URL checks in that build, and retains unconfirmed status for all 2,761 representation groups. Its category and format labels can come from URL patterns rather than document bodies. No local files or unconfirmed relationships were copied into the public site.

## Next work in priority order

1. **Validate held law before releasing it.** Review authority, jurisdiction, source date, version lineage, full-text availability, and collection-level provenance for `open_us_law`. Check samples stratified by jurisdiction, native category, publisher, and update age; record disagreements for review. Release decisions need explicit evidence, not a mass readiness flip.
2. **Continue publisher currency checks.** Extend the bounded Federal Register index through a stable completed date, then join only native agency, CFR title/part, docket, RIN, and correction keys. For current regulation versions, use eCFR's dated version/structure/correction endpoints and record retrieval and effective dates separately. [eCFR API documentation](https://www.ecfr.gov/developers/documentation/api/v1).
3. **Verify local source candidates.** First compare exact URLs and publisher identifiers; retain redirect history and original locator IDs. Recheck official hosts in bounded batches, record response/MIME/title/date evidence, and review unknown classifications. Download documents only after confirming their source and content. Unconfirmed mirror or representation groups remain separate.
4. **Strengthen graph evidence.** Create reviewable edges with subject and object dataset IDs, native record IDs, relationship type, source reference, date, method, and verification state. Distinguish citation, amendment, correction, agency responsibility, jurisdiction, and docket membership. Structural reachability and evidentiary correctness need different metrics.
5. **Add valid statistics.** Expand official workload benchmarks and dated agency series with denominators. The CPSC dataset contains 479,534 imported records, including 410,201 NEISS 2025 sample rows; it is not a census. National estimates require the publisher's sample weights and survey design, variance estimates, and reliability rules. CPSC identifies estimates as unstable below 1,200 estimated injuries, below 20 sample records, or above a 33% coefficient of variation. [CPSC estimation methodology](https://www.cpsc.gov/Research--Statistics/NEISS-Injury-Data/Explanation-Of-NEISS-Estimates-Obtained-Through-The-CPSC-Website).
6. **Treat likelihoods as a separate research project.** The selected case catalog and citation graph do not establish calibrated outcome probabilities. Any later model needs defined outcomes, a defensible target population, leakage controls, temporal validation, uncertainty intervals, and calibration evidence. No probabilities or synthetic scores were added in this release.

## Reproduction and delivery limits

From the repository root, run `npm run audit:check`, `npm test`, `node node_modules/typescript/bin/tsc --noEmit`, and `npm run build`. The quality tests reconcile actual bundled files, API page hashes/counts/types, court workbook hashes and national totals, search identity collisions, unknown counts, and publication gates. `python scripts/plot-quality-audit.py` exports the [summary figure](figures/corpus-quality-2026-10-02.png) and PDF from these same snapshots; it requires `matplotlib`.

`node scripts/fetch-register-gap.mjs --after 2026-08-20 --through 2026-10-01` performs a bounded public acquisition (at most ten pages / 10,000 entries), validates it, and writes a new manifest only after reconciliation. This is an explicit refresh operation: reviewing its new source bytes is required before committing. `python scripts/import-court-benchmark.py` rebuilds the derived court JSON from the bundled workbook; it requires `openpyxl`.

The external count audit can be independently repeated with read-only queries such as `SELECT dataset, count(*) FROM public.corpus_records GROUP BY dataset`, and `SELECT category, state, count(*) FROM public.corpus_records GROUP BY category, state`. Compare the resulting rows with catalog/expected counts and the dated JSON. The committed audit is a snapshot, not a live counter or automatic legal-currency monitor.

Validation for this release: 138 tests passed and one existing test was skipped; the TypeScript check, production build, original-byte reconciliation, and deterministic bundled audit passed. Browser checks exercised held-collection filtering, the source-page hash verification, proposed-rule filtering and pagination, native correction lookup, court measure selection, registry type pagination, and the phone layout. Repository-wide lint still fails on its existing formatting backlog and other baseline rules; comparison of changed files against their original versions found no newly introduced semantic lint errors. Original imported data files remain byte-for-byte identical to the base commit.

The corrected repository is Lovable-connected and its build targets Cloudflare workers. The accessible Vercel inventory did not establish a matching project, and the Vercel project-details connector rejected its own argument shape. Deployment ownership therefore remains unverified. Local server-only external credentials are absent, so the dashboard correctly marks live metadata unavailable while still displaying the verified snapshots. This release is prepared for review in a draft pull request; it has not been merged or deployed to firastest1.com.

Full record-by-record legal validation, held-data release, broad local ingestion, and comprehensive ongoing publisher refresh remain outstanding. The audit and first enhancement release provide the evidence and safeguards needed to pursue those tasks without conflating imported volume with verified coverage.
