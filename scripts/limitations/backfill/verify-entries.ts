/**
 * Mechanically verify backfill entries against their captures.
 * Usage: bun scripts/limitations/backfill/verify-entries.ts [ST ...]   (LIM_WORK defaults to /tmp/lim/backfill)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkEntry,
  type CaptureMeta,
  type MatrixEntryInput,
} from "../../../src/lib/limitations/backfill/entries";

const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const only = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
const files = existsSync(join(work, "entries")) ? readdirSync(join(work, "entries")) : [];
let errors = 0;
let warnings = 0;
const tally: Record<string, number> = {};
for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
  const state = file.replace(".json", "").toUpperCase();
  if (only.size && !only.has(state)) continue;
  const doc = JSON.parse(readFileSync(join(work, "entries", file), "utf8")) as {
    jurisdiction: string;
    entries: MatrixEntryInput[];
  };
  if (doc.jurisdiction !== state) {
    console.log(`${state}: file jurisdiction mismatch (${doc.jurisdiction})`);
    errors++;
  }
  const seen = new Set<string>();
  for (const entry of doc.entries) {
    const key = `${entry.claimType}/${entry.variant ?? "general"}`;
    if (seen.has(key)) {
      console.log(`${state} ${key}: duplicate entry`);
      errors++;
    }
    seen.add(key);
    tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    const problems = checkEntry(state, entry, (id) => {
      const base = join(work, "captures", state, id);
      if (!existsSync(`${base}.json`)) return undefined;
      return {
        meta: JSON.parse(readFileSync(`${base}.json`, "utf8")) as CaptureMeta,
        text: readFileSync(`${base}.txt`, "utf8"),
      };
    });
    for (const p of problems) {
      if (p.level === "error") errors++;
      else warnings++;
      if (p.level === "error" || process.env.SHOW_WARNINGS)
        console.log(`${state} ${key} [${p.level}] ${p.message}`);
    }
  }
}
console.log(JSON.stringify({ files: files.length, entriesByStatus: tally, errors, warnings }));
process.exit(errors ? 1 : 0);
