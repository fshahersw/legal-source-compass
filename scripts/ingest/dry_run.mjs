#!/usr/bin/env node
/**
 * Dry run of the self-updating sources: the same shared logic the edge functions run (src/lib/ingest/**), against the
 * live sources (read-only) and the corpus (read-only), printing per dataset what a run would insert, update and leave
 * unchanged, which source records it would hold back and why, and — for records already held — whether this port
 * rebuilds them identically. Nothing is written anywhere.
 *
 * REST mode (corpus read through PostgREST; the client refuses everything except GET corpus_records and the read-only
 * RPC ingest_distinct_text_v1):
 *   . private/scratch/env.sh && python3 -I -B scripts/ingest/dry_run.py [--source ID] [--json FILE] [--show N]
 *
 * Snapshot mode (no corpus credentials in the process): corpus reads come from a snapshot made with read-only SQL
 * (scripts/ingest/snapshot.mjs documents the format) and the comparison with stored rows is written as read-only SQL
 * statements to run afterwards (md5 of the same comparable JSON on both sides):
 *   python3 -I -B scripts/ingest/dry_run.py --snapshot FILE --emit-sql FILE [--source ID] [--json FILE]
 *
 * dry_run.py loads DATA_GOV_API_KEY with secrets_env.load and starts this script. Keys are never printed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types") && !process.features?.typescript) {
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

const { corpusClient } = await import("../../src/lib/ingest/corpus.ts");
const { runSource } = await import("../../src/lib/ingest/runner.ts");
const { SOURCES } = await import("../../src/lib/ingest/registry.ts");
const { comparableOf, contentOf } = await import("../../src/lib/ingest/rows.ts");
const { snapshotCorpus, classificationSql, COMPARABLE_SQL, FULL_ROW_SQL, jsonbHash } =
  await import("./snapshot.mjs");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const only = flag("--source");
const jsonOut = flag("--json");
const show = Number(flag("--show") ?? 5);
const snapshotFile = flag("--snapshot");
const sqlOut = flag("--emit-sql");

let corpusFor;
const missing = [];
if (snapshotFile) {
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  corpusFor = () => snapshotCorpus(snapshot, missing);
} else {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_KEY;
  if (!url || !key) {
    console.error(
      "EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (read-only use), or pass --snapshot",
    );
    process.exit(2);
  }
  const READ_RPCS = new Set(["ingest_distinct_text_v1"]);
  const readOnlyFetch = async (input, init = {}) => {
    const u = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const path = u.pathname.replace(/^\/rest\/v1\//, "");
    const rpc = path.startsWith("rpc/") ? path.slice(4) : null;
    const ok =
      (method === "GET" && path === "corpus_records") ||
      (method === "POST" && rpc && READ_RPCS.has(rpc));
    if (!ok) throw new Error(`dry run: refused ${method} ${u.pathname}`);
    return fetch(input, init);
  };
  const reader = corpusClient({ url, key, fetch: readOnlyFetch });
  const corpus = {
    ...reader,
    call: async (name) => {
      throw new Error(`dry run: refused RPC ${name}`);
    },
  };
  corpusFor = () => corpus;
}

const results = [];
const statements = [];
for (const adapter of SOURCES) {
  if (only && adapter.source !== only) continue;
  const started = Date.now();
  const before = missing.length;
  let collected = null;
  let summary;
  try {
    summary = await runSource(adapter, {
      corpus: corpusFor(),
      env: (k) => process.env[k],
      dryRun: true,
      now: new Date(),
      onCollected: (c) => (collected = c),
    });
  } catch (error) {
    summary = {
      source: adapter.source,
      dataset: adapter.dataset,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const d = summary.detail;
  const line = {
    source: summary.source,
    dataset: summary.dataset,
    status: missing.length > before ? "needs snapshot" : summary.status,
    fetched: summary.fetched,
    candidates: collected?.rows.length ?? null,
    would_insert: snapshotFile && adapter.mode === "upsert" ? "see SQL" : summary.inserted,
    would_update: snapshotFile && adapter.mode === "upsert" ? "see SQL" : summary.updated,
    unchanged: snapshotFile && adapter.mode === "upsert" ? "see SQL" : summary.unchanged,
    held: summary.held,
    held_reasons: summary.heldReasons,
    requests: summary.requests,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    error: summary.error ?? null,
    notes: summary.notes,
    parity: snapshotFile ? "see SQL" : (d?.parity ?? null),
    sample_inserts: d?.inserts.slice(0, show) ?? [],
    sample_updates: d?.updates.slice(0, show) ?? [],
    update_paths: d
      ? Object.entries(
          d.updates.flatMap((u) => u.changed).reduce((m, p) => ((m[p] = (m[p] ?? 0) + 1), m), {}),
        ).sort((a, b) => b[1] - a[1])
      : [],
    missing: missing.slice(before),
  };
  if (snapshotFile && collected && line.status !== "needs snapshot") {
    if (adapter.mode === "upsert") {
      const pairs = collected.rows.map((r) => [r.id, jsonbHash(comparableOf(adapter, r))]);
      const sql = classificationSql(
        adapter.source,
        adapter.dataset,
        pairs,
        COMPARABLE_SQL[adapter.source],
      );
      if (sql) statements.push({ source: adapter.source, kind: "classification", sql });
    }
    if (collected.rebuildHeld) {
      const held = await collected.rebuildHeld();
      const pairs = held.map(({ built, stored }) => [
        stored.id,
        jsonbHash({ ...contentOf(built), ordinal: built.ordinal ?? null }),
      ]);
      const sql = classificationSql(
        `${adapter.source}:parity`,
        adapter.dataset,
        pairs,
        FULL_ROW_SQL,
      );
      if (sql) statements.push({ source: adapter.source, kind: "parity", sql });
      line.parity = { rebuilt: held.length, compare: "see SQL" };
    }
  }
  results.push(line);
  console.log(JSON.stringify(line));
}
console.log(
  "\nsource                        dataset                                    fetched  insert  update  unchanged  held  status",
);
for (const r of results) {
  console.log(
    `${r.source.padEnd(30)}${r.dataset.padEnd(43)}${String(r.fetched ?? "-").padStart(7)}${String(r.would_insert ?? "-").padStart(8)}${String(r.would_update ?? "-").padStart(8)}${String(r.unchanged ?? "-").padStart(11)}${String(r.held ?? "-").padStart(6)}  ${r.status}${r.error ? ` (${r.error})` : ""}`,
  );
}
if (missing.length)
  console.log(
    `\n${missing.length} corpus read(s) missing from the snapshot:\n${missing.join("\n")}`,
  );
if (sqlOut) {
  fs.writeFileSync(
    sqlOut,
    statements.map((s) => `-- ${s.source} ${s.kind}\n${s.sql}\n`).join("\n"),
  );
  console.log(`\n${statements.length} read-only SQL statement(s) written to ${sqlOut}`);
}
if (jsonOut)
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      { at: new Date().toISOString(), mode: snapshotFile ? "snapshot" : "rest", results },
      null,
      1,
    ),
  );
