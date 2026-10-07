#!/usr/bin/env node
/**
 * Apply currency worker findings, build a limitations bundle, run checks, stage (and optionally activate).
 *
 *   node scripts/limitations/backfill/release-from-currency.mjs --release=2026-10-07.1
 *   node scripts/limitations/backfill/release-from-currency.mjs --wait --stage --execute
 *
 * Env:
 *   LIM_WORK, LIM_BUNDLE (base protected copy, default /tmp/lim/data/limitations),
 *   LIM_OUT (output bundle dir),
 *   CURRENCY_DIR (worker findings directory)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repo = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);

const currencyDir =
  process.env.CURRENCY_DIR ??
  args["currency-dir"] ??
  "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/limitations/currency-2026-10-07";
const WORKERS = ["al-id.md", "il-mo.md", "mt-pa.md", "ri-wy.md"];
const release = args.release ?? "2026-10-07.1";
const [snapshotDate, ruleSeq] = release.includes(".")
  ? [release.slice(0, 10), release.split(".")[1] ?? "1"]
  : ["2026-10-07", "1"];

const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const bundleIn = process.env.LIM_BUNDLE ?? "/tmp/lim/data/limitations";
const bundleOut = process.env.LIM_OUT ?? `/tmp/lim/out/limitations-${release}`;
const captures = join(work, "captures");

function run(cmd, env = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`COMMAND_FAILED ${cmd.join(" ")}`);
  }
  return r.stdout;
}

function workerReady(fileName) {
  const p = join(currencyDir, fileName);
  if (!existsSync(p)) return false;
  const md = readFileSync(p, "utf8");
  const m = md.match(/```currency-findings\s*([\s\S]*?)```/);
  if (!m) return false;
  try {
    const j = JSON.parse(m[1]);
    return typeof j.verifiedAt === "string" && j.verifiedAt.length >= 10;
  } catch {
    return false;
  }
}

function waitForWorkers(intervalMs = 15000, maxWaitMs = 6 * 60 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const missing = WORKERS.filter((f) => !existsSync(join(currencyDir, f)));
    const ready = WORKERS.filter(workerReady);
    console.log(JSON.stringify({ wait: true, missing, ready: ready.length, of: WORKERS.length }));
    if (missing.length === 0 && ready.length === WORKERS.length) return;
    run(["sleep", String(Math.ceil(intervalMs / 1000))]);
  }
  throw new Error("WAIT_TIMEOUT");
}

function countFlaggedEntries() {
  let flagged = 0;
  let cells = 0;
  for (const f of readdirSync(join(work, "entries")).filter((x) => x.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(work, "entries", f), "utf8"));
    for (const e of doc.entries) {
      cells++;
      if (e.status === "flagged") flagged++;
    }
  }
  return { flaggedEntries: flagged, entryRecords: cells };
}

function help() {
  console.log(`Usage:
  --apply          Apply all worker files (re-apply if source hash changed)
  --build          Run build-bundle.ts to ${bundleOut}
  --check          bundle-invariants + validation via build output
  --stage          compute manifest; with --execute upload via stage-limitations-release.mjs
  --activate       activate-limitations-release.mjs (requires --manifest-sha256=)
  --wait           Block until all four worker files set verifiedAt (ISO date)
  --release=ID     Default 2026-10-07.1
  --currency-dir=  Default store internal/limitations/currency-2026-10-07
`);
}

if (args.help) {
  help();
  process.exit(0);
}

const report = { release, currencyDir, bundleOut, steps: [] };

if (args.wait) {
  waitForWorkers();
  report.steps.push("wait_complete");
}

const applyFiles = args.files
  ? String(args.files)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
  : null;
const shouldApply =
  args.apply === true || ((args.build || args.check || args.stage) && args["no-apply"] !== true);
if (shouldApply) {
  const applyCmd = [
    "node",
    "scripts/limitations/backfill/apply-currency-findings.mjs",
    `--dir=${currencyDir}`,
  ];
  for (const f of applyFiles ?? []) applyCmd.push(`--file=${f}`);
  const out = run(applyCmd, { LIM_WORK: work });
  report.apply = JSON.parse(out);
  report.steps.push("apply");
}

if (args.build || args.check || args.stage) {
  const buildLog = run(
    ["bun", "scripts/limitations/backfill/build-bundle.ts"],
    {
      LIM_WORK: work,
      LIM_BUNDLE: bundleIn,
      LIM_OUT: bundleOut,
      LIM_SNAPSHOT_DATE: snapshotDate,
      LIM_RULE_SEQ: ruleSeq,
    },
  );
  report.build = JSON.parse(buildLog.trim().split("\n").pop() ?? "{}");
  report.steps.push("build");
}

if (args.check) {
  run(["bun", "test", "src/lib/limitations/bundle-invariants.test.ts"], {
    LIM_BUNDLE_DIR: bundleOut,
  });
  report.steps.push("bundle_invariants_ok");
}

if (args.stage) {
  const manifestOut = run(
    [
      "node",
      "scripts/admin/compute-staged-limitations-manifest.mjs",
      `--release=${release}`,
      `--bundle=${bundleOut}`,
      `--captures=${captures}`,
    ],
  );
  report.manifest = JSON.parse(manifestOut);
  report.steps.push("manifest_computed");
  if (args.execute) {
    const stageOut = run(
      [
        "node",
        "scripts/admin/stage-limitations-release.mjs",
        `--release=${release}`,
        `--bundle=${bundleOut}`,
        `--captures=${captures}`,
        "--execute",
      ],
    );
    report.stage = JSON.parse(stageOut.trim().split("\n").pop() ?? "{}");
    report.steps.push("staged");
  }
}

if (args.activate) {
  if (!args["manifest-sha256"]) throw new Error("manifest-sha256 required for --activate");
  run(
    [
      "node",
      "scripts/admin/activate-limitations-release.mjs",
      "--from-storage",
      `--release=limitations-${release}`,
      `--sha256=${args["manifest-sha256"]}`,
      "--verify",
    ],
  );
  report.steps.push("activated");
}

report.entryFlags = countFlaggedEntries();
if (report.build?.cells) report.flaggedCells = report.build.cells.flagged;

console.log(JSON.stringify(report, null, 2));
