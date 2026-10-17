import { STATES } from "@/lib/corpus/geo";
import { parseCivilDate } from "./engine";
import type { BaselineInput, ClaimType } from "./types";
import type { ReviewDecisions } from "./reviewInventory";

export const INTAKE_MAX_LENGTH = 4_000;
export const INTAKE_FIELD_LABELS = {
  jurisdiction: "Mentioned state — confirm governing law",
  claimType: "Claim type",
  accrualDate: "Stated accrual date",
  injuryDate: "Injury date",
  actualDiscoveryDate: "Actual discovery date",
  constructiveDiscoveryDate: "Constructive discovery date",
  deathDate: "Death date",
  diagnosisCommunicationDate: "Diagnosis communicated",
  causeDiscoveryDate: "Cause discovery date",
  firstProductDeliveryDate: "First product delivery",
  qualifyingExposureDate: "Qualifying exposure",
  substantialCompletionDate: "Substantial completion",
  reposeActDate: "Act or omission date",
} as const;
export type IntakeField = keyof typeof INTAKE_FIELD_LABELS;
type DateField = Exclude<IntakeField, "jurisdiction" | "claimType">;
export type IntakeFact = { field: IntakeField; value: string; evidence: string };
export type IntakeTopic = {
  id:
    | "disability"
    | "tolling"
    | "prior_filing"
    | "foreign_law"
    | "special_claim"
    | "latent_exposure"
    | "product_repose"
    | "calendar";
  label: string;
  evidence: string;
};
export type IntakeResult = {
  facts: IntakeFact[];
  notes: { kind: "ambiguous" | "qualified" | "date" | "length"; text: string }[];
  reviewTopics: IntakeTopic[];
};
export type ConfirmedIntake = {
  facts: Partial<Pick<BaselineInput, IntakeField>>;
  reviewTopics: IntakeTopic[];
};

const claimTerms: [ClaimType, RegExp][] = [
  ["personal_injury", /\bpersonal injury\b/i],
  ["product_liability", /\bproduct liability\b/i],
  ["wrongful_death", /\bwrongful death\b/i],
  ["medical_malpractice", /\bmedical malpractice\b/i],
  ["contract_written", /\bwritten contract\b/i],
  ["contract_oral", /\b(?:oral|verbal) contract\b/i],
  ["fraud", /\b(?:fraud|misrepresentation)\b/i],
  ["property_damage", /\bproperty damage\b/i],
  ["defamation", /\b(?:defamation|libel|slander)\b/i],
  ["intentional_tort", /\bintentional tort\b/i],
  ["breach_of_warranty", /\bbreach of warranty\b/i],
  ["legal_malpractice", /\blegal malpractice\b/i],
  [
    "consumer_protection",
    /\b(?:consumer protection|deceptive (?:trade|business) practices?|unfair (?:trade|business) practices?|UDAP)\b/i,
  ],
  [
    "civil_rights_1983",
    /\b(?:section 1983|§\s*1983|1983 claim|civil rights (?:claim|action|violation))\b/i,
  ],
];
const topicTerms: [IntakeTopic["id"], string, RegExp][] = [
  [
    "disability",
    "Minority or protected status",
    /\b(?:minor|minority|child|disability|incapacity|military|incarcerat\w*)\b/i,
  ],
  [
    "tolling",
    "Tolling, agreement, stay or bankruptcy",
    /\b(?:toll\w*|bankrupt\w*|stay|suspend\w*|pause\w*|conceal\w*|estoppel)\b/i,
  ],
  [
    "prior_filing",
    "Earlier proceedings or class action",
    /\b(?:prior (?:filing|lawsuit)|previous lawsuit|dismiss\w*|refil\w*|nonsuit|class action)\b/i,
  ],
  [
    "foreign_law",
    "Choice of law or another jurisdiction",
    /\b(?:borrowing statute|choice.of.law|transfer|direct filing)\b/i,
  ],
  [
    "special_claim",
    "Government or special claim",
    /\b(?:government|public employee|sexual abuse|revival|special statutory)\b/i,
  ],
  [
    "latent_exposure",
    "Latent injury or continuing conduct",
    /\b(?:latent|asbestos|toxic|continuous treatment|continuing wrong)\b/i,
  ],
  ["product_repose", "Repose or independent outer limit", /\b(?:repose|outer limit)\b/i],
  [
    "calendar",
    "Filing calendar or service",
    /\b(?:holiday|court closure|filing cutoff|service deadline|emergency order)\b/i,
  ],
];
// A qualified clause is withheld as a whole. This deliberately prefers manual entry to interpreting
// the scope of a negation or a hypothetical. It never converts “no bankruptcy” into a cleared review.
const qualified =
  /\b(?:no|not|never|without|neither|unknown|uncertain|unsure|maybe|possibly|possible|might|could|perhaps|whether|if)\b|\bmay (?:be|have|apply)\b|\b\w+n['’]t\b/i;
const dateRoles: [DateField, string][] = [
  ["accrualDate", "accrual(?: date)?|accrued"],
  ["injuryDate", "injury(?: date)?|injured"],
  ["actualDiscoveryDate", "actual discovery(?: date)?"],
  ["constructiveDiscoveryDate", "constructive discovery(?: date)?"],
  ["deathDate", "death(?: date)?|died"],
  ["diagnosisCommunicationDate", "diagnosis (?:communication date|communicated)"],
  ["causeDiscoveryDate", "cause discovery(?: date)?"],
  ["firstProductDeliveryDate", "first product delivery(?: date)?"],
  ["qualifyingExposureDate", "qualifying exposure(?: date)?"],
  ["substantialCompletionDate", "substantial completion(?: date)?"],
  ["reposeActDate", "act or omission(?: date)?|repose act(?: date)?"],
];
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const monthPattern = months.map((m) => `${m}|${m.slice(0, 3)}`).join("|");
const datesPattern = new RegExp(
  `\\b(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|(?:${monthPattern}) \\d{1,2}(?:st|nd|rd|th)?[,]? \\d{4}|\\d{1,2}(?:st|nd|rd|th)? (?:${monthPattern}) \\d{4})\\b`,
  "gi",
);
const statePattern = new RegExp(
  `\\b(?:Washington[,]? D\\.?C\\.?|${[...STATES]
    .sort((a, b) => b.name.length - a.name.length)
    .map((s) => s.name)
    .join("|")})\\b`,
  "gi",
);

function civilDate(text: string): string | null {
  if (text.includes("/")) return null; // No locale assumption for numeric dates.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    if (!year || !month || !day) return null;
    const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return parseCivilDate(value) ? value : null;
  }
  const parts = text
    .toLowerCase()
    .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
    .replaceAll(",", "")
    .split(/\s+/);
  const monthIndex = /^\d/.test(parts[0] ?? "") ? 1 : 0;
  const month =
    months.findIndex(
      (name) => name === parts[monthIndex] || name.slice(0, 3) === parts[monthIndex],
    ) + 1;
  const day = parts[monthIndex === 0 ? 1 : 0];
  if (!day || !parts[2]) return null;
  const value = `${parts[2]}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return parseCivilDate(value) ? value : null;
}

/** Local extraction only. No retrieval, legal classification, legal periods, implied accrual or arithmetic. */
export function parseIntake(text: string): IntakeResult {
  const result: IntakeResult = { facts: [], notes: [], reviewTopics: [] };
  if (text.length > INTAKE_MAX_LENGTH) {
    result.notes.push({
      kind: "length",
      text: `Use at most ${INTAKE_MAX_LENGTH.toLocaleString()} characters. Nothing was extracted.`,
    });
    return result;
  }
  const candidates: IntakeFact[] = [];
  const withheld = new Set<IntakeField>();
  const note = (kind: IntakeResult["notes"][number]["kind"], message: string) => {
    if (!result.notes.some((n) => n.text === message)) result.notes.push({ kind, text: message });
  };
  // Preserve the exact original clause as evidence. Decimal points / abbreviations are not inferred.
  const clauses = text.match(/(?:\bD\.C\.|[^.;\n!?])+[.;\n!?]?/gi) ?? [];
  for (const raw of clauses) {
    const clause = raw.trim();
    const isQualified = qualified.test(clause) || clause.endsWith("?");
    const add = (field: IntakeField, value: string) => {
      if (isQualified) {
        withheld.add(field);
        note("qualified", `Negated or uncertain wording needs manual review: “${clause}”.`);
      } else candidates.push({ field, value, evidence: clause });
    };
    for (const [id, label, expression] of topicTerms) {
      if (expression.test(clause) && !result.reviewTopics.some((t) => t.id === id))
        result.reviewTopics.push({ id, label, evidence: clause });
    }
    for (const match of clause.matchAll(statePattern)) {
      const value = /^Washington[,]? D\.?C\.?$/i.test(match[0])
        ? "DC"
        : STATES.find((s) => s.name.toLowerCase() === match[0].toLowerCase())?.usps;
      if (value) add("jurisdiction", value);
    }
    // USPS codes need an explicit state/law label; IN, OR and ME in ordinary prose are not states.
    for (const match of clause.matchAll(
      /\b(?:governing (?:state|law)|state|jurisdiction)\s*[:=]?\s*([a-z]{2})\b/gi,
    )) {
      const abbreviation = match[1]?.toUpperCase();
      if (abbreviation && STATES.some((s) => s.usps === abbreviation))
        add("jurisdiction", abbreviation);
    }
    for (const [claim, expression] of claimTerms)
      if (expression.test(clause)) add("claimType", claim);
    const dateMatches = [...clause.matchAll(datesPattern)];
    const roles: (DateField | null)[] = [];
    dateMatches.forEach((match, index) => {
      const previous = dateMatches[index - 1];
      const start = previous ? previous.index! + previous[0].length : 0;
      const prefix = clause.slice(start, match.index);
      const role =
        dateRoles.find(([, label]) =>
          new RegExp(`\\b(?:${label})(?:\\s+(?:on|was|is))?\\s*[:=-]?\\s*$`, "i").test(prefix),
        )?.[0] ?? null;
      roles.push(role);
      const value = civilDate(match[0]);
      if (!value) {
        if (role) withheld.add(role);
        note(
          "date",
          `Enter “${match[0]}” manually as a valid YYYY-MM-DD date; numeric slash dates are not interpreted.`,
        );
      } else if (role) add(role, value);
      else
        note(
          "date",
          `“${match[0]}” has no unambiguous date role. Label it explicitly; an incident date is not automatically accrual.`,
        );
    });
    if (dateMatches.length > 1 && roles.includes(null)) {
      for (const role of roles) if (role) withheld.add(role);
      note(
        "ambiguous",
        "Several dates occur together without distinct roles. Enter those dates manually.",
      );
    }
  }
  for (const field of Object.keys(INTAKE_FIELD_LABELS) as IntakeField[]) {
    const matches = candidates.filter((c) => c.field === field);
    const distinct = new Set(matches.map((m) => m.value));
    if (distinct.size > 1)
      note("ambiguous", `${INTAKE_FIELD_LABELS[field]} has multiple values. Choose it manually.`);
    else if (distinct.size === 1 && !withheld.has(field) && matches[0])
      result.facts.push(matches[0]);
  }
  return result;
}

/** Confirmation copies only the whitelist. No narrative, legal conclusion or confirmation reaches the engine. */
export function confirmIntake(
  result: IntakeResult,
  selected: readonly IntakeField[],
  confirmed: boolean,
): ConfirmedIntake | null {
  if (!confirmed) return null;
  const facts = result.facts.filter((fact) => selected.includes(fact.field));
  if (!facts.length) return null;
  return {
    facts: Object.fromEntries(facts.map((fact) => [fact.field, fact.value])),
    reviewTopics: result.reviewTopics,
  };
}

/** Mentions (even negated mentions) open a review; extraction can never clear a screening question. */
export function intakeReviewDecisions(topics: readonly IntakeTopic[]): ReviewDecisions {
  return Object.fromEntries(
    topics.map((topic) => [
      `screen:${topic.id}`,
      {
        status: "needs_review",
        note: `Mentioned in the description: “${topic.evidence}”. No legal effect was inferred.`,
      },
    ]),
  );
}
