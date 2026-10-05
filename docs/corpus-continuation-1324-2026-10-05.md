# Corpus continuation — October 5, 2026, 13:23 heartbeat

The three bounded entry passes finished at **14:18:16 UTC**, capturing **5,109 additional native docket-entry IDs** since the frozen 12:52 checkpoint. Their **8,037 nested document IDs are metadata, not acquired PDFs**. Four earlier entry versions also received separately captured document-metadata updates. Five of the original 16 API traversals are exhausted; **11 retain cursors**. None of these later captures has been registered or projected.

State-law coverage remains the other priority. The North Carolina `.3` candidate is now privately uploaded and whole-object verified, with its corrected registration transaction prepared and reviewed. The active application release is still `.1`; `.2` and `.3` have not been registered, activated or published. Authenticated Chrome control timed out again at about 13:24 and 13:54. No Supabase SQL or Lovable publishing action was completed. The Git checkpoint `1868423` preserves the NC contract and release instructions; Git push is not evidence of Lovable publication.

## Observed live state

At **14:11:28 UTC**, target-pinned read-only PostgREST verification found:

- 118 published calculator rules, fully equal to the preserved `.2` before-image.
- 63,973 actual `sw_docket_entries_v1` rows, matching its catalog count.
- 94 catalog entries and the same 11 publication holds. Open US Law remains held with 2,968,623 cataloged records.
- Zero records and zero catalog entries for `judge_disclosures` and `url_directory`.

Private responses and hashes are in `continuation-1403/public-preflight.json`, `public-rules-before.json` and `public-catalog-before.json` under `private/audit-2026-10-05/`. The private run registry was not queried through this public-schema preflight. Do not infer a run's absence or completion from these public counts.

## Docket capture and remaining cursors

| Pass folder | Successful source requests | Additional entry IDs | Nested document IDs from those entries | Newly exhausted API traversals |
| --- | ---: | ---: | ---: | --- |
| `continuation-1324` | 83 | 1,648 | 2,160 | MDL 3113, MDL 3166 |
| `continuation-1350` | 123 | 2,441 | 4,159 | MDL 3108, MDL 3149 |
| `continuation-1403` | 51 | 1,020 | 1,718 | None |
| **Total** | **257** | **5,109** | **8,037** | **Four; MDL 3144 was already exhausted** |

Ten separate source requests checked the headers and first pages of those five exhausted traversals. They returned no new entry IDs in the sampled first pages. MDL 3144 entry `479206485` (document `494850052`), MDL 3113 entries `479841171` and `479330376` (documents `495525515` and `494976253`), and MDL 3108 entry `479293315` (document `494938461`) changed only in the nested document's `date_modified` and `filepath_ia` fields. Old and new response bodies, receipt archives and normalized observations are retained. A populated Archive.org path is not evidence that PDF bytes have been acquired, verified or registered.

The final canonical traversal has **12,779 unique entry IDs** and no changed or missing prior traversal rows. It includes the separate, previously exhausted MDL 3114 scope with 85 entries. Frozen evidence:

- `continuation-1403/frozen-docket-entries.jsonl`: 32,752,203 bytes; SHA-256 `bcd538b72add869e760614eb1fc0541c8d56d799bfdcfbbc510e69a56fad4b07`.
- `continuation-1403/manifest-after.json`: 6,269 bytes; SHA-256 `65b818e5710aa09d65511d259ad28cbc4243ace8e45669ec373bf76af5a07eb3`.
- Each pass has an independent `pass-audit.json`. The final audit passed all 12 checks, including exact task budgets, native identities, raw-response lineage, unchanged earlier snapshots and import plans. The collector exited with zero failed or queued tasks and released its lock.

| MDL | Native docket ID | Captured traversal entries | Resume status |
| ---: | ---: | ---: | --- |
| 2741 | 5981306 | 900 | Resume retained cursor |
| 2789 | 6224301 | 900 | Resume retained cursor |
| 2873 | 8408916 | 860 | Resume retained cursor |
| 3014 | 60866823 | 900 | Resume retained cursor |
| 3026 | 61690868 | 900 | Resume retained cursor |
| 3047 | 65407433 | 900 | Resume retained cursor |
| 3060 | 66801859 | 900 | Resume retained cursor |
| 3080 | 67665081 | 880 | Resume retained cursor |
| 3081 | 67678440 | 880 | Resume retained cursor |
| 3094 | 68222905 | 880 | Resume retained cursor |
| 3108 | 68837976 | 778 | Skip exhausted traversal |
| 3113 | 68869775 | 496 | Skip exhausted traversal |
| 3125 | 69255166 | 880 | Resume retained cursor |
| 3144 | 69871659 | 465 | Skip exhausted traversal |
| 3149 | 69912599 | 643 | Skip exhausted traversal |
| 3166 | 72030009 | 532 | Skip exhausted traversal |

These are observed API traversal counts, not claims of complete court docket sheets, current deeper pages, PACER coverage, member-case coverage or PDF completeness. The fresh samples cover only headers and the first 20 entries per checked docket. Do not rewrite canonical traversal rows with those samples or force a completed scope to restart. Preserve the four source-blocked docket identities and the exclusion of mismatched MDL 3014 secondary ID `63571952`.

## Quota stop

At **14:19:08 UTC**, actual usage reported **225/day, 27/hour and 22/minute remaining**, unblocked. With reserves of 20/day, 30/hour and 5/minute, **zero additional acquisition calls were usable**. No further source request was made. The 51-request pass had started with a measured 81/hour remaining; the final measured remainder was three lower than its 51-call source log predicts. The accounting difference is unresolved and must not be silently treated as spare quota.

The source's next hourly reset marker was **14:34:24 UTC** and daily marker **14:25:37 UTC**. These are rolling-window markers, not promises that either allowance fully resets then. On a later heartbeat, confirm the collector lock is free and recheck actual usage. Resume only the 11 incomplete saved cursors with a bounded budget, current verified unblocked headers, normal pacing and the existing clean-defer behavior. Do not wait for hours or bypass the limits.

## Three frozen pending import packets

All paths below are under `private/audit-2026-10-05/`. **No run listed here has been opened by this continuation.** Verify actual registry state before any execution.

| Order | Packet | Prepared run | Entry observations | Nested document IDs |
| ---: | --- | --- | ---: | ---: |
| 1 | `continuation-1145/` | `216cd8bb-e850-4ca1-9a55-78251b79edcb` | 2,200 | 2,952 |
| 2 | `continuation-1252/post-1145/` | `487f0d04-d694-4ba3-a7bf-6e679040e4f7` | 5,385 | 7,065 |
| 3 | `continuation-1403/post-1252/` | `c56969c3-0058-4ced-9ad4-e33a83060236` | 5,113 | 8,041 |

Packet 1 includes 320 previously registered observations; these are not new acquisitions. Packet 3 contains **5,109 new capture IDs plus four updated existing entry versions**. Its nested count comprises 8,037 IDs in newly captured entries plus four metadata updates. Do not add packet observations to the public catalog count: actual insert/update/version counts require registry and projection reconciliation.

The third input is **13,842,044 bytes**, SHA-256 **`bfff9ff6c7ae8600bc2553abd1f710bc58cb564846f9e8084454798111ec0644`**. Its plan records the native-ID projection filter, 16 byte-identical matter bundles, four old-version before-images, full traversal counts/source dates and exact freshness response/audit hashes. The predecessor packets and their hashes are unchanged. The generator compares each refreshed entry to its hash-verified raw source body before freezing it.

Dry intake accepted **13,154 envelopes in 20 batches**, with zero oversized/held rows and zero database writes. `dry-intake-summary.json` explicitly distinguishes dry-run processing from registration. An independent `import-readiness-audit.json` passed all 14 checks, including the exact native-ID filter, unchanged bundles and four source-backed version updates. `open-run.sql` requires actual completion of packet 2 and preservation of the Open US Law hold; its SHA-256 is **`2c78ff1f9e33d3a269ef5298b6324db42e7752d6648dc509a172a948d0974404`**. PostgreSQL syntax parsing passed five statements and one PL/pgSQL guard; that is not database execution.

After authenticated administration returns, apply the packets in order only after verifying each actual predecessor's intake, bounded projection and completion. Use the frozen inputs, never the changing collector folder. After successful intake, run the entry-only dry projection with the exact saved native-ID filter, preserve current before-images, check latest native header eligibility, and reconcile published row counts, source dates, holds and facets. Do not set unrelated `ready` flags or mark partial coverage complete. PDF eligibility, byte deduplication, whole-object readback and registered receipts remain separate work; no PDFs were acquired by these passes.

## Calculator and primary-law progress

The [NC candidate checkpoint](limitations-nc-candidate-2026-10-05.md) pins the only valid `.3` registration packet: run `0547dd04-0941-43e1-aed7-811d3d42c5b4`, **`apply-reviewed-nc-v2.sql`**, SHA-256 `342c79e65bdb343d24044aff7e839136b72231abe45b8ecc41e4ec3b9e18b026`. Three raw authorities and seven changed protected files were privately uploaded with full-object SHA-256 readback, totaling 859,960 bytes. The transaction, native edges, predecessor guards and v5 validation contract passed static review and parsing. The rejected first draft is preserved and must never execute.

The prepared `.2` remains pinned to run `2ff88e16-2fdd-4672-bbf3-d65795542271` and SQL SHA-256 `3ac1fdb06b2f9d5fff3364ee108c645dab798aecae4a0985de73cd59676a6139`. Execute and reconcile `.2` before `.3`; activate neither application manifest early. Active `.1` has 37 jurisdictions with conditional baselines; prepared `.2` has 44 and prepared `.3` has 45. These are restricted claim/date branches, not complete state coverage. NC wrongful death and products remain research-only.

The [state-law source review](state-law-source-review-2026-10-05.md) records the newly reviewed Georgia enactment and amendment indexes, New Jersey's unresolved post-c.30 currentness interval, the Arkansas publisher/history gap and rejected dead bills, and Mississippi's unresolved current text and 2026 proposal disposition. The historical GA excerpt is visually corrected for legislative insertions/deletions and retained privately, not represented as current consolidated code. Oregon's original transition clause and Tennessee's current continuity remain unresolved. None of these research packets enables a calculation or releases Open US Law.

No frontend code changed during this heartbeat. The previously recorded 650-test, TypeScript and build results remain historical validation of the prepared code, not a new production check. The continuation remains active: finish the remaining captured scopes and authority gaps, register and reconcile the pending data when authenticated administration is available, then verify Lovable sync and actual published behavior.
