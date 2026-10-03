# P0 provenance and hygiene review — October 2, 2026

The reviewed Verdict Reports source explicitly restricts export. Root has executed the reviewed reversible hold: its 3,312 queryable projection rows are now privately archived and absent from the connected database's published query surface. The original audit and prepared-contract findings below are preserved; the separate execution section records the actual result and distinguishes website deployment status. This audit agent executed no database mutation, deletion, storage transfer or public release. It does **not** certify that the entire corpus contains no confidential or client data.

## Confirmed TopVerdict source binding

All 3,312 `verdict_reports` source URLs use `topverdict.com`. None uses a Lexis, Westlaw or VerdictSearch source URL. The exact set of 3,312 projected IDs equals the original SQLite `reports` IDs. The original SQLite SHA and validation SHA also equal the registered dataset's `source_files` checksums:

| Original evidence | SHA-256 | Finding |
|---|---|---|
| `verdict_settlement_reports.sqlite3`, 4,874,240 bytes | `ecede0e85501609322d3160f3dfe0ccf79f6c6f6b73983cdae2b544f37be951a` | 3,312 exact source IDs match the live projection |
| `validation.json` | `78825251e7a9156a88ed9d326b649e287eb7147a514e2f3b4fe4641c3f90c5b5` | `export_allowed: false`; `license_ref: publisher_terms_prohibit_reuse_local_research_only` |
| Original lead-index input | `52d6e23383b8f85a9b606b2c2519c2caa7b69a09872dbc0501a98be545bf0113` | Actual original bytes rehashed and matched the validation input |

The adapter README's “License” section and build code lines 21–22 describe local research only. The publisher's [current terms](https://store.topverdict.com/pages/terms) assert rights in its lists and restrict use without the designated license. No separate product-reuse license was present in the audited evidence. The original source identifies commercial, selected verdict/settlement leads, not a representative court-outcome dataset. The projected qualification contains the local-research/reuse warning on all 3,312 rows; the ready gate nevertheless allowed the rows to remain queryable. The explicit `license_ref` remains in the corresponding database context but is absent from the projected dataset metadata and row policy fields.

The archived record signature is `7ce942503ab59c5d642ae35621ed5cd9b4ffa7ddec4d6320b1a06660d42ce646`: each full `corpus_records` row is serialized as PostgreSQL `to_jsonb(row)::text`, SHA-256 hashed in UTF-8, then `id:row_sha256` lines are sorted by ID, joined with LF without a terminal LF and SHA-256 hashed. It includes every row field, including its search vector.

## Prepared reversible hold

The scope is `b410de75-1b8d-4937-87f9-1a202d6a9672`. Contracts:

- `database/contracts/hold-topverdict-public-projection-v1.sql`: exact original-row/dataset/context guards; archive all 3,312 full rows, dataset metadata and two source-linked context snapshots in private `corpus_ingest.public_visibility_quarantine_v1`; remove only the `verdict_reports` queryable rows; hold dataset/context readiness. RLS is enabled and PUBLIC/anon/authenticated table access is revoked. A changed snapshot aborts the transaction.
- `database/contracts/verify-topverdict-public-hold-v1.sql`: separate full archived-row and supporting-snapshot hashes, public absence, readiness, derived-index absence and archive permissions.
- `database/contracts/recover-topverdict-while-held-v1.sql`: explicitly authorized recovery restores exact row bytes/fields and reconciles the full-row signature while keeping readiness false. The captured search-vector trigger overwrites supplied vectors, so recovery pins that definition and enabled state, disables only this exact trigger inside the write-locked transaction, restores original vectors, re-enables it and verifies before commit. RLS remains enabled. The exact original dataset/context JSON stays in the archive; recovery does not grant republication rights.

Dependency introspection found no dependent views. The only corpus-record foreign key points to the dataset registry. There are zero corresponding `corpus_research_names` and `corpus_research_law_paths` rows. Two context rows contain source-bound verdict metadata; one was already not ready. **Zero** `corpus_artifacts` rows match the original SQLite or validation hash, so the prepared contract changes no artifact downloads and deletes no stored originals or PDFs. No broader commercial-host or citation keyword is a removal predicate.

## Bundle and privacy scope

The frozen pre-move `public/data` inventory contains **324 files / 148,175,952 bytes**. All 322 supported JSON, JSONL, CSV and text files were structurally and pattern scanned; the two XLSX files were inventoried and hashed without scanning spreadsheet bodies. Root may move these same bytes to `private/data`; the audit uses a fallback path and retains the original snapshot paths/checksums.

The scan produced 3,389 review-marker occurrences, not unique records: 308 commercial-service URL occurrences, 2,332 matched privacy-phrase strings, 745 email-shaped strings and four SSN-shaped substrings. The four numerical shapes were independently traced to URL/path fields and are **not classified as Social Security numbers**. Many phrases are court/agency or statutory text. These markers alone establish neither confidential data nor a paid-content source; no automatic deletion is proposed.

The bundled matter registry includes 325 named party rows, 130 named attorney rows and 73 case-caption rows. All 528 have source-record references but no inline source URL, retrieval timestamp or license field. Their original provenance must be resolved before public re-release. Public court-party information and professional counsel information may legitimately identify people; this audit does not equate it with a confidential firm client roster. A private candidate packet identifies exact file SHA, JSONL ordinal and row SHA without reproducing names or captions. The registry's 25 outcomes are coded disposition records, not a comprehensive settlement/verdict amount corpus.

The full public-schema record source-field scan covers **5,862,027 rows across 88 datasets** (including held datasets), with **625,468 empty/missing top-level source URLs**. No dataset metadata object has a top-level `license`, `licence` or `license_ref` key. The private native intake aggregate covers **1,127,449 source-version rows across ten provider/source systems**; all have retrieval dates, but none has those reviewed top-level rights keys in provenance. These are field-completeness results: rights may be described in separate manifests or qualifications, and missing fields do not establish illegality. Per-record source/date/rights-basis propagation remains unfinished.

## Paid services and official portals

The source-field scan found 3,016 rows on commercial-brand hosts, including 2,938 `open_us_law` rows on `govt.westlaw.com` (Arizona and Maryland), six `mass_tort_authority_evidence` rows on `advance.lexis.com` (Georgia, Mississippi and Tennessee), and four Oklahoma limitation-review rows on `govt.westlaw.com`. Other matches are source/vendor directories. State-authorized public publisher portals, unread/access-gap references and directory locators require separate rights/content review; a domain match does not prove a paid subscription download. Ordinary `WL`/`LEXIS` case citations likewise do not identify the acquisition source.

[LexisNexis's current general terms](https://www.lexisnexis.com/en-us/terms/general.page), effective June 5, 2026, restrict automated interaction, systematic database storage and commercial redistribution unless specifically permitted. Account-specific permission and the terms applying to public state-publisher services were not supplied for this audit. The official Westlaw agreement search result was inspected, but direct opening redirected to its bookstore; it is not recorded as a successfully retrieved agreement body. No reliable current VerdictSearch terms or verified VerdictSearch acquisition lineage was established. No new automated collection from these services occurred in this audit.

User-authorized **paid DocketBird MCP access is a separate private collection**. The audited database has 74,276 source-qualified document metadata versions plus 1,382 typed header/sheet/search/coverage observations. The TopVerdict contract changes none of them. Authorized private acquisition does not by itself establish a public republication license; maintain the private collection and attach the actual contractual reuse basis before any broader release.

The `corpus-originals` bucket is private. At the read-only snapshot, all 752 local-bundle PDF occurrences require private quarantine, have no backend document IDs and forbid public projection. The native PDF observation review likewise reports public projection false for every inspected registered provider observation. These controls are not a content review of PDFs, a legal sealing determination or a confidentiality certificate.

## Evidence and outstanding review

Private evidence directory: `C:/Users/firas/.codex/corpus-cache/p0-provenance/2026-10-02/`. `p0-audit-manifest-v1.json` pins the file inventory, database aggregate receipts, redacted review candidates, original-file checksums and prepared hold plan. Sensitive source contents are omitted from this report and candidate packets. Source originals remain in place.

Outstanding: privacy/reuse clearance for participant/caption bundles after the original-source trace below; license/rights basis for every source and record; semantic review of private document/full-text bodies and unaudited relational tables; XLSX content review; deployment verification of website access restrictions. The audit cannot confirm absence of firm-confidential or client data across the entire system.

## Separate execution status — live database hold completed

Root executed the independently reviewed hold contract and saved `root-topverdict-hold-execution-v1.json` in the private audit directory, SHA-256 `8f8054fc7017a6635ef91039ed6549893b5710e748cacf04f602dcc5628b0817`. Its reported execution time is approximately October 2, 2026, 17:58 UTC; migration history is authoritative for precise timing. The reviewer separately parsed the saved tool receipt and matched every prepared postcondition.

The **connected live database** now has zero `verdict_reports` rows in `public.corpus_records`; the dataset is not ready and has zero imported projection rows. All 3,312 exact originals remain archived privately with the original full-row signature, zero hash mismatches, three supporting snapshots and zero supporting-snapshot mismatches. Both context references are held; name/law derived indices have zero associated rows. Archive RLS is enabled and anon/authenticated SELECT is denied. No matching artifacts, private originals or PDFs were deleted. The prior prepared plan and audit receipts remain unchanged as historical evidence.

This database result does **not** confirm deployment of the website's new authentication, static-bundle relocation or download restrictions. Those website changes were still pending deployment/verification at this handoff. The audit's broader confidentiality and rights-review limitations remain in effect. This agent performed receipt review and documentation only, with no database mutations.

## Separate follow-up — original provenance of 528 named bundle rows

The former public matter-registry bundle now resides under `private/data/matter-registry/`. All **528 rows** exactly match the ordered parsed payloads of retained release `b1-78fe28d84a27a8764b57`, built August 23, 2026, at 16:42:30 UTC. The original compressed party, attorney, matter, source-record, provenance and review tables all match their declared SHA-256 and byte counts. Every row's source reference and exact provenance edge resolves; no retained-source hash drift or unresolved row lineage was found. This is an original-source trace, not a new publisher API validation or permission to display names.

| Bundled rows | Exact retained source identity | Source files | Finding |
|---|---|---|---|
| 325 parties | `catalog_parties_counsel`, catalog `docket_id` | 57 `catalog/parties_by_docket/<id>.json` files, shared with counsel rows | Exact source party name, deterministic party ID and party-type array match |
| 130 attorneys | `catalog_parties_counsel`, catalog `docket_id` | The same 57 captures | Exact name and source attorney identity match; names are not copied into audit outputs |
| 57 matters | `catalog_matters`, catalog `docket_id` | `catalog/matters.json` | Exact caption, court, docket number and filing date match |
| 16 supporting rows | `catalog_masters`, catalog `master_docket_id` | `catalog/masters.json` | Same exact field checks; the local supporting-master label is not independently verified MDL membership |

Together these rows use **130 distinct source records, 528 provenance associations and 59 hash-pinned original catalog files**. Each of the 73 matter rows has a stored CourtListener locator whose path contains its exact catalog docket ID. The party/counsel captures preserve the parent docket ID, court, docket number, caption, local master association, party names/types and attorney IDs/names/firm/role. The retained loader source was read without executing or importing it; it selects counsel appearances by configured firm-name matching. This local provenance explains the selected records without treating them as a comprehensive firm-matter inventory or confidential client roster.

None of the reviewed raw catalog files preserves a sealed/blocked/privacy-clearance flag, upstream retrieval timestamp or reuse-license field. Party/counsel captures also lack a preserved upstream API URL or original API response envelope. All 528 normalized rows use administrative `record_status: active`; the 73 matter roles are 57 `target_matter` and 16 `support_master`. These local labels establish neither current court activity nor privacy clearance. Missing flags remain unknown. Names appearing in docket-derived data can still require review for minors, sensitive proceedings, subsequent restrictions and contractual reuse. The candidate disposition remains **private pending source-privacy and reuse review**; this targeted trace does not certify the remaining corpus or PDF bodies.

Separate private evidence, preserving the first audit manifest unchanged:

- `named-bundle-original-lineage-receipt-v1.json`, SHA-256 `25d58b16fb864cd466c63075dbda63a185cd290979ba58a6342b9a96a127f04e`: full source/count/hash checks, zero network/DB calls and zero confidentiality-clearance decisions.
- `named-bundle-original-lineage-v1.jsonl`, SHA-256 `4aeb3e379ad18856d6e1236651da051ec9dc4bdbc652d93cb1aca862e9315da1`: exact bundle ordinals, row hashes, opaque record IDs, source IDs, catalog docket IDs and original field paths; no names or captions.
- `named-bundle-original-source-files-v1.json`, SHA-256 `06ff81cf8c1f4dab506587e09be380d7e0a720e3c3938d0daa0a9cbc41bdf103`: all 59 original file proofs and field-presence inventories. Whole catalog-file URL counts describe the containing files, not the 528 selected rows.
