# CourtListener reference publication — October 2, 2026

Seven new, dated reference collections were projected from the private September 30, 2026 CourtListener bulk snapshots. Existing corpus datasets were not rewritten.

| Collection | Native grain | Published records |
|---|---|---:|
| cl_courts | Court source records | 3,359 |
| cl_courthouses | Courthouse source records | 3,361 |
| cl_court_appeals_to | Explicit recorded appeal relationships | 8 |
| cl_people | People and explicit source aliases | 16,191 |
| cl_positions | Positions and employment records | 51,291 |
| cl_educations | Education records | 12,777 |
| cl_schools | Schools and explicit aliases | 6,011 |
| Total | Mixed native metadata grains | 92,998 |

The total is a metadata-record count. It is not a unique-judge census, a current-court census, or a measure of legal coverage. Historical and inactive real courts remain. The reference snapshot does not establish current legal applicability.

## Reversible cleanup

Exactly two court native IDs, `psc` and `test`, have source jurisdiction `T` and testing/training identities. Each complete original entity row, source payload hash, provenance, prior review status, and proposed replacement is retained in private `corpus_ingest.cleanup_decisions` under issue `explicit_source_testing_court`. Only their review status changed to quarantined. Their raw entity versions and observations were retained.

There were zero courthouse, position, or appeal relationships pointing to either testing ID; no dependent exclusions were needed. This decision does not classify inactive or historical real courts as garbage.

Restoration must be an administrative review of the stored original. Restore its review status only when the current native payload hash still matches the decision's original; do not blindly overwrite a later source version.

## Execution and publication checks

The former whole-93,000-row insert exceeded the connector query timeout and rolled back. The contract now separates registration/quarantine, bounded projection, and publication:

- `database/contracts/project-reference-metadata-v1.sql`: private cleanup evidence and seven dataset registrations.
- `database/contracts/project-reference-metadata-v1-batch.sql`: one native entity type and at most 2,000 ordinal rows per transaction. Ordinals are computed over the entire eligible snapshot before selecting each range.
- `database/contracts/project-reference-metadata-v1-publish.sql`: per-dataset reconciliation before setting ready=true.

Each published collection passed exact source/private/public count agreement, contiguous unique ordinals, nonempty titles, HTTP(S) source URLs, explicit qualification, and matching deterministic SHA-256 signatures. Signatures include the native ID, canonical native JSON, native payload SHA-256, schema version, source URL, source date, and retrieval timestamp. Publication validation hashes and dates are stored in dataset metadata.

Source-native foreign-key observations resolve against the private reference snapshot, including 394 person aliases and 2,378 school aliases. Positions' `appointer_id` references positions; no name-based or inferred join was created by projection.

Native source codes, empty fields, historical dates, explicit aliases, and original payloads remain preserved. Political affiliations, races, and race choices remain private outside these seven public reference collections. No party/contact/caption or new live docket payload is published by this contract. No PDF bytes were downloaded.

The connector request quota is shared by workers. A temporary throttle interrupted the initial sequence; successful batches were checkpointed, calls paused for more than 60 seconds, then paced below ten requests per minute. The database upgrade does not remove the connector quota.

Machine-readable projection, batch, and SHA-256 receipts are in `public/data/quality/courtlistener-reference-projection-2026-10-02.json`.
