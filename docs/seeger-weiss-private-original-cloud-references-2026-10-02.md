# Seeger Weiss private original metadata cloud references

The initial reviewed snapshot links **1,511 original metadata capture files** to **1,511 private content-addressed cloud objects**, totaling **153,270,434 bytes**. The original uploader verified every object by a complete authenticated readback, SHA-256 and byte count. The reference mapper independently rehashed every original local file and reconstructed the exact plan/receipt links. It made no new cloud reads, API downloads or database writes. The recent append below preserves this snapshot and its original files unchanged.

| Provider | Original capture files with verified cloud references |
| --- | ---: |
| CourtListener | 813 |
| DocketBird | 675 |
| Firecrawl | 23 |
| Total | 1,511 |

These are captured response files. They are not counts of cases, judges, courts, court-native relationships or PDFs. The stored originals include earlier CourtListener passes as well as the current reviewed Seeger Weiss captures; inclusion in private original storage does not independently establish firm participation for every record inside a response.

The completed private DocketBird database intake contains **66,626 document records** and **69,815 original document source occurrences**. Every occurrence now has an exact private original-capture cloud reference. Those occurrences use **279 distinct capture files**. The main packet contributes 69,555 source occurrences and the incremental tail contributes 260. Original source ordinals are retained separately from the document record identity. No capture occurrence was unmatched.

| Metric | Counting unit | Verified snapshot |
| --- | --- | ---: |
| Original metadata capture occurrences | Original file URI + full-file SHA-256 + byte count | 1,511 |
| Unique stored metadata objects | Private bucket + content-addressed key + full-file SHA-256 + byte count | 1,511 |
| Stored metadata content bytes | Sum over unique stored objects | 153,270,434 |
| Private document records | Reviewed provider native document identity and payload version | 66,626 |
| Document source occurrences with original cloud references | Packet ordinal and complete original provenance | 69,815 |
| Distinct original captures supporting document occurrences | Original capture URI + SHA-256 + byte count | 279 |
| Document source occurrences missing cloud references | Same occurrence unit | 0 |

The two first metrics happen to match in this snapshot. A later capture with identical bytes can add a source occurrence without adding a cloud object. Object deduplication does not merge provider native case/document identities, firm-scope evidence, or differing source occurrences.

The frozen successful upload receipts cover both eligible plans in full: the main original-metadata plan and the incremental tail/Firecrawl plan. An earlier interrupted run produced 19 verified events that were subsequently proved again; these are repeat verification events, not 19 additional objects. Its one failed occurrence was resolved by a later complete-object readback proof. The interrupted receipt remains preserved and is not described as a successful batch.

## Reference contract

The private object map records the exact project, private bucket, content-addressed storage key, whole-file SHA-256, byte count, original source URI and provider, plus each verification receipt's full-file hash and event ordinal. Storage keys are derived from the verified capture-file hash, with the fixed shape `seeger-weiss/metadata-sha256/<first-two-hash-characters>/<whole-file-sha256>.json` in the private `corpus-originals` bucket.

The private document link map retains provider native document/case identifiers, canonical payload hash, original packet hash and ordinal, exact original input-record hash, source capture URI/hash/bytes, source document ordinal and original document hash. It links through **exact capture-file SHA-256 and bytes**, with the original URI checked against the reviewed source occurrence. It also retains whether the occurrence was the selected database observation or additional preserved source provenance.

The original occurrence URI remains unchanged. A cloud object key is a verified storage reference, not a replacement publisher URL or new native identity. No fuzzy name matching, cross-provider native merge, current firm participation certification, MDL membership certification, or legal causal relationship is created by this map.

The whole original blobs remain private and can retain original source-specific document grants, party/contact metadata and response headers. The derived reference maps contain no signed HTTP grant values, personalized locator values, contact values or document titles. All reference rows retain private/public-projection gates. Neither raw originals nor private reference maps are public dashboard assets.

## Dashboard use and verification limits

An admin dashboard can use the aggregate metrics above with their counting units and snapshot date. Document views can resolve an exact capture hash to its verified private bucket/key through an authorized server-side lookup. Public pages should receive only separately approved aggregates or reviewed source evidence; they should never receive these private maps, local source URIs, raw originals or signed grants.

The map is a verified frozen receipt snapshot. It makes no new assertion about current bucket policy or whether an object was modified after its uploader readback; a future live availability check must record fresh authenticated proof separately. The map does not establish completeness of a court docket, the firm's portfolio, PDF availability or current legal authority.

The private manifest SHA-256 is `ec82c31a8ce4267fb4b7a74104d8fd956afabf5454ed9727b1a004191dbe0068`. The object-map SHA-256 is `ea3774a7473e2d35e603a0a9e68c5e2aba90cebace28de56fefa56ae38b3709a`; the document-source-link map SHA-256 is `72ab58456955454aabdb55689015bc5d2126ec14f747ea1e4c6dfd231af1f647`. Independent offline reconstruction passed every object/source proof, all 1,511 original local file hashes, all 66,626 canonical document payloads and all 69,815 source links, including complete original ordinal coverage. Its receipt SHA-256 is `910c1019ff899aa6014df365c35ae0caa66433d0df4f58bc96393d1ba4975a49`. All original plans, upload receipts and metadata intake packets remain unchanged.

The completed metadata database proof and these verified original-metadata plans have separate receipts. Binary PDF download/cloud transfer workers and further source expansion remain ongoing and require their own progress and checksum verification. This report makes no all-PDF completion claim.

## Recent capture append

The separately frozen recent append maps **1,035 newly uploaded original captures**, comprising 9,949,053 bytes, and **two reused original captures** with exact proofs from the initial snapshot. Reused captures retain their prior upload receipt identity and are never described as recent uploads. All 1,037 original source files were independently rehashed twice; the prior 1,511-file map remains unchanged.

| Recent append metric | Counting unit | Verified count |
| --- | --- | ---: |
| Newly uploaded capture files and objects | Completed recent upload plan and original URI/SHA/bytes | 1,035 |
| Reused prior captures | Exact old URI/SHA/bytes and prior cloud proof | 2 |
| Recent native document payloads | Unique provider document identity in the recent intake | 7,923 |
| Preserved document source occurrences with cloud references | Original recent packet ordinal and full lineage | 8,414 |
| Typed metadata primary capture links | One original source occurrence per typed metadata row | 1,382 |
| Coverage supporting capture links | Explicit header/recent/chronological capture role | 690 |
| Missing capture references | Same source occurrence and role units | 0 |

The 1,382 primary metadata links comprise 345 native case headers, 345 local sheet observations, 347 local search-reference observations and 345 local coverage observations. Supporting coverage references produce 2,072 total typed metadata capture links; they do not add metadata rows or cloud objects. Search, sheet and coverage identities remain local source observations. These counts describe this recent scope and do not imply that all document records are additional to the initial intake.

The recent actual upload plan SHA-256 is `d3f5f045ff5f87b7b31a2ef68f53b96d45fbc10f288218ca988c05ba7e2cfa57`; its fully completed actual receipt SHA-256 is `7238caa67d622b0071c5def78d449fb3e724db3322ce8ae74bbdc39801e9e109`. The append manifest SHA-256 is `6faf6725d26c89286600304c7923f00781dbf416a59e937c818867a5d088c375`. Independent reconstruction verified all 8,414 document links and all 2,072 typed metadata capture links against complete frozen payloads, original ordinals and exact actual receipt events; its receipt SHA-256 is `e723cd7c25936a80ff54eac528350d944b0729e2a3e8d91c96b94e1579c91691`.

This append retains private gates and projects no signed locator, contact value or raw capture content. It makes no additional cloud request, database write, native relationship merge, current firm participation assertion or all-PDF completion claim.
