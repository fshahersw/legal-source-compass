#!/usr/bin/env node
/**
 * Read-only count over a Time Limits release bundle (LIM_BUNDLE_DIR/rules.json). It writes nothing.
 *
 * Reports, overall and by claim type and state:
 *  - provenance.tolling notes per screening category, routed exactly as exceptionInventory() does
 *    (src/lib/limitations/exceptionReview.ts; the patterns below are checked against it by a test);
 *  - rules whose shape lets the reviewed-instruction path run (the gate in deadlineAssessment.ts: no calculation,
 *    no repose note, a period, accrualBasis confirmed_accrual, entry not flagged).
 *
 * Usage: LIM_BUNDLE_DIR=private/data/limitations node scripts/limitations/count-tolling-notes.mjs [--json]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Mirror of SCREENING_QUESTIONS[].terms, in the same order. */
export const SCREENING_TERMS = [
  ["minority", /minor|infan|under (?:the age of )?18|majority|age of eighteen/i],
  ["incapacity", /incapac|disabil|insan|competenc/i],
  ["military", /military|servicemember|service member|war(?:time)?\b|SCRA/i],
  ["confinement", /imprison|incarcer|confess|criminal|convict|detention|crime/i],
  ["concealment", /conceal|estoppel|duress|fraud|equitable/i],
  [
    "discovery",
    /discover|latent|toxic|foreign object|continu(?:ing|ous)|representation|treatment/i,
  ],
  ["absence", /absen|out.of.state|nonresident|false name|return to/i],
  ["prior_action", /refil|prior|previous|dismiss|nonsuit|savings?|terminat|appeal|relation.back/i],
  ["class_action", /class.action|MDL|multidistrict|registry|master complaint/i],
  ["bankruptcy", /bankrupt|injunction|stay|stayed|statutory prohibition/i],
  ["agreement", /agreement|arbitrat|contractual|written agreement|shorten|waiver/i],
  [
    "government",
    /government|public entit|public employ|municipal|notice.of.claim|claim presentation|sovereign/i,
  ],
  [
    "special_claim",
    /sexual|malpractice|special|statutory claim|penalt|forfeiture|derivative|consortium|product|warrant/i,
  ],
  ["death", /death|died|deceas|estate|representative|survival|homicide/i],
  ["foreign_law", /borrow|choice.of.law|foreign|transfer|direct.fil|another state|other.state/i],
  ["repose", /repose|reviv|transition|retroactiv|amendment|effective|outer/i],
  ["other", /emergency|closure|other|unresolved|qualification/i],
];
export const FOCUS = ["incapacity", "concealment", "class_action"];

/** Categories of one tolling note, as exceptionInventory routes it (text plus citation; "other" when none). */
export function noteCategories(note) {
  const subject = `${note?.text ?? ""} ${note?.citation ?? ""}`;
  const hits = SCREENING_TERMS.filter(([, re]) => re.test(subject)).map(([id]) => id);
  return hits.length ? hits : ["other"];
}

/** The reviewed-instruction gate of deadlineAssessment.ts, read from the rule's shape only. */
export function instructionEligible(rule) {
  return (
    !rule.calculation &&
    (rule.provenance?.repose?.length ?? 0) === 0 &&
    !!rule.period &&
    rule.accrualBasis === "confirmed_accrual" &&
    rule.provenance?.entryStatus !== "flagged"
  );
}

export function countTollingNotes(rules) {
  const empty = () => ({
    rules: 0,
    rulesWithTollingNotes: 0,
    tollingNotes: 0,
    byCategory: Object.fromEntries(FOCUS.map((c) => [c, 0])),
    rulesWithFocusNotes: Object.fromEntries(FOCUS.map((c) => [c, 0])),
    instructionEligibleRules: 0,
  });
  const total = empty();
  const byClaim = {};
  const byState = {};
  for (const rule of rules) {
    if (rule.ruleKind && rule.ruleKind !== "limitations") continue;
    const buckets = [
      total,
      (byClaim[rule.claimType] ??= empty()),
      (byState[rule.jurisdiction] ??= empty()),
    ];
    const notes = rule.provenance?.tolling ?? [];
    const cats = notes.map(noteCategories);
    for (const b of buckets) {
      b.rules += 1;
      if (notes.length) b.rulesWithTollingNotes += 1;
      b.tollingNotes += notes.length;
      for (const c of FOCUS) {
        const n = cats.filter((list) => list.includes(c)).length;
        b.byCategory[c] += n;
        if (n) b.rulesWithFocusNotes[c] += 1;
      }
      if (instructionEligible(rule)) b.instructionEligibleRules += 1;
    }
  }
  return { total, byClaim, byState };
}

function main() {
  const dir = process.env.LIM_BUNDLE_DIR;
  if (!dir) {
    console.error(
      "LIM_BUNDLE_DIR is not set; point it at a Time Limits bundle directory (read-only).",
    );
    process.exit(2);
  }
  const file = path.join(dir, "rules.json");
  let rules;
  try {
    rules = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Could not read ${file}: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!Array.isArray(rules)) {
    console.error(`${file} is not an array of rules.`);
    process.exit(2);
  }
  const out = countTollingNotes(rules);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  const t = out.total;
  console.log(
    `Limitations rules: ${t.rules}; with tolling notes: ${t.rulesWithTollingNotes}; notes: ${t.tollingNotes}`,
  );
  for (const c of FOCUS)
    console.log(`  ${c}: ${t.byCategory[c]} notes on ${t.rulesWithFocusNotes[c]} rules`);
  console.log(`Rules the reviewed-instruction gate admits: ${t.instructionEligibleRules}`);
  console.log("By claim type:");
  for (const [claim, b] of Object.entries(out.byClaim).sort())
    console.log(
      `  ${claim}: rules ${b.rules}, notes ${b.tollingNotes}, ${FOCUS.map((c) => `${c} ${b.byCategory[c]}`).join(", ")}, instruction-eligible ${b.instructionEligibleRules}`,
    );
  console.log("By state: use --json for the full table.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
