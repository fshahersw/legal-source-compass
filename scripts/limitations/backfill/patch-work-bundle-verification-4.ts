/**
 * Align verification.basis on a local work-bundle build with the .4 activation gate.
 * Does not modify the live activated snapshot or staged storage — only rules.json under LIM_OUT.
 *
 * Usage: LIM_OUT=/tmp/lim/out/work-limitations bun scripts/limitations/backfill/patch-work-bundle-verification-4.ts
 * Env: LIM_REF_BUNDLE (default /tmp/lim/out/limitations, frozen .4 tree),
 *      LIM_VERDICTS_4_DELTA (default agent-store verdicts-2026-10-06.4-delta.json)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ruleFingerprint, type VerdictRecord } from "../../../src/lib/limitations/backfill/grades";
import type { LimitationRule } from "../../../src/lib/limitations/types";

const workOut = process.env.LIM_OUT ?? "/tmp/lim/out/work-limitations";
const refBundle = process.env.LIM_REF_BUNDLE ?? "/tmp/lim/out/limitations";
const verdictPath =
  process.env.LIM_VERDICTS ??
  "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/limitations-verification/verdicts-2026-10-06.1.json";
const deltaPath =
  process.env.LIM_VERDICTS_4_DELTA ??
  "/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/limitations-verification/verdicts-2026-10-06.4-delta.json";

const STALE = /not yet read by the independent verifier/;
const CONFIRMED_BASIS =
  "Confirmed by the independent verifier against freshly retrieved official text; the rule is unchanged since.";

const workDoc = JSON.parse(readFileSync(join(workOut, "rules.json"), "utf8")) as {
  rules: LimitationRule[];
};
const refDoc = JSON.parse(readFileSync(join(refBundle, "rules.json"), "utf8")) as {
  rules: LimitationRule[];
};
const verdictDoc = JSON.parse(readFileSync(verdictPath, "utf8")) as {
  rules?: { ruleId: string } & VerdictRecord[];
};
const delta = JSON.parse(readFileSync(deltaPath, "utf8")) as {
  reverifiedRules?: { ruleId: string; verdict: string; reason?: string }[];
};

const verdictById = new Map(
  (verdictDoc.rules ?? []).map((r) => [r.ruleId, r as VerdictRecord & { ruleId: string }]),
);

const demoted = new Set<string>();
const gateConfirmed = new Set<string>();
for (const row of delta.reverifiedRules ?? []) {
  if (row.verdict !== "confirmed") continue;
  if (/Demoted to non-computing/i.test(row.reason ?? "")) demoted.add(row.ruleId);
  else gateConfirmed.add(row.ruleId);
}

const refById = new Map(refDoc.rules.map((r) => [r.id, r]));
const confirmedBasis = () => ({
  grade: "independently_verified" as const,
  basis: CONFIRMED_BASIS,
  verifiedRuleVersion: "2026-10-06.4",
  verifiedOn: "2026-10-06",
});

let carryForwardFromGate = 0;
let gateReverified = 0;
let skippedDemoted = 0;
let staleLeft = 0;

for (const rule of workDoc.rules) {
  if (demoted.has(rule.id)) {
    if (STALE.test(rule.verification?.basis ?? "")) skippedDemoted++;
    continue;
  }
  const basis = rule.verification?.basis ?? "";
  if (!STALE.test(basis)) continue;

  const refRule = refById.get(rule.id);
  const prevFp = refRule ? ruleFingerprint(refRule) : null;
  const unchangedOnStaged = prevFp !== null && prevFp === ruleFingerprint(rule);
  const verdict = verdictById.get(rule.id);

  if (unchangedOnStaged && verdict?.verdict === "confirmed") {
    rule.verification = confirmedBasis();
    carryForwardFromGate++;
    continue;
  }
  if (gateConfirmed.has(rule.id)) {
    rule.verification = confirmedBasis();
    gateReverified++;
    continue;
  }
  staleLeft++;
}

writeFileSync(join(workOut, "rules.json"), `${JSON.stringify(workDoc, null, 2)}\n`);
console.log(
  JSON.stringify({
    out: workOut,
    carryForwardFromGate,
    gateReverified,
    skippedDemotedStaleBasis: skippedDemoted,
    staleBasisUnchanged: staleLeft,
  }),
);
