#!/usr/bin/env node
/**
 * Apply currency verification JSON from worker markdown files to backfill entries.
 *
 *   node scripts/limitations/backfill/apply-currency-findings.mjs --dir=PATH [--file=al-id.md] [--dry-run]
 *
 * Env: LIM_WORK (default /tmp/lim/backfill)
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const dryRun = args["dry-run"] === true;
const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const entriesDir = join(work, "entries");
const capturesDir = join(work, "captures");
const dir =
  args.dir ??
  "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/limitations/currency-2026-10-07";
const appliedDir = join(dir, ".applied");
const WORKER_FILES = ["al-id.md", "il-mo.md", "mt-pa.md", "ri-wy.md"];

function extractFindings(md) {
  const re = /```currency-findings\s*([\s\S]*?)```/g;
  const blocks = [];
  for (const m of md.matchAll(re)) blocks.push(m[1].trim());
  if (!blocks.length) throw new Error("NO_CURRENCY_FINDINGS_BLOCK");
  if (blocks.length > 1) throw new Error("MULTIPLE_CURRENCY_FINDINGS_BLOCKS");
  return JSON.parse(blocks[0]);
}

function findEntry(doc, claimType, variant) {
  const v = variant ?? "general";
  for (const e of doc.entries) {
    if (e.claimType === claimType && (e.variant ?? "general") === v) return e;
  }
  throw new Error(`ENTRY_NOT_FOUND ${doc.jurisdiction} ${claimType}/${v}`);
}

function captureExists(state, captureId) {
  return existsSync(join(capturesDir, state, `${captureId}.json`));
}

/** Match `normalizeText` / `containsLiteral` in src/lib/limitations/backfill/entries.ts */
function normalizeText(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsLiteral(haystack, needle) {
  const n = normalizeText(needle);
  return n.length >= 8 && normalizeText(haystack).includes(n);
}

const STATUTORY_PATCH_KEYS = new Set([
  "citation",
  "excerpt",
  "periodEvidence",
  "period",
  "accrual",
  "tolling",
  "repose",
  "effectiveDate",
  "lastAmended",
]);

function needsSource(patch) {
  if (!patch) return false;
  return Object.keys(patch).some((k) => STATUTORY_PATCH_KEYS.has(k));
}

function captureIdFromUrl(state, url) {
  const h = createHash("sha256").update(url).digest("hex").slice(0, 14);
  return `currency-${state.toLowerCase()}-${h}`;
}

function fetchCapture(state, captureId, sourceUrl) {
  const py = spawnSync(
    "python3",
    [join(repo, "scripts/limitations/backfill/capture.py"), state, captureId, sourceUrl],
    { encoding: "utf8", env: { ...process.env, LIM_WORK: work } },
  );
  const line = (py.stdout || "").trim().split("\n").pop();
  let parsed;
  try {
    parsed = JSON.parse(line ?? "{}");
  } catch {
    parsed = { ok: false };
  }
  if (!parsed.ok) {
    throw new Error(
      `CAPTURE_FAILED ${captureId} ${sourceUrl}: ${py.stderr?.trim() || line || py.status}`,
    );
  }
  return parsed;
}

function resolveCapture(state, correction) {
  const patch = correction.patch ?? {};
  const sourceUrl = correction.sourceUrl ?? patch.sourceUrl;
  const excerpt = correction.excerpt ?? patch.excerpt;
  let captureId = correction.captureId ?? patch.captureId;

  if (sourceUrl) {
    if (!excerpt) throw new Error(`EXCERPT_REQUIRED_WITH_SOURCE_URL ${state}`);
    captureId = captureId ?? captureIdFromUrl(state, sourceUrl);
    const metaPath = join(capturesDir, state, `${captureId}.json`);
    const hadMeta = existsSync(metaPath);
    if (!hadMeta) {
      if (dryRun) return { captureId, fetched: true, dryRun: true };
      fetchCapture(state, captureId, sourceUrl);
    } else {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      if (meta.url !== sourceUrl && meta.finalUrl !== sourceUrl)
        throw new Error(`CAPTURE_ID_URL_MISMATCH ${captureId}`);
    }
    const text = readFileSync(join(capturesDir, state, `${captureId}.txt`), "utf8");
    if (!containsLiteral(text, excerpt))
      throw new Error(`EXCERPT_NOT_IN_CAPTURE ${state} ${captureId}`);
    return { captureId, fetched: !hadMeta };
  }

  if (captureId) {
    if (!captureExists(state, captureId))
      throw new Error(`MISSING_CAPTURE ${state} ${captureId}`);
    if (excerpt) {
      const text = readFileSync(join(capturesDir, state, `${captureId}.txt`), "utf8");
      if (!containsLiteral(text, excerpt))
        throw new Error(`EXCERPT_NOT_IN_CAPTURE ${state} ${captureId}`);
    }
    return { captureId, fetched: false };
  }

  if (needsSource(patch))
    throw new Error(`CAPTURE_OR_SOURCE_URL_REQUIRED ${state} ${correction.claimType}`);
  return { captureId: null, fetched: false };
}

function applyPatch(state, entry, patch) {
  const allowed = new Set([
    "citation",
    "excerpt",
    "periodEvidence",
    "period",
    "captureId",
    "accrual",
    "tolling",
    "repose",
    "effectiveDate",
    "lastAmended",
    "status",
    "confidence",
    "confidenceNote",
    "notRecordedReason",
    "flags",
    "blockers",
    "crossChecks",
  ]);
  for (const key of Object.keys(patch)) {
    if (key === "clearFlags" || key === "clearBlockers" || key === "sourceUrl") continue;
    if (!allowed.has(key)) throw new Error(`DISALLOWED_PATCH_FIELD ${key}`);
  }
  for (const key of allowed) {
    if (patch[key] !== undefined) entry[key] = patch[key];
  }
  if (patch.clearFlags?.length) {
    const remove = new Set(patch.clearFlags);
    entry.flags = (entry.flags ?? []).filter((f) => !remove.has(f));
  }
  if (patch.clearBlockers?.length) {
    const remove = new Set(patch.clearBlockers);
    entry.blockers = (entry.blockers ?? []).filter((b) => !remove.has(b.issue));
  }
}

function ledgerPath(workerFile) {
  return join(appliedDir, workerFile.replace(/\.md$/, ".json"));
}

function shaFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function applyFile(fileName) {
  const path = join(dir, fileName);
  if (!existsSync(path)) return { file: fileName, state: "missing" };
  const content = readFileSync(path, "utf8");
  const digest = shaFile(path);
  const ledger = existsSync(ledgerPath(fileName))
    ? JSON.parse(readFileSync(ledgerPath(fileName), "utf8"))
    : null;
  if (ledger?.sourceSha256 === digest && ledger.applied)
    return { file: fileName, state: "unchanged", corrections: 0, flagsCleared: 0 };

  const data = extractFindings(content);
  const corrections = data.corrections ?? [];
  let applied = 0;
  let flagsCleared = 0;
  const details = [];

  for (const c of corrections) {
    const st = c.state?.toUpperCase();
    if (!st) throw new Error("CORRECTION_MISSING_STATE");
    const entryPath = join(entriesDir, `${st}.json`);
    if (!existsSync(entryPath)) throw new Error(`NO_ENTRY_FILE ${st}`);
    const doc = JSON.parse(readFileSync(entryPath, "utf8"));
    const entry = findEntry(doc, c.claimType, c.variant);
    const beforeFlags = (entry.flags ?? []).length;
    const patch = { ...(c.patch ?? {}) };
    const source = resolveCapture(st, c);
    if (source.captureId) patch.captureId = source.captureId;
    if (c.retrievedAt && source.captureId && !dryRun) {
      const metaPath = join(capturesDir, st, `${source.captureId}.json`);
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        meta.workerRetrievedAt = c.retrievedAt;
        writeFileSync(metaPath, `${JSON.stringify(meta, null, 1)}\n`);
      }
    }
    applyPatch(st, entry, patch);
    const afterFlags = (entry.flags ?? []).length;
    flagsCleared += Math.max(0, beforeFlags - afterFlags);
    if (!dryRun) writeFileSync(entryPath, `${JSON.stringify(doc, null, 2)}\n`);
    applied++;
    details.push({
      state: st,
      claimType: c.claimType,
      variant: c.variant ?? "general",
      captureId: source.captureId,
      sourceUrl: c.sourceUrl ?? patch.sourceUrl ?? null,
    });
  }

  if (!dryRun) {
    mkdirSync(appliedDir, { recursive: true });
    writeFileSync(
      ledgerPath(fileName),
      `${JSON.stringify(
        {
          file: fileName,
          sourceSha256: digest,
          applied: true,
          appliedAt: new Date().toISOString(),
          worker: data.worker,
          verifiedAt: data.verifiedAt,
          correctionCount: applied,
          flagsCleared,
          details,
        },
        null,
        2,
      )}\n`,
    );
  }

  return { file: fileName, state: dryRun ? "dry_run" : "applied", corrections: applied, flagsCleared, details };
}

const targets = args.file ? [args.file] : WORKER_FILES;
const results = targets.map(applyFile);
const summary = {
  dryRun,
  dir,
  results,
  totalCorrections: results.reduce((n, r) => n + (r.corrections ?? 0), 0),
  totalFlagsCleared: results.reduce((n, r) => n + (r.flagsCleared ?? 0), 0),
};
console.log(JSON.stringify(summary, null, 2));
if (results.some((r) => r.state === "missing")) process.exitCode = 1;
