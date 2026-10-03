import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJsonLines } from "./jsonl.ts";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { adapterContext, adaptNative, addSupportRow, nativeRecordEdges } from "../../src/lib/legal/adapters.ts";
import type { NativeRow } from "../../src/lib/legal/adapters.ts";
import { EntityType, LEGAL_SCHEMA_VERSION, legalEdge, legalRecord, recordKey } from "../../src/lib/legal/schema.ts";
import { schemaReport, schemaRegressions } from "../../src/lib/legal/audit.ts";
import type { SchemaReport } from "../../src/lib/legal/audit.ts";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const lines = (file: string) => readJsonLines<NativeRow>(file);
export function openStage(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS inputs (input_key TEXT PRIMARY KEY, source TEXT NOT NULL, native_type TEXT NOT NULL, native_id TEXT NOT NULL, source_year INTEGER, raw_json TEXT NOT NULL, candidates_json TEXT NOT NULL, status TEXT NOT NULL, issues_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (record_key TEXT PRIMARY KEY, type TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, event_year INTEGER, input_key TEXT NOT NULL REFERENCES inputs(input_key), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS edges (edge_key TEXT PRIMARY KEY, from_key TEXT NOT NULL REFERENCES records(record_key), to_key TEXT NOT NULL, source_key TEXT NOT NULL REFERENCES records(record_key), review_status TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, state TEXT NOT NULL, rows INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS support (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS stage_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_type ON records(type);
    CREATE INDEX IF NOT EXISTS records_year ON records(source,event_year);
    CREATE INDEX IF NOT EXISTS edges_to ON edges(to_key);
  `);
  return db;
}
export async function stageFiles(files: string[], supportFiles: string[], destination: string) {
  const db = openStage(destination); const context = adapterContext();
  const mapperHash = hash(["adapters.ts", "schema.ts", "identity.ts", "enums.json"].map(file => fs.readFileSync(new URL(`../../src/lib/legal/${file}`, import.meta.url), "utf8")).join("\n"));
  const oldMapper = db.prepare("SELECT value FROM stage_metadata WHERE key='mapper_sha256'").get();
  const populated = Number(db.prepare("SELECT count(*) AS n FROM inputs").get()!["n"]) > 0;
  if ((oldMapper && oldMapper["value"] !== mapperHash) || (!oldMapper && populated)) throw Error("Mapper changed or was not recorded; retain this snapshot and stage into a new database");
  db.prepare("INSERT OR IGNORE INTO stage_metadata VALUES ('mapper_sha256',?)").run(mapperHash);
  db.prepare("INSERT OR IGNORE INTO stage_metadata VALUES ('schema_version',?)").run(LEGAL_SCHEMA_VERSION);
  const lookup = (kind: string) => ({
    get(id: string): NativeRow | undefined { const row = db.prepare("SELECT payload FROM support WHERE kind=? AND id=?").get(kind, id); return row ? JSON.parse(String(row["payload"])) : undefined; },
    set(id: string, value: NativeRow) { db.prepare("INSERT OR REPLACE INTO support VALUES (?,?,?)").run(kind, id, JSON.stringify(value)); },
  });
  context.clusters = lookup("clusters"); context.dockets = lookup("dockets");
  // Support order is explicit: courthouses, positions, educations, courts, clusters, dockets.
  for (const file of supportFiles) {
    db.exec("BEGIN"); let rows = 0;
    try {
      for await (const row of lines(file)) { addSupportRow(row, context); if (++rows % 5000 === 0) db.exec("COMMIT; BEGIN"); }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const putInput = db.prepare("INSERT OR IGNORE INTO inputs VALUES (?,?,?,?,?,?,?,?,?)");
  const putRecord = db.prepare("INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?)");
  const putEdge = db.prepare("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?,?)");
  for (const file of files) {
    const sha = createHash("sha256"); for await (const chunk of fs.createReadStream(file)) sha.update(chunk);
    const digest = sha.digest("hex");
    const prior = db.prepare("SELECT sha256,state FROM files WHERE path=?").get(path.resolve(file));
    if (prior && prior["sha256"] !== digest) throw new Error(`Retained input changed: ${file}`);
    if (prior?.["state"] === "complete") continue;
    db.prepare("INSERT OR REPLACE INTO files VALUES (?,?,?,?)").run(path.resolve(file), digest, "running", 0);
    let count = 0;
    db.exec("BEGIN");
    try {
      for await (const row of lines(file)) {
        const key = hash(JSON.stringify([row.source_system, row.entity_type, row.native_id, row.provenance["record_sha256"] ?? hash(JSON.stringify(row.data))]));
        const adapted = adaptNative(row, context);
        const parsed = adapted.records.map((record) => legalRecord.safeParse(record));
        const errors = parsed.flatMap((result) => result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
        const state = errors.length ? "rejected" : adapted.status === "candidate" ? "accepted" : adapted.status;
        const date = String(row.data["date_filed"] ?? row.data["publication_date"] ?? row.data["decision_date"] ?? "");
        const year = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
        putInput.run(key, row.source_system, row.entity_type, row.native_id, year, JSON.stringify(row), JSON.stringify(adapted.records), state, JSON.stringify(errors.length ? errors : adapted.reason ? [adapted.reason] : []));
        if (state === "accepted") for (const result of parsed) if (result.success) {
          const record = result.data; const rk = recordKey(record); const payload = JSON.stringify(record);
          const existing = db.prepare("SELECT payload FROM records WHERE record_key=?").get(rk);
          if (existing && existing["payload"] !== payload) throw new Error(`Conflicting canonical version: ${rk}`);
          putRecord.run(rk, record.type, record.id, record.source_name, record.date_type === "retrieved" ? null : Number(record.date.slice(0, 4)), key, payload);
          for (const edge of nativeRecordEdges(record, context)) {
            const checked = legalEdge.parse(edge); const encoded = JSON.stringify(checked);
            putEdge.run(hash(encoded), recordKey(checked.from), recordKey(checked.to), recordKey(checked.source_record), checked.review_status, encoded);
          }
        }
        count++;
        if (count % 1000 === 0) {
          db.exec("COMMIT; BEGIN"); db.prepare("UPDATE files SET rows=? WHERE path=?").run(count, path.resolve(file));
          const disk = fs.statfsSync(path.dirname(destination));
          if (disk.bavail * disk.bsize < 5 * 1024 ** 3) throw Error("Staging stopped at the 5 GiB disk reserve; committed batches remain resumable");
        }
      }
      db.exec("COMMIT");
      db.prepare("UPDATE files SET state='complete',rows=? WHERE path=?").run(count, path.resolve(file));
      console.log(JSON.stringify({ file: path.basename(file), rows: count, state: "staged", audited: false }));
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  db.close();
}
export function writeReports(destination: string, out: string, year: number) {
  const db = openStage(destination); fs.mkdirSync(out, { recursive: true });
  function* candidates() { for (const row of db.prepare("SELECT candidates_json FROM inputs").iterate()) yield* JSON.parse(String(row["candidates_json"])); }
  const report = schemaReport(candidates(), "legal-atlas-round3-staging", new Date().toISOString());
  fs.writeFileSync(path.join(out, "schema-report.json"), JSON.stringify(report, null, 2));
  const sourceNames = ["courtlistener", "cap", "recap", "federalregister", "ecfr", "uscode", "congress", "fjc"];
  const grouped = db.prepare("SELECT source,source_year AS year,status,count(*) AS rows FROM inputs GROUP BY source,source_year,status").all();
  const coverage = sourceNames.flatMap((source) => Array.from({ length: year - 1999 }, (_, i) => {
    const y = i + 2000; const counts = grouped.filter((r) => r["source"] === source && r["year"] === y);
    const byState = Object.fromEntries(counts.map((r) => [r["status"], r["rows"]]));
    return { source, year: y, source_rows: counts.reduce((s, r) => s + Number(r["rows"]), 0), accepted: byState["accepted"] ?? 0, rejected: byState["rejected"] ?? 0, supporting: byState["supporting"] ?? 0, excluded: byState["excluded"] ?? 0, status: counts.length ? "partial" : "not_started" };
  }));
  fs.writeFileSync(path.join(out, "coverage.json"), JSON.stringify({ schema_version: LEGAL_SCHEMA_VERSION, as_of: report.generated_at, coverage, undated: grouped.filter((r) => r["year"] === null), complete: false }, null, 2));
  const csv = ["source,year,source_rows,accepted,rejected,supporting,excluded,status", ...coverage.map((r) => [r.source, r.year, r.source_rows, r.accepted, r.rejected, r.supporting, r.excluded, r.status].join(","))].join("\n");
  fs.writeFileSync(path.join(out, "coverage.csv"), csv + "\n");
  const auditPath = path.join(out, "audit-samples.json");
  // Keep the random seed and sample stable; never replace reviews on a rerun.
  const seed = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, "utf8")).seed : randomBytes(32).toString("hex");
  const samples: Record<string, { population: number; required: number; keys: string[] }> = {};
  const populationHash = createHash("sha256");
  const keep = (selected: { key: string; rank: string }[], key: string, limit: number) => {
    const rank = hash(`${seed}\n${key}`);
    if (selected.length === limit && rank >= selected[limit - 1]!.rank) return;
    let low = 0, high = selected.length;
    while (low < high) { const mid = (low + high) >>> 1; if (selected[mid]!.rank < rank) low = mid + 1; else high = mid; }
    selected.splice(low, 0, { key, rank });
    if (selected.length > limit) selected.pop();
  };
  for (const type of EntityType.options) {
    const selected: { key: string; rank: string }[] = []; let population = 0;
    for (const row of db.prepare("SELECT record_key,payload FROM records WHERE type=? ORDER BY record_key").iterate(type)) {
      const key = String(row["record_key"]); populationHash.update(key); populationHash.update(String(row["payload"])); keep(selected, key, 100); population++;
    }
    samples[type] = { population, required: 100, keys: selected.map(x => x.key) };
  }
  const sourceSamples: Record<string, { population: number; required: number; keys: string[] }> = {};
  for (const source of sourceNames) {
    const selected: { key: string; rank: string }[] = []; let population = 0;
    for (const row of db.prepare("SELECT input_key FROM inputs WHERE source=? AND candidates_json<>'[]'").iterate(source)) { keep(selected, String(row["input_key"]), 50); population++; }
    sourceSamples[source] = { population, required: 50, keys: selected.map(x => x.key) };
  }
  const audit = { schema_version: LEGAL_SCHEMA_VERSION, population_sha256: populationHash.digest("hex"), seed, entity_samples: samples, source_samples: sourceSamples, reviews: [], complete: false };
  if (!fs.existsSync(auditPath)) fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  else if (JSON.parse(fs.readFileSync(auditPath, "utf8")).population_sha256 !== audit.population_sha256 || !JSON.parse(fs.readFileSync(auditPath, "utf8")).source_samples) fs.writeFileSync(path.join(out, "audit-samples-next-population.json"), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify({ total: report.total, valid: report.valid, invalid: report.invalid, coverage_rows: coverage.length, complete: false }));
  db.close(); return report;
}
async function main() {
  const args = process.argv.slice(2); const command = args.shift(); const config = JSON.parse(fs.readFileSync(args[0]!, "utf8"));
  if (command === "stage") await stageFiles(config.files, config.support_files, config.database);
  const report = writeReports(config.database, config.output, config.end_year);
  if (command === "check") {
    if (!config.baseline || !fs.existsSync(config.baseline)) throw new Error("A reviewed schema baseline is required; it is never created by the gate");
    const failures = schemaRegressions(report, JSON.parse(fs.readFileSync(config.baseline, "utf8")) as SchemaReport);
    if (failures.length) throw new Error(failures.join("\n"));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
