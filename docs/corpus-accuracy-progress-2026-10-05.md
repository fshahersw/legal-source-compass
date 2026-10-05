# Accuracy and interface progress — October 5, 2026

## Shipped source corrections

The bounded CourtListener refresh checked 41 pinned native docket identities. Four access-blocked scopes remain blocked. The guarded public projection refreshed 34 existing master-docket records with source checks and retained before-images; 17 last-filing dates changed. Original selection dates remain separate from source-check dates. This does not establish complete or current member-case coverage.

Run `65881579-a4ad-462a-a4ca-70aa36063a62` subsequently retained 405 docket-entry observations and 896 nested RECAP document observations. MDL 3114 reached the final entry page; 16 other selected masters retain partial cursor coverage. No PDF acquisition is implied by these metadata observations.

## Interface and document identity

The app has four shorter navigation sections, a matter-oriented home map, stronger contrast, and court marks downloaded unmodified from official court sites. `public/court-marks/manifest.json` records image sources and checksums. Source details and historical document samples are disclosures instead of large default text blocks.

Verified PDFs are grouped only by complete SHA-256, preserving every provider/native-case/native-document occurrence. Filtering promotes a matching occurrence without losing aliases. Timeline joins use exact native entry identities; identical bytes alone never assign a file to another docket entry. Held documents remain separate. A claimed complete coverage flag is rejected when captured rows fall below the source total. Unknown native case IDs cannot merge cases.

GovInfo records now participate in document parsing and downloads. An actual GovInfo PDF request returned HTTP 206, the expected content hash, and `%PDF-1.6` through the app. Loaded raw source counts, rejected records, held records, and unique open PDFs have distinct meanings.

## Validation and remaining limits

The full application suite passes: 68 files, 618 tests passed, one skipped. TypeScript and the production build pass. The generated legal contract check passes with LF-normalized hash inputs.

The separate database legal-deployment gate returns `passed: false` because a reviewed deployment baseline has not been established. This gate was not bypassed and no reviewed baseline was invented. Its detailed validation result is retained privately.

The storage audit verified all 21 registered archive manifests and their 1,496 chunk keys. All inventoried references resolve without size conflicts. It reduced apparent unreferenced storage from 9,542,053,304 bytes to 217,348,229 bytes across 2,612 objects. Those residual objects require further reference and byte checks; none has been deleted on the basis of this inventory.

Raw evidence, private before-images, source payloads, and validation logs remain in the ignored `private/audit-2026-10-05/` directory. Credentials are outside the repository. Broad corpus completeness and nationwide legal currency are not claimed.
