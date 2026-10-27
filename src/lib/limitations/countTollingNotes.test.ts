import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCREENING_QUESTIONS, exceptionInventory } from "./exceptionReview";
import type { LimitationRule, LimitationsSnapshot } from "./types";
import {
  SCREENING_TERMS,
  countTollingNotes,
  noteCategories,
  // @ts-expect-error -- plain ESM script without type declarations
} from "../../../scripts/limitations/count-tolling-notes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "scripts", "limitations", "count-tolling-notes.mjs");

const rule = (over: Record<string, unknown>) =>
  ({
    id: "r",
    jurisdiction: "IL",
    claimType: "personal_injury",
    ruleKind: "limitations",
    period: { amount: 2, unit: "calendar_years" },
    accrualBasis: "confirmed_accrual",
    sourceIds: [],
    conditions: [],
    exclusions: [],
    warnings: [],
    provenance: { entryStatus: "verified", flags: [], repose: [], tolling: [] },
    ...over,
  }) as unknown as LimitationRule;

const rules = [
  rule({
    id: "il",
    provenance: {
      entryStatus: "verified",
      flags: [],
      repose: [],
      tolling: [
        {
          text: "Person under a legal disability: 2 years after removal.",
          citation: "735 ILCS 5/13-211(a)",
        },
        { text: "Fraudulent concealment: 5 years after discovery.", citation: "735 ILCS 5/13-215" },
      ],
    },
  }),
  rule({
    id: "ny-pl",
    jurisdiction: "NY",
    claimType: "product_liability",
    calculation: { mode: "discovery_min" },
    provenance: {
      entryStatus: "verified",
      flags: [],
      repose: [],
      tolling: [{ text: "Class action pendency (MDL) may toll.", citation: "Synthetic" }],
    },
  }),
  rule({ id: "repose-only", ruleKind: "repose" }),
];

describe("count-tolling-notes.mjs", () => {
  it("mirrors exceptionReview's screening patterns exactly", () => {
    expect(SCREENING_TERMS.map(([id, re]: [string, RegExp]) => [id, re.source, re.flags])).toEqual(
      SCREENING_QUESTIONS.map((q) => [q.id, q.terms.source, q.terms.flags]),
    );
  });
  it("routes each note as exceptionInventory does", () => {
    for (const r of rules)
      for (const item of exceptionInventory({} as LimitationsSnapshot, r).filter(
        (i) => i.kind === "tolling",
      ))
        expect(noteCategories({ text: item.text, citation: item.citation })).toEqual(
          item.categories,
        );
  });
  it("counts notes by focus category and applies the instruction gate", () => {
    const out = countTollingNotes(rules);
    expect(out.total.rules).toBe(2);
    expect(out.total.tollingNotes).toBe(3);
    expect(out.total.byCategory).toEqual({ incapacity: 1, concealment: 1, class_action: 1 });
    expect(out.total.instructionEligibleRules).toBe(1);
    expect(out.byClaim["product_liability"].instructionEligibleRules).toBe(0);
    expect(out.byState["IL"].rulesWithFocusNotes.incapacity).toBe(1);
  });
  it("reads LIM_BUNDLE_DIR without writing to it, and refuses to run without it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lim-count-"));
    const file = join(dir, "rules.json");
    writeFileSync(file, JSON.stringify(rules));
    const before = readFileSync(file, "utf8");
    const run = spawnSync(process.execPath, [script, "--json"], {
      env: { ...process.env, LIM_BUNDLE_DIR: dir },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).total.tollingNotes).toBe(3);
    expect(readFileSync(file, "utf8")).toBe(before);
    const env = { ...process.env };
    delete env["LIM_BUNDLE_DIR"];
    const missing = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/LIM_BUNDLE_DIR is not set/);
  });
});
