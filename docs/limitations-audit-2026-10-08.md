# Time Limits accuracy audit — release 2026-10-08.1 (live); candidate 2026-10-08.4 (staged, inactive; supersedes staged .2 and .3)

Scope asked for on 2026-10-08: check that the already backfilled state limitation rules still match the current official text, fix what is out of date, fill the remaining gaps from authoritative sources, and improve the state-code reader and the calculator's statute view. This note records what was actually done, with the numbers the release report prints. It does not claim legal completeness.

## What the release contains

| | 2026-10-07.1 (previous) | 2026-10-08.1 |
| --- | --- | --- |
| Rules | 662 | 784 |
| Sources | 946 | 949 |
| Judicial references | 11 | 11 |
| Jurisdictions with rules | 51 | 51 |
| State × claim cells with no rule at all | 213 (204 of them the four claim types added to the calculator this week) | 95 |
| Rules re-read against the publisher this release | 0 | 673 of 784 (493 confirmed, 180 partially confirmed, 71 not rechecked) |

Claim types in the calculator: personal injury, product liability, wrongful death, medical malpractice, written contract, oral contract, fraud, property damage, defamation, intentional tort, breach of warranty, legal malpractice. Cells still "Not recorded" after this release: legal malpractice 35, breach of warranty 30, intentional tort 19, defamation 10, wrongful death 1. Every one of them shows as "Not recorded" in the calculator and in Statutes & sources; nothing is guessed.

## How currency was checked

1. **Direct re-read (491 sources).** Each source URL was fetched again; the exact bytes were kept as a raw capture (content-addressed, SHA-256) and the extracted text was compared with the retained capture. 394 pages were byte-identical around the evidence ("confirmed unchanged"); 357 had changed somewhere on the page but every passage a rule quotes was still present verbatim ("confirmed, evidence intact"); 0 lost a quoted passage.
2. **Official code capture (260 sources).** Where the publisher blocks this environment (Cloudflare challenge, Lexis-hosted codes), the quoted passages were searched in the same publisher's current statute text that is already landed and reviewed in the corpus (44 jurisdictions are public there). This is a match against the publisher's text captured by the state-code intake, not a live fetch, and the site labels it as such ("checked against the official code capture").
3. **Not rechecked (198 sources).** Session laws, PDFs on hosts that refuse the request, and sources whose jurisdiction has no reviewed code in the corpus. They keep their original capture, hash and retrieval date; the calculator shows "Not re-read" for them. 40 rules cite only such sources and carry no literal passage; they are shown with a lower evidence grade, never hidden.

Grades after the recheck: 717 rules official-capture verified, 28 independently verified, 39 lower evidence grade. 142 grades changed as a result of the recheck.

## Corrections applied (23, each with a quoted basis)

- Florida ch. 2023-15 (HB 837): § 95.11(3)(a)/(4)(a) split into causes accruing through 24 March 2023 (four years) and after (two years); the correction follows § 28 and § 31 of the act.
- Louisiana Acts 2024, No. 423: the two-year delictual article is prospective only (§ 3), effective 1 July 2024 (§ 4); personal injury, product liability, property damage (movable and immovable) and fraud rules now carry the pre/post variants with that boundary; arts. 3492 and 3493 are recorded as repealed.
- Kentucky KRS 413.140: the captured text is the version effective 15 July 2026 (2026 Ky. Acts ch. 172, sec. 28); the rule says so.
- Nevada NRS 41A.097(1)–(3): "earlier of" structure made explicit and the three injury-date windows pinned to 1 October 2002 / 1 October 2023.
- Medical malpractice "later of / earlier of" structure corrected for Florida § 95.11(5)(c) (including the minor-under-8 carve-out), Illinois 735 ILCS 5/13-212(a), Maryland CJP § 5-109(a), Montana § 27-2-205(1), West Virginia § 55-7B-4(a) and (b).
- Utah § 78B-6-706: product liability runs from discovery, as the section says.

No correction was applied without a verbatim passage from the cited capture; the ledger is in the release bundle (`corrections.json` evidence ids are in each rule's provenance).

## New entries (122 rules across 51 files)

Verified 118, flagged 4 (shown with the flag), not recorded 104 cells left open on purpose. The mechanical verifier (`scripts/limitations/backfill/verify-entries.ts`) reports 0 errors; its 164 warnings are all "lastAmended not recorded" (115) or "accrual rule not recorded" (49), which the site prints as "Not recorded".

## Things still open

- 198 sources could not be re-read from the publisher and have no reviewed code capture to match against; they are listed per state under Statutes & sources with "Not re-read".
- Three source matches need a human: the New Hampshire opinion PDF, the Pennsylvania MCARE session-law source, and two South Dakota sections that match the same passage.
- North Dakota `nd-ch28-01-3` and `nd-ch32-21` point at the publisher's whole-code JSON (about 64 MB). A fresh copy is retained as a raw object only (`freshTextOversizedKeptAsRawOnly` in the release report); it is not bundled as text because it exceeds the release text bound and no rule quotes it literally.
- Full-code reader: Arkansas, Georgia, Mississippi and Tennessee have no landed code; California, Hawaii, Kansas and New Jersey are acquiring with projection off. Adding them is an intake job against the corpus, not something the site can do.
- Outline reader: the v3 outline function (`database/contracts/corpus-publisher-code-projection-v3-outline.sql`) still has to be applied in the corpus project; until then the site uses v2 and says so wherever a publisher skips a declared level (Louisiana 48 of 54 titles, Pennsylvania 12 of 51, New York 7 of 94, Connecticut 2 of 110 on the first click).

## Release handling (done 2026-10-08)

Pre-checks on the draft: `scripts/limitations/verify.mjs` passes except for one PDF-URL source (`bf-al-nj-mccarrell-2017`, a proxied JSON capture of an njcourts.gov opinion) that the previous release already carried in the same form; the app-side validator accepts the bundle; all 773 Time Limits tests pass with `LIM_BUNDLE_DIR` pointed at the draft; the entry verifier reports 0 errors.

Staged with `scripts/admin/stage-limitations-release.mjs --execute` (raw captures first, then release files, every object read back and hash-compared; no upsert; live manifest untouched): 527 raw capture objects (270,670,560 bytes; 184 uploaded, 343 already present), 1,064 release files in 1,010 objects (71 uploaded, 939 already present). Staged manifest `atlas-private-data/staged-releases/limitations-2026-10-08.1/manifest.00097738556576d9691ab8a2e193f8a68938d24426b7ae10a722aa879504dae1.json`, SHA-256 `00097738556576d9691ab8a2e193f8a68938d24426b7ae10a722aa879504dae1`; capture index SHA-256 `8bd51f60032f4abf9b777ac245de8b6960da0bfbe8b9e39f3294905f296cbb90`. All 958 raw capture objects the release's sources and judicial references point at were confirmed present by a separate HEAD pass.

Activated with `scripts/admin/activate-limitations-release.mjs --verify`: `src/lib/private-data/manifest.server.json` now lists 1,064 `limitations/` entries (was 964; `limitations/backfill-discrepancies.json` retired, nothing in the site reads it; all non-limitations entries unchanged). The previous manifest is kept at `/tmp/lim/manifest.before-2026-10-08.1.json` for this session, and every 2026-10-07.1 object is still in storage, so reverting is a one-file change. The preview served 2026-10-08.1 immediately; the published site serves it after the next publish.

Browser check after activation: Florida personal injury accrued 2024-01-15 → 2026-01-15 (two years); Louisiana personal injury accrued 2025-01-10 → 2027-01-10; Louisiana accrued 2023-06-01 under the current article issues no date and offers the one-year art. 3492 version instead. No console errors.

## Round 2 — release 2026-10-08.3 (staged 2026-10-08, NOT activated; superseded by 2026-10-08.4 below)

Owner decision: stage only; the owner activates. The staged-but-stale candidate 2026-10-08.2 (manifest `d7b321a4…`) predates the New Jersey and case-law corrections below and must not be activated either; it stays in storage as an inactive staged manifest.

| | 2026-10-08.1 (live) | 2026-10-08.3 (staged) |
| --- | --- | --- |
| Rules / sources / judicial references | 784 / 949 / 11 | 888 / 1,021 / 11 |
| State × claim cells with no rule | 95 (105 after the claim matrix was re-counted per variant) | 14 |
| Entries added / superseded / corrected | — | 107 / 3 / 2 |
| Grades: official capture verified / independently verified / lower evidence | — | 787 / 28 / 73 |
| Sources not re-read · rules without a literal passage | 198 · 40 | 198 · 40 (unchanged; see Things still open) |

What was added (107 rules in 42 state files, every one quoting a literal passage from a retained official capture): breach of warranty 25 states (sale-of-goods four-year sections plus the stated exceptions — Oklahoma five years, Wisconsin six, Colorado's §13-80-101 cross-reference, Florida and Louisiana under their own civil-code periods), legal malpractice 37 states (claim-specific sections where the state has one — e.g. Vermont, Alaska and West Virginia's separate contract-theory and personal-injury variants — otherwise the general period with the state's own classification case), intentional tort 26 states (with West Virginia's false-imprisonment variant), defamation 12 states, and one wrongful-death cell (Iowa). Each new rule carries a `basis` of `claim_specific` (42) or `general_period` (65); the calculator prints the basis and, for general-period rules, a caution that no provision naming the claim was found in the reviewed text.

Case-law review: every decision cited in a new entry's accrual or classification note was checked against the opinion text (official court PDF where the court publishes one — Louisiana, West Virginia — otherwise the CourtListener reproduction, which is recorded as a secondary host, not an official capture). Corrections made before staging: West Virginia false imprisonment now cites Wilt v. Buracker, 203 W. Va. 165 (1998) and Canterbury v. Laird (not a usury case that an earlier draft had named); West Virginia defamation accrual is the discovery rule from Padon v. Sears, 186 W. Va. 102 (1991); South Carolina legal malpractice notes that Stokes-Craven Holding Corp. v. Robinson, 416 S.C. 517 (2016) overruled Epstein v. Brown's accrual holding while keeping the three-year period; Hawaii names Blair v. Ing; New Jersey legal malpractice is the single six-year §2A:14-1 period per McGrogan v. Till (§2A:14-2 is cross-linked only); the Arizona, Oklahoma, New Mexico, Minnesota, Oregon, Utah, Washington and Rhode Island sentences were tightened to what the opinions actually say.

Louisiana historical variants: former La. Civ. Code art. 3492 (one year, occurrence accrual) is added for defamation and intentional tort, bounded to accrual dates on or before 2024-07-01 by Acts 2024, No. 423 §3 (prospective only; enrolled HB 315 captured from the legislature). The repealed article's text comes from the Louisiana Supreme Court's own statement of it in Smith v. Citadel Ins. Co., 2019-00052 (La. 10/22/19) (lasc.org opinion PDF) and the legislature's SB 149 printing marked "existing law" (the bill itself was not enacted and is not cited for anything else). The engine behaviour is pinned by `engine.test.ts` ("applies former art. 3492's one-year period …"), which skips on bundles that predate the variant.

Capture hygiene: `scripts/limitations/backfill/capture.py` now stores proxied markdown as plain text (raw bytes kept untouched; `textNormalization: markdown-to-plain` recorded), covered by `src/lib/limitations/captureText.test.ts`. The three supersessions (Idaho defamation, Idaho intentional tort, Pennsylvania defamation) replace rules whose quoted passage carried link or emphasis markup with the same period and pinpoint quoted from the direct official page.

Pre-checks on the candidate: entry verifier 107 entries, 0 errors, 9 warnings (all "accrual rule not recorded": AK, MN and VA legal malpractice, ID and NE defamation and intentional tort, PA defamation — shown as "Not recorded"); `scripts/limitations/verify.mjs` passes (1,021 sources, checksums); 863 Time Limits tests pass with `LIM_BUNDLE_DIR` pointed at the candidate; browser calculations against the candidate: LA defamation pre-2024 variant 2023-06-01 → 2024-06-01, LA defamation current 2025-01-10 → 2027-01-10, LA intentional tort pre-2024 2024-03-15 → 2025-03-15, LA defamation 2023-06-01 under the current article → no date, offers the art. 3492 version; WV defamation and false imprisonment 2025-03-01 → 2026-03-01; SC legal malpractice → 2028-03-01; NJ legal malpractice → 2031-03-01; RI defamation → 2028-03-01. No console or page errors.

Staged with `scripts/admin/stage-limitations-release.mjs --release=2026-10-08.3 --execute`: 126 raw capture objects (15,916,332 bytes; all already present), 1,136 release files in 1,081 objects (5 uploaded, 1,076 already present), every object read back and hash-compared, live manifest untouched. Staged manifest `atlas-private-data/staged-releases/limitations-2026-10-08.3/manifest.cce4601ba96eff5bac594328adeda2f33ab1be90ba1d7d409817b4b85460ed02.json`, SHA-256 `cce4601ba96eff5bac594328adeda2f33ab1be90ba1d7d409817b4b85460ed02`; capture index SHA-256 `602e2b1644628e84ffb78dadc8055389715e0c62916003693f9c1c92d03dbccf`. A separate read-only HEAD pass found all 1,136 manifest entries and all 909 raw-capture objects the release points at (1,990 checked, 0 missing).

To activate (owner): `node scripts/admin/activate-limitations-release.mjs --release=2026-10-08.3 --verify`, then publish. Reverting is the same one-file manifest change back to 2026-10-08.1; every 2026-10-08.1 object stays in storage.

Still open after round 2 (see round 3 for what changed): 14 "Not recorded" cells (AR 4, GA 3, MS 4, TN 3 — gated compilations); 198 sources not re-read and 40 rules without a literal passage; three source matches for a human; historical versions only where an official act documents the boundary.

## Round 3 — release 2026-10-08.4 (staged 2026-10-08, NOT activated)

Owner decision unchanged: stage only; the owner activates. Candidate .4 contains everything in .3 (same 888 rules, same 107 additions, 3 supersessions and 2 corrections, same 14 open cells) plus a third currency route for the sources neither the direct fetch nor the code capture could reach.

**Proxied re-read (`scripts/limitations/backfill/recheck-via-proxy.ts`).** Each of the 198 "not re-read" sources was requested again at the same official URL through a fetch proxy (Tavily; Firecrawl answered HTTP 402 "insufficient credits" after a handful of pages and was not retried). The tool refuses gated publishers and non-official hosts, keeps the proxy's exact response bytes as a content-addressed raw capture (`application/json`, `rawSha256`, `rawStorageKey`), converts the extracted markdown to plain text (`textNormalization: markdown-to-plain`, tested in `captureText.test.ts`), and compares every passage a rule quotes from that source. Matching is literal first; where the extractor renders a passage with different spacing around punctuation or a line-break hyphen, the same spacing normalisation is applied to both sides and the match is labelled `spacing_normalized`. The route is recorded on the source as `currency.route = "proxied"` and shown in the app as "page read through a fetch proxy"; it never produces `confirmed_unchanged` (an extracted copy cannot prove the page is unchanged) and never produces `evidence_lost` (a passage missing from an extraction is a read failure, not a law change).

Outcome of the 198: 70 sources — every quoted passage present in the proxied text; 99 — page returned, no rule quotes the source literally, so no passage was compared (recorded as such); 3 — page returned but the extraction did not reproduce a quoted passage (Kansas combined statute `bf-ks-sol-combined`, 28 passages not reproduced in a truncated extraction; New Hampshire `bf-nh-op-anderson-wood`, the "we follow Cheever's three-year holding" sentence absent from the extracted PDF text; New Jersey `bf-nj-njsa-limitations`, the official download is a ZIP, not statute text) — these stay "Not re-read" with the proxied text retained for manual comparison; 26 — the proxy could not read the host either (California leginfo, Alaska appellate index, Georgia Court of Appeals opinions, Kentucky and Missouri opinion PDFs, Mississippi billstatus session acts, New York courts timetable and GOL 17-101, Tennessee Court of Appeals opinions, Oregon 1967 SB 134, North Carolina opinion, New Jersey Supreme Court opinion) — these stay "Not re-read" with the proxy failure noted. Round-2 entry captures that came through a proxy (35 sources, previously recorded under the direct route as "fetched through a proxy") are now recorded under the same `proxied` route, which is why the direct count falls from 563 to 528.

| | 2026-10-08.1 (live) | 2026-10-08.3 (staged) | 2026-10-08.4 (staged) |
| --- | --- | --- | --- |
| Rules / sources / judicial references | 784 / 949 / 11 | 888 / 1,021 / 11 | 888 / 1,021 / 11 |
| State × claim cells with no rule | 105 | 14 | 14 |
| Sources: confirmed unchanged / evidence intact / not re-read / evidence lost | 394 / 357 / 198 / 0 | 466 / 357 / 198 / 0 | 431 / 561 / 29 / 0 |
| Rules: confirmed / partially confirmed / not re-read | 493 / 180 / 71 | 564 / 196 / 88 | 652 / 177 / 19 |
| Rules without a literal passage | 40 | 40 | 40 |
| Currency routes: direct / official code capture / proxied / none | 491 / 260 / — / 198 | 563 / 260 / — / 198 | 528 / 260 / 204 / 29 |

Pre-checks on the candidate: `verify.mjs` passes (1,021 sources, 51 state jurisdictions, 4 federal statutes, 11 judicial references, checksums); 866 Time Limits tests pass with `LIM_BUNDLE_DIR` on the candidate (the Louisiana art. 3492 test runs, not skipped); `tsgo` clean; browser calculations against the candidate served through `/api/bundles`: HI defamation 2025-03-01 → 2027-03-01, CA personal injury → 2027-03-01, ND personal injury → 2031-03-01, LA defamation pre-2024 variant 2023-06-01 → 2024-06-01, MS wrongful death → no date with the research-only notice (the period rests on opinions applying § 15-1-49, not codified text; the calculator says so and declines to compute). No console or page errors. The two North Dakota whole-code re-reads (61.2 MiB of text each) are kept as raw captures only; the builder now refuses to project a fresh text file larger than 15 MiB and says so on the source.

Staged with `scripts/admin/stage-limitations-release.mjs --release=2026-10-08.4 --execute`: 298 raw capture objects (182,119,961 bytes; 172 uploaded, 126 already present), 1,306 release files in 1,245 objects (168 uploaded, 1,077 already present), every object read back and hash-compared, live manifest untouched. Staged manifest `atlas-private-data/staged-releases/limitations-2026-10-08.4/manifest.679c2912de603c591fec6ce8600e0478293201a77e8af5fbe576a990e0760996.json`, SHA-256 `679c2912de603c591fec6ce8600e0478293201a77e8af5fbe576a990e0760996`; capture index SHA-256 `8592e8126bf629f71e7e48c4e3607495903ae1c14d0988b2c723bfc9f6f33606`. Separate read-only HEAD passes: all 1,306 manifest entries and 298 staged capture objects present (1,543 checked, 0 missing); all 1,199 raw-capture objects the release's sources and judicial references point at present (0 missing).

To activate (owner): `node scripts/admin/activate-limitations-release.mjs --release=2026-10-08.4 --verify`, then publish. Reverting is the same one-file manifest change back to 2026-10-08.1; every 2026-10-08.1 object stays in storage. Staged .2 and .3 remain inactive and must not be activated.

Still open after round 3:
- 14 cells stay "Not recorded" on purpose: Arkansas (4), Georgia (3), Mississippi (4), Tennessee (3) — their official compilations sit behind gated publishers (Lexis/Westlaw containers) and no official capture exists; nothing is filled from secondary summaries. Filling them needs a publisher arrangement or an owner decision on the gated sites.
- 29 sources are still not re-read by any route (26 unreachable through the proxy too; 3 returned but not reproduced verbatim) and 19 rules rest only on them; 40 rules still carry no literal passage (unchanged — the proxy route compares passages, it does not create them).
- Source matches for a human: New Hampshire `bf-nh-op-anderson-wood` (the quoted holding sentence is not in the extracted PDF text) and Kansas `bf-ks-sol-combined` (truncated extraction). The Pennsylvania MCARE source and the South Dakota pair were resolved by this round (MCARE § 513 passages found in the proxied page; South Dakota 22/22 passages matched).
- Historical versions exist only where a boundary is documented from an official act (Louisiana 2024; Kentucky 2026 withholds earlier dates). Other states' earlier periods are not modeled, and the calculator says so when it withholds a date.
- Tolling, repose and counting cross-references and official-opinion precedents are attached only where round 1–2 research recorded them; a systematic pass is still owed.
