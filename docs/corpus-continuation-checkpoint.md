# Corpus continuation checkpoint — October 5, 2026

Read [the 15:40 continuation checkpoint](corpus-continuation-1540-2026-10-05.md) and [full state-code acquisition](full-state-code-acquisition-2026-10-05.md) first. The frozen docket traversal now has 17,335 entries, with six original cursors partial. Four earlier import packets remain pending, and the new 1,395-entry delta is frozen but not packaged for intake. Full NC and Texas publisher inventories have been downloaded locally; Oregon collection and its incomplete chapter inventory require further work. No new source was registered or published. The owner says Lovable and Supabase plugins are connected; their tools were still absent from the running chat. Use those connections when available, and do not repeat browser sign-in requests. The linked checkpoints supersede historical instructions and counts below.

## Latest calculator and consolidation checkpoint

The owner prioritized calculator accuracy and duplicate collection navigation during this continuation. See [the October 5 calculator review](limitations-production-review-2026-10-05.md). The protected limitations release is now `2026-10-05.1`: 118 rule records, 81 statutory captures, and 13 judicial references. Administrative run `841cf6a6-5210-4380-8283-eeb9027541ef` completed with zero projection/hash/citation mismatches and preserved earlier versions. Do not replay the older 79-source publication assertion. Florida and Maine transition boundaries are enforced; other historical applicability still requires review. The frontend groups the audited FDA classification and CourtListener people snapshot pairs, with earlier versions preserved. These changes do not close any of the docket acquisition or held-publication gaps below.

The calculator and grouping release at commit `47081aa2af0dffea5b8e3fb87846f7efd2ba7bde` was published through Lovable and verified on `firastest1.com`. The three-step calculation, Florida transition citation, one current FDA classification collection and single limitations hub all rendered on production. Publication evidence is retained under `private/audit-2026-10-05/limitations-production/`. Broader collection consolidation still requires exact native-identity/source audits; the audited people pair does not by itself deduplicate the separate judge profile index.

This checkpoint is for the hourly heartbeat automation `continue-legal-source-compass` (ACTIVE). The latest pass IDs are `b11bce32-fa58-4c07-a4ac-7cf830f44da0` and `65881579-a4ad-462a-a4ca-70aa36063a62`. It projected 405 docket-entry records into a 63,973-record global catalog; 345 changed existing source rows have hash-verified before-images. The refresh covered 17 matter records: 12 of 12 strictly eligible current PDF versions are registered, one native docket-entry scope is complete (MDL 3114, 85 records), and 16 remain partial at 20 records each. Four source headers are blocked. The secondary CourtListener ID `63571952` for MDL 3014 is invalid/mismatched and excluded.

## Resume the remaining docket-entry cursors

The original target set below remains the identity audit boundary. Skip exhausted API scopes **61690868 / MDL 3026**, **68222905 / MDL 3094**, **68837976 / MDL 3108**, **68869775 / MDL 3113**, **69255166 / MDL 3125**, **69871659 / MDL 3144**, **69912599 / MDL 3149** and **72030009 / MDL 3166**. Resume only the **eight incomplete** cursors. MDL 3026 has one additional separately observed first-page entry; preserve it outside the canonical traversal. Separate header/first-page freshness observations are preserved; they do not refresh every deeper page or establish document coverage. The old initial waiting threshold and quota sample below are superseded by the latest linked checkpoint.

Do not resume acquisition before **2026-10-05 10:55 UTC**. The last saved quota sample is from 07:31 UTC and is stale for this decision. At or after the threshold, first confirm the automation is still ACTIVE, inspect the current manifest and service state, and check that no live collector owns `api-collector.lock`. Do not remove a lock while its recorded process is alive or its status is uncertain. The persisted quota ledger and live limits include safety reserves of 20/day, 30/hour and 5/minute; budget against the fresh remaining amounts after those reserves, with a hard pass cap of 300 requests and an additional five-call cushion above the configured day/hour reserves. If the resulting allowance is zero or the API reports blocked/unavailable, stop and leave the cursors intact.

Use the original 16-ID identity boundary below, filtering to the eight still-incomplete `docket-entries` scopes in `private/audit-2026-10-05/recent-entries/live-backfill-manifest.json`:

|  MDL | CourtListener docket ID |  MDL | CourtListener docket ID |
| ---: | ----------------------: | ---: | ----------------------: |
| 2741 |                 5981306 | 3026 |                61690868 |
| 2789 |                 6224301 | 3047 |                65407433 |
| 2873 |                 8408916 | 3060 |                66801859 |
| 3014 |                60866823 | 3080 |                67665081 |
| 3081 |                67678440 | 3094 |                68222905 |
| 3108 |                68837976 | 3113 |                68869775 |
| 3125 |                69255166 | 3144 |                69871659 |
| 3149 |                69912599 | 3166 |                72030009 |

Generate one `scope` task per listed docket from the manifest’s existing `next` cursor; use `kind: docket-entries`, `page_size: 100`, `max_pages: 50`, and do not replace or reconstruct a cursor. Exclude complete scopes, the four source-blocked headers and ID `63571952`. Relation access requires a verified native docket header with `blocked === false` and `date_blocked == null`; missing, unverifiable or unknown header flags remain held. If any target fails this check, leave its task unqueued and report its docket ID and source status. A request-budget stop is a normal bounded pause: retain all remaining tasks and continue from the updated manifest on a later heartbeat.

After the quota check and source-header audit, this PowerShell here-string creates only the still-incomplete bounded tasks. It can be rerun after a request-budget pause: existing exact continuation tasks are retained and verified, while unexpected tasks, changed scope IDs, missing cursors, or ineligible native headers stop the pass.

```powershell
@'
import fs from 'node:fs';
import { rememberDocketHeader, sourceDocketAllowsRelations } from './scripts/ingest/metadata-workflow.mjs';
const pass = 'private/audit-2026-10-05/recent-entries';
const expected = new Set(['5981306','6224301','8408916','60866823','61690868','65407433','66801859','67665081','67678440','68222905','68837976','68869775','69255166','69871659','69912599','72030009']);
const manifest = JSON.parse(fs.readFileSync(`${pass}/live-backfill-manifest.json`, 'utf8'));
const targets = [...expected].map(id => [`docket-entries:${id}`, manifest.scopes[`docket-entries:${id}`]]);
if (targets.some(([key, s]) => !s) || Object.keys(manifest.scopes).filter(key => key.startsWith('docket-entries:') && !manifest.scopes[key].complete).some(key => !expected.has(key.split(':')[1]))) throw Error('Unexpected docket-entry scope set');
const scopes = targets.filter(([, s]) => !s.complete);
if (scopes.some(([, s]) => !s.next)) throw Error('Incomplete target has no retained cursor');
if (!scopes.length) { console.log(JSON.stringify({ queued: 0, complete: true })); process.exit(0); }
const headers = new Map();
for (const file of [`${pass}/source-docket-headers.jsonl`, `${pass}/live-normalized/dockets.jsonl`]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    rememberDocketHeader(headers, JSON.parse(line));
  }
}
const queue = `${pass}/queue`; fs.mkdirSync(queue, { recursive: true });
const old = fs.readdirSync(queue).filter(name => name.endsWith('.json'));
if (old.some(name => !/^continue-entry-(5981306|6224301|8408916|60866823|61690868|65407433|66801859|67665081|67678440|68222905|68837976|68869775|69255166|69871659|69912599|72030009)\.json$/.test(name))) throw Error(`Unexpected task files; inspect and preserve them: ${old.join(', ')}`);
for (const [key, s] of scopes) {
  const id = key.split(':')[1], header = headers.get(id);
  if (!sourceDocketAllowsRelations(header?.data)) throw Error(`Source header missing, unverifiable or blocked: ${id}`);
  const task = { type: 'scope', kind: 'docket-entries', docket_id: Number(id), max_pages: 50, page_size: 100, priority: 2 };
  const file = `${queue}/continue-entry-${id}.json`;
  if (fs.existsSync(file)) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) !== JSON.stringify(task)) throw Error(`Unexpected queued task contents: ${file}`);
  } else fs.writeFileSync(file, JSON.stringify(task));
}
console.log(JSON.stringify({ queued: scopes.length, docket_ids: [...expected].sort() }));
'@ | node --input-type=module
```

The acquisition commands and safeguards below remain examples. For intake, use the four immutable packet plans linked in the latest checkpoint; do not import the mutable collector folder or bypass actual run-opening/predecessor checks. The older intake/projection examples below are superseded.

```powershell
# From the repository root, after 10:55 UTC and after confirming the lock is free:
node --use-system-ca --input-type=module -e "import { CourtListenerClient } from './scripts/ingest/courtlistener-client.mjs'; const c = new CourtListenerClient('private/audit-2026-10-05/recent-entries', 0); try { await c.initialize(); } finally { await c.close(); }"

# Calculate from the just-checked `usage-latest.json`, never from the stale sample.
$usage = Get-Content private/audit-2026-10-05/recent-entries/usage-latest.json -Raw | ConvertFrom-Json
$daily = @($usage.current_usage | Where-Object { $_.scope -eq 'user' -and $_.window_seconds -eq 86400 })
$hourly = @($usage.current_usage | Where-Object { $_.scope -eq 'user' -and $_.window_seconds -eq 3600 })
$minute = @($usage.current_usage | Where-Object { $_.scope -eq 'user' -and $_.window_seconds -eq 60 })
$limits = @($daily[0],$hourly[0],$minute[0])
if ($daily.Count -ne 1 -or $hourly.Count -ne 1 -or $minute.Count -ne 1 -or @($limits | Where-Object { $_.blocked -or $null -eq $_.remaining }).Count -gt 0) { throw 'Fresh CourtListener user limits are incomplete or blocked' }
# Minute pacing is enforced throughout the pass by the collector; it is not an hourly pass cap.
if ([int]$minute[0].remaining -le 5) { throw 'Wait for a fresh minute window before starting a pass' }
$requestBudget = [Math]::Min(300, [Math]::Min([int]$daily[0].remaining - 25, [int]$hourly[0].remaining - 35))
if ($requestBudget -le 0) { throw 'No request budget remains after safety reserves' }
$env:CL_MIN_GAP_MS = '3000'
node --use-system-ca scripts/ingest/members-cl-service.mjs --pass=private/audit-2026-10-05/recent-entries --max-requests=$requestBudget --idle-exit-minutes=1 --poll-seconds=5
```

The quota probe takes the same pass lock, reads the current usage endpoint and releases only its own lock. The service takes that lock again, checks usage at startup, resumes from manifest cursors and caches exact response bytes with provenance. It uses only read-only CourtListener metadata endpoints; it does not retrieve PDFs. The legacy `backfill-courtlistener.mjs` accepts `--cache`, `--max-requests`, `--case-limit`, `--entry-pages`, `--relation-pages`, `--entries-only=true` and `--master-limit`, but its broader case selection is not the worklist for this cursor-only continuation.

CourtListener credentials are read from `CORPUS_INGEST_CREDENTIALS` or the private `legal-source-compass.ingest.json` credential file. Never print, copy into this checkpoint, or expose credential values. `members-import-cl.mjs` uses the private `legal-source-compass.preview.json` credential file by default (or `--credentials=<private-file>`), and validates the fixed target project before writing. The import is resumable through an append-only receipt. After capture, review `service-state.json`, failed/done tasks, manifest totals, source hashes and provenance before import. Use a fresh UUID for a new import run:

```powershell
$run = [guid]::NewGuid().Guid
node --use-system-ca scripts/ingest/members-import-cl.mjs --pass=private/audit-2026-10-05/recent-entries --run=$run --types=docket-entries,recap-documents --max-rows=2000 --max-bytes=1500000
```

The importer derives RECAP-document observations only from the captured docket-entry payloads. It performs no document downloads. Retain raw observations and earlier source versions. Make a private native-entry-ID list only from observations whose native `docket` resource is one of the 16 target dockets:

```powershell
@'
import fs from 'node:fs';
const pass = 'private/audit-2026-10-05/recent-entries';
const dockets = new Set(['5981306','6224301','8408916','60866823','61690868','65407433','66801859','67665081','67678440','68222905','68837976','68869775','69255166','69871659','69912599','72030009']);
const input = `${pass}/live-normalized/docket-entries.jsonl`;
const ids = new Set();
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line), id = row.data?.docket?.match(/\/dockets\/(\d+)\//)?.[1];
  if (dockets.has(id)) ids.add(String(row.native_id));
}
if (!ids.size) throw Error('No native entry IDs found for the audited docket scope');
const out = `${pass}/recent-master-entry-ids.json`;
fs.writeFileSync(out, JSON.stringify([...ids].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1)));
console.log(JSON.stringify({ docket_scopes: dockets.size, native_entry_ids: ids.size, output: out }));
'@ | node --input-type=module

node --use-system-ca scripts/ingest/members-project-extras.mjs --mdls=2741,2789,2873,3014,3026,3047,3060,3080,3081,3094,3108,3113,3125,3144,3149,3166 --run=$run --only=entries --native-entry-ids-file=private/audit-2026-10-05/recent-entries/recent-master-entry-ids.json --staging=private/audit-2026-10-05/recent-entry-projection --dry-run=true
```

Reconcile source IDs, expected upserts, retained remote-only rows, all catalog counts and all filter facets. For an approved bounded projection, rerun the same command without `--dry-run=true`; preserve and hash-verify changed-row before-images first. Do not set `--ready=true` as part of this continuation. Keep filesystem locations and private source details out of public dataset metadata; publish only appropriate aggregate counts, hashes and qualifications. Do not replay the October 5 coverage SQL unchanged after acquiring more rows: its assertions pin the earlier 405 observations and 63,973 global rows, so render and review a fresh scoped contract with exact updated evidence before any coverage transaction.

## October 5 owner priority override

Read `owner-priority-corrections-2026-10-05.md` before further work. Judge financial disclosures and the URL directory were explicitly removed and verified empty at 10:28 UTC. Do not backfill or recreate them. State-law/calculator coverage and missing matter dockets are the owner's current priorities. The `open_us_law` rows remain stored and held; restoring official state-source access must not imply that the bulk code corpus is current or cleared.

## Current bounds and broader gaps

The 405-row refresh preserves the other source scopes and catalog facets. Only MDL 3114 exhausted its docket-entry pagination; the 16 cursors do not establish current provider totals or complete dockets. Do not describe the 12 eligible PDFs as all available docket PDFs. Keep the four blocked headers held and keep the invalid secondary 3014 ID out of matching, acquisition and membership claims. MDL membership still requires explicit docket relationship evidence; captions, parent docket IDs and similar labels are insufficient.

The October 2 bulk inventory found 33 official CourtListener exports, with 22 CSV originals retained and 11 absent. Docket entries, parties, attorneys and RECAP associations have no corresponding bulk CSV in that inventory, so the bounded native API cursors remain the supported capture route. There is no identified comprehensive current MDL master/member export. The nine unacquired financial-disclosure exports are excluded by the owner's October 5 removal instruction; do not acquire them. The 55 GB opinion-text export and 692 MB oral-argument export remain unacquired. Dated FJC fields and docket events do not establish a comprehensive verdict or settlement corpus. See [the bulk acquisition gaps](courtlistener-bulk-acquisition-gaps-2026-10-02.md) and [the earlier continuation checkpoint](courtlistener-backfill-continuation-v3-2026-10-02.md).

The legal deployment gate remains **held**: its database report returned `passed: false` because no reviewed deployment baseline has been established. Do not bypass the gate or invent a baseline. This checkpoint does not authorize a legal graph release.

## Saved release and storage result

UI commit `85b0cd8` is published through Lovable to `https://firastest1.com`. The production build and TypeScript check passed after the final UI edits; the full application suite previously passed 618 tests (one skipped), and the new storage/projection helper tests also pass. Live verification confirms the open-PDF default, exact partial coverage labels, current entry counts and official court mark. The test development server has been stopped.

The completed storage run `af9b4c2b-30a7-4044-8db1-3f3121228467` removed 29 byte-identical legacy copies, reclaiming 9,833,011 bytes, and preserved 30 artifact routes and all holds. Retained objects passed whole-body hash readback; the affected public download is unchanged. All 2,612 preservation originals and the one duplicate pair with two immutable references remain intact. Do not rerun the completed consolidation script. Read `storage-residual-review-2026-10-05.md` for proof and recovery locations.

On later days, the service refreshes unblocked source headers older than 24 hours against their exact native identity within the available request budget before continuing relation acquisition. A known blocked or unknown-flag header remains held; relation work does not automatically refresh away that hold. The newest validated retrieval controls header selection regardless of file order, and unchanged header bodies retain each new check time across service restarts. Keep successful raw captures and import/projection receipts even when a later source becomes unavailable. Further work must report new eligible/captured/published counts separately from these October 5 checkpoints.

## 08:56 UTC heartbeat — preparation before quota renewal

No CourtListener usage or acquisition request was made before the 10:55 UTC threshold. A network-disabled verification at 09:11 UTC checked all 21 saved response pairs against their exact source URL, request method, status, schema and raw-byte SHA-256. All 16 incomplete docket-entry scopes still have their saved cursors and current verified unblocked headers. Their captured and published counts are unchanged.

Explicit header refreshes now force a source request using the existing quota and lock. Before changing the compatibility cache, the client preserves both the previous and new response in immutable `api/raw/<source_sha256>.json` bodies and `api/observations/<receipt_sha256>.json` retrieval receipts, with full-byte readback. Equal bodies share one raw file while distinct retrieval receipts remain separate. A mismatched, missing or corrupted cache pair stops acquisition rather than being silently replaced. Priority header observations are append-only. Authorization/throttle stops cannot return a cached fallback.

When a rolling quota requires more than 60 seconds of waiting, the client returns `RATE_WINDOW_DEFERRED`; the service retains the queued task and cursor and exits. Treat this as a normal pause for a later heartbeat, never a reason to reconstruct a cursor or start a different pass directory. Cache-evidence failures similarly preserve the task, but require review of the retained pair and immutable copies before resuming. The forced-refresh and preservation changes passed 35 focused local regression tests without network calls; source behavior will be checked only after the acquisition window opens.

The seven catalog listing-unit exceptions were rechecked through the target-pinned, read-only Supabase catalog. Five describe valid different units; the two zero-row collections remain held. Their historical metadata and all holds are preserved. The inventory now labels imported counts and held publication status explicitly. Private evidence is in `private/audit-2026-10-05/heartbeat-0857/`.

The resulting code/UI checkpoint `127b570` is pushed to `main`, synced to Lovable and published. Live inventory verification confirms 96 datasets, 6,080,731 imported rows and 11 held badges. TypeScript, scoped ESLint, production build and narrow-screen layout checks passed. Publication changes no source counts or holds; the next acquisition still starts from the same 16 saved cursors only after 10:55 UTC and a fresh quota check.
