# Local state-law source review, October 2, 2026

The supplied `SW-BULK/corpus/statutes/vaquill` directory contains useful historical law captures. The review prepared **770 private evidence occurrences from 92 original Parquet files in 47 jurisdictions**. Each occurrence was compared independently with its original row. These records are secondary local captures: they do not establish current operative law, close the five primary-law research gaps, or activate a deadline-calculator rule.

The prepared intake has **not been applied to Supabase**. Its proposed run is `88099af1-b02a-49c2-8c77-a21013f5bcae`; the private local-file contract needs a bounded statute-source extension before intake. No PDF bytes, network requests, database writes, or calculator changes were made in this review.

## Complete file inventory

| Local release label | Parquet files | Footer row count | Supplied manifest validation |
| --- | ---: | ---: | --- |
| `v2026.07` | 105 | 2,046,009 | All 105 match the supplied index's SHA-256 and byte length |
| `v2026.08` | 229 | 2,978,617 | No August entries in the supplied index |
| Both releases | 334 | 5,024,626 | Every original file independently inventoried and fully hashed |

The originals total **5,295,380,083 bytes**. Both releases use the same 24-column Arrow schema. The complete inventory includes 104 statute files, 104 constitution files, 44 court-rule files, 50 guidance files, 17 regulation files, and 15 files of other types. These counts include federal and other jurisdiction files and both release labels; the row count is **not a count of unique statutes**.

Only state/DC/territory statute and constitution metadata was scanned for this task: **3,947,027 rows**. Of those, 3,301,324 contain a syntactically valid HTTP(S) `source_url`, while **645,703 do not**. A populated URL is a source-provided locator, not evidence that its current contents were retrieved or verified.

The supplied `index.json` describes `open-us-law`, release `v2026.07`, a **claimed** snapshot date of July 21, 2026, and a claimed CC-BY-4.0 data license. Its dataset reference is `https://huggingface.co/datasets/vaquill/open-us-law`. The reviewed index SHA-256 is `58858b9615d2b2aaf0b04cc8560f305a793dc9acc8cfc461678858916856473b`. August's directory label and filesystem timestamps are retained without treating either as an effective date or a remote retrieval date.

**August statute files for Georgia and North Carolina are absent.** July contains both. A blanket preference for the August folder would therefore lose coverage.

## Prepared limitations evidence

Selection retained at most eight limitation-related subject-heading candidates per statute file, plus exact source section/citation matches for identified research provisions in Arkansas, Georgia, Kentucky, Mississippi and Tennessee. The broad heading/section scan identified 3,807 candidates before the Mississippi citation-format correction; the prepared slice is bounded and does not claim complete limitations-law coverage.

| Prepared slice | Count |
| --- | ---: |
| Original Parquet row occurrences | 770 |
| July / August occurrences | 392 / 378 |
| Source files / jurisdictions represented | 92 / 47 |
| Distinct source-dataset `act_id` values | 675 |
| Source-provided record HTTP locators | 650 |
| Verified July manifest distribution HTTP locators | 392 |
| Occurrences with neither HTTP locator | 45 |
| Current-law or calculator rules activated | 0 |

The two HTTP-locator columns overlap and must not be added together. All 770 envelopes use the actual **local file URI, full-file SHA-256 and one-based original row ordinal** as acquisition provenance. Optional record and distribution URLs remain locator metadata. `observed_at` means this local read; `original_http_retrieval_at`, original HTTP status and legal effective date remain null.

Mississippi's source `section_number` omits the title prefix: for example, `1-49` accompanies the literal citation `Miss. Code Ann. § 15-1-49`. Exact citation selection recovered 18 Mississippi occurrences. Exact source-section/citation selections across the five primary-law gap jurisdictions comprise 12 Arkansas, 6 Georgia, 10 Kentucky, 18 Mississippi and 12 Tennessee occurrences. These counts describe local source occurrences, not new verified legal rules.

## Identity, deduplication and version findings

Source `act_id` values are generated dataset identifiers. They are not government-assigned native IDs, and they must not be used as equivalent identifiers for authoritative law. Local evidence identities are hashes of the original file URI, original file hash and row ordinal; the original `act_id`, citation, text and hierarchy fields remain unchanged inside `source_record`.

In the selected slice, Mississippi's literal citation `Miss. Code Ann. § 11-7-13` appears **four times in each release**, under distinct generated IDs, with identical text hashes. This is two repeated-citation groups and eight preserved occurrences. The repeated text provides cleanup evidence, but the different source hierarchy fields remain available; no original row was deleted or silently merged.

The selected slice has 95 source-dataset identities present in both releases: 66 have unchanged complete payloads and 29 have changed payloads. Different generated IDs can also describe the same literal citation, so this comparison is not a complete legal revision history. It does not determine whether an amendment is operative.

Independent verification found **13 selected rows with an identical long extracted paragraph repeated within their text**. Original text was preserved. The extracted bodies require comparison with an authoritative rendition before being used as clean operative statutory text. Source status claims such as `in_force`, `repealed` and `reserved` are retained as claims, not promoted to reviewed legal status.

No relationships to existing primary-law rules, federal authorities, cases or calculator rules were invented. JSON-string fields for breadcrumbs and cross-references remain source material; they do not independently establish binding authority, applicability or legal treatment.

## Verification and handoff

The final slice was independently compared with **770 of 770 original rows**, and **92 original source files were rehashed**. Payload, identity, row ordinal, file URI, file hash, source locator and supplied July manifest checks found zero mismatches. The integer-domain canonical JSON codec rejected no selected rows; fractional values, unsafe integers, NUL strings, unpaired surrogates and unsupported field-name domains would be held.

Private artifacts are under `statute-versions-20261002/reviewed-v2` in the local corpus cache. The preceding 752-row selection and its receipt remain preserved separately.

| Private artifact | SHA-256 |
| --- | --- |
| Final original-row slice, 3,284,686 bytes | `0e4357fa0269f38fa67ceb8a99e9953ec4a5065a86943dcbfb52535c5bd63ed2` |
| Private local evidence envelopes, 3,946,161 bytes | `b7c06ff6fd0b628051ba215e50bb5c908b2f1eb0ad420ecbd1ef0c11aa214bb3` |
| Selected source artifact manifest, 48,302 bytes | `4a13c4dfa415fe0ed56f0211e5f59f0034bfa0b1dea56f75437407147f62496b` |
| Complete 334-file inventory | `d3bf5b579fe9167f0c73577614466b96b885f9eccc2d12b4fe0ce982dd5ceeda` |

Nine prepared private intake SQL batches carry independent byte-length and SHA-256 pins in `private-intake-proposal.json`. The required source namespace is `local-vaquill-open-us-law`, schema `local-vaquill-state-evidence/1`, and function `corpus_ingest.ingest_local_statute_entities_v1`. The bounded original-file scope is the two reviewed version directories and state statute Parquet files. All envelope gates remain explicit: `publisher_native_entity=false`, `current_law_verified=false`, `public_projection_allowed=false`, and `calculation_activation_allowed=false`.

The release owner can retain these local occurrences for research and reconciliation after reviewing the contract extension and intake receipts. Current publisher law, amendment applicability, tolling exceptions and court-calendar adjustments still require their own primary-source review.
