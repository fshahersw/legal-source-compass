import type { BaselineInput } from "@/lib/limitations/types";

const datesKey = new Set([
  "accrualDate",
  "actualDiscoveryDate",
  "constructiveDiscoveryDate",
  "diagnosisCommunicationDate",
  "causeDiscoveryDate",
  "deathDate",
  "vitalStatus",
  "firstProductDeliveryDate",
  "qualifyingExposureDate",
  "injuryDate",
  "substantialCompletionDate",
  "reposeActDate",
  "subtype",
]);

export function reviseCaseFacts(
  previous: BaselineInput,
  patch: Partial<BaselineInput>,
): BaselineInput {
  const factsChanged = Object.keys(patch).some((key) => datesKey.has(key));
  return {
    ...previous,
    ...patch,
    exceptionReview: "unresolved",
    ...(factsChanged
      ? {
          accrualConfirmed: false,
          applicabilityConfirmed: false,
          reposeApplicabilityConfirmed: false,
        }
      : {}),
  };
}

export const CASE_VARIANT_LABELS: Record<string, string> = {
  general: "General claim",
  latent_toxic: "Latent substance / toxic injury",
  asbestos: "Asbestos-related injury",
  medical_device: "Implanted medical device",
  breast_implant: "Breast augmentation / reconstruction prosthesis",
  occupational_disease: "Workplace toxic disease contributing to death",
  chromium: "Chromium exposure",
  agent_orange: "Veteran's qualifying defoliant / herbicide exposure",
  synthetic_estrogen: "DES / nonsteroidal synthetic estrogen exposure",
};
