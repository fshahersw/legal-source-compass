# Time Limits accuracy audit — release 2026-10-08.1

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
- North Dakota `nd-ch28-01` points at the publisher's whole-code JSON (63.7 MB). The fresh copy is retained as a raw object only; it is not bundled as text because no rule quotes it literally.
- Full-code reader: Arkansas, Georgia, Mississippi and Tennessee have no landed code; California, Hawaii, Kansas and New Jersey are acquiring with projection off. Adding them is an intake job against the corpus, not something the site can do.
- Outline reader: the v3 outline function (`database/contracts/corpus-publisher-code-projection-v3-outline.sql`) still has to be applied in the corpus project; until then the site uses v2 and says so wherever a publisher skips a declared level (Louisiana 48 of 54 titles, Pennsylvania 12 of 51, New York 7 of 94, Connecticut 2 of 110 on the first click).

## Release handling (done 2026-10-08)

Pre-checks on the draft: `scripts/limitations/verify.mjs` passes except for one PDF-URL source (`bf-al-nj-mccarrell-2017`, a proxied JSON capture of an njcourts.gov opinion) that the previous release already carried in the same form; the app-side validator accepts the bundle; all 773 Time Limits tests pass with `LIM_BUNDLE_DIR` pointed at the draft; the entry verifier reports 0 errors.

Staged with `scripts/admin/stage-limitations-release.mjs --execute` (raw captures first, then release files, every object read back and hash-compared; no upsert; live manifest untouched): 527 raw capture objects (270,670,560 bytes; 184 uploaded, 343 already present), 1,064 release files in 1,010 objects (71 uploaded, 939 already present). Staged manifest `atlas-private-data/staged-releases/limitations-2026-10-08.1/manifest.00097738556576d9691ab8a2e193f8a68938d24426b7ae10a722aa879504dae1.json`, SHA-256 `00097738556576d9691ab8a2e193f8a68938d24426b7ae10a722aa879504dae1`; capture index SHA-256 `8bd51f60032f4abf9b777ac245de8b6960da0bfbe8b9e39f3294905f296cbb90`. All 958 raw capture objects the release's sources and judicial references point at were confirmed present by a separate HEAD pass.

Activated with `scripts/admin/activate-limitations-release.mjs --verify`: `src/lib/private-data/manifest.server.json` now lists 1,064 `limitations/` entries (was 964; `limitations/backfill-discrepancies.json` retired, nothing in the site reads it; all non-limitations entries unchanged). The previous manifest is kept at `/tmp/lim/manifest.before-2026-10-08.1.json` for this session, and every 2026-10-07.1 object is still in storage, so reverting is a one-file change. The preview served 2026-10-08.1 immediately; the published site serves it after the next publish.

Browser check after activation: Florida personal injury accrued 2024-01-15 → 2026-01-15 (two years); Louisiana personal injury accrued 2025-01-10 → 2027-01-10; Louisiana accrued 2023-06-01 under the current article issues no date and offers the one-year art. 3492 version instead. No console errors.
