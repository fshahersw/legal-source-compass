# Recent Seeger Weiss docket metadata checkpoint

The bounded source acquisition finished on October 2, 2026 at 15:28:40 UTC. It made 1,040 RPC attempts: three protocol setup calls, 347 successful exact searches, 343 successful case-header requests, 345 successful sheet requests and two sheet HTTP500 failures. Four searches found no exact qualified reference. The Talc and Roundup sheet failures retain their previously captured header evidence and remain missing sheet snapshots. The prior 51 partial provider end-view scopes also remain partial; they were outside this new acquisition.

The selected source is the frozen 509-ID union of CourtListener firm-query hits filed in 2025/2026 or carrying an explicit `md` docket-number type. Exact source qualification does not prove current firm representation, a complete firm portfolio, an MDL master/member role, or a publisher identity merge. No case-name join was used.

All 1,035 successful original metadata captures were uploaded to the private `corpus-originals` bucket in project `xosqzzsnhxcyehcnirpa` and independently read back in full by the root uploader. Their bytes total 9,949,053. The final receipt records zero failures; the protocol `tools/list` capture was excluded from this original-metadata plan. Source digests describe the retained provider RPC representation, not court HTML or PDF wire bytes. Original legitimate signed document locators remain private original evidence, while normalized metadata withholds their values.

## Verified document intake

Run `040510b8-86a0-4c77-99a0-1989a2532dc4` imported 7,923 native document payloads and preserved all 8,414 source occurrences, including 491 additional original provenances. Ninety bounded import groups were acknowledged. A separate read-only proof checked every canonical payload, storage hash, full provenance fingerprint, native parent, current entity and source ordinal across eight pages plus a final empty page. It found no relationship writes, unreferenced first-run versions, missing source ordinals or anonymous/authenticated private-table SELECT grants; all four private tables had RLS enabled.

The source-native ID union across the main, tail and recent prepared packets is 74,276. This pass adds 7,650 native document IDs and 273 enriched payload versions for previously known IDs. Of those 273, **271 retain exactly the same publisher document metadata** and differ only in their source-qualified CourtListener IDs and firm-evidence kinds; two have changed original publisher metadata. All 7,923 enriched payload versions were first seen in this ingestion run. A new normalized evidence version is not a new PDF byte version, and no PDF checksum is inferred from a metadata digest.

The separate recent PDF queue contains 7,652 source versions: 3,685 eligible for the private transfer worker and 3,967 held (3,888 source-listed PDFs not downloaded by the provider and 79 provider-restricted records). It excludes 271 exact old native-document/parent/raw-metadata source versions. Actual PDF completion requires the transfer receipts; this metadata checkpoint does not assert that the queue is fully downloaded.

## Additional queryable metadata

Run `9f2a84ab-3302-439c-b256-45ef28fb2f24` completed the separate metadata intake: 1,382 observations in 16 bounded groups. Its independent database proof finished at 16:09:59.316 UTC on October 2, 2026:

| Grain | Rows | Identity and qualification |
| --- | ---: | --- |
| Native case header | 345 | Actual provider case ID; court, filing date and complaint-document ID where supplied. Two headers are preserved prior captures. |
| Captured sheet view | 345 | Local `source-capture:<SHA>` identity, not an invented publisher sheet ID. Native document IDs and source-reported counts are retained. |
| Exact search reference | 347 | Local capture identity; unique-reference or no-exact-reference result remains qualified source evidence. |
| Provider metadata coverage snapshot | 345 | Local `source-coverage:<SHA>` identity; 343 complete provider metadata snapshots and two missing sheets. Court and PDF completeness are expressly unverified. |

Native header case numbers remain missing where the provider returned null. These actual header schemas contain no judge, party or attorney fields; those fields were not guessed from case identifiers. Source counts of zero remain zero, and missing counters remain null. Source dates and capture dates are distinct. Search/sheet/coverage observations do not create cross-provider native relationships or public records.

The narrow metadata SQL contract provides a service-only intake, exact full-data/full-provenance status comparison and a final per-type source-ordinal/RLS/no-relationship proof. The runner binds a separately registered run immutably, accepts only an externally pinned plan, and treats known semantic acknowledgement failures as stop conditions. Only genuine unknown network outcomes can be audited; a retry requires an exact private absence proof. The actual root intake acknowledged all 16 groups; its separate read-only proof matched every row, canonical payload, full provenance and current entity, with exact source ordinals within every type. All 1,382 referenced versions were first seen in this run. No relationship writes or anonymous/authenticated private-table SELECT grants were present, and all four private tables retained RLS. This completed intake remains private and creates no public projection.

## Frozen evidence

All paths below are beneath `C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird/`. Older manifests and queues are unchanged.

| Evidence | Relative path | SHA256 |
| --- | --- | --- |
| Collector runtime | `recent-expansion-v1/runtime-manifest.json` | `5bd83d0d815487d959e1a1bb880de2ef3c425804862cee2a1a615ad447166e2b` |
| Follow-on source manifest | `recent-expansion-v1/prepared-follow-on-v1/manifest.json` | `d4f776c819e24189b43144c01f58fbe572c8a38115d9f9cdb57e9298950c3526` |
| Original metadata upload plan | `recent-expansion-v1/prepared-follow-on-v1/original-metadata-upload-plan-v1.json` | `d3f5f045ff5f87b7b31a2ef68f53b96d45fbc10f288218ca988c05ba7e2cfa57` |
| Actual completed original upload receipt | `recent-expansion-v1/prepared-follow-on-v1/root-original-upload-receipts-v1.jsonl` | `7238caa67d622b0071c5def78d449fb3e724db3322ce8ae74bbdc39801e9e109` |
| Recent private PDF queue | `recent-expansion-v1/prepared-follow-on-v1/docketbird-recent-pdf-queue-v1.jsonl` | `e0c0c49703607b15a5bea5748dcddc4b22587d7ff2d140d329e3f79ed2ef4b38` |
| Document intake plan | `private-intake-recent-v1/plan-unbound.json` | `1d8c304016dd53997f89dd8b2f6eeb0891af57e76ff534da3f8efb40e9637c9c` |
| Actual independent database proof | `private-intake-recent-v1/root-database-proof-v2.json` | `05d6481f94e0b56b33252627d9f62b002985f7be497a8b2194dc98427d852184` |
| Native/enriched version distinction | `private-intake-recent-v1/intake-native-version-semantics-v1.json` | `115ae24e3f45c28761214941522fc86ad9cdec828086299f39212557b2c334b7` |
| Additional metadata intake plan | `private-metadata-intake-recent-v1/plan-unbound.json` | `fd3b9d094b9deb8865673e1803e5ae69d73624fc71c4d972dd6829a7200b714d` |
| Independent metadata reconstruction | `private-metadata-intake-recent-v1/independent-prepared-metadata-intake-review-v1.json` | `52781e4f8caf6ef4331a49614427becf88b3739749194ac93deca7ad28336e0a` |
| Second independent metadata reconstruction | `private-metadata-intake-recent-v1/local-catalog-independent-prepared-verification-v1.json` | `56ecdd402d71effc3c7c685dd8ff1388a37a7a9413f5d93cdd43af0e656fb59e` |
| Actual completed metadata intake receipt | `private-metadata-intake-recent-v1/root-intake-receipt-v1.json` | `a7056b9464fd4da0e1471767112bc0fc7bb4c4f4a85c7c1d3623f0c2fb1517d3` |
| Actual completed metadata database proof | `private-metadata-intake-recent-v1/root-independent-proof-v1.json` | `e07aeafb5d2d03fc99ab4dc8f228d6b7d682d25a02bd1fe43cbe165054b39c3d` |
| Independent actual-receipt audit | `private-metadata-intake-recent-v1/independent-actual-database-receipt-review-v1.json` | `3f9388773f98941e1483b4bf8585f15ce1892d05cd8e72b9c6c7f3f460044752` |

Eleven proof tests and a further recovery-classification test passed locally. The independent metadata review reconstructed all payloads/provenances and source ordinals, rehashed their actual captures, checked native parents and parsed 12 SQL statements/four PL/pgSQL functions. Metadata acquisition/preparation performed no PDF downloads. Private metadata intake and original cloud storage do not change public access or establish legal relevance, outcomes or causation.
