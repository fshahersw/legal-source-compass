#!/usr/bin/env node
/**
 * Dry run of the two FRED sources against the live FRED API with the staged full build as the "stored" corpus: proves a
 * scheduled run rebuilds the stored rows identically (unchanged) and reports what it would insert or update. Nothing is
 * written anywhere. The key is read from private/scratch/secrets.env inside this process and never printed.
 *
 *   node scripts/api_econ/fred_dry_run.mjs [--days-since 3] [--build private/build/w1025_api-econ/fred]
 *
 * --days-since N simulates a cursor whose series were last read N days ago (so the release-date logic decides what is due).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types") && !process.features?.typescript) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fred = await import("../../src/lib/ingest/sources/fred.ts");
const { runSource } = await import("../../src/lib/ingest/runner.ts");
const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dir = path.resolve(flag("--build") ?? path.join(ROOT, "private/build/w1025_api-econ/fred"));
const daysSince = Number(flag("--days-since") ?? 3);
const key = (() => {
  for (const line of fs.readFileSync(path.join(ROOT, "private/scratch/secrets.env"), "utf8").split("\n")) {
    const m = /^FRED_API_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("FRED_API_KEY missing");
})();
const rows = {
  [fred.SERIES_DATASET]: JSON.parse(fs.readFileSync(path.join(dir, "econ_fred_series.json"), "utf8")).rows,
  [fred.OBS_DATASET]: JSON.parse(fs.readFileSync(path.join(dir, "econ_fred_observations.json"), "utf8")).rows,
};
const pick = (r, select) => {
  const out = {};
  for (const part of select.split(",")) {
    const [alias, expr] = part.includes(":") ? part.split(":") : [part, part];
    const pathParts = expr.split("->");
    let v = pathParts[0] === "item" ? r.item : r[pathParts[0]];
    for (const p of pathParts.slice(1)) v = v?.[p];
    out[alias] = v ?? null;
  }
  return out;
};
const corpus = {
  async rowsBy(dataset, column, values) {
    return (rows[dataset] ?? []).map((r, i) => ({ ...r, ordinal: i, county_geoids: [] })).filter((r) => values.includes(column === "id" ? r.id : r.source_url));
  },
  async edge() { return []; },
  async query(q) {
    const u = new URL("http://x/" + q);
    const dataset = u.searchParams.get("dataset").replace(/^eq\./, "");
    let list = (rows[dataset] ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const id = u.searchParams.get("id");
    if (id?.startsWith("in.(")) {
      const ids = id.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, ""));
      list = list.filter((r) => ids.includes(r.id));
    }
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const limit = Number(u.searchParams.get("limit") ?? 1000);
    return list.slice(offset, offset + limit).map((r) => pick(r, u.searchParams.get("select")));
  },
  async rpc() { throw new Error("dry run"); },
  async call() { throw new Error("dry run"); },
};
const now = new Date();
const back = new Date(now.getTime() - daysSince * 86400000).toISOString().slice(0, 10);
const state = {};
for (const r of rows[fred.SERIES_DATASET]) {
  const f = r.item.fred;
  state[f.series_id] = { through: f.observation_end, seen: back, fetched: back };
}
for (const adapter of [fred.fredObservations, fred.fredSeries]) {
  const t0 = Date.now();
  const s = await runSource(adapter, {
    corpus,
    env: (n) => (n === "FRED_API_KEY" ? key : undefined),
    dryRun: true,
    now,
    cursor: adapter === fred.fredObservations ? { series: state, releases_checked: back } : { next: 0 },
  });
  const out = { source: s.source, status: s.status, fetched: s.fetched, would_insert: s.inserted, would_update: s.updated, unchanged: s.unchanged, held: s.held, requests: s.requests, ms: Date.now() - t0, notes: s.notes, updates: s.detail?.updates.slice(0, 8), inserts: s.detail?.inserts.slice(0, 8) };
  console.log(JSON.stringify(out, null, 1).replaceAll(key, "[key]"));
}
