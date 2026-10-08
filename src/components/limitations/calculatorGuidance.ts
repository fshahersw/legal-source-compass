import type { BaselineInput, ClaimType, LimitationRule } from "@/lib/limitations/types";

export function unconfirmedClaimInput(
  jurisdiction: string,
  claimType: ClaimType | "",
  subtype = "general",
): BaselineInput {
  return {
    jurisdiction,
    claimType: claimType || "product_liability",
    subtype,
    accrualDate: "",
    reposeActDate: "",
    governingLawConfirmed: false,
    accrualConfirmed: false,
    applicabilityConfirmed: false,
    reposeApplicabilityConfirmed: false,
    exceptionReview: "unresolved",
    issues: [],
    vitalStatus: "unknown",
  };
}

const DATE_KEYS = [
  "accrualDate",
  "reposeActDate",
  "actualDiscoveryDate",
  "constructiveDiscoveryDate",
  "diagnosisCommunicationDate",
  "injuryDate",
  "deathDate",
  "causeDiscoveryDate",
  "substantialCompletionDate",
  "firstProductDeliveryDate",
  "qualifyingExposureDate",
] as const;

/**
 * Input for a different statutory version of the same claim: the entered dates carry over, every
 * confirmation resets because they were given for a different rule.
 */
export function switchedVersionInput(previous: BaselineInput, subtype: string): BaselineInput {
  const next = unconfirmedClaimInput(previous.jurisdiction, previous.claimType, subtype);
  for (const key of DATE_KEYS) {
    const value = previous[key];
    if (typeof value === "string" && value) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

const WINDOW_EVENT_LABEL: Record<string, string> = {
  accrual: "accrual",
  discovery: "discovery",
  injury_date: "injury",
  death: "death",
  act_or_omission: "act or omission",
};

/** The dates a rule's statutory window covers, e.g. "accrual dates on or before 2023-03-24", or null when unbounded. */
export function versionWindowLabel(
  rule: Pick<LimitationRule, "effectiveFrom" | "effectiveThrough" | "calculation" | "accrualBasis">,
): string | null {
  if (!rule.effectiveFrom && !rule.effectiveThrough) return null;
  const event =
    rule.calculation?.windowFrom ?? (rule.accrualBasis === "death" ? "death" : "accrual");
  const span =
    rule.effectiveFrom && rule.effectiveThrough
      ? `${rule.effectiveFrom} through ${rule.effectiveThrough}`
      : rule.effectiveThrough
        ? `on or before ${rule.effectiveThrough}`
        : `on or after ${rule.effectiveFrom}`;
  return `${WINDOW_EVENT_LABEL[event] ?? event} dates ${span}`;
}

export type GuidedDateField = {
  key:
    | "accrualDate"
    | "reposeActDate"
    | "actualDiscoveryDate"
    | "constructiveDiscoveryDate"
    | "diagnosisCommunicationDate"
    | "deathDate"
    | "causeDiscoveryDate"
    | "firstProductDeliveryDate"
    | "qualifyingExposureDate"
    | "injuryDate"
    | "substantialCompletionDate";
  label: string;
  help: string;
};

type ReposeRuleCalculation = {
  mode: "accrual_repose_min";
  reposeYears: number;
  reposeTrigger: "last_act_or_omission" | "act_or_omission" | "first_delivery";
};

function reposeCalculation(rule: LimitationRule | null): ReposeRuleCalculation | null {
  const calculation = rule?.calculation;
  if (
    calculation?.mode !== "accrual_repose_min" ||
    typeof calculation.reposeYears !== "number" ||
    (calculation.reposeTrigger !== "last_act_or_omission" &&
      calculation.reposeTrigger !== "act_or_omission" &&
      calculation.reposeTrigger !== "first_delivery")
  )
    return null;
  return {
    mode: "accrual_repose_min",
    reposeYears: calculation.reposeYears,
    reposeTrigger: calculation.reposeTrigger,
  };
}

export function isAccrualReposeRule(rule: LimitationRule | null): boolean {
  return (
    reposeCalculation(rule) !== null ||
    (rule?.calculation?.mode === "clocks_min" && (rule.calculation.clocks?.length ?? 0) > 0)
  );
}

const CLOCK_PHRASE: Record<string, string> = {
  act_or_omission: "the act or omission complained of",
  last_act_or_omission: "the last act or omission",
  injury_date: "the date of injury",
  substantial_completion: "substantial completion of the improvement",
  first_delivery: "first delivery of the product to a purchaser or lessee",
};

function clocksFields(rule: LimitationRule): GuidedDateField[] {
  const calc = rule.calculation!;
  const fields: GuidedDateField[] = [];
  const add = (field: GuidedDateField) => {
    if (!fields.some((f) => f.key === field.key)) fields.push(field);
  };
  for (const limb of calc.limbs ?? []) {
    if (limb.from === "accrual")
      add({
        key: "accrualDate",
        label: "Confirmed accrual date",
        help: "Enter the accrual date established under the cited limitations rule. Repose dates are separate.",
      });
    if (limb.from === "death")
      add({
        key: "deathDate",
        label: "Date of death",
        help: "Use the death date required by this wrongful-death rule. Repose dates are separate.",
      });
    if (limb.from === "discovery") {
      add({
        key: "actualDiscoveryDate",
        label: "When the injury and its cause were actually discovered",
        help: "Use the knowledge the cited rule requires. Leave an unknown date blank rather than guessing.",
      });
      add({
        key: "constructiveDiscoveryDate",
        label: "When reasonable diligence should have revealed that knowledge",
        help: "Both discovery dates are required; the earlier controls the discovery limb.",
      });
    }
    if (limb.from === "injury_date")
      add({
        key: "injuryDate",
        label: "Date of the injury",
        help: "The date the injury or incident occurred, as the cited rule measures it. This is not the discovery date.",
      });
    if (limb.from === "act_or_omission")
      add({
        key: "reposeActDate",
        label: "Date of the act or omission complained of",
        help: "The incident, treatment or omission the claim is based on, as the cited rule measures it. This is not the discovery date.",
      });
  }
  for (const clock of calc.clocks ?? []) {
    const phrase = CLOCK_PHRASE[clock.from] ?? clock.from;
    const key =
      clock.from === "injury_date"
        ? "injuryDate"
        : clock.from === "substantial_completion"
          ? "substantialCompletionDate"
          : clock.from === "first_delivery"
            ? "firstProductDeliveryDate"
            : "reposeActDate";
    add({
      key,
      label: `Date of ${phrase}`,
      help: `Enter the date the repose clock starts: ${phrase}. A later event is not assumed to qualify or restart repose.`,
    });
  }
  return fields;
}

export function reposeCapLabel(rule: LimitationRule | null): string | null {
  if (rule?.calculation?.mode === "clocks_min") {
    const clocks = rule.calculation.clocks ?? [];
    if (!clocks.length) return null;
    return `Outer repose caps (the earliest applies): ${clocks
      .map((c) => `${c.years} calendar years from ${CLOCK_PHRASE[c.from] ?? c.from}`)
      .join("; ")}.`;
  }
  const calculation = reposeCalculation(rule);
  if (!calculation) return null;
  const trigger =
    calculation.reposeTrigger === "last_act_or_omission"
      ? "the last act or omission"
      : calculation.reposeTrigger === "first_delivery"
        ? "first delivery of the product to a purchaser or lessee"
        : "the act or omission complained of";
  return `Outer repose cap: ${calculation.reposeYears} calendar years from ${trigger}.`;
}

export function guidedDateFields(
  rule: LimitationRule | null,
  state: string,
  subtype?: string,
): GuidedDateField[] {
  if (!rule) return [];
  const mode = rule.calculation?.mode;
  if (mode === "clocks_min") return clocksFields(rule);
  if (mode === "accrual_repose_min") {
    const repose = reposeCalculation(rule);
    if (!repose) return [];
    const claim =
      rule.claimType === "wrongful_death"
        ? "wrongful-death"
        : rule.claimType === "product_liability"
          ? "product-injury"
          : rule.claimType === "personal_injury"
            ? "personal-injury"
            : rule.claimType.replaceAll("_", " ");
    const triggerLabel =
      repose.reposeTrigger === "last_act_or_omission"
        ? "Date of the last act or omission"
        : repose.reposeTrigger === "first_delivery"
          ? "Date of first delivery to a purchaser or lessee"
          : "Date of the act or omission complained of";
    const triggerHelp =
      repose.reposeTrigger === "last_act_or_omission"
        ? `For this ${claim} claim, identify the last act or omission legally attributable to this defendant. A later event is not assumed to qualify or restart repose.`
        : repose.reposeTrigger === "first_delivery"
          ? `For this ${claim} claim, enter the date the product was first delivered to its initial purchaser or lessee, as the cited repose provision defines it. Later resales do not restart repose.`
          : `For this ${claim} claim, identify the act or omission complained of for this defendant. Do not substitute the latest event or assume a later event resets repose.`;
    const fromDeath = rule.accrualBasis === "death";
    return [
      {
        key: "accrualDate",
        label: fromDeath ? "Date of death" : "Confirmed accrual date",
        help: fromDeath
          ? "Use the death date required by this wrongful-death rule. The repose date below is separate."
          : "Enter the accrual date established under the cited limitations rule. This is separate from the repose date.",
      },
      {
        key:
          repose.reposeTrigger === "first_delivery" ? "firstProductDeliveryDate" : "reposeActDate",
        label: triggerLabel,
        help: triggerHelp,
      },
    ];
  }
  const dates: GuidedDateField[] =
    mode === "discovery_min"
      ? [
          {
            key: "actualDiscoveryDate",
            label:
              state === "OH"
                ? "First medical information linking injury to exposure"
                : state === "CA"
                  ? "When you discovered or suspected product wrongdoing"
                  : state === "NY"
                    ? "When the injury was discovered"
                    : "When the injury and its causal connection were known",
            help:
              state === "OH"
                ? "Use the first qualifying information from a competent medical authority under the cited rule."
                : state === "CA"
                  ? "Use discovery or suspicion of the factual basis for wrongdoing under the cited product rule."
                  : state === "NY"
                    ? "Use injury discovery under this rule; discovery of the cause is a separate legal question."
                    : "Use the knowledge required by this branch, as established under the cited authority.",
          },
          {
            key: "constructiveDiscoveryDate",
            label: "When reasonable diligence should have revealed that knowledge",
            help: "Both discovery dates are required. The earlier date controls this branch; leave an unknown date blank rather than copying or guessing.",
          },
        ]
      : mode === "diagnosis"
        ? [
            {
              key: "diagnosisCommunicationDate",
              label:
                subtype === "breast_implant"
                  ? "When a physician first communicated injury and its causal connection"
                  : "When a physician first communicated the qualifying asbestos diagnosis",
              help: "Use the physician communication required by this branch, not automatically the exposure, procedure or symptom date.",
            },
          ]
        : mode === "death_cause_min"
          ? [
              {
                key: "deathDate",
                label: "Date of death",
                help: "This branch requires the death date as well as cause-of-death discovery.",
              },
              {
                key: "causeDiscoveryDate",
                label: "When the cause of death was legally discovered",
                help: "This is not automatically the diagnosis date. The branch also has a separate death-based cap.",
              },
            ]
          : [
              {
                key: "accrualDate",
                label:
                  rule.accrualBasis === "death"
                    ? "Date of death"
                    : rule.accrualBasis === "discovery_of_death"
                      ? "When the death was discovered"
                      : "Date the claim legally arose",
                help:
                  rule.accrualBasis === "death"
                    ? "Use the death date required by this wrongful-death rule."
                    : rule.accrualBasis === "discovery_of_death"
                      ? "Use the legally relevant discovery-of-death date under the cited rule."
                      : "This is the legally established start of the limitations period. Exposure, diagnosis, discovery and symptoms are not interchangeable.",
              },
            ];
  if (rule.calculation?.requiresExposureWithinDeliveryYears)
    dates.push(
      {
        key: "firstProductDeliveryDate",
        label: "First qualifying product delivery date",
        help: "Delivery to the first qualifying purchaser or lessee is required to check this branch's exposure window.",
      },
      {
        key: "qualifyingExposureDate",
        label: "Date of the qualifying exposure causing injury",
        help: "Use the exposure required by this statutory branch. The delivery-window condition is checked before a baseline is issued.",
      },
    );
  return dates;
}

export type MissingRequirement = { id: string; label: string };

/** Items that must be filled before the calculator may run (dates and repose confirmation). */
export function missingRequirements(
  input: BaselineInput,
  rule: LimitationRule | null,
  fields: GuidedDateField[],
): MissingRequirement[] {
  if (!rule) return [];
  const out: MissingRequirement[] = fields
    .filter((field) => !input[field.key])
    .map((field) => ({ id: "date-" + field.key, label: field.label }));
  if (rule.calculation?.deathCapYears && input.vitalStatus === "deceased" && !input.deathDate)
    out.push({ id: "date-deathDate", label: "Date of death" });
  if (isAccrualReposeRule(rule) && input.reposeApplicabilityConfirmed !== true)
    out.push({ id: "repose-applicability-confirmed", label: "Confirm the repose rule applies" });
  return out;
}
