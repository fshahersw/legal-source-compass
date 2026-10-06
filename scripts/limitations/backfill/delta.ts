/**
 * Delta between two built bundles for the verifier's re-check.
 * Usage: bun scripts/limitations/backfill/delta.ts <previous-bundle-dir> <new-bundle-dir> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ruleFingerprint } from "../../../src/lib/limitations/backfill/grades";
import type { CoverageRow, LimitationRule } from "../../../src/lib/limitations/types";

const [prev, next, target] = process.argv.slice(2);
if (!prev || !next || !target) throw new Error("usage: delta.ts <prev> <next> <out>");
const rulesOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "rules.json"), "utf8")).rules as LimitationRule[];
const coverageOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "coverage.json"), "utf8")).coverage as CoverageRow[];
const a = new Map(rulesOf(prev).map((r) => [r.id, r]));
const b = new Map(rulesOf(next).map((r) => [r.id, r]));
const added = [...b.keys()].filter((id) => !a.has(id));
const removed = [...a.keys()].filter((id) => !b.has(id));
const changed = [...b.keys()].filter(
  (id) => a.has(id) && ruleFingerprint(a.get(id)!) !== ruleFingerprint(b.get(id)!),
);
const cellsBefore = new Map(
  coverageOf(prev).flatMap((row) =>
    (row.claimCoverage ?? []).map((c) => [`${row.state}|${c.claimType}`, c] as const),
  ),
);
const cellChanges = coverageOf(next).flatMap((row) =>
  (row.claimCoverage ?? []).flatMap((c) => {
    const before = cellsBefore.get(`${row.state}|${c.claimType}`);
    const same = before && before.status === c.status && before.ruleId === c.ruleId;
    const changedRule = c.ruleId ? changed.includes(c.ruleId) || added.includes(c.ruleId) : false;
    return same && !changedRule
      ? []
      : [
          {
            jurisdiction: row.state,
            claimType: c.claimType,
            before: before ? { status: before.status, ruleId: before.ruleId ?? null } : null,
            after: { status: c.status, ruleId: c.ruleId ?? null, grade: c.grade ?? null },
          },
        ];
  }),
);
const doc = {
  previous: prev,
  next,
  rulesAdded: added,
  rulesRemoved: removed,
  rulesChanged: changed,
  cellsChanged: cellChanges,
  counts: {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    cellsChanged: cellChanges.length,
  },
};
writeFileSync(target, `${JSON.stringify(doc, null, 1)}\n`);
console.log(JSON.stringify(doc.counts));
