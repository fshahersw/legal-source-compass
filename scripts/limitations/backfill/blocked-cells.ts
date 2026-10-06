/**
 * Markdown table of every claim-type cell that does not compute, with the class of obstacle and its main reason.
 * Usage: bun scripts/limitations/backfill/blocked-cells.ts <report.md>   (rewrites the BLOCKED block)
 * Env: LIM_WORK (entries), LIM_OUT (built bundle)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoverageRow } from "../../../src/lib/limitations/types";

const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const out = process.env.LIM_OUT ?? "/tmp/lim/out/limitations";
const report = process.argv[2];
if (!report) throw new Error("report path required");
const coverage = JSON.parse(readFileSync(join(out, "coverage.json"), "utf8"))
  .coverage as CoverageRow[];
const GATED = new Set(["GA", "AR", "MS", "TN"]);
type Entry = {
  claimType: string;
  variant?: string;
  status: string;
  flags?: string[];
  blockers?: { issue: string; why: string }[];
  notRecordedReason?: string;
};

const CLASSES = [
  [
    "gated publisher",
    (t: string, st: string) =>
      GATED.has(st) && /gate|lexis|publisher|codified|currentness|terms/i.test(t),
  ],
  [
    "engine cannot model the clock",
    (t: string) =>
      /calculator|modell?ed|modell?able|runs from|later-of|earlier-of|whichever|death-(triggered|based)|two-limb|substantial completion|first (sale|purchase|delivery)|age-based|birthday/i.test(
        t,
      ),
  ],
  [
    "repose effective date not printed",
    (t: string) => /effective ?from|effective date|printed|not determinable|approved/i.test(t),
  ],
  [
    "no official text found",
    (t: string) =>
      /no official|not retrievable|cannot be proven|official-host|absence of|not on an official|bot|403|challenge|not found/i.test(
        t,
      ),
  ],
  ["ambiguous accrual or period", () => true],
] as const;

const rows: string[] = [];
const counts: Record<string, number> = {};
for (const row of coverage) {
  const file = join(work, "entries", `${row.state}.json`);
  const entries: Entry[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).entries : [];
  for (const cell of row.claimCoverage ?? []) {
    if (cell.status === "baseline") continue;
    const e = entries.find(
      (x) => x.claimType === cell.claimType && (x.variant ?? "general") === "general",
    );
    const issues = (e?.blockers ?? []).map((b) => `${b.issue} ${b.why}`);
    const text = [
      ...issues,
      ...(e?.flags ?? []),
      e?.notRecordedReason ?? "",
      cell.reason ?? "",
    ].join(" ");
    const cls = CLASSES.find(([, test]) => test(text, row.state))![0];
    counts[cls] = (counts[cls] ?? 0) + 1;
    const main = (
      e?.blockers?.[0]?.issue ??
      e?.flags?.[0] ??
      e?.notRecordedReason ??
      cell.reason ??
      ""
    )
      .replace(/\|/g, "/")
      .slice(0, 150);
    rows.push(
      `| ${row.state} | ${cell.claimType.replaceAll("_", " ")} | ${cell.status.replaceAll("_", " ")} | ${cls} | ${main} |`,
    );
  }
}
const block = [
  "<!-- BLOCKED:BEGIN -->",
  `Non-computing cells: ${rows.length}. Classes are assigned by the first matching rule in this order: gated publisher, engine cannot model the clock, repose effective date not printed, no official text found, ambiguous accrual or period (the last is the catch-all and means the statute or opinions leave the period or accrual question genuinely open).`,
  "",
  "| Class | Cells |",
  "|---|--:|",
  ...Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "| State | Claim | Cell state | Class | Main reason |",
  "|---|---|---|---|---|",
  ...rows,
  "<!-- BLOCKED:END -->",
].join("\n");
const existing = existsSync(report) ? readFileSync(report, "utf8") : "";
writeFileSync(
  report,
  existing.includes("<!-- BLOCKED:BEGIN -->")
    ? existing.replace(/<!-- BLOCKED:BEGIN -->[\s\S]*<!-- BLOCKED:END -->/, () => block)
    : `${existing}\n\n## Cells that do not compute, and why\n\n${block}\n`,
);
console.log(JSON.stringify({ rows: rows.length, counts }));
