import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { conversationCandidateSchema } from "./conversationExtraction";
import type { ConversationScenario } from "./conversationAssessment";

export const conversationAssessmentRequest = z
  .object({
    facts: z.array(conversationCandidateSchema).max(64),
    factsConfirmed: z.boolean(),
    scenarioRequested: z.boolean(),
    expectedEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((data, context) => {
    if (new Set(data.facts.map((fact) => fact.field)).size !== data.facts.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Conflicting facts require clarification.",
      });
    if (JSON.stringify(data).length > 100_000)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Assessment facts are too long." });
  });
export type ConversationServerResult =
  | {
      status: "assessed";
      scenario: Omit<ConversationScenario, "rule"> & { ruleId: string | null };
      ruleVersion: string;
      evidenceDigest: string;
    }
  | { status: "unavailable"; message: string };

export const assessConversationFacts = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => conversationAssessmentRequest.parse(input))
  .handler(async ({ data }): Promise<ConversationServerResult> => {
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireCorpusAccess } = await import("@/lib/auth/access.server");
    await requireCorpusAccess(getRequest());
    setResponseHeader("Cache-Control", "private, no-store");
    const { loadLimitationsServer } = await import("./sectionRules.server");
    const { evaluateConversationRequest } = await import("./conversationAssessment.server");
    try {
      return await evaluateConversationRequest(await loadLimitationsServer(), data);
    } catch {
      return {
        status: "unavailable",
        message:
          "The source release could not be verified. No calculation is available until it can be reloaded.",
      };
    }
  });
