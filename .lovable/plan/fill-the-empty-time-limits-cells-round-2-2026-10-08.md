# Fill the empty Time Limits cells (round 2)

## Goal

Turn the 105 state-by-claim cells that currently say "Not recorded" into real answers wherever the official text can be reached — and keep the two kinds of answer visibly different. Nothing is invented: every new rule carries a passage quoted word-for-word from official text.

## What this session already verified

- The live release (2026-10-08.1) reports **105** empty cells: breach of warranty 30, legal malpractice 35, intentional tort 26, defamation 12, wrongful death 1 (IA), property damage 1 (DE).
- **84 of the 105** sit in states whose current official code text is already in your corpus (44 jurisdictions reviewed and public). The other 21 are in AR/GA/MS/TN (gated or absent, 14 cells) and CA/HI/NJ (still acquiring, 7 cells) — those stay "Not recorded" this round.
- The recorded blockers are mostly one problem repeated: **29** breach-of-warranty cells are missing only because that state's sale-of-goods limitation section was never captured; **26** legal-malpractice cells are missing because no statute names attorneys at all.
- A direct probe found the sale-of-goods section (heading "Statute of limitations in contracts for sale") already in the corpus for 13 states — CO, CT, ID, IL, IN, KY, MT, NC, ND, NE, OK, WV, WY — and it is findable by other citation forms for the rest (FL, IA, WA, WI, PA, RI, UT, AK, OR, AZ), with LA a civil-law exception needing its own provision.
- The working directory the last audit used (`/tmp/lim`) is gone with the sandbox, so the starting bundle has to be rebuilt from the live release before anything can be added.

## Decisions taken

- **Both kinds of answer, kept visibly distinct** (your choice): a rule backed by a statute that names the claim, and a clearly separate, lower-confidence rule that says "no claim-specific statute; the general period applies" with the general statute cited.
- **Stage only, you activate** (your choice): I build and stage the release with hash readback and stop; activation stays your one-file step.

## Work order

1. **Rebuild the working bundle.** Re-download rules, sources, coverage, case references and every quoted text file from the live release, checking each object's fingerprint against the manifest, until `verify.mjs` and the snapshot validator pass on the rebuilt set. This is the floor under everything else.
2. **Add the visible distinction first**, before any new rule exists: a per-rule "basis" (claim-specific vs general-period-applies), its own coverage status so the matrix and state pages show it separately, and honest wording in the panels. A negative finding — "no attorney-specific statute exists" — cannot be quoted, so those rules carry the general statute's literal text plus a recorded negative finding, and are never shown as if a statute named the claim.
3. **Breach of warranty (30 cells, the most uniform).** Build a per-state citation map for each state's sale-of-goods limitation section, read the section's current official text, and record the period, accrual and any repose with literal passages. Louisiana gets its own civil-law provision or stays unrecorded.
4. **Legal malpractice (35).** Search each state's current code for an attorney- or professional-services-specific period. Where one exists, record it as claim-specific; where none does, record the general period as the separate kind.
5. **Intentional tort (26) and defamation (12).** Same method: assault/battery/false-imprisonment provisions and defamation provisions, each quoted literally; general-tort-period answers recorded as the separate kind.
6. **Singletons:** Iowa wrongful death, Delaware property damage (the split-by-statute case).
7. **Check, then stage.** Run the entry checks, build the release, re-verify every text fingerprint, run the snapshot validator and the test suite, then stage it to private storage with hash readback. Report what filled and what didn't; activation is yours.
8. **Write it up:** update the audit doc, roadmap and a per-cell ledger of what was recorded, what stayed empty and why.

## What stays empty

- AR, GA, MS, TN (14 cells): code published only through a gated publisher; the gate was not accepted or bypassed.
- CA, HI, NJ (7 cells): full code still being acquired.
- Any cell where the official text cannot be reached or a period cannot be quoted literally.

## Technical details

- **Working set:** `LIM_WORK/entries/<st>.json` (`{jurisdiction, entries[]}`), `LIM_WORK/captures/<ST>/<id>.{json,txt,raw}`, optional `LIM_WORK/time/<st>.json`. `scripts/limitations/backfill/verify-entries.ts` enforces: `excerpt` a literal substring of the capture text, `periodEvidence` inside `excerpt`, the stated period parseable out of that passage, accrual/tolling/repose evidence likewise literal.
- **Text routes:** `scripts/limitations/backfill/capture.py` for a single official page (direct, `--render`, or proxied for hosts that block us; gated publishers refused). For text already landed by the full-code intake, `publicStatuteSections()` / the projected-section read supplies current official text; new sources then record intake provenance (publisher, run id, manifest hash, section ids) as `recheck-via-code-capture.ts` already does.
- **Model changes:** `src/lib/limitations/types.ts` (rule basis + coverage status), `validation.ts`, `backfill/entries.ts` (`MatrixEntryInput`), `backfill/entryRule.ts`, `backfill/cellCoverage.ts`, and the UI in `src/components/limitations/` (state panel, workbench matrix, coverage display).
- **Build and ship:** `bun scripts/limitations/backfill/verify-entries.ts <ST...>` → `build-release.ts` (`LIM_BUNDLE`, `LIM_WORK`, `LIM_OUT`) → `scripts/limitations/verify.mjs --root=<out>` → `validateLimitationsSnapshot` → `bun test` → `scripts/admin/stage-limitations-release.mjs --captures=… --bundle=… --execute` (needs `EXTERNAL_SUPABASE_URL` and `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`; the stager never touches the live manifest). `scripts/admin/activate-limitations-release.mjs --verify` stays yours.
- **Tests:** one asserting a general-period rule can never render as claim-specific, one asserting every new rule's period passage appears literally in its cited text — both written so they fail if the check is removed.

## Not claimed

Filling cells is not certification. After this round some states will still lack claim-specific provisions, tolling and counting details may be incomplete, and the 198 sources that could not be re-read from their publishers stay as they are.
