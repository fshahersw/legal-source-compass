/**
 * Regenerate the auto-generated block of the coverage report.
 * Usage: bun scripts/limitations/backfill/coverage-report.ts <report.md>
 * Env: LIM_WORK (backfill working dir), LIM_BUNDLE (protected limitations bundle copy)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAIM_TYPES } from "../../../src/lib/limitations/types";
import {
  checkEntry,
  type CaptureMeta,
  type MatrixEntryInput,
} from "../../../src/lib/limitations/backfill/entries";

const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const bundle = process.env.LIM_BUNDLE ?? "/tmp/lim/data/limitations";
const report = process.argv[2];
if (!report) throw new Error("report path required");

const rules = JSON.parse(readFileSync(join(bundle, "rules.json"), "utf8")).rules as {
  jurisdiction: string;
  claimType: string;
  computation: string;
  subtype?: string;
}[];
const states = (
  JSON.parse(readFileSync(join(bundle, "coverage.json"), "utf8")).coverage as { state: string }[]
)
  .map((c) => c.state)
  .sort();

const SHORT: Record<string, string> = {
  personal_injury: "PI",
  product_liability: "PL",
  wrongful_death: "WD",
  medical_malpractice: "MM",
  contract_written: "CW",
  contract_oral: "CO",
  fraud: "FR",
  property_damage: "PD",
};

const before = (s: string, c: string) => {
  const rs = rules.filter((r) => r.jurisdiction === s && r.claimType === c);
  if (rs.some((r) => r.computation === "baseline_only")) return "B";
  if (rs.length) return "R";
  return "-";
};

type Cell = "V" | "F" | "N" | "-" | "E";
const cells = new Map<string, Cell>();
const problems: string[] = [];
const hosts = new Map<string, number>();
let entryTotal = 0;
const dir = join(work, "entries");
for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
  if (!file.endsWith(".json")) continue;
  const state = file.replace(".json", "").toUpperCase();
  const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as { entries: MatrixEntryInput[] };
  for (const entry of doc.entries) {
    entryTotal++;
    const problemsFound = checkEntry(state, entry, (id) => {
      const base = join(work, "captures", state, id);
      if (!existsSync(`${base}.json`)) return undefined;
      const meta = JSON.parse(readFileSync(`${base}.json`, "utf8")) as CaptureMeta;
      return { meta, text: readFileSync(`${base}.txt`, "utf8") };
    });
    const errors = problemsFound.filter((p) => p.level === "error");
    const key = `${state}|${entry.claimType}`;
    const status: Cell = errors.length ? "E" : (entry.status[0]!.toUpperCase() as Cell);
    const prior = cells.get(key);
    const rank: Record<Cell, number> = { V: 4, F: 3, N: 2, E: 1, "-": 0 };
    if (!prior || rank[status] > rank[prior]) cells.set(key, status);
    if (errors.length)
      problems.push(
        `${state} ${entry.claimType}/${entry.variant ?? "general"}: ${errors[0]!.message}`,
      );
    const capPath = join(work, "captures", state, `${entry.captureId}.json`);
    if (existsSync(capPath)) {
      const host = new URL((JSON.parse(readFileSync(capPath, "utf8")) as CaptureMeta).url).hostname;
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
  }
}

const outDir = process.env.LIM_OUT ?? "/tmp/lim/out/limitations";
const built = existsSync(join(outDir, "coverage.json"))
  ? (JSON.parse(readFileSync(join(outDir, "coverage.json"), "utf8")).coverage as {
      state: string;
      claimCoverage?: { claimType: string; status: string }[];
      timeComputation?: { extendsWhenLastDayIsWeekend: boolean };
    }[])
  : [];
const builtCells = built.flatMap((c) => c.claimCoverage ?? []);
const builtCount = (status: string) =>
  built.length ? String(builtCells.filter((c) => c.status === status).length) : "not built";
const timeRules = built.filter((c) => c.timeComputation);

const count = (f: (s: string, c: string) => string, v: string) =>
  states.flatMap((s) => CLAIM_TYPES.map((c) => f(s, c))).filter((x) => x === v).length;
const after = (s: string, c: string): string => cells.get(`${s}|${c}`) ?? "-";
const total = states.length * CLAIM_TYPES.length;
const header = `| State | ${CLAIM_TYPES.map((c) => SHORT[c]).join(" | ")} |`;
const sep = `|---|${CLAIM_TYPES.map(() => ":-:").join("|")}|`;
const matrix = (f: (s: string, c: string) => string) =>
  [
    header,
    sep,
    ...states.map((s) => `| ${s} | ${CLAIM_TYPES.map((c) => f(s, c)).join(" | ")} |`),
  ].join("\n");
const statesDone = states.filter((s) => CLAIM_TYPES.some((c) => after(s, c) !== "-")).length;

const block = [
  "<!-- AUTO:BEGIN -->",
  `_Generated ${new Date().toISOString()} by \`scripts/limitations/backfill/coverage-report.ts\`._`,
  "",
  "### Running counts (51 jurisdictions x 8 claim types = " + total + " cells)",
  "",
  "| | Before (production bundle 2026-10-05.4) | Now (backfill entries) |",
  "|---|--:|--:|",
  `| Cells with a calculator baseline (B) | ${count(before, "B")} | ${builtCount("baseline")} (built bundle, unpublished) |`,
  `| Cells research-only: period recorded, no date issued (R) | ${count(before, "R")} | ${builtCount("research_only")} (verified, e.g. repose not modelled) |`,
  `| Cells recorded with open issues, no date issued | n/a | ${builtCount("flagged")} |`,
  `| Cells Not recorded in built bundle | n/a | ${builtCount("not_recorded")} |`,
  `| States with a recorded weekend-extension counting rule | 0 | ${timeRules.length} (${timeRules.filter((c) => c.timeComputation!.extendsWhenLastDayIsWeekend).length} extend, ${timeRules.filter((c) => !c.timeComputation!.extendsWhenLastDayIsWeekend).length} do not) |`,
  `| Cells verified from primary source (V) | n/a | ${count(after, "V")} |`,
  `| Cells flagged (F) | n/a | ${count(after, "F")} |`,
  `| Cells Not recorded (N) | n/a | ${count(after, "N")} |`,
  `| Cells failing mechanical verification (E) | n/a | ${count(after, "E")} |`,
  `| Cells with no entry yet (-) | ${count(before, "-")} | ${count(after, "-")} |`,
  `| Jurisdictions with entries | n/a | ${statesDone} of ${states.length} |`,
  `| Entry records (incl. variants) | n/a | ${entryTotal} |`,
  "",
  "Legend: B baseline computable, R research-only, V verified (period, excerpt and evidence literally present in an official capture), F flagged (recorded with open issue), N Not recorded, E entry fails verification (not counted as verified), - nothing.",
  "",
  "### Before: production bundle (rules.json 2026-10-05.4)",
  "",
  matrix(before),
  "",
  "### Now: backfill entries (best status per cell)",
  "",
  matrix(after),
  "",
  "### Entries failing mechanical verification",
  "",
  problems.length ? problems.map((p) => `- ${p}`).join("\n") : "None.",
  "",
  "### Official hosts used (captures cited by entries)",
  "",
  [...hosts.entries()]
    .sort()
    .map(([h, n]) => `- ${h}: ${n}`)
    .join("\n") || "None yet.",
  "<!-- AUTO:END -->",
].join("\n");

const existing = existsSync(report) ? readFileSync(report, "utf8") : "";
const next = existing.includes("<!-- AUTO:BEGIN -->")
  ? existing.replace(/<!-- AUTO:BEGIN -->[\s\S]*<!-- AUTO:END -->/, () => block)
  : `${existing}\n${block}\n`;
writeFileSync(report, next);
console.log(
  JSON.stringify({
    V: count(after, "V"),
    F: count(after, "F"),
    N: count(after, "N"),
    E: count(after, "E"),
    statesDone,
  }),
);
