#!/usr/bin/env node
/**
 * Local operator for the semantic refresh: the same core the edge function runs (supabase/functions/semantic-refresh),
 * from this machine with the admin credential, without the edge runtime's CPU and time limits. For the one-off baseline
 * (every indexed record confirmed against its source once) and for checks.
 *
 *   . private/scratch/env.sh && node scripts/semantic/refresh_local.mjs status
 *   . private/scratch/env.sh && node scripts/semantic/refresh_local.mjs enqueue [--dataset ID|all] [--reason baseline|manual]
 *   . private/scratch/env.sh && node scripts/semantic/refresh_local.mjs dry-run [--max-records N] [--dataset ID ...]
 *   . private/scratch/env.sh && node scripts/semantic/refresh_local.mjs run [--max-records N] [--max-seconds N] [--embed]
 *
 * `run` opens a run with trigger "local" and never embeds unless --embed is given (then VOYAGE_API_KEY comes from the
 * environment or private/scratch/secrets.env, inside this process only, and every request goes through the same daily and
 * global caps). Without --embed a record that needs a new vector is held for the nightly function. Credentials are never
 * printed. Output: one JSON summary line (counts, stop reasons, tokens).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { rpcClient } = await import("../../supabase/functions/semantic-refresh/serve.ts");
const { runRefresh } = await import("../../supabase/functions/semantic-refresh/refresh.ts");
const { embeddingClient } = await import("../../supabase/functions/semantic-refresh/embed.ts");

const ALL = [
  "us_code_sections",
  "ecfr_sections_full",
  "crs_reports",
  "congress_bills",
  "oversight_reports",
  "doj_oig_reports",
  "ftc_publications_index",
  "caselaw_scotus",
];

function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(ROOT, "private", "scratch", "secrets.env");
  if (!fs.existsSync(file)) return null;
  for (let line of fs.readFileSync(file, "utf8").split("\n")) {
    line = line.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    if (line.slice(0, i).trim() === name)
      return line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
  return null;
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => a === name && out.push(process.argv[i + 1]));
  return out;
}

const url = process.env.EXTERNAL_SUPABASE_URL;
const key = process.env.EXTERNAL_SUPABASE_KEY;
if (!url || !key) {
  console.error(
    "EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY must be set (source private/scratch/env.sh in the same command)",
  );
  process.exit(2);
}
const rpc = rpcClient({ url, key, timeoutMs: 120_000 });
const cmd = process.argv[2];

if (cmd === "status") {
  console.log(JSON.stringify(await rpc("semantic_refresh_status_v1", {}), null, 1));
} else if (cmd === "enqueue") {
  const which = arg("--dataset", "all");
  const reason = arg("--reason", "baseline");
  for (const d of which === "all" ? ALL : [which]) {
    let after = null;
    let queued = 0;
    let gone = 0;
    for (;;) {
      const r = await rpc("semantic_refresh_enqueue_v1", {
        p_dataset: d,
        p_after: after,
        p_limit: 50000,
        p_reason: reason,
      });
      queued += r.queued;
      gone += r.gone_queued;
      after = r.last_id;
      if (r.done) break;
    }
    console.log(JSON.stringify({ dataset: d, queued, gone_queued: gone }));
  }
} else if (cmd === "dry-run" || cmd === "run") {
  const limits = {};
  if (arg("--max-records")) limits.max_records_per_run = Number(arg("--max-records"));
  limits.max_seconds_per_run = Number(arg("--max-seconds", cmd === "run" ? "1500" : "36000")); // a local run open for 40 minutes is closed as abandoned
  limits.max_cpu_ms_per_run = 86_400_000;
  limits.page_records = Number(arg("--page", "500"));
  if (!limits.max_records_per_run) limits.max_records_per_run = 1_000_000;
  const embedKey =
    cmd === "run" && process.argv.includes("--embed") ? secret("VOYAGE_API_KEY") : null;
  if (cmd === "run" && process.argv.includes("--embed") && !embedKey) {
    console.error("VOYAGE_API_KEY is not set");
    process.exit(2);
  }
  const datasets = args("--dataset");
  const summary = await runRefresh({
    rpc,
    embedder: embedKey ? embeddingClient({ key: embedKey }) : null,
    trigger: "local",
    dryRun: cmd === "dry-run",
    limits,
    ...(datasets.length ? { datasets } : {}),
    log: (line) =>
      (line.step === "page" || line.step === "detected" || line.step === "embedded") &&
      console.error(JSON.stringify(line)),
  });
  console.log(JSON.stringify(summary));
  process.exit(summary.status === "failed" ? 1 : 0);
} else {
  console.error(
    "usage: refresh_local.mjs status | enqueue [--dataset ID|all] | dry-run [--max-records N] | run [--max-records N] [--max-seconds N] [--embed]",
  );
  process.exit(2);
}
