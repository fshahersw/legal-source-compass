#!/usr/bin/env node
/**
 * Writes src/lib/assistant/codeIndex.server.json: a compact, read-only map of the app's source for the assistant (routes and their
 * paths, components, server functions, the corpus datasets each file reads, exports and each file's leading comment). Tests,
 * generated files and JSON data are left out; no secrets live in source (credentials come only from the environment).
 * Runs before every build (npm "prebuild"), so the index follows the code.
 *
 *   node scripts/assistant/build_code_index.mjs [--check]
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const src = join(root, "src");
const out = join(src, "lib/assistant/codeIndex.server.json");
const check = process.argv.includes("--check");

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.gen\.|\.d\.ts$/.test(name)) files.push(full);
  }
  return files;
}

function leadingComment(text) {
  const block = text.match(/^\s*(?:import[^\n]*\n|\/\/[^\n]*\n|\s)*?\/\*\*([\s\S]*?)\*\//);
  const lines = text.match(/^(?:\s*\/\/[^\n]*\n)+/);
  const raw = block ? block[1] : lines ? lines[0] : "";
  return raw
    .replace(/^\s*\*\s?/gm, "")
    .replace(/^\s*\/\/\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

const entries = [];
for (const file of walk(src).sort()) {
  const text = readFileSync(file, "utf8");
  const path = relative(root, file).replaceAll("\\", "/");
  const route = text.match(/createFileRoute\(\s*"([^"]+)"\s*\)/)?.[1] ?? null;
  const exports = [...text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z0-9_]+)/g)]
    .map((m) => m[1])
    .slice(0, 24);
  const serverFns = [...text.matchAll(/export const ([A-Za-z0-9_]+)\s*=\s*createServerFn/g)].map((m) => m[1]);
  const datasets = [
    ...new Set(
      [...text.matchAll(/dataset=eq\.([a-z0-9_]+)/g), ...text.matchAll(/(?:entityQuery|dataset)\(?\s*["']([a-z][a-z0-9_]{3,60})["']/g)].map(
        (m) => m[1],
      ),
    ),
  ].slice(0, 20);
  const components = [...new Set([...text.matchAll(/from "@\/components\/([^"]+)"/g)].map((m) => m[1]))].slice(0, 20);
  const kind = route
    ? "route"
    : path.startsWith("src/components/")
      ? "component"
      : serverFns.length
        ? "server-functions"
        : path.includes(".server.")
          ? "server"
          : "library";
  entries.push({
    path,
    kind,
    ...(route ? { route } : {}),
    lines: text.split("\n").length,
    summary: leadingComment(text),
    exports,
    ...(serverFns.length ? { serverFns } : {}),
    ...(datasets.length ? { datasets } : {}),
    ...(components.length ? { components } : {}),
  });
}
const json = JSON.stringify({ files: entries }) + "\n";
if (check) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== json) {
    console.error("codeIndex.server.json is out of date; run node scripts/assistant/build_code_index.mjs");
    process.exitCode = 1;
  } else console.log(`code index up to date (${entries.length} files)`);
} else {
  writeFileSync(out, json);
  console.log(`code index: ${entries.length} files, ${Math.round(json.length / 1024)} KB`);
}
