// Start the read-only overlay (built api-law datasets over the real corpus), then the dev server pointed at it, then a
// check script.   (env with EXTERNAL_SUPABASE_URL/KEY sourced) LSC_PORT=4517 node scripts/api_law/ui/run_ui_check.mjs <script.mjs> [args]
// The overlay listens on LSC_PORT+1. Credentials stay in the environment of the child processes; nothing is printed.
import { spawn } from "node:child_process";

const port = Number(process.env.LSC_PORT || 4517);
const overlayPort = port + 1;
const real = process.env.EXTERNAL_SUPABASE_URL;
if (!real) {
  console.error("EXTERNAL_SUPABASE_URL is not set");
  process.exit(2);
}
const overlay = spawn("node", ["scripts/api_law/ui/overlay_rest.mjs", String(overlayPort)], {
  env: { ...process.env, LSC_OVERLAY_UPSTREAM: real },
  stdio: ["ignore", "pipe", "inherit"],
});
const stop = () => {
  try {
    overlay.kill("SIGTERM");
  } catch {}
};
process.on("exit", stop);
await new Promise((resolve, reject) => {
  overlay.stdout.on("data", (d) => {
    const s = String(d);
    if (/overlay listening/.test(s)) resolve();
  });
  overlay.on("exit", (c) => reject(new Error(`overlay exited ${c}`)));
});
const code = await new Promise((resolve) => {
  const child = spawn("node", ["private/scratch/with_server.mjs", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, LSC_PORT: String(port), EXTERNAL_SUPABASE_URL: `http://127.0.0.1:${overlayPort}` },
  });
  child.on("exit", (c) => resolve(c ?? 1));
});
stop();
process.exit(code);
