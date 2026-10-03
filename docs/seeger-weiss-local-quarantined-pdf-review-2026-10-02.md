# Supplied local PDF quarantine packet — October 2, 2026

The separate packet prepares the remaining **701 local source occurrences**, representing **591 distinct PDF SHA256 values**, for independent private-asset review. It preserves all original bundle files and the prior 51-occurrence packet. This preparation performed no HTTP requests, uploads, database writes, or deletions.

## Actual coverage and verification

| Measure | Observed count |
|---|---:|
| Frozen firm-query native docket IDs | 1,810 |
| Bundle manifest/CSV pairs inspected | 14 |
| Local file occurrences mapped to those exact firm-query parents | 752 |
| Exact prior source occurrences excluded | 51 |
| Remaining prepared occurrences | 701 |
| Distinct PDF SHA256 values | 591 |
| Distinct PDF body bytes | 236,643,456 |
| Occurrence bytes read and hashed | 282,759,417 |
| Blank local sealing claims | 689 |
| Local CSV `is_sealed=true` claims | 12 |
| Missing, contradictory, or invalid-body occurrences held | 0 |
| Original source artifacts referenced | 43 |
| Exact firm-query parent records independently reconstructable from original captures | 6 |

The 43 source artifacts comprise the three frozen input files, 28 original manifest/CSV files, and six original HTTP firm-search captures with their six original provenance files. The producer verifies each metadata file against its frozen hash, reads each selected PDF in full, checks `%PDF-` magic, computes SHA256/SHA1/byte length, and compares the body with the CSV SHA256/bytes and manifest bytes. It reconstructs each selected firm's exact search result from the original response bytes and checks its record hash and native docket ID.

CSV ordinals identify parsed CSV records, with the header counted as record 1; embedded newlines inside quoted fields do not change that ordinal. Manifest file and docket array ordinals are 1-based. Local verification timestamps describe file reads and do not assert a publisher retrieval date.

## Qualification and identity

Every source occurrence remains private and requires quarantine. All backend document/case identity fields are null; the explicit local manifest parent is retained only in source evidence. Its presence in the frozen firm query does not establish a publisher-native document relationship, current firm representation, or MDL membership.

The nullable reviewed locator is null for every occurrence. The original evidence preserves the literal blank locator so its insertion-order evidence hash can be reconstructed. The 12 sealing flags remain **local source claims**; no publisher sealing assertion is made. Blank fields remain unknown. Public projection, legal-outcome verification, and calculator activation are false.

There are 12 distinct locally flagged body hashes and no overlap between locally flagged and blank-claim body classes. None of the 591 new body hashes overlaps the prior packet's 49 distinct body hashes. Shared PDF bytes retain every source occurrence instead of merging docket identities.

| Source-claimed parent, matched only to the frozen firm query | Prepared occurrences |
|---|---:|
| 67721420 | 65 |
| 73387331 | 220 |
| 6261208 | 95 |
| 71949121 | 81 |
| 72371373 | 72 |
| 14533063 | 168 |

The original strict uploader caps bodies at 6 MiB. **Two distinct PDFs exceed that cap**; the largest is 12,838,263 bytes. This packet must use a separate reviewed local quarantine transport/asset scope. No transfer was performed by this producer, and preparation does not establish cloud verification.

## Frozen artifacts

Private directory: `C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/local-pdf-quarantine-v1/`.

| Artifact | SHA256 |
|---|---|
| `local-quarantined-pdf-occurrences-v1.jsonl` | `4b6caa7dd9aad890569a575a64339f2bd17f46ef5969f3dab962319527868cf3` |
| `source-artifact-manifest-v1.jsonl` | `d5c5d311c4a8e8cb148f7cd688e2f1cb6727ade25bd991b2f47a271e551cc13b` |
| `excluded-original-51-occurrences-v1.jsonl` | `591100a92e49608ccb4078a372723db18dc47b0bcd9893a3effdd4e2e8872897` |
| Empty hold ledger | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Unchanged original 51-occurrence packet | `974b72f7b7a4ec34ec9eeadcea4da9d470452eef2afb757f0d1982c6aedd22bf` |

The producer uses exclusive creation of its separate output directory and files. The original 51-occurrence packet was rehashed after preparation and remains byte-identical. The preparation receipt retains the complete frozen input hashes, counts, and zero-action counters. Independent cross-source review is required before any upload or asset intake; the graph specialist owns that separate contract review.

Producer: `scripts/ingest/prepare-local-bundle-quarantine-pdf-packet.py`.

## Isolated uploader review

`scripts/ingest/upload-local-bundle-pdfs.test.mjs` passed **71 offline fault-injection checks** against the actual uploader body with an in-memory filesystem and fetch substitute. Coverage includes pinned inputs and realpath boundaries, full readback checks, unknown POST outcomes, a single immutable recovery only after explicit missing-object evidence, conflicts/auth/rate/checksum stop paths, non-replayed short receipt writes, and draining already-started sibling work before stopped status. Additional checks cover explicit quarantine activation, immutable packet path/hash, nullable locators, local sealing consistency, null API identities, public-access rejection, and the separate 16 MiB cap while retaining the original 6 MiB limit. The tests make no live calls and perform no real transfers or credential reads.

A separate actual **no-execute** dry-run of the pinned quarantine packet also passed: 701 occurrences / 591 unique PDFs, zero uploads, and zero database writes. The strict quarantine branch remains limited to the exact frozen packet path, SHA256, schema, and row count. This preflight reads original local bodies but does not read administrative credentials or contact cloud services.
