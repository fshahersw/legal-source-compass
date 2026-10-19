// Runs private/scratch/enrich/publish_build.py from the main checkout with the environment that node loaded with
// --env-file (inside a worktree the shell may not source the credentials file). Nothing from the environment is printed.
//   node --env-file=/home/user/legal-source-compass/private/scratch/env.sh scripts/enrichment/court_rules/run_publish.mjs --publish|--check private/build/court_rules/<dataset>.json
import { spawnSync } from "node:child_process";

const [mode, file] = process.argv.slice(2);
if (!["--publish", "--check"].includes(mode) || !/^private\/build\/court_rules\/[a-z_]+\.json$/.test(file ?? "")) {
  console.error("usage: run_publish.mjs --publish|--check private/build/court_rules/<dataset>.json");
  process.exit(2);
}
const r = spawnSync("python3", ["-I", "-B", "private/scratch/enrich/publish_build.py", mode, file], {
  cwd: "/home/user/legal-source-compass",
  env: process.env,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
