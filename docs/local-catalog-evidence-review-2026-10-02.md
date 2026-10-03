# Local catalog evidence review — October 2, 2026

The supplied catalog and test catalog contain reusable metadata, with historical versions and derived relationships that need explicit qualification. The prepared packet contains 87,560 local source occurrences, 87,368 normalized payload versions, and 85,229 local entity identities. Preparation and original-source verification succeeded; this report does not certify database import or public publication.

The private import namespace is `local-sw-catalog`. Its identifiers belong to the local producer. None of these records replaces a current CourtListener entity, establishes current law, certifies a case outcome, or activates a calculator rule. No PDFs were read or downloaded.

| Prepared record type | Source occurrences | Qualification |
| --- | ---: | --- |
| Regulatory nodes | 40,203 | Local graph metadata; publisher payload and currency remain unverified |
| Regulatory relation claims | 32,718 | Preserve the producer's relation type; no inferred legal applicability |
| Statute coordinate references | 1,115 | Reference coordinates, without a verified current provision body |
| Statute citation extractions | 3,754 | Preserve `eyecite`, `regex`, or `both`; mentions do not establish applicability |
| Citation map edges | 2,803 | Local map claims from a documented June 30 snapshot |
| Master observations | 39 | Two local catalog versions; source claims about master records |
| Matter observations | 4,244 | Two snapshots of 2,122 local docket identifiers |
| Judge references | 343 | Local reference IDs and source-supplied FJC IDs; no person-name merge |
| Document locator observations | 1,487 | 1,295 distinct local document identities after ambiguity holds |
| Party appearance occurrences | 854 | File occurrences, without invented publisher party IDs |

## Original sources and verification

The read-only inventory hashed 109 metadata files totaling 53,038,749 bytes. Selected originals are retained privately by SHA-256: 79 files totaling 14,262,521 bytes. The archived directory contains scripts and a log rather than duplicate catalog metadata; none of its scripts was executed.

An independent verifier checked every selected original row against its retained file, file checksum, row ordinal, and original-row checksum. It separately verified the actual normalized payload hashes, integer-domain JSON compatibility, identity qualifiers, occurrence uniqueness, and graph pointers. All 87,560 source occurrences and 87,368 payload versions passed, with zero source or payload mismatches.

The original-row hash codec is recorded separately from the normalized payload codec. Normalized payloads use the private canonical integer JSON codec, which can be recomputed from stored JSONB. A local read timestamp is explicitly distinguished from an upstream HTTP retrieval.

The producer reports a June 30, 2026 citation-map snapshot, an August 12 regulatory/statute graph assembly, and August 7/August 19 catalog assemblies. These dates qualify local snapshots and producer claims; they do not prove upstream capture dates, current law, or complete current dockets.

## Cleanup findings

All 2,122 matter IDs overlap between the catalog and test catalog, but none has an identical original payload. Every source URL changed, and 78 matter-to-master mappings changed. Both original versions are retained. A changed local mapping is not silently treated as a verified MDL membership.

Sixteen master IDs overlap, with changed payloads for all 16. The main catalog adds one other ID and the test catalog adds six. Twenty-nine overlapping master observations matched the available current primary CourtListener headers after exact API-URI identity normalization, with no court, docket-number, or assigned-judge ID mismatch. Ten source observations fall outside that current header scope and remain unverified.

The document source files contain 1,670 occurrences. Their original local UID and payload hashes produce 1,456 versions, including 214 identical copies. Ambiguous identities are excluded from ordinary entity ingestion:

- 179 occurrences reuse a missing-ID sentinel.
- Four occurrences belong to two other local UIDs with contradictory source payloads.

The private quarantine ledger preserves all 183 original occurrences and their checksums. The remaining 1,487 occurrences represent 1,295 local identities and payload versions, retaining 192 repeated source occurrences. Document availability is a local snapshot flag; it does not prove a PDF is currently accessible. The packet retains permitted locators without fetching document bytes.

The party files contain 854 appearances without publisher party IDs. The packet represents their source-file occurrences and attorney reference IDs, rather than manufacturing person identities from names. Captions, document descriptions, contact details, party names, and judge biographical/disclosure fields are omitted from selected envelopes; the complete original metadata files remain privately retained.

## Relationship grain

The prepared graph contains 69,190 exact source-version pointers from local edge/extraction records to their declared local node records. These are record pointers, distinct from native CourtListener foreign keys or verified legal relevance.

All pointer endpoints resolve within the selected local files. The 138 statute extraction pointers to 74 IDs absent from the statute-node CSV resolve by exact identifier to the companion regulatory-node CSV, as documented by the local producer. No nodes or matches were fabricated.

Regulatory relation claims and statute/citation extractions retain their methods and qualifications in their payloads. The citation map's `depth` is preserved as `source_depth`; the packet does not assume it means graph hops, legal treatment, precedential weight, or causation.

## Private ingestion controls

The draft contract leaves the existing HTTP-only ingestion contract unchanged. Registered local artifacts and their source occurrences have separate private tables, with explicit approved original path families, source hashes, original row hashes, and row ordinals. Public roles receive no access.

The catalog wrapper verifies normalized payload hashes in SQL and requires the local namespace and `publisher_native_entity=false`. Newer local snapshots win; identical snapshot/read timestamps use the lexicographically smaller payload hash. A second independent implementation matched all 85,229 expected winners, and tests demonstrate the winner is independent of batch order. Existing quarantine review status is preserved.

The frozen catalog import includes 222 entity batches, 81 exact-pointer batches, a 183-occurrence quarantine ledger, and an independent reconciliation query. Byte lengths and SHA-256 hashes are pinned in the private manifest. SQL and PL/pgSQL parsing passed; 12 local contract tests cover cross-root paths, traversal, unregistered artifacts, codecs, ordinals, false legal/publication gates, actual payload drift, and deterministic version selection.

Separate bounded extensions support the reviewed Vaquill state-law packet and local source registry. Their secondary law, form, outcome, freshness, and publication claims remain explicitly unverified. The registry's frozen original packet is preserved while one credential-bearing locator and two oversized source occurrences receive separate handling. The reviewed ordinary registry packet contains 33,927 source occurrences, 33,448 payload versions and 33,297 local identities from 15 original files. A private reference ledger retains the three holds without transporting their original bodies. Those packets do not activate legal calculator formulas or public record projections.
