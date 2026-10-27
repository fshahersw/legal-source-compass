import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Reviewed offline families: injected transports, temporary synthetic files, and pure parsers.
// Exact legacy private-file audits and optional database-runtime tests have separate prerequisites.
const directories = [
  "scripts/verification",
  "scripts/enrichment",
  "scripts/ingest/gap-fill",
  "scripts/ingest/courtlistener-bulk",
  "scripts/ingest/federal-register",
  "scripts/ingest/regulatory",
  "scripts/ingest/fda-analytics",
  "scripts/ingest/official-mdl",
  "scripts/legal/state-codes",
  "scripts/legal/state-codes/hi",
];
const databaseTests = new Set([
  "publisher-code-intake.test.mjs",
  "publisher-code-intake-v2.test.mjs",
  "publisher-code-multicode-v3.test.mjs",
  "publisher-code-outline-v4.test.mjs",
  "ca-parser4-promotion.test.mjs",
  "safety-radar-contract.test.mjs",
]);
const files = directories.flatMap((directory) =>
  readdirSync(resolve(root, directory))
    .filter((name) => name.endsWith(".test.mjs") && !databaseTests.has(name))
    .map((name) => `${directory}/${name}`),
);
files.push(
  "scripts/admin/private-release-network.test.mjs",
  "scripts/admin/register-pdf-assets-v2-contract.test.mjs",
  "scripts/legal/audit-private-archive-manifests.test.mjs",
  "scripts/admin/remove-owner-collections-20261005.test.mjs",
  "scripts/admin/remove-owner-storage-20261005.test.mjs",
  "scripts/admin/remove-owner-context-keys-20261005.test.mjs",
  "scripts/admin/remove-owner-artifact-metadata-20261005.test.mjs",
  "scripts/admin/remove-openus-outline-20261005.test.mjs",
  "scripts/admin/remove-openus-bulk-storage-20261006.test.mjs",
  "scripts/admin/upload-court-reference-seals.test.mjs",
);
const result = spawnSync(process.execPath, ["--test", ...files.sort()], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
