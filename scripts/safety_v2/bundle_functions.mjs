#!/usr/bin/env node
/**
 * Fallback for deploying the safety/1 edge functions (ingest-openfda-events, ingest-cfpb-complaints) when the bundler
 * will not follow imports outside supabase/functions: writes self-contained copies to <out-dir>/<function>/ with the
 * src/lib modules they use under ./_lib/ (directory layout kept, so relative imports inside the library stay valid).
 * Nothing in the repository changes. Deploy from the output directory, e.g.
 *   supabase functions deploy ingest-openfda-events --project-ref xosqzzsnhxcyehcnirpa --no-verify-jwt
 *
 *   node scripts/safety_v2/bundle_functions.mjs <out-dir>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUNCTIONS = ["ingest-openfda-events", "ingest-cfpb-complaints"];
const LIB = path.join(ROOT, "src", "lib");
const IMPORT = /(from\s+|import\s*\(\s*)"([^"]+)"/g;

export function bundle(out) {
  const written = [];
  for (const fn of FUNCTIONS) {
    const entry = path.join(ROOT, "supabase", "functions", fn, "index.ts");
    const dest = path.join(out, fn);
    const queue = [];
    const index = fs.readFileSync(entry, "utf8").replace(IMPORT, (m, pre, spec) => {
      const abs = path.resolve(path.dirname(entry), spec);
      if (!abs.startsWith(LIB + path.sep)) throw new Error(`${fn}: import outside src/lib: ${spec}`);
      queue.push(abs);
      return `${pre}"./_lib/${path.relative(LIB, abs).split(path.sep).join("/")}"`;
    });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "index.ts"), index);
    written.push(`${fn}/index.ts`);
    const seen = new Set();
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(IMPORT)) {
        const spec = m[2];
        if (!spec.startsWith(".")) throw new Error(`${file}: non-relative import ${spec} cannot run in the edge runtime`);
        const abs = path.resolve(path.dirname(file), spec);
        if (!abs.startsWith(LIB + path.sep)) throw new Error(`${file}: import outside src/lib: ${spec}`);
        queue.push(abs);
      }
      const rel = path.relative(LIB, file);
      fs.mkdirSync(path.join(dest, "_lib", path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dest, "_lib", rel), text);
      written.push(`${fn}/_lib/${rel.split(path.sep).join("/")}`);
    }
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node scripts/safety_v2/bundle_functions.mjs <out-dir>");
    process.exit(2);
  }
  console.log(bundle(path.resolve(out)).join("\n"));
}
