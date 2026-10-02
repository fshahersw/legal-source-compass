# Docket metadata and native relationships — October 2, 2026

The original September 30 CourtListener docket snapshot contains 187,900 selected native docket envelopes. Every source payload, version, original record hash, source-file hash and retrieval observation remains private and unchanged.

Offline selection reconciliation found 186,944 records selected by an exact saved native docket ID or a native FJC foreign key with an explicit positive MDL number. Of those, 21 are blocked or date-blocked in the native snapshot, leaving 186,923 before newer canonical API blocking and quarantined court checks. Another 956 records have only candidate/status selection evidence and are excluded from the public projection. Across all 187,900 records, 31 are blocked or date-blocked.

All 354,027 imported, selected FJC records have a positive numeric `multidistrict_litigation_docket_number`. This describes the selected normalized input, not the unselected full national FJC file. Leading zeros remain in `mdl_number_raw`; `mdl_number` removes only leading zeros for exact numeric filtering.

## Public staging and publication

Prepared contracts, to be executed only by the authorized administrative import:

1. `database/contracts/project-docket-metadata-v1-registration.sql` registers only `cl_docket_metadata`, explicitly setting `ready=false` and resetting validation.
2. `project-docket-metadata-v1-batch.sql` writes at most 10,000 ordinal rows at a time. Compute ordinals over the complete eligible collection; change only the two batch bounds.
3. `project-docket-metadata-v1-verify.sql` independently compares every persisted public field, complete item/detail JSON, source and payload hashes, category, ordinal, source URL, and exact whitelist text.
4. `project-docket-metadata-v1-publish.sql` repeats the full exact comparison and verifies counts and contiguous unique ordinals. A failed comparison keeps `ready=false`.

The public whitelist contains native docket number/ID, native court ID, recorded filing/termination/modification dates, native FJC record ID and the source-recorded FJC MDL number, plus explicit retrieval provenance. Title and search text are built exclusively from that whitelist. Full conflict updates clear any formerly unsafe title, text, item, detail, filter or geography fields. State is null because court geography does not establish governing case jurisdiction.

Selection evidence is pinned to the September 30 bulk version and observation. A newer canonical native API version can supply safe current metadata without replacing the cited historical selection evidence. Both snapshot and current block/date-block flags are checked. Quarantined source courts are excluded.

No captions, human names, contact data, parties, causes, outcomes or document contents are published. No PDFs were downloaded. The dataset's `mdl_number` and `court_id` filters permit exact navigation; its label is **FJC MDL number**, never verified membership.

## Private native graph

`database/contracts/native-bulk-docket-relationships-v1.sql` records native foreign keys from the exact bulk version: court, appeal-from court, assigned/referred person, FJC record, originating court information and criminal parent docket. Every edge cites the source payload SHA; missing target IDs remain explicitly unresolved.

A criminal `parent_docket_id` is not MDL membership. A raw FJC MDL number is retained as a source field, not converted into a fabricated JPML entity or transfer determination. Counts are versioned native field observations, not a current member-case census.

All 19 bounded transactions are complete: 187,900 source versions produced 706,328 field edges, with 662 unresolved native FJC targets and zero unparsed references. Exact target-presence refresh resolved 3,097 older links (1,390 cluster-to-docket and 1,707 party-to-docket observations); a second pass changed zero. Independent reconciliation found zero target-presence mismatches across the run's 994,493 native relationships.

Final batch receipts and unresolved counts are recorded in `public/data/quality/courtlistener-bulk-docket-graph-2026-10-02.json`; the public projection is separately staged and published by root after verification.
