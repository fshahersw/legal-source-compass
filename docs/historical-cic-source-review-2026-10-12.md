# Historical CIC source review, 2026-10-12

The UniCourt/Public.Resource.Org repositories are reasonable candidates for explicitly dated historical browsing. Their latest source editions are five to six years old. They provide no basis to activate current-law calculator rules or label a 2026 state-code collection complete.

| Repository | Latest recorded source edition | Latest release HTML files | Pinned commit |
| --- | --- | ---: | --- |
| [Arkansas](https://github.com/UniCourt/cic-code-ar) | r78, 2020-11-06 | 30 | `60328c10919037f2da7b1dcd05e98c181b17ad1c` |
| [Mississippi](https://github.com/UniCourt/cic-code-ms) | r78, 2020-07-08 | 52 | `efd509d2fe257a0e38108c0795103fc958bc8734` |
| [Tennessee](https://github.com/UniCourt/cic-code-tn) | r76, 2021-05-21 | 70 | `507a4fb0e463c55a81147a3deba042aa18f562c1` |

All three latest commits are dated November 28, 2022 and describe transformation version1.12. The sampled HTML independently prints the older release date and a separate transformation date. Neither Git commit time nor today's retrieval date establishes legal currency. File counts include constitutions and are not section-completeness counts.

## Provenance and licensing evidence

The repository READMEs identify UniCourt's work for Public.Resource.Org and link original RTF distributions on Internet Archive: [AR](https://archive.org/details/gov.ar.code), [MS](https://archive.org/details/gov.ms.code.ann.2018), and [TN](https://archive.org/details/gov.tn.tca). Their metadata retains matching release directories, original-file lengths and checksums. Three pilot originals were retrieved and verified against archive SHA1, MD5 and byte lengths, then recorded with SHA256 and retrieval receipts. All 2,585 native Section-style headings matched the pinned HTML samples after whitespace-only comparison. This is a heading comparison, not a claim that the HTML transformation preserves every statutory character.

MS and TN contain a CC0-1.0 `LICENSE`. AR has no license file or GitHub-detected license; its README and sampled HTML state public-domain/no-rights-reserved status, and the linked archive identifies a Public Domain Mark. Preserve those exact declarations rather than labeling AR as having the same CC0 file. These are the publishers' declarations, not an independent rights adjudication.

One title from each latest edition was sampled (AR16, MS15, TN28). All three exact HTML downloads matched the pinned Git blob hashes, decoded strictly as UTF-8 and had no duplicate IDs in the inspected title. Explicit UTF-8 parsing is necessary; autodetection can corrupt section signs and punctuation. Headings and native citation text are available, but statutory text, history, research references and judicial annotations require distinct parsing boundaries. Zero duplicate IDs in samples does not prove correctness of every transformed section.

Every latest-release HTML file has a same-stem original RTF in the archive metadata. Original RTFs absent from the transformed latest tree are:

- AR: code index.
- MS: code index, court rules and their index, and 2019/2020 attorney-general opinions.
- TN: code index, prior constitution, and 2020/2021 attorney-general opinions.

## Historical source implementation

For the requested state coverage, the implementation uses explicitly dated historical collections. The bounded plan selects 146 original RTF code titles (AR28, MS50, TN68), totaling 568,119,982 bytes. Constitutions, indexes, court rules and attorney-general materials remain outside this title-only scope. Acquisition verifies exact archive checksums and permits redirects only to the same reviewed object on known Internet Archive delivery hosts; failed requests produce no successful capture. Resume rechecks retained bytes and their receipts.

The parser reads the original RTF, using native Section and Code Segment styles. It preserves literal punctuation and list markers, separates statutory Text, History and Annotations, records raw byte spans, and retains every unmapped paragraph in a private review ledger. Parser2 also separates native `hidden` form/table transcripts from the visible body. Printed ranges, duplicate citations, repealed/reserved stubs and unusual headings remain separate source occurrences. Unknown semantic controls and embedded objects are quarantined. A heading-only stub retains its printed heading and an explicit no-body note; no statutory body is invented.

New source identities are `ar-historical-rtf-20201106`, `ms-historical-rtf-20200708` and `tn-historical-rtf-20210521`. The additive `corpus-third-party-edition-v1.sql` contract requires `official_source=false`, an explicit edition, visible qualification and source occurrence evidence. Current-law and calculator gates remain false. It also excludes these occurrences from automatic canonical citation-token lookup. A separate reviewed publication decision is required; the parser and packet scripts never publish or write a database. Existing sources and the removed `open_us_law` collection are not recreated or overwritten.

`stage_historical.py` produces private packets; `verify_packet.py` independently rereads the exact originals, replays every record and raw span, checks object hashes, and reconciles original Section-style marker counts, unit text, annotation ledgers and quarantines. This proves representation of the retained edition's selected title files, not completeness of current state law. Per-state staging and verification reports carry exact results; incomplete packets are not release candidates.

Machine-readable evidence, originals and packets are in ignored `private/coverage-completion-2026-10-12/historical-cic/`. Git contains only the parser, tests, contract and documentation. Live intake or publication receipts, if later authorized and performed, are separate from these offline verification results.

## Completed offline verification

All 146 originals were captured and hash-verified (568,119,982 bytes). The initial packets passed source replay, but a subsequent rendering review found 624 native hidden paragraphs across 501 occurrences (AR293, MS170, TN38). These contain form/table transcripts and sometimes font-dependent symbols; treating them as ordinary body text was incorrect. The initial packets were withheld from publication. Parser2 preserves their raw/span-bound evidence privately, excludes them from the visible body, and adds per-occurrence and archive-wide notes that referenced visual forms/tables are not represented. All three corrected packets in `packets-v3/` passed a fresh full original replay. The version comparison confirms unchanged originals, identities, citations, headings, hierarchy and history; exactly those 501 bodies changed, with all 624 excluded paragraphs retained in the private ledger.

| Historical edition | Titles | Source occurrences | Objects | Parser quarantines |
| --- | ---: | ---: | ---: | ---: |
| AR, 2020-11-06 | 28 | 37,504 | 56 | 0 |
| MS, 2020-07-08 | 50 | 28,913 | 100 | 0 |
| TN, 2021-05-21 | 68 | 34,356 | 136 | 0 |

These counts are historical source occurrences. They include 4,374 heading-only entries with no native Text segment, 504 occurrences whose printed citation repeats, and 920 unusual headings retained literally. Those categories can overlap. Tennessee's retained title-file labels omit 14, 51 and 52; the pipeline preserves the archive inventory without inferring why those files are absent. Mississippi's title files use the source's odd-numbered sequence from 1 through 99.

Each corrected packet passed the common lander's offline preflight. Replay reports bind the exact manifest, object, unit, section, quarantine and TOC-proof file hashes; `prepare_readback.py` rejects any subsequent packet change. It generates a read-only whole-corpus comparison with exact native/text/hierarchy/occurrence/display and full payload/provenance digests, source-object bindings, spans and authority-gate counts. Fresh comparisons are in `readback-v2/`. A small isolated PostgreSQL fixture using corrected AR 2-16-505 confirmed exact digests and detection of span and authority-flag alterations. Cloud readback and explicit publication remain separate completion checks; no offline result certifies current law.

## Recorded cloud review

The full cloud comparisons passed for all three corrected packets: both complete ledgers matched, counts matched, and all integrity and authority-gate error counts were zero (`readback-v2/cloud-comparison.json`). Guarded review subsequently opened the historical browse gates for Arkansas at 2026-10-12 20:53:08 UTC, Mississippi at 20:54:47 UTC and Tennessee at 20:55:59 UTC. Their per-state `published-readback.json` receipts record the exact corrected manifests, completed runs, counts and reviewed state. This changes the state browse gate only; stored-row authority flags, current-law verification and calculator activation remain false.

The public HTTP smoke run completed 28 requests at 20:58:37 UTC, covering 15 exact source records, three state entries and root outlines, coverage counts and six withheld canonical citation lookups. The initial harness passed 13 requests and incorrectly expected a null source URL for the 15 records: the section packet stores its exact URL on the linked source unit, which the live API correctly returned. The corrected harness binds each expected URL by exact unit key and original hash. All 28 preserved responses passed an offline replay that rechecked raw response hashes and exact body, history, source warning, edition, currency and hierarchy. All 15 affected requests then passed fresh HTTP checks at **20:59:39 UTC**. The original failure report remains retained in `live-smoke-postpublication/`, corrected replay in `live-smoke-offline-replay-v2/`, fresh requests in `live-smoke-fifteen-recheck/`, and the explanation in `live-smoke-harness-correction.json`. No application change was needed for this harness correction.

The retained production browser evidence for Tennessee 2-2-129 shows the `2021-05-21` source edition above the browser and beside the record, with the explicit hidden-transcript/missing-visual warning and the literal “Click to view form” source text. Evidence is `readback-v2/TN/published-screen.png` and `published-dom.txt`. This confirms that sampled disclosure is visibly rendered; the HTTP and browser checks do not certify present legal effect, all viewport behavior or completeness of uncaptured graphics.
