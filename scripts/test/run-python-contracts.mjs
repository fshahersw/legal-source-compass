import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const candidates = process.env.PYTHON
  ? [{ command: process.env.PYTHON, args: [] }]
  : [
      { command: "python3", args: [] },
      { command: "python", args: [] },
      { command: "py", args: ["-3"] },
    ];
const python = candidates.find(({ command, args }) => {
  const probe = spawnSync(
    command,
    [...args, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"],
    { encoding: "utf8", timeout: 10_000 },
  );
  return !probe.error && probe.status === 0;
});
if (!python)
  throw new Error("Python 3.10+ is required; install Python or set PYTHON to its executable.");

// Explicit reviewed offline suites: synthetic source bytes, temporary files and pinned conformance.
// Do not discover acquisition scripts or run their CLI entry points.
for (const suite of [
  {
    directory: "scripts/enrichment",
    modules: ["test_court_resources", "test_court_resource_bundle", "test_law_id_crosswalk"],
  },
  {
    directory: "scripts/limitations/backfill",
    modules: ["test_capture", "test_capture_browser_dom"],
  },
  { directory: "scripts/legal/state-codes/b4/ks", modules: ["test_revalidate"] },
  { directory: "scripts/legal/state-codes/hi", modules: ["test_parse_hrs"] },
  { directory: "scripts/legal/state-codes/ga", modules: ["test_stage_release"] },
  {
    directory: "scripts/legal/state-codes/historical-cic",
    modules: ["test_parse_cic_rtf", "test_capture_originals", "test_stage_historical"],
  },
  { directory: "scripts/legal/state-codes/common", modules: ["test_land_publisher_code_v2"] },
  {
    directory: "scripts/legal/state-codes",
    modules: [
      "test_ca_caml_parser",
      "test_ca_packet_v4",
      "test_ca_hierarchy",
      "test_nj_parse_bulk",
      "test_nj_stage_bulk",
      "test_nj_reconcile_toc",
    ],
  },
]) {
  const result = spawnSync(
    python.command,
    [...python.args, "-B", "-X", "utf8", "-m", "unittest", "-v", ...suite.modules],
    { cwd: resolve(root, suite.directory), stdio: "inherit", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
