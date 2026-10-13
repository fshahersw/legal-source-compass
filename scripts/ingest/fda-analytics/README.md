# openFDA aggregate analytics collector

This collector captures official API aggregate evidence for 26 datasets. It does not download bulk individual-report archives and does not write to the existing legal graph. App reads use the service-only read RPC; only this administrative CLI publishes snapshots.

## Source contract

The reviewed endpoint and facet matrix is [catalog.mjs](./catalog.mjs). Current primary references:

- [Official API catalog](https://open.fda.gov/apis/) and [download metadata catalog](https://api.fda.gov/download.json).
- [Query and count parameters](https://open.fda.gov/apis/query-parameters/): exact query, top-1000 terms and native field semantics are retained.
- [Authentication](https://open.fda.gov/apis/authentication/): documented Basic-auth username alternative keeps the key out of URLs, logs and capture receipts. The current page lists 240 requests/minute and 1,000/day per IP without a key, or 120,000/day per key. Actual drug/device adverse count requests returned `API_KEY_MISSING`; the production workflow requires `OPENFDA_API_KEY`.
- [Device-class field reference](https://open.fda.gov/fields/deviceclass.yaml): the API's `device_class` count aggregation returned a fielddata error, so six documented source codes `1,2,3,U,N,F` are queried separately. Their exact search totals are retained and reconciled to the inventory denominator. Unknown/missing classes are not invented.
- [510(k) field reference](https://open.fda.gov/fields/deviceclearance.yaml): decision code uses the documented `.exact` count field.
- [openFDA terms](https://open.fda.gov/terms/) and [license](https://open.fda.gov/license/). This is attributed FDA data; the app does not imply FDA endorsement or clinical suitability.

Covered families: drug enforcement/events, Drugs@FDA, Orange Book, labels, NDC, shortages; device enforcement/events/recalls/510(k)/PMA/classification/registration/UDI/historical serology evaluation; food enforcement/events; cosmetic events; animal/veterinary events; tobacco problem reports; Transparency Complete Response Letters; historical documents, NSDE, substance and UNII inventories. Separate research-study endpoints are outside this catalog.

## Metric meaning

For each dated dataset, a descending native-date query discovers its latest observed date through the prior UTC day. The source-aligned 730-day series ends no later than that native date, the parsed source release date, or the prior UTC day. The daily count sum must reconcile exactly to the record total for the identical query. `complete` describes API enumeration only; it does not establish complete reporting, incidence or causation. Missing dates after the observed cutoff remain unknown. API release metadata and retrieval timestamps are preserved separately.

Each 30/90/365/730-day facet has its own exact source-aligned query and matching record denominator. Custom-date facets are not approximated from these presets. Inventory-only datasets have a current record total and categorical distributions, never a fabricated historical trend. PMA includes supplements; 510(k) records are decisions; enforcement/device-recall overlap is explicit. These endpoint counts must not be summed as unique products, recalls or people.

Multi-valued categories overlap; individual percentages use scoped record counts and can sum above 100%. A 1,000-term response is marked truncated. Missing fields are not turned into an invented Other category. Empty native terms retain key `""` with visible label `(empty term in source)`. Only an exact `404 NOT_FOUND / No matches found!` response can prove a zero scoped total. `Nothing to count`, HTML blocks, invalid JSON, 403 and exhausted retries are errors, never zero.

## Operations

```powershell
node --use-system-ca scripts/ingest/fda-analytics/run.mjs capture --output=private/fda-analytics-capture
node --use-system-ca scripts/ingest/fda-analytics/run.mjs land --execute --output=private/fda-analytics-capture
```

`capture` uses public FDA requests only; `OPENFDA_API_KEY` is optional locally but required by the scheduled production workflow. `land` requires the existing `EXTERNAL_SUPABASE_URL` and service-role secret in process environment. Never put credentials in arguments, files or reports. Windows may require `--use-system-ca`; the workflow uses the runner's configured trust store without TLS bypass.

`--through=YYYY-MM-DD` bounds native-date discovery to a prior UTC day. `--seed=private/existing-capture` reuses only exact URL responses younger than six hours after hash/size checks. Source release and all-time totals are rechecked with fresh requests; a changed release invalidates the entire dataset instead of mixing versions. A seed carrying a key-required response cannot suppress a newly authorized keyed request. New output directories preserve each prior candidate unchanged.

The daily workflow runs at 05:41 UTC. Each capture is limited to 600 actual HTTP attempts, one request per second, 30-second request deadlines, four attempts and bounded Retry-After handling. The key's documented quota is shared with other consumers. The browser's periodic refresh reads retained snapshots only. Capture evidence preserves explicit partial, failed and unavailable dataset statuses privately. Both the landing CLI and publication boundary require every dataset to be `ready`: any degraded dataset raises `DEGRADED_CAPTURE_NOT_PUBLISHED` before network activity, makes the workflow fail, and leaves the last fully verified published snapshot current. Its capture age continues to indicate staleness. No per-dataset merge or replacement with partial results is performed.

Before any upload, `verify.mjs` independently re-derives every published total, daily bucket and facet from hash-checked raw bytes and exact query URLs, including source-release consistency. Four bounded storage workers share retry cooldown. Raw objects live only in private `corpus-originals/fda-analytics/<prefix>/<sha>.raw`; canonical snapshots live in `fda-analytics/snapshots/<sha>.json`. Writes never upsert. Each creation is journaled and fsynced before hash-readback, and every object must pass exact hash/size verification before the single atomic publish RPC.

Publication uses `corpus_fda_analytics_publish_v1`; exact run readback uses `corpus_fda_analytics_snapshot_v1(p_run)`. An interrupted upload leaves no partially published dataset: rerun `land` against the same local immutable snapshot, which checks already-present objects rather than overwriting them. Same-run publication is immutable/idempotent. The published snapshot is independently hash-checked through the read RPC. Workflow artifacts contain only hashes, counts, statuses and upload journals; source bodies and snapshots remain private.

Tests are offline, injected-transport or clearly synthetic fixtures. Run `node --test scripts/ingest/fda-analytics/*.test.mjs`; the repository's offline contract runner discovers both test files. No tests acquire live data or use real credentials.
