# CourtListener continuation checkpoint — October 2, 2026

The private continuation run `377d9b7a-f895-4314-a5bc-98279ec3c2fb` was finalized as **partial** at 10:46:58 UTC in Supabase project `xosqzzsnhxcyehcnirpa`. The previously released run and original acquisition files were preserved. This checkpoint acquired metadata and document locators; it downloaded no PDFs and made no PACER fetch/payment requests.

Two additional native entry scopes reached a terminal publisher cursor: Social Media docket `65407433`, 4,033 unique entries, and JUUL docket `16284915`, 5,373. Fresh leading pages overlapped the collected native IDs at 10:35:33 UTC. Independent publisher count endpoints returned the same counts at 10:36:34 UTC. Source observations remain dated observations rather than a guarantee that every historical entry field is currently unchanged.

| New private intake | Observations | Newly acquired native IDs |
|---|---:|---:|
| Docket entries | 9,366 | 9,326 |
| Parties | 700 | 700 |
| Attorneys | 80 | 80 |
| RECAP document metadata | 15,451 | 15,389 |
| Total | 25,597 | 25,495 |

The difference includes 40 fresh entry observations and 62 fresh observations of existing document identities. Native versions, original source captures, their hashes, and scoped observations are retained separately. The pass used 514 reserved CourtListener metadata requests within a 550-request bound; provider limits remained 50/minute, 600/hour and 2,800/day. Usage inspections and scoped failures are recorded in the private cache. Public CourtListener scraping previously denied by the publisher was not retried through another scraper or proxy.

The cumulative inventory contains 15,053 native entries: seven complete entry scopes account for 14,453; eight partial scopes account for 600. Exact remaining cursors are retained. Party/attorney continuations remain partial. Each role keeps its actual native docket ID and source array path, never the outer query docket by substitution.

The cumulative document inventory contains 22,094 native identities. Source flags mark 8,821 available and 13,273 unavailable; no destinations were fetched to independently verify availability. These are document metadata counts, not page counts, files downloaded, filings, cases, verdicts or settlements.

The private graph records 73,431 version-backed field edges for this observation scope, including 73,267 newly added edges. It retains 5,472 unresolved target associations. Independent verification matched observation identities and provenance hashes, stored native payloads, every edge's source field path, and target-presence flags with zero mismatches. Source-selected relationships establish recorded associations, not legal applicability or judicial treatment.

Private receipts are under `C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-02T101805Z/`:

- `metadata-continuation-acquisition-import-receipt.json`: aggregate acquisition/import receipt.
- `private-independent-verification-receipt.json` and `private-run-close-receipt.json`: database reconciliation and explicit partial-run status.
- `cumulative-master-scope-manifest.json`, `master-scope-counts.json` and `live-cumulative-entry-scope-receipt.json`: original-preserving cumulative entry coverage.
- `document-inventory-manifest.json`: latest captured source availability by native document identity.
- `master-entry-projection/master-entry-privacy-review.json`: private source-file hashes and public eligibility review.

The new public-entry contract is prepared separately in `database/contracts/master-entries-2026-10-02/`. At preparation, it has **not** been executed by this collector. Its pinned native source inventory is 15,053 entries, SHA-256 `3e0ec6816f07b0f675ea00fb4a9649972201d67ae3e620fe35be32657a8560b1`. It excludes 40 entries from a source-blocked docket and 66 entries containing explicitly sealed documents, leaving 14,947 eligible entry metadata rows.

The public whitelist is native entry/docket IDs, source entry number and filing date, explicitly unsealed source document IDs/count, and the CourtListener docket URL. Unknown document-seal flags do not permit a public document ID. The 3,253 eligible unsealed document associations are explicitly labeled as a filtered source count, not total documents or availability. Descriptions, captions, party/contact data, PDF URLs and document contents remain private. The state and county fields remain empty because docket location does not establish governing law.

The dataset `cl_master_entries` uses the native category `master_docket_entry`, mapped to the existing canonical `dockets` category. Its grain is one native docket entry. Generic permanent tokens open full record pages; a native docket-parent link is emitted only when the exact approved public identity exists in a ready dataset.

The prepared listing exposes two exact selectors: `native_docket_id` and `source_unsealed_document_count`. Labels use native docket IDs and source-explicit unsealed counts, with no captions or person data. Docket options sum to 14,947 eligible entry rows:

| Native source docket | Eligible entries |
|---|---:|
| 16284915 | 5,362 |
| 18753355 | 419 |
| 4134359 | 160 |
| 4264145 | 160 |
| 4270519 | 80 |
| 5838695 | 1,337 |
| 6102388 | 32 |
| 6224301 | 1,263 |
| 6240169 | 40 |
| 65407433 | 3,986 |
| 67678440 | 40 |
| 68222905 | 1,034 |
| 7603829 | 994 |
| 8408916 | 40 |
| **Total** | **14,947** |

The blocked native docket `14916674` contributes no eligible entries and no selector option. These frequencies describe this source-selected entry snapshot, not complete filings or current case membership. Links can select an exact scope with `/data/cl_master_entries?f.native_docket_id=65407433`.

The document-count selector has 40 nonempty exact values from 0 through 74. There are 13,725 eligible entries with zero explicitly unsealed source IDs and 862 with one. Zero includes entries whose document flags are unknown; it does not assert that an entry has no documents. All 40 option frequencies sum to 14,947 and their weighted count sums to 3,253 explicit-unsealed associations. The complete histogram and selector definitions are tracked in `database/contracts/master-entries-2026-10-02/master-entry-filter-facets-v1.json`.

Independent offline reconciliation reloaded the three original byte-verified source files, reselected latest observations, recalculated source eligibility and unique explicit-false document IDs, and matched every facet frequency with zero mismatches. Its private receipt is `master-entry-projection-facets/master-entry-facets-independent-receipt.json` in the continuation cache. Database verification remains a separate execution: `project-master-entries-v1-filters-verify.sql` compares every source-derived and public facet frequency, both totals, the weighted association total, and the stored selector definitions. The final publication contract includes that gate in addition to every persisted record field and checksum. `project-master-entries-v1-filters.sql` can install these exact definitions on the held dataset after all projected rows reconcile; it cannot change readiness.

Execution order after independent review is privacy review, held registration (including the selector definitions), upsert and independent full-field comparison for ordinals 0–10,000 and 10,000–20,000, independent facet verification, then complete-collection reconciliation/publication. Only the two numeric batch bounds change between batches. Registration cannot implicitly re-hold an already published collection. Final publication remains held on any source, count, ordinal, field, facet or checksum mismatch.

The reusable worker pool waits for every active worker to settle before quota-lock release. The collector's observation key now retains identical native payloads acquired through distinct source-query URLs. Ten offline regression tests cover the worker-failure race, publisher-stop behavior, scoped observation preservation, blocked/missing source headers, mixed sealed entries, unknown/string seal flags, invalid document IDs, facet frequencies, weighted association totals and duplicate entry protection.

An additional offline research artifact, `public/data/quality/courtlistener-entry-analysis-2026-10-02.json`, supports `/sources/analysis`. It calculates filing-year counts only from 14,947 privacy-eligible native `date_filed` values. All 14,947 parse as exact calendar dates; missing, nonparseable and after-capture-date counts are zero in this snapshot. Date parsing rejects rollover dates, timestamps and inferred formats. The default timeline includes the seven completed collections, 14,395 eligible entries out of 14,453 captured. The eight partial collections contribute 552 eligible entries out of 600 captured and are explicitly marked as incomplete samples when selected.

Court names resolve by the exact native court resource in each captured docket header and the byte-verified September 30 native court-reference export. Court location does not establish governing state law. Source multidistrict numbers come from the captured docket-number field and never establish current membership or a case role. The artifact carries the frozen entry-observation signature, all input-file checksums, per-docket source/header evidence, capture range, privacy denominators and collection grain. It contains no captions, descriptions, party/contact arrays, document locators or PDF contents. Three date-classification regression tests and three artifact reconciliation/privacy tests accompany the timeline.
