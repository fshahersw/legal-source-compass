#!/usr/bin/env node
/**
 * Self-contained copy of the semantic-refresh edge function for deployment when the bundler will not follow imports
 * outside supabase/functions: supabase/functions/semantic-refresh/*.ts plus src/lib/semantic/chunking.ts (the one shared
 * module it imports) under ./_lib/, imports rewritten. Nothing in the repository changes.
 *
 *   node scripts/semantic/bundle_refresh_function.mjs <out-dir>     # writes <out-dir>/semantic-refresh/...
 *
 * Deploy from there: `supabase functions deploy semantic-refresh --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt` with
 * <out-dir> as the functions directory, or pass the files to the deploy tool (entrypoint index.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FN = path.join(ROOT, "supabase", "functions", "semantic-refresh");
const SHARED = { [path.join(ROOT, "src", "lib", "semantic", "chunking.ts")]: "_lib/chunking.ts" };
const IMPORT = /(from\s+|import\s*\(\s*)"([^"]+)"/g;

export function bundle(out) {
  const dest = path.join(out, "semantic-refresh");
  const files = [];
  const rewrite = (file, code, prefix) =>
    code.replace(IMPORT, (m, pre, spec) => {
      if (!spec.startsWith("."))
        throw new Error(`${path.relative(ROOT, file)}: non-relative import ${spec}`);
      const abs = path.resolve(path.dirname(file), spec);
      if (SHARED[abs]) return `${pre}"${prefix}${SHARED[abs]}"`;
      if (path.dirname(abs) !== FN)
        throw new Error(`${path.relative(ROOT, file)}: import outside the function: ${spec}`);
      return `${pre}"./${path.basename(abs)}"`;
    });
  fs.mkdirSync(path.join(dest, "_lib"), { recursive: true });
  for (const name of fs
    .readdirSync(FN)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort()) {
    const file = path.join(FN, name);
    fs.writeFileSync(path.join(dest, name), rewrite(file, fs.readFileSync(file, "utf8"), "./"));
    files.push(name);
  }
  for (const [abs, rel] of Object.entries(SHARED)) {
    const code = fs.readFileSync(abs, "utf8");
    for (const m of code.matchAll(IMPORT))
      throw new Error(`${rel} must not import anything (${m[2]})`);
    fs.writeFileSync(path.join(dest, rel), code);
    files.push(rel);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node scripts/semantic/bundle_refresh_function.mjs <out-dir>");
    process.exit(2);
  }
  const files = bundle(path.resolve(out));
  console.log(JSON.stringify({ out: path.join(path.resolve(out), "semantic-refresh"), files }));
}
