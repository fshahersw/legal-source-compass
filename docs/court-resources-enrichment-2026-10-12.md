# Court resource and artwork enrichment — October 12, 2026

Court profiles now group resource links recorded in their exact corpus profile or the reviewed protected snapshot into rules/orders, forms, filing/case access, fees, services and the court website. No service paths are guessed, and no resource rows are shipped in static frontend files. A missing link remains “not recorded.” On an exact URL match, the reviewed source label and category appear on the card; the earlier corpus label remains available in source details. This prevents generic older “Forms and court resources” labels from misclassifying rules as forms.

The same court page passes its recorded local image links into the artwork component. Federal artwork cannot be assigned to an explicitly recorded state court through a short-ID collision. Failed images fall back to labeled court types, state location markers or agency markers; failure of one image does not suppress an image for a different entity.

State navigation accepts an exact state identity or an explicit leading USPS code followed by the corpus's dash-separated provenance note. It does not infer a state from the court name. This restores the California breadcrumb for the recorded `CA — state name printed in the CourtListener court name` fact.

## Private source evidence prepared

The following exact court homepages were read successfully. Each capture retains original response bytes, a plain-text rendering, original anchor labels/hrefs, and SHA-256 hashes in immutable private receipts. Counts are distinct label/URL pairs selected by resource terms; they are candidates for review, not claims about complete court services or target-link availability.

| Exact court ID | Official source page | Observed resource candidates |
| --- | --- | ---: |
| cand | https://cand.uscourts.gov/ | 45 |
| njd | https://www.njd.uscourts.gov/ | 27 |
| paed | https://www.paed.uscourts.gov/ | 22 |
| flsd | https://www.flsd.uscourts.gov/ | 22 |

Evidence is in ignored `private/court-resource-enrichment-2026-10-12/captures/`. All receipts explicitly say `not_published`. Reviewed links must enter the protected snapshot or the private versioned corpus contract before the app consumes them. This capture did not change database data, release a held collection, download docket PDFs or resume a collector.

`scripts/enrichment/capture_court_resources.py` is the reusable bounded capture tool. It requires an exact reviewed court identity and source record; follows only same-host HTTPS redirects; records source failures instead of substituting a proxy; stores up to 4 MiB per page; and refuses output outside ignored `private/`. It uses Python's HTML parser and does not execute page JavaScript.

## Reviewed release prepared

`codex-source-review` reviewed all 116 anchors: 72 approved, 39 excluded, and 5 held. This is an assistant source review, not human certification. Approval establishes that an exact link was observed on the current official homepage and belongs to the stated resource category. It does not certify destination uptime, legal currency or suitability for a particular case.

| Exact court ID | Approved | Excluded or held |
| --- | ---: | ---: |
| cand | 28 | 17 |
| njd | 16 | 11 |
| paed | 13 | 9 |
| flsd | 15 | 7 |

The approved resources comprise 15 rules/orders links, 13 forms links, 25 filing/case-access links, 5 fee links, and 14 court-service links. Exclusions cover duplicate exact destinations under other menu labels, leadership/homepage headings, proposed-rule news, abrogated orders, employment/community announcements, transient notices, a redundant trailing-slash forms link, and the NJD e-filing href with a trailing space. Malformed URLs are not silently repaired.

Five candidates remain held in the private review: NJD's generic “Forms” label pointing to a CJA-specific path; PAED's historical courthouse link; PAED's individual immigration habeas form announcement; CAND's individual hearing-access request form; and CAND's alternate local-rules path. Holds are absent from the new snapshot and do not remove any independently existing corpus record.

The read-only `corpus_detail` export confirms all four exact CourtListener IDs, recorded Federal system, district identities, and official homepage hosts. Its retrieval time is `2026-10-12T17:47:23.980Z`; its unchanged private JSON hash is `6db7e33af714cb15854ec472a7f4e36ef647ec547571881c5be731edd2677952`. The export preserves the corpus's own snapshot/currency qualifications.

Release `2026-10-12.1` is prepared in ignored `private/court-resource-enrichment-2026-10-12/bundle/`:

- Logical snapshot: `court-resources/official-links.json`.
- Bundle SHA-256: `166f2b694da120c4518036224f8107a640c3c10079984d9f9f7938e7280c4923`; 83,375 bytes; 72 resources.
- Review SHA-256: `e4092c58944cf015f5a70e93da54a64adc964f61efa9f2b107f05b1b66029d7a`.
- Storage target: `atlas-private-data/sha256/16/166f2b694da120c4518036224f8107a640c3c10079984d9f9f7938e7280c4923.bin`.

`build_court_resource_bundle.py` requires a separate per-anchor review, retains exact source labels/URLs, and checks original receipt, response and text hashes. It reparses the unchanged HTML to prove every captured anchor and the plain-text rendering. Its `--verify-bundle` mode independently reconstructs all content except the build timestamp.

`stage_court_resources.mjs` defaults to a local validation run. It uses the same strict schema as the app, compares reviewer/rationale/time and every provenance field, verifies the exact court identity export, and invokes the raw-source reconstruction before any storage operation. Explicit bare `--execute` enables content-addressed private uploads with no upsert and mandatory hash readback. Each object intent and outcome is journaled privately before the next object, preserving cleanup evidence after partial failure. `--activate` additionally requires execution and changes only the local court-resource manifest entry and manifest timestamp, with the previous manifest retained privately. Neither command deploys the app.

The client reads the fixed logical snapshot through the existing `/api/bundles` allowlist and byte/hash verification. It merges only matching exact court ID and recorded system. Missing publication falls back to existing corpus resources; denial, invalid evidence, or loading failure remains distinct and offers retry.

The coordinator subsequently executed the staging tool: all 16 private objects were created and hash-verified on readback, including the 72-resource bundle and its source/review/identity evidence. The local manifest now points to the reviewed bundle. No database projection was written. The code and manifest still require deployment before the production application uses this release. The successful private receipt is `storage/9a00de233acb9454f8380141cf5f0aaccef4bd9f0027c83be295aa7a1b42c059.readback.json`; the per-object journal is `storage/89ee65e8-b141-4e1c-979e-a8c589cc5bd1.objects.jsonl`. The previous manifest is preserved with SHA-256 `c60660d18bde935fc81dd24f5cf097dc6222688d3c9f326656b99e05eac90f03` in the same private storage-evidence directory.

## Artwork verification

All five registered official court images (cand, njd, paed, flsd, scd) were read again from their recorded image URLs and exactly matched the SHA-256 of their existing local assets. No image bytes or license claims were substituted. Source readback receipts and unchanged response bytes are in ignored `private/court-resource-enrichment-2026-10-12/artwork-readback/`.

`node scripts/enrichment/verify_court_artwork.mjs` checks local registered assets. Add `--check-sources --output=private/<review-directory>` for bounded official-source reads and immutable receipts. On this Windows setup Node required `--use-system-ca` to use the installed certificate authority. A prior failed default-CA attempt remains in the evidence and is not counted as a successful source check.

## Validation

Thirty focused court-resource/state/artwork/visual-registry tests, ten Python capture/builder tests, and nine staging tests passed. The staging dry run accepted the actual 72-link release with zero uploads and no activation; the subsequent operator execution has the separate verified storage receipt above. CI's ordinary `verify` chain now includes the Python suites and offline local-asset hash verification as well as the frontend and Node contracts. The nine staging tests also passed under CI's Node 22 runtime as part of 228 offline Node contracts. Scoped frontend ESLint passed. Browser rendering and deployment remain part of the integrated application verification pass; source reads establish saved evidence rather than successful deployment.
