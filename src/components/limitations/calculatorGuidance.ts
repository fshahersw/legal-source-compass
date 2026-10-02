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
    governingLawConfirmed: false,
    accrualConfirmed: false,
    applicabilityConfirmed: false,
    exceptionReview: "unresolved",
    issues: [],
    vitalStatus: "unknown",
  };
}

export type GuidedDateField = {
  key:
    | "accrualDate"
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

export function guidedDateFields(
  rule: LimitationRule | null,
  state: string,
  subtype?: string,
): GuidedDateField[] {
  if (!rule) return [];
  const mode = rule.calculation?.mode;
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
