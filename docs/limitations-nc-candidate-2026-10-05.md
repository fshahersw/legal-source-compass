# North Carolina calculator candidate — October 5, 2026

This is a **private candidate, not an active or published release**. The live app still uses `.1`; the separately prepared `.2` transaction and uploaded bundles remain unchanged. Browser control of the authenticated Supabase/Lovable session timed out again at 12:24 UTC. Do not skip the predecessor release or describe Git push as publication.

| Snapshot                         | Rules | Conditional baselines | Jurisdictions with a baseline | Statutory sources | Judicial references |
| -------------------------------- | ----: | --------------------: | ----------------------------: | ----------------: | ------------------: |
| Active `2026-10-05.1`            |   118 |                    73 |                            37 |                81 |                  13 |
| Prepared `2026-10-05.2`          |   124 |                    85 |                            44 |                91 |                  13 |
| Private `2026-10-05.3` candidate |   124 |                    86 |                            45 |                92 |                  14 |

The candidate changes the existing NC ordinary-injury rule; it does not add a second competing rule. Its 38 remaining research rules include NC product and wrongful-death branches. The state-source inventory remains one coverage row per jurisdiction, with 51 distinct rows and primary statutory text for 47 jurisdictions. These counts do not claim complete state codes.

## Scope and evidence

The narrow ordinary-negligence branch compares three calendar years from independently confirmed accrual with ten years from the independently confirmed last qualifying act or omission of this defendant. Both clocks must apply. The result is unadjusted anniversary arithmetic, not a verified filing deadline.

- [G.S. 1-52(5), (16)](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_1/GS_1-52.html) supplies the ordinary period, actual/reasonable apparent-harm trigger and last-act provision. The current official HTML was retained and its clean paragraph text replaces the older extraction in the candidate only. CSS and scripts are omitted; the raw version is preserved.
- [S.L. 1979-654, sections 3(b), 7–8](https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/1979-1980/SL1979-654.html) supplies the original provision, preservation of pending litigation and October 1, 1979 effective clause. Both accrual and last-act dates before that boundary remain unavailable. This conservative supported window does not decide retroactivity for earlier nonpending claims.
- [CTS Corp. v. Waldburger, 573 U.S. 1, 8–9, 16–17 (2014)](https://www.govinfo.gov/content/pkg/USREPORTS-573/pdf/USREPORTS-573-1.pdf) supports the distinction between the independent clocks. Its holding concerns CERCLA preemption, not every ordinary accident. The earlier-of implementation is an inference from independently applicable constraints, not a quotation of a universal holding.
- Groundwater and latent-disease cases are excluded. The historical review preserves [S.L. 2014-44](https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2013-2014/SL2014-44.html)'s deletion of the earlier June 19, 2023 sunset; that old sunset must not be applied as current law. Other captured special-claim amendments do not establish an ordinary-negligence exception.

Products, toxic exposure, professional/medical negligence, construction, government and intentional/special claims, minority/disability, tolling, borrowing and prior-filing issues remain excluded. An act after accrual, an accrual after the repose cutoff, unresolved leap-day treatment, missing confirmation or dates after source review withhold a date.

## Integrity and validation

Private packet: `private/audit-2026-10-05/state-law-next/release-3/`. Its manifest identifies all files, changed files and three exact raw sources. The CTS reference joins to the retained GovInfo PDF, receipt URL, HTTP 200 response, 352,225-byte length and whole-file SHA-256 `50320a7e91be3694c4a3a3c06a07829f6f366a3e079878df099a4d49e3cfe8f9`. Extracted opinion text has a separate checksum. The other 13 references retain their original text-only download status.

The snapshot validator now rejects contradictory PDF metadata, a downloaded-PDF claim without an official HTTPS URL and raw-capture metadata, and impossible capture timestamps. Metadata shape validation alone does not prove source acquisition: `verify-candidate.mjs` separately reads retained raw files and receipts, verifies hashes, byte lengths, the PDF signature and URL associations, then exercises the actual engine.

At 12:49:49 UTC, `validation-receipt-2.json` passed schema/reference reconciliation, every candidate file hash, raw-source/receipt joins and 18 date-boundary cases. Candidate manifest SHA-256: `4ed10b839bbeb86ce9bbfaf0d3fc90264b49f7814ad313761c575024dea82b8b`. The first receipt and the coverage/manifest before adding the session-law publisher link remain in `before-publisher-link/`. An independent Luna audit also verified the original candidate before that small link refinement; the final refinement was revalidated by the main agent.

All protected `.2` files and the active `.1` manifest are unchanged. Frozen `.2` SQL remains 201,605 bytes, SHA-256 `3ac1fdb06b2f9d5fff3364ee108c645dab798aecae4a0985de73cd59676a6139`. Code validation passed 650 tests, one existing skip, TypeScript, scoped ESLint and the production build. No new UI publication occurred, and this candidate has not had a browser interaction check.

## Remaining release steps

1. Follow `state-law-release-checkpoint-2026-10-05.md` to apply and reconcile the frozen `.2` release before advancing any active manifest.
2. For `.3`, preserve actual database before-images after `.2`, create a new private ingest run, privately store and whole-object-verify the three original sources, and register their receipts. The candidate is currently local; no `.3` upload, intake, SQL transaction or public projection has run.
3. Prepare the five changed native entities: two statutory sources, one judicial reference, one existing limitation rule and NC coverage. Preserve every prior source/entity version. Link rule sources, the CTS reference, and coverage rule/source identities explicitly.
4. Prepare a separate projection validation for 124 rules, 86 baselines, 45 baseline jurisdictions, 38 research rules, 92 sources, 47 primary-text jurisdictions and 14 opinions. Check exact payloads, text/raw provenance, citation targets and listing facets; do not replay `.2` assertions as if they covered `.3`.
5. Upload and hash-verify the candidate protected bundles, reconcile the registry, advance the manifest, verify Git/Lovable synchronization, publish, then check the NC date and exception boundaries in the published UI.

## Other state-law gaps

New Jersey's official LIS extracts now include sections 2A:14-2, 2A:14-21 and 2A:14-1.1, plus P.L.2019 c.120's special window and effective clause. Their saved hashes cover extracted text, not unavailable original HTTP bytes. Historical/currentness reconciliation and main-agent legal-rule review remain. Packet: `state-law-next/nj-followup-1224/`.

Oregon's official 1967/1969 ORS archives, session guide, constitutional provision and disposition table support a possible September 13, 1967 date inference. The original c.406 enactment/transition clause remains uncaptured; no OR calculation was activated. Packet: `state-law-next/or-historical-followup-1224/`.

Tennessee's adopted SA0351 text and official SB0463 history establish a 2015 legislative evidence trail and July 1, 2015 applicability clause. The enrolled chapter endpoint returned 403, and continuity through 2026 remains unverified. No TN calculation was activated. Packet: `state-law-next/tn-followup-1224/`.

Arkansas, Georgia and Mississippi retain their recorded primary-text/rule gaps. Open US Law remains held; these source captures do not release it or substitute a source link for stored, reviewed authority.
