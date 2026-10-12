import type { BaselineInput, ClaimType } from "@/lib/limitations/types";
import type { ConfirmedIntake } from "@/lib/limitations/intake";
import { switchedVersionInput, unconfirmedClaimInput } from "./calculatorGuidance";

export type CaseEvidenceBinding = { selectionKey: string; sourceKey: string };

/** A new case/version is a deliberate choice; only an existing selection can lose evidence. */
export function isEvidenceRefresh(
  previous: CaseEvidenceBinding,
  next: CaseEvidenceBinding,
): boolean {
  return (
    previous.selectionKey === next.selectionKey &&
    previous.sourceKey !== "" &&
    previous.sourceKey !== next.sourceKey
  );
}

/** Accepted words are draft facts only; they can never carry previous legal confirmations. */
export function intakeCaseFacts(
  accepted: ConfirmedIntake,
  state: string,
  claim: ClaimType | undefined,
): BaselineInput {
  return {
    ...unconfirmedClaimInput(
      accepted.facts.jurisdiction ?? state,
      accepted.facts.claimType ?? claim ?? "",
    ),
    ...accepted.facts,
  };
}

/** Completing an incomplete intake preserves dated events but starts a fresh legal review. */
export function chooseIntakeCase(
  previous: BaselineInput,
  state: string,
  claim: ClaimType | undefined,
): BaselineInput {
  return {
    ...switchedVersionInput(previous, "general"),
    jurisdiction: state,
    claimType: claim ?? "product_liability",
  };
}

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
