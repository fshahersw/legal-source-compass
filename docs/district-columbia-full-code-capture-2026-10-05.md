# District of Columbia full-code capture — October 5, 2026

The complete publisher HTML repository archive and bulk search export are captured, independently hashed after download, and retained privately. This is whole-publication acquisition, not a selection of limitation sections. Parsing and the page-by-page table-of-contents reconciliation are in progress; no DC full-code app release or calculator change is claimed by this checkpoint.

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

The offline [parser](../scripts/legal/state-codes/dc-parse-bulk.py) retains the complete article text, including amendment notes and cross-references, while omitting site navigation. It preserves every raw archive member's hash and source-native page identity. It handles the publisher's Title 28 colon citations and tilde filenames through exact agreement between the article heading and canonical URL. Subparagraph fragment identities are recorded separately from HTML page identities; conflicting publisher fragments remain visible in reconciliation evidence.

`parsed-v1` stopped on a nullable TOC field after writing its text derivative. `parsed-v1b` completed but revealed the Title 28 filename alias and incorrectly counted paragraph fragments as missing HTML pages. Both are preserved as superseded evidence. `parsed-v1c` is the same first parser with bounded archive reads. Use the current parser v2 and its completed manifest once available, not any v1 completion claim.

Seven focused tests cover complete note retention, excluded site/script text, exact identity, Unicode decoding, archive pin changes, unsafe archive paths, and the distinction between page and conflicting fragment identities. The current whole-source run is still the authoritative remaining check.

After reconciliation, prepare the immutable private intake and a dated full-code browsing release. Preserve **May 19, 2026** as the publisher codification date, reconcile later source updates, and keep calculator activation separate. Do not label the archive current as of its download date or release the unrelated held Open US Law collection.
