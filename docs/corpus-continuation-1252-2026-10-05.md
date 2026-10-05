# Priority continuation checkpoint — October 5, 12:52 pass

This continuation captured and independently audited **5,385 additional unique docket entries** in three bounded passes. Code and legal-review checkpoints were committed and pushed regularly. No registry import, public projection or Lovable publication occurred. The authenticated Chrome connection timed out again; retain the existing unanswered browser-restart request rather than asking repeatedly.

## Captures and remaining cursors

| Pass        | Successful source calls | New unique entries | New nested document IDs |
| ----------- | ----------------------: | -----------------: | ----------------------: |
| 12:26–12:37 |                     192 |              3,840 |                   5,173 |
| 12:45–12:48 |                      32 |                640 |                     783 |
| 12:52–12:56 |                      46 |                905 |                   1,109 |
| Total       |                     270 |              5,385 |                   7,065 |

All 385 retained source-response bodies and their sidecars verified. Each pass preserved its predecessor's entries and capture provenance. The final frozen normalized file contains **7,670 unique entries**: 7,585 across the original 16 continuation targets and the separately completed 85-entry MDL 3114 scope. There are no duplicate native entry IDs. Nested document identities are metadata relationships, not acquired PDF bytes or duplicate-PDF proof.

|  MDL | Native docket ID | Captured entries | Observed API traversal |
| ---: | ---------------: | ---------------: | ---------------------- |
| 2741 |          5981306 |              480 | Partial                |
| 2789 |          6224301 |              480 | Partial                |
| 2873 |          8408916 |              440 | Partial                |
| 3014 |         60866823 |              480 | Partial                |
| 3026 |         61690868 |              480 | Partial                |
| 3047 |         65407433 |              480 | Partial                |
| 3060 |         66801859 |              480 | Partial                |
| 3080 |         67665081 |              480 | Partial                |
| 3081 |         67678440 |              480 | Partial                |
| 3094 |         68222905 |              480 | Partial                |
| 3108 |         68837976 |              480 | Partial                |
| 3113 |         68869775 |              480 | Partial                |
| 3125 |         69255166 |              480 | Partial                |
| 3144 |         69871659 |              465 | Terminal page observed |
| 3149 |         69912599 |              460 | Partial                |
| 3166 |         72030009 |              460 | Partial                |

**Resume only the 15 still-incomplete cursors.** Preserve the original 16-ID target set for audit context, but skip completed scope 69871659. Do not reacquire financial disclosures, add new target scopes by similarity, or use the blocked/mismatched docket IDs recorded in earlier checkpoints.

MDL 3144's exact CourtListener query has a docket filter, descending `date_created` ordering and omitted nested plain text; it has no date filter. Its 24-page traversal reached `next=null`, with 465 entries filed from April 3, 2025 through September 30, 2026. The first page was captured at **07:30:35.180 UTC**, the terminal response at **12:56:26.383 UTC**. This establishes exhaustion of that observed API pagination chain, not every PACER/docket-sheet filing, an immutable end-of-pass snapshot, current membership or PDF completeness. No end-of-pass first-page/header refresh was possible within the remaining quota. Check that freshness separately when quota permits, retaining old source versions.

The collector exited cleanly with no queued task or held lock. An empty queue does not close the other 15 scopes. At **12:57:14 UTC**, actual limits reported 126/day, 29/hour and 18/minute remaining, no API block. There were **zero usable calls after the 30/hour reserve**. The hourly response gave 13:27:52 UTC as its next reset marker. Recheck actual rolling limits before resuming; this is not a promise that a whole window resets then. No long wait or limit bypass is needed.

Private evidence is under `continuation-1224/`, `continuation-1245/` and `continuation-1252/`, each with frozen before/after manifests, full and delta observations, request/body verification and native entry/document maps. Final full snapshot: **18,918,446 bytes**, SHA-256 **`a51270a3a5ff9fd199dc6955e853f3a6162173137bb3bc9f5c6011bfccb4574a`**. Final manifest SHA-256: **`db76e06c99f97a8953cf98a0e389d34486ab79be08ef38c5d0d5e138d2cf812a`**.

## Frozen imports, in order

The prior 11:45 import packet is **unchanged**. Its run `216cd8bb-e850-4ca1-9a55-78251b79edcb` remains prepared, not opened/imported by this continuation. It contains 2,200 target entries and 2,952 nested document identities. Read [the 11:56 checkpoint](corpus-continuation-1156-2026-10-05.md) for its exact files, checksums and commands; the superseded 10:55 draft must not be run.

The new **post-11:45 delta** is separately pinned at `private/audit-2026-10-05/continuation-1252/post-1145/`. It contains exactly the 5,385 new entry IDs and 7,065 nested document identities from the three passes above. Its native entry IDs are disjoint from the earlier 2,200-target packet. Sixteen audited native matter bundles are copied byte-for-byte for projection context; no new MDL membership was inferred.

- Prepared run: **`487f0d04-d694-4ba3-a7bf-6e679040e4f7`**.
- Input: `post-1145/import-snapshot/live-normalized/docket-entries.jsonl`.
- Input size/hash: **13,315,623 bytes**, **`b04f3b1b0938532ca28a6dfa35e70039c62e400913674b48a3da81e3531ffc49`**.
- Dry intake: **12,450 validated envelopes, 18 batches, zero held rows, zero database writes**. Its `sent` counter is a dry-run counter, not delivery.
- `open-run.sql` requires the prior 11:45 run to be actually reconciled and completed first. Never mark a run completed just to satisfy this guard. No new run's database absence was verified in this pass.

After authenticated SQL control recovers, verify actual run state and exact frozen hashes, then execute the predecessor sequence first. For the new cohort, use the `importPass`, `projectionStaging` and `projectionNativeIdsFile` in its `import-plan.json`; never use the changing collector folder. The intake arguments remain `--types=docket-entries,recap-documents --max-rows=2000 --max-bytes=1500000`, with the new run ID. Projection must first be a dry run for the 16 exact MDLs, `--only=entries` and the exact saved entry IDs, preserving all before-images. Do not pass `--ready=true` or delete remote-only records.

Reconcile actual writes, visible/held entries, source dates, listing facets and global counts after each bounded projection. **Do not propagate MDL 3144's terminal-cursor status from the later capture into the earlier 160-entry import.** All necessary observations and exclusions must be reconciled before updating the published coverage state. Existing global records can overlap newly acquired observations; 5,385 captures do not imply 5,385 new public rows. The old 405/63,973 projection assertions remain historical.

No docket PDFs were acquired in these passes. The 7,065 document references, dry-run envelopes and earlier 59 metadata candidates require separate eligibility review, exact stored-byte lookup, whole-object readback verification and registered receipts. Preserve blocked/restricted/held material and the staged legal graph.

## Calculator, database and publication

Read [the North Carolina candidate checkpoint](limitations-nc-candidate-2026-10-05.md) and [the frozen state-law release sequence](state-law-release-checkpoint-2026-10-05.md). Active `.1` remains 118 rules. Prepared `.2` remains 124 rules with 85 baselines in 44 jurisdictions and has not been registered/published. The separate local `.3` candidate refines one existing NC rule, reaching 86 baselines in 45 jurisdictions; its raw sources, references and 18 date-boundary cases pass checks, but it has no registry transaction, cloud upload or publication yet. Never replace `.2` or the active manifest with this candidate directly.

Commit `ea6a431` adds truthful retained-opinion PDF metadata checks, HTTPS consistency and impossible-timestamp rejection. Validation passed **650 tests with one existing skip, TypeScript, scoped ESLint and the production build**. Commit `e15a2a3` records the candidate and the NJ/OR/TN evidence gaps. New Jersey has official extracted statutory text but needs historical/currentness reconciliation; Oregon's date inference does not replace the missing original enactment/transition; Tennessee's adopted 2015 amendment does not prove current law through 2026. AR/GA/MS retain their primary-text gaps. No unsupported rule was activated.

The 12:48:16 UTC read-only Supabase preflight confirmed all 118 published rules match the saved before-images, the public docket-entry catalog remains **63,973**, Open US Law remains **held with 2,968,623 rows**, and both owner-deleted collections have no rows or catalog entries. No public write occurred afterward in this continuation. Browser control and Lovable synchronization/publication remain unverified; a Git push is not evidence of deployment.

The continuation stays active. Next priorities are working authenticated publication/registration, the 15 remaining saved cursors after a fresh quota check, a bounded MDL 3144 freshness check, and the identified state-law authority gaps. Report meaningful changes; remain quiet while quota/browser state is unchanged and no useful action is available.
