# New Jersey bulk statutes — October 5, 2026

The connected Firecrawl plugin exposed the Legislature's [official bulk download listing](https://www.njleg.gov/legislative-downloads?downloadType=Statutes). Direct HTTPS requests then captured the complete statutes, constitution and legislative counsel table of contents in TXT/RTF ZIPs, plus the publisher's README. The archives are original response bytes; the separately preserved Firecrawl listing is provider-rendered evidence, not original HTTP HTML.

| Original | Bytes | SHA-256 |
| --- | ---: | --- |
| STATUTES-TEXT.zip | 41,343,034 | `9f023fb58e395ed4ab40c066890aa7f87408a91bfb7d3649a94f6b27833d1b97` |
| NJCONST-TEXT.zip | 86,969 | `bd754b1f681e08ac33a97263ae60edee2fddd73579375d3a51ccd0d43fef8a10` |
| LCTOC-TEXT.zip | 959,699 | `60bb324656954b8174d2a0557b07b10093e197f71ce6d895bc81db1e56cff2d0` |

All six archive members passed CRC and SHA-256 checks. The parser retains each member unchanged, strictly decodes CP1252, and records Unicode-code-point spans against an LF-normalized UTF-8 derivative. Paired RTF title/headnote styles establish the TXT boundaries; a body quotation of an upcoming heading cannot become the section boundary.

Use `private/audit-2026-10-05/full-state-codes/nj/parsed-v5/`: **70 native title/appendix blocks, 56,331 section occurrences and 56,309 distinct citation keys**. Twenty repeated citation groups retain their separate ordered occurrences. Eight legitimate parenthetical/punctuation headings were added over v4. Five publisher headnote anomalies remain explicit, including two unmapped blocks: printed `9-3A-7` and a section-reallocation notice. Their text is retained without inventing an identity. Two compound RTF headnotes contain body text followed by the next actual section heading; the original spans remain preserved. Constitution and counsel TOC text are fully captured, but their detailed structure and cross-reconciliation remain unfinished.

An independent offline audit rehashed all three ZIPs, six members, 70 title files and every section/heading span. Six parser regression tests pass, including quoted headings, compound source paragraphs, printed subsection identifiers, escaped RTF and unsupported controls. Section JSONL SHA-256: `fe5e22b9fc42f42727ce6bf19b3960b8de4842be4b48d9aa1e78a4602242f9ff`. Audit: `nj/independent-audit-v5/audit.md`. Earlier failed and superseded derivatives are retained; do not import v1–v4.

The download listing and ZIP timestamps say October 3, 2026, but the statutes' own compilation marker says **through P.L.2026, c.30 and J.R.1**. The counsel TOC instead says **c.30 and JR2**. These distinct source markers are preserved. Neither file modification time nor retrieval time certifies current legal effect. Later enactments, historical transitions and calculator applicability still require review. A fresh chapter-laws index retrieval returned a loading shell, not an enacted-law inventory.

The bounded limitations concordance now maps all **50 captured sections in Title 2A, Chapters 14 and 31** to exact body spans and hashes, with 19 counsel TOC history records and 22 literal citation references. Printed ranges remain intact. The TOC labels 2A:14-18 repealed, while no matching body heading appears in this compilation; the unmatched reference is retained for review. Use `lctoc-reconciliation-2026-10-05-v4/`, which adds body/span revalidation and corrects the distinction between the download-listing hash and member-inventory hash. Other titles' TOC mappings remain open.

The browser subsequently loaded the official 2026 chapter-laws inventory: two observed pages through chapter 50. All **20 exact enacted-law PDF links for chapters 31–50** were captured (4,743,064 bytes) and extracted with page provenance (235 pages; 632,932 characters). The extraction screen found no page below 30 characters; this does not certify every image as machine-readable. Original PDFs and receipts are under `later-laws-2026-c31-50/`. Enactment text, additions/deletions, approval dates, effective clauses and code impacts still require legal reconciliation; a keyword search alone cannot establish an unchanged rule. The separately observed joint-resolution filter listed JR1; the differing TOC JR2 marker remains unresolved.

No full-code cloud registration, public projection, hold release or calculator activation has occurred for this capture. The next steps are broader TOC/body reconciliation, review of the downloaded later enactments and limitations authorities, private registration and a separately verified application projection.

Raw archives, request headers, hashes, receipts and provider listing captures: `private/audit-2026-10-05/full-state-codes/nj/firecrawl-1918/`. Reusable parser and tests: `scripts/legal/state-codes/nj-parse-bulk.py` and `test_nj_parse_bulk.py`.
