#!/usr/bin/env node
/**
 * Fallback for deploying the ingest edge functions when the bundler will not follow imports outside supabase/functions:
 * writes self-contained copies (index.ts + the src/lib modules it uses under ./_lib/<module>/, imports rewritten) to an
 * output directory. Deploy from there, e.g. `supabase functions deploy <name> --project-ref xosqzzsnhxcyehcnirpa
 * --no-verify-jwt` with that directory as supabase/functions, or pass the files to the deploy tool. Nothing is changed in
 * the repository.
 *
 *   node scripts/ingest/bundle_functions.mjs <out-dir>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUNCTIONS = path.join(ROOT, "supabase", "functions");
// src/lib/ingest and the modules it shares with the functions (src/lib/citations for ingest-citations)
const LIB = path.join(ROOT, "src", "lib");
const IMPORT = /(from\s+|import\s*\(\s*)"([^"]+)"/g;

// The generated citation pattern table (about 330 KB) is too large for the deploy tool: the bundle gets a small module
// that loads src/lib/citations/patterns.json from private storage at cold start, checked against its SHA-256 here
// (src/lib/citations/patterns.remote.ts; upload the file first with scripts/citations_v2/upload_patterns.mjs).
const PATTERNS_DATA = path.join(LIB, "citations", "patterns.data.ts");
const PATTERNS_REMOTE = path.join(LIB, "citations", "patterns.remote.ts");

export function patternsSha256() {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(LIB, "citations", "patterns.json")))
    .digest("hex");
}

function remotePatternsModule() {
  return `// Written by scripts/ingest/bundle_functions.mjs in place of the generated patterns.data.ts: the table is loaded at
// cold start from private storage and must have the SHA-256 of src/lib/citations/patterns.json when this was bundled.
import { loadPatternTable } from "./patterns.remote.ts";
import type { PatternTable } from "./types.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export const PATTERNS: PatternTable = await loadPatternTable({
  env: (name) => Deno.env.get(name),
  sha256: "${patternsSha256()}",
});
`;
}

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
        throw new Error(`${fn}: import outside src/lib: ${spec}`);
      queue.push(abs);
      return `${pre}"./_lib/${path.relative(LIB, abs).split(path.sep).join("/")}"`;
    });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "index.ts"), index);
    written.push(path.join(fn, "index.ts"));
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const code = file === PATTERNS_DATA ? remotePatternsModule() : fs.readFileSync(file, "utf8");
      if (file === PATTERNS_DATA) queue.push(PATTERNS_REMOTE);
      for (const m of code.matchAll(IMPORT)) {
        const spec = m[2];
        if (!spec.startsWith("."))
          throw new Error(`${path.relative(ROOT, file)}: non-relative import ${spec}`);
        const abs = path.resolve(path.dirname(file), spec);
        if (!abs.startsWith(LIB + path.sep))
          throw new Error(`${path.relative(ROOT, file)}: import outside src/lib: ${spec}`);
        queue.push(abs);
      }
      const rel = path.relative(LIB, file);
      fs.mkdirSync(path.join(dest, "_lib", path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dest, "_lib", rel), code);
      written.push(path.join(fn, "_lib", rel));
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
