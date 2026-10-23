// Read-only export of one public state-code projection: every section's recorded hierarchy, citation and heading,
// exactly as public.corpus_publisher_code_projected_outline_v4 reads them (the public gate's source system,
// code-section rows, schema publisher-code-evidence/2, not quarantined). Nothing is written to the corpus.
//
//   node scripts/legal/state-codes/outline/export-projection.mjs <outDir> <J=source_system>[,...]
//
// Needs EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment (service role; read through PostgREST with
// Accept-Profile corpus_ingest). Writes <outDir>/<J>.json.gz:
//   { jurisdiction, source_system, exported_at, sections: number,
//     paths: [[[level, number, heading, node_id], ...], ...],      // distinct recorded hierarchy prefixes (no section row)
//     rows: [[native_id, citation, heading, status_note, pathIndex], ...] }
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [outDir, mapping] = process.argv.slice(2);
if (!outDir || !mapping) {
  console.error("usage: export-projection.mjs <outDir> <J=source_system>[,...]");
  process.exit(2);
}
const url = (process.env.EXTERNAL_SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY ?? "";
if (!url || !key) {
  console.error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  process.exit(2);
}
const headers = { apikey: key, Accept: "application/json", "Accept-Profile": "corpus_ingest" };
if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
const PAGE = 1000;

async function page(sourceSystem, after) {
  const q = new URLSearchParams({
    select: "native_id,h:data->hierarchy,c:data->>citation,hd:data->>heading,sn:data->>status_note",
    source_system: `eq.${sourceSystem}`,
    entity_type: "eq.code-section",
    schema_version: "eq.publisher-code-evidence/2",
    review_status: "neq.quarantined",
    order: "native_id.asc",
    limit: String(PAGE),
  });
  if (after !== null) q.set("native_id", `gt.${after}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${url}/rest/v1/entities?${q}`, {
      headers,
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) return res.json();
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`EXPORT_FAILED ${sourceSystem}`);
}

fs.mkdirSync(outDir, { recursive: true });
for (const pair of mapping.split(",")) {
  const [jurisdiction, sourceSystem] = pair.split("=");
  if (
    !/^[A-Z]{2}$/.test(jurisdiction ?? "") ||
    !/^[a-z]{2}-[a-z0-9-]{3,60}$/.test(sourceSystem ?? "")
  )
    throw new Error(`bad mapping ${pair}`);
  const pathIndex = new Map();
  const paths = [];
  const rows = [];
  let after = null;
  for (;;) {
    const batch = await page(sourceSystem, after);
    for (const row of batch) {
      const steps = [];
      for (const step of Array.isArray(row.h) ? row.h : []) {
        if (!step || typeof step !== "object" || step.level === "section") break;
        steps.push([
          step.level ?? null,
          step.number ?? null,
          step.heading ?? null,
          step.node_id ?? null,
        ]);
      }
      const k = JSON.stringify(steps);
      if (!pathIndex.has(k)) {
        pathIndex.set(k, paths.length);
        paths.push(steps);
      }
      rows.push([row.native_id, row.c ?? null, row.hd ?? null, row.sn ?? null, pathIndex.get(k)]);
    }
    if (batch.length < PAGE) break;
    after = batch[batch.length - 1].native_id;
  }
  const out = {
    jurisdiction,
    source_system: sourceSystem,
    exported_at: new Date().toISOString(),
    sections: rows.length,
    paths,
    rows,
  };
  const file = path.join(outDir, `${jurisdiction}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out)));
  console.log(
    JSON.stringify({
      jurisdiction,
      sourceSystem,
      sections: rows.length,
      paths: paths.length,
      file,
    }),
  );
}
