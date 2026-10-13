# Regulatory source collectors

These collectors retain public source evidence for research triage. A publisher notice, investigation, or allegation is not proof of individual injury, causation, liability, or a viable claim. They do not acquire the removed CPSC injury collection or Open US Law.

## Operational sources and actual scope

| Source ID | Official source and native record | Selected scope and limits | Check interval |
| --- | --- | --- | --- |
| `fda_recall_notices` | [FDA announcements](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts); Drupal node ID | FDA's table date, exact official notice article, original HTML, table fields. Not every recall has an announcement. Entire selected URL/content set verified twice; cached whole-history totals can differ and are disclosed. | 6 hours |
| `fda_warning_letters` | [FDA warning letters](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters); Drupal node ID | Table posted/change date and separate issue date, full published main article, exact response/closeout links. Linked responses are not themselves fetched. Posting can lag issue. | 24 hours |
| `openfda_enforcement_drug`, `openfda_enforcement_device`, `openfda_enforcement_food` | [openFDA enforcement APIs](https://open.fda.gov/apis/drug/enforcement/); publisher recall number; category-qualified event references | All numbered records in the report-date query. Publisher rows without recall numbers remain raw and are explicitly withheld, with pointer/hash/reason and count reconciliation. Weekly source research enrichment: not current recall alerts or continuous lifecycle status. Actual source release retained. | 24 hours |
| `cpsc_recalls` | [Official CPSC recall RSS](https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS), linked by the [CPSC feed catalog](https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed); literal GUID prefixed `rss:` | Recent feed items only, filtered by `pubDate`. Retention is publisher-limited; no date-window/archive completeness claim. All feed items validated and compared twice. No invented mapping to API RecallID. This is permanently the operating identity family, not an automatic API fallback. | 6 hours |
| `nhtsa_recalls` | [NHTSA datasets catalog](https://www.nhtsa.gov/nhtsa-datasets-and-apis); official `FLAT_RCL_POST_2010.zip`; campaign number | Post-2010 file; select native campaigns by report receipt or record creation in the requested window, then retain all product/vehicle association rows of those campaigns. Complete numbered dictionary is protected by an exact reviewed SHA. Older undated changes outside the selected scope need reconciliation. | 24 hours |
| `nhtsa_investigations` | Same official catalog; `FLAT_INV.zip`; native investigation action number | Select on opening or closing date, retain every association in each selected native action. An opening is not a final defect determination. Exact dictionary SHA required. | 24 hours |
| `federal_register` | [FederalRegister.gov API](https://www.federalregister.gov/developers/documentation/api/v1); document number including literal correction prefixes | All agencies/types within a publication window; metadata, abstract, explicit correction references and native agency IDs. Full document text is not captured here. Changes to records outside the rolling publication window are not covered. | 24 hours |

Check intervals are collector policy, not publisher publication guarantees. Due checks use UTC-aligned six-hour slots (00:00, 06:00, 12:00 and 18:00) or UTC calendar days for 24-hour sources. A completion at 00:25 therefore does not suppress the next 06:23 six-hour poll or the next day's 00:23 daily poll. Sources already completed in the current slot are skipped; missing or invalid completion timestamps remain due. Failed attempts do not advance successful freshness, and explicit forced manual runs still bypass due checks. Default windows are the preceding 7 days, or 30 days for openFDA to accommodate weekly publication lag. Manual windows are capped at 90 days; wider archive coverage requires separately reviewed reconciliation. `nhtsa_communications` is a prospective registry entry with no operational adapter or successful run. FSIS, DailyMed and other proposed sources are not configured.

CPSC's separate JSON API parser remains tested to reject its observed HTTP-200 error sentinel (`RecallID: 0`). API outage packets can be retained as failed health evidence, but no successful API-ID records are mixed with RSS GUID records. A successful RSS run does not establish that the separate API outage was repaired.

## Capture and intake

Requires Node 22 or newer and Python 3.10 or newer. Python code uses only the standard library. `PYTHON` may identify the interpreter. The official source collector does not need corpus credentials:

```sh
node scripts/ingest/regulatory/run.mjs capture --sources=fda_recall_notices,cpsc_recalls --from=2026-10-01 --through=2026-10-12 --output=private/regulatory-example
node scripts/ingest/regulatory/run.mjs land --sources=fda_recall_notices,cpsc_recalls --output=private/regulatory-example
```

The second command is a local packet validation unless the bare `--execute` flag is present. Executing private intake requires `EXTERNAL_SUPABASE_URL` equal to the configured corpus origin and a service credential in `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (legacy `EXTERNAL_SUPABASE_KEY` is supported). Never put credentials in command arguments, committed files, or output. Only the fixed regulatory RPCs and private `corpus-originals` paths are permitted.

```sh
node scripts/ingest/regulatory/run.mjs land --sources=fda_recall_notices,cpsc_recalls --output=private/regulatory-example --execute
node scripts/ingest/regulatory/run.mjs daily --output=private/regulatory-scheduled-run --execute
```

Use a new private output directory for each capture invocation. Existing immutable packets are not replaced. A same-directory lock prevents concurrent capture/intake. Partial acquisition is a failed source packet, not successful empty data. Only an exact source-native zero-response proof can complete an empty query. Source-specific caps, count mismatches, HTML error pages, schema drift, source changes during verification, redirects, and oversized bodies fail closed.

The raw byte SHA determines `corpus-originals/regulatory/<first-two>/<sha256>.raw`. Every object is checked for a private bucket, never upserted, and read back for full byte length and SHA verification. An incremental journal is flushed after creation before verification, preserving cleanup evidence if readback fails. Capture provenance binds the exact request URL, retrieval timestamp, byte count, raw SHA and private storage key. Record provenance also contains the source detail URL and exact record pointer in the captured response. Paginated query URLs and retrieval times are excluded from normalized content hashes so they do not manufacture revisions.

The private versioned contract is `database/contracts/corpus-regulatory-monitor-v1.sql`: open run, register verified captures, intake rows, then finish against exact observed/expected counts. The complete packet hash is bound into run scope, so replaying a completed run with different packet content is rejected. Native IDs and source content revisions are stored separately from observations. Only completed runs contribute to the public research projection. `initial`, `incremental` and `backfill` modes remain explicit; backfill is not represented as a new publisher event. The collector cannot supply its own event classification.

Install the additive `database/contracts/corpus-regulatory-run-read-v1.sql` before running this collector version. Its service-only `corpus_regulatory_run_v1(p_run uuid)` provides exact recovery lookup, including runs older than the overview's most recent 100. It is not exposed through an application server function. Before opening a **new** database run, intake persists the exact `packet.json` bytes as another immutable private object and verifies their full readback; it then verifies every referenced raw object is durable. Only then is the lease opened. Run scope records `packet_storage_key`, `packet_file_sha256`, `canonicalpacket_sha256`, and the legacy `packet_sha256` binding. The packet is an administrative recovery object, not a publisher capture or extra source record. Object journals distinguish creation/readback, including interruption before the lease opens.

For an interrupted still-running run, retain the exact packet and object files and rerun `land` against that directory; verified content-addressed objects are reused. If the machine/CI runner disappeared, recover the **same run** into a new private directory:

```sh
node scripts/ingest/regulatory/run.mjs recover --run-id=EXACT-RUN-UUID --output=private/regulatory-recovery --execute
```

Recovery accepts no source/date/mode overrides. It looks up the exact run, checks the private bucket and hash-bound locator, verifies packet byte SHA plus canonical hash, source/run/window/count/scope identity, every capture path/size/URL/hash and raw object, then writes immutable local evidence and calls the same intake path. Maximum packet size is 100 MiB; individual raw objects are at most 100 MiB, with at most 10,000 normalized records, 15,000 capture receipts and 2 GiB of distinct source bytes per packet. Corrupt/missing evidence fails closed. Conflicting local files are not overwritten. Recovery can itself be retried; it never silently chooses another run.

Existing completed runs keep their exact old scope and return verified replay receipts without adding locators or new observations. Older still-running runs without a recovery locator require their retained local packet and objects; the collector preserves their scope rather than retroactively rewriting it. All nine initial October 12 runs preceded this recovery extension and are already completed. The CLI attempts to close ordinary failed intake using the actual observed server count. If closure is unverified, inspect its retained checkpoint and exact read-only run status before taking action. A finalized failed run cannot be reopened or amended: preserve its evidence and acquire a new run. Do not manually clear a source lease, mutate finalized packet content, or promote partial rows to bypass a failure.

## Scheduler and checks

`.github/workflows/regulatory-monitor.yml` triggers every six hours at minute 23; per-source due rules skip sources not yet due. It serializes scheduled/manual runs, checks required repository secrets without printing them, runs the offline collector tests, applies a 55-minute job limit and retains only compact checkpoints, object journals and landing/recovery receipts as CI artifacts. Raw source bodies and normalized packets remain in private corpus storage, outside GitHub artifacts. The manual `recover_run` input invokes exact-run recovery and cannot be combined with source/date overrides. A forced runner termination after lease creation therefore remains recoverable from private storage; an interruption before lease creation leaves only journaled immutable objects and no active lease. Source failure produces a failing job while other configured sources can complete. The workflow file alone does not establish that production secrets or scheduling have been enabled; verify a real workflow run and the final corpus readback.

```sh
node --test scripts/ingest/regulatory/collector.test.mjs
python -B -m unittest discover -s scripts/ingest/regulatory -p 'test_*.py' -v
```

The repository offline JS/Python runners include these suites. Synthetic test data never enters acquisition packets. Coverage includes duplicate/corrected records, caps, partial pages, changed counts, missing native IDs, error sentinels, HTML/JSON/XML failures, invalid dates, dictionary changes, ZIP members, redirect rejection, retry limits, permission-vs-missing storage, creation/readback journaling, exact completed-run replay binding, simulated hard-kill/fresh-directory recovery and unchanged legacy run scope.

## Initial capture evidence, October 12, 2026

All nine candidates below have completed private cloud intake: **1,148 source-native records**, with per-source exact observed counts and hash-verified object receipts. Each directory contains its immutable `packet.json`, original bytes, upload/readback journal and `landing-receipt.json`. The failed CPSC JSON API attempt is separately retained with zero projected rows and one verified error-response capture. Successful RSS collection does not erase that failure. This establishes initial intake, not production scheduler enablement or continuous historical coverage.

| Source | Completed records | Evidence directory |
| --- | ---: | --- |
| FDA recall announcements | 31 | `private/regulatory-canary-v3/fda_recall_notices` |
| FDA warning letters | 59 | `private/regulatory-ready-v1/fda_warning_letters` |
| openFDA drug enforcement | 31 eligible of 32, one unnumbered row withheld | `private/regulatory-ready-v1/openfda_enforcement_drug` |
| openFDA food enforcement | 62 eligible of 63, one unnumbered row withheld | `private/regulatory-ready-v1/openfda_enforcement_food` |
| openFDA device enforcement | 164 | `private/regulatory-ready-v2/openfda_enforcement_device` |
| CPSC recent RSS recalls | 40 | `private/regulatory-ready-cpsc/cpsc_recalls` |
| NHTSA recall campaigns | 53 | `private/regulatory-canary-v3/nhtsa_recalls` |
| NHTSA investigation actions | 7 | `private/regulatory-canary-v3/nhtsa_investigations` |
| Federal Register metadata | 701 | `private/regulatory-ready-fr/federal_register` |

Most initial windows span September 15–October 12; Federal Register spans October 1–12. openFDA's observed release is September 30, illustrating source publication lag. Earlier failed probe/canary packets are preserved and not relabeled successful. These observations are not guarantees about future source availability. Reuse remains subject to publisher qualifications and [openFDA terms](https://open.fda.gov/terms/); do not infer blanket rights for third-party materials embedded in source publications.
