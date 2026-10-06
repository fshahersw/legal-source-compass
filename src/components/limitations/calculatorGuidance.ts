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
    | "qualifyingExposureDate";
  label: string;
  help: string;
};

type ReposeRuleCalculation = {
  mode: "accrual_repose_min";
  reposeYears: number;
  reposeTrigger: "last_act_or_omission" | "act_or_omission";
};

function reposeCalculation(rule: LimitationRule | null): ReposeRuleCalculation | null {
  const calculation = rule?.calculation;
  if (
    calculation?.mode !== "accrual_repose_min" ||
    typeof calculation.reposeYears !== "number" ||
    (calculation.reposeTrigger !== "last_act_or_omission" &&
      calculation.reposeTrigger !== "act_or_omission")
  )
    return null;
  return {
    mode: "accrual_repose_min",
    reposeYears: calculation.reposeYears,
    reposeTrigger: calculation.reposeTrigger,
  };
}

export function isAccrualReposeRule(rule: LimitationRule | null): boolean {
  return reposeCalculation(rule) !== null;
}

export function reposeCapLabel(rule: LimitationRule | null): string | null {
  const calculation = reposeCalculation(rule);
  if (!calculation) return null;
  const trigger =
    calculation.reposeTrigger === "last_act_or_omission"
      ? "the last act or omission"
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
        : "Date of the act or omission complained of";
    const triggerHelp =
      repose.reposeTrigger === "last_act_or_omission"
        ? `For this ${claim} claim, identify the last act or omission legally attributable to this defendant. A later event is not assumed to qualify or restart repose.`
        : `For this ${claim} claim, identify the act or omission complained of for this defendant. Do not substitute the latest event or assume a later event resets repose.`;
    return [
      {
        key: "accrualDate",
        label: "Confirmed accrual date",
        help: "Enter the accrual date established under the cited limitations rule. This is separate from the repose act or omission date.",
      },
      {
        key: "reposeActDate",
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
