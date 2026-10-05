# District of Columbia full-code capture — October 5, 2026

The complete publisher HTML repository archive and bulk search export are captured, independently hashed after download, and retained privately. Parser v2 recovered **all 28,272 code articles: 24,640 section pages and 3,632 outline pages across 55 publisher title nodes**. Every article's complete non-whitespace character sequence, including notes, matches the publisher's separate search export. There are zero missing, extra or duplicate article identities. This closes acquisition for the dated publisher edition; private intake, browsable app publication and later-update reconciliation remain open.

The [Council's official law library](https://code.dccouncil.gov/) identifies its code and laws as public domain and expressly directs bulk consumers to its [HTML repository](https://github.com/dccouncil/law-html). That publisher evidence and the repository/API responses are retained. The source was acquired from its bulk endpoint, without crawling individual source pages.

## Exact source version

- Repository commit: `613cfbf08d42a77cbdad738cc06596e1216649cd`.
- Publisher metadata: built and codified **May 19, 2026**. The branch name `publication/2021-10-18` is not its edition date; metadata at the exact commit supplies the date.
- Complete repository archive: **105,987,187 bytes**, SHA-256 `733998c23cb891055feb7bcfd7d984dc83814afe1b9cd60f6bd88729c2b11325`.
- Publisher search export, `index.bulk.zip`: **31,964,329 bytes**, SHA-256 `1f2c989644b4926ea0b58b44369f71c93be7460a3be75c14d9175fd18e93c263`. The downloaded object's Git blob identity also equals the pinned publisher tree entry.
- Publisher metadata: **1,094 bytes**, SHA-256 `4bc5b5b72cedfa02bcf2778c3a1a31fd8fa3d956eeb60a5f96a1dbddc65c08f6`.
- Repository archive inventory: **44,276 regular files / 729,196,110 uncompressed bytes**. Its code subtree includes **29,534 HTML files**, including alternative whole-chapter renderings; this file count is not a section count.

Source receipts record the exact URL, final URL, HTTP status, retrieval time, complete byte count and digest. Originals are under `private/audit-2026-10-05/full-state-codes/dc/bulk-capture-20261005/`. No downloaded repository script or executable was run.

## Parser and remaining work

The offline [parser](../scripts/legal/state-codes/dc-parse-bulk.py) retains the complete article text, including amendment notes and cross-references, while omitting site navigation. It preserves every raw archive member's hash and source-native page identity. It handles all 663 Title 28 colon citations with tilde filenames through exact agreement between the article heading and canonical URL. The complete limitations chapter includes all 11 observed sections, §§ 12-301 through 12-311, plus its outline. Nothing in that chapter was selected out based on calculator claim coverage.

The independent [whole-text audit](../scripts/legal/state-codes/dc-audit-bulk.py) checks the frozen parser outputs and compares every article against the separate publisher export after decoding its HTML entities and removing its common breadcrumb. Only whitespace is disregarded; this is not a claim of identical layout. `full-capture-audit-v1.json` has SHA-256 `d5fdcb78b7987ff9d38e939feb762aef89d33147fd68be5cec570dfd1d67777b` and reports 28,272 matches, zero text mismatches, zero missing pages and zero duplicate identities.

The publisher TOC has **13 synthetic page targets under § 7-1121** whose headings are embedded in the captured complete compact text. They are not separate archive HTML pages and are not fabricated as separate statutes. The parent text includes the publisher's duplicated “ARTICLE VII” heading; no inferred renumbering is applied. Two other publisher paragraph fragment identities have conflicting labels (§§ 7-581 and 41-155.02); those variants are retained. These are explicit navigation/fragment anomalies, not missing full section bodies. Consequently the literal TOC-to-standalone-page flag remains false while the independent whole-article coverage check passes.

`parsed-v1` stopped on a nullable TOC field after writing its text derivative. `parsed-v1b` completed but revealed the Title 28 filename alias and incorrectly counted paragraph fragments as missing HTML pages. Both are preserved as superseded evidence. `parsed-v1c` is the same first parser with bounded archive reads. Use the completed `parsed-v2/manifest.json` and independent `full-capture-audit-v1.json`, not any v1 parser completion claim.

Nine focused tests pass for complete note retention, excluded site/script text, exact identity, Unicode decoding, archive pin changes, unsafe archive paths, page/fragment separation, and full-character comparison. The whole-source audit separately passed on the real publisher archive.

Next, prepare the immutable private intake and a dated full-code browsing release. Preserve **May 19, 2026** as the publisher codification date, reconcile later source updates, and keep calculator activation separate. Do not label the archive current as of its download date or release the unrelated held Open US Law collection.
