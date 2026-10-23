#!/usr/bin/env node
/**
 * Full build of the FRED datasets with the same row builders the scheduled refresh uses (src/lib/ingest/sources/fred.ts),
 * so a later scheduled run finds every row identical. Writes two build files in the enrichment contract format
 * ({dataset, label, listing_block, summary, rows, built_at, inputs}) that private/scratch/enrich/publish_build.py
 * validates and publishes (lead only):
 *
 *   private/build/w1025_api-econ/fred/econ_fred_series.json
 *   private/build/w1025_api-econ/fred/econ_fred_observations.json
 *
 * Usage (the key is read from private/scratch/secrets.env inside this process; never printed):
 *   node scripts/api_econ/fred_build.mjs [--series WGS1YR,CPIAUCNS] [--out <dir>] [--from YYYY-MM-DD]
 *
 * --series builds a subset (the validation sample); --from limits observations to dates on or after a day (sample only;
 * the full build reads each series from its first observation). Requests are spaced 0.6 s apart (FRED allows 120 a
 * minute), every response is hashed into `inputs` (URL without the key).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types") && !process.features?.typescript) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fred = await import("../../src/lib/ingest/sources/fred.ts");
const { FRED_SERIES, GROUP_LABELS } = await import("../../src/lib/ingest/sources/fredSpec.ts");
const { politeHttp } = await import("../../src/lib/ingest/http.ts");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const only = flag("--series")?.split(",").filter(Boolean);
const from = flag("--from");
const out = path.resolve(flag("--out") ?? path.join(ROOT, "private/build/w1025_api-econ/fred"));

function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(ROOT, "private/scratch/secrets.env");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} is not set`);
}
const key = secret("FRED_API_KEY");
const specs = only ? FRED_SERIES.filter((s) => only.includes(s.id)) : FRED_SERIES;
if (only && specs.length !== only.length) throw new Error("unknown series in --series");

const http = politeHttp({ maxRequests: 5000, minIntervalMs: 600, maxRetryWaitMs: 120_000, attempts: 4 });
const builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const asOf = builtAt.slice(0, 10);

const seriesRows = [];
const obsRows = [];
const held = [];
const sourcesByRelease = new Map();
const perSeries = [];
for (const spec of specs) {
  const meta = await fred.fetchSeriesMeta(http, key, spec.id);
  if (meta.id !== spec.id) throw new Error(`FRED returned ${meta.id} for ${spec.id}`);
  if (fred.isRestricted(meta)) {
    held.push({ series: spec.id, reason: "FRED notes mark the series as copyrighted by a third party" });
    continue;
  }
  const release = await fred.fetchRelease(http, key, spec.id);
  if (!sourcesByRelease.has(release.id))
    sourcesByRelease.set(release.id, await fred.fetchSources(http, key, release.id));
  const sources = sourcesByRelease.get(release.id);
  const start = from && from > meta.observation_start ? from : meta.observation_start;
  const raw = await fred.fetchObservations(http, key, spec.id, start);
  const obs = fred.currentObservations(raw);
  const rows = fred.observationRows(fred.obsMetaOf(spec, meta), obs, asOf);
  obsRows.push(...rows);
  const withValue = obs.filter((o) => o.value !== null);
  seriesRows.push(
    fred.seriesRow(
      spec,
      meta,
      release,
      sources,
      { years: rows.map((r) => r.id.split(":")[2]), latest: withValue.at(-1) ?? null },
      asOf,
    ),
  );
  perSeries.push({
    series: spec.id,
    vintage_rows: raw.length,
    dates: obs.length,
    with_value: withValue.length,
    revised: obs.filter((o) => o.firstVintage !== undefined).length,
    first: obs[0]?.date ?? null,
    last: obs.at(-1)?.date ?? null,
    year_rows: rows.length,
  });
  console.error(`${spec.id}: ${obs.length} dates, ${rows.length} year rows`);
}

const inputs = http.requests.map((r) => ({ url: r.url, sha256: r.sha256, bytes: r.bytes, retrieved_at: r.retrieved_at, status: r.status }));
const terms = `FRED API Terms of Use (${fred.FRED_TERMS_URL}): the notice "${fred.FRED_NOTICE}" must be shown prominently and users of the application must be shown the terms link; series owned by third parties carry "Copyright" in their notes and are refused by the builder (none of the listed series do). The series here are U.S. government data: Federal Reserve Board H.15, BLS (CPI, ECI, CES, CPS, LAUS) and BEA (PCE).`;
const groupOptions = Object.fromEntries(
  Object.entries(GROUP_LABELS).filter(([g]) => specs.some((s) => s.group === g)),
);
const listing = (columns, filters) => ({
  page: 1,
  limit: 50,
  columns: columns.map(([key, label]) => ({ key, label })),
  filters: [
    { name: "q", type: "search", label: "Search" },
    ...filters.map(([name, label, options]) => ({
      name,
      type: "select",
      label,
      options: Object.entries(options).map(([value, l]) => ({ label: l, value })),
    })),
  ],
});
const common = {
  source: "https://fred.stlouisfed.org/",
  api: fred.API_DOCS,
  terms,
  notice: fred.FRED_NOTICE,
  vintage_basis: fred.VINTAGE_BASIS,
  method:
    "FRED API: fred/series (metadata), fred/series/release and fred/release/sources (release and source agency), fred/series/observations with realtime_start 1776-07-04 and realtime_end 9999-12-31 (the full ALFRED real-time history), reduced to the current value of each date with its vintage date and, where it differs, the first published value. Built by scripts/api_econ/fred_build.mjs with the row builders the scheduled refresh (supabase/functions/ingest-fred) uses.",
  built_at: builtAt,
  sample: Boolean(only || from),
  ...(from ? { observations_from: from } : {}),
  held,
};
fs.mkdirSync(out, { recursive: true });
const write = (dataset, label, listing_block, summary, rows) => {
  const body = { dataset, label, listing_block, summary, rows, built_at: builtAt, inputs };
  const file = path.join(out, `${dataset}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { file: path.relative(ROOT, file), rows: rows.length, bytes: fs.statSync(file).size, sha256: sha };
};
const files = [
  write(
    fred.SERIES_DATASET,
    "FRED economic series: Treasury yields, the federal post-judgment rate, prime and federal funds rates, CPI, wages and unemployment",
    listing(
      [
        ["label", "Series"],
        ["series_id", "FRED ID"],
        ["frequency", "Frequency"],
        ["units", "Units"],
        ["latest", "Latest value"],
        ["latest_date", "Latest date"],
      ],
      [
        ["group", "Group", groupOptions],
        ["frequency", "Frequency", { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly" }],
        ["seasonal_adjustment", "Seasonal adjustment", { SA: "Seasonally adjusted", NSA: "Not seasonally adjusted" }],
      ],
    ),
    { ...common, rows: seriesRows.length, series: perSeries.length, observation_dataset: fred.OBS_DATASET },
    seriesRows,
  ),
  write(
    fred.OBS_DATASET,
    "FRED observations by series and year, with ALFRED vintage dates",
    listing(
      [
        ["series", "FRED ID"],
        ["year", "Year"],
        ["observations", "Observations"],
        ["first", "First date"],
        ["last", "Last date"],
        ["units", "Units"],
        ["revised", "Revised values"],
      ],
      [["group", "Group", groupOptions]],
    ),
    {
      ...common,
      rows: obsRows.length,
      observations: perSeries.reduce((a, s) => a + s.dates, 0),
      per_series: perSeries,
      series_dataset: fred.SERIES_DATASET,
    },
    obsRows,
  ),
];
fs.writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify({ built_at: builtAt, requests: http.requests.length, files, held, per_series: perSeries }, null, 2),
);
console.log(JSON.stringify({ requests: http.requests.length, files, held }, null, 1));
