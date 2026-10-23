#!/usr/bin/env node
/**
 * Fallback for deploying the ingest edge functions when the bundler will not follow imports outside supabase/functions:
 * writes self-contained copies (index.ts + the src/lib/ingest modules it uses under ./_ingest/, imports rewritten) to an
 * output directory. Deploy from there, e.g. `supabase functions deploy <name> --project-ref xosqzzsnhxcyehcnirpa
 * --no-verify-jwt` with that directory as supabase/functions, or pass the files to the deploy tool. Nothing is changed in
 * the repository.
 *
 *   node scripts/ingest/bundle_functions.mjs <out-dir>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUNCTIONS = path.join(ROOT, "supabase", "functions");
const LIB = path.join(ROOT, "src", "lib", "ingest");
const IMPORT = /(from\s+|import\s*\(\s*)"([^"]+)"/g;

export function bundle(out) {
  const written = [];
  for (const fn of fs.readdirSync(FUNCTIONS).filter((d) => d.startsWith("ingest-"))) {
    const entry = path.join(FUNCTIONS, fn, "index.ts");
    if (!fs.existsSync(entry)) continue;
    const dest = path.join(out, fn);
    const seen = new Set();
    const queue = [];
    let index = fs.readFileSync(entry, "utf8").replace(IMPORT, (m, pre, spec) => {
      const abs = path.resolve(path.dirname(entry), spec);
      if (!abs.startsWith(LIB + path.sep))
        throw new Error(`${fn}: import outside src/lib/ingest: ${spec}`);
      queue.push(abs);
      return `${pre}"./_ingest/${path.relative(LIB, abs).split(path.sep).join("/")}"`;
    });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "index.ts"), index);
    written.push(path.join(fn, "index.ts"));
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const code = fs.readFileSync(file, "utf8");
      for (const m of code.matchAll(IMPORT)) {
        const spec = m[2];
        if (!spec.startsWith("."))
          throw new Error(`${path.relative(ROOT, file)}: non-relative import ${spec}`);
        const abs = path.resolve(path.dirname(file), spec);
        if (!abs.startsWith(LIB + path.sep))
          throw new Error(`${path.relative(ROOT, file)}: import outside src/lib/ingest: ${spec}`);
        queue.push(abs);
      }
      const rel = path.relative(LIB, file);
      fs.mkdirSync(path.join(dest, "_ingest", path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dest, "_ingest", rel), code);
      written.push(path.join(fn, "_ingest", rel));
    }
    index = null;
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node scripts/ingest/bundle_functions.mjs <out-dir>");
    process.exit(2);
  }
  const files = bundle(path.resolve(out));
  console.log(
    JSON.stringify({
      out: path.resolve(out),
      files: files.length,
      functions: [...new Set(files.map((f) => f.split(path.sep)[0]))],
    }),
  );
}
