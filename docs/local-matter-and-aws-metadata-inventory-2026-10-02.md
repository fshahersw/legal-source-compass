# Local matter and AWS metadata inventory — October 2, 2026

This read-only review covers `C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE` and `C:/Users/firas/Downloads/SW-BULK/AWS-BATCH1-DOCKETS`. It executed no downloaded pipeline code, read no PDF body, accessed no credentials, made no network/database call, and changed no source file. File-path discovery used `rg --files`, excluding dependency and Git directories.

## Verified source units

| Local source | Metadata files scanned | Source rows across retained files | Source bytes | Unit |
|---|---:|---:|---:|---|
| MATTER-ETL-BATCH-PIPELINE | 152 CSVs | 441,433 | 90,477,043 | Uploaded CSV row; multiple schemas and repeated files |
| AWS-BATCH1-DOCKETS | 95 gzip JSONL tables and 3 quarantine JSONLs | 698,177 | 79,932,160 | Local release/quarantine table row across five preserved releases |

All **95 release table files** independently match their declared compressed bytes, SHA256 and decompressed row counts. There were zero parse, column-count, source-mutation or release-manifest mismatches. The inventory records eight CSV schemas and 26 observed JSONL field sets. Two CSVs are explicitly named templates and held as such. These are source-row counts, not distinct cases, documents, people or newly acquired publisher records.

Five release manifests were separately hashed. The declared `b2a-0ef93bbef92cff5b3532` predecessor points to the observed `b1-78fe28d84a27a8764b57` manifest with the correct checksum; `b2b-cdbb8d040b95c7b65cfc` similarly pins `b2a`. The other two b1 releases remain separate branches. A predecessor relation proves local artifact lineage, not legal/source correctness. No older version was deleted.

## Latest declared release

`b2b-cdbb8d040b95c7b65cfc` was built **August 24, 2026**, with manifest schema `batch1-release-manifest.v1`. Its 19 table files contain **302,645 local rows**. This is not a current October 2 API snapshot.

| Local table | Rows |
|---|---:|
| Matters | 4,159 |
| Matter relationships | 53 |
| Docket entries | 41,946 |
| Documents | 13,971 |
| Judges / judicial assignments | 867 / 4,776 |
| Parties / attorneys / counsel appearances | 503 / 181 / 878 |
| Opinions / citations | 900 / 2 |
| Outcomes | 25 |
| Source records / provenance / review records | 72,860 / 124,221 / 32,941 |

The source-record inventory includes declarations of 50,920 RECAP-document records, 11,489 bulk-citation records, 5,119 bulk-docket records and 900 bulk-opinion records, among other origins. Those source declarations are different from the 2 normalized citation rows and other table counts; they must not be presented as a fully resolved graph or independent current verification. Source-record links and original evidence require review before promoting any native relationship.

The uploaded CSVs expose document IDs, entry/attachment numbers, dates and titles in one schema; another adds source/availability/seal flags, hashes and document locators. Party CSVs contain names and contact fields and remain private. Filenames, captions, source `node_role` labels, apparent master/member assignments, court IDs and judge IDs do not alone prove provider-native relationships. The 25 outcome rows retain administrative/raw-code evidence fields; no comprehensive verdict or settlement corpus is established.

## Private candidate handoff and duplicate plan

The private review generated **23,260 exact CourtListener docket-reference observations**, representing **2,067 distinct parsed provider docket IDs** across all retained source versions. Each candidate retains the original file path/SHA, row ordinal/SHA, exact source field, observed URL hash and parsed ID. It omits captions, contact/transcript text and URLs containing credentials or query strings. All candidates remain explicitly public-held and source-attributed to the local upload; none is relabeled as a fresh CourtListener API record. Local artifact verification is separate from upstream legal/current verification.

There are **29 groups of byte-identical metadata files**. A follow-up import should share a stored blob for identical SHA/bytes while preserving every path, release and observation; different hashes remain separate versions. It should use source-type namespaces and exact provider IDs with original evidence, retain local record/source IDs separately, and review actual relationship endpoints before joining. Names, captions and matching filenames must not drive merges. Templates/quarantine rows and unsupported master/member/outcome assertions remain held. The manifest predecessor chain supports selecting the latest declared local view while retaining all earlier versions.

The complete private handoff is under `C:/Users/firas/.codex/corpus-cache/local-source-review/metadata-local-20261002`:

- `path-inventory.json`: bounded directory/type/size inventory.
- `verified-file-inventory.json`: exact per-file paths, hashes, schema fields, counts, version lineage, duplicate groups and integrity checks. SHA256 `3e7d7f5d498dd61abbe8b47d37c07e6360e0ad545bfd9848f0ead6f2978dbd4f`.
- `qualified-native-reference-candidates.jsonl`: private source-reference candidates, not canonical ingestion. SHA256 `cea20f5c552af48ca0d36a25a17ce9854599e20937abd6df6b6a03048c97bdb0`.
- `upload-manifest-observation.json`: the separate upload contract/version/hash observation, with source labels retained as declarations.
- `verify-local-metadata.py`: the reviewer's own read-only verifier; no downloaded scripts were executed.

No Supabase run was registered, no public projection was changed, and no original was overwritten. The official oral-argument metadata export has not been downloaded; that acquisition was paused when the local-source priority arrived.
