# North Carolina calculator candidate — October 5, 2026

This is a **private candidate, not an active or published release**. The live app still uses `.1`; the separately prepared `.2` transaction and uploaded bundles remain unchanged. Browser control of the authenticated Supabase/Lovable session timed out again during the 13:23 continuation. The `.3` sources and changed bundles are now privately uploaded, whole-object verified, and included in a prepared registration transaction. Do not skip the predecessor release or describe Git push as publication.

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
2. Use only `import-manifest-v2.json` and its exact `apply-reviewed-nc-v2.sql`. Prepared run: **`0547dd04-0941-43e1-aed7-811d3d42c5b4`**. Transaction: **206,481 bytes**, SHA-256 **`342c79e65bdb343d24044aff7e839136b72231abe45b8ecc41e4ec3b9e18b026`**. It requires the actual completed `.2` run and verified `.2` publication, exact predecessor rule hashes and NC source/coverage before-images. It preserves all 124 public rule rows, the catalog and changed private entities before updating. No run has been opened or SQL executed.
3. The frozen `intake-v2.jsonl` contains five native entities: two statutory sources, the CTS judicial reference, the existing NC rule and NC coverage. Eleven exact native evidence edges cover source, case and coverage-rule identities. Raw-storage receipts are included in the versioned authority payloads. The transaction does not publish Open US Law or modify unrelated datasets, holds or the legal graph.
4. `project-limitations-review-v5-20261005.sql` checks 124 rules, 86 baselines, 45 baseline jurisdictions, 38 research rules, 92 statutory sources, 47 primary-text jurisdictions and 14 opinions, with 105 included texts and one existing locator. It checks full projection fields, provenance, statutory and judicial hashes, retained raw-capture metadata, native targets and facets. After execution, reconcile the actual registry and public projection through REST; syntax validation is not runtime validation.
5. Only after successful registry/projection reconciliation activate the `.3` `manifest-candidate.json`, commit/push, verify Lovable synchronization, publish and check NC date/exception boundaries in the live UI. Its application-manifest SHA-256 is **`b3bb3c19dc4f5b73dea1d256ef7b510b909651006d0afea7f6a66e868d4b1834`**.

The three raw authority objects and seven changed protected files total **859,960 bytes**. `storage-completion.json` and ten individual receipts record full-object SHA-256 readback from the existing private `corpus-originals` bucket. No prior object was overwritten and the active manifest stayed unchanged. Storage upload is not registry receipt registration or publication.

PostgreSQL parsing (`pglast 8.5`) passed the final transaction's 16 statements and two PL/pgSQL guards, the v5 contract and the unchanged `.2` transaction; see `sql-syntax-validation-v2.json`. The parser caught a draft generation error before execution. Preserve the original `apply-reviewed-nc.sql`, `import-manifest.json` and `registration-draft-1/` as rejected history; **never execute draft run `40ed626d-e36e-49ee-a87d-ae77d3e903b1`**. The corrected v2 artifacts supersede it. Do not rerun the generator blindly.

The independent Luna review in `independent-review-v2.json` verifies all packet hashes, the exact SQL-embedded intake and eleven-edge array, raw/text/bundle associations, predecessor guards and scoped writes. It found no static blocker. The main-agent Storage receipts supply the remote readback evidence; the independent review checked their local associations without making new remote requests. Live SQL/catalog and browser behavior remain unverified.

## Other state-law gaps

New Jersey's official LIS extracts include sections 2A:14-2, 2A:14-21 and 2A:14-1.1, plus P.L.2019 c.120's special window and effective clause. Their saved hashes cover extracted text, not unavailable original HTTP bytes. The follow-up found that LIS's “through P.L.2026 c.30” marker predates officially indexed c.43 and c.48. It cannot close currentness through October 5. Direct statutory/chapter source requests timed out; no raw-PDF capture is claimed. Packets: `state-law-next/nj-followup-1224/` and `nj-followup-1324/`.

Oregon's official 1967/1969 ORS archives, session guide, constitutional provision and disposition table support a possible September 13, 1967 date inference. The original c.406 enactment/transition clause remains uncaptured; no OR calculation was activated. Packet: `state-law-next/or-historical-followup-1224/`.

Tennessee's adopted SA0351 text and official SB0463 history establish a 2015 legislative evidence trail and July 1, 2015 applicability clause. The enrolled chapter endpoint returned 403, and continuity through 2026 remains unverified. No TN calculation was activated. Packet: `state-law-next/tn-followup-1224/`.

Arkansas and Mississippi retain their current primary-text/history gaps. Arkansas's apparent 2003 and 2015 amendments were confirmed as dead bills, not enacted law. Georgia's enacted 2015 text, 2016–2026 regular-session indexes and located extraordinary-session materials are retained. A clean historical excerpt was visually reviewed for inserted and struck text; currentness and claim-scope limits remain. The [state-law source review](state-law-source-review-2026-10-05.md) records those boundaries and the unresolved Mississippi 2026 proposal disposition. Packets are under the corresponding `state-law-next/*-followup-1324/` directories. Open US Law remains held; these source captures do not release it or substitute a source link for stored, reviewed authority.
