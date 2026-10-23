#!/usr/bin/env node
/**
 * Dry run of the api-law self-updating sources (src/lib/ingest/sources/apiLawRegistry.ts): the same code the edge
 * functions run, against the live sources (read-only) and the corpus (read-only: only GET corpus_records is allowed),
 * printing what a run would insert, update and leave unchanged, and what it holds back. Nothing is written.
 *
 *   . private/scratch/env.sh && set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
 *     node scripts/api_law/dry_run.mjs --source sec_enforcement [--cursor '{"..."}'] [--show 5] [--json FILE]
 */
import fs from "node:fs";
import { ensureStripTypes, flag } from "./lib/node.mjs";

ensureStripTypes(import.meta.url);
const { corpusClient } = await import("../../src/lib/ingest/corpus.ts");
const { runSource } = await import("../../src/lib/ingest/runner.ts");
const { API_LAW_SOURCES } = await import("../../src/lib/ingest/sources/apiLawRegistry.ts");
const args = process.argv.slice(2);
const only = flag(args, "--source");
const show = Number(flag(args, "--show", "5"));
const cursorArg = flag(args, "--cursor");
const jsonOut = flag(args, "--json");
const url = process.env.EXTERNAL_SUPABASE_URL;
const key = process.env.EXTERNAL_SUPABASE_KEY;
if (!url || !key) {
  console.error("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (read-only use)");
  process.exit(2);
}
const readOnlyFetch = async (input, init = {}) => {
  const u = new URL(String(input));
  const method = (init.method ?? "GET").toUpperCase();
  if (!(method === "GET" && u.pathname.replace(/^\/rest\/v1\//, "") === "corpus_records")) throw new Error(`dry run: refused ${method} ${u.pathname}`);
  return fetch(input, init);
};
const corpus = corpusClient({ url, key, fetch: readOnlyFetch });
const out = [];
for (const adapter of API_LAW_SOURCES.filter((s) => !only || s.source === only)) {
  const summary = await runSource(adapter, {
    corpus,
    env: (n) => process.env[n],
    dryRun: true,
    trigger: "manual",
    ...(cursorArg ? { cursor: JSON.parse(cursorArg) } : {}),
    log: (l) => console.error(JSON.stringify(l)),
  });
  out.push(summary);
  const d = summary.detail ?? { inserts: [], updates: [] };
  console.log(JSON.stringify({
    source: summary.source, status: summary.status, error: summary.error, fetched: summary.fetched,
    would_insert: summary.inserted, would_update: summary.updated, unchanged: summary.unchanged, held: summary.held,
    held_reasons: summary.heldReasons, requests: summary.requests, cursor_after: summary.cursorAfter,
    inserts: d.inserts.slice(0, show), updates: d.updates.slice(0, show),
  }, null, 1));
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
