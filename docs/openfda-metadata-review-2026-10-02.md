# FDA metadata review — October 2, 2026

This review prepares administrative import and publication contracts. It performs no database writes and does not assert publication. The original ZIP downloads, source field references, prior attempts and selected-source evidence remain private and immutable. Original acquisition and publication are separate states.

| Official dataset | Publisher export | Original rows | Identifiable private rows | Public-eligible rows | Held original rows |
| --- | --- | ---: | ---: | ---: | ---: |
| Device enforcement | 2026-09-28 | 40,057 | 40,056 | 40,056 | 1 |
| Drug enforcement | 2026-09-28 | 17,988 | 17,986 | 17,986 | 2 |
| Device classification | 2026-10-02 | 7,094 | 7,094 | 7,094 | 0 |
| Device recall | 2026-10-02 | 59,344 | 59,344 | 59,336 | 8 |
| Total | Separate dated exports | 124,483 | 124,480 | 124,472 | 11 |

Official field YAML documents `recall_number`, classification `product_code`, and recall `cfres_id` identities. The recall `product_res_number` field has no official description in the captured field reference; it is not promoted to a documented cfRes identity. Eight rows without `cfres_id` retain literal alternate source references privately and remain held. Three enforcement rows have blank or `N/A` recall tracking designations, retain ZIP/member/row provenance outside native entity intake, and have no invented ID.

The public source-quality receipt is `public/data/quality/openfda-source-review-2026-10-02.json`. It contains only reviewed aggregate counts, original URLs/checksums, schema evidence and public field names. Publication count is `null` until independently recorded. No PDF bytes, adverse-event patient data or party-name litigation joins are included.

## Source and schema boundaries

The selected private schema is `openfda-selected-native-metadata/1`. It retains native field values, explicit field presence, nulls, source identity field, selected-payload SHA, original ZIP SHA, source member/row ordinal and a canonical native top-level digest excluding the repeated harmonized `openfda` annotations. Originals retain every omitted value. Selected private imports omit firm/contact/address fields and large repeated UDI annotations. Public projection additionally omits free-form recall descriptions, reason/action text, lot codes, definition text and native application-number arrays.

Official [FDA enforcement documentation](https://open.fda.gov/apis/device/enforcement/) warns that enforcement status is not a current recall-lifecycle or public-health-alert indicator. Source cause labels are FDA-reported general categories, potentially editable until termination; the 43 observed non-null labels are not an exhaustive validated enum or independent causation findings. A source device name containing “Fax” was independently reviewed against its original product-category row; it is a device name, not a contact address or number.

Recall hazard classes I/II/III and device regulatory classes 1/2/3 have separate field labels and count grains. Category records are category codes, not individual device counts. Recall/enforcement records are native report records, not unique products, affected people, defects, liabilities or cases. Source export and event dates are not legal effective dates.

## Prepared artifacts and execution order

Private cache base: `C:/Users/firas/.codex/corpus-cache/openfda/2026-10-02T113000Z`.

1. `selected-native-v1c/normalized-receipt.json` is the final selected-source receipt. Earlier `selected-native-v1` and `selected-native-v1b` are preserved superseded attempts.
2. `import-selected-v1c/manifest.json` pins 124,480 envelopes in 197 SQL batches, 128,433,599 UTF-8 SQL bytes. Each batch is at most 750,000 bytes and reconstructs exact native selected values/provenance. Earlier `import-selected-v1` is superseded.
3. `native-code-graph-v1b` prepares 58,985 exact same-provider device-recall `product_code` references: 58,057 targets in the October 2 classification snapshot, 928 unresolved. Its guards pin both native source signatures, verify canonical selected payloads and retain unresolved targets. No cross-provider eCFR edges or dummy FDA entities are inserted.
4. `public-projection-v1/3595077188e031da5923872ea31cd066d6fdac3e045942e3f921cab5726bdbbf` prepares four new dated datasets, 52 bounded 2,500-record project/verify pairs, held registration and separate publication gates. It pins implementation/helper bytes, immutable selected-source identity, original observation columns and complete canonical provenance. All 12 public fields, current entity payloads, row signatures, contiguous ranges, native grains and exact registered dataset metadata must reconcile before ready can become true.
5. Publish the device-classification snapshot before projecting/verifying the recall snapshot if category-code links are wanted. Exact ready eCFR Title 21 section headings may provide reference locators; the eCFR September 30 snapshot must already be verified and ready. Absence or ambiguity leaves the link absent. The classification field documentation explicitly defines `regulation_number` as Title 21 CFR; no title is guessed. These are dated locator matches, not historical or current applicability findings.
6. `database/contracts/category-crosswalk-fda-20261002-v4.sql` adds exact category mappings. Existing category audit evidence remains unchanged. FDA dated collections remain in Safety; `mass_tort_authority_evidence` is reachable in Law → Reference tools with a heterogeneous source-evidence grain.

The original source URLs and field YAML hashes are in the public receipt. FDA API links are explicitly constructed native-ID queries, not individually retrieved source observations.

## Offline verification

An independent agent compared every one of the 124,483 original ZIP rows with the selected-source envelopes, native digests, field presence and provenance: zero mismatches. Both this agent and the independent reviewer decoded all 197 SQL batches against all 124,480 selected original envelopes and canonical hashes: zero mismatches. The complete selected-envelope domain has no duplicate keys, NUL or unpaired-surrogate strings, floats/nonfinite values, or unsafe integers; this bounded proof does not describe omitted raw annotation arrays.

Private evidence includes `independent-source-review-v2.json`, `independent-codec-domain-review.json` and `transport-independent-review.json`. Final `independent-projection-provenance-review.json` independently recomputes full provenance, payload and observation signatures for all 124,472 eligible rows and every bounded slice, with exact manifest/artifact checksum agreement. All 112 public SQL artifacts, both native graph SQL files and the additive category SQL parse with an offline PostgreSQL parser. Five focused native-identity/privacy/type tests and 22 focused category/domain/route tests pass; the direct TypeScript compiler passes. Database execution, live reconciliation, actual ready status and release remain separate root-owned steps.
