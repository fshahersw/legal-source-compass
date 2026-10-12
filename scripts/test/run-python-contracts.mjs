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
const result = spawnSync(
  python.command,
  [
    ...python.args,
    "-B",
    "-X",
    "utf8",
    "-m",
    "unittest",
    "-v",
    "test_court_resources",
    "test_court_resource_bundle",
    "test_law_id_crosswalk",
  ],
  { cwd: resolve(root, "scripts/enrichment"), stdio: "inherit", timeout: 120_000 },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
