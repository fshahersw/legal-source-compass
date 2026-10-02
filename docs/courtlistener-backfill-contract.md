# CourtListener metadata backfill contract

This administrative ingestion workflow is authorized by the user on 2026-10-02. It collects metadata and document URL references; it never requests PDF bytes, authenticated PACER pages, paid RECAP fetches, or account changes. Its credentials live outside the repository and are sent only to the expected CourtListener or Firecrawl HTTPS origin. Existing browser publication rules and privacy labels remain in force until separately reviewed.

## Source identity and versioning

Every normalized line contains `schema_version`, `source_system`, `entity_type`, `native_id`, `data`, and `provenance`. Native IDs are string representations of the publisher's own IDs. Court IDs remain publisher short codes. A native record's identity is `(courtlistener, canonical_entity_type, native_id)`, never a normalized name, case caption, citation string, or fuzzy match.

Canonical bulk aliases are `people-db-people → people`, `people-db-positions → positions`, `people-db-educations → educations`, `people-db-schools → schools`, and `people-db-political-affiliations → political-affiliations`. The person-to-race associations `people-db-races` and the eight enumerated `people_db_race` choices are different entity types. Do not merge them. Court, courthouse, and court-appeals-to rows remain separate.

Bulk snapshots preserve PostgreSQL COPY CSV distinctions: an unquoted empty field is null; a quoted empty field is an empty string. Raw CSV values remain strings or null until a schema-aware importer converts an identified upstream field. The original compressed bytes, upstream schema SQL, and import shell script remain outside the repository. The upstream schema is reference material, not a migration for this application.

Provenance includes the exact source URL, observation time, source snapshot date when supplied, raw SHA-256, HTTP status, schema version, and record SHA-256. Bulk record hashes use UTF-8 JSON with sorted keys, compact separators, and unescaped Unicode. REST hashes use the UTF-8 `JSON.stringify` of the observed object. These hashes identify observations in their source envelope; cross-source equality needs a separately documented normalization. REST metadata can be newer than a quarterly bulk snapshot. Do not overwrite a newer observation with the older snapshot solely because it was imported later.

## Relationship interpretation

Use only native foreign keys and scoped associations. Preserve `court_id`, `assigned_to_id`, `referred_to_id`, `parent_docket_id`, `docket_id`, `docket_entry_id`, citation opinion IDs, and upstream party/attorney relationships when provided. Some API fields are resource URLs; retain the original and parse an ID only from the documented resource path.

For parties and attorneys, the request uses `filter_nested_results=True`, but the observed API still returns some `party_types` associations belonging to other native dockets. Do not assume the publisher applied that parameter to every nested field. Party identity is not a party's role in a case. Each `party_types` or `parties_represented` association needs its own relationship identity using its actual native docket, party, attorney, and role fields. Never assign every nested association to the outer query's docket. Preserve observations from every queried docket rather than replacing their relationship union with a single query's nested subset. Name similarity does not merge attorneys, judges, firms, or parties.

An MDL master label in the existing native uploaded crosswalk is explicitly attributed to that upload. CourtListener's `parent_docket_id` is documented for criminal and magistrate defendant child dockets; it must **not** become a generic `member_of_mdl` relation. Docket `mdl_status` describes JPML status rather than a dedicated MDL master/member foreign key. The FJC-IDB has an explicit `multidistrict_litigation_docket_number` field, and a docket can have a native `idb_data_id` foreign key. An exact IDB join can retain that source's historical administrative MDL association with its source/version/date; it does not prove a complete current member inventory. A case's other asserted membership requires the native uploaded crosswalk or reviewed transfer evidence. A shared case name, product, judge, court, or attorney does not establish MDL membership. A docket termination, settlement-related entry, or disposal code is not a verdict, merits finding, or settlement amount.

RECAP document metadata is extracted from observed docket-entry nested records without visiting document URLs. `is_available=false` stays false; an existing URL does not turn an unavailable PACER document into a downloadable public document. Official court HTML inventories include anchor labels and PDF URL candidates; those destinations are not independently fetched or availability-certified.

Citation-map edges use the native citing and cited opinion IDs. Upstream `depth` means the number of mentions of the cited opinion in the citing opinion, as defined in the [publisher model](https://github.com/freelawproject/courtlistener/blob/main/cl/search/models.py). It does not encode positive/negative treatment, governing authority, precedential weight, or an outcome probability. A published/unpublished source flag and a citation count likewise need jurisdiction-specific legal review before any binding-authority claim. Missing opinion→cluster mappings remain explicit gaps; source-native dangling references are preserved privately rather than guessed.

## Coverage and rate limits

The authenticated Usage API verified Tier 4 limits of 50 requests per rolling minute, 600 per rolling hour, and 2,800 per rolling day on 2026-10-02. All windows apply simultaneously. A single filesystem lock and persisted request ledger pace concurrent workers. Cached original responses do not consume further API requests. A safety reserve and conservatively charged prior traffic account for other account use.

The API's OPTIONS response supports exact/range docket ID filters but not `id__in`; do not assume a batch-ID filter exists. Deep REST pagination follows the publisher's `next` URL, preserving scope and ordering. In this bounded first pass, docket-entry queries are ordered by source creation date and the manifest labels every unfinished cursor. This is recent *source capture*, not proof of a docket's complete history or its latest filing. Page limits do not establish complete member, party, attorney, entry, opinion, or citation coverage.

An HTTP 401/403 or 429 stops the corresponding credential/scope, with the publisher's Retry-After recorded where supplied. Never change proxies or hosts to work around a denial. CourtListener public `robots.txt` returned CloudFront 403 in this run, so the public-page scraping scope was stopped; the separately authorized REST API remains available. Firecrawl uses basic retrieval for open official court HTML and stops a denied host; it does not scrape the denied CourtListener page scope.

## Running and resuming

Run from the repository root with Node's system CA store:

```powershell
node --use-system-ca scripts/ingest/fetch-bulk.mjs
python scripts/ingest/convert-bulk.py
node --use-system-ca scripts/ingest/backfill-courtlistener.mjs --max-requests=350 --case-limit=170 --entry-pages=2 --relation-pages=5
node scripts/ingest/extract-document-inventory.mjs
node scripts/ingest/validate-and-index.mjs
node --use-system-ca scripts/ingest/scrape-official-mdl.mjs
```

The default output directory is `../audit/2026-10-02/metadata`. Set `CORPUS_INGEST_CREDENTIALS` to a private JSON credential file if relocating the job. It needs the keys `COURTLISTENER_API_KEY` and `FIRECRAWL_API_KEY`; never check that file into Git. A complete native scope is marked `complete:true`; pending scopes retain the exact `next` cursor. Use the JSONL originals and both manifests to import partial observations honestly, continuing outstanding scopes in a later bounded pass. Verify an abandoned rate lock's recorded process has stopped before removing it.

The bulk manifest's counts describe the entire named 2026-09-30 publisher snapshot. The live manifest describes this job's actual collected docket scopes. They are different coverage statements. All automatic public projections require structural mapping and privacy review; private party contact fields and natural-person captions must not be exposed merely because they appear in a source.

`validate-and-index.mjs` verifies every normalized observation's native identity, HTTPS source URL, retrieval date, and record hash. Its file receipts include complete-file SHA-256, observation counts, distinct native identities and versions, and the actual complete/partial scope cursors. Standalone RECAP document metadata preserves its containing entry ID and derives the docket ID only from the publisher's native docket resource URL, recording the exact resource and derivation in provenance.

## Large snapshots and exhaustive entry backfill

Large original metadata CSVs are stored outside OneDrive and Git at `C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30`. `fetch-large-bulk.mjs` downloads the publisher's complete citations, citation-map, FJC-IDB, and docket snapshots with byte-range resume and SHA-256 receipts. It never downloads the 55 GB opinions file or any PDF. `stream-bulk-metadata.py` counts complete originals while emitting saved docket IDs, explicit known-MDL IDB associations, and separately labeled publisher/native case-type candidates. Candidate selection is not legal classification. Its optional parallel decoder lives in an isolated cache dependency directory; the standard-library fallback remains supported.

The subsequently authorized metadata extension adds complete opinion-clusters, originating-court information, native opinion-judge/panel joins, parentheticals, and unmatched citations. Eleven complete originals total 9,094,264,080 compressed bytes. The complete docket scan counts 72,998,758 source rows and emits 187,900 scoped rows; all 2,127 saved native IDs are present. Of those rows, 185,124 have exact native IDB foreign keys into selected explicit FJC MDL records. The union of exact native saved IDs and IDB links is 186,944; another 956 rows are unconfirmed candidates. The source-complete snapshot does not prove a complete current member inventory.

The opinion-cluster scan counts 10,174,551 source records and selects 2,623 through exact `cluster.docket_id` joins. The originating-court scan counts 1,060,419 rows and selects 54 through native docket foreign keys. The panel snapshot contains 835,616 relations, with three matching the selected cluster IDs. The nonparticipating-judge snapshot is empty, and the opinion-judge snapshot contains 1,028 relations. A cluster's ID is never an opinion ID. Native `sub_opinions` resources supplied by authenticated cluster headers identify opinion nodes for citation-map selection; no opinion text or PDF is fetched. A bounded separate 12-header collection for native Testosterone docket 4261857 covers 12 of its 24 observed cluster resources and explicitly retains partial scope status.

Complete scans of 18,130,235 formal citation rows and 78,404,647 directed opinion-citation relations retain 26 and 201 scoped observations respectively. The complete parenthetical scan counts 6,561,878 rows and selects 37 using native opinion foreign keys; its upstream score measures descriptiveness rather than legal probability. The complete unmatched-citation scan counts 17,834,231 rows and selects 84 using native citing-opinion IDs. Unmatched references retain their native strings and resolution statuses; unresolved references are not garbage and are not guessed into resolved authorities. The scoped citation graph remains partial even when the original snapshot scan is complete.

Native Testosterone dockets 4261857 and 18704765 share an observed court/case number/title but have different PACER case IDs (293765 and 541284), so they remain separate publisher entities. Docket 4261857 has an embedded FJC record explicitly identifying MDL 2545. Physiomesh docket 6078886 separately matches the official Georgia Northern court's 1:17-md-02782 case number and title. Additional explicit FJC MDL selections are isolated from the original import files: 7,964 rows for 2545 and 3,854 for 2782. An association label must retain its source and unknown master/member role where the native role is not independently verified.

```powershell
node --use-system-ca scripts/ingest/fetch-large-bulk.mjs
python scripts/ingest/stream-bulk-metadata.py fjc-integrated-database --output=C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30/normalized
python scripts/ingest/stream-bulk-metadata.py dockets --output=C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30/normalized --parallel=12 --python-deps=C:/Users/firas/.codex/corpus-cache/python-deps
node --use-system-ca scripts/ingest/count-master-scopes.mjs
node --use-system-ca scripts/ingest/backfill-courtlistener.mjs --entries-only=true --master-limit=5 --entry-pages=2000 --case-limit=0 --max-requests=245
python scripts/ingest/split-docket-scope.py C:/Users/firas/.codex/corpus-cache/courtlistener/2026-09-30/normalized
```

The 15 observed master scopes contain 150,029 entries at the 2026-10-02 count observation, requiring 7,508 default 20-row pages. The official endpoint uses the default paginator, not its separately defined adjustable paginator; `page_size=100/500` is not assumed to work. Completing those scopes through REST requires multiple rolling quota windows. Sorting by observed entry count finishes complete smaller scopes first. The manifest marks completion only when the API's next cursor is null.

The finalized 2026-10-02 live batch contains complete entry scopes for Elmiron MDL 2973 (419), Davol/C.R. Bard polypropylene hernia mesh MDL 2846 (994), GLP-1 gastrointestinal MDL 3094 (1,034), PPI MDL 2789 (1,263), and Benicar/olmesartan MDL 2606 (1,337): 5,047 entries. Earlier collection progress messages mislabeled the 2846 scope as Physiomesh and the 2606 scope as Testosterone; those labels were incorrect. Native docket headers and official court pages identify the actual products. The separately asserted 2782 Physiomesh and 2545 Testosterone scopes must not inherit these native docket IDs. `master-identity-audit.json` preserves all 15 native header names, courts, docket numbers, source URLs/hashes, and the correction record. Another 680 entries from the other ten masters remain explicitly partial. Live file receipts cover 105 docket headers, 5,727 entries, 1,359 parties, 887 attorneys, 6,705 RECAP document metadata records, and 16 official court HTML sources. The document source marks 1,076 available and 5,629 unavailable; no document destination is independently fetched. These are collection receipts, not a claim that all rows have been imported into Supabase.

`split-docket-scope.py` accepts only a complete, checksum-verified docket JSONL and separates known uploaded native IDs or explicit native IDB foreign-key associations from unconfirmed MDL status/case-type candidates. The source-complete and current-member-complete flags are separate. Derived docket-to-FJC associations preserve both source hashes and the upstream explicit MDL value, identify their historical administrative meaning, and leave master/member role unknown. Publication still requires privacy review even for an exact source association.

Reference court CSVs include two publisher testing-jurisdiction `T` rows, which the public CourtListener Court API excludes. Preserve the originals privately but quarantine them from maps and public court catalog projections. An empty jurisdiction or anomalous code requires an explicit mapping review rather than guessed normalization.

## Verified private citation import

The assigned follow-up import uses the private run `494cfa52-74c5-42ac-a770-80e46b9a3035` on the correct external project. Twenty checksum-verified batches wrote 15,893 observations and versions, with 15,881 current-entity writes. Twelve older bulk cluster observations remained versioned without replacing newer REST headers. Independent database counts match all eleven imported entity types, including the separate additional FJC scope. This receipt does not include the reference, original FJC, live docket, or large docket imports owned by other workers.

`prepare-native-citation-relations.mjs` verifies each complete input file against its manifest, retains publisher-native foreign keys, validates the source entity-version hash and actual foreign-key value again in SQL, and emits resumable private relationship batches. Three batches wrote 5,295 relationships with no inferred edges. Citation relation records retain separate citing and cited opinion endpoints; cluster records retain their own IDs and exact native opinion resource URLs. No fabricated full opinion record is created. The import-time target-presence flags need refresh after later docket imports; an absent local target does not invalidate the publisher's foreign key.

The private cache contains `metadata-small-import-checkpoint.json`, `metadata-native-relationships-checkpoint.json`, and `metadata-acquisition-import-receipt.json` with per-file hashes, per-type counts, database receipts, and coverage qualifications. The selected graph remains partial; all downloaded originals and selected completed files are separately distinguishable from imported observations and current entities.

## Cumulative counters and historical FJC coverage

The original Xarelto entry-scope manifest records 40 responses over two pages, while the append-only JSONL and original four linked cached pages contain 80 distinct native entries. The collector previously checkpointed only after a pagination call returned; an interrupted pass could therefore save rows without saving its cumulative counter. A later bounded replay could report only the cached pages it traversed. The original files are preserved. `live-cumulative-entry-scope-receipt.json` records the actual cumulative native counts and the fourth cached page's next URL. Its totals are 5,727 entries: 5,047 across five complete scopes and 680 across ten partial scopes. Future collection now checkpoints each completed page before requesting the next one. Response counters and distinct cumulative native IDs remain separate measures.

Both complete 10,323,280-row FJC scans agree on the source MDL-number distribution. The two disjoint selected files contain 365,845 distinct native rows across 14 of the 17 requested MDL numbers. MDLs 3047, 3081, and 3094 have zero source-snapshot matches. These are explicit complete-scan zeroes, not statements that the litigations have no cases. `fjc-source-scope-receipt.json` records each requested scope, including zeroes.

Selected ordinary `year_of_tape` labels span 2013–2021. Another 297,821 rows carry `2099`, which the [publisher model](https://github.com/freelawproject/courtlistener/blob/main/cl/recap/models.py) defines as pending source records. Preserve that native value but exclude it from calendar-year plots and label it as pending in the source administrative data. Neither that flag nor a September 2026 export filename establishes current 2026 case status. The FJC selections remain historical administrative associations, not a current MDL member census.
