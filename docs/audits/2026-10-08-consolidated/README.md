# Legal Source Compass — consolidated implementation checkpoint

**Audit date:** October 8, 2026, America/Chicago (capture/test timestamps use UTC).
**Repository base:** a3cec83d188ec318b221e2911230ac011ebbf228.
**Delivery:** source patch and evidence checkpoint; not deployed, not a legal certification.

## What changed

This patch combines the original calculator safety fixes and Maine/Wyoming corrections with new California ingestion repairs, New Jersey source-bound staging, and cross-file calculator authority checks. Apply it to the recorded base or review/cherry-pick into a newer branch. Do not apply the overlapping older patch on top of this consolidated patch.

### California: complete captured export staged, current law not certified

The official publisher archive was re-captured and verified at 1,288,351,194 bytes, SHA-256 **2b443092fc6ad7fbee78d694dd885ec9a44337ebc2b9557980c8846d27978f2c**. The original is https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip . A 2025 export filename is not a verified legislative cutoff; the directory also carries later daily exports/deltas. The rule app must not assume a filename or download date establishes operative law.

The revised parser processed 162,526 section rows and 162,526 table-of-contents version IDs, with zero parse failures and zero empty section texts. The adapter then completed a candidate packet with **162,526 units, 162,526 sections and 315,473 content-addressed objects**, with zero missing-text gaps. The existing generic lander passed its local structural preflight. No database run was opened and nothing was published.

Three substantive repairs:

1. The previous XML traversal could move parent tail text ahead of nested inline text. A source-order renderer now preserves inline text/tail order and blocks document-type/entity declarations. Regression tests demonstrate the old wrong order and the corrected result. This is a parser correctness repair; it is not an independent substantive-law comparison of every rendered section.
2. The adapter previously recorded constructed individual statute URLs as successful page captures despite acquiring their text from a ZIP. It now records the actual archive/member retrieval and preserves the constructed display URL separately. It retains each original LOB, parent archive SHA, derivative SHA and original publisher-member name.
3. The adapter rehashes the archive; checks the parse summary's exact archive binding; verifies every sequential publisher-table ID, law code, section number, version ID, LOB member and citation occurrence; re-renders the original XML; rejects changed text/identities and duplicate unit keys; refuses to overwrite an existing landing directory; and records legislative-through-date as unknown rather than trusting an asserted export-year cutoff.

The single TOC-proof record represents a bulk publisher table, **not 162,526 independently re-fetched official section pages**. Section headings and full chapter/article hierarchy still need independent publisher review. The packet's release-holds file explicitly keeps publication and calculator activation false.

### New Jersey: exact source spans staged, two occurrences quarantined

Official directory: https://pub.njleg.gov/statutes/ . All three fresh archives match the previously observed archive hashes. The preexisting paired TXT/RTF parser again produced 70 title/appendix blocks, 56,331 section occurrences and 56,309 distinct citation keys. The section-index SHA-256 is **fe5e22b9fc42f42727ce6bf19b3960b8de4842be4b48d9aa1e78a4602242f9ff**.

The new offline stager replays the original styled RTF headings against the unchanged CP1252 source TXT; verifies all archive/member hashes, title and section boundaries, Unicode-code-point spans, parsed identities, occurrences and text hashes; and creates the existing lander's normalized units/sections/objects format.

Output: **70 title units and 56,329 candidate section occurrences**, plus **2 quarantined occurrences**. The candidates have distinct native IDs and remain unactivated. A source occurrence labelled 48:3-89 was physically placed under Title 49; one labelled 52:12A-44 was under Title 58. They were preserved with their original full text and spans, not moved into inferred titles. These are source/parser-identity discrepancies, not conclusions about the legal validity of the underlying statutes.

The original file retains 5 heading anomalies, 2 unmapped source blocks, and 20 repeated citation groups whose operative versions are unresolved. Only title-and-section hierarchy is represented in this packet; chapter/article completeness is a recorded hold.

The statutory body's publisher marker says **P.L.2026, c.30 and J.R.1**; the separately captured legislative-counsel TOC says **P.L.2026, c.90 and JR 2**. Both are retained literally. The candidate is not certified as synchronized/current law. The generic completeness preflight correctly refuses the New Jersey packet because 56,331 original markers cannot be represented as only 56,329 admitted candidates. The generic row-builder separately validated the 70 + 56,329 candidate contract rows and all publication/calculation flags were false.

### Calculator: enforce real rule/source bindings

The new bundle-binding validator rejects wrong-state sources, wrong-state or wrong-claim rule IDs, narrow variants substituted for general rules, inconsistent display/computation status, conflicting evidence grades, and duplicated variant IDs. Historical rules with the same subtype but different rule IDs remain permitted. One preexisting synthetic Louisiana test incorrectly referred to its fixture's Texas source; it now references its Louisiana fixture source instead.

The earlier fixes are included: unsupported weekend extensions across separate outer limits are withheld; missing/stale/lost counting evidence does not support an extension; both discovery dates are checked; unsupported runtime period units are rejected; and counting authorities appear in the result evidence. Those are conservative safeguards, not a conclusion that no repose deadline can ever be extended under any jurisdiction's law.

Maine's chapter-link discovery preserves publisher numeric URL suffixes. Wyoming's parser preserves lettered UCC article identities and does not absorb those sections into the preceding numeric section. Those repairs have regression tests, but the existing production Maine/Wyoming data have not been rebuilt or replaced in this session.

## Verification

- Live limitations release inspected: **2026-10-08.8**; 888 rules.
- **1,039 of 1,039 retained authority texts** matched expected byte lengths and SHA-256 digests. This verifies retained evidence integrity, not legal currency.
- **913 limitations tests passed across 17 files**, including 16 restored deadline-safety cases and 10 new bundle-binding cases.
- New Jersey parser/concordance/staging: **14 tests passed**.
- California adapter: **6 tests passed**; XML order/security: **3 tests passed**.
- Maine: **5 tests passed**; Wyoming: **5 tests passed**.
- TypeScript no-emit typecheck, changed-file ESLint and production build passed. Whitespace/diff check passed.
- Full repository suite is **not green**: 1,486 passed, 1 executed failure, 14 affected test files including fixture-load failures. The non-limitations private datasets required by those suites are not present in this isolated checkout. Failures are preserved in the verification report, not disabled.
- No independent second-agent review, attorney signoff, full browser end-to-end run, or all-state substantive-law certification is claimed.

## Production remains incomplete

Read-only database observation at 2026-10-09T02:22:04.920112Z showed **42 published state collections plus D.C.** The held entries CA, HI, KS and NJ were still acquiring. AR, GA, MS and TN were absent from this publisher-code state view. This is a view of one ingestion system, not proof those jurisdictions have no material elsewhere in the app.

There are still **14 unrecorded general claim cells**: AR defamation/intentional tort/warranty/legal malpractice; GA intentional tort/warranty/legal malpractice; MS defamation/intentional tort/warranty/legal malpractice; TN defamation/intentional tort/warranty. No periods were invented to fill the matrix. Publisher access/licensing, current primary statutory text, controlling claim classification, historical law and exceptions still need to be resolved. No all-state current-law or production-quality certification is justified by the present results.

GitHub branch creation was retried and returned **403 Resource not accessible by integration**. Thus no remote branch, PR, deployment, corpus write, public-projection switch or calculator release activation exists for these changes.

## Resume without repeating acquisition

The current work resides in the **persistent** Vercel sandbox named **compass-state-code-recovery-20261008**, project **prj_gSxA7XwkuuiDgdF4ViO2GfIaHZ8C**, team **team_lkQyPS4ULQL24IhczOUMm9rZ**. Evidence directories:

- /vercel/evidence/ca/raw, /vercel/evidence/ca/parsed-v2, /vercel/evidence/ca/landing
- /vercel/evidence/nj (raw ZIPs and receipts), /vercel/evidence/nj/parsed, /vercel/evidence/nj/staged
- /vercel/evidence/limitations (verified bundle and all retained texts)
- /vercel/checkpoint (capture, test and preflight logs)

Snapshot status/ID and expiration are supplied separately after saving. The downloadable package includes source changes and checkpoint reports, **not the multi-gigabyte source corpus**. Snapshot retention is finite, not permanent storage, and no process continues running after snapshot/stop.
