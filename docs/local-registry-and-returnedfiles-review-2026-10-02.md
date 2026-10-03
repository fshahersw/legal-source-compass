# Local registry and returned-files review — 2026-10-02

This review inspected the thirteen additional directories supplied by the user, the SW-BULK registry JSONL/SQLite pair, the staging manifest, and the canonical asset ledger. It prepared a bounded private metadata packet and a separate reviewed v3 intake packet with explicit holds. It did not import database rows, publish records, fetch new source pages, read PDF bodies, or execute scripts supplied in those directories.

Local file verification proves the inspected bytes and record transformations. It does not establish that an old source label, legal proposition, judge assignment, form, case outcome, or upload-status claim remains correct today.

## Prepared packet and provenance

Private cache: `C:/Users/firas/.codex/corpus-cache/local-source-review/staging-registry-20261002`.

| Artifact | Purpose |
| --- | --- |
| `inspection.json` | File inventory, structured-file schemas/counts/hashes, read-only SQLite schemas and table counts |
| `analysis.json` | Duplicate, mirror, locator, evidence, coverage and source-qualification findings |
| `ordinary-safe-candidates-v3.jsonl` | Current ordinary private intake: 33,927 reviewed occurrences |
| `candidate-manifest-v3.json` | Reviewed partitions, source artifacts, exact hashes/counts/schema/normalizer |
| `held-reviewed-candidates-v3.jsonl` | Three held envelopes; credential URLs redacted, oversized records retained intact |
| `held-occurrence-ledger-v3.json` | Hold reasons and traceable source/row/payload hashes without credential values |
| `independent-verification-v3.json` | Independent original-source, intentional-redaction and shared Node codec checks |
| `source-qualified-candidates-v2.jsonl` | Frozen original evidence, retained locally; superseded for database intake |
| `candidate-manifest-v2.json` | Frozen original packet hash, source artifacts and counts |
| `independent-verification-v2.json` | Original reconstruction checks; credential scan superseded by recursive v3 scan |

### Reviewed v3 ordinary intake and holds

Reviewed v3 contains **33,927 ordinary-safe source occurrences → 33,297 local candidate identities / 33,448 payload versions**. It separately holds three original occurrences: one credential-parameter locator and two oversized records. The original 33,930 occurrences reconcile exactly to these partitions.

Ordinary packet: 136,985,764 bytes; SHA-256 `7f5b736aafe6a5eef5f3f61fb342f403243d8073bf2048db359f7885e7cec990`. Manifest SHA-256: `1268a8263a3db7182d29efbac3357de85f8071542cbaa3ae29cd338e718c1a4f`. Independent verification receipt SHA-256: `a260026c2a3c1ce851e30c2376acffb8edbf2660d23f9c7bdd2c3008b653dc13`.

Current envelope schema: `local-source-registry-evidence/2`; normalizer: `local-source-registry-reviewed/3`, pinned in both data and provenance. Every envelope additionally carries `public_projection_allowed=false` and `calculation_activation_allowed=false`. Every ordinary envelope has `credential_locator_held=false`, no intentional source-record redaction and an unchanged parsed original record.

A recursive URL scan that includes blank credential parameters found one original registry occurrence with a credential-parameter URL repeated in three envelope fields. All three URL representations were replaced with safe origin/path strings in its **held** reviewed envelope. Original URL SHA-256 values and raw source-file/row hashes remain traceable. Query values are not emitted in the reviewed packet, ledger, logs or report. The original v2 bytes remain unchanged in private local evidence. The earlier v2 locator check omitted blank query parameters; its zero count must not be interpreted as a complete credential scan.

Two county-access envelopes exceeded 750,000 bytes: original source ordinals 177 and 221, at 789,562 and 1,357,740 original v2 envelope bytes. Both remain intact outside ordinary transport. The largest ordinary reviewed envelope is 683,246 bytes; the batch generator must still enforce its actual SQL byte limit after quoting and framing.

All fifteen original source artifacts and all 33,930 original occurrences were independently re-read. The unchanged ordinary records, intentional credential redaction, retained raw hashes, derived payload hashes, complete partition counts and shared Node integer codec passed. A separate recursive Node URL scan found zero remaining credential-parameter URLs in either reviewed partition. Database intake remains pending a matching ordinary-only private wrapper and root execution; held envelopes must not enter that ordinary importer.

### Frozen v2 original evidence

The frozen original v2 packet contains **33,930 original occurrences, 33,300 local candidate identities, and 33,451 local payload versions**. Every original occurrence remains traceable; 630 repeated local identities are consolidated without discarding source versions. These are the original evidence counts; current ordinary intake excludes the three reviewed holds described above.

| Candidate type | Original occurrences |
| --- | ---: |
| Registry source locators | 9,348 |
| Court form locators | 6,831 |
| Curated MDL/statute/regulation/source locators | 14,065 |
| County court/access locators | 374 |
| Outcome research leads | 3,312 |
| **Total** | **33,930** |

Packet bytes: **126,277,190**. SHA-256: `b548adf41cdc9b0adfe8486686e4391c994903a3693306ddddf8ef8a221c2248`.

Namespace: `local-source-registry`; envelope schema: `local-source-registry-evidence/1`. The `native_id` transport field identifies a local candidate, never a publisher-native case, judge, docket, or authority. Identity is based on an original local registry ID, exact form URL, county registry ID, or reported outcome lead key. All envelopes explicitly retain `publisher_native_entity=false`, `fresh_http_verification=false`, `legal_authority_or_outcome_verified=false`, `public_projection_eligible=false`, and `binary_checksum_independently_verified=false`.

Each envelope retains the original parsed record, original source-file URI/SHA/byte count/record ordinal, original-row SHA, local observation time, and actual locator when supplied. Source verification/retrieval dates remain claims; absent dates and locators are null. In the bounded packet, 15,943 occurrences lack a usable date claim, 5,557 lack a jurisdiction claim, 382 lack a normalized label claim, and 254 lack a direct source locator. No values were fabricated to fill those gaps.

The original-row codec hashes exact binary JSONL lines, including their original terminator/BOM when present. CSV original rows use parsed string/null fields, sorted ASCII keys, compact UTF-8 JSON. Envelope payloads use `canonical-integer-jsonb/1`, checked independently with the existing shared Node helper. All 15 original artifact hashes/counts, all 33,930 row reconstructions/original hashes, and all envelope hashes passed. There were zero source/hash/occurrence mismatches. The complete credential assessment is the recursive reviewed v3 assessment above.

The largest original envelope is **1,357,740 bytes**. Reviewed v3 explicitly holds both oversized occurrences. No database migration or import was executed by this review. The existing catalog-only private importer is not a schema match for this namespace without a separate bounded wrapper.

## Additional directory inventory

All thirteen newly supplied directories exist. Together they contain 17,202 files and 3,438,300,341 bytes. This inventory counts files and bytes, not legal cases or verified authorities. Binary files were listed/stat'ed without opening their contents.

| Directory | Files | What is actually present |
| --- | ---: | --- |
| `returnedfiles/settlementsverdicts` | 7 | Lead-index JSON/Markdown and five CSV exports |
| `returnedfiles/uscourtswidecrawl/01a02a3f-9e63-7248-b636-45668815a0e3` | 10,006 | JSON captures whose source domain is entirely `www.justice.gov` |
| `returnedfiles/court_access_registry_2026-08-21` | 181 | Kentucky/Texas county registry, evidence manifests and stored evidence |
| `courtformsTHREE` | 448 | Source/gap indexes and Word forms/documents |
| `SW-Source-Registry-CLEAN` | 83 | 38 category JSONL files, 41 CSV files and supporting files |
| `Court-Expansion-States-Part-TWO` | 871 | Source/gap indexes and primarily PDF forms/documents |
| `Court-Expansion-States-Part-THREE` | 903 | Source/gap indexes and PDF/Word forms/documents |
| `Court-Expansion-Federal-Part-TWO` | 733 | Source/gap indexes and PDF/Word/archive locators |
| `Court-Expansion-States-Part-ONE` | 1,355 | Source/gap indexes and primarily PDF forms/documents |
| `courtformsfederalONE` | 1,225 | Source/gap indexes and PDF/Word forms/documents |
| `courtformsTWO` | 1,388 | Nested forms manifest and document files |
| `Seeger_Weiss_Enriched_Sou` | 1 | Enriched source-registry JSON |
| `Seeger_Weiss_Enriched_Source_Registry_v4` | 1 | A byte-identical copy of that enriched source-registry JSON |

The two enriched v4 files each contain 245,708,410 bytes and share SHA-256 `23f68d93019bba7f6283312658bd0454f4aa4b5b86b6b20bd7c9c3d4f2835fb5`. Each has 317,579 `records` and 434,190 `observations`, with 14 inputs, 18 source profiles and 21 unresolved inputs/URLs. Those are one source snapshot with two local copies, not two independent collections. These large snapshots were audited, not duplicated into the bounded packet.

## Registry and category reconciliation

`SW-BULK/registry_v06_1.jsonl` and the read-only `registry_v06_1.sqlite` table both contain 9,348 records and match as a complete full-field row multiset. Each has 9,348 distinct local IDs and nonempty URLs. Local registry labels, hierarchy, crawl policies, access descriptions and claimed verification dates are source data; none was treated as an instruction or a new verification.

`SW-Source-Registry-CLEAN` contains 352,294 JSONL occurrences across its 38 category exports, 352,153 distinct local record IDs and 351,527 distinct URL strings. The 141 repeated local IDs include the curated priority overlay, so counting that overlay again would inflate the underlying collection. The bounded packet includes the 141 priority rows plus the MDL/matter hubs (808), MDL document locators (3,410), statute/code/legislation locators (1,783), and federal regulation/rulemaking locators (7,923).

The CSV mirrors have 352,297 occurrences. The sole identity/URL/label difference is three federal appellate CSV-only rows pointing to internal Judiciary `.dcn` addresses: two JNET locators and one `ca6-admin.jdc.ao.dcn` locator. They were not fetched or represented as public routes. The JSONL mirrors and those restricted-network differences remain distinct source versions.

The supposed `uscourtswidecrawl` collection is **10,006 Justice Department captures**, not 10,006 court-site captures. Its metadata claims 9,995 HTTP 200 responses and eleven 403 responses. No response was freshly revalidated. Court/jurisdiction coverage cannot be inferred from the directory name; archived DOJ blog and agency pages must retain their actual source type and dates.

## Forms and county court/access evidence

The seven forms manifests contain 6,831 occurrences, 6,236 distinct nonempty source URLs and 6,231 distinct **claimed** binary checksums. All 6,831 referenced local files exist and their sizes match the manifest. No PDF/document/archive body was read and no binary checksum was independently recomputed. Manifest claims such as “PDF parsed”, “Word package/XML checked” and “ZIP CRC checked” remain historical claims. They do not prove the current court-approved version or applicability.

Six copies of `UNAVAILABLE-AND-GAPS.csv` contain 1,164 occurrences but only 194 distinct full-field gap rows. Those mirrors should be consolidated rather than treated as six separate failed source inventories.

The county-access registry contains 374 records: 120 Kentucky and 254 Texas. Its combined registry exactly matches the two state JSONL mirrors. The 168-row evidence manifest has 164 claimed fetched records, one not-persisted record and three absent records. Independently recomputed hashes match **158 nonbinary text/JSON/HTML/robots evidence files**; nine binary evidence locators were deliberately not body-verified and one locator is missing. No existing evidence hash mismatch was found. Court personnel and access descriptions remain dated source assertions pending current official verification; they are not automatically merged into current judge identities or assignments.

## Outcome research leads

`vli_records.csv` contains 3,312 distinct exact rows and reported case/year/result-type/amount keys: 1,755 reported verdicts and 1,557 reported settlements, all linked to `topverdict.com`. It has **287 distinct list URLs**; the accompanying report's claimed 289 lists is not the observed CSV count. The separate mass-tort lead CSV has 670 rows.

These rows do not contain publisher-native docket IDs and this review confirmed no primary judgments. Reported amounts, result types, attorney/firm associations and mass-tort tags are retained as research leads. No amount is eligible for verified outcome statistics. Ranked attorney-submitted lists do not support population medians, likelihoods, correlations, settlement valuation or a current-final-judgment assertion. Primary docket/judgment links, decision dates, amended awards and appeal/post-trial disposition are required before activating any outcome metric.

## Read-only asset and staging databases

| Database/table | Observed rows | Grain and limitation |
| --- | ---: | --- |
| Staging `loose_files` | 630,893 | Stored file/status assertions; overlaps other inventory tables |
| Staging `all_files` | 56,398 | Stored file/status assertions |
| Staging `files` | 36,870 | Layer/packing/object-key metadata |
| Staging `plan` | 242,226 | Planned layer/chunk/file references |
| Staging `archives` | 11 | Historical archive metadata |
| Canonical `asset_occurrence` | 882,816 | Asset occurrences, not unique legal records |
| Canonical `content_blob` | 669,439 | Claimed content identities, not confirmed current assets |
| Canonical `asset_evidence_observation` | 938,313 | Evidence observations, mostly historical claims |
| Canonical `asset_review_item` | 631,184 | Open review items |
| Canonical `asset_occurrence_edge` | 0 | No asset relationship edges in this ledger |
| Canonical `asset_release_binding` | 0 | No release bindings in this ledger |

The ledger marks 723,753 occurrences historical, 158,690 provisional, 368 failed and just five `verified_present`. Its evidence statuses are 779,299 claimed, 158,641 provisional, 368 failed and five verified. All 631,184 review items are open; 631,176 concern missing local crosswalk assets. These counts must not be promoted into current verified legal corpus counts. Staging status strings such as `verified` are retained assertions, not fresh remote upload verification. No purchase/billing database was opened.

The read-only main database files remained unchanged by size/mtime during the inspection. Main-file SHA-256 values are pinned in `inspection.json`, including the staging manifest's existing zero-length WAL and SHM metadata. The actual canonical ledger inspected is the 4,449,615,872-byte run database; the separate interrupted-evidence copy was not substituted for it.

## Remaining activation gates

The prepared data is suitable for a separate private local-evidence intake, source reconciliation and targeted refresh queues. It is not a public authority/outcome dataset or an activated limitations-rule source. Root must apply an exact namespace/URI/artifact-qualified private contract before ingest, handle large envelopes, and verify persisted versions/observations independently. Source taxonomy claims should be reviewed against actual content and jurisdiction before any category or relationship enters a public view. Refresh official sources before treating forms, personnel, court access routes, legal rules, docket status or outcomes as current.
